import { logger } from '../utils/logger.mjs'

//Add the results to DynamoDB Log
export async function addToDDBLog({ data, tableName, dynamo  }) {
  //Check the data type, so we can send to the correct log table
  const params = {
    TableName: tableName,
    Item: data,
  }
  try {
    await dynamo.put(params)
  } catch (err) {
    const msg = `Unable to add log message to: ${tableName}`
    logger(msg)
    const error = new Error(msg)
    error.debug = err.message
    throw error
  }
}