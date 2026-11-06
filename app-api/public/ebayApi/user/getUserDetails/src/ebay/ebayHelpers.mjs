
//Get the user details from eBay
export async function getEbayUserDetails({ ebayAPI }) {
  //Get the user details from eBay
  try {
    const result = await ebayAPI.trading.GetUser()

    const ebayData = {
      EIASToken: result.User?.EIASToken ?? '',
      Email: result.User?.Email,
      FeedbackScore: result.User?.FeedbackScore ?? '',
      eBayGoodStanding: result.User?.eBayGoodStanding ?? '',
      RegistrationDate: result.User?.RegistrationDate ?? '',
      Site: result.User?.Site ?? '',
      Status: result.User?.Status ?? '',
      UserID: result.User?.UserID ?? '',
      VATStatus: result.User?.VATStatus ?? '',
      StoreOwner: result.User?.SellerInfo?.StoreOwner ?? '',
      RegisteredBusinessSeller: result.User?.SellerInfo?.RegisteredBusinessSeller ?? '',
      MotorsDealer: result.User.SellerInfo?.MotorsDealer ?? '',
    }

    return ebayData

  } catch (err) {
    if (err.response?.status === 401 || err.response?.status === 403) {
      throw {
        message: 'User token has expired or is invalid',
      }
    } else {
      throw {
        message: err?.response?.data?.error_description ?? err?.message,
      }
    }
  }
}

