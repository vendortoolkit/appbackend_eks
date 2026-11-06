//------------------------------------------------------------
// Vendor Toolkit Core
// Backend process
// Expecting a DynamoDB Stream event
//------------------------------------------------------------
// Load the lambda layer this includes all the core functions,
import {
  DynamoDB,
  DynamoDBDocument,
  sharedConfig,
  S3Client,
  PutObjectCommand,
  unmarshall,
} from '/opt/nodejs/awsSdk_module/index.mjs'
import { logger } from '../utils/logger.mjs'


import { DDB_TABLES } from '/opt/nodejs/core_module/index.mjs'

const dynamo = DynamoDBDocument.from(new DynamoDB( sharedConfig ))

//Constants for this function - only non-DDB values
const ENV = {
  LOGTTLDAYS: Number(process.env?.LOGTTLDAYS) || 7,
  LOGBUCKET: process.env.LOGBUCKET,
}

export const handler = async(event) => {
  try {
    // ------------------------------------------------------------
    //Stage 1 -Save the payload if this in Debug Mode
    // ------------------------------------------------------------
    if (process.env?.DEBUG) {
      try {
        const s3 = new S3Client(sharedConfig)

        const s3Key = `ddb-stream-raw-${Date.now()}.txt`
        await s3.send(new PutObjectCommand({
          Bucket: ENV.LOGBUCKET,
          Key: s3Key,
          Body: JSON.stringify(event, null, 2),
          ContentType: 'application/json',
        }))
  
      } catch (err) {
        const msg = 'Unable to save raw db stream payload to S3'
        logger('Warning: ' + msg + ' - ' + err.message)
        // Don't throw - this is non-critical
      }
    }

    //Save all the old records in Subscription History
    if (!event?.Records) {
      logger('No records found in event')
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'No records to process' }),
      }
    }  

    for (const record of event.Records) {
      if (record?.dynamodb?.OldImage){
        const previousSub = {
          subscription_event: `${record.dynamodb.Keys.subscription_id.S}#${record.eventID}`,
          subscription_id: record.dynamodb.Keys.subscription_id.S,
          updated_at: new Date().toISOString(),
          event_name: record.eventName,
          previous_data: unmarshall(record.dynamodb.OldImage),
        }
        await addSubscriptionHistory({ previousSub, DDB_TABLES, dynamo })
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Successfully processed records' }),
    }

  } catch (err) {
    //Flag the job as unsuccessful and record the error
    const data = {
      message: err?.message,
      debug_data: err?.errors,
      source: 'stripeSubscriptionHistory',
    }
    logger('Error: ' + JSON.stringify(data, null, 2))
    
    // Throw error to trigger Lambda retry
    throw new Error(`Failed to process DynamoDB stream records: ${err.message}`)
  }
}
  
//Create a new subscription
export async function addSubscriptionHistory({ previousSub, DDB_TABLES, dynamo }) {
  const params = {
    TableName: DDB_TABLES.STRIPE.SUBSCRIPTIONS_HISTORY.NAME,
    Item: previousSub,
    ConditionExpression: 'attribute_not_exists(subscription_event)',
  }
  try {
    // Use put to insert only if subscription_event doesn't exist
    await dynamo.put(params)
    logger(`Subscription history saved for ${previousSub.subscription_id}`)
    return { success: true, subscription_id: previousSub.subscription_id }
  } catch (err) {
    // Check if it's a conditional check failure (duplicate)
    if (err.name === 'ConditionalCheckFailedException') {
      logger(`Subscription history already exists for ${previousSub.subscription_event}, skipping`)
      return { success: true, duplicate: true, subscription_id: previousSub.subscription_id }
    }
    
    // For other errors, throw to trigger retry
    logger(`Error saving subscription history: ${err.message}`)
    throw new Error(`Unable to save subscription history: ${err.message}`)
  }
}