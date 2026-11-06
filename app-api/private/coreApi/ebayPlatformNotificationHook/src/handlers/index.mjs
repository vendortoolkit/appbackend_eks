//------------------------------------------------------------
// Vendor Toolkit Core
// Backend process
// Expecting a HTTP call from eBay
//------------------------------------------------------------
// Load the lambda layer this includes all the core functions,
import {
  PutObjectCommand,
  sharedConfig,
  S3Client,
  SSMClient,
  GetParametersCommand,
  DynamoDB,
  DynamoDBDocument,
} from '/opt/nodejs/awsSdk_module/index.mjs'

import {
  getEbayConfig,
} from '/opt/nodejs/ebayApi_module/index.mjs'

import { DDB_TABLES } from '/opt/nodejs/core_module/index.mjs'

import { XMLParser } from 'fast-xml-parser'
import { addToDDBLog, addCacheItem, removeCacheItem, updateCacheItemQty } from '../aws/dynamoHelpers.mjs'
import { logger } from '../utils/logger.mjs'
import { isEbaySignatureValid } from '../ebay/ebayHelpers.mjs'
import { validateVTKUser } from '../actions/userActions.mjs'

const preloadEbayConfig = getEbayConfig({
  SSMClient,
  GetParametersCommand,
  sharedConfig,
})

//Constants for this function - only non-DDB values
const ENV = {
  LOGTTLDAYS: Number(process.env?.LOGTTLDAYS) || 7,
  LOGBUCKET: process.env.LOGBUCKET,
}

const dynamo = DynamoDBDocument.from(new DynamoDB(sharedConfig))

export const handler = async(event, context) => {

  let header = null
  let body = null

  //A placeholder for the parsed notification data
  const pnData = {}

  // Get the SSM Params that were loaded in the Init stage
  const ebayConfig = await preloadEbayConfig

  try {
    // ------------------------------------------------------------
    //Stage 1 -Save the payload if this in Debug Mode
    // ------------------------------------------------------------
    if (process.env?.DEBUG) {
      try {
        const s3 = new S3Client(sharedConfig)
        // API Gateway proxy integration puts the whole request in the event
        const rawBody = event || ''
        pnData.s3Key = `pn-raw-${Date.now()}-${context.awsRequestId}.txt`

        await s3.send(new PutObjectCommand({
          Bucket: ENV.LOGBUCKET,
          Key: pnData.s3Key,
          Body: JSON.stringify(rawBody),
          ContentType: 'text/plain',
        }))

      } catch (err) {
        const msg = 'Unable to save raw PN payload to S3'
        throw {
          message: msg,
          errors: { debug: err.message },
        }
      }
    }

    //------------------------------------------------------------
    //Stage 2 - Validate the payload
    // ------------------------------------------------------------
    const parser = new XMLParser()
    let jObj = parser.parse(event?.body || '')
    if (!jObj?.['soapenv:Envelope']) {
      const msg = 'Missing SOAP Envelope in payload'
      const error = new Error(msg)
      error.debug = 'Data received did not contain a soapenv:Envelope tag'
      throw error
    }

    header = jObj['soapenv:Envelope']?.['soapenv:Header']
    body = jObj['soapenv:Envelope']?.['soapenv:Body']

    if (!header || !body) {
      const msg = 'Missing SOAP Header or Body in payload'
      const error = new Error(msg)
      error.debug = 'Data received did not contain a soapenv:Header or soapenv:Body tag'
      throw error
    }

    //Check for the notification signature
    const notificationSignature = header?.['ebl:RequesterCredentials']?.['ebl:NotificationSignature']
    if (!notificationSignature) {
      const msg = 'Missing Notification Signature in payload'
      const error = new Error(msg)
      error.debug = 'Data received did not contain a ebl:NotificationSignature tag'
      throw error
    }

    //Get the SOAP action
    const SOAPAction = event?.headers?.SOAPAction || event?.headers?.soapaction
    if (!SOAPAction) {
      const msg = 'Missing SOAP Action in headers'
      const error = new Error(msg)
      error.debug = 'Headers did not contain a SOAPAction tag'
      throw error
    }

    //Extract the action name from the SOAP Action
    const match = SOAPAction.match(/\/([^/]+)"$/)
    pnData.actionName = match ? match[1] : null
    logger('Received SOAP Action: ' + pnData.actionName)

    if (!pnData.actionName) {
      const msg = 'Invalid SOAP Action in headers'
      const error = new Error(msg)
      error.debug = `SOAPAction did not contain a valid action name: ${SOAPAction}`
      throw error
    }

    //Get the payload for the action
    //https://developer.ebay.com/api-docs/static/pn_item-closed.html
    //This is a mapping of the action names to the payload names
    const eventPayloads = {
      ItemClosed: { callResponse: 'GetItemResponse', cacheAction: 'remove' },
      BidReceived: { callResponse: 'GetItemResponse', cacheAction: 'update' },
      FixedPriceTransaction: { callResponse: 'GetItemTransactionsResponse', cacheAction: 'updateQty' },
      ItemListed: { callResponse: 'GetItemResponse', cacheAction: 'add' },
      ItemRevised: { callResponse: 'GetItemResponse', cacheAction: 'update' },
      ItemSold: { callResponse: 'GetItemResponse', cacheAction: null },
      ItemUnsold: { callResponse: 'GetItemResponse', cacheAction: null },
      ItemOutOfStock: { callResponse: 'GetItemResponse', cacheAction: 'updateQty' },
      ItemExtended: { callResponse: 'GetItemResponse', cacheAction: 'update' },
      WatchedItemEndingSoon: { callResponse: 'GetItemResponse', cacheAction: null },
      AuctionCheckoutComplete: { callResponse: 'GetItemTransactionsResponse', cacheAction: null },
      EndOfAuction: { callResponse: 'GetItemTransactionsResponse', cacheAction: 'remove' },
      AskSellerQuestion: { callResponse: 'GetMemberMessagesResponse', cacheAction: null },
      ItemRemovedFromWatchList: { callResponse: 'GetItemResponse', cacheAction: null },
      BestOffer: { callResponse: 'GetBestOffersResponse', cacheAction: null },
      BestOfferDeclined: { callResponse: 'GetBestOffersResponse', cacheAction: null },
      BestOfferPlaced: { callResponse: 'GetBestOffersResponse', cacheAction: null },
      CounterOfferReceived: { callResponse: 'GetBestOffersResponse', cacheAction: null },
      ItemAddedToWatchList: { callResponse: 'GetItemResponse', cacheAction: null },
    }

    pnData.eventPayloadName = eventPayloads?.[pnData.actionName]?.callResponse
    if (!pnData.eventPayloadName) {
      const msg = 'Unsupported SOAP Action in headers'
      const error = new Error(msg)
      error.debug = `SOAPAction is not supported by this function: ${SOAPAction}`
      throw error
    }

    pnData.eBayTimeStamp = body?.[pnData.eventPayloadName]?.['Timestamp']
    // Make sure the signature is valid
    const isProdSignatureValid = isEbaySignatureValid({ eBayTimeStamp: pnData.eBayTimeStamp, ebayConfig: ebayConfig.production, notificationSignature })
    const isSandboxSignatureValid = isEbaySignatureValid({ eBayTimeStamp: pnData.eBayTimeStamp, ebayConfig: ebayConfig.sandbox, notificationSignature })

    if (!isProdSignatureValid && !isSandboxSignatureValid) {
      const msg = 'Invalid Notification Signature'
      const error = new Error(msg)
      error.debug = 'Notification signature did not match either production or sandbox eBay app credentials'
      throw error
    }

    //Check which environment the signature matched
    pnData.ebayEnv = isProdSignatureValid ? 'production' : 'sandbox'
    logger('Notification signature matched ' + pnData.ebayEnv + ' eBay app credentials')

    // ------------------------------------------------------------
    //Stage 3 - Validate the user
    // ------------------------------------------------------------
    //Get the EAID and UserID from the payload
    pnData.eBayEAISToken = body?.[pnData.eventPayloadName]?.['EIASToken']
    pnData.userId = body?.[pnData.eventPayloadName]?.['RecipientUserID']

    const userValidationsResult = await validateVTKUser({ 
      eBayEAISToken: pnData.eBayEAISToken, 
      actionName: pnData.actionName,
      DDB_TABLES,
      dynamo, 
    })
    
    if (!userValidationsResult?.success) {
      const msg = userValidationsResult?.message || 'User is not a valid VTK user'
      const code = 'INVALID_VTK_USER'
      const error = new Error(msg)
      //pass the code so we can handle this differently in the log
      error.code = code
      error.debug = 'UserID is not associated with a valid VTK account'
      throw error
    }
    logger('User is a valid VTK user: ' + pnData.userId)

    //If we reach here then the user is valid and the signature is valid so we can process the notification
    logger('Processing ' + pnData.actionName + ' notification for user ' + pnData.userId)

    //------------------------------------------------------------
    //Stage 4 - Process the payload
    // ------------------------------------------------------------ 
    //Do actions based on the PN event

    logger('Event cache action: ' + eventPayloads?.[pnData.actionName]?.cacheAction)

    if (eventPayloads?.[pnData.actionName]?.cacheAction === 'update' || eventPayloads?.[pnData.actionName]?.cacheAction === 'add') {
      await addCacheItem({ 
        item: body?.[pnData.eventPayloadName]?.['Item'], 
        jobData: { userId: pnData.userId, pageStartTime: pnData.eBayTimeStamp, jobId: body?.CorrelationID }, 
        DDB_TABLES,
        dynamo, 
      })
    }

    if (eventPayloads?.[pnData.actionName]?.cacheAction === 'updateQty' ) {
      await updateCacheItemQty({ 
        item: body?.[pnData.eventPayloadName]?.['Item'], 
        jobData: { userId: pnData.userId, pageStartTime: pnData.eBayTimeStamp, jobId: body?.CorrelationID }, 
        DDB_TABLES,
        dynamo, 
      })
    }

    if (eventPayloads?.[pnData.actionName]?.cacheAction === 'remove') {
      await removeCacheItem({ 
        item: body?.[pnData.eventPayloadName]?.['Item'], 
        DDB_TABLES,
        dynamo, 
      })
    }

    //------------------------------------------------------------
    //Stage 5 - Log the payload
    // ------------------------------------------------------------
    //Record the clients PN usage
    //Flag the job as successful and record the success
    //GetItemResponse, GetItemTransactions, GetBestOffersResponse all contain the ItemID in same structure
    //This is randomly generated if not present with non-item events
    const logId = body?.[pnData.eventPayloadName]?.['Item']?.['ItemID'] || `non-item-${Date.now()}`

    //Record the notification in the database log
    const logData = {
      item_id: logId.toString() || 'N/A',
      date_received: pnData.eBayTimeStamp,
      event: pnData.actionName,
      user_id: pnData.userId,
      action: 'processed',
      eais_token: pnData.eBayEAISToken,
      message: '',
      ebay_environment: pnData.ebayEnv,
      ttl: Date.now() + (ENV.LOGTTLDAYS * 24 * 60 * 60 * 1000), //Set the TTL based on LOGTTLDAYS env var
    }
    
    await addToDDBLog({ 
      data: logData, 
      tableName: DDB_TABLES.EBAY.NOTIFICATIONS_RECEIVED.NAME,
      dynamo, 
    })

  } catch (err) {
    //Flag the job as unsuccessful and record the error
    const data = {
      message: err?.message,
      debug_data: err?.errors,
      source: 'ebayPlatformNotificationHook',
    }
    logger('data:' + JSON.stringify(data, null, 2))

    //Record the notification in the database log - only if we were able to extract a header and body, otherwise it's pointless
    if (body && header) {
      const logId = body?.[pnData.eventPayloadName]?.['Item']?.['ItemID'] || `non-item-${Date.now()}`
      //Record the notification in the database log
      const logData = {
        item_id: logId.toString() || 'N/A',
        date_received: pnData?.eBayTimeStamp || new Date().toISOString(),
        event:  pnData?.actionName || 'N/A',
        raw_action: event?.headers?.SOAPAction || event?.headers?.soapaction || 'N/A',
        user_id: pnData?.userId || 'N/A',
        action: 'error',
        s3_object_key:  ENV.LOGBUCKET + '/' + pnData.s3Key || 'N/A',
        eais_token: pnData.eBayEAISToken || 'N/A',
        message: err?.message || 'N/A',
        error_code: err?.code ||  'N/A',
        ebay_environment: pnData?.ebayEnv || 'N/A',
        ttl: Date.now() + (ENV.LOGTTLDAYS * 24 * 60 * 60 * 1000),
      }
      
      await addToDDBLog({ 
        data: logData, 
        tableName: DDB_TABLES.EBAY.NOTIFICATIONS_RECEIVED_ERROR_LOG.NAME,
        dynamo, 
      })
    }
  }

  return {
    statusCode: 200,
    body: 'OK',
  }
}