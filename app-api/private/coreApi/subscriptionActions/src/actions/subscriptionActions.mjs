import { logger } from '../utils/logger.mjs'
import { DDB_TABLES, CONSTANTS } from '/opt/nodejs/core_module/index.mjs'


export async function doPackageAddAction({ recordData, dynamo, lambdaClient, InvokeCommand  }){
  return executePlanAction({ recordData, dynamo, lambdaClient, InvokeCommand, action: recordData.subscriptionAction })
}


export async function doPackageRemoveAction({ recordData, dynamo, lambdaClient, InvokeCommand  }){
  return executePlanAction({ recordData, dynamo, lambdaClient, InvokeCommand, action: recordData.subscriptionAction })
}


export async function doPackageSoftlockAction({ recordData, dynamo, lambdaClient, InvokeCommand  }){
  return executePlanAction({ recordData, dynamo, lambdaClient, InvokeCommand, action: recordData.subscriptionAction })
}


async function executePlanAction({ recordData, dynamo, lambdaClient, InvokeCommand, action }) {
  // Stage 1: Lookup plan details (shared)
  const planDetails = await lookupPlanDetails(recordData, DDB_TABLES, dynamo)
  
  // Stage 2: Update user status (slight variation)
  const planStatusChange = await updateUserStatus({
    recordData, planDetails, dynamo, action,
  })
  
  // Stage 3: Platform notifications - only for add/remove actions
  let ebayPN = {}
  if (action === CONSTANTS.SUBSCRIPTION_ACTIONS.ADD_PLAN || action === CONSTANTS.SUBSCRIPTION_ACTIONS.REMOVE_PLAN) {
    ebayPN = await handlePlatformNotifications({
      userId: recordData.userId, 
      action: action === CONSTANTS.SUBSCRIPTION_ACTIONS.ADD_PLAN ? CONSTANTS.EBAY_PN_ACTIONS.SUBSCRIBE: CONSTANTS.EBAY_PN_ACTIONS.UNSUBSCRIBE,
      lambdaClient, InvokeCommand,
    })
  }
  return { success: true, planTier: planDetails.plan_id, ...recordData, planStatusChange, ebayPN, planAction: action }
}

async function lookupPlanDetails(recordData, DDB_TABLES, dynamo) {
  const queryParams = {
    TableName: DDB_TABLES.USER.PLAN_CONFIG.NAME,
    IndexName: DDB_TABLES.USER.PLAN_CONFIG.GSI.PRODUCT_ID,
    KeyConditionExpression: 'product_id = :productId',
    ExpressionAttributeValues: {
      ':productId': recordData.productId,
    },
  }
  try {
    const queryResult = await dynamo.query(queryParams)
    if (!queryResult.Items || queryResult.Items.length === 0) {
      const msg = `ProductId not found for user ${recordData.userId} - product ${recordData.productId}`
      logger(msg)
      const error = new Error('Unable to look up plan details')
      error.debug = msg
      throw error
    }

    //Get full plan details
    const planResult = await dynamo.query({
      TableName: DDB_TABLES.USER.PLAN_CONFIG.NAME,
      KeyConditionExpression: 'plan_id = :planId',
      ExpressionAttributeValues: {
        ':planId': queryResult.Items[0]?.plan_id,
      }, 
    })
    return planResult.Items[0]

  }
  catch (err) {
    const msg = `Error during plan details lookup: ${err.message}`
    logger(msg)
    const error = new Error('Unable to look up plan details')
    error.debug = err.message 
    throw error
  }
}

async function updateUserStatus({ recordData, planDetails, dynamo, action }) {
  // Upsert user status to DynamoDB
  const planStatusChange = new Date().toISOString()

  // Build update parameters based on action type
  // For 'add': update ac_status, plan_tier, plan_status, next_payment_date, plan_status_change
  // For 'remove/softlock/unknown': only update plan_tier, plan_status, next_payment_date, plan_status_change (omit ac_status)
  let planStatus = CONSTANTS.PLAN_STATUSES.UNKNOWN 
  switch (action) {
  case CONSTANTS.SUBSCRIPTION_ACTIONS.ADD_PLAN:
    planStatus = CONSTANTS.PLAN_STATUSES.ACTIVE 
    break
  case CONSTANTS.SUBSCRIPTION_ACTIONS.REMOVE_PLAN:
    planStatus = CONSTANTS.PLAN_STATUSES.INACTIVE 
    break
  case CONSTANTS.SUBSCRIPTION_ACTIONS.SOFTLOCK_PLAN:
    planStatus = CONSTANTS.PLAN_STATUSES.SOFTLOCKED 
    break
  }

  const updateParams = {
    TableName: DDB_TABLES.USER.ACCOUNT_STATUS.NAME,
    Key: {
      user_id : recordData.userId,
    },
    UpdateExpression: action === CONSTANTS.SUBSCRIPTION_ACTIONS.ADD_PLAN
      ? 'set ac_status = :acStatus, plan_tier = :planTier, plan_status = :planStatus, next_payment_date = :nextPaymentDate, plan_status_change = :planStatusChange'
      : 'set plan_tier = :planTier, plan_status = :planStatus, next_payment_date = :nextPaymentDate, plan_status_change = :planStatusChange',
    ExpressionAttributeValues: {
      ':planTier':  planDetails.plan_id,
      ':planStatus': planStatus,
      ':nextPaymentDate': recordData.subEndDate,
      ':planStatusChange': planStatusChange,
    },
  }

  // Only set ac_status when adding a subscription
  if (action === CONSTANTS.SUBSCRIPTION_ACTIONS.ADD_PLAN) {
    updateParams.ExpressionAttributeValues[':acStatus'] = CONSTANTS.ACCOUNT_STATUSES.ACTIVE 
  }

  await dynamo.update(updateParams)
  logger(`User status ${action}d for user ${recordData.userId}`)
  
  return planStatusChange
}

async function handlePlatformNotifications({ userId, action, lambdaClient, InvokeCommand }) {
  const payload = { 'directInvoke': [{ 'userId': userId, 'action': action }] }

  const command = new InvokeCommand({
    FunctionName: process.env.PN_ACTIONS_LAMBDA,
    Payload: JSON.stringify(payload),
  })
  const funresp = await lambdaClient.send(command)
  const responsePayload = JSON.parse(Buffer.from(funresp.Payload).toString())
  const ebayPN = {}
  if (responsePayload?.errorType){
    ebayPN.success = false
    ebayPN.errorMessage = responsePayload?.errorMessage
  }
  else {
    ebayPN.success = true
  }

  return ebayPN
}












