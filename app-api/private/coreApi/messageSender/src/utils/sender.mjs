
import {
  DynamoDB,
  DynamoDBDocument,
  sharedConfig,
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  SESv2Client,
  SendEmailCommand,
} from '/opt/nodejs/awsSdk_module/index.mjs'

import { DDB_TABLES, CONSTANTS } from '/opt/nodejs/core_module/index.mjs'

const dynamo = DynamoDBDocument.from(new DynamoDB(sharedConfig))
const s3 = new S3Client(sharedConfig)
const ses = new SESv2Client(sharedConfig)


// ----------------------------------------------------------------
// Fetch the HTML template from S3
// ----------------------------------------------------------------
export async function fetchTemplate(key, ENV) {
  const response = await s3.send(new GetObjectCommand({
    Bucket: ENV.TEMPLATES_BUCKET,
    Key: key,
  }))
  return await response.Body.transformToString('utf-8')
}

// ----------------------------------------------------------------
// Replace {{macro_name}} placeholders with values from msgData
// ----------------------------------------------------------------
export function mergeTemplate(template, msgData) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => msgData[key] ?? '')
}

// ----------------------------------------------------------------
// Extract <title> tag content to use as the email subject
// ----------------------------------------------------------------
export function extractSubject(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return match ? match[1].trim() : 'Message from Vendor Toolkit'
}

// ----------------------------------------------------------------
// Store the rendered HTML in S3 as an archive, return the S3 key
// ----------------------------------------------------------------
export async function archiveRenderedMessage(messageId, html, ENV) {
  const key = `${messageId}.html`
  await s3.send(new PutObjectCommand({
    Bucket: ENV.ARCHIVE_BUCKET,
    Key: key,
    Body: html,
    ContentType: 'text/html',
  }))
  return key
}

// ----------------------------------------------------------------
// Send an email via SES v2 — one send per address.
// Returns an array of per-address outcomes: { address, success, sesMessageId?, error? }
// Throws only if every address fails; 1+ successes is treated as overall success.
// ----------------------------------------------------------------
export async function sendEmail({ subject, htmlBody, recipients }, ENV) {
  const addresses = Array.isArray(recipients.value) ? recipients.value : [recipients.value]

  const outcomes = await Promise.all(
    addresses.map(async address => {
      try {
        const res = await ses.send(new SendEmailCommand({
          FromEmailAddress: ENV.SES_FROM_ADDRESS,
          Destination: { ToAddresses: [address] },
          Content: {
            Simple: {
              Subject: { Data: subject, Charset: 'UTF-8' },
              Body: { Html: { Data: htmlBody, Charset: 'UTF-8' } },
            },
          },
        }))
        return { address, success: true, sesMessageId: res.MessageId }
      } catch (err) {
        return { address, success: false, error: err?.message ?? 'Unknown error' }
      }
    }),
  )

  const successes = outcomes.filter(o => o.success)
  if (successes.length === 0) {
    const detail = outcomes.map(o => `${o.address}: ${o.error}`).join('; ')
    throw { message: 'All email sends failed', errors: { debug: detail } }
  }

  return outcomes
}

// ----------------------------------------------------------------
// Pre-check: if message is already COMPLETE, append a denial entry to
// send_status_log and return true so the caller can skip sending
// ----------------------------------------------------------------
export async function checkAndDenyDuplicateSend(messageId) {
  const result = await dynamo.get({
    TableName: DDB_TABLES.CORE.USER_MESSAGES.NAME,
    Key: { message_id: messageId },
  })
  const record = result?.Item
  if (!record || record.status !== CONSTANTS.USER_MESSAGES.STATUS.COMPLETE) {
    return false
  }

  const denialEntry = `Duplicate send denied at ${new Date().toISOString()}`
  const updatedLog = record.send_status_log
    ? `${record.send_status_log}\n${denialEntry}`
    : denialEntry

  await dynamo.update({
    TableName: DDB_TABLES.CORE.USER_MESSAGES.NAME,
    Key: { message_id: messageId },
    UpdateExpression: 'SET send_status_log = :log',
    ExpressionAttributeValues: { ':log': updatedLog },
  })

  return true
}

// ----------------------------------------------------------------
// Update vtk_core_user_messages with the send outcome
// ----------------------------------------------------------------
export async function updateMessageStatus({ messageId, status, sendStatus, sendStatusLog, messageArchive }) {
  return await dynamo.update({
    TableName: DDB_TABLES.CORE.USER_MESSAGES.NAME,
    Key: { message_id: messageId },
    UpdateExpression: 'SET #status = :status, send_status = :sendStatus, date_completed = :dateCompleted, send_status_log = :sendStatusLog, message_archive = :messageArchive',
    ExpressionAttributeNames: {
      '#status': 'status',
    },
    ExpressionAttributeValues: {
      ':status': status,
      ':sendStatus': sendStatus,
      ':dateCompleted': new Date().toISOString(),
      ':sendStatusLog': sendStatusLog,
      ':messageArchive': messageArchive ?? null,
    },
  })
}
