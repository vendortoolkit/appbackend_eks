
import { DDB_TABLES, CONSTANTS } from '/opt/nodejs/core_module/index.mjs'
import { S3Client, PutObjectCommand, sharedConfig, SQSClient, SendMessageCommand } from '/opt/nodejs/awsSdk_module/index.mjs'
import { logger } from '../utils/logger.mjs'
import { EBAY_MARKETPLACE_BY_SITE_ID } from '../data/ebayMarketplaces.mjs'


//Get the barebones placeholder ebay site data, ready for the next call which will get full site data
export async function updateSiteData({ ebayAPI, dynamo }) {
  //Get the eBay Site Details using GeteBayDetails call
  try {
    //Get the site details from eBay
    const response = await ebayAPI.trading.GeteBayDetails({ DetailName: 'SiteDetails' })
    const siteDetails = response?.SiteDetails || []
    const now = new Date().toISOString()

    for (let i = 0; i < siteDetails.length; i++) {
      const params = {
        TableName: DDB_TABLES.EBAY.EBAY_SITE_DETAILS.NAME,
        Key: { site_id: siteDetails[i].SiteID },
        UpdateExpression: 'SET #site = :site, last_site_details_update = :last_site_details_update, last_update = :last_update, active_site = if_not_exists(active_site, :active_site)',
        ExpressionAttributeNames: { '#site': 'site' },
        ExpressionAttributeValues: {
          ':site': siteDetails[i].Site,
          ':last_update': now,
          ':last_site_details_update': '000-00-00T00:00:00.000Z',
          ':active_site': 'true',
        },
      }
      await dynamo.update(params)
    }
    return { message: 'Site list updated successfully' }
  } catch (err) {
    logger('Error updating site list: ' + err.message)
    throw {
      message: 'Unable to update site list',
      errors: { debug: err.message },
      restStatus: 400,
    }
  }
}

//Get the index site data for each ebay site based on the data loaded in updateSiteData
export async function buildSiteIndex({ ebayAPI, dynamo }) {
  try {
    logger('Building site index')
    const sitesToUpdate = await getSiteIndex({ siteID: null, dynamo })

    //For each site get the index data from eBay and update the DDB record
    for (let i = 0; i < sitesToUpdate.length; i++) {
      const response = await ebayAPI.trading.GeteBayDetails({}, { headers: { 'X-EBAY-API-SITEID': sitesToUpdate[i].site_id } })
      logger('Got site details for site_id ' + sitesToUpdate[i].site_id)

      //Build the update expression for the DDB record based on the response from eBay,
      //We only want to add keys with the "Detail" in the name
      const detailsForDB = []
      for (let detailkey in response) {
        if (detailkey.includes('Details')) {
          detailsForDB.push(detailkey)
        }
      }
      const marketplaceDetails = EBAY_MARKETPLACE_BY_SITE_ID[sitesToUpdate[i].site_id] ?? null

      //Get the category tree id from ebay for this marketplace id
      if (marketplaceDetails?.marketplace_id) {
        const { ebayCategoryTreeId } = await getCatTreeFromMarketplaceId({ ebayAPI, marketplaceID: marketplaceDetails?.marketplace_id })
        marketplaceDetails.category_tree_id = ebayCategoryTreeId
      }

      //Add to the eBay Site Details table
      //Set active_site = 'true' so this record appears in the ACTIVE_SITE GSI
      const params = {
        TableName: DDB_TABLES.EBAY.EBAY_SITE_DETAILS.NAME,
        Key: { site_id: sitesToUpdate[i].site_id },
        UpdateExpression: 'SET details_index = :details_index, data_MarketplaceDetails = :data_MarketplaceDetails',
        ExpressionAttributeValues: {
          ':details_index': detailsForDB,
          ':data_MarketplaceDetails': marketplaceDetails,
        },
      }
      await dynamo.update(params)
    }
    return { message: 'Site index updated successfully' }
  } catch (err) {
    logger('Error building site index: ' + err.message)
    throw {
      message: 'Unable to update site index',
      errors: { debug: err.message },
      restStatus: 400,
    }
  }
}


//Check if the category tree for each site needs to be updated by comparing the version number in eBay with the version number in DDB, if they are different flag this category tree for update by setting category_update_status to "required"
//Optional siteID parameter to only get a single category tree, if not provided it will update all category trees
export async function scanCategories({ ebayAPI, dynamo, siteID = null }) {
  try {

    const sitesToUpdate = await getSiteIndex({ siteID, dynamo })

    //Get the category tree id from ebay for each site
    for (let i = 0; i < sitesToUpdate.length; i++) {

      const marketplaceID = sitesToUpdate[i]?.data_MarketplaceDetails?.marketplace_id ?? null
      if (!marketplaceID) {
        logger('No marketplace details found for site_id ' + sitesToUpdate[i].site_id + ' skipping category update')
        continue
      }

      //Get the category tree id and version from ebay for this marketplace id
      const { ebayCategoryTreeId, ebayCategoryTreeVersion } = await getCatTreeFromMarketplaceId({ ebayAPI, marketplaceID: marketplaceID })

      if (!ebayCategoryTreeId || !ebayCategoryTreeVersion) {
        logger('No category tree id or version found for site_id ' + sitesToUpdate[i].site_id + ' skipping category update')
        continue
      }

      //Lookup the current category tree version in DDB and only update if the version has changed
      const params = {
        TableName: DDB_TABLES.EBAY.EBAY_CATEGORY_DETAILS.NAME,
        KeyConditionExpression: 'category_tree_id = :category_tree_id',
        ExpressionAttributeValues: { ':category_tree_id': ebayCategoryTreeId },
      }
      const data = await dynamo.query(params)
      const currentVersion = data?.Items?.[0]?.ebay_tree_version ?? null

      if (currentVersion === ebayCategoryTreeVersion) {
        logger('Category tree version is the same as ' + currentVersion + ' skipping category update')
        continue
      }

      logger('Category tree version has changed for site_id ' + sitesToUpdate[i].site_id + ' current version: ' + currentVersion + ' new version: ' + ebayCategoryTreeVersion)

      //No match so update the database
      const now = new Date().toISOString()
      const updateParams = {
        TableName: DDB_TABLES.EBAY.EBAY_CATEGORY_DETAILS.NAME,
        Key: { category_tree_id: ebayCategoryTreeId },
        UpdateExpression: 'SET #created_at = if_not_exists(#created_at, :created_at), #last_category_data_check = :last_category_data_check, #ebay_tree_version = :ebay_tree_version, #category_update_status = :category_update_status',
        ExpressionAttributeNames: { '#created_at': 'created_at', '#last_category_data_check': 'last_category_data_check', '#ebay_tree_version': 'ebay_tree_version', '#category_update_status': 'category_update_status' },
        ExpressionAttributeValues: {
          ':created_at': now,
          ':last_category_data_check': now,
          ':ebay_tree_version': ebayCategoryTreeVersion,
          ':category_update_status': 'required',
        },
      }
      await dynamo.update(updateParams)
      logger('Flagged category tree ' + ebayCategoryTreeId + ' for update. Current version: ' + currentVersion + ' New version: ' + ebayCategoryTreeVersion)
    }
    return { message: 'Category checks executed successfully' }

  } catch (err) {
    logger('Error scanning category tree versions: ' + err.message)
    throw {
      message: 'Unable to update category checks',
      errors: { debug: err.message },
      restStatus: 400,
    }
  }
}



//Check vtk_ebay_category_details table for any category trees that are flagged as "required" in the category_update_status field, if there are any then get the full category tree data from eBay and update the record in DDB with the new data and set category_update_status to "completed"
export async function updateCategoryTree({ ebayAPI, dynamo }) {
  try {

    //Scan the  vtk_ebay_category_details table for any records with category_update_status = "required"
    const params = {
      TableName: DDB_TABLES.EBAY.EBAY_CATEGORY_DETAILS.NAME,
      FilterExpression: 'category_update_status = :required',
      ExpressionAttributeValues: { ':required': 'required' },
    }
    const data = await dynamo.scan(params)
    const categoriesToUpdate = data?.Items || []
    logger('Found ' + categoriesToUpdate.length + ' category trees to update')

    if (categoriesToUpdate.length === 0) {
      logger('No category trees to update')
      return { message: 'No category trees to update' }
    }

    //We only want to run 1 tree at a time to avoid hitting lambda timeouts, others will be picked up in the next scheduled run of this function
    const categoryToUpdate = categoriesToUpdate[0]

    //Get the category tree id and version from ebay for this marketplace id
    const ebayCategoryTreeId = categoryToUpdate.category_tree_id
    const ebayCategoryTreeVersion = categoryToUpdate.ebay_tree_version

    //Flag as inprogress to avoid multiple lambdas trying to update the same tree
    const now = new Date().toISOString()
    const updateParams = {
      TableName: DDB_TABLES.EBAY.EBAY_CATEGORY_DETAILS.NAME,
      Key: { category_tree_id: ebayCategoryTreeId },
      UpdateExpression: 'SET #category_update_status = :category_update_status',
      ExpressionAttributeNames: { '#category_update_status': 'category_update_status' },
      ExpressionAttributeValues: {
        ':category_update_status': 'in_progress',
      },
    }
    await dynamo.update(updateParams)
    logger('Flagged category tree ' + ebayCategoryTreeId + ' as in progress for update')

    //Get the full category tree data from eBay using the taxonomy API
    const categoryTreeData = await ebayAPI.commerce.taxonomy.getCategoryTree(ebayCategoryTreeId)

    if (!categoryTreeData?.rootCategoryNode) {
      logger('No category tree data found for category tree id ' + ebayCategoryTreeId + ' skipping category update')
      return
    }

    const categoryItems = []
    logger('Parsing category tree data for category tree id ' + ebayCategoryTreeId)

    function parseCategoryNodes(nodes, parentId = 'null') {
      for (let node of nodes) {
        const categoryId = node?.category?.categoryId
        const categoryName = node?.category?.categoryName
        if (!categoryId || !categoryName) {
          continue
        }

        const categoryTreeNodeLevel = Number(node?.categoryTreeNodeLevel ?? 0)
        const leafCategoryTreeNode = node?.leafCategoryTreeNode === true || node?.leafCategoryTreeNode === 'true'

        categoryItems.push({
          PutRequest: {
            Item: {
              category_tree_id: ebayCategoryTreeId,
              category_tree_version: ebayCategoryTreeVersion,
              category_id: categoryId,
              'category_tree_version#category_id': `${ebayCategoryTreeVersion}#${categoryId}`,
              parent_id: `${parentId}`,
              category_name: categoryName,
              category_tree_node_level: categoryTreeNodeLevel,
              leaf_category_tree_node: leafCategoryTreeNode,
            },
          },
        })

        if (Array.isArray(node?.childCategoryTreeNodes) && node.childCategoryTreeNodes.length > 0) {
          parseCategoryNodes(node.childCategoryTreeNodes, categoryId)
        }
      }
    }

    if (categoryTreeData?.rootCategoryNode) {
      parseCategoryNodes([categoryTreeData.rootCategoryNode])
    }

    //Batch write to DDB in batches of 25
    while (categoryItems.length > 0) {
      logger('Writing batch of category items to DDB for category tree id ' + ebayCategoryTreeId + ' remaining items: ' + categoryItems.length)
      const batch = categoryItems.splice(0, 25)
      const batchParams = {
        RequestItems: {
          [DDB_TABLES.EBAY.EBAY_CATEGORIES.NAME]: batch,
        },
      }
      await dynamo.batchWrite(batchParams)
    }

    //Update the category tree record with the new version and set category_update_status to "completed"
    const finalUpdateParams = {
      TableName: DDB_TABLES.EBAY.EBAY_CATEGORY_DETAILS.NAME,
      Key: { category_tree_id: ebayCategoryTreeId },
      UpdateExpression: 'SET  #last_category_data_update = :last_category_data_update, #category_update_status = :category_update_status, #active_tree_version = :active_tree_version, #cleanup_pending = :cleanup_pending ',
      ExpressionAttributeNames: { '#last_category_data_update': 'last_category_data_update', '#category_update_status': 'category_update_status', '#active_tree_version': 'active_tree_version', '#cleanup_pending': 'cleanup_pending' },
      ExpressionAttributeValues: {
        ':last_category_data_update': now,
        ':category_update_status': 'completed',
        ':active_tree_version': ebayCategoryTreeVersion,
        ':cleanup_pending': 'true',
      },
    }
    await dynamo.update(finalUpdateParams)
    logger('Completed category tree update for category tree id ' + ebayCategoryTreeId + ' version ' + ebayCategoryTreeVersion)

    return { message: 'Category checks executed successfully' }

  } catch (err) {
    logger('Error updating category tree: ' + err.message)
    throw {
      message: 'Unable to update category checks',
      errors: { debug: err.message },
      restStatus: 400,
    }
  }
}


//Get an eBay category tree for a specific marketplace, requires the marketplace ID
async function getCatTreeFromMarketplaceId({ ebayAPI, marketplaceID }) {
  try {

    //Get the category tree id from eBay using the taxonomy API
    const response = await ebayAPI.commerce.taxonomy.getDefaultCategoryTreeId(marketplaceID)
    const ebayCategoryTreeId = response?.categoryTreeId
    const ebayCategoryTreeVersion = response?.categoryTreeVersion

    return { ebayCategoryTreeId, ebayCategoryTreeVersion }

  } catch (err) {
    logger('Error getting category tree for marketplaceID ' + marketplaceID + ': ' + err.message)
    throw {
      message: 'Unable to get category tree for marketplaceID ' + marketplaceID,
      errors: { debug: err.message },
      restStatus: 400,
    }
  }
}

//Get the full site data for each ebay site based on the data stored in vtk_ebay_site_details
//Opional siteid parameter to only update a single site, if not provided it will update all sites
export async function updateSiteDetails({ ebayAPI, siteID = null, dynamo }) {
  try {

    const sitesToUpdate = await getSiteIndex({ siteID, dynamo })
    if (sitesToUpdate.length === 0) {
      logger('No sites found to update')
      return { message: 'No sites found to update' }
    }

    //For each site get the full details from eBay and update the DDB record
    for (let i = 0; i < sitesToUpdate.length; i++) {

      //Loop through the details index and get the data for each detail
      //This will be the key we pass to ebay in GeteBayDetails
      for (let key of sitesToUpdate[i].details_index) {

        const response = await ebayAPI.trading.GeteBayDetails({ DetailName: key }, { headers: { 'X-EBAY-API-SITEID': sitesToUpdate[i].site_id } })
        logger('Retrieved site details for key ' + key + ' site_id ' + sitesToUpdate[i].site_id)

        //Save this data to DDB in a new field with the same name as the key but with "_data" at the end, this is to avoid issues with reserved words in DDB and to keep the original data structure from eBay separate from our own fields
        const updateExpressions = []
        const expressionAttributeNames = {}
        const expressionAttributeValues = {}
        updateExpressions.push('#DetailName = :DetailName')
        expressionAttributeNames['#DetailName'] = 'data_' + key
        expressionAttributeValues[':DetailName'] = response[key]

        //Add to the eBay Site Details table
        const params = {
          TableName: DDB_TABLES.EBAY.EBAY_SITE_DETAILS.NAME,
          Key: { site_id: sitesToUpdate[i].site_id },
          UpdateExpression: `SET ${updateExpressions.join(', ')}`,
          ExpressionAttributeNames: expressionAttributeNames,
          ExpressionAttributeValues: expressionAttributeValues,
        }

        await dynamo.update(params)
        logger('Saved site details for key ' + key + ' site_id ' + sitesToUpdate[i].site_id)
      }

      //Update the last_site_details_update field to show when we last updated the details for this site,
      const now = new Date().toISOString()
      const params = {
        TableName: DDB_TABLES.EBAY.EBAY_SITE_DETAILS.NAME,
        Key: { site_id: sitesToUpdate[i].site_id },
        UpdateExpression: 'SET  last_site_details_update = :last_site_details_update',
        ExpressionAttributeValues: {
          ':last_site_details_update': now,
        },
      }
      await dynamo.update(params)
      logger('Successfully updated site details for site_id ' + sitesToUpdate[i].site_id)
    }
    return { message: 'Site details updated successfully' }
  } catch (err) {
    throw {
      message: 'Unable to update site details',
      errors: { debug: err.message },
      restStatus: 400,
    }
  }
}

export async function downloadItemSpecs({ ebayAPI, dynamo, metadataBucket, action = 'incremental', UPDATE_EBAY_ITEMSPECS_QUEUE = null }) {
  try {
    if (!metadataBucket) {
      throw {
        message: 'Missing S3 metadata bucket',
        errors: { debug: 'metadataBucket is required' },
        restStatus: 400,
      }
    }

    const sitesToUpdate = await getSiteIndex({ siteID: null, dynamo })
    if (sitesToUpdate.length === 0) {
      logger('No sites found to process for item spec downloads')
      return { message: 'No sites found to process for item spec downloads' }
    }

    const MAX_SITES_PER_RUN = process.env.MAX_SITES_PER_RUN ? Number(process.env.MAX_SITES_PER_RUN) : 1
    const MAX_RETRY_COUNT = process.env.MAX_RETRY_COUNT ? Number(process.env.MAX_RETRY_COUNT) : 3
    const DEFAULT_ACTIVE_SPEC_KEY_ID = process.env.DEFAULT_ACTIVE_SPEC_KEY_ID || '0'
    const RETRY_STATUS = CONSTANTS.EBAY_METADATA.ITEM_SPEC_DOWNLOAD_STATUS.RETRY
    const FAILED_STATUS = CONSTANTS.EBAY_METADATA.ITEM_SPEC_DOWNLOAD_STATUS.FAILED
    const DOWNLOADED_STATUS = CONSTANTS.EBAY_METADATA.ITEM_SPEC_DOWNLOAD_STATUS.DOWNLOADED
    const DOWNLOADING_STATUS = CONSTANTS.EBAY_METADATA.ITEM_SPEC_DOWNLOAD_STATUS.DOWNLOADING


    const s3 = new S3Client(sharedConfig)
    const now = new Date()
    const nowIso = now.toISOString()
    const checkNow = new Date()
    const dateToken = String(now.getUTCFullYear()) + String(now.getUTCMonth() + 1).padStart(2, '0') + String(now.getUTCDate()).padStart(2, '0')
    const defaultEmptyDate = '0000-00-00T00:00:00.000Z'

    let downloaded = 0
    let skipped = 0
    let failed = 0

    for (let i = 0; i < sitesToUpdate.length; i++) {
      const categoryTreeId = sitesToUpdate[i]?.data_MarketplaceDetails?.category_tree_id ?? null
      if (!categoryTreeId) {
        logger('No category_tree_id found for site_id ' + sitesToUpdate[i]?.site_id + ' skipping')
        skipped++
        continue
      }

      const tableParams = {
        TableName: DDB_TABLES.EBAY.EBAY_ITEMSPEC_DETAILS.NAME,
        Key: { category_tree_id: categoryTreeId },
      }
      const itemSpecRow = (await dynamo.get(tableParams))?.Item ?? null
      const lastChecked = itemSpecRow?.last_itemspec_data_checked ?? null
      const currentStatus = itemSpecRow?.itemspec_update_status ?? null
      const retryCount = Number(itemSpecRow?.itemspec_retry_count ?? 0)
      const isRetryCandidate = (currentStatus === RETRY_STATUS) && retryCount < MAX_RETRY_COUNT
      const shouldDownload = (isRetryCandidate || !lastChecked || new Date(lastChecked).getTime() + 24 * 60 * 60 * 1000 <= checkNow.getTime()) && currentStatus !== DOWNLOADING_STATUS

      if (!shouldDownload) {
        logger('Item specs already checked within 24h or currently downloading for category_tree_id ' + categoryTreeId)
        skipped++
        continue
      }

      const versionToken = `${categoryTreeId}_v${dateToken}`
      const s3Key = `itemspecs/${versionToken}.gz`

      try {
        logger('Fetching item specs for category_tree_id ' + categoryTreeId)

        const updateParams = {
          TableName: DDB_TABLES.EBAY.EBAY_ITEMSPEC_DETAILS.NAME,
          Key: { category_tree_id: categoryTreeId },
          UpdateExpression: 'SET last_itemspec_data_checked = :last_itemspec_data_checked, last_itemspec_data_downloaded = if_not_exists(last_itemspec_data_downloaded, :last_itemspec_data_downloaded), ebay_itemspec_version = if_not_exists(ebay_itemspec_version, :ebay_itemspec_version), itemspec_update_status = :itemspec_update_status, itemspec_retry_count = if_not_exists(itemspec_retry_count, :itemspec_retry_count), active_itemspec_version = if_not_exists(active_itemspec_version, :active_itemspec_version), last_itemspec_data_updated = if_not_exists(last_itemspec_data_updated, :default_last_itemspec_data_updated), active_spec_key_id = if_not_exists(active_spec_key_id, :default_active_spec_key_id)',
          ExpressionAttributeValues: {
            ':last_itemspec_data_checked': nowIso,
            ':last_itemspec_data_downloaded': defaultEmptyDate,
            ':ebay_itemspec_version': '0',
            ':itemspec_update_status': DOWNLOADING_STATUS,
            ':itemspec_retry_count': 0,
            ':active_itemspec_version': '0',
            ':default_last_itemspec_data_updated': defaultEmptyDate,
            ':default_active_spec_key_id': DEFAULT_ACTIVE_SPEC_KEY_ID,
          },
        }
        await dynamo.update(updateParams)
        logger('Getting item specs from eBay for category_tree_id ' + categoryTreeId)

        const itemSpecData = await ebayAPI.commerce.taxonomy.fetchItemAspects(categoryTreeId)
        if (!itemSpecData) {
          throw new Error('No item spec data returned from eBay')
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
        downloaded++

        //If this is a full download, send a message to the SQS queue to trigger the update of the item specs in the database
        if (action === 'full' && UPDATE_EBAY_ITEMSPECS_QUEUE) {
          const sqs = new SQSClient(sharedConfig)
          const messageBody = JSON.stringify({ action: 'fullRecacheItemSpecs', s3Key: s3Key })
          await sqs.send(new SendMessageCommand({
            QueueUrl: UPDATE_EBAY_ITEMSPECS_QUEUE,
            MessageBody: messageBody,
          }))
          logger('Sent message to SQS queue for category_tree_id ' + categoryTreeId)
        }

      } catch (err) {
        logger('Error retrieving item specs for category_tree_id ' + categoryTreeId + ': ' + err.message)
        const nextRetryCount = retryCount + 1
        const nextStatus = nextRetryCount < MAX_RETRY_COUNT ? RETRY_STATUS : FAILED_STATUS


        const failureParams = {
          TableName: DDB_TABLES.EBAY.EBAY_ITEMSPEC_DETAILS.NAME,
          Key: { category_tree_id: categoryTreeId },
          UpdateExpression: 'SET itemspec_update_status = :itemspec_update_status, itemspec_retry_count = :itemspec_retry_count',
          ExpressionAttributeValues: {
            ':itemspec_update_status': nextStatus,
            ':itemspec_retry_count': nextRetryCount,
          },
        }
        await dynamo.update(failureParams)
        failed++
      }

      //Have we reached the max sites to process for this run? If so, break the loop
      if (downloaded + failed >= MAX_SITES_PER_RUN) {
        logger('Reached max sites to process for this run: ' + MAX_SITES_PER_RUN)
        break
      }
    }

    return {
      message: 'Item specs download process completed',
      downloaded,
      skipped,
      failed,
    }
  } catch (err) {
    logger('Error downloading item specs: ' + err.message)
    throw {
      message: 'Unable to download item specs',
      errors: { debug: err.message },
      restStatus: 400,
    }
  }
}

//Helper functions to get the index of one of more sites
async function getSiteIndex({ siteID, dynamo }) {
  //Query the ACTIVE_SITE GSI (PK: active_site, SK: last_site_details_update)
  //Returns only projected fields (site_id, details_index) - avoids fetching large site data
  //Incremental: only returns sites where last_site_details_update is before now
  const now = new Date().toISOString()
  const params = {
    TableName: DDB_TABLES.EBAY.EBAY_SITE_DETAILS.NAME,
    IndexName: DDB_TABLES.EBAY.EBAY_SITE_DETAILS.GSI.ACTIVE_SITE,
    KeyConditionExpression: 'active_site = :active AND last_site_details_update < :now',
    ExpressionAttributeValues: { ':active': 'true', ':now': now },
  }

  if (siteID) {
    logger('Fetching site details for siteID: ' + siteID)
    params.FilterExpression = 'site_id = :site_id'
    params.ExpressionAttributeValues[':site_id'] = siteID
  } else {
    logger('Fetching site details for all sites')
  }

  const data = await dynamo.query(params)
  const sites = data.Items || []
  return sites
}


export async function cleanCategoryTrees({ dynamo }) {
  try {

    //Get any categories that need a db clean
    const params = {
      TableName: DDB_TABLES.EBAY.EBAY_CATEGORY_DETAILS.NAME,
      FilterExpression: 'cleanup_pending = :cleanup_pending',
      ExpressionAttributeValues: { ':cleanup_pending': 'true' },
    }
    const data = await dynamo.scan(params)
    const categoriesToClean = data?.Items || []
    logger('Found ' + categoriesToClean.length + ' category trees to clean')

    if (categoriesToClean.length === 0) {
      logger('No category trees to clean')
      return { message: 'No category trees to clean' }
    }

    //We only want to run 1 tree at a time to avoid hitting lambda timeouts, others will be picked up in the next scheduled run of this function
    const categoryToClean = categoriesToClean[0]
    const categoryTreeVersion = categoryToClean.active_tree_version - 2 //We want to keep the current and previous version of the tree just in case, so we set the version to clean as 2 versions behind the active version
    const categoryTreeId = categoryToClean.category_tree_id

    const result = await deleteCategoryTree({ categoryTreeId, categoryTreeVersion })

    //Update the category tree record to set cleanup_pending to false so we don't keep trying to clean this tree
    const updateParams = {
      TableName: DDB_TABLES.EBAY.EBAY_CATEGORY_DETAILS.NAME,
      Key: { category_tree_id: categoryTreeId },
      UpdateExpression: 'SET cleanup_pending = :cleanup_pending',
      ExpressionAttributeValues: {
        ':cleanup_pending': 'false',
      },
    }
    await dynamo.update(updateParams)
    logger('Completed cleaning category tree ' + categoryTreeId + ' version ' + categoryTreeVersion)

    return result
  } catch (err) {
    logger('Error deleting category tree data: ' + err.message)
    throw {
      message: 'Unable to delete category tree data',
      errors: { debug: err.message },
      restStatus: 400,
    }
  }
}


async function deleteCategoryTree({ categoryTreeId = null, categoryTreeVersion = null, dynamo }) {
  try {
    if (categoryTreeId == null || categoryTreeVersion == null) {
      throw {
        message: 'categoryTreeId and categoryTreeVersion are required',
        errors: { debug: 'Missing required parameters for deleteCategoryTree' },
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
