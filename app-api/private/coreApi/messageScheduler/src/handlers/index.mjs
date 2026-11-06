//------------------------------------------------------------
// Vendor Toolkit Core
// Backend process
// Message scheduler (Email or SMS). This will check the vtk_core_user_messages table and find any messages that need to be sent 
// Expecting an invoke from eventBridge schedule
//------------------------------------------------------------
// Load the lambda layer this includes all the core functions,
import {
  DynamoDB,
  DynamoDBDocument,
  sharedConfig,
  SQSClient,
  SendMessageCommand,
} from '/opt/nodejs/awsSdk_module/index.mjs'
import { DDB_TABLES, CONSTANTS } from '/opt/nodejs/core_module/index.mjs'
import { messageSuite } from '/opt/nodejs/messaging_module/index.mjs'

import { getScheduledMessages, getMsgEventData, getUser } from '../aws/dynamoHelpers.mjs'
import { logger } from '../utils/logger.mjs'

const dynamo = DynamoDBDocument.from(new DynamoDB( sharedConfig ))
const sqs = new SQSClient(sharedConfig)
const { dispatchMessage } = messageSuite(logger, SendMessageCommand, sqs)


export const handler = async() => {

  const currentTime = new Date().toISOString()
  logger('Starting Scheduled Messages Cron at : ' + currentTime)

  //Look up the messages where the  scheduled send date is less than the current time and have a status of AWAITING_SEND
  const scheduledMessages = await getScheduledMessages({ currentTime, dynamo })
  if (!scheduledMessages) {
    logger('No messages to send at this time')
    return
  }

  // Loop through the batch of messages to be sent
  for (const message of scheduledMessages.items) {

    try {
      // ------------------------------------------------------------
      // STAGE 0: Get the full messsage
      // ------------------------------------------------------------

      const mResult = await dynamo.get({
        TableName: DDB_TABLES.CORE.USER_MESSAGES.NAME,
        Key: { message_id: message.message_id },
      })
      const messageDetail = mResult?.Item

      logger(`Processing message for userID: ${messageDetail?.user_id}`)

      // ------------------------------------------------------------
      // STAGE 1: Validate the input data
      // ------------------------------------------------------------
      logger('STAGE 1: Validate the input data')
 

      //Get the message template from the message library based on the event_code 
      logger('Message Event Code: ' + messageDetail.event_code)
      const messageLib = await getMsgEventData({ eventCode: messageDetail.event_code, dynamo })

      //------------------------------------------------------------
      // STAGE 2: Build the message
      //------------------------------------------------------------
      logger('STAGE 2: Build the message')

      //Look up the users profile
      const userProfile = await getUser({ userId: messageDetail.user_id, dynamo })

      //Check if the user has opted into this type of message based on their preferences in their user profile
      //TRANSACTIONAL messages are compulsory and do not require an opt-in check
      //This was already checked at the point of scheduling the message, but we check again here in case the user has changed their preferences since the message was scheduled. If they have opted out of this type of message since it was scheduled, then we should not send it.
      const transactionalKey = Object.keys(CONSTANTS.USER_MESSAGES.MESSAGE_TYPE)
        .find(k => CONSTANTS.USER_MESSAGES.MESSAGE_TYPE[k] === CONSTANTS.USER_MESSAGES.MESSAGE_TYPE.TRANSACTIONAL)
      if (messageLib.message_type !== transactionalKey) {
        const marketingPreferences = userProfile.marketing_preferences
        const messageTypeKey = CONSTANTS.USER_MESSAGES.MESSAGE_TYPE?.[messageLib.message_type]
        if (!marketingPreferences?.[messageTypeKey]) {
          throw {
            message: 'User has not opted into this type of message',
            errors: { debug: `User has not opted into message type: ${messageLib.message_type}` },
          }
        }
      }

      // ----------------------------------------------------------------
      // STAGE 3: Dispatch the message
      // ----------------------------------------------------------------
      //Update the message status in the database.
      const status = CONSTANTS.USER_MESSAGES.STATUS.SENDING
      const dateQueued = new Date().toISOString()
    
      logger('Adding message to the send queue')
      await dispatchMessage({
        userId: messageDetail.user_id,
        messageId: messageDetail.message_id,
        msgData: messageDetail.message_data,
        messageLib,
        userProfile,
      })
           

      //------------------------------------------------------------
      // STAGE 4: Update the message status in the database
      //------------------------------------------------------------
      logger('STAGE 4: Update the message status in the database')

      await dynamo.update({
        TableName: DDB_TABLES.CORE.USER_MESSAGES.NAME,
        Key: { message_id: messageDetail.message_id },
        UpdateExpression: 'SET #status = :status, date_queued = :dateQueued',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':status': status,
          ':dateQueued': dateQueued,
        },
      })
      logger(`Message ${messageDetail.message_id} queued for sending at ${dateQueued}`)
    } catch (err) {
      logger(`messageSender: error — ${err?.message}`)
      logger(`messageSender: detail — ${JSON.stringify(err?.errors ?? err)}`)

      await dynamo.update({
        TableName: DDB_TABLES.CORE.USER_MESSAGES.NAME,
        Key: { message_id: message.message_id },
        UpdateExpression: 'SET #status = :status, send_status = :sendStatus, send_status_log = :sendStatusLog, date_completed = :dateCompleted' ,
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':status': CONSTANTS.USER_MESSAGES.STATUS.COMPLETE,
          ':sendStatus': CONSTANTS.USER_MESSAGES.SEND_STATUS.FAILED,
          ':sendStatusLog': `Error queuing message for sending: ${err?.message ?? 'Unknown error'}`,
          ':dateCompleted': new Date().toISOString(),
        },
      })  
    }
  }
  logger('All messages processed')
  return { message: 'Function executed successfully' }
}


