//------------------------------------------------------------
// Vendor Toolkit Cognito Triggers
// Backend process
// Expecting an Cognito Trigger Payload
//------------------------------------------------------------
// Load the lambda layer this includes all the core functions,
import {
  sharedConfig,
  DynamoDB,
  DynamoDBDocument,
  LambdaClient,
  InvokeCommand,
} from '/opt/nodejs/awsSdk_module/index.mjs'
import { DDB_TABLES } from '/opt/nodejs/core_module/index.mjs'
import { addToDDBLog } from '../aws/dynamoHelpers.mjs'
import { logger } from '../utils/logger.mjs'
import { createNewUserAccount, addUserOffers, sendWelcomeEmail } from '../actions/accountActions.mjs'
const dynamo = DynamoDBDocument.from(new DynamoDB(sharedConfig))
const lambdaClient = new LambdaClient(sharedConfig)

export const handler = async(event) => {

  const userData = {}
  let triggerSource = null
  const currentDate = new Date().toISOString()

  try {
    //Check user attributes have been provided
    const userAttributes = event?.request?.userAttributes
    if (!userAttributes) {
      const msg = 'User Attributes have not been provided in the request'
      logger(msg)
      const error = new Error('Invalid request data provided')    //Caculate the Log TTL time (Unix Timestamp) 
      error.debug = msg
      throw error
    }

    //Validate the user attributes
    const { sub = null, email = null, email_verified = null, phone_number = null } = userAttributes
    const user_confirmed = userAttributes?.['cognito:user_status'] === 'CONFIRMED'
    if (!sub || !email || !email_verified || !user_confirmed) {
      const msg = 'Invalid user attributes or user/email is not confirmed: ' + JSON.stringify(userAttributes)
      logger(msg)
      const error = new Error('Invalid request data provided')
      error.debug = msg    //Caculate the Log TTL time (Unix Timestamp) 
      throw error
    }

    Object.assign(userData, { sub, email, currentDate, ...(phone_number ? { phone: phone_number } : {}) })

    //Validate the trigger source (check it's an event we handle)  
    triggerSource = event?.triggerSource
    if (triggerSource !== 'PostConfirmation_ConfirmSignUp') {
      const msg = `Invalid trigger source: ${triggerSource}`
      logger(msg)
      const error = new Error('Invalid request data provided')
      error.debug = msg
      throw error
    }

    //All tests ok - do "new account" processes
    await createNewUserAccount({ userData, dynamo })
    await addUserOffers({ userData, dynamo })
    await sendWelcomeEmail({ userData, lambdaClient, InvokeCommand })

    //Log the job as successful and record the success
    //Record the sign up in database log
    const logData = {
      user_id: userData.sub,
      user_email: userData.email,
      timestamp: userData.currentDate,
      payload: JSON.stringify(event),
      signup_stage: triggerSource,
    }

    await addToDDBLog({
      data: logData,
      tableName: DDB_TABLES.USER.APP_SIGNUP_LOG.NAME,
      dynamo,
    })

    //All done return the Cognito payload
    return (event)

  }
  catch (err) {

    //Flag the job as unsuccessful and record the error
    const data = {
      message: err?.message,
      debug_data: err?.errors,
      source: 'core_post-signup_confirmation',
    }
    logger('data:' + JSON.stringify(data, null, 2))

    //Only log the error in DynamoDB is we have a valid user sub and timestamp, otherwise the error will go into CloudWatch
    if (userData?.sub && userData?.currentDate) {

      //Record the error in the database log 
      const logData = {
        user_id: userData.sub,
        user_email: userData.email,
        timestamp: userData.currentDate,
        payload: JSON.stringify(event),
        signup_stage: triggerSource,
        message: err?.message,
        debug_data: err?.debug,
        ttl: Math.floor(Date.now() / 1000) + (DDB_TABLES.STRIPE.WEBHOOK_LOG.TTL_DAYS * 24 * 60 * 60),
      }

      await addToDDBLog({
        data: logData,
        tableName: DDB_TABLES.USER.APP_SIGNUP_ERROR_LOG.NAME,
        dynamo,
      })
    }
    return (event)

  }
}
