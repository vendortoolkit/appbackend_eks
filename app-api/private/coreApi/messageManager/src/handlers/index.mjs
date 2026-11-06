//------------------------------------------------------------
// Vendor Toolkit Core
// Backend process
// Create a message (Email or SMS) and add to the message queue for processing or schedule them to be sent at a later date
// Expecting a direct invoke with a payload containing the message details and recipient information
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


import { getMsgEventData, getUser } from '../aws/dynamoHelpers.mjs'
import { logger } from '../utils/logger.mjs'
import { v4 as uuidv4 } from 'uuid'

const dynamo = DynamoDBDocument.from(new DynamoDB( sharedConfig ))
const sqs = new SQSClient(sharedConfig)
const { dispatchMessage } = messageSuite(logger, SendMessageCommand, sqs)


export const handler = async(event) => {
  
  logger('Found Messages to be processed: ' + event?.messages?.length)

  // Loop through the batch of messages to be sent
  for (const message of event.messages) {

    logger(`Processing message for userID: ${message?.userId}`)

    try {
      // ------------------------------------------------------------
      // STAGE 1: Validate the input data
      // ------------------------------------------------------------
      logger('STAGE 1: Validate the input data')

      // userId - required string
      if (!message.userId || typeof message.userId !== 'string') {
        throw {
          message: 'Missing required attribute: userId',
          errors: { debug: 'userId is undefined, empty, or not a string' },
        }
      }

      // msgEventCode - required string (enum - further validation when type is known)
      if (!message.msgEventCode || typeof message.msgEventCode !== 'string') {
        throw {
          message: 'Missing required attribute: msgEventCode',
          errors: { debug: 'msgEventCode is undefined, empty, or not a string' },
        }
      }

      // msgRequestedDate - required UTC ISO datetime
      if (!message.msgRequestedDate || isNaN(Date.parse(message.msgRequestedDate))) {
        throw {
          message: 'Missing or invalid required attribute: msgRequestedDate',
          errors: { debug: `msgRequestedDate is not a valid ISO datetime: ${message.msgRequestedDate}` },
        }
      }

      // msgScheduledDate - required UTC ISO datetime or the string "IMMEDIATE"
      if (!message.msgScheduledDate || (message.msgScheduledDate !== 'IMMEDIATE' && isNaN(Date.parse(message.msgScheduledDate)))) {
        throw {
          message: 'Missing or invalid required attribute: msgScheduledDate',
          errors: { debug: `msgScheduledDate must be a valid ISO datetime or "IMMEDIATE": ${message.msgScheduledDate}` },
        }
      }

      // msgData - required object (deeper validation deferred until msgEventCode is resolved)
      if (!message.msgData || typeof message.msgData !== 'object' || Array.isArray(message.msgData)) {
        throw {
          message: 'Missing or invalid required attribute: msgData',
          errors: { debug: 'msgData is undefined or not a plain object' },
        }
      }

      //Get the message template from the message library based on the msgEventCode 
      logger('Message Event Code: ' + message.msgEventCode)
      const messageLib = await getMsgEventData({ eventCode: message.msgEventCode, dynamo })

      //Check message.msgData contains all the fields required by messageLib.message_mapping_data
      for (const requiredField of Object.keys(messageLib.message_mapping_data)) {
        if (!Object.prototype.hasOwnProperty.call(message.msgData, requiredField)) {
          throw {
            message: `Missing required field in msgData: ${requiredField}`,
            errors: { debug: `msgData is missing required field: ${requiredField}` },
          }
        }
      }
      logger('Input data validation successful')


      //------------------------------------------------------------
      // STAGE 2: Build the message
      //------------------------------------------------------------
      logger('STAGE 2: Build the message')

      //Look up the users profile
      const userProfile = await getUser({ userId: message.userId, dynamo })

      //Check if the user has opted into this type of message based on their preferences in their user profile
      //TRANSACTIONAL messages are compulsory and do not require an opt-in check
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

      //Create a uuid for the message
      const messageId = uuidv4()

      //Add the message to the database with a status of either AWAITING_SEND or SENDING depending on whether the message is scheduled for immediate sending or queued for sending.
      const status = message.msgScheduledDate === 'IMMEDIATE' ? CONSTANTS.USER_MESSAGES.STATUS.SENDING : CONSTANTS.USER_MESSAGES.STATUS.AWAITING_SEND
      const dateQueued = message.msgScheduledDate === 'IMMEDIATE' ? new Date().toISOString() : '0000-00-00T00:00:00.000Z'

    

      let sqsPayload = null
      //Check if this is an immediate sent or scheduled
      if (message.msgScheduledDate === 'IMMEDIATE') {
        logger('Message is scheduled for immediate sending')

        sqsPayload = await dispatchMessage({
          userId: message.userId,
          messageId,
          msgData: message.msgData,
          messageLib,
          userProfile,
        })
      } else {
        logger('Message is scheduled for future sending at: ' + message.msgScheduledDate)
      }

      const params = {
        TableName: DDB_TABLES.CORE.USER_MESSAGES.NAME,
        Item: {
          message_id: messageId,
          date_added: new Date().toISOString(),
          event_code: message.msgEventCode,
          user_id: message.userId,
          status: status,
          send_status: CONSTANTS.USER_MESSAGES.SEND_STATUS.NOT_SENT,
          scheduled_send_date: message.msgScheduledDate,
          scheduled_timeout: CONSTANTS.USER_MESSAGES.DEFAULT_SCHEDULE_TIMEOUT_MINS,
          message_template: messageLib.message_template,
          message_data: message.msgData,
          message_type: messageLib.message_type,
          date_queued: dateQueued,
          date_completed: '0000-00-00T00:00:00.000Z',
          send_status_log: null,
          message_archive: null,
          sqs_payload: JSON.stringify(sqsPayload),
        },
      }
      await dynamo.put(params)



    } catch (err) {
      logger('Error processing message for userID: ' + message?.userId)
      logger('Error details: ' + JSON.stringify(err))  

      //Flag the item as unsuccessful and record the error
      const data = { 
        user_id : message?.userId,
        payload : JSON.stringify(message),
        timestamp: new Date().toISOString(),
        debug_data: JSON.stringify(err?.errors),
        message: err?.message,
        source: 'messageManager',
      }
      await dynamo.put({
        TableName: DDB_TABLES.CORE.MESSAGE_ERROR_LOG.NAME,
        Item: data,
      })
    }
  }
  
  logger('All messages processed')
  return { message: 'Function executed successfully' }
}



