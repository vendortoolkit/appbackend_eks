import { logger } from '../utils/logger.mjs'

//Add the results to DynamoDB Log
export async function addToDDBLog({ data, tableName, dynamo }) {
  const params = {
    TableName: tableName,
    Item: data,
  }
  try {
    await dynamo.put(params)
  } catch (err) {
    logger('Error adding to DDB log: ' + err.message)
    throw {
      message: 'Unable to add message to: ' + tableName,
      errors: { debug: err.message },
    }
  }
}