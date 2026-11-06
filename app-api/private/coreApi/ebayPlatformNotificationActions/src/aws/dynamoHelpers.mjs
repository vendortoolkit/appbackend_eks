import { logger } from '../utils/logger.mjs'

//Update the PN status in DynamoDB
export async function updatePnStatus({ newPNStatus, recordData, DDB_TABLES, dynamo }) {

  const data = {
    ebay_pn_status : newPNStatus,
    ebay_pn_status_change: recordData.updateStartTime,
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
    TableName: DDB_TABLES.USER.ACCOUNT_STATUS.NAME,
    Key: { user_id: recordData.userId },
    UpdateExpression: `SET ${updateExpressions.join(', ')}`,
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues,
  }
  try {
    const result =  dynamo.update(params)
    return result
  } catch (err) {
    const msg = 'Unable to update PN status in DynamoDB'
    throw {
      message: msg,
      errors: { debug: err.message },
    }
  }
}

//Get the user account status from the DB
export async function getUserAccountStatus({ recordData, DDB_TABLES, dynamo }) {

  const userId = recordData.userId
  const params = {
    TableName: DDB_TABLES.USER.ACCOUNT_STATUS.NAME,
    KeyConditionExpression: 'user_id = :userId',
    ExpressionAttributeValues: {
      ':userId': userId },
    Limit: 1, // Only 1 user record per userId
  }
  logger('Checking for existing user account: ' + userId)


  try {
    const data = await dynamo.query(params)
    // Return the first matching item if found
    if (data?.Items?.length > 0) {
      const existingUserAccount = data.Items[0]
      return existingUserAccount
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

//Get the plan details from the DB
export async function getUserPlanDetails({ planTier, DDB_TABLES, dynamo }) {

  const params = {
    TableName: DDB_TABLES.USER.PLAN_CONFIG.NAME,
    KeyConditionExpression: 'plan_id = :planId',
    ExpressionAttributeValues: {
      ':planId': planTier,
    },
    Limit: 1, // Only 1 user record per planId
  }

  try {
    const data = await dynamo.query(params)
    // Return the first matching item if found
    if (data?.Items?.length > 0) {
      const existingPlanDetails = data.Items[0]
      return existingPlanDetails
    }
    logger('No existing plan details found: ' + planTier)
    return false
  } catch (err) {
    throw {
      message: 'Unable to get user plan details from database',
      errors: { debug: err.message },
    }
  } 
}  logger('All records processed')


//Add the results to DynamoDB Log
export async function addToDDBLog({ data, DDB_TABLES, dynamo, completed = true }) {
  //Check the data type, so we can send to the correct log table
  const dbName = completed ? DDB_TABLES.EBAY.NOTIFICATIONS_ACTIONS_LOG.NAME : DDB_TABLES.EBAY.NOTIFICATIONS_ACTIONS_ERROR_LOG.NAME
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

