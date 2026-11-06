
import { logger } from '../utils/logger.mjs'

//Update the cache job in DynamoDB
export async function updateJobProgress({ jobData, numItemsAdded, DDB_TABLES, dynamo }) {

  const data = {
    user_id: jobData.userId,
    updated_at: jobData.pageStartTime,

  }

  const fields = Object.keys(data)
  const updateExpressions = []
  const expressionAttributeNames = {}
  const expressionAttributeValues = {
    ':zero': 0,
    ':page': new Set([jobData.pageNum]),
    ':numItemsAdded': numItemsAdded,
  }

  for (const field of fields) {
    if (data[field] !== undefined) {
      updateExpressions.push(`#${field} = :${field}`)
      expressionAttributeNames[`#${field}`] = field
      expressionAttributeValues[`:${field}`] = data[field]
    }
  }

  // Add the increment expression for completed_items
  updateExpressions.push('completed_items = if_not_exists(completed_items, :zero) + :numItemsAdded')

  const params = {
    TableName: DDB_TABLES.EBAY.CACHED_LISTINGS_JOBS.NAME,
    Key: { job_id: jobData.jobId },
    UpdateExpression: `SET ${updateExpressions.join(', ')}
    ADD pages_completed :page`,
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues,
  }
  try {
    const result =  dynamo.update(params)
    return result
  } catch (err) {
    const msg = 'Unable to add update Job progress in DynamoDB'
    throw {
      message: msg,
      errors: { debug: err.message },
    }
  }
}


//Helper to add a single item to the cache
export async function addItemtoCache({ item, jobData, DDB_TABLES, dynamo }) {
  //console.log(JSON.stringify(item, null, 2))

  const data = {
    user_id: jobData.userId,
    buy_it_now_price: item.BuyItNowPrice?.value || null,
    category_id_1: item.PrimaryCategory?.CategoryID || null,
    category_id_2: item.SecondaryCategory?.CategoryID || null,
    site: item.Site,  
    end_time: item.ListingDetails.EndTime,  
    start_time: item.ListingDetails.StartTime,  
    store_category_1: item?.Storefront?.StoreCategoryID || null,  
    store_category_2: item?.Storefront?.StoreCategory2ID || null, 
    start_price: item.StartPrice?.value || null,  
    current_price: item.SellingStatus?.CurrentPrice?.value || null,
    currency: item?.Currency || null,
    image_urls: item.PictureDetails?.PictureURL || [], 
    title: item.Title,  
    quantity_available: item.Quantity,
    quantity_sold: item.SellingStatus?.QuantitySold || 0,
    country: item.Country || null,
    view_item_url: item.ListingDetails.ViewItemURL || null,
    last_updated: jobData.pageStartTime,
    listing_duration: item.ListingDuration || null,
    listing_type: item.ListingType || null,
    location: item.Location || null,
    bid_count: item.SellingStatus?.BidCount || 0,
    ship_to_locations: item.ShipToLocations || [],
    watch_count: item.WatchCount || 0,
    updated_by: 'ebayCacheListingsWorker' + jobData.jobId,
  }

  const fields = Object.keys(data)
  const updateExpressions = []
  const expressionAttributeNames = {}
  const expressionAttributeValues = {}

  for (const field of fields) {
    if (data[field] !== undefined) {
      updateExpressions.push(`#${field} = :${field}`)
      expressionAttributeNames[`#${field}`] = field
      expressionAttributeValues[`:${field}`] = data[field]
    }
  }

  const params = {
    TableName: DDB_TABLES.EBAY.CACHED_LISTINGS.NAME,
    Key: { listing_id:  item.ItemID.toString() }, 
    UpdateExpression: `SET ${updateExpressions.join(', ')}`,
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues,
  }
  return dynamo.update(params)
}



//Check if this is a valid job and that the page has not already been run
export async function checkIsValidJob({ pageData, DDB_TABLES, dynamo }) {

  const jobId = pageData.jobId
  const params = {
    TableName: DDB_TABLES.EBAY.CACHED_LISTINGS_JOBS.NAME,
    KeyConditionExpression: 'job_id = :jobId',
    ExpressionAttributeValues: {
      ':jobId': jobId,
    },
    Limit: 1, // Only need to know if any job exists
  }
  logger('Checking for existing job: ' + jobId)

  try {
    const data = await dynamo.query(params)
    // Return the first matching item if found
    if (data?.Items?.length > 0) {
      const existingJob = data.Items[0]
      ///Reject any jobs that are not in processing state
      if (existingJob?.status !== 'processing') {
        logger('Job is not in processing state: ' + jobId)
        return false
      }

      //CHeck if the page is aready done in pages_completed which is a number set
      if (existingJob?.pages_completed && Array.isArray(existingJob.pages_completed)) {
        if (existingJob.pages_completed.includes(pageData.pageNum)) {
          //Page already completed
          logger('Page already completed: ' + pageData.pageNum) 
          return false
        }
      }
      logger('Job ID exists but page not completed yet: ' + jobId) 
      return true
    }
    logger('No existing job found: ' + jobId)
    return false
  } catch (err) {
    throw {
      message: 'Unable to get job_ID status from database',
      errors: { debug: err.message },
    }
  }
}

//Add the results to DynamoDB Log
export async function addToDDBLog({ data, DDB_TABLES, dynamo, completed = false }) {
  //Check the data type, so we can send to the correct log table
  const dbName = completed ? DDB_TABLES.EBAY.CACHED_LISTINGS_LOG.NAME : DDB_TABLES.EBAY.CACHED_LISTINGS_ERROR_LOG.NAME
  const params = {
    TableName: dbName,
    Item: data,
  }
  try {
    await dynamo.put(params)
  } catch (err) {
    throw {
      message: 'Unable to add message to: ' + dbName,
      errors: { debug: err.message },
    }
  }
}

