//------------------------------------------------------------
// Vendor Toolkit API
// ebayapi/user/details
//------------------------------------------------------------
// Load the lambda layer this includes all the core functions,
import {
  DynamoDB,
  DynamoDBDocument,
  sharedConfig,
  SSMClient,
  GetParametersCommand,
} from '/opt/nodejs/awsSdk_module/index.mjs'

import { DDB_TABLES, CONSTANTS } from '/opt/nodejs/core_module/index.mjs'

import { randomUUID } from 'crypto'
import { addToDDBLog } from '../aws/dynamoHelpers.mjs'
import { logger } from '../utils/logger.mjs'
import { Stripe, getStripeCredentials, stripeCallbackUrl, createStripePendingSession, updateStripePendingSession } from '/opt/nodejs/stripe_module/index.mjs'

const dynamo = DynamoDBDocument.from(new DynamoDB(sharedConfig))

export const handler = async(event) => {

  //Get the userID from the token
  //This is the Cognito UserID - sub
  const userIdFromToken = event.requestContext.authorizer.claims.sub

  //Future updates check if this is an admin userID and the allow CRUD on other accounts eg. the one in the query string
  let userId = userIdFromToken

  //Logging date
  let loggingData = {}
  const progress = []

  let data = {}
  //Default Status Code and ack
  let statusCode = '200'
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  }

  try {
    switch (event.httpMethod) {
    case 'POST':
      data = await postHandler({ userId, event, DDB_TABLES, dynamo })
      break
    case 'GET':
      data = await getHandler({ userId, event, DDB_TABLES, dynamo })
      break
    default:
      throw {
        message: `Unsupported method "${event.httpMethod}"`,
        debug: '',
        restStatus: 500,
      }
    }
  } catch (err) {
    //Provide a standard error output
    statusCode = err?.restStatus ? err.restStatus : 400
    const errorDetail = err?.errors ? err.errors : { debug: 'Unhandled error' }
    data = { error: { message: err.message, errors: errorDetail } }
    logger(`Error in stripe session for user ${userId}: ${JSON.stringify(err)}`)

    //Record the error in the log table
    await addToDDBLog({
      data: { ...loggingData, status: 'error', progress, message: JSON.stringify(data) },
      tableName: DDB_TABLES.STRIPE.SESSION_LOG.NAME,
      dynamo,
    })
  }

  return {
    statusCode,
    body: JSON.stringify(data),
    headers,
  }



  async function postHandler({ userId, event, DDB_TABLES, dynamo }) {
    const stripeSessionData = {}
    loggingData = { user_id: userId, action: 'create_session', ttl: Math.floor(Date.now() / 1000) + 31536000, updated_at: new Date().toISOString() }
    try {
      progress.push('Parsing request body')
      const body = JSON.parse(event.body || '{}')

      //Get the priceId from the request body
      const priceId = body?.priceId
      loggingData.priceId = priceId
      if (!priceId) {
        const msg = 'Missing priceId in request body'
        progress.push(msg)
        throw { message: msg, debug: '' }
      }

      const productId = body?.productId
      loggingData.productId = productId
      if (!productId) {
        const msg = 'Missing productId in request body'
        progress.push(msg)
        throw { message: msg, debug: '' }
      }

      const quantity = body?.quantity || 1
      loggingData.quantity = quantity
      if (isNaN(quantity) || quantity < 1) {
        const msg = 'Invalid quantity in request body'
        progress.push(msg)
        throw { message: msg, debug: '' }
      }

      const mode = body?.mode || 'subscription'
      loggingData.mode = mode
      if (!['subscription', 'payment'].includes(mode)) {
        const msg = 'Invalid mode in request body'
        progress.push(msg)
        throw { message: msg, debug: '' }
      }

      progress.push('Generating unique client reference ID')
      const uniqueClientReferenceId = `${userId}#${randomUUID()}`

      progress.push('Querying plan config for productId')
      // Lookup the plan config by productId (GSI) to validate the productId and retrieve pricing details.
      // Also used downstream to verify the priceId is valid for this product and to check trial eligibility.
      const priceParams = {
        TableName: DDB_TABLES.USER.PLAN_CONFIG.NAME,
        IndexName: DDB_TABLES.USER.PLAN_CONFIG.GSI.PRODUCT_ID,
        KeyConditionExpression: 'product_id = :productId',
        ExpressionAttributeValues: {
          ':productId': productId,
        },
        Limit: 1,
      }
      const productResult = await dynamo.query(priceParams)
      if (!productResult.Items || productResult.Items.length === 0) {
        const msg = 'Invalid productId provided'
        progress.push(msg)
        throw { message: msg, debug: `No plan found for productId ${productId}` }
      }

      const planConfig = productResult.Items[0]
      progress.push('Plan config found for productId')
      const priceMatch = planConfig.plan_prices?.find(price => price.price_id === priceId)
      if (!priceMatch) {
        const msg = 'Invalid priceId provided for this productId'
        progress.push(msg)
        throw { message: msg, debug: `No matching priceId ${priceId} found for productId ${productId}` }
      }

      //Process Trial subscriptions
      const hasTrial = body?.hasTrial || false
      const offerId = body?.offerId || 0
      let verifiedTrialOfferId = null
      if (hasTrial) {
        progress.push('Checking trial offer eligibility')
        // Query active trial offers for the given offerId. Filters to ACTIVE status and TRIAL type only.
        // If an eligible offer is found, trial period settings are applied to the Stripe checkout session.
        const trialOfferParams = {
          TableName: DDB_TABLES.USER.OFFERS.NAME,
          KeyConditionExpression: 'offer_id = :offerId',
          FilterExpression: '#status = :status AND offer_type = :trialType',
          ExpressionAttributeNames: {
            '#status': 'status',
          },
          ExpressionAttributeValues: {
            ':offerId': offerId,
            ':status': CONSTANTS.USER_OFFERS.OFFER_STATUSES.ACTIVE,
            ':trialType': CONSTANTS.USER_OFFERS.OFFER_TYPES.TRIAL,
          },
          LIMIT: 1,
        }
        const trialOfferResult = await dynamo.query(trialOfferParams)
        const eligibleTrialOffer = trialOfferResult.Items?.[0]
        if (eligibleTrialOffer) {
          const offerData = eligibleTrialOffer.offer_data
          if (offerData.eligible_plan_names.includes(planConfig.billing_plan_name)) {
            loggingData.trial_offer_id = eligibleTrialOffer.offer_id
            loggingData.trial_days = eligibleTrialOffer.offer_data.duration_days
            stripeSessionData.trial_period_days = eligibleTrialOffer.offer_data.duration_days
            stripeSessionData.trial_settings = { end_behavior: { missing_payment_method: 'cancel' } }
            verifiedTrialOfferId = eligibleTrialOffer.offer_id
            progress.push('Trial offer eligible and applied')
          } else {
            progress.push('Trial offer not eligible for selected plan')
          }
        } else {
          progress.push('No eligible trial offer found or not active')
        }
      }

      progress.push('Getting Stripe credentials from SSM')
      const { stripeSecretKey } = await getStripeCredentials({ SSMClient, GetParametersCommand, sharedConfig, stripeEnv: process.env.STRIPE_ENV })

      progress.push('Initializing Stripe and creating checkout session')
      const stripe = new Stripe(stripeSecretKey)
      stripeSessionData.metadata = {
        client_session_ref: uniqueClientReferenceId,
        ...(verifiedTrialOfferId && { offer_id: String(verifiedTrialOfferId) }),
      }

      const session = await stripe.checkout.sessions.create({
        client_reference_id: uniqueClientReferenceId,
        subscription_data: stripeSessionData,
        line_items: [
          {
            price: priceId,
            quantity,
          },
        ],
        mode,
        success_url: `${stripeCallbackUrl}?success=true&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${stripeCallbackUrl}?canceled=true&session_id={CHECKOUT_SESSION_ID}`,
      })
      loggingData.session_id = session.id

      progress.push('Recording pending session in DDB')
      await createStripePendingSession({
        userId,
        uniqueClientReferenceId,
        sessionId: session.id,
        lineItems: [
          {
            price: priceId,
            quantity,
          },
        ],
        paymentStatus: session?.payment_status,
        mode: session.mode,
        isPlan: true,
        DDB_TABLES,
        dynamo,
        logger,
      })

      progress.push('Checkout session created successfully')
      const result = { ACK: 'success', url: session?.url }

      // Log progress to DDB on success
      await addToDDBLog({
        data: { ...loggingData, status: 'success', progress },
        tableName: DDB_TABLES.STRIPE.SESSION_LOG.NAME,
        dynamo,
      })
      return result
    } catch (err) {
      progress.push(`Error: ${err.message}`)
      // Log progress to DDB on error
      await addToDDBLog({
        data: { ...loggingData, status: 'error', progress, error: err.message },
        tableName: DDB_TABLES.STRIPE.SESSION_LOG.NAME,
        dynamo,
      })
      throw {
        message: 'Unable to create stripe session',
        errors: { debug: err.message },
        restStatus: 400,
      }
    }
  }


  //This does the same as the checkout.session.completed.
  //This will only run when the user is first returned from Stripe
  //If the user doesn't return - the session will still be updated from the Hook
  async function getHandler({ userId, event, DDB_TABLES, dynamo }) {
    loggingData = { user_id: userId, action: 'get_session', ttl: Math.floor(Date.now() / 1000) + 31536000, updated_at: new Date().toISOString() }
    try {
      progress.push('Parsing session_id from query parameters')
      const sessionId = event.queryStringParameters?.session_id
      loggingData.session_id = sessionId

      if (!sessionId) {
        const msg = 'Missing session_id in query parameters'
        progress.push(msg)
        throw { message: msg, debug: '', restStatus: 400 }
      }

      progress.push('Getting Stripe credentials from SSM')
      const { stripeSecretKey } = await getStripeCredentials({ SSMClient, GetParametersCommand, sharedConfig, stripeEnv: process.env.STRIPE_ENV })

      progress.push('Retrieving checkout session from Stripe')
      const stripe = new Stripe(stripeSecretKey)
      const session = await stripe.checkout.sessions.retrieve(sessionId)

      progress.push('Verifying session ownership')
      // Extract userId from client_reference_id (format: userId#uuid) and verify it matches the token
      const clientReferenceId = session.client_reference_id
      const userIdFromSession = clientReferenceId?.split('#')?.[0]
      if (userIdFromSession !== userId) {
        progress.push('Unauthorized - session does not belong to user')
        throw {
          message: 'Unauthorized access to session',
          debug: 'Session does not belong to user',
          restStatus: 403,
        }
      }

      progress.push('Updating pending session status in DDB')
      // Update the pending session record with the latest payment status from Stripe
      const updateStatuses = { payment_status: session?.payment_status, updated_at: new Date().toISOString() }
      await updateStripePendingSession({
        sessionId: session.id,
        updateStatuses,
        DDB_TABLES,
        dynamo,
        logger,
      })

      progress.push('Session status updated successfully')
      loggingData.payment_status = session?.payment_status
      loggingData.amount_total = session?.amount_total
      loggingData.currency = session?.currency
      loggingData.mode = session?.mode

      await addToDDBLog({
        data: { ...loggingData, status: 'stripe_session_status_updated', progress },
        tableName: DDB_TABLES.STRIPE.SESSION_LOG.NAME,
        dynamo,
      })

      //Return provisional session status (webhook is source of truth)
      return {
        ACK: 'success',
        session_id: session.id,
      }
    } catch (err) {
      progress.push(`Error: ${err.message}`)
      await addToDDBLog({
        data: { ...loggingData, status: 'error', progress, error: err.message },
        tableName: DDB_TABLES.STRIPE.SESSION_LOG.NAME,
        dynamo,
      })
      throw {
        message: 'Unable to retrieve stripe session',
        errors: { debug: err.message },
        restStatus: err?.restStatus || 400,
      }
    }
  }

}
