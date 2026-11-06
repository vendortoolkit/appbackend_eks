//------------------------------------------------------------
// Vendor Toolkit API
// ebayauth/connect
// Receives a GET callback request from eBay Auth.
// Accepts State token, code - these are validated and then an eBay token is requested & stored
//------------------------------------------------------------
// Load the lambda layer this includes all the core functions,
import {
  initEbayAPI,
  getEbayConfig,
} from "/opt/nodejs/ebayApi_module/index.mjs";
import {
  DynamoDB,
  DynamoDBDocument,
  sharedConfig,
  SSMClient,
  GetParametersCommand,
  LambdaClient,
  InvokeCommand 
} from "/opt/nodejs/awsSdk_module/index.mjs";

import { DDB_TABLES } from '/opt/nodejs/core_module/index.mjs'

// Updated now gets sand and prod config
// We will check later which is required for the token type
const preloadEbayConfig = getEbayConfig({
  SSMClient,
  GetParametersCommand,
  sharedConfig,
});

//Allowed Fields that can be added to dynamoDB
const fields = [
  "user_id",
  "token",
  "token_expires",
  "token_created",
  "refresh_token",
  "refresh_token_expires",
  "state_token",
  "state_token_created",
  "state_token_used",
];

const dynamo = DynamoDBDocument.from(new DynamoDB(sharedConfig));

export const handler = async (event) => {
  // Get the SSM Params that were loaded in the Init stage
  const ebayConfig = await preloadEbayConfig;

  //Constants for this function - only non-DDB values
  const ENV = {
    PN_ACTIONS_LAMBDA: process.env.PN_ACTIONS_LAMBDA,
  };

  let data = {};
  //Default Status Code and ack
  let statusCode = 302;
  let headers = {
    Location: `http://app.vendortoolkit.com:5173/app/marketplace-settings/ebay?msg=connect_success`,
  };

  const userState = event.queryStringParameters?.state ?? false;
  const userCode = event.queryStringParameters?.code ?? false;

  try {
    //Check that state and code has been received
    if (!userCode || !userState) {
      throw {
        message: `Invalid Auth Credentials`,
        debug: "",
        restStatus: 401,
      };
    }

    //Check if the state token is valid
    const state = await checkState({ userState, DDB_TABLES, dynamo })
 
    const ebayToken = await getEbayToken({ code: userCode, ebayEnv: state.ebay_env, ebayConfig, DDB_TABLES, dynamo });

    await storeEbayToken({ userId: state.user_id, token: ebayToken, DDB_TABLES, dynamo });

    //Subscribe to Platform Notifications
    const lambdaClient = new LambdaClient(sharedConfig);
    const payload = { "directInvoke": [{ "userId": state.user_id, "action": "subscribe" }] }

    const command = new InvokeCommand({
      FunctionName: ENV.PN_ACTIONS_LAMBDA,
      Payload: JSON.stringify(payload),
    })
    await lambdaClient.send(command);

  } catch (err) {
    console.error("Error in ebay auth callback", JSON.stringify(err));
    const errorDetail = err?.errors
      ? err.errors
      : { debug: "Application error" };
    data = { error: { message: err.message, errors: errorDetail } };
    headers = {
      //To do move these to envars or param store
      Location: `http://app.vendortoolkit.com:5173/app/marketplace-settings/ebay?msg=connect_error`,
    };
  }

  return {
    statusCode,
    body: JSON.stringify(data),
    headers,
  };

  //Check the user has a state value and that it is valid
  async function checkState({ userState, DDB_TABLES, dynamo }) {

    //Get the state Data
    var params = {
      TableName: DDB_TABLES.USER.EBAY_TOKENS.NAME,
      IndexName: DDB_TABLES.USER.EBAY_TOKENS.GSI.STATE_TOKEN,
      KeyConditionExpression: "state_token = :hkey",
      ExpressionAttributeValues: {
        ":hkey": userState,
      },
    };
    
    try {
      const data = await dynamo.query(params);

      if (!data?.Items || data?.Items.length === 0) {
        throw {
          message: "State token not found",
        };
      }

      const stateData = data?.Items[0];

      //Check the statedata is valid
      const tokenTime = new Date(stateData.state_token_created);
      const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
      const isOlderThan15Minutes = tokenTime < fifteenMinutesAgo;

      if (stateData.state_token_used === true && isOlderThan15Minutes) {
        throw {
          message: "State token has expired",
        };
      }
      return stateData;
    } catch (err) {
      throw {
        message: "Unable to get user state token",
        errors: { debug: err.message },
        restStatus: 400,
      };
    }
  }
  async function getEbayToken({ code, ebayEnv, ebayConfig, DDB_TABLES, dynamo }) {

    try {
      //Initial the eBay API object for an application
      const userId = "app";
      const ebayAPI = await initEbayAPI({ userId, ebayConfig: ebayConfig[ebayEnv], dynamo, DDB_TABLES });

      const token = await ebayAPI.oAuth2.getToken(code);
      return token;
    } catch (err) {
      throw {
        message: "Error getting token from eBay ",
        errors: {
          debug: err?.response?.data?.error_description ?? err?.message,
        },
        restStatus: 400,
      };
    }
  }

  //Store the newly minted token in DDB and mark the state token as used
  async function storeEbayToken({ userId, token, DDB_TABLES, dynamo }) {
    try {
      if (!token.expires_in || !token.refresh_token_expires_in) {
        throw { message: "Invalid token expiry returned from eBay" };
      }

      const now = new Date();

      const data = {
        token: token.access_token,
        token_expires: new Date(
          now.getTime() + token.expires_in * 1000
        ).toISOString(),
        token_created: now.toISOString(),
        refresh_token: token.refresh_token,
        refresh_token_expires: new Date(
          now.getTime() + token.refresh_token_expires_in * 1000
        ).toISOString(),
        state_token_used: true,
      };

      const updateExpressions = [];
      const expressionAttributeNames = {};
      const expressionAttributeValues = {};

      for (const field of fields) {
        if (data[field] !== undefined) {
          updateExpressions.push(`#${field} = :${field}`);
          expressionAttributeNames[`#${field}`] = field;
          expressionAttributeValues[`:${field}`] = data[field];
        }
      }
      
      if (updateExpressions.length === 0) {
        return {};
      }

      const params = {
        TableName: DDB_TABLES.USER.EBAY_TOKENS.NAME,
        Key: { user_id: userId },
        UpdateExpression: `SET ${updateExpressions.join(", ")}`,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
      };

      const result = await dynamo.update(params);
      return data;
    } catch (err) {
      throw {
        message: "Unable to store user token",
        errors: { debug: err.message },
        restStatus: 400,
      };
    }
  }
};
