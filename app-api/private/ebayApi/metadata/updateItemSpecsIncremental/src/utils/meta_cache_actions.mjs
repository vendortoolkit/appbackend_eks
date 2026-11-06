
import { DDB_TABLES, CONSTANTS } from '/opt/nodejs/core_module/index.mjs'
import { S3Client, GetObjectCommand, PutObjectCommand, sharedConfig } from '/opt/nodejs/awsSdk_module/index.mjs'
import { logger } from '../utils/logger.mjs'
import { appendFileSync } from 'node:fs'
import { readFile, unlink } from 'node:fs/promises'

const MAX_ASPECT_VALUE_CHARS = process.env.MAX_ASPECT_VALUE_CHARS ? parseInt(process.env.MAX_ASPECT_VALUE_CHARS) : 350000
const DRY_RUN_MODE = process.env.DRY_RUN_MODE === 'true'
let _dryRunLogPath = null

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


function dryRunAppend(entry) {
  if (!_dryRunLogPath) return
  appendFileSync(_dryRunLogPath, JSON.stringify(entry) + '\n')
}

async function dryRunFlush(s3, bucket, logKey) {
  if (!_dryRunLogPath) return
  const pathToUpload = _dryRunLogPath
  _dryRunLogPath = null
  try {
    let body = ''
    try {
      body = await readFile(pathToUpload, 'utf8')
    } catch {
      // no entries logged yet
    }
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: logKey,
      Body: body,
      ContentType: 'text/plain',
    }))
  } catch {
    // S3 flush failed silently in dry run mode
  } finally {
    try { await unlink(pathToUpload) } catch { /* best effort */ }
  }
}


function buildAspectWriteItems({ categoryTreeId, categoryId, activeSpecKeyId, localizedAspectName, aspectValues, aspectSortOrder, aspectConstraint, logid }) {
  // Split the aspect values into chunks that do not exceed MAX_ASPECT_VALUE_CHARS
  // This is necessary because DynamoDB has a limit on the size of items, and we want to avoid exceeding that limit.
  const valueChunks = chunkAspectValuesByCharLength(aspectValues, MAX_ASPECT_VALUE_CHARS)

  const items = []
  for (let chunkIndex = 0; chunkIndex < valueChunks.length; chunkIndex++) {
    const chunkValues = valueChunks[chunkIndex]
    const itemAspectName = chunkIndex === 0 ? localizedAspectName : `${localizedAspectName}#${chunkIndex + 1}`
    const item = {
      'category_tree_id#key_id#category_id': categoryTreeId + '#' + activeSpecKeyId + '#' + categoryId,
      localizedAspectName: itemAspectName,
      category_tree_id: categoryTreeId,
      category_id: categoryId,
      active_spec_key_id: activeSpecKeyId,
      aspect_sort_order: aspectSortOrder,
      aspectConstraint: aspectConstraint ?? {},
    }

    if (chunkValues.length > 0) {
      item.aspectValues = chunkValues
    }

    if (valueChunks.length > 1 && chunkIndex < valueChunks.length - 1) {
      logger('CategoryID:' + categoryId + ', Aspect values for ' + itemAspectName + ' exceed max char limit, splitting into multiple items', logid)
      item.more_aspectvalues = 'true'
    }
    items.push({ PutRequest: { Item: item } })
  }
  return items
}


async function streamToString(readable) {
  let data = ''
  for await (const chunk of readable) {
    data += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
  }
  return data
}

async function queryCategoryItems({ dynamo, tableName, pkValue }) {
  const items = []
  let lastEvaluatedKey = undefined
  do {
    const queryParams = {
      TableName: tableName,
      KeyConditionExpression: '#pk = :pk',
      ExpressionAttributeNames: {
        '#pk': 'category_tree_id#key_id#category_id',
      },
      ExpressionAttributeValues: {
        ':pk': pkValue,
      },
    }

    if (lastEvaluatedKey) {
      queryParams.ExclusiveStartKey = lastEvaluatedKey
    }

    const queryResult = await dynamo.query(queryParams)
    items.push(...(queryResult?.Items ?? []))
    lastEvaluatedKey = queryResult?.LastEvaluatedKey
  } while (lastEvaluatedKey)

  return items
}


async function queryCategoryItem({ dynamo, tableName, pkValue, skValue }) {
  const items = []
  let lastEvaluatedKey = undefined


  do {
    //Do begins with query to get all items that match the skValue prefix. This is necessary because some aspects may be split into multiple items with the same localizedAspectName but with a suffix like #2, #3, etc.
    const queryParams = {
      TableName: tableName,
      KeyConditionExpression: '#pk = :pk and begins_with(#sk, :sk)',
      ExpressionAttributeNames: {
        '#pk': 'category_tree_id#key_id#category_id',
        '#sk': 'localizedAspectName',
      },
      ExpressionAttributeValues: {
        ':pk': pkValue,
        ':sk': skValue,
      },
    }

    if (lastEvaluatedKey) {
      queryParams.ExclusiveStartKey = lastEvaluatedKey
    }

    const queryResult = await dynamo.query(queryParams)
    items.push(...(queryResult?.Items ?? []))
    lastEvaluatedKey = queryResult?.LastEvaluatedKey
  } while (lastEvaluatedKey)

  // Very large items may be split into multiple items with the same localizedAspectName 
  // but with a suffix like #2, #3, etc. We will return all items that match the skValue prefix.
  // We also need to return smaller items based on match of the whole skValue. For example, if skValue is "Color", we want to return items with localizedAspectName "Color", "Color#2", "Color#3", etc.
  // But not items with localizedAspectName "Colorful", "Coloration", etc. So we will use a prefix match with the skValue and a "#" character.
  // filter out items that do not match the skValue prefix or the skValue itself
  const filteredItems = items.filter(item => {
    return item.localizedAspectName === skValue || item.localizedAspectName.startsWith(`${skValue}#`)
  })

  return filteredItems
}


async function batchWriteItems(dynamo, tableName, requests, logid = null) {
  if (DRY_RUN_MODE) {
    dryRunAppend({ op: 'batchWrite', tableName, itemCount: requests.length, items: requests })
    return
  }

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



async function deleteAspectItems({ dynamo, tableName, pkValue, existingItems, logid = null }) {
  const itemsArray = Array.isArray(existingItems)
    ? existingItems
    : Array.isArray(existingItems?.items)
      ? existingItems.items
      : []

  const itemsToDelete = []
  for (const item of itemsArray) {
    itemsToDelete.push({ DeleteRequest: { Key: { 'category_tree_id#key_id#category_id': pkValue, localizedAspectName: item.localizedAspectName } } })
  }
  if (itemsToDelete.length > 0) {
    await batchWriteItems(dynamo, tableName, itemsToDelete, logid)
  }
  return itemsToDelete.length
}


//Prepare the DDB table for the update by setting the itemspec_update_status to 'updating_db' and setting a lease expiration time to prevent concurrent updates.
export async function prepareUpdateItemSpecs({ jobId, categoryTreeId, newJob = false, dynamo, logid = null }) {
  try {

    //IF this is a new job we will record the jobId and reset the progress_last_cat_id to null. If this is a continuation of a previous job we will just update the lease expiration time.
    let params
    if (newJob) {
      params = {
        TableName: DDB_TABLES.EBAY.EBAY_ITEMSPEC_DETAILS.NAME,
        Key: { category_tree_id: categoryTreeId },
        UpdateExpression: 'SET itemspec_update_status = :itemspec_update_status,  db_progress_job_id = :db_progress_job_id, db_progress_lease_expires_at = :db_progress_lease_expires_at  REMOVE progress_last_cat_id',
        ExpressionAttributeValues: {
          ':itemspec_update_status': CONSTANTS.EBAY_METADATA.ITEM_SPEC_DOWNLOAD_STATUS.IN_PROGRESS,
          ':db_progress_lease_expires_at': new Date(Date.now() + 15 * 60 * 1000).toISOString(), //15 minutes from now
          ':db_progress_job_id': jobId,
        },
      }
    } else {
      params = {
        TableName: DDB_TABLES.EBAY.EBAY_ITEMSPEC_DETAILS.NAME,
        Key: { category_tree_id: categoryTreeId },
        UpdateExpression: 'SET  db_progress_lease_expires_at = :db_progress_lease_expires_at',
        ExpressionAttributeValues: {
          ':db_progress_lease_expires_at': new Date(Date.now() + 15 * 60 * 1000).toISOString(), //15 minutes from now
        },
      }
    }

    if (DRY_RUN_MODE) {
      dryRunAppend({ op: 'update', label: 'prepareUpdateItemSpecs', newJob, params })
      return
    }
    await dynamo.update(params)
  }
  catch (err) {
    logger('Error in prepareUpdateItemSpecs: ' + err.message, logid)
    throw err
  }
}



export async function updateItemSpecs({ s3Key, jobId, dynamo, metadataBucket, logid = null }) {
  let categoryTreeId
  let normalizedS3Key = null
  let s3 = null

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

    normalizedS3Key = s3Key.replace(/^\/+/, '')
    const diffToken = normalizedS3Key
    const diffKey = `itemspecs-diff/${normalizedS3Key}/aspects_difference.json`
    if (DRY_RUN_MODE) {
      _dryRunLogPath = `/tmp/dryrun_${normalizedS3Key.replace(/[^a-zA-Z0-9_-]/g, '_')}.log`
    }
    const jobCategoryTreeId = jobId?.split('_')[0] ?? null
    if (!jobCategoryTreeId) {
      throw {
        message: 'Unable to determine categoryTreeId from jobId',
        errors: { debug: 'jobId must include categoryTreeId as prefix' },
        restStatus: 400,
      }
    }
    categoryTreeId = jobCategoryTreeId

    const ddbParams = {
      TableName: DDB_TABLES.EBAY.EBAY_ITEMSPEC_DETAILS.NAME,
      Key: { category_tree_id: categoryTreeId },
    }

    const ddbResponse = await dynamo.get(ddbParams)
    if (!ddbResponse?.Item) {
      throw {
        message: 'Item spec details not found for category_tree_id ' + categoryTreeId,
        errors: { debug: 'Missing DDB row for categoryTreeId' },
        restStatus: 404,
      }
    }

    const versionToken = ddbResponse.Item?.ebay_itemspec_version ?? null
    if (!versionToken) {
      throw {
        message: 'Item spec version is not available in DDB',
        errors: { debug: 'Missing ebay_itemspec_version' },
        restStatus: 400,
      }
    }

    if (ddbResponse?.Item?.active_itemspec_version === versionToken) {
      logger('Item specs already up to date for category_tree_id ' + ddbResponse.Item.category_tree_id + ', version ' + versionToken, logid)
      return
    }

    logger('Using diff file ' + diffToken + ' for incremental update of category_tree_id ' + categoryTreeId + ', target version ' + versionToken, logid)

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

    logger('Updating incremental item specs for category_tree_id ' + ddbResponse.Item?.category_tree_id + ', target version ' + versionToken, logid)

    s3 = new S3Client(sharedConfig)

    let s3Response
    try {
      s3Response = await s3.send(new GetObjectCommand({ Bucket: metadataBucket, Key: diffKey }))
    } catch (err) {
      if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
        throw {
          message: 'S3 key not found: ' + diffKey,
          errors: { debug: err.message },
          restStatus: 404,
        }
      }
      throw {
        message: 'Error accessing S3 key: ' + diffKey,
        errors: { debug: err.message },
        restStatus: 400,
      }
    }

    const diffBody = await (async() => {
      const raw = await streamToString(s3Response.Body)
      return JSON.parse(raw)
    })()

    const categorySpecTable = DDB_TABLES.EBAY.EBAY_ITEMSPECS.NAME

    const removedCategoryCount = await removeCategories({ dynamo, categorySpecTable, categoryTreeId, activeSpecKeyId, diffBody, logid })

    const addedCategoryCount = await addCategories({ dynamo, categoryTreeId, activeSpecKeyId, diffBody, logid })

    const modifiedCategoryCount = await modifyCategories({ dynamo, categorySpecTable, categoryTreeId, activeSpecKeyId, diffBody, logid })

 
    const now = new Date()
    const nowIso = now.toISOString()
    const successParams = {
      TableName: DDB_TABLES.EBAY.EBAY_ITEMSPEC_DETAILS.NAME,
      Key: { category_tree_id: categoryTreeId },
      UpdateExpression: 'SET last_itemspec_data_updated = :last_itemspec_data_updated, active_spec_key_id = :active_spec_key_id, itemspec_update_status = :itemspec_update_status, active_itemspec_version = :active_itemspec_version REMOVE progress_last_cat_id',
      ExpressionAttributeValues: {
        ':last_itemspec_data_updated': nowIso,
        ':active_spec_key_id': activeSpecKeyId,
        ':active_itemspec_version': versionToken,
        ':itemspec_update_status': COMPLETED_STATUS,
      },
    }
    if (DRY_RUN_MODE) {
      dryRunAppend({ op: 'update', label: 'successParams', params: successParams })
      await dryRunFlush(s3, metadataBucket, `diff-ddb/${normalizedS3Key}.log`)
    } else {
      await dynamo.update(successParams)
    }
    logger('Completed incremental item specs update for category_tree_id ' + categoryTreeId + ', removed ' + removedCategoryCount + ' categories, added ' + addedCategoryCount + ' categories, modified ' + modifiedCategoryCount + ' categories', logid)
    
  } catch (err) {
    if (DRY_RUN_MODE && s3) {
      await dryRunFlush(s3, metadataBucket, `diff-ddb/${normalizedS3Key}.log`).catch(() => {})
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

//------------------------------------------------------------------------------
//Remove Categories
//------------------------------------------------------------------------------
async function removeCategories({ dynamo, diffBody, categoryTreeId, activeSpecKeyId, categorySpecTable, logid }) {
  const removedCategories = Array.isArray(diffBody?.removedCategories) ? diffBody.removedCategories.map(String) : []
  let removedCount = 0
  for (const categoryIdRaw of removedCategories) {
    const categoryId = String(categoryIdRaw ?? '')
    if (!categoryId) continue
    removedCount += 1
    const pkValue = `${categoryTreeId}#${activeSpecKeyId}#${categoryId}`
    const existingItems = await queryCategoryItems({ dynamo, tableName: categorySpecTable, pkValue })
    if (existingItems.length === 0) continue
    const deleteRequests = existingItems.map((item) => ({
      DeleteRequest: {
        Key: {
          'category_tree_id#key_id#category_id': pkValue,
          'localizedAspectName': item.localizedAspectName,
        },
      },
    }))
    await batchWriteItems(dynamo, categorySpecTable, deleteRequests, logid)
    logger('Removed category ' + categoryId + ' from item specs', logid)
  }
  return removedCount
}


//------------------------------------------------------------------------------
//Add Categories
//------------------------------------------------------------------------------
async function addCategories({ dynamo, diffBody, categoryTreeId, activeSpecKeyId, logid }) {
  const newCategories = Array.isArray(diffBody?.newCategories) ? diffBody.newCategories : []
  let addedCount = 0
  for (const newCategory of newCategories) {
    let writeItems = []
    const categoryId = String(newCategory?.category?.categoryId ?? newCategory?.categoryId ?? '')
    if (!categoryId) continue
    addedCount += 1
        
    const aspects = Array.isArray(newCategory?.aspects) ? newCategory.aspects : []

    for (let i = 0; i < aspects.length; i++) {
      const aspect = aspects[i]
      const localizedAspectName = aspect?.localizedAspectName
      if (!localizedAspectName) continue

      const valueStrings = (aspect?.aspectValues ?? [])
        .map(v => v?.localizedValue)
        .filter(v => typeof v === 'string' && v.length > 0)

      writeItems.push(...buildAspectWriteItems({
        categoryTreeId,
        categoryId,
        activeSpecKeyId,
        localizedAspectName,
        aspectValues: valueStrings,
        aspectSortOrder: i,
        aspectConstraint: aspect?.aspectConstraint ?? {},
        logid,
      }))
    }
    await batchWriteItems(dynamo, DDB_TABLES.EBAY.EBAY_ITEMSPECS.NAME, writeItems, logid)
  }
  return addedCount
}



//------------------------------------------------------------------------------
//Modify Categories
//------------------------------------------------------------------------------
async function modifyCategories({ dynamo, diffBody, categoryTreeId, activeSpecKeyId, categorySpecTable, logid }) {
  const modifiedCategoriesList = Array.isArray(diffBody?.modifiedCategories) ? diffBody.modifiedCategories : []
  let modifiedCount = 0
  for (const categoryDelta of modifiedCategoriesList) {
    const categoryId = String(categoryDelta?.categoryId ?? categoryDelta?.category_id ?? '')
    if (!categoryId) continue
    modifiedCount += 1

    const pkValue = `${categoryTreeId}#${activeSpecKeyId}#${categoryId}`

    //------------------------------------------------------------------------------
    //Remove aspects that are no longer present in the category
    //------------------------------------------------------------------------------
    const removedAspects = Array.isArray(categoryDelta.removedAspects) ? categoryDelta.removedAspects.map(String) : []
    for (const removedAspect of removedAspects) {
      if (!removedAspect) continue

      const itemsToDelete = await queryCategoryItem({ dynamo, tableName: categorySpecTable, pkValue, skValue: removedAspect })
      if (itemsToDelete && itemsToDelete.length > 0) {
        await deleteAspectItems({
          dynamo,
          tableName: categorySpecTable,        
          pkValue,
          existingItems: itemsToDelete,
          logid,
        })
      }
    }

    //------------------------------------------------------------------------------
    //Add new aspects to a category
    //------------------------------------------------------------------------------
    const newAspects = Array.isArray(categoryDelta?.newAspects) ? categoryDelta.newAspects : []
    if (newAspects.length > 0){
      let writeItems = [] 
      for (let aspectIndex = 0; aspectIndex < newAspects.length; aspectIndex++) {

        const aspect = newAspects[aspectIndex]
        const localizedAspectName = aspect?.localizedAspectName
        if (!localizedAspectName) continue

        const valueStrings = (aspect?.aspectValues ?? [])
          .map(v => v?.localizedValue)
          .filter(v => typeof v === 'string' && v.length > 0)

        writeItems.push(...buildAspectWriteItems({
          categoryTreeId,
          categoryId,
          activeSpecKeyId,
          localizedAspectName,
          aspectValues: valueStrings,
          aspectSortOrder: aspectIndex,
          aspectConstraint: aspect?.aspectConstraint ?? {},
          logid,
        }))
      }
      await batchWriteItems(dynamo, DDB_TABLES.EBAY.EBAY_ITEMSPECS.NAME, writeItems, logid)
    }


    //------------------------------------------------------------------------------
    //Modify existing aspects in a category
    //------------------------------------------------------------------------------
    const modifiedAspects = Array.isArray(categoryDelta.modifiedAspects) ? categoryDelta.modifiedAspects : []
    for (const modifiedAspect of modifiedAspects) {
      let writeItems = []

      const localizedAspectName = String(modifiedAspect?.localizedAspectName ?? '')
      if (!localizedAspectName) continue

      const newAspectConstraint = modifiedAspect?.modifiedConstraint ?? {}
      const newAspectValues = modifiedAspect?.newAspectValues ?? []
      const removedAspectValues = modifiedAspect?.removedAspectValues ?? []
      const existingItems = await queryCategoryItem({ dynamo, tableName: categorySpecTable, pkValue, skValue: localizedAspectName })
     
      if (!existingItems || existingItems.length === 0) {
        continue
      }

      //There may be multiple items for the same aspect name if the aspect values exceed the max char limit.
      const allAspectValues = []
      for (const item of existingItems) {
        if (Array.isArray(item?.aspectValues)) {
          allAspectValues.push(...item.aspectValues)
        }
      }
                
      const finalValues = [
        ...allAspectValues.filter((v) => !removedAspectValues.includes(v)),
        ...newAspectValues,
      ]

      const requiresRewrite = removedAspectValues.length > 0 || newAspectValues.length > 0 || Object.keys(newAspectConstraint).length > 0
      if (!requiresRewrite) {
        continue
      }

      //Remove the old aspect items before writing the new ones. This is necessary because the aspect values may have changed and we want to avoid duplicates.
      await deleteAspectItems({ dynamo, tableName: categorySpecTable, pkValue, existingItems: existingItems, logid })

      //We can use the aspect_sort_order from the first existing item for the new items. 
      const aspectSortOrder = existingItems[0]?.aspect_sort_order ?? 0
      const aspectConstraint = Object.keys(newAspectConstraint).length > 0 ? newAspectConstraint : existingItems[0]?.aspectConstraint


      writeItems.push(...buildAspectWriteItems({
        categoryTreeId,
        categoryId,
        activeSpecKeyId,
        localizedAspectName,
        aspectValues: finalValues,
        aspectSortOrder,
        aspectConstraint,
        logid,
      }))

      await batchWriteItems(dynamo, DDB_TABLES.EBAY.EBAY_ITEMSPECS.NAME, writeItems, logid)
    }
  }
  return modifiedCount
}