//Helper write to log errors if DEBUG is set to true
let DEBUG = true
if (process.env.DEBUG && process.env.DEBUG === 'false') {
  DEBUG = false
}

export function logger(msg) {
  if (DEBUG) {
    console.log(msg)
  }
  return
}

export function buildLogData({ jobData, job, message, debug_data }) {
  return {
    job_id: jobData.jobId,
    timestamp: jobData.jobStartTime,
    user_id: jobData.userId,
    rerun_as_large_client: jobData.createLargeClient,
    message,
    debug_data,
    job_data: JSON.stringify(job),
  }
}
