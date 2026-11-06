//------------------------------------------------------------
// Vendor Toolkit Core
// Backend process: Message Sender
// Triggered via SQS. Reads message dispatch payloads, fetches the
// HTML template from S3, merges macros, sends via SES, and updates
// vtk_core_user_messages with the outcome.
//------------------------------------------------------------
import { logger } from '../utils/logger.mjs'
import { CONSTANTS } from '/opt/nodejs/core_module/index.mjs'
import { fetchTemplate, mergeTemplate, extractSubject, archiveRenderedMessage, sendEmail, updateMessageStatus, checkAndDenyDuplicateSend } from '../utils/sender.mjs'

const ENV = {
  TEMPLATES_BUCKET: process.env.MESSAGE_TEMPLATES_BUCKET,
  ARCHIVE_BUCKET: process.env.MESSAGE_ARCHIVE_BUCKET,
  SES_FROM_ADDRESS: process.env.SES_FROM_ADDRESS,
}

// ----------------------------------------------------------------
// Handler -- entry point for the Lambda function
// ----------------------------------------------------------------
export const handler = async(event) => {
  const batchItemFailures = []

  // Support SQS trigger (event.Records) and direct invocation (event.directInvoke)
  let records = []
  if (event?.directInvoke) {
    records = event.directInvoke
  } else if (event?.Records) {
    records = event.Records
  }

  logger('messageSender: records to process: ' + records.length)

  for (const record of records) {
    let job
    try {
      logger(`messageSender: processing SQS messageId: ${record?.messageId ?? 'direct-invoke'}`)

      // ----------------------------------------------------------
      // STAGE 1: Parse the body
      // ----------------------------------------------------------
      job = typeof record.body === 'string' ? JSON.parse(record.body) : record

      const { userId, message_id, msgData, msgTemplate, recipients } = job

      // ----------------------------------------------------------
      // STAGE 2: Validate required fields
      // ----------------------------------------------------------
      if (!userId || typeof userId !== 'string') {
        throw { message: 'Invalid payload: missing userId', errors: { debug: 'userId missing or not a string' } }
      }
      if (!message_id || typeof message_id !== 'string') {
        throw { message: 'Invalid payload: missing message_id', errors: { debug: 'message_id missing or not a string' } }
      }
      if (!msgData || typeof msgData !== 'object' || Array.isArray(msgData)) {
        throw { message: 'Invalid payload: msgData must be a plain object', errors: { debug: 'msgData missing or wrong type' } }
      }
      if (!msgTemplate || typeof msgTemplate !== 'string') {
        throw { message: 'Invalid payload: missing msgTemplate', errors: { debug: 'msgTemplate missing or not a string' } }
      }
      if (!recipients?.type || !recipients?.value) {
        throw { message: 'Invalid payload: missing recipients', errors: { debug: 'recipients.type or recipients.value missing' } }
      }

      // ----------------------------------------------------------
      // STAGE 2b: Pre-check — deny if message is already COMPLETE
      // ----------------------------------------------------------
      const isDuplicate = await checkAndDenyDuplicateSend(message_id)
      if (isDuplicate) {
        logger(`messageSender: message_id: ${message_id} is already COMPLETE — duplicate send denied`)
        continue
      }

      // ----------------------------------------------------------
      // STAGE 3: Channel routing — EMAIL only for now
      // ----------------------------------------------------------
      if (recipients.type !== 'EMAIL') {
        logger(`messageSender: unsupported channel "${recipients.type}" — skipping message_id: ${message_id}`)
        continue
      }

      // ----------------------------------------------------------
      // STAGE 4: Fetch template from S3 and merge macros
      // ----------------------------------------------------------
      logger(`messageSender: Fetching template "${msgTemplate}" from S3`)
      const rawTemplate = await fetchTemplate(msgTemplate, ENV)
      const renderedHtml = mergeTemplate(rawTemplate, msgData, ENV)
      const subject = extractSubject(renderedHtml, ENV)
      logger(`messageSender: Template rendered, subject: "${subject}"`)

      // ----------------------------------------------------------
      // STAGE 5: Send email via SES — one send per address
      // ----------------------------------------------------------
      logger(`messageSender: Sending email to: ${JSON.stringify(recipients.value)}`)
      const sendResults = await sendEmail({ subject, htmlBody: renderedHtml, recipients }, ENV)
      logger(`messageSender: Email send complete for message_id: ${message_id} — ${sendResults.filter(r => r.success).length}/${sendResults.length} succeeded`)

      // ----------------------------------------------------------
      // STAGE 6: Archive the rendered message to S3
      // ----------------------------------------------------------
      const archiveKey = await archiveRenderedMessage(message_id, renderedHtml, ENV)
      logger(`messageSender: Archived to S3 key: ${archiveKey}`)

      // ----------------------------------------------------------
      // STAGE 7: Update DynamoDB — success
      // ----------------------------------------------------------
      await updateMessageStatus({
        messageId: message_id,
        status: CONSTANTS.USER_MESSAGES.STATUS.COMPLETE,
        sendStatus: CONSTANTS.USER_MESSAGES.SEND_STATUS.SUCCESS,
        sendStatusLog: sendResults.map(r => r.success
          ? `SENT ${r.address}`
          : `FAILED ${r.address}: ${r.error}`,
        ).join('\n'),
        messageArchive: archiveKey,
      }, ENV)
      logger(`messageSender: message_id: ${message_id} marked COMPLETE / SUCCESS`)

    } catch (err) {
      logger(`messageSender: error — ${err?.message}`)
      logger(`messageSender: detail — ${JSON.stringify(err?.errors ?? err)}`)

      // Update DDB with failure status so the message isn't left in "sending"
      const failId = job?.message_id
      if (failId) {
        try {
          await updateMessageStatus({
            messageId: failId,
            status: CONSTANTS.USER_MESSAGES.STATUS.COMPLETE,
            sendStatus: CONSTANTS.USER_MESSAGES.SEND_STATUS.FAILED,
            sendStatusLog: err?.message ?? 'Unknown error during send',
            messageArchive: null,
          }, ENV)
        } catch (dbErr) {
          logger(`messageSender: failed to update DynamoDB for message_id: ${failId} — ${dbErr?.message}`)
        }
      }

      // Flag record for SQS retry / DLQ
      if (record?.messageId) {
        batchItemFailures.push({ itemIdentifier: record.messageId })
      }
    }
  }

  return { batchItemFailures }
}

