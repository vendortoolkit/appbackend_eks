//------------------------------------------------------------
// Vendor Toolkit API
// ebayapi/metadata/getEbayData
//------------------------------------------------------------

import {
  DynamoDB,
  DynamoDBDocument,
  sharedConfig,
  SSMClient,
  GetParametersCommand,
} from '/opt/nodejs/awsSdk_module/index.mjs'

import {
  initEbayAPI,
  getEbayConfig,
} from '/opt/nodejs/ebayApi_module/index.mjs'

import { DDB_TABLES } from '/opt/nodejs/core_module/index.mjs'
import { logger } from '../utils/logger.mjs'
import {
  getActionFromEvent,
  getRequiredQueryParams,
} from '../utils/helpers.mjs'
import {
  getSites,
  getRootCategories,
  getSubCategories,
  searchCategories,
  getCategoryPath,
  getCategoryDetail,
  validateCategory,
  getTreeMetadata,
} from '../utils/meta_get_actions.mjs'

const dynamo = DynamoDBDocument.from(new DynamoDB(sharedConfig))

const preloadEbayConfig = getEbayConfig({
  SSMClient,
  GetParametersCommand,
  sharedConfig,
})

export const handler = async(event) => {
  let data = {}
  let statusCode = '200'
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  }

  // Get the SSM Params that were loaded in the Init stage
  const ebayConfig = await preloadEbayConfig

  try {
    if (event.httpMethod !== 'GET') {
      throw {
        message: `Unsupported method "${event.httpMethod}"`,
        debug: '',
        restStatus: 405,
      }
    }

    data = await getHandler({ event, ebayConfig })
  } catch (err) {
    statusCode = err?.restStatus ? err.restStatus : 400
    const errorDetail = err?.errors ? err.errors : { debug: 'Unhandled error' }
    data = { error: { message: err.message, errors: errorDetail } }
  }

  return {
    statusCode,
    body: JSON.stringify(data),
    headers,
  }
}

async function getHandler({ event, ebayConfig }) {
  const action = getActionFromEvent(event)
  const qs = event?.queryStringParameters

  logger('getEbayData action requested: ' + action)

  switch (action) {
  case 'sites':
    return await getSites({ dynamo })
  case 'root-categories': {
    const { site_id } = getRequiredQueryParams({ qs, fields: ['site_id'] })
    return await getRootCategories({ siteId: site_id, dynamo })
  }
  case 'sub-categories': {
    const { site_id, parent_id } = getRequiredQueryParams({ qs, fields: ['site_id', 'parent_id'] })
    return await getSubCategories({ siteId: site_id, parentId: parent_id, dynamo })
  }
  case 'category-search': {
    const userId = ebayConfig?.defaultClientToken

    // Initial the eBay API object
    const ebayAPI = await initEbayAPI({
      userId,
      ebayConfig,
      dynamo,
      DDB_TABLES,
    })

    const { site_id, q } = getRequiredQueryParams({ qs, fields: ['site_id', 'q'] })
    return await searchCategories({ siteId: site_id, searchTerm: q, limit: qs?.limit, ebayAPI, dynamo })
  }
  case 'category-path': {
    const { site_id, category_id } = getRequiredQueryParams({ qs, fields: ['site_id', 'category_id'] })
    return await getCategoryPath({ siteId: site_id, categoryId: category_id, dynamo })
  }
  case 'category-detail': {
    const { site_id, category_id } = getRequiredQueryParams({ qs, fields: ['site_id', 'category_id'] })
    return await getCategoryDetail({ siteId: site_id, categoryId: category_id, dynamo })
  }
  case 'category-validation': {
    const { site_id, category_id } = getRequiredQueryParams({ qs, fields: ['site_id', 'category_id'] })
    return await validateCategory({ siteId: site_id, categoryId: category_id, dynamo })
  }
  case 'tree-metadata': {
    const { site_id } = getRequiredQueryParams({ qs, fields: ['site_id'] })
    return await getTreeMetadata({ siteId: site_id, dynamo })
  }
  default:
    throw {
      message: `Unsupported action "${action}"`,
      errors: {
        debug: 'Supported actions: sites, root-categories, sub-categories, category-search, category-path, category-detail, category-validation, tree-metadata',
      },
      restStatus: 400,
    }
  }
}
