
//Helper function to get the number of listing the user has on eBay
export async function getNumLiveEbayItems({ ebayAPI, jobData, retry }) {
  try {
    const startTimeTo = jobData.startTimeTo
    const startTimeFromDate = new Date(
      Date.parse(startTimeTo) - jobData.days * 24 * 60 * 60 * 1000,
    )
    const startTimeFrom = startTimeFromDate.toISOString()

    const result = await ebayAPI.trading.GetSellerList({
      StartTimeFrom: startTimeFrom,
      StartTimeTo: startTimeTo,
      Pagination: {
        EntriesPerPage: 1,
        PageNumber: 1,
      },
    })

    //Find the total number of listing and return this
    const numberOfListings =
        result?.PaginationResult?.TotalNumberOfEntries ?? 0
    return { numberOfListings }
  } catch (err) {
    //Try again with smaller paging in case this a large client
    if (err.code === 'ECONNABORTED' && !retry) {
      return { retry: true }
    } else {
      throw {
        message: 'Unable to get the number of live items',
        errors: { debug: err.message },
      }
    }
  }
}
