//------------------------------------------------------------
// Vendor Toolkit API
// userprofile
// get, create, update, and delete a user's profile data
//------------------------------------------------------------
import {
  DynamoDB,
  DynamoDBDocument,
  sharedConfig,
  CognitoIdentityProviderClient,
  AdminGetUserCommand,
} from '/opt/nodejs/awsSdk_module/index.mjs'

import { DDB_TABLES } from '/opt/nodejs/core_module/index.mjs'
import { validateUserProfile } from "./validateUserProfile.mjs";
import { createMarketingPrefObject, parseMarketingPrefObject } from "./createMarketingPrefObject.mjs";

const dynamo = DynamoDBDocument.from(new DynamoDB( sharedConfig ))

//Allowed Fields that can be added to dynamoDB
const fields = [
  "address_line1",
  "address_line2",
  "address_line3",
  "address_city",
  "company",
  "extra_email",
  "first_name",
  "last_name",
  "address_postalcode",
  "address_region",
  "country_iso",
  "marketing_preferences",
];


export const handler = async (event) => {

   const userIdFromToken = event.requestContext.authorizer.claims.sub

  //Future updates check if this is an admin userID and the allow CRUD on other accounts eg. the one in the query string
  let userID = userIdFromToken;


  let data = {}
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
        //Delete a user here
        data = await dynamo.delete(JSON.parse(event.body));
        break;
      case "GET":
        data = await getUser(userID);
        break;
      case "PUT":
        data = await updateUser(
          userID,
          JSON.parse(event.body)
        );
        break;
      case "POST":
        data = await createUser(
          userID,
          JSON.parse(event.body)
        );
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
    data = {error: {message: err.message, errors: errorDetail}}
  }

  return {
    statusCode,
    body: JSON.stringify(data),
    headers,
  };

   //Update user - this will fail if the user does not exist
  async function updateUser(userId, data) {

    //The maximum length string we will insert to the DB
    const maxString = 255

    //Run the validation function
    const result = validateUserProfile(data);

    if (!result.isValid) {
      throw {
        message:
          "Please check the highlighted fields and resubmit.",
        errors: result.errors,
        restStatus: 422,
      };
    }

    data.marketing_preferences = createMarketingPrefObject(data);

    const updateExpressions = [];
    const expressionAttributeNames = {};
    const expressionAttributeValues = {};

    for (const field of fields) {
      if (data[field] !== undefined) {
        updateExpressions.push(`#${field} = :${field}`);
        expressionAttributeNames[`#${field}`] = field;
        expressionAttributeValues[`:${field}`] = typeof data[field] === "string" ? data[field].slice(0, maxString) : data[field]
      }
    }

    if (updateExpressions.length === 0) {
      return {};
    }

    const params = {
      TableName: DDB_TABLES.USER.PROFILE.NAME,
      Key: { user_id: userId },
      UpdateExpression: `SET ${updateExpressions.join(", ")}`,
      ConditionExpression: 'attribute_exists(user_id)',
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
    };
    try {
      const result = await dynamo.update(params);
      return {};
    } catch (err) {
      throw {
        message: "Unable to update user profile",
        errors: { debug: err.message },
        restStatus: 400,
      };
    }
  }

  //Create a user - this will fail if the user already exists
  async function createUser(userId) {

    const params = {
      TableName: DDB_TABLES.USER.PROFILE.NAME,
      Item: { user_id: userId },
      ConditionExpression: 'attribute_not_exists(user_id)',
    };
    try {
      const result = await dynamo.put(params);
      return {};
    } catch (err) {
      throw {
        message: "Unable to create user profile - does user already exist?",
        errors: { debug: err.message },
        restStatus: 400,
      };
    }
  }

  //Get an existing user profile
  async function getUser(userId) {
    const recacheCognito = 'recachecogn' in (event.queryStringParameters ?? {})

    const params = {
      TableName: DDB_TABLES.USER.PROFILE.NAME,
      Key: { user_id: userId },
    };
    try {
      const data = await dynamo.get(params);

      //Check that a row was found
      if (data?.Item) {
        data.Item.marketing_preferences = parseMarketingPrefObject(data.Item.marketing_preferences)
      } else {
        //Otherwise we need to create a row for this user
        await createUser(userId);
        data.Item = {}
      }

      //If we don't need to recache from Cognito then return the data we have, otherwise get the latest email and phone from Cognito and update the profile before returning
      if (!recacheCognito) {
        return { Item: data.Item }
      }

      //Get the user attributes from Cognito and upsert email/phone into the profile table
      const cogClient = new CognitoIdentityProviderClient(sharedConfig);
      const input = {
        UserPoolId: process.env.USERPOOL_ID,
        Username: userId,
      };
      const command = new AdminGetUserCommand(input);
      const response = await cogClient.send(command);

      const cognitoAttrs = Object.fromEntries(
        (response.UserAttributes ?? []).map(({ Name, Value }) => [Name, Value])
      );

      const upsertParams = {
        TableName: DDB_TABLES.USER.PROFILE.NAME,
        Key: { user_id: userId },
        UpdateExpression: 'SET email = :email, phone = :phone',
        ExpressionAttributeValues: {
          ':email': cognitoAttrs?.email ?? null,
          ':phone': cognitoAttrs?.phone_number ?? null,
        },
      };
      await dynamo.update(upsertParams);

      return {
        Item: {
          ...data.Item,
          email: cognitoAttrs?.email,
          phone: cognitoAttrs?.phone_number,
        }
      }

    } catch (err) {
      throw {
        message: "Unable to get user profile",
        errors: { debug: err.message },
        restStatus: 400,
      };
    }
  }

  //To be added - delete a user profile

};
