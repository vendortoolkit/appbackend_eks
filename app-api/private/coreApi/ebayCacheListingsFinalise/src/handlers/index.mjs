//------------------------------------------------------------
// Vendor Toolkit Core
// Backend process
// Invoked from eventBridge
//------------------------------------------------------------
// Load the lambda layer this includes all the core functions,
import { DDB_TABLES } from '/opt/nodejs/core_module/index.mjs'

import { getTimedOutJobs, setJobToTimedOut, addToDDBLog, getProcessingJobs, checkAllPagesCompleted, setJobToCompleted } from '../aws/dynamoHelpers.mjs'
import { logger } from '../utils/logger.mjs'

import {
  DynamoDB,
  DynamoDBDocument,
  sharedConfig,
} from '/opt/nodejs/awsSdk_module/index.mjs'

const dynamo = DynamoDBDocument.from(new DynamoDB( sharedConfig ))

export const handler = async() => {
 
  try {
    // ------------------------------------------------------------
    // STAGE 1: Check the jobs table for any timed out jobs
    // ------------------------------------------------------------

    const timedOutJobs = await getTimedOutJobs({ DDB_TABLES, dynamo })
    if (timedOutJobs) {
      for (const job of timedOutJobs) {
        logger('Processing timed out job: ' + job.job_id)
        await setJobToTimedOut({ jobId: job.job_id, DDB_TABLES, dynamo })

        //Log the timed out job
        await addToDDBLog({
          data: {
            job_id: job.job_id,

            source: 'ebayCacheListingsFinalise',
            timestamp: new Date().toISOString(),
            message: 'Job has been marked as timed out',
            debug_data: '{reason: "Job exceeded maximum allowed processing time"}',
          },
          DDB_TABLES,
          completed: true,
        })
      }
    }

    // ------------------------------------------------------------
    // STAGE 2: Check remaining jobs with a status of processing jobs
    // and check if all pages in that job have been completed
    // ------------------------------------------------------------

    const processingJobs = await getProcessingJobs({ DDB_TABLES, dynamo })

    if (processingJobs) {
      for (const job of processingJobs) {
        logger('Found job in processing: ' + job.job_id)

        // Check if all pages in this job have been completed
        const allPagesCompleted = await checkAllPagesCompleted({ jobId: job.job_id, DDB_TABLES, dynamo })
        if (!allPagesCompleted) {
          logger('Not all pages completed for job: ' + job.job_id)
          continue
        }

        // If all pages are completed, mark the job as completed
        await setJobToCompleted({ jobId: job.job_id, DDB_TABLES, dynamo })
        logger('Job marked as completed: ' + job.job_id)
      }
    }
  } catch (err) {
    //Record the error
    const data = {
      source: 'ebayCacheListingsFinalise',
      timestamp: new Date().toISOString(),
      message: err?.message,
      debug_data: err?.errors,
    }
    logger('data:' + JSON.stringify(data, null, 2))
    logger('Logging error to DynamoDB')
    await addToDDBLog({ data, DDB_TABLES, dynamo })

  }

  return { ACK: 'success' }
}
