//Helper write to log errors if DEBUG is set to true
let DEBUG = true
if (process.env.DEBUG && process.env.DEBUG === 'false') {
  DEBUG = false
}

export function logger(msg, logid = null) {
  if (DEBUG) {
    if (logid) {
      console.log(`[${logid}] ${msg}`)
    } else {
      console.log(msg)
    }
  }
  return
}

export function buildLogData({ jobData, message, debug_data }) {
  return {
    job_id: jobData.jobId,
    timestamp: jobData.pageStartTime,
    user_id: jobData.userId,
    page_num: jobData.pageNum,
    message,
    debug_data,
    job_data: JSON.stringify(jobData),
  }
}
