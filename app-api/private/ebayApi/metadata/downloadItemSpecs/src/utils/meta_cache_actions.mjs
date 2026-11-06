
import { DDB_TABLES, CONSTANTS } from '/opt/nodejs/core_module/index.mjs'
import { S3Client, PutObjectCommand, sharedConfig, SQSClient, SendMessageCommand, BatchClient, SubmitJobCommand } from '/opt/nodejs/awsSdk_module/index.mjs'
import { logger } from '../utils/logger.mjs'

export async function downloadItemSpecs({ siteID, ebayAPI, dynamo, metadataBucket, action = 'incremental' }) {

  let categoryTreeId = null

  const DEFAULT_ACTIVE_SPEC_KEY_ID = process.env.DEFAULT_ACTIVE_SPEC_KEY_ID || 1
  const FAILED_STATUS = CONSTANTS.EBAY_METADATA.ITEM_SPEC_DOWNLOAD_STATUS.FAILED
  const DOWNLOADED_STATUS = CONSTANTS.EBAY_METADATA.ITEM_SPEC_DOWNLOAD_STATUS.DOWNLOADED
  const DOWNLOADING_STATUS = CONSTANTS.EBAY_METADATA.ITEM_SPEC_DOWNLOAD_STATUS.DOWNLOADING
  const UPDATE_EBAY_ITEMSPECS_QUEUE = process.env.UPDATE_EBAY_ITEMSPECS_QUEUE || null

  if (!metadataBucket) {
    throw {
      message: 'Missing S3 metadata bucket',
      errors: { debug: 'metadataBucket is required' },
    }
  }

  try {
    if (siteID === null) {
      logger('No siteID provided, cannot process item spec downloads')
      throw {
        message: 'Missing siteID parameter',
        errors: { debug: 'siteID is required' },
      }

    }

    const result = await getSiteIndex({ siteID, dynamo })
    if (result?.sites.length === 0) {
      logger('No site found to process for item spec downloads for siteID ' + siteID)
      throw {
        message: 'No site found for siteID ' + siteID,
        errors: { debug: 'No site found for siteID ' + siteID },
      }

    }

    const siteToUpdate = result.sites[0]
    categoryTreeId = siteToUpdate?.data_MarketplaceDetails?.category_tree_id ?? null
    if (!categoryTreeId) {
      logger('No category_tree_id found for site_id ' + siteID)
      throw {
        message: 'No category_tree_id found for siteID ' + siteID,
        errors: { debug: 'No category_tree_id found for siteID ' + siteID },
      }
    }



    const s3 = new S3Client(sharedConfig)
    const now = new Date()
    const nowIso = now.toISOString()
    const checkNow = new Date()
    const dateToken = String(now.getUTCFullYear()) + String(now.getUTCMonth() + 1).padStart(2, '0') + String(now.getUTCDate()).padStart(2, '0')
    const defaultEmptyDate = '0000-00-00T00:00:00.000Z'

    const tableParams = {
      TableName: DDB_TABLES.EBAY.EBAY_ITEMSPEC_DETAILS.NAME,
      Key: { category_tree_id: categoryTreeId },
    }
    const itemSpecRow = (await dynamo.get(tableParams))?.Item ?? null
    const lastChecked = itemSpecRow?.last_itemspec_data_checked ?? null
    const activeItemspecVersion = itemSpecRow?.active_itemspec_version ?? '0'
    const currentStatus = itemSpecRow?.itemspec_update_status ?? null
    const lastestSpecKeyId = Number(itemSpecRow?.latest_spec_key_id ?? DEFAULT_ACTIVE_SPEC_KEY_ID)
    const itemspecRetryCount = itemSpecRow?.itemspec_retry_count ?? 0
    const isFullAction = action === 'full'
    const retryEligible = itemspecRetryCount < 2 && currentStatus === FAILED_STATUS && !isFullAction
    const hasCheckedOlderThan24h = !lastChecked || new Date(lastChecked).getTime() + 24 * 60 * 60 * 1000 <= checkNow.getTime()
    const isAlreadyDownloading = currentStatus === DOWNLOADING_STATUS
    const shouldDownload = retryEligible || ((hasCheckedOlderThan24h || isFullAction) && !isAlreadyDownloading)

    if (!shouldDownload) {
      logger('Item specs already checked within 24h or currently downloading for category_tree_id ' + categoryTreeId)
      return {
        siteID,
        categoryTreeId,
        success: false,
        message: 'Item specs already checked within 24h or currently downloading',
      }
    }
    const versionToken = `${categoryTreeId}_v${dateToken}`
    const s3Key = `itemspecs/${versionToken}.gz`

    logger('Fetching item specs for category_tree_id ' + categoryTreeId)

    const updateParams = {
      TableName: DDB_TABLES.EBAY.EBAY_ITEMSPEC_DETAILS.NAME,
      Key: { category_tree_id: categoryTreeId },
      UpdateExpression: `SET last_itemspec_data_checked = :last_itemspec_data_checked,
        last_itemspec_data_downloaded = if_not_exists(last_itemspec_data_downloaded, :last_itemspec_data_downloaded),
        ebay_itemspec_version = :ebay_itemspec_version,
        itemspec_update_status = :itemspec_update_status,
        itemspec_retry_count = :itemspec_retry_count,
        active_itemspec_version = if_not_exists(active_itemspec_version, :active_itemspec_version),
        last_itemspec_data_updated = if_not_exists(last_itemspec_data_updated, :default_last_itemspec_data_updated),
        latest_spec_key_id = :default_latest_spec_key_id`,
      ExpressionAttributeValues: {
        ':last_itemspec_data_checked': nowIso,
        ':itemspec_retry_count': retryEligible ? itemspecRetryCount + 1 : 0,
        ':last_itemspec_data_downloaded': defaultEmptyDate,
        ':ebay_itemspec_version': '0',
        ':itemspec_update_status': DOWNLOADING_STATUS,
        ':active_itemspec_version': '0',
        ':default_last_itemspec_data_updated': defaultEmptyDate,
        ':default_latest_spec_key_id': isFullAction ? lastestSpecKeyId + 1 : lastestSpecKeyId,
      },
    }
    await dynamo.update(updateParams)
    logger('Getting item specs from eBay for category_tree_id ' + categoryTreeId)

    
    const itemSpecData = await ebayAPI.commerce.taxonomy.fetchItemAspects(categoryTreeId)
    if (!itemSpecData) {
      throw {
        message: 'No item spec data returned from eBay for category_tree_id ' + categoryTreeId,
        errors: { debug: 'No item spec data returned from eBay for category_tree_id ' + categoryTreeId },
      }
    }

    await s3.send(new PutObjectCommand({
      Bucket: metadataBucket,
      Key: s3Key,
      Body: itemSpecData,
      ContentType: 'application/gzip',
    }))

    const successParams = {
      TableName: DDB_TABLES.EBAY.EBAY_ITEMSPEC_DETAILS.NAME,
      Key: { category_tree_id: categoryTreeId },
      UpdateExpression: 'SET last_itemspec_data_downloaded = :last_itemspec_data_downloaded,  ebay_itemspec_version = :ebay_itemspec_version,           itemspec_update_status = :itemspec_update_status, itemspec_retry_count = :itemspec_retry_count',
      ExpressionAttributeValues: {
        ':last_itemspec_data_downloaded': nowIso,
        ':ebay_itemspec_version': versionToken,
        ':itemspec_update_status': DOWNLOADED_STATUS,
        ':itemspec_retry_count': 0,
      },
    }
    await dynamo.update(successParams)
    logger('Saved item specs to S3 and updated DDB for category_tree_id ' + categoryTreeId)

    // Full updates go in the SQS queue for processing.
    if (action === 'full') {
      const sqs = new SQSClient(sharedConfig)
      const messageBody = JSON.stringify({ action: 'fullRecacheItemSpecs', s3Key: s3Key, jobId: `${categoryTreeId}_${now.getTime()}` })
      await sqs.send(new SendMessageCommand({
        QueueUrl: UPDATE_EBAY_ITEMSPECS_QUEUE,
        MessageBody: messageBody,
      }))
      logger('Sent message to SQS queue for category_tree_id ' + categoryTreeId)
    }

    // If this is an incremental update, trigger an AWS Batch job to compare the new item specs with the existing active version.
    if (action === 'incremental') {
      const batchQueue = process.env.BATCH_VTK_TAXONOMY_QUEUE
      const batchDefinition = process.env.BATCH_VTK_TAXONOMY_DEFINITION

      const prevFileKey = activeItemspecVersion !== '0' ? `itemspecs/${activeItemspecVersion}.gz` : null
      const newFileKey = s3Key

      if (activeItemspecVersion === '0') {
        logger('Skipping incremental Batch job because active_itemspec_version is 0 and requires a full update first for category_tree_id ' + categoryTreeId)
      } else {
        const batchClient = new BatchClient(sharedConfig)
        const batchJobName = `taxonomy-compare-${categoryTreeId}-${dateToken}`
        const batchParams = {
          jobName: batchJobName,
          jobQueue: batchQueue,
          jobDefinition: batchDefinition,
          containerOverrides: {
            environment: [
              { name: 'CATEGORY_TREE_ID', value: String(categoryTreeId) },
              { name: 'PREV_FILE_KEY', value: prevFileKey },
              { name: 'NEW_FILE_KEY', value: newFileKey },
              { name: 'OUTPUT_KEY', value: `${activeItemspecVersion}_${dateToken}` },
              { name: 'EBAY_ENV', value: 'PRODUCTION' },
            ],
          },
        }

        await batchClient.send(new SubmitJobCommand(batchParams))
        logger('Started Batch job for incremental item spec compare for category_tree_id ' + categoryTreeId)
      }
    }

    return {
      siteID,
      categoryTreeId,
      success: true,
      message: 'Item specs downloaded successfully',
    }
  } catch (err) {
    logger('Error retrieving item specs for category_tree_id ' + categoryTreeId + ': ' + err.message)
    logger(JSON.stringify(err))

    //We can only log if we have a categoryTreeId, otherwise we can't update the DDB table.
    if (categoryTreeId) {
      const failureParams = {
        TableName: DDB_TABLES.EBAY.EBAY_ITEMSPEC_DETAILS.NAME,
        Key: { category_tree_id: categoryTreeId },
        UpdateExpression: 'SET itemspec_update_status = :itemspec_update_status',
        ExpressionAttributeValues: {
          ':itemspec_update_status': FAILED_STATUS,
        },
      }
      await dynamo.update(failureParams)
    }
    return {
      siteID,
      categoryTreeId,
      success: false,
      message: 'Error retrieving item specs: ' + err.message,
    }
  }
}

//Helper functions to get the index of one of more sites
export async function getSiteIndex({ siteID, dynamo }) {
  //Query the ACTIVE_SITE GSI (PK: active_site, SK: last_site_details_update)
  //Returns only projected fields (site_id, details_index) - avoids fetching large site data
  const params = {
    TableName: DDB_TABLES.EBAY.EBAY_SITE_DETAILS.NAME,
    IndexName: DDB_TABLES.EBAY.EBAY_SITE_DETAILS.GSI.ACTIVE_SITE,
    KeyConditionExpression: 'active_site = :active',
    ExpressionAttributeValues: { ':active': 'true' },
  }

  //Check that site is not null, if it is null we will fetch all sites, otherwise we will filter by site_id
  if (siteID !== null) {
    logger('Fetching site details for siteID: ' + siteID)
    params.FilterExpression = 'site_id = :site_id'
    params.ExpressionAttributeValues[':site_id'] = Number(siteID)
  } else {
    logger('Fetching site details for all sites')
  }

  const data = await dynamo.query(params)
  const sites = data.Items || []
  return { sites }
}

