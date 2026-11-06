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

//Get the plan details from the DB
export async function getUserPlanDetails({ planTier, DDB_TABLES, dynamo }) {

  //If the user does not have a current plan tier
  if (!planTier){
    return {}
   }

  const params = {
    TableName: DDB_TABLES.USER.PLAN_CONFIG.NAME,
    Key: {
      plan_id: planTier,
    },
  }
  
  logger('Checking for existing plan details: ' + planTier)
  
  try {
    const data = await dynamo.get(params)
    
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

