

import { logger } from '../utils/logger.mjs'

//Get all timed out jobs from the jobs table
export async function getTimedOutJobs({ dynamo, DDB_TABLES }) {

  //Get any jobs that are currently processing and have timed out
  const params = {
    TableName: DDB_TABLES.EBAY.CACHED_LISTINGS_JOBS.NAME,
    IndexName: DDB_TABLES.EBAY.CACHED_LISTINGS_JOBS.GSI.STATUS,
    KeyConditionExpression: '#st = :st AND timeout_at < :timeout',
    ExpressionAttributeValues: {
      ':st': 'processing',
      ':timeout': new Date().toISOString(),
    },
    ExpressionAttributeNames: {
      '#st': 'status',
    },
  }
  try {
    const data = await dynamo.query(params)
    // Return the first matching item if found
    if (data?.Items?.length > 0) {
      logger('Timed out jobs found: ' + JSON.stringify(data.Items))
      return data.Items
    }
    logger('No timed out jobs found')
    return false
  } catch (err) {
    logger('Error getting timed out jobs: ' + err.message)
    throw {
      message: 'Unable to get status from database',
      errors: { debug: err.message },
    }
  }
}


//Set the job status to timed_out
export async function setJobToTimedOut({ jobId, DDB_TABLES, dynamo }) {
  try {
    await dynamo.update({
      TableName: DDB_TABLES.EBAY.CACHED_LISTINGS_JOBS.NAME,
      Key: { job_id: jobId },
      UpdateExpression: 'SET #st = :status, completed_at = :completedAt',
      ExpressionAttributeValues: {
        ':status': 'timed_out',
        ':completedAt': new Date().toISOString(),
      },
      ExpressionAttributeNames: {
        '#st': 'status',
      },
    })
  } catch (err) {
    logger('Error setting job to timed out: ' + err.message)
    throw {
      message: 'Unable to set job to timed out',
      errors: { debug: err.message },
    }
  }
}

//Get all processing jobs from the jobs table
export async function getProcessingJobs({ DDB_TABLES, dynamo }) {

  //Get any jobs that are currently processing
  const params = {
    TableName:  DDB_TABLES.EBAY.CACHED_LISTINGS_JOBS.NAME,
    IndexName: DDB_TABLES.EBAY.CACHED_LISTINGS_JOBS.GSI.STATUS,
    KeyConditionExpression: '#st = :st',
    ExpressionAttributeValues: {
      ':st': 'processing',
    },
    ExpressionAttributeNames: {
      '#st': 'status',
    },
  }
  try {
    const data = await dynamo.query(params)
    if (data?.Items?.length > 0) {
      logger('Processing jobs found: ' + JSON.stringify(data.Items))
      return data.Items
    }
    logger('No processing jobs found')
    return false
  } catch (err) {
    logger('Error getting processing jobs: ' + err.message)
    throw {
      message: 'Unable to get status from database',
      errors: { debug: err.message },
    }
  }
}

//Check if all pages are completed for a job
export async function checkAllPagesCompleted({ jobId, DDB_TABLES, dynamo }) {
  const params = {
    TableName: DDB_TABLES.EBAY.CACHED_LISTINGS_JOBS.NAME,
    KeyConditionExpression: 'job_id = :jobId',
    ExpressionAttributeValues: {
      ':jobId': jobId,
    },
  }
  try {
    const data = await dynamo.query(params)
    if (data?.Items?.length > 0) {
      const job = data.Items[0]
      if (job?.pages_completed && job.pages_completed instanceof Set) {
        // Check if all pages are completed
        const allPagesCompleted = job.pages_completed.size === job.total_pages
        if (allPagesCompleted) {
          logger('All pages completed for job: ' + jobId)
          return true
        }
      }
    }
    return false
  } catch (err) {
    throw {
      message: 'Unable to check if all pages are completed',
      errors: { debug: err.message },
    }
  }
}

//Set the job status to completed
export async function setJobToCompleted({ jobId, DDB_TABLES, dynamo }) {
  try {
    await dynamo.update({
      TableName: DDB_TABLES.EBAY.CACHED_LISTINGS_JOBS.NAME,
      Key: { job_id: jobId },
      UpdateExpression: 'SET #st = :status, completed_at = :completedAt',
      ExpressionAttributeValues: {
        ':status': 'completed',
        ':completedAt': new Date().toISOString(),
      },
      ExpressionAttributeNames: {
        '#st': 'status',
      },
    })
  } catch (err) {
    logger('Error setting job to completed: ' + err.message)
    throw {
      message: 'Unable to set job to completed',
      errors: { debug: err.message },
    }
  }
}


//Add the results to DynamoDB Log
export async function addToDDBLog({ data, DDB_TABLES, dynamo, completed = false }) {
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

  