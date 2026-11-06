//------------------------------------------------------------
// Vendor Toolkit Core
// Backend process
// Expecting a HTTP call from Stripe
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
  LambdaClient,
  InvokeCommand,
} from '/opt/nodejs/awsSdk_module/index.mjs'
import { DDB_TABLES, CONSTANTS } from '/opt/nodejs/core_module/index.mjs'

import { addToDDBLog, checkWebhookProcessed, markWebhookProcessed, markOfferRedeemed } from '../aws/dynamoHelpers.mjs'
import { logger } from '../utils/logger.mjs'
import { addSubscription, addPayment, updatePendingSession, doActivatePackage, doDeactivatePackage, doSoftDisablePackage, extractProductsFromInvoice, extractProductsFromSubscription } from '../utils/stripeHookActions.mjs'
import { Stripe, getStripeCredentials, extractUserIdFromStripeEvent } from '/opt/nodejs/stripe_module/index.mjs'


//Constants for this function - only non-DDB values
const ENV = {
  LOGTTLDAYS: Number(process.env?.LOGTTLDAYS) || 7,
  LOGBUCKET: process.env.LOGBUCKET,
}

const dynamo = DynamoDBDocument.from(new DynamoDB(sharedConfig))
const lambdaClient = new LambdaClient(sharedConfig)

export const handler = async(event, context) => {

  //A placeholder for the parsed notification data
  let s3Key = null
  let eventNotification = null
  let userId = null
  let clientSessionRef = null
  const logBuffer = []

  try {
    // ------------------------------------------------------------
    //Stage 1 -Save the payload if this in Debug Mode
    // ------------------------------------------------------------
    if (process.env?.DEBUG) {
      try {
        const s3 = new S3Client(sharedConfig)

        const webhookFullData = {
          body: event.body, // Raw string body (exact as received)
          headers: event.headers, // All headers for reference
          receivedAt: new Date().toISOString(),
          requestId: context.awsRequestId,
        }

        s3Key = `stripe-wh-raw-${Date.now()}-${context.awsRequestId}.txt`
  
        await s3.send(new PutObjectCommand({
          Bucket: ENV.LOGBUCKET,
          Key: s3Key,
          Body: JSON.stringify(webhookFullData, null, 2),
          ContentType: 'application/json',
        }))
        logBuffer.push(`Passed: Saved Stripe Notification to S3: ${s3Key}`)
  
      } catch (err) {
        const msg = `Unable to save raw webhook payload to S3 - ${err.message}`
        logger(msg)
        const error = new Error('Unable to save raw webhook payload to S3')
        error.debug = msg
        throw error
      }
    }
  

    // ------------------------------------------------------------
    //Stage 2 - Validate the Stripe Payload
    // ------------------------------------------------------------
    //Get the Stripe credentials from SSM
    const { stripeSecretKey, stripeWhSecret } = await getStripeCredentials({  SSMClient,  GetParametersCommand, sharedConfig, stripeEnv: process.env.STRIPE_ENV })

    //Initialize Stripe
    const stripe = new Stripe(stripeSecretKey)

    //Parse the request body
    const sig = event.headers['Stripe-Signature'] ?? ''
   
    //Check the Stripe Signature and parse the event information
    eventNotification = stripe.webhooks.constructEvent(
      event?.body,
      sig,
      stripeWhSecret,
    )

    logBuffer.push('Passed: Stripe Signature OK')

    // ------------------------------------------------------------
    //Stage 2.5 - Check for duplicate webhooks (Idempotency)
    // ------------------------------------------------------------
    const eventId = eventNotification.id

    const extracted = extractUserIdFromStripeEvent({
      eventData: eventNotification?.data?.object, eventType: eventNotification.type, 
    })
    userId = extracted.userId
    clientSessionRef = extracted.clientSessionRef
    
    const alreadyProcessed = await checkWebhookProcessed({ 
      eventId, 
      dynamo, 
    })

    if (alreadyProcessed) {
      logger(`Webhook ${eventId} already processed, skipping`)
      return {
        statusCode: 200,
        body: JSON.stringify({ received: true, duplicate: true }),
      }
    }
    logBuffer.push('Passed: Indempotecy check')

    // ------------------------------------------------------------
    //Stage 3 - Actions based on the Event Type
    // ------------------------------------------------------------
    logger(`Processing webhook: ${eventNotification.type}`)
        
    // Process the webhook based on type
    switch (eventNotification.type) {
    // Checkout completed
    // Actions: update table: vtk_stripe_pending_session - update the payment status
    case 'checkout.session.completed':
      await updatePendingSession({
        clientSessionRef,
        sessionStatuses : { payment_status : CONSTANTS.STRIPE.PAYMENT_STATUSES.PAID },
        dynamo,
        logger,
      })
      logBuffer.push('Passed: updatePendingSession')
      break
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      // Subscription added / changed / deleted
      await addSubscription({ 
        eventType: eventNotification.type, 
        eventId,
        userId, 
        clientSessionRef, 
        eventData: eventNotification.data.object, 
        dynamo, 
      })
      logBuffer.push('Passed: addSubscription')

      if (eventNotification.type === 'customer.subscription.deleted') {
        await doDeactivatePackage({ userId, products : extractProductsFromSubscription(eventNotification.data.object), dynamo, lambdaClient, InvokeCommand })
        logBuffer.push('Passed: doDeactivatePackage')
      }
      break
    case 'invoice.paid':
    case 'invoice.payment_failed': {
      // Payment completed
      await addPayment({ 
        eventType: eventNotification.type, 
        eventId, 
        userId, 
        clientSessionRef, 
        eventData: eventNotification.data.object, 
        dynamo, 
      })
      logBuffer.push('Passed: logged payment')

      // Only for invoice.paid, mark offer as redeemed if ACTIVE
      if (eventNotification.type === 'invoice.paid' && userId) {
        // Extract offer_id from metadata (may be in several places)
        const offerId = eventNotification.data.object?.parent?.subscription_details?.metadata?.offer_id ||
          eventNotification.data.object?.lines?.data?.[0]?.metadata?.offer_id
        if (offerId) {
          logBuffer.push(`Checking offer_id: ${offerId}`)
          const isOfferRedeemed = await markOfferRedeemed({ offerId, dynamo, logger })
          if (isOfferRedeemed) {
            logBuffer.push('Offer marked as REDEEMED')
          } else {
            logBuffer.push('Offer not marked as REDEEMED (not found or not ACTIVE)')
          }
        }
        // Do subscription activation actions
        await doActivatePackage({ userId, products: extractProductsFromInvoice(eventNotification.data.object), dynamo, lambdaClient, InvokeCommand })
        logBuffer.push('Passed: doActivatePackage')
      }
      if (eventNotification.type === 'invoice.payment_failed' && userId){
        // Flag the account as in arrears, if this is payment for a plan
        await doSoftDisablePackage({ userId, products: extractProductsFromInvoice(eventNotification.data.object), dynamo, lambdaClient, InvokeCommand })
        logBuffer.push('Passed: doSoftDisablePackage')
      }
      break
    }
    default: {
      const msg = `Unhandled event type: ${eventNotification.type}. The webhook does not handle this Stripe event`
      logger(msg)
      const error = new Error('Unhandled Stripe event type')
      error.debug = msg
      throw error
    }
    }

    // ------------------------------------------------------------
    //Stage 4 - Mark webhook as processed (Idempotency)
    // ------------------------------------------------------------
    await markWebhookProcessed({
      eventId,
      userId,
      eventType: eventNotification.type,
      eventData: eventNotification.data.object,
      s3Key,
      dynamo,
      logBuffer,
    })
  } catch (err) {
    //Flag the job as unsuccessful and record the error
    const data = {
      message: err?.message,
      debug_data: err?.debug,
      source: 'stripeNotificationHook',
    }
    logger('Error: ' + JSON.stringify(data, null, 2))

    //Build common error log fields
    const commonLogData = {
      s3_object_key: s3Key ? `${ENV.LOGBUCKET}/${s3Key}` : 'N/A',
      message: err?.message || 'N/A',
      error_code: err?.code || err?.type || 'N/A',
      error_type: err?.type || 'N/A',
      debug_data: err?.debug || 'N/A',
      stripe_environment: process.env.STRIPE_ENV || 'N/A',
      log_buffer: logBuffer,
      ttl: Math.floor(Date.now() / 1000) + (ENV.LOGTTLDAYS * 24 * 60 * 60),
    }

    //Build event-specific fields based on processing stage
    let logData = {}
    
    if (eventNotification?.id) {
      // Error occurred after successful signature verification - use verified event data
      logData = {
        ...commonLogData,
        event_id: eventNotification.id,
        event_type: eventNotification.type || 'unknown',
        date_received: eventNotification.created ? new Date(eventNotification.created * 1000).toISOString() : new Date().toISOString(),
        action: 'error',
        user_id: userId,
      }
    } else {
      // Signature verification failed or event couldn't be parsed - extract from raw body
      let rawEventData = null
    
      try {
        rawEventData = JSON.parse(event?.body || '{}')
      // eslint-disable-next-line no-unused-vars
      } catch (parseErr) {
        logger('Unable to parse raw event body')
      }

      const { userId: rawUserId } = extractUserIdFromStripeEvent({ eventData: rawEventData?.data?.object, eventType: rawEventData?.type })
      
      logData = {
        ...commonLogData,
        event_id: rawEventData?.id || `error-${Date.now()}-${context.awsRequestId}`,
        event_type: rawEventData?.type || 'parse_failed',
        date_received: rawEventData?.created ? new Date(rawEventData.created * 1000).toISOString() : new Date().toISOString(),
        action: 'error_signature_or_parse_failed',
        user_id: rawUserId || 'N/A',
      }
    }
    
    // Write error log to DynamoDB
    try {
      await addToDDBLog({ 
        data: logData, 
        tableName: DDB_TABLES.STRIPE.WEBHOOK_ERROR_LOG.NAME,
        dynamo, 
      })
    } catch (logErr) {
      logger(`Failed to write error log to DynamoDB: ${logErr.message}`)
    }

    // Return 200 for known Stripe errors to prevent retries
    // Return 500 for unknown errors to trigger Stripe retry
    if (err.type === 'StripeSignatureVerificationError') {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid signature' }),
      }
    }

    // Return 500 for processing errors so Stripe retries
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Processing failed' }),
    }
  }
  return {
    statusCode: 200,
    body: 'OK',
  }
 
}
