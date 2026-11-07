import { logger } from '../utils/logger.mjs'
import { getUserAccountStatus, getUserPlanDetails, getUserAccountIdByEIAS } from '../aws/dynamoHelpers.mjs'

//---------------------------------------------------------------
//Validate the user
export async function validateVTKUser({ eBayEAISToken, actionName, DDB_TABLES, dynamo }) {
  
  //Get user account ID based on EIAS
  const userId = await getUserAccountIdByEIAS({ eBayEAISToken, DDB_TABLES, dynamo })
  
  if (!userId) {
    logger('eBay EAIS token not found or invalid: ' + eBayEAISToken)
    return false
  }
  
  logger('eBay EAIS token found, UserID: ' + userId)

  //Check is the user is permitted to receive this PN
  const isVTKAccountAuthorizedForPN = await verifyVTKAccountForPN({ userId, actionName, DDB_TABLES, dynamo })

  return isVTKAccountAuthorizedForPN
}

// ------------------------------------------------------------
// Verify that a VTK user is authorized to receive this PN
// ------------------------------------------------------------
//1. Get the user account status from the DB
//2. Check if the user is authorized for the action
//3. Return success (true/false) and message
//------------------------------------------------------------
async function verifyVTKAccountForPN({ userId, actionName, DDB_TABLES, dynamo }) {

  //------------------------------------------------------
  //1. Get the user account status from the DB
  const userAccountDetails = await getUserAccountStatus({ userId, DDB_TABLES, dynamo })
  
  //Check the ac_status is active
  if (!userAccountDetails) {
    const msg = 'User account could not be found: ' + userId
    logger(msg)
    return { success: false, message: msg }
  }
  
  logger('User account found: ' + userId)

  //Check the ac_status is active and ebay_pn_status is active
  if (userAccountDetails?.ac_status !== 'active' || userAccountDetails?.ebay_pn_status !== 'active') {
    const msg = 'User account is not active or PN status not active: ' + userId
    logger(msg)
    return { success: false, message: msg }
  }
  
  logger('User account is active and PN status is active: ' + userId)

  //------------------------------------------------------
  //2. Check if the user is authorized for the action
  const planDetails = await getUserPlanDetails({ planTier: userAccountDetails?.plan_tier, DDB_TABLES, dynamo })
  
  if (!planDetails) {
    const msg = 'User plan details not found: ' + userAccountDetails?.plan_tier
    logger(msg)
    return { success: false, message: msg }
  }
  
  logger('User plan details found: ' + userAccountDetails?.plan_tier)

  //Get a list of platform notification events that are allowed for this plan which is a string set in DynamoDB
  //Also convert to an array
  const allowedEvents = Array.from(planDetails?.ebay_pn_events || new Set())
  
  //Check if the actionName is in the allowedEvents
  if (!allowedEvents.includes(actionName)) {
    const msg = 'User is not authorized to receive this platform notification event: ' + actionName
    logger(msg)
    return { success: false, message: msg }
  }
  
  logger('User is authorized to receive this platform notification event: ' + actionName)

  //All checks passed so the user is valid
  return { success: true }
}