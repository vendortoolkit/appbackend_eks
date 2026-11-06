import { logger } from '../utils/logger.mjs'
import { DDB_TABLES } from '/opt/nodejs/core_module/index.mjs'

//Add the results to DynamoDB Log
export async function addToDDBLog({ data, dynamo, completed = true }) {
  //Check the data type, so we can send to the correct log table
  const dbName = completed ? DDB_TABLES.USER.SUBSCRIPTIONS_ACTIONS_LOG.NAME : DDB_TABLES.USER.SUBSCRIPTIONS_ACTIONS_ERROR_LOG.NAME
  const params = {
    TableName: dbName,
    Item: data,
  }
  try {
    await dynamo.put(params)
  } catch (err) {
    const msg = `Unable to add log message to: ${dbName}`
    logger(msg)
    const error = new Error(msg)
    error.debug = err.message
    throw error
  }
}