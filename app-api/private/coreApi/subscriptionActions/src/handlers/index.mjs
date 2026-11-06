//------------------------------------------------------------
// Vendor Toolkit Core
// Backend process
// Expecting an SQS Payload
//------------------------------------------------------------
// Load the lambda layer this includes all the core functions,
import {
  sharedConfig,
  DynamoDB,
  DynamoDBDocument,
  LambdaClient,
  InvokeCommand,
} from '/opt/nodejs/awsSdk_module/index.mjs'
import { CONSTANTS } from '/opt/nodejs/core_module/index.mjs'
import { addToDDBLog } from '../aws/dynamoHelpers.mjs'
import { logger } from '../utils/logger.mjs'
import { doPackageAddAction, doPackageRemoveAction, doPackageSoftlockAction } from '../actions/subscriptionActions.mjs'

//Constants for this function
const ENV = { 
  LOGTTLDAYS : Number(process.env?.LOGTTLDAYS) || 7,
}

const dynamo = DynamoDBDocument.from(new DynamoDB( sharedConfig ))

const lambdaClient = new LambdaClient(sharedConfig)

export const handler = async(event) => {


  //Output JSON
  let funcResponse = []

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
      recordData.productId =  job?.productId
      recordData.subStartDate =  job?.startDate
      recordData.subEndDate =  job?.endDate

      
      // Validate required fields - skip processing if any are missing
      if (!recordData.userId || !recordData.subscriptionAction || !recordData.productId || !recordData.subStartDate || !recordData.subEndDate) {
        logger(`Skipping record due to missing required fields: ${JSON.stringify({
          userId: !!recordData.userId,
          subscriptionAction: !!recordData.subscriptionAction,
          productId: !!recordData.productId,
          subStartDate: !!recordData.subStartDate,
          subEndDate: !!recordData.subEndDate,
        })}`)
        continue
      }

      recordData.updateStartTime = new Date().toISOString()
     
      //Check which type of action has been sent
      switch (recordData.subscriptionAction) {
      case CONSTANTS.SUBSCRIPTION_ACTIONS.ADD_PLAN:
        //Add/Renew Package Actions
        funcResponse.push(await doPackageAddAction({ recordData, dynamo, lambdaClient, InvokeCommand }))
        break
        
      case CONSTANTS.SUBSCRIPTION_ACTIONS.REMOVE_PLAN:
        //Remove Package Actions
        funcResponse.push(await doPackageRemoveAction({ recordData, dynamo, lambdaClient, InvokeCommand  }))
        break
        
      case CONSTANTS.SUBSCRIPTION_ACTIONS.SOFTLOCK_PLAN:
        //Remove Package Actions
        funcResponse.push(await doPackageSoftlockAction({ recordData, dynamo, lambdaClient, InvokeCommand  }))
        break
        
      default: {
        const msg = `Skipping record due to unknown subscriptionAction: ${recordData.subscriptionAction}`
        logger(msg)
        const error = new Error('Unable to activate/deactivate plan')
        error.debug = msg
        throw error
      }
      }

      //Log successful actions
      const data = { 
        user_id : recordData.userId,
        payload : JSON.stringify(recordData),
        subscription_action: recordData.subscriptionAction,
        timestamp: new Date().toISOString(),
        plan_id: recordData.productId,
        source: 'subscriptionActions',
        ttl }
      await addToDDBLog({ data, dynamo, completed : true })

    } catch (err) {
      //Flag the item as unsuccessful and record the error
      const data = { 
        user_id : recordData.userId,
        payload : JSON.stringify(recordData),
        subscription_action: recordData.subscriptionAction,
        timestamp: new Date().toISOString(),
        debug_data: JSON.stringify(err?.errors),
        message: err?.message,
        source: 'subscriptionActions',
        ttl }
      logger('data:' + JSON.stringify(data, null, 2))
      logger('Logging error to DynamoDB')
      await addToDDBLog({ data, dynamo, completed : false })
      
      // Add failed record to response and continue processing next record
      funcResponse.push({ 
        success: false, 
        userId: recordData.userId,
        subscriptionAction: recordData.subscriptionAction,
        error: err?.message, 
      })
    }
  }

  // Return the list of failed item identifiers
  return funcResponse
}
