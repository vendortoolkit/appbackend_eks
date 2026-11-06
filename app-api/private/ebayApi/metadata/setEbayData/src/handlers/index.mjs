//------------------------------------------------------------
// Vendor Toolkit API
// ebayapi/metadata/{action}
//------------------------------------------------------------
// Load the lambda layer this includes all the core functions,

import {
  initEbayAPI,
  getEbayConfig,
} from '/opt/nodejs/ebayApi_module/index.mjs'


import {
  DynamoDB,
  DynamoDBDocument,
  sharedConfig,
  SSMClient,
  GetParametersCommand,
} from '/opt/nodejs/awsSdk_module/index.mjs'

import { DDB_TABLES } from '/opt/nodejs/core_module/index.mjs'
import { logger } from '../utils/logger.mjs'

import {
  updateSiteData,
  buildSiteIndex,
  scanCategories,
  updateCategoryTree,
  cleanCategoryTrees,
  updateSiteDetails,
  downloadItemSpecs,
} from '../utils/meta_cache_actions.mjs'


const preloadEbayConfig = getEbayConfig({
  SSMClient,
  GetParametersCommand,
  sharedConfig,
})

const dynamo = DynamoDBDocument.from(new DynamoDB(sharedConfig))

export const handler = async(event) => {
  let data = {}
  //Default Status Code and ack
  let statusCode = '200'
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  }

  
  // Get the SSM Params that were loaded in the Init stage
  const ebayConfig = await preloadEbayConfig

  try {

    //This script is designed to be run from eventbridge on a schedule
    const userId = ebayConfig?.defaultClientToken

    logger(event)
    //Get the action from event body, 
    data = await postHandler(userId, event?.Payload)
  
  } catch (err) {
    logger('Error in handler: ' + err.message)
    //Throw the error 
    const errorDetail = err?.errors ? err.errors : { debug: 'Unhandled error' }
    throw err.message + ' - ' + JSON.stringify(errorDetail)
  }
  return {
    statusCode,
    body: JSON.stringify(data),
    headers,
  }


  async function postHandler(userId, payload) {
  //We are epecting the body to have the following actions:
  //action: "updateSiteData" - this will get the site data from eBay and save it to DynamoDB
  //action: "updateCategories" - this will get the categories from eBay and save it to DynamoDB
  //Both have an optional "siteID" parameter, if not provided it will get all ebay sites, if provided it will only get the data for that siteID
    const {
      action,
      siteID = null,
    } = payload

    //Initial the eBay API object
    const ebayAPI = await initEbayAPI({ 
      userId, 
      ebayConfig, 
      dynamo, 
      DDB_TABLES, 
    })


    //Initial the eBay API object (app user) for actions that require an app token
    const clientEbayAPI = await initEbayAPI({ 
      userId: 'app', 
      ebayConfig, 
      dynamo, 
      DDB_TABLES, 
    })

    console.log('Initialized eBay API, executing action: ' + action)

    switch (action) {
    case 'buildSiteIndexes':
      logger('Executing buildSiteIndexes action')
      await updateSiteData({ ebayAPI, dynamo })
      await buildSiteIndex({ ebayAPI, dynamo })
      return
    case 'UpdateSiteDetails':
      logger('Executing UpdateSiteDetails action')
      await updateSiteDetails({ ebayAPI, siteID, dynamo })
      return
    case 'scanCategories':
      logger('Executing scanCategories action')
      return await scanCategories({ ebayAPI, siteID, dynamo })
    case 'updateCategoryTree':
      logger('Executing updateCategoryTree action')
      return await updateCategoryTree({ ebayAPI, dynamo })
    case 'cleanCategoryTrees':
      logger('Executing cleanCategoryTrees action')
      return await cleanCategoryTrees({ dynamo })
    case 'downloadItemSpecs':
      logger('Executing downloadItemSpecs action')
      return await downloadItemSpecs({ ebayAPI: clientEbayAPI, dynamo, metadataBucket: process.env.EBAY_METADATA_BUCKET })
    case 'downloadItemSpecsFull':
      logger('Executing downloadItemSpecsFull action')
      return await downloadItemSpecs({ ebayAPI: clientEbayAPI, action: 'full', dynamo, metadataBucket: process.env.EBAY_METADATA_BUCKET,  UPDATE_EBAY_ITEMSPECS_QUEUE: process.env.UPDATE_EBAY_ITEMSPECS_QUEUE  })
    default:
      throw {
        message: `Unsupported action "${action}"`,
        debug: '',
        restStatus: 500,
      }
    }
  }
}


