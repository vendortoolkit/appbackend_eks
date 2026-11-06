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
  downloadItemSpecs, getSiteIndex,
} from '../utils/meta_cache_actions.mjs'


const preloadEbayConfig = getEbayConfig({
  SSMClient,
  GetParametersCommand,
  sharedConfig,
})

const dynamo = DynamoDBDocument.from(new DynamoDB(sharedConfig))

export const handler = async(event) => {
  
  // Get the SSM Params that were loaded in the Init stage
  const ebayConfig = await preloadEbayConfig
  let data

  try {

    //This script is designed to be directly from a step function in a state machine, so the event is expected to be the payload from the previous step
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
  return data

  async function postHandler(userId, payload) {
    const {
      action,
      siteID = null,
    } = payload


    //Initial the eBay API object (app user) for actions that require an app token
    const clientEbayAPI = await initEbayAPI({ 
      userId: 'app', 
      ebayConfig, 
      dynamo, 
      DDB_TABLES, 
    })

    logger('Initialized eBay API, executing action: ' + action)

    switch (action) {
    case 'downloadItemSpecs':
      logger('Executing downloadItemSpecs action')
      return await downloadItemSpecs({ siteID, ebayAPI: clientEbayAPI, dynamo, metadataBucket: process.env.EBAY_METADATA_BUCKET })
    case 'downloadItemSpecsFull':
      logger('Executing downloadItemSpecsFull action')
      return await downloadItemSpecs({ siteID, ebayAPI: clientEbayAPI, action: 'full', dynamo, metadataBucket: process.env.EBAY_METADATA_BUCKET,  UPDATE_EBAY_ITEMSPECS_QUEUE: process.env.UPDATE_EBAY_ITEMSPECS_QUEUE  })
    case 'getSiteIndex':
      logger('Executing getSiteIndex action')
      return await getSiteIndex({ siteID, dynamo })
    default:
      throw {
        message: `Unsupported action "${action}"`,
        debug: '',
      }
    }
  }
}


