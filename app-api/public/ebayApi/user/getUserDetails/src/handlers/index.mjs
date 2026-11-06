//------------------------------------------------------------
// Vendor Toolkit API
// ebayapi/user/details  (standalone Node.js version)
//------------------------------------------------------------
import { getEbayUserDetails } from '../ebay/ebayHelpers.mjs'
import { saveEbayUserDetails } from '../aws/dynamoHelpers.mjs'

const loadLayer = async (layerPath) => { 
  console.log(`Loading layer from path: ${process.env.APP_ROOT + layerPath}`)
  return await import(process.env.APP_ROOT + layerPath) 
}
const  { initEbayAPI, getEbayConfig } = await loadLayer('/layers/ebayapi/index.mjs')
const { DynamoDB, DynamoDBDocument, sharedConfig, SSMClient, GetParametersCommand } = await loadLayer('/layers/awssdk/index.mjs')
const { DDB_TABLES } = await loadLayer('/layers/core/index.mjs')


const preloadEbayConfig = getEbayConfig({
  SSMClient,
  GetParametersCommand,
  sharedConfig,
})

const dynamo = DynamoDBDocument.from(new DynamoDB(sharedConfig))

export const handler = async(event) => {
  // Get the SSM Params that were loaded in the Init stage
  const ebayConfig = await preloadEbayConfig

  const userIdFromToken = event.requestContext.authorizer.claims.sub

  //Future updates check if this is an admin userID and the allow CRUD on other accounts eg. the one in the query string
  let userId = userIdFromToken

  let data = {}
  //Default Status Code and ack
  let statusCode = '200'
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  }

  try {
    switch (event.httpMethod) {
    case 'GET':
      data = await getHandler(userId)
      break
    default:
      throw {
        message: `Unsupported method "${event.httpMethod}"`,
        debug: '',
        restStatus: 500,
      }
    }
  } catch (err) {
    //Provide a standard error output
    statusCode = err?.restStatus ? err.restStatus : 400
    const errorDetail = err?.errors ? err.errors : { debug: 'Unhandled error' }
    data = { error: { message: err.message, errors: errorDetail } }
  }

  return {
    statusCode,
    body: JSON.stringify(data),
    headers,
  }

  async function getHandler(userId) {
    //Get the users eBay details
    try {
      //Initial the eBay API object when we have a userId
      const ebayAPI = await initEbayAPI({ 
        userId, 
        ebayConfig, 
        dynamo, 
        DDB_TABLES, 
      })
      const ebayDetails = await getEbayUserDetails({ ebayAPI })

      //Add to DynamoDB
      await saveEbayUserDetails({ 
        userId, 
        ebayDetails, 
        DDB_TABLES, 
        dynamo, 
      })

      return ebayDetails 
 
    } catch (err) {
      throw {
        message: 'Unable to get user token',
        errors: { debug: err.message },
        restStatus: 400,
      }
    }
  }
}
