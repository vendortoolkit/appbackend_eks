import { logger } from '../utils/logger.mjs'

//Get the user account status from the DB
export async function getUserAccountStatus({ userId, DDB_TABLES, dynamo }) {
  const params = {
    TableName: DDB_TABLES.USER.ACCOUNT_STATUS.NAME,
    Key: {
      user_id: userId,
    },
  }
  
  logger('Checking for existing user account: ' + userId)
  
  try {
    const data = await dynamo.get(params)
    
    if (data?.Item) {
      return data.Item
    }
    
    logger('No existing user account found: ' + userId)
    return false
  } catch (err) {
    throw {
      message: 'Unable to get user account status from database',
      errors: { debug: err.message },
    }
  }
}

//Helper to remove a single item from cache
export async function removeCacheItem({ item, DDB_TABLES, dynamo }) {
  const params = {
    TableName: DDB_TABLES.EBAY.CACHED_LISTINGS.NAME,
    Key: { listing_id: item.ItemID.toString() }, 
  }
  
  try {
    await dynamo.delete(params)
    logger('Removed item from cache: ' + item.ItemID)
    return true
  } catch (err) {
    throw {
      message: 'Unable to remove item from cache',
      errors: { debug: err.message },
    }
  }
}

//Helper to add/update a single item Qty in cache
export async function updateCacheItemQty({ item, jobData, DDB_TABLES, dynamo }) {
  const data = {
    quantity_available: (item.Quantity - (item.SellingStatus?.QuantitySold || 0) > 0) ? (item.Quantity - (item.SellingStatus?.QuantitySold || 0)) : 0,
    quantity_sold: item.SellingStatus?.QuantitySold || 0,
    initial_quantity: item.Quantity,
    last_updated: jobData.pageStartTime,
    updated_by: 'ebayPlatformNotificationHook',
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
    Key: { listing_id: item.ItemID.toString() }, 
    UpdateExpression: `SET ${updateExpressions.join(', ')}`,
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues,
  }
  
  try {
    await dynamo.update(params)
    logger('Updated qty cache for item: ' + item.ItemID)
    return true
  } catch (err) {
    throw {
      message: 'Unable to update item qty in cache',
      errors: { debug: err.message },
    }
  }
}

//Helper to add/update a single item in cache
export async function addCacheItem({ item, jobData, DDB_TABLES, dynamo }) {
  const data = {
    user_id: jobData.userId,
    buy_it_now_price: item.BuyItNowPrice || null,
    category_id_1: item.PrimaryCategory?.CategoryID || null,
    category_id_2: item.SecondaryCategory?.CategoryID || null,
    site: item.Site,  
    end_time: item.ListingDetails.EndTime,  
    start_time: item.ListingDetails.StartTime,  
    store_category_1: item?.Storefront?.StoreCategoryID || null,  
    store_category_2: item?.Storefront?.StoreCategory2ID || null, 
    start_price: item.StartPrice || null,  
    current_price: item.SellingStatus?.CurrentPrice || null,
    currency: item?.Currency || null,
    image_urls: item.PictureDetails?.PictureURL || [], 
    title: item.Title,  
    quantity_available: (item.Quantity - (item.SellingStatus?.QuantitySold || 0) > 0) ? (item.Quantity - (item.SellingStatus?.QuantitySold || 0)) : 0,
    quantity_sold: item.SellingStatus?.QuantitySold || 0,
    initial_quantity: item.Quantity,
    country: item.Country || null,
    view_item_url: item.ListingDetails.ViewItemURL || null,
    last_updated: jobData.pageStartTime,
    listing_duration: item.ListingDuration || null,
    listing_type: item.ListingType || null,
    location: item.Location || null,
    bid_count: item.SellingStatus?.BidCount || 0,
    ship_to_locations: item.ShipToLocations || [],
    watch_count: item.WatchCount || 0,
    updated_by: 'ebayPlatformNotificationHook',
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
    Key: { listing_id: item.ItemID.toString() }, 
    UpdateExpression: `SET ${updateExpressions.join(', ')}`,
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues,
  }
  
  try {
    await dynamo.update(params)
    logger('Updated cache for item: ' + item.ItemID)
    return true
  } catch (err) {
    throw {
      message: 'Unable to add item to cache',
      errors: { debug: err.message },
    }
  }
}

//Get the plan details from the DB
export async function getUserPlanDetails({ planTier, DDB_TABLES, dynamo }) {
  const params = {
    TableName: DDB_TABLES.USER.PLAN_CONFIG.NAME,
    Key: {
      plan_id: planTier,
    },
  }
  
  logger('Checking for existing plan details: ' + planTier)
  
  try {
    const data = await dynamo.get(params)
    // Return the first matching item if found
    if (data?.Item) {
      return data.Item
    }
    
    logger('No existing plan details found: ' + planTier)
    return false
  } catch (err) {
    throw {
      message: 'Unable to get user plan details from database',
      errors: { debug: err.message },
    }
  } 
}

//Get user account ID based on EIAS
export async function getUserAccountIdByEIAS({ eBayEAISToken, DDB_TABLES, dynamo }) {
  logger('Checking for existing EIAS record: ' + eBayEAISToken + ';')
  
  const params = {
    TableName: DDB_TABLES.USER.EBAY_DETAILS.NAME,
    IndexName: DDB_TABLES.USER.EBAY_DETAILS.GSI.EAIS_TOKEN,
    KeyConditionExpression: 'eais_token = :stoken',
    ExpressionAttributeValues: {
      ':stoken': eBayEAISToken,
    },
  }

  try {
    const data = await dynamo.query(params)
    
    if (data?.Items?.length > 0) {
      return data.Items[0].user_id
    }
    
    logger('No existing EIAS record found: ' + eBayEAISToken)
    return false
  } catch (err) {
    logger('Error getting user account ID by EIAS: ' + err.message)
    const msg = 'Unable to get user account ID by EIAS from database'
    const error = new Error(msg)
    error.debug = err.message 
    throw error
  }
}

//Add the results to DynamoDB Log
export async function addToDDBLog({ data, tableName, dynamo }) {
  const params = {
    TableName: tableName,
    Item: data,
  }
  
  try {
    await dynamo.put(params)
  } catch (err) {
    throw {
      message: 'Unable to add message to: ' + tableName,
      errors: { debug: err.message },
    }
  }
}

