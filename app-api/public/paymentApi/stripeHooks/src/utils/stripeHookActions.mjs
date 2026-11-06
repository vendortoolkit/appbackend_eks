import { logger } from './logger.mjs'
import { updateStripePendingSession, getStripePendingSessionByCheckoutSessionID } from '/opt/nodejs/stripe_module/index.mjs'
import { DDB_TABLES, CONSTANTS } from '/opt/nodejs/core_module/index.mjs'

//Create a new subscription
export async function addSubscription({ userId, clientSessionRef, eventId, eventData, dynamo }) {

  //Get the line items for the subscription
  const subItemsArray = eventData?.items?.data || []
  const subItems = subItemsArray.map((item) => ({ priceId: item.plan?.id || null, productId: item.plan?.product || null, quantity: item?.quantity || 0, interval: item?.plan?.interval || null, amount: item?.plan?.amount || null, metadata: item?.plan?.metadata || null }))

  //Prepare subscription data
  const subscription_data = {
    subscription_id: eventData.id || null,
    billing_anchor: eventData?.billing_cycle_anchor ? new Date(eventData?.billing_cycle_anchor * 1000).toISOString() : null,
    user_id: userId,
    checkout_session_id: clientSessionRef,
    status: eventData.status || null,
    subscription_items: subItems,
    currency: eventData.currency || null,
    trial_start: eventData.trial_start ? new Date(eventData.trial_start * 1000).toISOString() : null,
    trial_end: eventData.trial_end ? new Date(eventData.trial_end * 1000).toISOString() : null,
    latest_invoice_id: eventData.latest_invoice || null,
    created_at: eventData.created ? new Date(eventData.created * 1000).toISOString() : null,
    canceled_at: eventData?.canceled_at ? new Date(eventData.canceled_at * 1000).toISOString() : null,
    ended_at: eventData?.ended_at ? new Date(eventData.ended_at * 1000).toISOString() : null,
    updated_at: new Date().toISOString(),
    webhook_id: eventId,
  }

  const params = {
    TableName: DDB_TABLES.STRIPE.SUBSCRIPTIONS.NAME,
    Item: subscription_data,
  }

  try {
    // Use put to insert or overwrite
    await dynamo.put(params)
    logger(`Subscription ${eventData.id} saved/updated for user ${userId}`)
    return { success: true, subscription_id: eventData.id }
  } catch (err) {
    const msg = `Unable to save subscription to database - ${err.message}`
    logger(msg)
    const error = new Error('Unable to save subscription to database')
    error.debug = msg
    throw error
  }
}

//Add a payment from Stripe
export async function addPayment({ userId, clientSessionRef, eventData, eventId, eventType, dynamo }) {

  //Get the line items and priceIDs
  const lineItemArray = eventData?.lines?.data || []
  const lineItems = lineItemArray.map((item) => ({ priceId: item.pricing?.price_details?.price || null, productId: item.pricing?.price_details?.product || null, quantity: item?.quantity || null, period_start: item?.period?.start ? new Date(item?.period?.start * 1000).toISOString() : null, period_end: item?.period?.end ? new Date(item?.period?.end * 1000).toISOString() : null, amount: item?.amount || 0 }))

  //Prepare payment data
  const payment_data = {
    user_id: userId || `unallocated_${eventData?.customer_email}`,
    checkout_session_id: clientSessionRef,
    payment_id: eventData.id || null,
    transaction_type: CONSTANTS.STRIPE.TRANSACTION_TYPES.PAYMENT,
    payment_type: eventData?.billing_reason || null,
    total_amount: eventData?.amount_paid || 0,
    currency: eventData?.currency || 0,
    status: eventData?.status || null,
    customer_id: eventData?.customer || null,
    subscription_id: eventData?.parent?.subscription_details?.subscription || `unallocated_${eventData?.customer_email} / ${eventData?.customer}`,
    line_items: lineItems,
    refund_id: null,
    refund_amount: null,
    refund_reason: null,
    refunded_at: null,
    webhook_id: eventId,
    webhook_type: eventType,
    payment_date: eventData?.status_transitions?.paid_at ? new Date(eventData?.status_transitions?.paid_at * 1000).toISOString() : null,
    created_at: new Date().toISOString(),
  }

  const params = {
    TableName: DDB_TABLES.STRIPE.PAYMENTS.NAME,
    Item: payment_data,
  }

  try {
    // Use put to insert or overwrite (upsert behavior)
    await dynamo.put(params)
    logger(`Payment ${eventData.id} added for user ${userId}`)

    //Update the VTK subscription and complete any outstanding Stripe sessions
    // Complete the pending session if one exists
    if (clientSessionRef) {
      const sessionStatuses = { finalised_status: CONSTANTS.STRIPE.SESSION_STATUSES.COMPLETED, payment_status: CONSTANTS.STRIPE.PAYMENT_STATUSES.PAID }
      await updatePendingSession({
        clientSessionRef,
        sessionStatuses,
        dynamo,
        logger,
      })
    }

    return {
      success: true,
      payment_id: eventData.id,
      lineItems,
    }
  } catch (err) {
    const msg = `Unable to save payment to database - ${err.message}`
    logger(msg)
    const error = new Error('Unable to save payment to database')
    error.debug = msg
    throw error
  }
}

//Complete pending session after payment received
export async function updatePendingSession({
  clientSessionRef,  
  dynamo,
  logger,
  sessionStatuses,
}) {

  try {
    const sessionId = await getStripePendingSessionByCheckoutSessionID({ clientSessionRef, DDB_TABLES, dynamo, logger })
    if (!sessionId) {
      return false
    }

    const updateStatuses = { ...sessionStatuses, updated_at: new Date().toISOString() }
    const isUpdated = await updateStripePendingSession({
      sessionId,
      updateStatuses,
      DDB_TABLES,
      dynamo,
      logger,
    })

    return isUpdated
  } catch (err) {
    logger('Error updating ' + DDB_TABLES.STRIPE.PENDING_SESSIONS.NAME + ' table: ' + err.message)
    return false
  }
}

//Extract products from invoice line items (for activation)
export function extractProductsFromInvoice(eventData) {
  const lineItemArray = eventData?.lines?.data || []
  return lineItemArray
    .map(item => ({
      productId: item?.pricing?.price_details?.product || null,
      startDate: item?.period?.start ? new Date(item.period.start * 1000).toISOString() : null,
      endDate: item?.period?.end ? new Date(item.period.end * 1000).toISOString() : null,
    }))
    .filter(p => p.productId)
}

//Extract products from subscription items (for deactivation)
export function extractProductsFromSubscription(eventData) {
  const subItemsArray = eventData?.items?.data || []
  return subItemsArray
    .map(item => ({
      productId: item?.plan?.product || item?.price?.product || null,
      startDate: item?.current_period_start ? new Date(item.current_period_start * 1000).toISOString() : null,
      endDate: item?.current_period_end ? new Date(item.current_period_end * 1000).toISOString() : null,
    }))
    .filter(p => p.productId)
}

//Generic function to process package actions (activate or deactivate)
async function processPackageAction({ userId, products, action, dynamo, lambdaClient, InvokeCommand }) {
  
  if (products.length === 0) {
    logger(`No packages to process for user ${userId}`)
    return { success: true }
  }

  for (const product of products) {
    const queryParams = {
      TableName: DDB_TABLES.USER.PLAN_CONFIG.NAME,
      IndexName: DDB_TABLES.USER.PLAN_CONFIG.GSI.PRODUCT_ID,
      KeyConditionExpression: 'product_id = :productId',
      ExpressionAttributeValues: {
        ':productId': product.productId,
      },
    }

    try {
      const queryResult = await dynamo.query(queryParams)
      if (!queryResult.Items || queryResult.Items.length === 0) {
        logger(`Product ${action} not required (not a plan) for user ${userId} - product ${product.productId}`)
        continue
      }

      // Call subscription actions lambda asynchronously
      logger(`Requesting Product ${action} for user ${userId} - product ${product.productId}`)

      const payload = { 
        'directInvoke': [{ 
          'userId': userId, 
          'action': action, 
          productId: product.productId, 
          startDate: product.startDate, 
          endDate: product.endDate, 
        }], 
      }

      const command = new InvokeCommand({
        FunctionName: process.env.SUBSCRIPTION_ACTIONS_LAMBDA,
        Payload: JSON.stringify(payload),
        InvocationType: 'Event',
      })
      
      await lambdaClient.send(command)
    }
    catch (err) {
      const msg = `Unable to ${action} product - ${err.message}`
      logger(msg)
      const error = new Error(`Unable to ${action} product`)
      error.debug = msg
      throw error
    }
  }
  return { success: true }
}

//Activate App Packages
export async function doActivatePackage({ userId, products, dynamo, lambdaClient, InvokeCommand }) {

  return processPackageAction({ 
    userId, 
    products, 
    action: CONSTANTS.SUBSCRIPTION_ACTIONS.ADD_PLAN, 
    dynamo, 
    lambdaClient, 
    InvokeCommand, 
  })
}

//Deactivate App Packages
export async function doDeactivatePackage({ userId, products, dynamo, lambdaClient, InvokeCommand }) {

  return processPackageAction({ 
    userId, 
    products, 
    action: CONSTANTS.SUBSCRIPTION_ACTIONS.REMOVE_PLAN, 
    dynamo, 
    lambdaClient, 
    InvokeCommand, 
  })
}


//Soft Lock App Packages
export async function doSoftDisablePackage({ userId, products, dynamo, lambdaClient, InvokeCommand }) {

  return processPackageAction({ 
    userId, 
    products, 
    action: CONSTANTS.SUBSCRIPTION_ACTIONS.SOFTLOCK_PLAN, 
    dynamo, 
    lambdaClient, 
    InvokeCommand, 
  })
}






