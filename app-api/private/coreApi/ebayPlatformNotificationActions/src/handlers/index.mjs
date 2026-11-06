//------------------------------------------------------------
// Vendor Toolkit Core
// Backend process
// Expecting an SQS Payload
//------------------------------------------------------------
// Load the lambda layer this includes all the core functions,
import {
  getEbayConfig,
} from '/opt/nodejs/ebayApi_module/index.mjs'
import {
  sharedConfig,
  SSMClient,
  GetParametersCommand,
  DynamoDB,
  DynamoDBDocument,
} from '/opt/nodejs/awsSdk_module/index.mjs'
import { DDB_TABLES } from '/opt/nodejs/core_module/index.mjs'
import { addToDDBLog } from '../aws/dynamoHelpers.mjs'
import { logger } from '../utils/logger.mjs'
import { doAdminAction } from '../actions/adminActions.mjs'
import { doUserAction } from '../actions/userActions.mjs'

//Constants for this function
const ENV = { 
  LOGTTLDAYS : Number(process.env?.LOGTTLDAYS) || 7,
}

const preloadEbayConfig = getEbayConfig({
  SSMClient,
  GetParametersCommand,
  sharedConfig,
})

const dynamo = DynamoDBDocument.from(new DynamoDB( sharedConfig ))

export const handler = async(event) => {


  //Output JSON
  let funcResponse = []
 
  // Get the SSM Params that were loaded in the Init stage
  const ebayConfig = await preloadEbayConfig

  //Caculate the Log TTL time (Unix Timestamp) 
  const ttl = Math.floor((new Date().getTime() + (1000 * 60 * 60 * 24 * ENV.LOGTTLDAYS)) / 1000)

  //There are 2 ways this function can be invoked - Directly or via SQS
  //Check for Direct Invocation 
  let records = []
  if (event?.directInvoke){
    records = event.directInvoke
  }
  else if (event?.Records){
    records = event?.Records
  }
  logger('Found Items to be processed: ' + records.length)

  // Loop through the batch of items
  for (const record of records) {
    const recordData = {}
    try {
      logger(`Processing message ID: ${record?.messageId || 'Not available (Direct Invocation)'}`)
      let job = typeof record.body === 'string' ? JSON.parse(record.body) : record

      // Build the update data object
      recordData.userId = job?.userId
      recordData.subscriptionAction =  job?.action
      recordData.updateStartTime = new Date().toISOString()
      recordData.data=  job?.data
      
      //Check which type of action has been sent
      if (recordData.subscriptionAction === 'updateDeliveryUrl' || recordData.subscriptionAction === 'getDeliveryUrl'){
        //Admin Actions
        funcResponse.push(await doAdminAction({ recordData, ebayConfig, ttl, DDB_TABLES, dynamo }))
      }
      else {
        //User Actions
        funcResponse.push(await doUserAction({ recordData, ebayConfig, ttl, DDB_TABLES, dynamo }))
      }
      
    } catch (err) {
      //Flag the item as unsuccessful and record the error
      const data = { 
        user_id : recordData.userId,
        requested_pn_action: recordData.subscriptionAction,
        timestamp: recordData.updateStartTime,
        debug_data: JSON.stringify(err?.errors),
        message: err?.message,
        source: 'ebayPlatformNotificationActions',
        ttl }
      logger('data:' + JSON.stringify(data, null, 2))
      logger('Logging error to DynamoDB')
      await addToDDBLog({ data, DDB_TABLES, dynamo })

      //Throw the error
      throw new Error(err?.message)
    }
  }

  // Return PN results
  return funcResponse

}
