import eBayApi from 'ebay-api'

const prodScopes = [
  'https://api.ebay.com/oauth/api_scope',
  'https://api.ebay.com/oauth/api_scope/sell.marketing.readonly',
  'https://api.ebay.com/oauth/api_scope/sell.marketing',
  'https://api.ebay.com/oauth/api_scope/sell.inventory.readonly',
  'https://api.ebay.com/oauth/api_scope/sell.inventory',
  'https://api.ebay.com/oauth/api_scope/sell.account.readonly',
  'https://api.ebay.com/oauth/api_scope/sell.account',
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly',
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
  'https://api.ebay.com/oauth/api_scope/sell.analytics.readonly',
  'https://api.ebay.com/oauth/api_scope/sell.finances',
  'https://api.ebay.com/oauth/api_scope/sell.payment.dispute',
  'https://api.ebay.com/oauth/api_scope/commerce.identity.readonly',
  'https://api.ebay.com/oauth/api_scope/sell.reputation',
  'https://api.ebay.com/oauth/api_scope/sell.reputation.readonly',
  'https://api.ebay.com/oauth/api_scope/commerce.notification.subscription',
  'https://api.ebay.com/oauth/api_scope/commerce.notification.subscription.readonly',
  'https://api.ebay.com/oauth/api_scope/sell.stores',
  'https://api.ebay.com/oauth/api_scope/sell.stores.readonly',
  'https://api.ebay.com/oauth/scope/sell.edelivery',
  'https://api.ebay.com/oauth/api_scope/commerce.vero',
]

const sandScopes = [
  'https://api.ebay.com/oauth/api_scope',
  'https://api.ebay.com/oauth/api_scope/buy.order.readonly',
  'https://api.ebay.com/oauth/api_scope/buy.guest.order',
  'https://api.ebay.com/oauth/api_scope/sell.marketing.readonly',
  'https://api.ebay.com/oauth/api_scope/sell.marketing',
  'https://api.ebay.com/oauth/api_scope/sell.inventory.readonly',
  'https://api.ebay.com/oauth/api_scope/sell.inventory',
  'https://api.ebay.com/oauth/api_scope/sell.account.readonly',
  'https://api.ebay.com/oauth/api_scope/sell.account',
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly',
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
  'https://api.ebay.com/oauth/api_scope/sell.analytics.readonly',
  'https://api.ebay.com/oauth/api_scope/sell.marketplace.insights.readonly',
  'https://api.ebay.com/oauth/api_scope/commerce.catalog.readonly',
  'https://api.ebay.com/oauth/api_scope/buy.shopping.cart',
  'https://api.ebay.com/oauth/api_scope/buy.offer.auction',
  'https://api.ebay.com/oauth/api_scope/commerce.identity.readonly',
  'https://api.ebay.com/oauth/api_scope/commerce.identity.email.readonly',
  'https://api.ebay.com/oauth/api_scope/commerce.identity.phone.readonly',
  'https://api.ebay.com/oauth/api_scope/commerce.identity.address.readonly',
  'https://api.ebay.com/oauth/api_scope/commerce.identity.name.readonly',
  'https://api.ebay.com/oauth/api_scope/commerce.identity.status.readonly',
  'https://api.ebay.com/oauth/api_scope/sell.finances',
  'https://api.ebay.com/oauth/api_scope/sell.payment.dispute',
  'https://api.ebay.com/oauth/api_scope/sell.item.draft',
  'https://api.ebay.com/oauth/api_scope/sell.item',
  'https://api.ebay.com/oauth/api_scope/sell.reputation',
  'https://api.ebay.com/oauth/api_scope/sell.reputation.readonly',
  'https://api.ebay.com/oauth/api_scope/commerce.notification.subscription',
  'https://api.ebay.com/oauth/api_scope/commerce.notification.subscription.readonly',
  'https://api.ebay.com/oauth/api_scope/sell.stores',
  'https://api.ebay.com/oauth/api_scope/sell.stores.readonly',
  'https://api.ebay.com/oauth/api_scope/commerce.vero',
]


const ssmparams = [{
  env: 'sandbox',
  appId: '/vendortoolkit/ebayapi/sandbox/appId',
  certId: '/vendortoolkit/ebayapi/sandbox/certId',
  devId: '/vendortoolkit/ebayapi/sandbox/devId',
  ruName: '/vendortoolkit/ebayapi/sandbox/ruName',
},
{
  env: 'production',
  appId: '/vendortoolkit/ebayapi/production/appId',
  certId: '/vendortoolkit/ebayapi/production/certId',
  devId: '/vendortoolkit/ebayapi/production/devId',
  ruName: '/vendortoolkit/ebayapi/production/ruName',
},
{
  defaultClientToken : '/vendortoolkit/ebayapi/defaultClientTokenAccount',
},
]


//Get Configuration for the eBay - Done in INIT stage of lambda
export async function getEbayConfig({
  SSMClient,
  GetParametersCommand,
  sharedConfig,
}) {

  // Flatten the params for SSM call
  const flattenedParams = ssmparams
    .flatMap(({ appId, certId, ruName, devId, defaultClientToken }) => [appId, certId, ruName, devId, defaultClientToken])
    .filter((param) => param != null)

  // Fetch all credentials from SSM
  const credentials = await getCredentials({
    ssmParams: flattenedParams,
    SSMClient,
    GetParametersCommand,
    sharedConfig,
  })

  // Build configs for both sandbox and production
  const ebayConfigs = {}
  for (const paramSet of ssmparams) {
    if (paramSet.defaultClientToken) {
      ebayConfigs.defaultClientToken = credentials[paramSet.defaultClientToken]
      continue
    }

    ebayConfigs[paramSet.env] = {
      appId: credentials[paramSet.appId],
      certId: credentials[paramSet.certId],
      ruName: credentials[paramSet.ruName],
      devId: credentials[paramSet.devId],
      siteId: eBayApi.SiteId.EBAY_US,
      sandbox: paramSet.env === 'sandbox',
    }
  }

  return ebayConfigs
}

//Create an instance of the eBay API
export async function initEbayAPI({ userId, ebayConfig, dynamo, DDB_TABLES, env = 'production' }) {
  

  //We don't require an eBay user token for the app user, so we can just return the eBay API object
  if (userId === 'app') {
    const ebayAPI = new eBayApi(ebayConfig[env])
    return ebayAPI
  }

  var params = {
    TableName: DDB_TABLES.USER.EBAY_TOKENS.NAME,
    Key: {
      user_id: userId,
    },
  }
  try {
    //Get the user token from the database
    const data = await dynamo.get(params)
    if (!data?.Item) {
      throw {
        message: 'User token not found',
      }
    }
    const tokenData = data.Item

    //Initialise the eBay API object
    const ebayEnv = tokenData?.ebay_env || 'sandbox'

    const scope = ebayEnv === 'sandbox' ? sandScopes : prodScopes
    //Create the eBay API object
    const ebayAPI = new eBayApi({ ...ebayConfig[ebayEnv], scope })


    //Get the time remaining for refresh and auth tokens
    const currDate = new Date()
    const refreshExpires = new Date(tokenData.refresh_token_expires)
    const refreshExpiresIn = Math.max(
      0,
      Math.round((refreshExpires.getTime() - currDate.getTime()) / 1000),
    )

    const tokenExpires = new Date(tokenData.token_expires)
    const tokenExpiresIn = Math.max(
      0,
      Math.round((tokenExpires.getTime() - currDate.getTime()) / 1000),
    )

    //Return the token object
    const storedUserToken = {
      access_token: tokenData.token,
      refresh_token: tokenData.refresh_token,
      expires_in: tokenExpiresIn,
      refresh_token_expires_in: refreshExpiresIn,
      token_type: 'User Access Token',
    }
    //Set the token
    ebayAPI.OAuth2.setCredentials(storedUserToken)

    // Create the refresh handler
    const refreshHandler = createRefreshHandler(userId, dynamo, DDB_TABLES)
    ebayAPI.OAuth2.on('refreshAuthToken', refreshHandler)

    return ebayAPI
  } catch (err) {
    throw {
      message: 'Unable to get user token',
      errors: { debug: err.message },
      restStatus: 400,
    }
  }
}

async function getCredentials({
  ssmParams,
  SSMClient,
  GetParametersCommand,
  sharedConfig,
}) {
  const ssm = new SSMClient(sharedConfig)

  const params = {
    Names: ssmParams,
    WithDecryption: true,
  }

  try {
    const command = new GetParametersCommand(params)
    const res = await ssm.send(command)

    const result = {}
    res.Parameters.forEach((param) => {
      result[param.Name] = param.Value
    })

    return result
  } catch (err) {
    throw new Error(`Error getting SSM Params: ${err.message}`)
  }
}

function createRefreshHandler(userId, dynamo, DDB_TABLES) {
  return async function refreshHandler(newToken) {
    try {
      await storeEbayToken(userId, newToken, dynamo, DDB_TABLES)
    } catch (err) {
      console.error('Failed to store refreshed token:', err)
    }
  }
}

//Store the newly minted token in DDB and mark the state token as used
async function storeEbayToken(userId, token, dynamo, DDB_TABLES) {
  try {
    if (!token.expires_in || !token.refresh_token_expires_in) {
      throw { message: 'Invalid token expiry returned from eBay' }
    }

    //DynanoDB fields for refreshing the token
    const fields = [
      'user_id',
      'token',
      'token_expires',
      'token_created',
      'refresh_token',
      'refresh_token_expires',
      'state_token',
      'state_token_created',
      'state_token_used',
    ]

    const now = new Date()

    const data = {
      token: token.access_token,
      token_expires: new Date(
        now.getTime() + token.expires_in * 1000,
      ).toISOString(),
      token_created: now.toISOString(),
      refresh_token: token.refresh_token,
      refresh_token_expires: new Date(
        now.getTime() + token.refresh_token_expires_in * 1000,
      ).toISOString(),
      state_token_used: true,
    }

    const updateExpressions = []
    const expressionAttributeNames = {}
    const expressionAttributeValues = {}

    for (const field of fields) {
      if (data[field] !== undefined) {
        updateExpressions.push(`#${field} = :${field}`)
        expressionAttributeNames[`#${field}`] = field
        expressionAttributeValues[`:${field}`] = data[field]
      }
    }
    if (updateExpressions.length === 0) {
      return {}
    }

    const params = {
      TableName: DDB_TABLES.USER.EBAY_TOKENS.NAME,
      Key: { user_id: userId },
      UpdateExpression: `SET ${updateExpressions.join(', ')}`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
    }

    await dynamo.update(params)
    return data
  } catch (err) {
    throw {
      message: 'Unable to store user token',
      errors: { debug: err.message },
      restStatus: 400,
    }
  }
}
