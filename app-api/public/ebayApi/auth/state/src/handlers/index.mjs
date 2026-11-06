//------------------------------------------------------------
// Vendor Toolkit API
// ebayauth/state
// Creates, verifys, and cancels an eBay state token during eBay user token creation
//------------------------------------------------------------
// Load the lambda layer this includes all the core functions,
import { DynamoDB, DynamoDBDocument, sharedConfig, UpdateCommand} from "/opt/nodejs/awsSdk_module/index.mjs"
import * as crypto from "crypto";
import { DDB_TABLES } from '/opt/nodejs/core_module/index.mjs'


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
  "ebay_env",
];

const dynamo = DynamoDBDocument.from(new DynamoDB(sharedConfig));

export const handler = async (event) => {
  const userIdFromToken = event.requestContext.authorizer.claims.sub;

  //Future updates check if this is an admin userID and the allow CRUD on other accounts eg. the one in the query string
  let userID = userIdFromToken;

  if (event.pathParameters) {
    const stateId = event.pathParameters?.stateid;
  }
  let data = {};
  //Default Status Code and ack
  let statusCode = "200";
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
  };

  try {
    switch (event.httpMethod) {
      case "DELETE":
        data = await deleteHandler();
        break;
      case "GET":
        data = await getHandler();
        break;
      case "PUT":
        data = await putHandler();
        break;
      case "POST":
        data = await postHandler({ userId: userID, body: JSON.parse(event.body), DDB_TABLES, dynamo });
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

  async function deleteHandler(userId, stateId) {}

  async function getHandler(userId, stateId) {}

  async function putHandler(userId) {}

  async function postHandler({ userId, body, DDB_TABLES, dynamo }) {
    //Create a new random state id
    const genStateId = crypto.randomBytes(16).toString("hex");
    
    const ebay_env = body?.ebay_env && body.ebay_env === "production" ? body.ebay_env : "sandbox";

    //Save the stateID for the user
    const data = {
      state_token: genStateId,
      state_token_created: new Date().toISOString(),
      state_token_used: false,
      ebay_env: ebay_env,
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
    
    try {
      const result = await dynamo.update(params);
      return data;
    } catch (err) {
      throw {
        message: "Unable to create a state token",
        errors: { debug: err.message },
        restStatus: 400,
      };
    }
  }
};
