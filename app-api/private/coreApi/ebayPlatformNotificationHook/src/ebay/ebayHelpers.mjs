import crypto from 'crypto'

//Helper to check if the eBay Signature is valid
export function isEbaySignatureValid({ eBayTimeStamp, ebayConfig, notificationSignature }) {
  try {
    const devId = ebayConfig?.devId || ''
    const appId = ebayConfig?.appId || ''
    const certId = ebayConfig?.certId || ''

    //Create the string to hash
    const stringToHash = eBayTimeStamp + devId + appId + certId

    //Create the SHA256 hash of the string
    const hash = crypto.createHash('md5').update(stringToHash).digest('base64')

    //Compare the hash to the notification signature
    return hash === notificationSignature
  } catch (err) {
    throw {
      message: 'Error validating eBay signature',
      errors: { debug: err.message },
    }
  }
}
