import {
  initEbayAPI,
} from '/opt/nodejs/ebayApi_module/index.mjs'
import { logger } from '../utils/logger.mjs'
import { addToDDBLog, getUserAccountStatus, getUserPlanDetails, updatePnStatus } from '../aws/dynamoHelpers.mjs'
import { getUserSubscriptions, setUserSubscriptions } from '../ebay/ebayHelpers.mjs'

//---------------------------------------------------------------
//Do a user action like subscribe/unsubscribe/getstatus
export async function doUserAction({ recordData, ebayConfig, ttl, DDB_TABLES, dynamo }){

  let funcResponse = {}

  // ------------------------------------------------------------
  // STAGE 1: Validate the input data
  // ------------------------------------------------------------
  logger('STAGE 1: Validate the input data')
  // Validate required fields
  if (!recordData.userId) {
    throw {
      message: 'Missing required attribute: userId',
      errors: { debug: 'userId is undefined or empty' },
    }
  }

  if (!recordData.subscriptionAction || !['subscribe', 'unsubscribe', 'getStatus'].includes(recordData.subscriptionAction)) {
    throw {
      message: 'Invalid or missing required attribute: action',
      errors: { debug: 'action is undefined, empty or not subscribe/unsubscribe/getStatus' },
    }
  }

  //Get the user account status from the DB
  const userAccountDetails = await getUserAccountStatus({ recordData, DDB_TABLES, dynamo })
  //Check the ac_status is active
  if (!userAccountDetails) {
    throw {
      message: 'User account could not be found',
      errors: { debug: `User account could not be found: ${recordData.userId}` },
    }
  }
  logger('User account found: ' + recordData.userId)
      
  //------------------------------------------------------------

  //Get the plan details from the DB
  const planDetails = await getUserPlanDetails({ planTier: userAccountDetails?.plan_tier, DDB_TABLES, dynamo })
  if (!planDetails) {
    throw {
      message: 'User plan details not found',
      errors: { debug: `User plan details not found: ${userAccountDetails?.plan_tier}` },
    }
  }
  logger('User plan details found: ' + userAccountDetails?.plan_tier)

  //Get a lists of platform notification events that are allowed for this plan which is a string set in DyanamoDB
  //Also convert to an array
  const allowedEvents = Array.from(planDetails?.ebay_pn_events || new Set())

  logger('Allowed platform notification events for this plan: ' + (allowedEvents.join(',')))

  //Load ebay api object for the user
  const ebayAPI = await initEbayAPI({
    userId: recordData.userId,
    ebayConfig,
    dynamo,
    DDB_TABLES,
  })

  //------------------------------------------------------------
  // STAGE 2: Check which events the user is currently subscribed to on eBay
  //------------------------------------------------------------
  logger('STAGE 2: Check which events the user is currently subscribed to')
  const { userDeliveryPreferenceArray, deliveryURLName: userDeliveryURLName } = await getUserSubscriptions({ userId: recordData.userId, ebayAPI })

  //PN Subscriptions we need to be set within eBay
  let requiredSubs = {}

  //PN Subscriptions currently set within eBay
  let existingSubs = []


  if (userDeliveryPreferenceArray) {
    //If there are already active subscriptions
    //Create an array of currently enabled PN events
    existingSubs = userDeliveryPreferenceArray.NotificationEnable
      .filter(event => event.EventEnable === 'Enable')
      .map(event => event.EventType)
           

    //Create a list of events to remove (no longer in the current plan)
    const toRemove = existingSubs.filter(event => !allowedEvents.includes(event))
    //Push them to the PN Object
    requiredSubs = { 'Enable' : allowedEvents, 'Disable' : toRemove }
  }
  //No active subs so they all need to be added
  else {
    requiredSubs = { 'Enable' : allowedEvents }
  }

  
  //------------------------------------------------------------
  // STAGE 3: Update the users' eBay platform notications subscriptions
  //------------------------------------------------------------
  if (recordData.subscriptionAction === 'subscribe' || recordData.subscriptionAction === 'unsubscribe'){

    const planDeliveryURLName = `${planDetails.billing_plan_name.toLowerCase()}`
    let newPNStatus

    //Unsubscribe to all events
    if (recordData.subscriptionAction === 'unsubscribe'){
      requiredSubs = { 'Disable' : existingSubs }
      newPNStatus = 'inactive'
    } else {
      newPNStatus = 'active'
    }

    //Process the event changes
    await setUserSubscriptions({  events: requiredSubs, planDeliveryURLName, ebayAPI })
    if (requiredSubs?.Enable){
      logger('Subscribed to events: ' + requiredSubs.Enable.join(', '))
    }
    if (requiredSubs?.Disable){
      logger('Unsubscribed from events: ' + requiredSubs.Disable.join(', '))
    }
      
    
    //Update dynamodb with PN status and update time
    if (newPNStatus){
      await updatePnStatus({ newPNStatus, recordData, DDB_TABLES, dynamo })

    }
    funcResponse = { 'ACK' : 'success' }
  }

  //The call was to get users PN status
  if (recordData.subscriptionAction === 'getStatus'){
    funcResponse = { 'ACK' : 'success', existingSubs, userDeliveryURLName, pnStatus: userAccountDetails?.ebay_pn_status }
  }

  //------------------------------------------------------------
  // STAGE 3: Log the success or failure of the job
  //------------------------------------------------------------
  logger('STAGE 3: Log the success or failure of the job')
      
  //Add the job to the COMPLETEDLOG
  const data = {
    user_id : recordData.userId,
    requested_pn_action: recordData.subscriptionAction,
    pn_events_old: JSON.stringify(existingSubs),
    pn_event_new: recordData.subscriptionAction !== 'getStatus' ? JSON.stringify(requiredSubs) : '',
    timestamp: recordData.updateStartTime,
    message: 'PN Events updated successfully',
    source: 'ebayPlatformNotificationActions',
    ttl }
  logger('data:' + JSON.stringify(data, null, 2))
  logger('Logging success to DynamoDB')
  await addToDDBLog({ data, DDB_TABLES, dynamo, completed : true })

  return(funcResponse)
}
