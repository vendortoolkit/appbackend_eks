//------------------------------------------------------------
// Vendor Toolkit Core
// Backend process
// API Gateway - registerInterest function
// Takes in a request from the API Gateway and creates a new item on the monday.com board with the provided information.
//------------------------------------------------------------
// handler.js


import { RecaptchaEnterpriseServiceClient } from '@google-cloud/recaptcha-enterprise'
import { logger } from '../utils/logger.mjs'
import { DDB_TABLES } from '/opt/nodejs/core_module/index.mjs'


import {
  sharedConfig,
  SSMClient,
  GetParametersCommand,
  DynamoDB,
  DynamoDBDocument,
  SESv2Client,
  SendEmailCommand,
} from '/opt/nodejs/awsSdk_module/index.mjs'


const PROJECT_ID = 'project-bb64d5f9-68db-459e-b1a'
const RECAPTCHA_KEY = '6Ld-w4UtAAAAAJkKnIa7rPts8gwbSo3vUzLlolPC'
const SSM_GCLOUD_CAPTCHA_KEY = '/vendortoolkit/gcloud/captcha/ri/key'
const preloadGCloudKey = getGCloudKey({  SSM_GCLOUD_CAPTCHA_KEY })


export const handler = async(event) => {

  const logid = event?.requestContext?.requestId?.split('-')[0] ?? null
  logger(logid ? `Request ID: ${logid}` : 'No request ID found', logid)

  const glcloudKey = await preloadGCloudKey
  const gcloudServiceAccount = glcloudKey[SSM_GCLOUD_CAPTCHA_KEY]
  const gcloudCredentials = JSON.parse(gcloudServiceAccount)


  //Default Status Code and ack
  let statusCode = '200'

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  }
  try{ 

    logger(`Received request to register interest: ${JSON.stringify(event.body)}`, logid)

    const body = JSON.parse(event.body)
    const { token, recaptchaAction } = body

    //For Recaptcha accuracy we need get userAgent, userIpAddress, ja4, ja3
    const userAgent = event.headers['User-Agent'] || ''
    const userIpAddress = event.headers['X-Forwarded-For'] || ''

    const assessmentResult = await createAssessment({ token, recaptchaAction, gcloudCredentials, userIpAddress, userAgent, logid })
      
    if ( assessmentResult.result === 'reject') {
      throw new Error('reCAPTCHA assessment failed: reject')
    }
    
    /*
    const RiResult = await createMondayItem({
      name: body?.name,
      email: body?.email,
      phone: body?.phone,
      message: body?.message,
      source: body?.source,
      countrycode: body?.countrycode || 'GB',
      logid,
    })
    */
    
    await createRiItem({
      name: body?.name,
      email: body?.email,
      phone: body?.phone,
      message: body?.message,
      source: body?.source,
      countrycode: body?.countrycode || 'GB',
      logid,
    })

    return {
      statusCode,
      body: JSON.stringify({ ack: 'success', message: 'Interest registered successfully' }),
      headers,
    }
  } catch (err) {
    //Provide a standard error output
    statusCode = err?.restStatus ? err.restStatus : 400
    const errorDetail = err?.errors ? err.errors : { debug: 'Unhandled error' }
    logger(`Error in registerInterest handler: ${err.message}`, logid)
    return {
      statusCode,
      body: JSON.stringify({ ack: 'error', message: err.message, errors: errorDetail }),
      headers,
    }
  }
}

async function createAssessment({
  token = false,
  recaptchaAction = false,
  gcloudCredentials = false,
  userIpAddress = false,
  userAgent = false,
  logid = null,
}) {

  if (!token) {
    throw new Error('reCAPTCHA token is required')
  }

  if (!recaptchaAction) {
    throw new Error('reCAPTCHA action is required')
  }

  logger(`Creating reCAPTCHA assessment for action: ${recaptchaAction}`, logid)
  // Create the reCAPTCHA client.
  // TODO: Cache the client generation code (recommended) or call client.close() before exiting the method.
  const client = new RecaptchaEnterpriseServiceClient({
    credentials: gcloudCredentials || undefined,
    projectId: PROJECT_ID,
  })
  const projectPath = client.projectPath(PROJECT_ID)

  // Build the assessment request.
  const request = {
    assessment: {
      event: {
        token,
        siteKey: RECAPTCHA_KEY,
        userAgent,
        userIpAddress,
      },
    },
    parent: projectPath,
  }

  const [response] = await client.createAssessment(request)
  client.close()

  if (!response?.tokenProperties?.valid) {
    const invalidReason = response?.tokenProperties?.invalidReason || 'unknown reason'
    logger(`The CreateAssessment call failed because the token was: ${invalidReason}`, logid)
    throw new Error(`reCAPTCHA token invalid: ${invalidReason}`)
  }

  if (response.tokenProperties.action !== recaptchaAction) {
    logger('The action attribute in your reCAPTCHA tag does not match the action you are expecting to score', logid)
    throw new Error('reCAPTCHA action mismatch')
  }

  const score = response?.riskAnalysis?.score
  if (typeof score !== 'number') {
    logger('Missing reCAPTCHA risk analysis score', logid)
    throw new Error('reCAPTCHA score unavailable')
  }

  logger(`The reCAPTCHA score is: ${score}`, logid)

  if (score >= 0.7) {
    return { result: 'pass' }
  }

  if (score > 0.3 && score < 0.7) {
    return { result: 'verify' }
  }

  return { result: 'reject' }
}


//GCloud helper function
async function getGCloudKey({ SSM_GCLOUD_CAPTCHA_KEY }) {

  const ssm = new SSMClient(sharedConfig)

  const params = {
    Names: [SSM_GCLOUD_CAPTCHA_KEY],
    WithDecryption: true,
  }

  try {
    const command = new GetParametersCommand(params)
    const res = await ssm.send(command)

    const result = {}
    res.Parameters.forEach((param) => {
      //return each with their original key names
      result[param.Name] = param.Value
    })
    return result
  } catch (err) {
    throw new Error(`Error getting GCloud Key (${SSM_GCLOUD_CAPTCHA_KEY}) from SSM: ${err.message}`, { cause: err })
  }
}


async function createRiItem({ name, email, phone, countrycode, message, source, logid })  {

  if (!name || !email || !message || !source) {
    throw new Error('Missing required fields: name, email, message, and source are required')
  }

  logger(`Creating RegisterInterest item for ${name} with email: ${email}, phone: ${phone}, message: ${message}, source: ${source}`, logid)

  const dynamo = DynamoDBDocument.from(new DynamoDB( sharedConfig ))

  const data = {
    status: 'New',
    date_updated: new Date().toISOString(),
    date_created: new Date().toISOString(),
    user_email: email,
    user_phone: phone,
    user_phone_countrycode: countrycode,
    user_source: source,
    user_message: message,
    admin_notes: '',
  }

  const params = {
    TableName: DDB_TABLES.VTKSOLUTIONS.WEBSITE_RI.NAME,
    Item: data,
  }

  try {
    await dynamo.put(params)
  } catch (err) {
    logger(`Error adding RegisterInterest item to DynamoDB: ${err.message}`, logid)
    throw new Error(`Error adding RegisterInterest item to DynamoDB: ${err.message}`, { cause: err })
  }
  logger('RegisterInterest item added to DynamoDB successfully', logid)

  //Send an email to the admin to notify them of the new interest registration
  const emailResult = await sendEmail({
    subject: `New RegisterInterest from ${name}`,
    htmlBody: `<p>Name: ${name}</p><p>Email: ${email}</p><p>Phone: (${countrycode}) ${phone}</p><p>Message: ${message}</p><p>Source: ${source}</p>`,
    recipients: { value: process.env.ADMIN_EMAIL_ADDRESS },
  }, process.env.SES_FROM_ADDRESS)
  if (emailResult.ack === 'failure') {
    logger(`${emailResult.message}`, logid)
  }
  else {
    logger('RegisterInterest email sent successfully', logid)
  }
  
  return { message: 'RegisterInterest item added to DynamoDB successfully', ack: 'success' }
}


// ----------------------------------------------------------------
// Send an email via SES v2 — one send per address.
// Returns an array of per-address outcomes: { address, success, sesMessageId?, error? }
// Throws only if every address fails; 1+ successes is treated as overall success.
// ----------------------------------------------------------------
export async function sendEmail({ subject, htmlBody, recipients }, ENV) {
  const ses = new SESv2Client(sharedConfig)

  const addresses = Array.isArray(recipients.value) ? recipients.value : [recipients.value]

  const outcomes = await Promise.all(
    addresses.map(async address => {
      try {
        const res = await ses.send(new SendEmailCommand({
          FromEmailAddress: ENV,
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
    return { message: `RegisterInterest email failed: ${detail}`, ack: 'failure' }
  }
  return { message: 'RegisterInterest email was successful', ack: 'success' }
}

/*
//No longer used but kept for reference. This function creates a new item on the monday.com board with the provided information. It uses the monday.com GraphQL API to create the item and returns the item ID if successful. If there are any errors during the process, it logs the error and throws an exception.
async function createMondayItem({ name, email, phone, countrycode, message, source, logid })  {


  if (!name || !email || !message || !source) {
    throw new Error('Missing required fields: name, email, message, and source are required')
  }

  logger(`Creating monday item for ${name} with email: ${email}, phone: ${phone}, message: ${message}, source: ${source}`, logid)

  const MONDAY_API_TOKEN = process.env.MONDAY_API_TOKEN
  const BOARD_ID = 5101946978

  const COLS = {
    email:   'email_mm63xgd9',
    phone:   'phone_mm63xr82',
    message: 'long_text_mm635ztq',
    source:  'dropdown_mm63tjn1',
    status:  'color_mm637azf',
    date:    'date_mm637n2n',
  }

  const SOURCE_IDS = {
    'Website':      1,
    'Google':       2,
    'Social Media': 3,
    'Referral':     4,
    'Other':        5,
  }

  const query = `
  mutation CreateEnquiry($boardId: ID!, $name: String!, $cols: JSON!) {
    create_item(board_id: $boardId, item_name: $name, column_values: $cols) {
      id
    }
  }`

  try{ 

    const columnValues = {
      [COLS.email]:   { email, text: email },
      [COLS.phone]:   { phone: phone ?? '', countryShortName: countrycode },
      [COLS.message]: { text: message },
      [COLS.source]:  { ids: [SOURCE_IDS[source] ?? SOURCE_IDS['Other']] },
      [COLS.status]:  { label: 'New' },
      [COLS.date]:    { date: new Date().toISOString().split('T')[0] },
    }

    const response = await fetch('https://api.monday.com/v2', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': MONDAY_API_TOKEN,
        'API-Version':   '2024-01',
      },
      body: JSON.stringify({
        query,
        variables: {
          boardId: BOARD_ID,
          name,
          cols: JSON.stringify(columnValues),
        },
      }),
    })

    const data = await response.json()

    if (data.errors) {
      logger(`monday API error: ${JSON.stringify(data.errors)}`, logid)  
      throw new Error(`monday API error: ${JSON.stringify(data.errors)}`)
    }
  
    logger(`Monday item created successfully: ${data.data.create_item.id}`, logid)
    return { itemId: data.data.create_item.id, message: 'Monday item created successfully', ack: 'success' }
  } catch (err) {
    logger(`Error creating monday item: ${err.message}`, logid)
    throw new Error(`Error creating monday item: ${err.message}`, { cause: err })
  }
}
*/
