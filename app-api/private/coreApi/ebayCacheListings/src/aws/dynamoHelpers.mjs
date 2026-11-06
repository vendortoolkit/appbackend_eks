import {
  DynamoDB,
  DynamoDBDocument,
  sharedConfig,
} from '/opt/nodejs/awsSdk_module/index.mjs'

import { logger } from '../utils/logger.mjs'

const dynamo = DynamoDBDocument.from(new DynamoDB( sharedConfig ))

//Create the cache job in DynamoDB
export async function addToJobQueueDB({ jobData, DDB_TABLES, ttlHours, itemsPerPage }) {
  
  //Calculate the job timeout time
  const td = new Date(Date.parse(jobData.jobStartTime) + ttlHours * 60 * 60 * 1000)
  const jobTimeoutTime = td.toISOString()

  const status = jobData?.createLargeClient ? 'passed_to_largeclient' : 'processing'
  const completedAt = jobData?.createLargeClient ? jobData.jobStartTime : null

  const data = {
    user_id: jobData.userId,
    status: status,
    job_id: jobData.jobId,
    total_pages: Math.ceil(jobData.numberOfListings / itemsPerPage),
    total_items: jobData.numberOfListings,
    completed_items: 0,
    created_at: jobData.jobDate,
    updated_at: jobData.jobDate,
    completed_at: completedAt,
    timeout_at: jobTimeoutTime,
  }

  const params = {
    TableName: DDB_TABLES.EBAY.CACHED_LISTINGS_JOBS.NAME,
    Item: data,
    ConditionExpression: 'attribute_not_exists(job_id)',
  }
  try {
    await dynamo.put(params)
  } catch (err) {
    const msg = err.code === 'ConditionalCheckFailedException' ? 'Duplicate job_id detected' : 'Unable to add cache Job to DynamoDB'
    throw {
      message: msg,
      errors: { debug: err.message },
    }
  }
}

//Check if this job already exists in the Job DB
export async function getJob({ jobId, DDB_TABLES }) {
  const params = {
    TableName: DDB_TABLES.EBAY.CACHED_LISTINGS_JOBS.NAME,
    KeyConditionExpression: 'job_id = :jobId',
    ExpressionAttributeValues: {
      ':jobId': jobId,
    },
    Limit: 1, // Only need to know if any job exists
  }

  logger('Checking for existing job: ' + jobId)

  try {
    const data = await dynamo.query(params)
    // Return the first matching item if found
    return data?.Items?.[0]
  } catch (err) {
    throw {
      message: 'Unable to get job_ID status from database',
      errors: { debug: err.message },
    }
  }
}

//Add the results to DynamoDB Log
export async function addToDDBLog({ data, DDB_TABLES, completed = false }) {
  //Check the data type, so we can send to the correct log table
  const dbName = completed ? DDB_TABLES.EBAY.CACHED_LISTINGS_LOG.NAME : DDB_TABLES.EBAY.CACHED_LISTINGS_ERROR_LOG.NAME
  const params = {
    TableName: dbName,
    Item: data,
  }
  try {
    await dynamo.put(params)
  } catch (err) {
    throw {
      message: 'Unable to add message to: ' + dbName,
      errors: { debug: err.message },
    }
  }
}

