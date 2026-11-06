import {
  initEbayAPI,
} from '/opt/nodejs/ebayApi_module/index.mjs'
import { logger } from '../utils/logger.mjs'
import { updatePnDeliveryUrls, getPnDeliveryUrls } from '../ebay/ebayHelpers.mjs'
import { addToDDBLog } from '../aws/dynamoHelpers.mjs'

//------------------------------------------------------------
//Do a user action like subscribe/unsubscribe/getstatus
export async function doAdminAction({ recordData, ebayConfig, ttl, DDB_TABLES, dynamo }){

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

  //We still need a user token - the token provided should be the one attached to default Admin account
  //Load ebay api object for the user
  const ebayAPI = await initEbayAPI({
    userId: recordData.userId,
    ebayConfig,
    dynamo,
    DDB_TABLES,
  })

  //Update the delivery URLS
  if (recordData.subscriptionAction === 'updateDeliveryUrl'){

    if (!recordData?.data?.deliveryURLDetails ||  recordData.data.deliveryURLDetails.length === 0) {
      throw {
        message: 'Missing required attribute: deliveryURLDetails',
        errors: { debug: 'deliveryURLDetails is undefined or empty' },
      }
    }
    await updatePnDeliveryUrls({ deliveryURLS: recordData.data.deliveryURLDetails, ebayAPI })
    funcResponse = { 'ACK' : 'success' }
  }


  //Get the delivery URLS for the application
  if (recordData.subscriptionAction === 'getDeliveryUrl'){
    const deliveryURLS = await getPnDeliveryUrls({ ebayAPI })
    funcResponse = { 'ACK' : 'success', deliveryURLS }
  }

  //------------------------------------------------------------
  // Log the success or failure of the job
  //------------------------------------------------------------
  logger('Log the success or failure of the job')
  //Add the job to the COMPLETEDLOG
  const data = {
    user_id : recordData.userId,
    requested_pn_action: recordData.subscriptionAction,
    timestamp: recordData.updateStartTime,
    message: 'PN application request completed successfully',
    source: 'ebayPlatformNotificationActions',
    ttl }
  logger('data:' + JSON.stringify(data, null, 2))
  logger('Logging success to DynamoDB')
  await addToDDBLog({ data, DDB_TABLES, dynamo, completed: true })

  return(funcResponse)
}
 