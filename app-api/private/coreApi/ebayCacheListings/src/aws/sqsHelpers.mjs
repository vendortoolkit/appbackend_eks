import {
  SQSClient,
  SendMessageBatchCommand,
} from '/opt/nodejs/awsSdk_module/index.mjs'


//This only runs if a large job needs to split into smaller batches
//The jobs are re-added back to vtk-ebay-cache-listings-jobs
export async function addJobsToSQS(jobData, sqsBatchSize, queueName) {
  //Work out how many days we need to add to the queue
  const sqsBatchs = []

  //Work out how many SQS batch we will need and create the start date for each
  for (let i = 0; i <= jobData.originalDays; i += jobData.days) {
    const arrayBatch = Math.floor(i / sqsBatchSize)

    const startTimeTo = jobData.startTimeTo
    const startTimeToDate = new Date(Date.parse(startTimeTo) - i * 24 * 60 * 60 * 1000)
    const updatedStartTimeTo = startTimeToDate.toISOString()

    //Create the pre SQS batches
    const sqsItem = {
      startTimeTo: updatedStartTimeTo,
      days: jobData.days,
    }
    if (!sqsBatchs[arrayBatch]) {
      sqsBatchs[arrayBatch] = []
    }
    sqsBatchs[arrayBatch].push(sqsItem)
  }

  //Process each batch/item by creating the SQS and then sending to SQS at at once
  const promises = sqsBatchs.map(async(batch) => {
    const sqsPayloadBatch = []
    // Build a batch of SQS messages
    for (const item of batch) {
      const sqsPayload = {
        userId: jobData.userId,
        days: item.days,
        added: jobData.jobDate,
        largeClient: 1,
        startTimeTo: item.startTimeTo,
      }
      const entries = {
        Id: `${jobData.jobId}_${idDateFormatter(item.startTimeTo)}_${item.days}`,
        MessageBody: JSON.stringify(sqsPayload),
      }
      sqsPayloadBatch.push(entries)
    }
    // Combine the Messages
    const params = {
      Entries: sqsPayloadBatch,
      QueueUrl: queueName,
    }
    return sendSQSbatch(params)
  })
  const sqsResult = await Promise.allSettled(promises)
  return sqsResult
}

//This add listings to SQS for the next stage of a full recache
export async function addListingsToSQS({ jobData, sqsBatchSize, queueName, itemsPerPage }) {
  const sqsBatchs = []
  const totalPages = Math.ceil(jobData.numberOfListings / itemsPerPage)

  //Work out how many SQS batch we will need and add the page number for each one
  for (let i = 1; i <= totalPages; i++) {
    const arrayBatch = Math.floor((i - 1) / sqsBatchSize)
    const sqsItem = {
      page: i,
    }
    if (!sqsBatchs[arrayBatch]) {
      sqsBatchs[arrayBatch] = []
    }
    sqsBatchs[arrayBatch].push(sqsItem)
  }

  const startTimeTo = jobData.startTimeTo
  const startTimeFromDate = new Date(
    Date.parse(startTimeTo) - jobData.days * 24 * 60 * 60 * 1000,
  )
  const startTimeFrom = startTimeFromDate.toISOString()

  //Process each batch/item by creating the SQS and then sending to SQS at at once
  const promises = sqsBatchs.map(async(batch) => {
    const sqsPayloadBatch = []
    // Build a batch of SQS messages
    for (const item of batch) {
      const sqsPayload = {
        jobId: jobData.jobId,
        userId: jobData.userId,
        startTimeFrom,
        startTimeTo,
        pageNum: item.page,
        itemsPerPage,
        added: jobData.jobDate,
      }
      const entries = {
        Id: `${jobData.jobId}_${item.page}`,
        MessageBody: JSON.stringify(sqsPayload),
      }
      sqsPayloadBatch.push(entries)
    }
    // Combine the Messages
    const params = {
      Entries: sqsPayloadBatch,
      QueueUrl: queueName,
    }
    return sendSQSbatch(params)
  })
  const sqsResult = await Promise.allSettled(promises)
  return sqsResult

}


//Helper function to get post a batch of messages to a SQS queue
//Returns a PROMISE
async function sendSQSbatch(input) {
  const client = new SQSClient()
  const command = new SendMessageBatchCommand(input)
  const result = client.send(command)
  return result
}


//Helper function for date formatting for Id's eg SQS ID
function idDateFormatter(dateISOString){

  const dateObject = new Date(dateISOString)

  // Helper function to pad numbers to 2 digits#
  const pad2 = num => num.toString().padStart(2, '0')

  // Format as yyyymmdd_hhmmss
  const formatted = 
  dateObject.getFullYear().toString() +
  pad2(dateObject.getMonth() + 1) +
  pad2(dateObject.getDate()) +
  '_' +
  pad2(dateObject.getHours()) +
  pad2(dateObject.getMinutes()) +
  pad2(dateObject.getSeconds())

  return(formatted)
}

//Helper function to create an SQS success / error array from a batch of resolved Promisese
export function hasSQSErrors(resultBatch) {
  let foundErrors = false
  for (const r of resultBatch) {
    if (r.status === 'rejected') {
      foundErrors = true
    }
    if (r.status === 'fulfilled' && r.value?.Failed?.length > 0) {
      foundErrors = true
    }
  }
  return foundErrors
}

