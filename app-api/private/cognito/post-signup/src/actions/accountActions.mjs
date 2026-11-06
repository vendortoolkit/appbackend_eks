import { logger } from '../utils/logger.mjs'
import { DDB_TABLES, CONSTANTS, LAMBDA_NAMES } from '/opt/nodejs/core_module/index.mjs'


export async function addUserOffers({ userData, dynamo }) {
  try {
    const currentDate = new Date().toISOString()

    //Get any active global offers that are eligible for new users
    const getParams = {
      TableName: DDB_TABLES.USER.GLOBAL_OFFERS.NAME,
      IndexName: DDB_TABLES.USER.GLOBAL_OFFERS.GSI.OFFER_ELIGIBILITY_ID,
      KeyConditionExpression: 'offer_eligibility_id = :eligibilityId AND #status = :status',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':eligibilityId': CONSTANTS.USER_OFFERS.ELIGIBILTY_IDS.NEW_USERS,
        ':status': CONSTANTS.USER_OFFERS.OFFER_STATUSES.ACTIVE,
      },
    }

    const  result = await dynamo.query(getParams)
    if (result?.Items?.length > 0) {
      //Add an entry for each offer to the users offers table
      for await (const offer of result.Items) {
        const putParams = {
          TableName: DDB_TABLES.USER.OFFERS.NAME,
          Item: {
            user_id: userData.sub,
            offer_id: `${offer.global_offer_id}#${userData.sub}`,
            created_date: currentDate,
            expiry_date: offer.expiry_date,
            redeemed_date: null,
            offer_type: offer.offer_type,
            offer_data: offer.offer_data,
            status: CONSTANTS.USER_OFFERS.OFFER_STATUSES.ACTIVE,
          },
        }
        await dynamo.put(putParams)
      }
      logger(`Offers added for user ${userData.sub}: ${result?.Items?.length || 0}`)
      return
    }
    else {
      logger(`No active global offers for new users to add for user ${userData.sub}`)
      return
    }

  }
  catch (err) {
    //Offers are not critical so just log the error and move on - don't want to cause a failure in the signup process
    logger(`Error adding offers for user ${userData.sub}: ${err.message}`)
    return
  }
}


// Look up any offers and then add to the users offers table
export async function createNewUserAccount({ userData, dynamo }) {
  try {
    const currentDate = new Date().toISOString()

    const updateParams = {
      TableName: DDB_TABLES.USER.ACCOUNT_STATUS.NAME,
      Key: {
        user_id: userData.sub,
      },
      UpdateExpression: 'set ac_status = :acStatus, last_login = :lastLogin, plan_tier = :planTier, plan_status = :planStatus, plan_status_change = :planStatusChange, next_payment_date = :nextPaymentDate, account_creation_date = :acCreationDate',
      ExpressionAttributeValues: {
        ':acStatus': 'active',
        ':lastLogin': userData.currentDate,
        ':planTier': null,
        ':planStatus': 'inactive_signup',
        ':nextPaymentDate': null,
        ':planStatusChange': null,
        ':acCreationDate': currentDate,
      },
      ConditionExpression: 'attribute_not_exists(user_id)',
    }
    await dynamo.update(updateParams)
    logger(`User status record created for user ${userData.sub}`)

    const profileParams = {
      TableName: DDB_TABLES.USER.PROFILE.NAME,
      Item: {
        user_id: userData.sub,
        email: userData.email,
        ...(userData.phone ? { phone: userData.phone } : {}),
      },
      ConditionExpression: 'attribute_not_exists(user_id)',
    }
    await dynamo.put(profileParams)
    logger(`User profile record created for user ${userData.sub}`)
    return

  }
  catch (err) {
    const error = new Error(`User status record could not be created for user ${userData.sub}`)
    error.debug = err.message
    throw error
  }
}


// Send a welconme email to the user on signup - this is a non critical action so if it fails we just log the error and move on
export async function sendWelcomeEmail({ userData, InvokeCommand, lambdaClient }) {

  try {
    const currentDate = new Date().toISOString()
    const  payload = {
      messages: [{
        userId: userData.sub,
        msgEventCode: CONSTANTS.USER_MESSAGES.EVENT_CODES.NEW_ACCOUNT_WELCOME,
        msgRequestedDate: currentDate,
        msgScheduledDate:  CONSTANTS.USER_MESSAGES.MESSAGE_SCHEDULE.IMMEDIATE,
        msgData: { hasPhoneContact : false },
      }],
    }
    const command = new InvokeCommand({
      FunctionName: LAMBDA_NAMES.MESSAGE_MANAGER_LAMBDA,
      Payload: JSON.stringify(payload),
    })
    await lambdaClient.send(command)
    return
  }
  catch (err) {
    logger(`Error sending welcome email to user ${userData.sub}: ${err.message}`)
    return
  } 
}


