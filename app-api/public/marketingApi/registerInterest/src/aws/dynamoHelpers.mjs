import { logger } from '../utils/logger.mjs'
import { DDB_TABLES, CONSTANTS } from '/opt/nodejs/core_module/index.mjs'

// Mark offer as redeemed if currently ACTIVE
export async function markOfferRedeemed({ offerId, dynamo, logger }) {
  
  try {
    // Get the offer by offerId
    const getParams = {
      TableName: DDB_TABLES.USER.OFFERS.NAME,
      Key: { offer_id: offerId },
    }
    const offerResult = await dynamo.get(getParams)
    const offer = offerResult?.Item
    if (!offer || offer.status !== CONSTANTS.USER_OFFERS.OFFER_STATUSES.ACTIVE) {
      logger(`Offer ${offerId} not ACTIVE or not found, skipping redeem.`)
      return false
    }
    // Update status to REDEEMED
    const updateParams = {
      TableName: DDB_TABLES.USER.OFFERS.NAME,
      Key: { offer_id: offerId },
      UpdateExpression: 'set #status = :redeemed, redeemed_date = :now',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':redeemed': CONSTANTS.USER_OFFERS.OFFER_STATUSES.REDEEMED,
        ':now': new Date().toISOString(),
        ':active': CONSTANTS.USER_OFFERS.OFFER_STATUSES.ACTIVE,
      },
      ConditionExpression: '#status = :active',
    }
    await dynamo.update(updateParams)
    logger(`Offer ${offerId} marked as REDEEMED.`)
    return true
  } catch (err) {
    logger(`Failed to mark offer ${offerId} as REDEEMED: ${err.message}`)
    return false
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
    const msg = `Unable to add message to: ${tableName} - ${err.message}`
    logger(msg)
    const error = new Error('Unable to add message to DynamoDB')
    error.debug = msg
    throw error
  }
}

//Check if webhook has already been processed
export async function checkWebhookProcessed({ eventId, dynamo }) {
  const params = {
    TableName: DDB_TABLES.STRIPE.WEBHOOK_LOG.NAME,
    Key: {
      event_id: eventId,
    },
  }
  
  try {
    const data = await dynamo.get(params)
    return !!data?.Item // Returns true if record exists
  } catch (err) {
    logger(`Error checking webhook: ${err.message}`)
    return false // Assume not processed on error
  }
}

//Mark webhook as processed
export async function markWebhookProcessed({ eventId, eventType, eventData, s3Key, dynamo, userId, logBuffer }) {

  const customerId = eventData?.customer || null

  const params = {
    TableName: DDB_TABLES.STRIPE.WEBHOOK_LOG.NAME,
    Item: {
      event_id: eventId,
      event_type: eventType,
      processed_at: new Date().toISOString(),
      s3_object_key: s3Key || null,
      user_id: userId,
      customer_id: customerId,
      log_buffer: logBuffer,
      ttl: Math.floor(Date.now() / 1000) + (DDB_TABLES.STRIPE.WEBHOOK_LOG.TTL_DAYS * 24 * 60 * 60),
    },
    ConditionExpression: 'attribute_not_exists(event_id)', // Prevent overwriting
  }
  
  try {
    await dynamo.put(params)
    logger(`Marked webhook ${eventId} as processed`)
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      logger(`Webhook ${eventId} already marked as processed (race condition)`)
    } else {
      const msg = `Unable to mark webhook as processed - ${err.message}`
      logger(msg)
      const error = new Error('Unable to mark webhook as processed')
      error.debug = msg
      throw error
    }
  }
}

