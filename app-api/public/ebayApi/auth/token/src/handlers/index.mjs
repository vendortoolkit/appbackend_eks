//------------------------------------------------------------
// Vendor Toolkit API
// ebayauth/token
// Refreshes, verifys, and deletes an eBay user token
//------------------------------------------------------------
// Load the lambda layer this includes all the core functions,
import { initEbayAPI, getEbayConfig } from "/opt/nodejs/ebayApi_module/index.mjs";
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

const preloadEbayConfig = getEbayConfig({
  SSMClient,
  GetParametersCommand,
  sharedConfig,
});

const dynamo = DynamoDBDocument.from(new DynamoDB(sharedConfig));

export const handler = async (event) => {
  // Get the SSM Params that were loaded in the Init stage
  const ebayConfig = await preloadEbayConfig;

  //Constants for this function - only non-DDB values
  const ENV = {
    PN_ACTIONS_LAMBDA: process.env.PN_ACTIONS_LAMBDA,
  };

  const userIdFromToken = event.requestContext.authorizer.claims.sub;
  //Future updates check if this is an admin userId and the allow CRUD on other accounts eg. the one in the query string
  let userId = userIdFromToken;

  let data = {};
  //Default Status Code and ack
  let statusCode = "200";
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, DELETE",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
  };

  try {
    switch (event.httpMethod) {
      case "DELETE":
        data = await deleteHandler({ userId, DDB_TABLES, dynamo, PN_ACTIONS_LAMBDA: ENV.PN_ACTIONS_LAMBDA });
        break;
      case "GET":
        data = await getHandler({ userId, ebayConfig, DDB_TABLES, dynamo });
        break;
      default:
        throw {
          message: `Unsupported method "${event.httpMethod}"`,
          debug: "",
          restStatus: 500,
        };
    }
  } catch (err) {
    //Provide a standard error output
    statusCode = err?.restStatus ? err.restStatus : 400;
    const errorDetail = err?.errors ? err.errors : { debug: "Unhandled error" };
    data = { error: { message: err.message, errors: errorDetail } };
  }

  return {
    statusCode,
    body: JSON.stringify(data),
    headers,
  };

  async function deleteHandler({ userId, DDB_TABLES, dynamo, PN_ACTIONS_LAMBDA }) {
    //Clear the users Platform Notification before we delete the token
    try {

      //To do this we need to call the PN actions lambda function
      const lambdaClient = new LambdaClient(sharedConfig);
      const payload = { "directInvoke": [{ "userId": userId, "action": "unsubscribe" }] }

      const command = new InvokeCommand({
        FunctionName: PN_ACTIONS_LAMBDA,
        Payload: JSON.stringify(payload),
      })
      await lambdaClient.send(command);

      //Update DynamoDB
      var params = {
        TableName: DDB_TABLES.USER.EBAY_TOKENS.NAME,
        Key: {
          user_id: userId,
        },
      };

      //Delete the user token from the database
      const data = await dynamo.delete(params);
      return { ACK: "success" }

    } catch (err) {
      throw {
        message: "Unable to delete user token",
        errors: { debug: err.message },
        restStatus: 400,
      };
    }
  }

  async function getHandler({ userId, ebayConfig, DDB_TABLES, dynamo }) {
    try {

      //Initial the eBay API object when we have a userId 
      const ebayAPI = await initEbayAPI({ userId, ebayConfig, dynamo, DDB_TABLES});
      try {
        const result = await ebayAPI.trading.GetUser();
        return { tokenstatus: "valid" }
      } catch (err) {
        console.log(err)
        if (err.response?.status === 401 || err.response?.status === 403) {
          throw {
            message: "User token has expired or is invalid",
          };
        } else {
          throw {
            message: err?.response?.data?.error_description ?? err?.message,
          };
        }
      }
    } catch (err) {
      throw {
        message: "Unable to get user token",
        errors: { debug: err.message },
        restStatus: 400,
      };
    }
  }
};


