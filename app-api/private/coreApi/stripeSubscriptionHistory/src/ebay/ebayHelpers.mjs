
//Helper function to get the live items from eBay for the page/dates provided
export async function getPageItemsFromEbay({ ebayAPI, pageData }) {
  try {
    const startTimeTo = pageData.startTimeTo
    const startTimeFrom = pageData.startTimeFrom
    const pageNum = pageData.pageNum


    const OutputSelector = [
      'ItemArray.Item.ItemID',
      'ItemArray.Item.Title',
      'ItemArray.Item.Country',
      'ItemArray.Item.ListingDuration',
      'ItemArray.Item.Currency',
      'ItemArray.Item.Location',
      'ItemArray.Item.Quantity',
      'ItemArray.Item.Site',
      'ItemArray.Item.ShipToLocations',
      'ItemArray.Item.WatchCount',
      'ItemArray.Item.ListingType',
      'ItemArray.Item.BuyItNowPrice',
      'ItemArray.Item.StartPrice',
      'ItemArray.Item.SKU',
      'ItemArray.Item.Description',
      'ItemArray.Item.Storefront.StoreCategory2ID',
      'ItemArray.Item.Storefront.StoreCategoryID',
      'ItemArray.Item.PrimaryCategory.CategoryID',
      'ItemArray.Item.SecondaryCategory.CategoryID',
      'ItemArray.Item.ListingDetails.StartTime',
      'ItemArray.Item.ListingDetails.EndTime',
      'ItemArray.Item.ListingDetails.ViewItemURL',
      'ItemArray.Item.SellingStatus.CurrentPrice',
      'ItemArray.Item.SellingStatus.QuantitySold',
      'ItemArray.Item.SellingStatus.BidCount',
      'ItemArray.Item.SellingStatus.ListingStatus',
      'ItemArray.Item.PictureDetails',
    ]


    const result = await ebayAPI.trading.GetSellerList({
      IncludeWatchCount: true,
      IncludeVariations: true,
      //GranularityLevel: 'Fine',
      OutputSelector: OutputSelector.join(','),
      DetailLevel: 'ItemReturnDescription',
      StartTimeFrom: startTimeFrom,
      StartTimeTo: startTimeTo,
      Pagination: {
        EntriesPerPage: pageData.itemsPerPage,
        PageNumber: pageNum,
      },
    })
    //Check if items were found
    if (result?.Ack !== 'Success' && result?.Ack !== 'Warning') {
      throw {
        retryable: true,
        message: 'eBay API did not return a successful response',
        errors: { debug: JSON.stringify(result) },
      } 
    }

    if (!result?.ItemArray?.Item) {
      throw {
        message: 'eBay API did not return an items array',
        errors: { debug: JSON.stringify(result) },
      }
    } else {
      return result.ItemArray.Item
    }
  } catch (err) {
    throw {
      retryable: true,
      message: 'Unable to get the number of live items',
      errors: { debug: err.message },
    }
  }
}

