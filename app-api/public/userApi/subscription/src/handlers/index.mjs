//------------------------------------------------------------
// Vendor Toolkit API
// userprofile
// get, create, update, and delete a user's profile data
//------------------------------------------------------------
import {
  DynamoDB,
  DynamoDBDocument,
  sharedConfig,
} from '/opt/nodejs/awsSdk_module/index.mjs'

import { getUserAccountStatus, getUserPlanDetails } from "../aws/dynamoHelpers.mjs"
import { DDB_TABLES } from '/opt/nodejs/core_module/index.mjs'

import { getStripePendingSessionByUserID } from '/opt/nodejs/stripe_module/index.mjs'
import { logger } from '../utils/logger.mjs'

const dynamo = DynamoDBDocument.from(new DynamoDB(sharedConfig));

export const handler = async (event) => {

  const userIdFromToken = event.requestContext.authorizer.claims.sub

  //Future updates check if this is an admin userID and the allow CRUD on other accounts eg. the one in the query string
  let userId = userIdFromToken;

  let data = {}
  //Default Status Code and ack
  let statusCode = "200";
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
  };

  try {
    switch (event.httpMethod) {
      case "GET":
        data = await getHandler({ userId, DDB_TABLES, dynamo });
        break;
      case "PUT":
        break;
      case "POST":
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
    const errorDetail = err?.errors ? err.errors : { debug: "Unhandled error" }
    data = { error: { message: err.message, errors: errorDetail } }
  }

  return {
    statusCode,
    body: JSON.stringify(data),
    headers,
  };


  //Get a user Subscription Details
  async function getHandler({ userId, DDB_TABLES, dynamo }) {
    try {
      const accountStatus = await getUserAccountStatus({ userId, DDB_TABLES, dynamo });

      //Get the details for the plan details
      const planDetail = await getUserPlanDetails({ planTier: accountStatus?.plan_tier, DDB_TABLES, dynamo });

      //If this is not the Free Tier, we need to lookup payment dates and methods - add this later

      //Are there any paid but unfinalized Stripe sessions
      const pendingSessions = await getStripePendingSessionByUserID({ userId, DDB_TABLES, dynamo })
      const isPendingSessions = pendingSessions ? true : false;

      return { ACK: "success", planData: { ...accountStatus, ...planDetail, isPendingSessions } }
    } catch (err) {
      
      const errObject = {
        message: "Unable to get user plan details",
        errors: { debug: err?.message },
        restStatus: 400,
      };

      logger(errObject)
      throw errObject
    }
  }
 
}
