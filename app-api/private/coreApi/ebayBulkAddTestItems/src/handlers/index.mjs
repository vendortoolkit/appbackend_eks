//------------------------------------------------------------
// Vendor Toolkit Core - Add Test Items to eBay US Sandbox
//------------------------------------------------------------
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

const dynamo = DynamoDBDocument.from(new DynamoDB())

const preloadEbayConfig = getEbayConfig({
  SSMClient,
  GetParametersCommand,
  sharedConfig,
})

export const handler = async (event) => {
  const ebayConfig = await preloadEbayConfig

  const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body
  const userId = body?.userId
  const listingNum = body?.numListings ?? 1
  const titlePrefix = body?.titlePrefix ?? ""


  try {
    if (!userId) {
      throw new Error('userId is required')
    }

    const ebayAPI = await initEbayAPI({
      userId,
      ebayConfig,
      dynamo,
      DDB_TABLES,
    })

    const results = []
    for (let x = 0; x < listingNum; x++) {
       console.log("Next Item....")
      const randomSku = Math.floor(Math.random() * (10000000))
      const title = `${titlePrefix} #${randomSku}`
      console.log(title);
      const price = (Math.random() * (50 - 5) + 5).toFixed(2) // $5.00 - $50.00
      const listingType = Math.random() > 0.5 ? 'FixedPriceItem' : 'Chinese'
      const duration = listingType === 'Chinese' ? 'Days_7' : 'GTC'

      
      let result = await listItem({ ebayAPI, title, price, listingType, duration })
      let retryCount = 0;
      while (result?.retry && retryCount<3){
        retryCount++;
        console.log("Retrying....")
         result = await listItem({ ebayAPI, title, price, listingType, duration })
      }



      results.push(result)
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, results }),
    }
  } catch (err) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        message: 'There was a problem listing test items',
        errors: { debug: err.message },
      }),
    }
  }
}

async function listItem({ ebayAPI, title, price, listingType, duration }) {
  try {
    const result = await ebayAPI.trading.AddItem({
      Item: {
        Title: title,
        Description: `${title} - sandbox listing for testing only`,
        PrimaryCategory: {
          CategoryID: '14111', // eBay Sandbox test category
        },
        StartPrice: price,
        Currency: 'USD',
        Country: 'US',
        Location: 'San Jose, CA',
        ListingDuration: duration,
        ListingType: listingType,
        Quantity: 1,
        DispatchTimeMax: 3,
        ShippingDetails: {
          ShippingType: 'Flat',
          ShippingServiceOptions: [
            {
              ShippingServicePriority: 1,
              ShippingService: 'USPSFirstClass',
              ShippingServiceCost: '0.00',
            },
          ],
        },
      },
    })

    console.log(`Listed ${title} (${listingType}) at $${price}`)
    return result
  } catch (err) {
    if (err.description === 'Service Unavailable') {
      return { retry: 1 }
    }
    throw {
      message: 'Unable to list test item',
      errors: { debug: err.message },
    }
  }
}
