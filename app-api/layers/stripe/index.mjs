// index.mjs - shared Stripe Imports
import { Stripe } from 'stripe'

// Stripe Constants
const STRIPE_KEYNAMES = {
  "live": {
    "stripeSecretKey": "/vendortoolkit/stripe/live/secretKey",
    "stripePublishableKey": "/vendortoolkit/live/pubKey",
    "stripeWhSecret": "/vendortoolkit/stripe/live/whSecret",
  },
  "sandbox": {
    "stripeSecretKey": "/vendortoolkit/stripe/sandbox/secretKey",
    "stripePublishableKey": "/vendortoolkit/stripe/sandbox/pubKey",
    "stripeWhSecret": "/vendortoolkit/stripe/sandbox/whSecret",
  }
}

//Local testing
const stripeCallbackUrl = "http://app.vendortoolkit.com:5173/app/settings/account"

//Stripe helper functions
async function getStripeCredentials({ SSMClient, GetParametersCommand, sharedConfig, stripeEnv }) {

  //Check if we need sandbox or live credentials
  const stripeKeyNames = STRIPE_KEYNAMES?.[stripeEnv]
  if (!stripeKeyNames) {
    throw new Error('Unable to load stripe API key names')
  }

  const ssm = new SSMClient(sharedConfig)

  const params = {
    Names: Object.values(stripeKeyNames),
    WithDecryption: true,
  }

  try {
    const command = new GetParametersCommand(params)
    const res = await ssm.send(command)

    const result = {}
    res.Parameters.forEach((param) => {
      //return each with their original key names
      const credentialName = Object.keys(stripeKeyNames).find(key => stripeKeyNames[key] === param.Name)
      result[credentialName] = param.Value
    })
    return result
  } catch (err) {
    throw new Error(`Error getting Stripe Keys from SSM: ${err.message}`)
  }
}
// -----------------------------------------------
//Find any pending Stripe subscripion sessions - based on userID
// -----------------------------------------------
async function getStripePendingSessionByUserID({ userId, DDB_TABLES, dynamo }) {

  //Only look for sessions that are less than 24 hours old
  const todayDate = new Date()
  todayDate.setDate(todayDate.getDate() - 1)
  const sessionCutoff = todayDate.toISOString()

  const params = {
    TableName: DDB_TABLES.STRIPE.PENDING_SESSIONS.NAME,
    IndexName: DDB_TABLES.STRIPE.PENDING_SESSIONS.GSI.USER_ID,
    KeyConditionExpression: 'user_id = :userId',
    FilterExpression: '#ps = :ps AND #fs = :fs AND created_at > :cutoff AND #md = :md AND is_plan = :isPlan',
    ExpressionAttributeValues: {
      ':userId': userId,
      ':ps': 'paid',
      ':fs': 'pending',
      ':cutoff': sessionCutoff,
      ':md': 'subscription',
      ':isPlan': true,
    },
    ExpressionAttributeNames: {
      '#ps': 'payment_status',
      '#fs': 'finalised_status',
      '#md': 'mode',
    },
  }
  try {
    const data = await dynamo.query(params)

    if (data?.Items?.length > 0) {
      return data.Items
    }
    return null

  } catch (err) {
    throw {
      message: 'Unable to get pending session',
      errors: { debug: err.message },
    }
  }
}


// -----------------------------------------------
//Find any pending Stripe subscripion sessions - based on checkout session id
// -----------------------------------------------
async function getStripePendingSessionByCheckoutSessionID({ clientSessionRef, DDB_TABLES, dynamo, logger }) {
  const queryParams = {
    TableName: DDB_TABLES.STRIPE.PENDING_SESSIONS.NAME,
    IndexName: DDB_TABLES.STRIPE.PENDING_SESSIONS.GSI.CHECKOUT_SESSION_ID,
    KeyConditionExpression: 'checkout_session_id = :clientRef',
    ExpressionAttributeValues: {
      ':clientRef': clientSessionRef,
    },
  }

  try {
    const queryResult = await dynamo.query(queryParams)

    if (!queryResult.Items || queryResult.Items.length === 0) {
      logger(`No pending session found for checkout_session_id: ${clientSessionRef}`)
      return false
    }
    return queryResult.Items[0].session_id

  } catch (err) {
    logger('Error getting session_id' + DDB_TABLES.STRIPE.PENDING_SESSIONS.GSI.CHECKOUT_SESSION_ID+ ' table: ' + err.message)
    return false
  }
}

//-------------------------------------------------------------
//Update the status of a pending stripe session
//-------------------------------------------------------------
async function updateStripePendingSession({
  sessionId,
  updateStatuses,
  DDB_TABLES,
  dynamo,
  logger }) {

  try {
    //Build the update expression dynamically from updateStatuses object
    const updateExpressions = []
    const expressionAttributeNames = {}
    const expressionAttributeValues = {
      ':sessId': sessionId,
    }
    //Build SET expressions for each field in updateStatuses
    for (const [field, value] of Object.entries(updateStatuses)) {
      const placeholder = `:${field}`
      updateExpressions.push(`#${field} = ${placeholder}`)
      expressionAttributeNames[`#${field}`] = field
      expressionAttributeValues[placeholder] = value
    }

    const updateParams = {
      TableName: DDB_TABLES.STRIPE.PENDING_SESSIONS.NAME,
      Key: {
        session_id: sessionId,
      },
      UpdateExpression: `SET ${updateExpressions.join(', ')}`,
      ConditionExpression: 'session_id = :sessId',
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
    }

    await dynamo.update(updateParams)
    logger(`Stored pending session updated for session_id: ${sessionId}`)
    return true

  } catch (err) {
    logger('Error updating ' + DDB_TABLES.STRIPE.PENDING_SESSIONS.NAME + ' table: ' + err.message)
    return false
  }
}


//-------------------------------------------------------------
//Store a Stripe Pending session in the database
//-------------------------------------------------------------
async function createStripePendingSession({
  userId,
  sessionId,
  uniqueClientReferenceId,
  lineItems,
  mode,
  isPlan,
  paymentStatus,
  DDB_TABLES,
  dynamo,
  logger }) {

  //Add the session record
  const params = {
    TableName: DDB_TABLES.STRIPE.PENDING_SESSIONS.NAME,
    Item: {
      user_id: userId,
      session_id: sessionId,
      checkout_session_id: uniqueClientReferenceId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      mode: mode,
      is_plan: isPlan,
      line_items: lineItems,
      payment_status: paymentStatus,
      finalised_status: 'pending',
    },
    ConditionExpression: 'attribute_not_exists(user_id)',
  }

  try {
    await dynamo.put(params)
    logger(`Stored pending session for user ${userId}`)
    return true
  } catch (err) {
    logger('Error adding to ' + DDB_TABLES.STRIPE.PENDING_SESSIONS.NAME + ' table: ' + err.message)
    throw {
      message: 'Unable to add message to: ' + DDB_TABLES.STRIPE.PENDING_SESSIONS.NAME,
      errors: { debug: err.message },
    }
  }
}

// This function extract a userID from a Stripe Webhook payload
function extractUserIdFromStripeEvent({ eventData, eventType }) {

  let clientSessionRef = null

  if (eventType) {
    switch (eventType) {
    // Subscription lifecycle events
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
    case 'customer.subscription.paused':
    case 'customer.subscription.resumed':
    case 'customer.subscription.pending_update_applied':
    case 'customer.subscription.pending_update_expired':
    case 'customer.subscription.trial_will_end':
      clientSessionRef = eventData?.metadata?.client_session_ref
      break

    // Invoice events
    case 'invoice.paid':
    case 'invoice.payment_failed':
    case 'invoice.payment_action_required':
    case 'invoice.payment_succeeded':
    case 'invoice.finalized':
    case 'invoice.upcoming':
    case 'invoice.marked_uncollectible':
    case 'invoice.voided':
      // Invoice events have nested structure
      clientSessionRef = eventData?.parent?.subscription_details?.metadata?.client_session_ref ||
          eventData?.lines?.data?.[0]?.metadata?.client_session_ref
      break

    // Checkout session events
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
    case 'checkout.session.async_payment_failed':
    case 'checkout.session.expired':
      clientSessionRef = eventData?.client_reference_id
      break

    // Payment intent events
    case 'payment_intent.succeeded':
    case 'payment_intent.payment_failed':
    case 'payment_intent.canceled':
    case 'payment_intent.processing':
    case 'payment_intent.requires_action':
      clientSessionRef = eventData?.metadata?.client_session_ref
      break

    // Charge events
    case 'charge.succeeded':
    case 'charge.failed':
    case 'charge.refunded':
    case 'charge.dispute.created':
      clientSessionRef = eventData?.metadata?.client_session_ref
      break

    // Customer events
    case 'customer.created':
    case 'customer.updated':
    case 'customer.deleted':
      clientSessionRef = eventData?.metadata?.client_session_ref
      break

    // Payment method events
    case 'payment_method.attached':
    case 'payment_method.detached':
      clientSessionRef = eventData?.metadata?.client_session_ref
      break
    }
  }
  return ({ userId: clientSessionRef?.split('#')?.[0] || null, clientSessionRef })
}


// Export class constructors and commonly used commands
export {
  Stripe,
  stripeCallbackUrl,
  getStripeCredentials,
  extractUserIdFromStripeEvent,
  getStripePendingSessionByCheckoutSessionID,
  getStripePendingSessionByUserID,
  updateStripePendingSession,
  createStripePendingSession
};
