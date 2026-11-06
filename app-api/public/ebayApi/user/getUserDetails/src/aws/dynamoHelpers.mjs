import { logger } from '../utils/logger.mjs'

//Save the eBay user details in dynamoDB
export async function saveEbayUserDetails({ userId, ebayDetails, DDB_TABLES, dynamo }) {

  const data = {
    eais_token: ebayDetails.EIASToken,
    last_updated: new Date().toISOString(),
    email: ebayDetails.Email,
    feedback_score: ebayDetails.FeedbackScore,
    ebay_good_standing: ebayDetails.eBayGoodStanding,
    registration_date: ebayDetails.RegistrationDate,
    site: ebayDetails.Site,
    ebay_status: ebayDetails.Status,
    user_ebay_id: ebayDetails.UserID,
    vat_status: ebayDetails.VATStatus,
    store_owner: ebayDetails.StoreOwner,
    registered_business_seller: ebayDetails.RegisteredBusinessSeller,
    motors_dealer: ebayDetails.MotorsDealer,
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
    TableName: DDB_TABLES.USER.EBAY_DETAILS.NAME,
    Key: { user_id: userId },
    UpdateExpression: `SET ${updateExpressions.join(', ')}`,
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues,
  }

  logger('Saving eBay user details to DynamoDB for user: ' + userId)
  
  try {
    const result = await dynamo.update(params)
    return result
  } catch (err) {
    logger('Error saving eBay user details to DynamoDB for user: ' + userId)
    const msg = 'Unable to save eBay user details to database'
    throw {
      message: msg,
      errors: { debug: err.message },
    }
  }
}
