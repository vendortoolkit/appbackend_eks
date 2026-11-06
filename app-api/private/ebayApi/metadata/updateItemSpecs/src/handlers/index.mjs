//------------------------------------------------------------
// 
//------------------------------------------------------------
// Load the lambda layer this includes all the core functions,

import {
  DynamoDB,
  DynamoDBDocument,
  sharedConfig,
} from '/opt/nodejs/awsSdk_module/index.mjs'

import { logger } from '../utils/logger.mjs'

import {
  updateItemSpecs,
} from '../utils/meta_cache_actions.mjs'


const dynamo = DynamoDBDocument.from(new DynamoDB(sharedConfig))


export const handler = async(event) => {

  // Build a list of SQS messages that failed
  const batchItemFailures = []
  
  
  logger('Found SQS messages to be processed: ' + event?.Records?.length)
  
  // Loop through the batch of SQS items
  for (const record of event.Records) {

    const job = JSON.parse(record.body)
    const logid = record.messageId?.split('-')[0] ?? null
    try {
    //CHeck that the message had the required fields
      if (!job?.action || !job?.s3Key || !job?.jobId) {
        logger(`Invalid message format for message ID: ${record.messageId}`, logid)
        throw {
          message: 'Invalid message format',
          errors: { debug: 'Missing required fields in SQS message' },
        }
      }
      logger('Processing job: ' + JSON.stringify(job), logid)
      //Get the action from event body, 
      await jobHandler(job, logid)
    }
    catch (err) {
      logger('Error in sqs job loop: ' + err.message, logid)
      //Throw the error 
      const errorDetail = err?.errors ? err.errors : { debug: 'Unhandled error' }
      logger('Error message: ' + err.message, logid)
      logger('Error details: ' + JSON.stringify(errorDetail), logid)
      batchItemFailures.push({ itemIdentifier: record.messageId })
      continue
    }
  }
  logger ('Finished processing SQS messages. Total failures: ' + batchItemFailures.length)
  logger('Failed message IDs: ' + JSON.stringify(batchItemFailures))
  return { batchItemFailures }
}


async function jobHandler(payload, logid) {
  //We are epecting the body to have the following actions:
  // action: fullRecacheItemSpecs or incrementalRecacheItemSpecs
  const {
    action,
    s3Key = null,
    jobId,
  } = payload

  switch (action) {
  case 'fullRecacheItemSpecs':
    logger('Executing fullRecacheItemSpecs action', logid)
    return await updateItemSpecs({ s3Key, jobId, dynamo, metadataBucket: process.env.EBAY_METADATA_BUCKET, logid })
  default:
    throw {
      message: `Unsupported action "${action}"`,
      errors: { debug: 'Unsupported action' },
    }
  }
}



