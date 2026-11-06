//Helper to check a users platform notification subscriptions
export async function getUserSubscriptions({ ebayAPI }) {
  try {
    const response = await ebayAPI.trading.GetNotificationPreferences({
      PreferenceLevel: 'User',
    })
    if (response?.Ack !== 'Success' && response?.Ack !== 'Warning') {
      throw {
        message: 'Failed to get user subscriptions',
        errors: { debug: JSON.stringify(response) },
      }
    }
    return { userDeliveryPreferenceArray: response?.UserDeliveryPreferenceArray, deliveryURLName: response?.DeliveryURLName }
  } catch (err) {
    throw {
      message: 'Error getting user subscriptions',
      errors: { debug: err.message },
    }
  }
}


export async function setUserSubscriptions({ events, planDeliveryURLName, ebayAPI }) {
  try {

    //Create the Enable and Disable Arrays
    const NotificationEnable = []
    for (const eventAction in events){
      const evts = events[eventAction].map(event => ({
        EventEnable: eventAction,
        EventType: event,
      }))
      NotificationEnable.push(...evts)
    }

    const UserDeliveryPreferenceArray = {
      NotificationEnable,
    }

    const response = await ebayAPI.trading.SetNotificationPreferences({
      UserDeliveryPreferenceArray,
      DeliveryURLName : planDeliveryURLName,
    })

    if (response?.Ack !== 'Success' && response?.Ack !== 'Warning') {
      throw {
        message: 'Failed to set user subscriptions',
        errors: { debug: JSON.stringify(response) },
      }
    }
    return true
  } catch (err) {
    throw {
      message: 'Error setting user subscriptions',
      errors: { debug: err.message },
    }
  }
}

export async function updatePnDeliveryUrls({ deliveryURLS, ebayAPI }) {
  try {

    //Create the Enable and Disable Arrays
    const DeliveryURLDetails = []
    for (const deliveryURL of deliveryURLS){
      const d = {
        DeliveryURL: deliveryURL.deliveryURL,
        DeliveryURLName: deliveryURL.deliveryURLName,
        status: deliveryURL.status,
      }
      DeliveryURLDetails.push(d)
    }

    const response = await ebayAPI.trading.SetNotificationPreferences({
      ApplicationDeliveryPreferences : {
        DeliveryURLDetails,
      },
    })

    if (response?.Ack !== 'Success' && response?.Ack !== 'Warning') {
      throw {
        message: 'Failed to set application delivery URLS',
        errors: { debug: JSON.stringify(response) },
      }
    }
    return true
  } catch (err) {
    throw {
      message: 'Error setting application delivery URLS',
      errors: { debug: err.message },
    }
  }
}


export async function getPnDeliveryUrls({ ebayAPI }) {
  try {
    const response = await ebayAPI.trading.GetNotificationPreferences({
      PreferenceLevel: 'Application',
    })
    if (response?.Ack !== 'Success' && response?.Ack !== 'Warning') {
      throw {
        message: 'Failed to get application delivery URLS',
        errors: { debug: JSON.stringify(response) },
      }
    }
    return { deliveryURLDetails: response?.ApplicationDeliveryPreferences?.DeliveryURLDetails }
  } catch (err) {
    throw {
      message: 'Error getting application delivery URLS',
      errors: { debug: err.message },
    }
  }
}
