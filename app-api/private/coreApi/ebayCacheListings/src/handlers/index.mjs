//------------------------------------------------------------
// Vendor Toolkit Core
// Backend process
// Expecting an SQS Payload
//------------------------------------------------------------
// Load the lambda layer this includes all the core functions,
import {
  initEbayAPI,
  getEbayConfig,
} from '/opt/nodejs/ebayApi_module/index.mjs'
import {
  DynamoDB,
  DynamoDBDocument,
  sharedConfig,
  SSMClient,
  GetParametersCommand,
} from '/opt/nodejs/awsSdk_module/index.mjs'
import { DDB_TABLES } from '/opt/nodejs/core_module/index.mjs'

import crypto from 'crypto'
import { addToJobQueueDB, addToDDBLog, getJob } from '../aws/dynamoHelpers.mjs'
import { addJobsToSQS, addListingsToSQS, hasSQSErrors } from '../aws/sqsHelpers.mjs'
import { logger, buildLogData } from '../utils/logger.mjs'
import { getNumLiveEbayItems } from '../ebay/ebayHelpers.mjs'

const dynamo = DynamoDBDocument.from(new DynamoDB( sharedConfig ))

const preloadEbayConfig = getEbayConfig({
  SSMClient,
  GetParametersCommand,
  sharedConfig,
})

export const handler = async(event) => {
  //Constants for this function
  const SQSJOBQUEUE = process.env.SQSJOBQUEUE
  const SQSPAGEQUEUE = process.env.SQSPAGEQUEUE
  const MAXITEMSPERPAGE = Number(process.env.MAXITEMSPERPAGE)
  const JOBTIMEOUTHOURS = Number(process.env.JOBTIMEOUTHOURS)
  const SQSMAXBATCHSIZE = Number(process.env.SQSMAXBATCHSIZE)

  // Build a list of SQS messages that failed
  const batchItemFailures = []

  // Get the SSM Params that were loaded in the Init stage
  const ebayConfig = await preloadEbayConfig

  logger('Found records: ' + event?.Records?.length)

  // Loop through the batch of SQS items
  for (const record of event.Records) {

    logger(`Processing message ID: ${record.messageId}`)
    const job = JSON.parse(record.body)

    // Build job data object
    // Create a jobID - this will be used throughout the script
    const startTimeTo =  job?.startTimeTo ?? job?.added
    const jobData = {
      jobId: shortHash(`${job?.userId}${job?.days}${job?.added}${startTimeTo}`),
      userId: job?.userId,
      days: job?.days,
      jobDate: job?.added,
      largeClient: job?.largeClient,
      startTimeTo,
      createLargeClient: false,
      jobStartTime: new Date().toISOString(),
    }

    try {

      // Validate required fields
      if (!jobData.userId) {
        throw {
          message: 'Missing required attribute: userId',
          errors: { debug: 'userId is undefined or empty' },
        }
      }

      if (typeof jobData.days !== 'number' || jobData.days <= 0 || jobData.days >= 120) {
        throw {
          message: 'Invalid required attribute: days',
          errors: {
            debug:
              'days must be a positive number greater than 0 and less than 120',
          },
        }
      }
      // Check if jobDate is a valid ISO date
      if (isNaN(Date.parse(jobData.jobDate))) {
        throw {
          message: 'Invalid attribute: added',
          errors: { debug: `added date is not a valid ISO date: ${jobData.jobDate}` },
        }
      }

      //Check if this job already exists (duplicated SQS etc)
      const isExistingJob = await getJob({ jobId: jobData.jobId, DDB_TABLES })
      if (isExistingJob) {
        throw {
          message: 'A job with this ID already exists',
          errors: { debug: `job id already exists in DB: ${jobData.jobId}` },
        }
      }

      //Load ebay api object for the user
      const ebayAPI = await initEbayAPI({
        userId: jobData.userId,
        ebayConfig,
        dynamo,    
        DDB_TABLES,
      })

      //Check how many items the user has live on eBay
      logger('Getting number of live items from eBay')

      const result = await getNumLiveEbayItems({
        ebayAPI,
        jobData,
        retry: false,
      })
      //Store the number of listings found
      logger('Number of listings found: ' + result?.numberOfListings)
      jobData.numberOfListings = result?.numberOfListings


      //Retry the eBay call with a smaller number of pages (unless its already flagged a large client Job)
      //This is to check if it's a larger client that needs to be cached 1 day at a time
      if (result?.retry && !jobData?.largeClient) {
        logger('Retrying with smaller days for large client')
        const result = await getNumLiveEbayItems({
          ebayAPI,
          jobData: { ...jobData, days: 1 },
          retry: true,
        })

        //Update the JobData object to flag that this is large client
        logger('Large client detected, updating job to 1 day intervals')
        jobData.originalDays = jobData.days
        jobData.days = 1
        jobData.createLargeClient = true
        jobData.numberOfListings = result?.numberOfListings
      }

      //No Live listings were found
      if (!jobData.numberOfListings) {
        throw {
          message: 'No live items were found',
          errors: { debug: '' },
        }
      }

      //Save the job to DynamoDB
      logger('Creating job in DynamoDB')
      
      await addToJobQueueDB({ jobData, DDB_TABLES, ttlHours: JOBTIMEOUTHOURS, itemsPerPage: MAXITEMSPERPAGE }) 

      //Large Client process
      //Retry in smaller chunks, by posting back to vtk-ebay-cache-listings-jobs
      if (jobData?.createLargeClient) {
        logger('Recreating job as large client')  
        const res = await addJobsToSQS({ jobData, sqsBatchSize: SQSMAXBATCHSIZE, queueName: SQSJOBQUEUE })
        //Check if all pages were added successfully
        if (hasSQSErrors(res)){
          const msg = 'Completed with errors'
          throw {
            message: `Readded job as large client: ${msg}`,
            errors: { debug: JSON.stringify(res, null, 2) },
          }
        }
      }


      //Successful Client process
      //Create the pages in the main vtk-ebay-cache-listings-queue
      else {
        logger('Creating standard client job pages in SQS')
        const res = await addListingsToSQS({ jobData, sqsBatchSize: SQSMAXBATCHSIZE, queueName: SQSPAGEQUEUE, itemsPerPage: MAXITEMSPERPAGE })

        if (hasSQSErrors(res)){
          const msg = 'Completed with errors'
          throw {
            message: `Added pages to main vtk-ebay-cache-listings-queue: ${msg}`,
            errors: { debug: JSON.stringify(res, null, 2) },
          }
        }
      }

      //Add the job to the success log
      const data = { ...buildLogData({
        jobData,
        job,
        message: 'Stage 1 Completed: (Create Job)',
        debug_data: '',
      }) , source: 'ebayCacheListings' }


      logger('data:' + JSON.stringify(data, null, 2))
      logger('Logging success to DynamoDB')
      await addToDDBLog({ data, DDB_TABLES, completed: true })

      
    } catch (err) {

      // Build a list of SQS messages that failed
      batchItemFailures.push({ itemIdentifier: record.messageId })

      //Flag the job as unsuccessful and record the error
      const data = { ...buildLogData({
        jobData,
        job,
        message: err?.message,
        debug_data: err?.errors,
      }), source: 'ebayCacheListings' }
      logger('data:' + JSON.stringify(data, null, 2))
      logger('Logging error to DynamoDB')
      await addToDDBLog({ data, DDB_TABLES })
    }
  }
  logger('All records processed')

  // Return the list of failed item identifiers
  return {
    batchItemFailures,
  }

  //Helper function to create a job ID
  function shortHash(hashString, length = 8) {
    const hash = crypto.createHash('md5').update(hashString).digest('hex')
    return hash.slice(0, length)
  }

}
