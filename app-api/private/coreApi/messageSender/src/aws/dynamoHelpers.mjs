
import { DDB_TABLES, CONSTANTS } from '/opt/nodejs/core_module/index.mjs'


export async function getMsgEventData({ eventCode, dynamo }) {
  try {
    const params = {
      TableName: DDB_TABLES.CORE.MESSAGE_LIBRARY.NAME,
      Key: {
        event_code: eventCode,
        status: CONSTANTS.USER_MESSAGES.EVENT_STATUS.ACTIVE,
      },
    }
    const data = await dynamo.get(params)
    if (!data?.Item) {
      throw {
        message: 'No message event found for the given eventCode',
        errors: { debug: `No item found in DynamoDB for event_code: ${eventCode} and status: ${eventCode}` },
      }
    }
    return data.Item
  } catch (err) {
    throw {
      message: 'Unable to get message event from database',
      errors: { debug: err.message },
    }
  }
} 

//Get an existing user profile
export async function getUser({ userId, dynamo }) {
  var params = {
    TableName: DDB_TABLES.USER.PROFILE.NAME,
    Key: {
      user_id: userId,
    },
  }
  try {
    const data = await dynamo.get(params)

    //Check that a row was found
    if (data?.Item){
      return data.Item
    }
    else {    
      throw {
        message: 'No user profile found for the given userId',
        errors: { debug: `No item found in DynamoDB for user_id: ${userId}` },
      }
    }
  } catch (err) {
    throw {
      message: 'Unable to get user profile from database',
      errors: { debug: err.message },
    }
  }
}
