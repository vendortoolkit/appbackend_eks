
import { DDB_TABLES, CONSTANTS } from '/opt/nodejs/core_module/index.mjs'
import { S3Client, GetObjectCommand, sharedConfig } from '/opt/nodejs/awsSdk_module/index.mjs'
import { logger } from '../utils/logger.mjs'

//Filesystem and stream modules are used to handle file operations and streaming data
import fs from 'node:fs'
import { basename } from 'node:path'
import { createGunzip } from 'node:zlib'
import { pipeline } from 'node:stream/promises'

// stream-json modules are used to parse large JSON files in a streaming manner
import chain from 'stream-chain'
import { streamArray } from 'stream-json/streamers/stream-array.js'
import { pick } from 'stream-json/filters/pick.js'

const MAX_ASPECT_VALUE_CHARS = process.env.MAX_ASPECT_VALUE_CHARS ? parseInt(process.env.MAX_ASPECT_VALUE_CHARS) : 350000

function chunkAspectValuesByCharLength(values, maxChars) {
  const chunks = []
  let current = []
  let currentChars = 0

  if (values.length === 0) {
    return [[]]  // Return an array with one empty array if there are no values 
  }

  for (const value of values) {
    const valueLength = value.length
    if (current.length > 0 && currentChars + valueLength > maxChars) {
      chunks.push(current)
      current = []
      currentChars = 0
    }

    if (valueLength > maxChars) {
      chunks.push([value.slice(0, maxChars)])
      continue
    }

    current.push(value)
    currentChars += valueLength
  }

  if (current.length > 0) chunks.push(current)
  return chunks
}

async function batchWriteItems(dynamo, tableName, requests, logid = null) {
  while (requests.length > 0) {
    const batch = requests.splice(0, 25)
    let unprocessed = batch
    let delay = 500
    let attempt = 0

    while (unprocessed.length > 0) {
      attempt += 1
      try {
        const result = await dynamo.batchWrite({
          RequestItems: { [tableName]: unprocessed },
        })
        unprocessed = result?.UnprocessedItems?.[tableName] ?? []
        if (unprocessed.length > 0) {
          //logger(`DynamoDB batchWrite retry for table ${tableName}: ${unprocessed.length} unprocessed item(s) remain after attempt ${attempt}, retrying in ${delay}ms`, logid)
          await new Promise((resolve) => setTimeout(resolve, delay + Math.floor(Math.random() * 100)))
          delay = Math.min(delay * 2, 5000)
        }
      } catch (err) {
        const isThrottling = ['ProvisionedThroughputExceededException', 'ThrottlingException', 'RequestLimitExceeded', 'InternalServerError'].includes(err.name)
        if (!isThrottling || attempt >= 10) {
          logger(`DynamoDB batchWrite failed for table ${tableName} on attempt ${attempt}: ${err.message}`, logid)
          throw err
        }
        //logger(`DynamoDB throttling on table ${tableName}, attempt ${attempt}, retrying in ${delay}ms: ${err.message}`, logid)
        await new Promise((resolve) => setTimeout(resolve, delay + Math.floor(Math.random() * 100)))
        delay = Math.min(delay * 2, 5000)
      }
    }
  }
}


//Prepare the DDB table for the update by setting the itemspec_update_status to 'updating_db' and setting a lease expiration time to prevent concurrent updates.
export async function prepareUpdateItemSpecs({ jobId, categoryTreeId, newJob = false, dynamo, logid = null }) {
  try {

    //IF this is a new job we will record the jobId and reset the progress_last_cat_id to null. If this is a continuation of a previous job we will just update the lease expiration time.
    if (newJob) {
      await dynamo.update({
        TableName: DDB_TABLES.EBAY.EBAY_ITEMSPEC_DETAILS.NAME,
        Key: { category_tree_id: categoryTreeId },
        UpdateExpression: 'SET itemspec_update_status = :itemspec_update_status,  db_progress_job_id = :db_progress_job_id, db_progress_lease_expires_at = :db_progress_lease_expires_at  REMOVE progress_last_cat_id',
        ExpressionAttributeValues: {
          ':itemspec_update_status': CONSTANTS.EBAY_METADATA.ITEM_SPEC_DOWNLOAD_STATUS.IN_PROGRESS,
          ':db_progress_lease_expires_at': new Date(Date.now() + 15 * 60 * 1000).toISOString(), //15 minutes from now
          ':db_progress_job_id': jobId,
        },
      })
    } else {
      await dynamo.update({
        TableName: DDB_TABLES.EBAY.EBAY_ITEMSPEC_DETAILS.NAME,
        Key: { category_tree_id: categoryTreeId },
        UpdateExpression: 'SET  db_progress_lease_expires_at = :db_progress_lease_expires_at',
        ExpressionAttributeValues: {
          ':db_progress_lease_expires_at': new Date(Date.now() + 15 * 60 * 1000).toISOString(), //15 minutes from now
        },
      })
    }
  }
  catch (err) {
    logger('Error in prepareUpdateItemSpecs: ' + err.message, logid)
    throw err
  }
}



export async function updateItemSpecs({ s3Key, jobId, dynamo, metadataBucket, logid = null }) {
  let categoryTreeId
  let startWriting = false
  let lastUpdatedCategoryId = null

  const DOWNLOADED_STATUS = CONSTANTS.EBAY_METADATA.ITEM_SPEC_DOWNLOAD_STATUS.DOWNLOADED
  const COMPLETED_STATUS = CONSTANTS.EBAY_METADATA.ITEM_SPEC_DOWNLOAD_STATUS.COMPLETED
  const IN_PROGRESS_STATUS = CONSTANTS.EBAY_METADATA.ITEM_SPEC_DOWNLOAD_STATUS.IN_PROGRESS

  try {
    if (!s3Key) {
      throw {
        message: 'Missing s3Key parameter',
        errors: { debug: 's3Key is required' },
        restStatus: 400,
      }
    }

    if (!metadataBucket) {
      throw {
        message: 'Missing S3 metadata bucket',
        errors: { debug: 'metadataBucket is required' },
        restStatus: 400,
      }
    }

    //Check dynamoDB to see if the active_itemspec_version is already set to the version we are trying to update. If so, we can skip the update.
    const versionToken = basename(s3Key, '.gz')
    const ddbParams = {
      TableName: DDB_TABLES.EBAY.EBAY_ITEMSPEC_DETAILS.NAME,
      Key: { category_tree_id: versionToken.split('_')[0] },
    }

    const ddbResponse = await dynamo.get(ddbParams)
    /*
    //Has this version already been processed? If so, we can skip the update.
       if (ddbResponse?.Item?.active_itemspec_version === versionToken) {
      logger('Item specs already up to date for category_tree_id ' + ddbResponse.Item.category_tree_id + ', version ' + versionToken, logid)
      return
    }
    */

    //Is this the latest version? If not, we can skip the update. We will only process the latest version to avoid overwriting newer data with older data.
    if (ddbResponse?.Item?.ebay_itemspec_version !== versionToken) {
      logger('Skipping item specs update for category_tree_id ' + ddbResponse.Item.category_tree_id + ', version ' + versionToken + ' because it is not the latest version (' + ddbResponse.Item.ebay_itemspec_version + ')', logid)
      return
    }

    //Is there a current lease on the category (job running)
    if (ddbResponse.Item.db_progress_lease_expires_at > new Date().toISOString()){
      logger('Skipping item specs update for category_tree_id ' + ddbResponse.Item.category_tree_id + ', version ' + versionToken + ' because another job is currently running', logid)
      return
    }

    //Is the item spec download status set to DOWNLOADED or IN_PROGRESS? If not, we can skip the update.
    //New Job
    if ( ddbResponse?.Item?.itemspec_update_status === DOWNLOADED_STATUS) {
      logger('Starting new job for category_tree_id ' + ddbResponse.Item.category_tree_id + ', version ' + versionToken + ' because the jobId has changed', logid)
      await prepareUpdateItemSpecs({ jobId, categoryTreeId: ddbResponse.Item.category_tree_id, newJob: true, dynamo, logid })
    }
    //Existing Job - is the jobId the same as the current jobId in DynamoDB? If so, we can continue the job. If not, we will skip the update.
    else if (ddbResponse?.Item?.itemspec_update_status === IN_PROGRESS_STATUS) {
      if (ddbResponse.Item?.db_progress_job_id === jobId) {
        await prepareUpdateItemSpecs({ jobId, categoryTreeId: ddbResponse.Item.category_tree_id, newJob: false, dynamo, logid })
        // If the last_updated_category_id is set in DynamoDB, we will use it to determine where to resume writing. 
        // This is useful in case of a previous failure.
        lastUpdatedCategoryId = ddbResponse?.Item?.progress_last_cat_id ?? null
      }
      else {
        logger('Skipping item specs update for category_tree_id ' + ddbResponse.Item.category_tree_id + ', version ' + versionToken + ' because another job is currently running with jobId ' + ddbResponse.Item.db_progress_job_id, logid)
        return
      }
    }
    //Other status - do not process
    else {
      logger('Skipping item specs update for category_tree_id ' + ddbResponse.Item.category_tree_id + ', version ' + versionToken + ' because it does not have a downloaded or in_progress status (' + ddbResponse.Item.itemspec_update_status + ')', logid)
      return
    }
   
    // Get the active_spec_key_id from DynamoDB to use for the update - it WILL be set at this point
    const activeSpecKeyId = ddbResponse?.Item?.latest_spec_key_id ?? 1

    logger('Updating item specs for category_tree_id ' + ddbResponse.Item?.category_tree_id + ', version ' + versionToken, logid)

    const s3 = new S3Client(sharedConfig)

    // Validate key exists and fetch content
    let s3Response
    try {
      s3Response = await s3.send(new GetObjectCommand({ Bucket: metadataBucket, Key: s3Key }))
    } catch (err) {
      if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
        throw {
          message: 'S3 key not found: ' + s3Key,
          errors: { debug: err.message },
          restStatus: 404,
        }
      }
      throw {
        message: 'Error accessing S3 key: ' + s3Key,
        errors: { debug: err.message },
        restStatus: 400,
      }
    }

    //Uncompress the gzipped file to a temporary local file
    const tmpPath = '/tmp/' + basename(s3Key, '.gz')
    const gunzipStream = createGunzip()
    const writeStream = fs.createWriteStream(tmpPath)
    await pipeline(s3Response.Body, gunzipStream, writeStream)
    logger('Downloaded and decompressed S3 key ' + s3Key + ' to local file: ' + tmpPath, logid)

    // We need to validate the uncompressed JSON file to ensure it contains the required fields before processing it further.
    // Instead of loading the entire file into memory, we can read only the first 100 characters to extract the necessary information.
    const first100Stream = fs.createReadStream(tmpPath, { encoding: 'utf8', start: 0, end: 99 })
    let first100 = ''
    for await (const chunk of first100Stream) {
      first100 += chunk
    }
    const idMatch = first100.match(/"categoryTreeId"\s*:\s*"([^"]+)"/)
    categoryTreeId = idMatch?.[1] ?? null

    // Validate that we successfully extracted both categoryTreeId
    if (!categoryTreeId) {
      throw {
        message: 'Unable to extract categoryTreeId from the uncompressed file',
        errors: { debug: 'First 100 chars did not contain both categoryTreeId' },
        restStatus: 400,
      }
    }
    logger('Extracted categoryTreeId=' + categoryTreeId, logid)


    try {
      //To help with large files, we can use stream-json to parse the JSON file 
      // in a streaming manner instead of loading the entire file into memory.
      const pipeline = chain([
        fs.createReadStream(tmpPath),
        pick.withParser({ filter: 'categoryAspects' }),
        streamArray(),
      ])

      // Iterate over the stream and insert each category aspect into DynamoDB
      for await (const { value } of pipeline) {

        const writeItems = []
        const categoryAspect = value
        const categoryId = categoryAspect?.category?.categoryId
        if (!categoryId)  continue

        // If lastUpdatedCategoryId is falsy, we start writing. 
        // If it's not null, we check if it matches the current categoryId and start writng on the next iteration.
        if (!lastUpdatedCategoryId) {
          startWriting = true
        } else if (lastUpdatedCategoryId === categoryId) {
          logger('Found lastUpdatedCategoryId ' + lastUpdatedCategoryId + ', will start writing from next categoryId')
          lastUpdatedCategoryId = null
        }
        if (!startWriting) {
          continue
        }
        
        const aspects = categoryAspect?.aspects ?? []
        for (let i = 0; i < aspects.length; i++) {
          const aspect = aspects[i]
          const localizedAspectName = aspect?.localizedAspectName
          if (!localizedAspectName) continue

          const valueStrings = (aspect?.aspectValues ?? [])
            .map(v => v?.localizedValue)
            .filter(v => typeof v === 'string' && v.length > 0)

          // Split the aspect values into chunks that do not exceed MAX_ASPECT_VALUE_CHARS
          // This is necessary because DynamoDB has a limit on the size of items, and we want to avoid exceeding that limit.
          const valueChunks = chunkAspectValuesByCharLength(valueStrings, MAX_ASPECT_VALUE_CHARS)
          const aspectNameBase = localizedAspectName

          for (let chunkIndex = 0; chunkIndex < valueChunks.length; chunkIndex++) {
            const chunkValues = valueChunks[chunkIndex]
            const itemAspectName = chunkIndex === 0 ? aspectNameBase : `${aspectNameBase}#${chunkIndex + 1}`
            const item = {
              'category_tree_id#key_id#category_id': categoryTreeId + '#' + activeSpecKeyId + '#' + categoryId,
              localizedAspectName: itemAspectName,
              category_tree_id: categoryTreeId,
              active_spec_key_id: activeSpecKeyId,
              category_id: categoryId,
              aspect_sort_order: i,
              aspectConstraint: aspect?.aspectConstraint ?? {},
            }

            if (chunkValues.length > 0) {
              item.aspectValues = chunkValues
            } 

            if (valueChunks.length > 1 && chunkIndex < valueChunks.length - 1) {
              logger('CategoryID:' + categoryId + ', Aspect values for ' + itemAspectName + ' exceed max char limit, splitting into multiple items', logid)
              item.more_aspectvalues = 'true'
            }
            writeItems.push({ PutRequest: { Item: item } })
          }
        }
        await batchWriteItems(dynamo, DDB_TABLES.EBAY.EBAY_ITEMSPECS.NAME, writeItems, logid)

        // Update the last_updated_category_id in DynamoDB after processing each category to allow resuming in case of failure
        const progressParams = {
          TableName: DDB_TABLES.EBAY.EBAY_ITEMSPEC_DETAILS.NAME,
          Key: { category_tree_id: categoryTreeId },
          UpdateExpression: 'SET progress_last_cat_id = :progress_last_cat_id',
          ExpressionAttributeValues: {
            ':progress_last_cat_id': categoryId,
          },
        }
        await dynamo.update(progressParams)
      }
      // After processing all records, update the last_itemspec_data_updated, active_itemspec_version and set itemspec_update_status to completed in DynamoDB
      const now = new Date()
      const nowIso = now.toISOString()
      const successParams = {
        TableName: DDB_TABLES.EBAY.EBAY_ITEMSPEC_DETAILS.NAME,
        Key: { category_tree_id: categoryTreeId },
        UpdateExpression: 'SET last_itemspec_data_updated = :last_itemspec_data_updated, active_spec_key_id = :active_spec_key_id, itemspec_update_status = :itemspec_update_status, active_itemspec_version = :active_itemspec_version REMOVE progress_last_cat_id',
        ExpressionAttributeValues: {
          ':last_itemspec_data_updated': nowIso,
          ':active_spec_key_id': activeSpecKeyId,
          ':active_itemspec_version': basename(s3Key, '.gz'),
          ':itemspec_update_status': COMPLETED_STATUS,
        },
      }
      await dynamo.update(successParams)
      logger('Saved item specs to S3 and updated DDB for category_tree_id ' + categoryTreeId)

      //Remove the temporary file if it exists to avoid leaving behind large files in the /tmp directory
      try {
        await fs.promises.unlink(tmpPath)
        logger('Deleted temporary file: ' + tmpPath)
      } catch (unlinkErr) {
        logger('Failed to delete temporary file ' + tmpPath + ': ' + unlinkErr.message)
      }
      

    } catch (err) {
      throw {
        message: 'Failed to parse JSON from item specs file',
        errors: { debug: err.message },
        restStatus: 400,
      }
    }
  } catch (err) {
    //Remove the temporary file if it exists to avoid leaving behind large files in the /tmp directory
    const tmpPath = '/tmp/' + basename(s3Key, '.gz')
    try {
      await fs.promises.unlink(tmpPath)
      logger('Deleted temporary file: ' + tmpPath)
    } catch (unlinkErr) {
      logger('Failed to delete temporary file ' + tmpPath + ': ' + unlinkErr.message)
    }
      
    if (err?.restStatus) throw err
    logger('Error updating item specs: ' + err.message, logid)
    throw {
      message: 'Unable to update item specs',
      errors: { debug: err.message },
      restStatus: 400,
    }
  }
}
/*
async function deleteItemSpecTree({ categoryTreeId = null, categoryTreeVersion = null, dynamo }) {
  try {
    if (categoryTreeId == null || categoryTreeVersion == null) {
      throw {
        message: 'categoryTreeId and categoryTreeVersion are required',
        errors: { debug: 'Missing required parameters for deleteItemSpecTree' },
        restStatus: 400,
      }
    }

    const ttl = Math.floor(Date.now() / 1000) - 3600
    const itemsToExpire = []
    const addItemsToExpire = (items) => {
      for (const item of items) {
        if (item?.ttl != null) {
          //logger('Skipping category item already marked for deletion: ' + JSON.stringify(item))
          continue
        }
        itemsToExpire.push(item)
      }
    }

    logger('deleteCategoryTree running for category_tree_id ' + categoryTreeId + ' and category_tree_version ' + categoryTreeVersion)
    let lastEvaluatedKey = null
    do {
      logger('Querying for category items to expire for category_tree_id ' + categoryTreeId + ' and category_tree_version ' + categoryTreeVersion + ' with lastEvaluatedKey: ' + JSON.stringify(lastEvaluatedKey))
      const queryParams = {
        TableName: DDB_TABLES.EBAY.EBAY_CATEGORIES.NAME,
        KeyConditionExpression: 'category_tree_id = :category_tree_id AND begins_with(#category_tree_version_category_id, :category_tree_version_prefix)',
        ExpressionAttributeNames: {
          '#category_tree_version_category_id': 'category_tree_version#category_id',
          '#ttl': 'ttl',
        },
        ExpressionAttributeValues: {
          ':category_tree_id': categoryTreeId,
          ':category_tree_version_prefix': categoryTreeVersion + '#',
        },
        ProjectionExpression: 'category_tree_id, #category_tree_version_category_id, #ttl',
      }
      if (lastEvaluatedKey) {
        queryParams.ExclusiveStartKey = lastEvaluatedKey
      }

      const queryResult = await dynamo.query(queryParams)
      addItemsToExpire(queryResult?.Items || [])
      lastEvaluatedKey = queryResult?.LastEvaluatedKey || null
    } while (lastEvaluatedKey)


    if (itemsToExpire.length === 0) {
      logger('No category items found matching delete criteria for category_tree_id ' + categoryTreeId + ' and category_tree_version ' + categoryTreeVersion)
      return { message: 'No category items matched delete criteria', updated: 0 }
    }

    logger('Found ' + itemsToExpire.length + ' category items to mark for deletion with ttl ' + ttl)

    const batchSize = 25
    for (let i = 0; i < itemsToExpire.length; i += batchSize) {
      const batch = itemsToExpire.slice(i, i + batchSize)
      //logger('Marking batch of ' + batch.length + ' category items for deletion')

      await Promise.all(batch.map((item) => {
        const updateParams = {
          TableName: DDB_TABLES.EBAY.EBAY_CATEGORIES.NAME,
          Key: {
            category_tree_id: item.category_tree_id,
            'category_tree_version#category_id': item['category_tree_version#category_id'],
          },
          UpdateExpression: 'SET #ttl = :ttl',
          ExpressionAttributeNames: {
            '#ttl': 'ttl',
          },
          ExpressionAttributeValues: {
            ':ttl': ttl,
          },
        }

        return dynamo.update(updateParams)
      }))
    }

    logger('Marked ' + itemsToExpire.length + ' category items with expired ttl')
    return {
      message: 'Category items marked for TTL deletion',
      updated: itemsToExpire.length,
      ttl,
    }
  } catch (err) {
    logger('Error deleting category tree data: ' + err.message)
    throw {
      message: 'Unable to delete category tree data',
      errors: { debug: err.message },
      restStatus: 400,
    }
  }
}
*/