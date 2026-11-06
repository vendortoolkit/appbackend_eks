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
import { addToDDBLog, checkIsValidJob, addItemtoCache, updateJobProgress } from '../aws/dynamoHelpers.mjs'
import { logger, buildLogData } from '../utils/logger.mjs'
import { getPageItemsFromEbay } from '../ebay/ebayHelpers.mjs'

import { DDB_TABLES } from '/opt/nodejs/core_module/index.mjs'

const dynamo = DynamoDBDocument.from(new DynamoDB( sharedConfig ))

const preloadEbayConfig = getEbayConfig({
  SSMClient,
  GetParametersCommand,
  sharedConfig,
})

export const handler = async(event) => {
  // Build a list of SQS messages that failed
  const batchItemFailures = []

 
  // Get the SSM Params that were loaded in the Init stage
  const ebayConfig = await preloadEbayConfig

  logger('Found Pages to be processed: ' + event?.Records?.length)

  // Loop through the batch of SQS items
  for (const record of event.Records) {

    logger(`Processing message ID: ${record.messageId}`)
    const job = JSON.parse(record.body)

    // Build page data object
    const pageData = {
      jobId: job.jobId,
      userId: job?.userId,
      jobDate: job?.added,
      startTimeTo: job?.startTimeTo,
      startTimeFrom: job?.startTimeFrom,
      pageNum: job?.pageNum,
      itemsPerPage: job?.itemsPerPage,
      added: job?.added,
      pageStartTime: new Date().toISOString(),
    }

    try {
      // ------------------------------------------------------------
      // STAGE 1: Validate the input data
      // ------------------------------------------------------------
      logger('STAGE 1: Validate the input data')
      // Validate required fields
      if (!pageData.userId) {
        throw {
          message: 'Missing required attribute: userId',
          errors: { debug: 'userId is undefined or empty' },
        }
      }

      if (typeof pageData.pageNum !== 'number' || pageData.pageNum < 1) {
        throw {
          message: 'Invalid required attribute: pageNum',
          errors: {
            debug:
              'days must be a positive number',
          },
        }
      }
      // Check if startTimeFrom is a valid ISO date
      if (isNaN(Date.parse(pageData.startTimeFrom))) {
        throw {
          message: 'Invalid attribute: startTimeFrom',
          errors: { debug: `startTimeFrom date is not a valid ISO date: ${pageData.startTimeFrom}` },
        }
      }

      // Check if startTimeTo is a valid ISO date
      // Must be after startTimeFrom
      if (isNaN(Date.parse(pageData.startTimeTo)) || (new Date(pageData.startTimeTo) <= new Date(pageData.startTimeFrom))) {
        throw {
          message: 'Invalid attribute: startTimeTo',
          errors: { debug: `startTimeTo date is not a valid ISO date or is before startTimeFrom: ${pageData.startTimeTo}` },
        }
      }

      //Check if this job is valid and that the page has not already been run
      const isValidJob = await checkIsValidJob({ pageData, DDB_TABLES, dynamo })
      if (!isValidJob) {
        throw {
          message: 'Page has already been completed or job does not exist',
          errors: { debug: `Page already completed or job does not exist: ${pageData.jobId} Pagenum: ${pageData.pageNum}` },
        }
      }

      //Load ebay api object for the user
      const ebayAPI = await initEbayAPI({
        userId: pageData.userId,
        ebayConfig,
        dynamo,
        DDB_TABLES,
      })

      //------------------------------------------------------------
      // STAGE 2: Get the pagedata from eBay
      //------------------------------------------------------------
      logger('STAGE 2: Get the pagedata from eBay')
      const ebayItems = await getPageItemsFromEbay({
        ebayAPI,
        pageData,
      })

      //Process the items here and add to the listings cache table
      if (ebayItems?.length === 0) {
        logger('No items to process for this page')
        throw {
          message: 'No items to process for this page',
          errors: { debug: `No items to process for this page: ${pageData.jobId} Pagenum: ${pageData.pageNum}`,
          },
        }
      }



      //Check how many items were returned from eBay
      logger('Number of items returned from eBay: ' + (ebayItems?.length ?? 0))

      //------------------------------------------------------------
      // STAGE 3: Process each item and add to the listings cache table
      //------------------------------------------------------------
      logger('STAGE 3: Process each item and add to the listings cache table')
      const promises = ebayItems.map(async(item) => {
        return addItemtoCache({ item, jobData: pageData, DDB_TABLES, dynamo })
      })
      const ddbResults = await Promise.allSettled(promises)

      //check we had any errors in the DDB results
      const ddbErrors = ddbResults.filter(result => result.status === 'rejected')
      //If they all failed then throw an error
      if (ddbErrors.length === ddbResults.length) {
        throw {
          retryable: true,
          message: 'All items failed to be added to cache',
          errors: { debug: JSON.stringify(ddbErrors) },
        }
      }

      //Count how many completed successfully, so we can update the job progress correctly
      const ddbSuccess = ddbResults.filter(result => result.status === 'fulfilled')
      logger('Number of items added to cache successfully: ' + ddbSuccess.length)
      const numItemsAdded = ddbSuccess.length



      if (ddbErrors.length > 0) {
        logger('Errors occurred while adding items to cache: ' + ddbErrors.length)
        //Log the errors but do not fail the job
        ddbErrors.forEach((error, index) => {
          logger(`Error ${index + 1}: ${error.reason?.message || 'Unknown error'}`)
        })
      } else {
        logger('All items added to cache successfully')
      }
      logger('All items processed for this page')

      //------------------------------------------------------------
      // STAGE 4: Mark the page as completed in the Job table
      //------------------------------------------------------------
      logger('STAGE 4: Mark the page as completed in the Job table')
      await updateJobProgress({ jobData: pageData, numItemsAdded, DDB_TABLES, dynamo })


      //------------------------------------------------------------
      // STAGE 5: Log the success or failure of the job
      //------------------------------------------------------------
      logger('STAGE 5: Log the success or failure of the job')  
      //Add the job to the success log
      const data = { ...buildLogData({
        jobData: pageData,
        message: 'Page completed successfully',
        debug_data: '',
      }), source: 'ebayCacheListingsWorker' }
      logger('data:' + JSON.stringify(data, null, 2))
      logger('Logging success to DynamoDB')
      await addToDDBLog({ data, DDB_TABLES, dynamo, completed : true })

      
    } catch (err) {
      //Build a error of SQS messages that failed so we can flag retry/DLC
      //Is the an error we want to retry or not
      if (err?.retryable) {
        logger('Retryable error occurred: ' + err?.message)
        batchItemFailures.push({ itemIdentifier: record.messageId })
      } 

      //Flag the item as unsuccessful and record the error
      const data = { ...buildLogData({
        jobData: pageData,
        message: err?.message,
        debug_data: err?.errors,
      }), source: 'ebayCacheListingsWorker' }
      logger('data:' + JSON.stringify(data, null, 2))
      logger('Logging error to DynamoDB')
      await addToDDBLog({ data, DDB_TABLES, dynamo })
    }
  }
  logger('All records processed')

  // Return the list of failed item identifiers
  return { batchItemFailures }
}
