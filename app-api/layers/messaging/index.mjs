// ------------------------------------------------------------
// Creates the message in a format that can be added
// to the dispatch queue
// ------------------------------------------------------------
export function messageSuite(logger, SendMessageCommand, sqs ){

  // Main function to dispatch a message  
  async function dispatchMessage({ userId, messageId, msgData, messageLib, userProfile }) {

    // Create the message in the format required for the dispatch queue
    const message = createMessage({ userId, messageId, msgData, messageLib, userProfile })
    logger(`dispatchMessage: building dispatch payload for messageId: ${messageId}, datecreated: ${message.messageDateCreated}`)

    await queueMessage({ sqsPayload: message.sqsPayload })
    logger(`dispatchMessage: messageId: ${messageId} added to dispatch queue for userId: ${userId}`)

    return message
  }  

  // Helper function to create the message payload for the dispatch queue
  function createMessage({ userId, messageId, msgData, messageLib, userProfile }) {
    
    const messageDateCreated = new Date().toISOString()

    const recipientType = messageLib.message_channel === 'SMS' ? 'SMS' : 'EMAIL'
    const recipientValue = recipientType === 'SMS'
      ? userProfile.phone
      : [
        userProfile.email,
        ...(userProfile.extra_email
          ? userProfile.extra_email.split(',').map(e => e.trim()).filter(Boolean)
          : []),
      ]

    // Common macros derived from the user profile, available to all message templates
    const profileMacros = {
      macro_first_name: userProfile.first_name ?? '',
      macro_last_name: userProfile.last_name ?? '',
      macro_full_name: [userProfile.first_name, userProfile.last_name].filter(Boolean).join(' '),
      macro_email: userProfile.email ?? '',
      macro_phone: userProfile.phone ?? '',
      macro_company: userProfile.company ?? '',
    }

    const sqsPayload = {
      userId,
      message_id: messageId,
      msgData: { ...profileMacros, ...msgData },
      msgTemplate: messageLib.message_template,
      recipients: {
        type: recipientType,
        value: recipientValue,  
      },
    }
    return { sqsPayload, messageDateCreated }
  }


  // Helper function to add the message to the dispatch queue
  async function queueMessage({ sqsPayload }) {

    const command = new SendMessageCommand({
      QueueUrl: process.env.SQSMESSAGEPRIORITYQUEUE,
      MessageBody: JSON.stringify(sqsPayload),
    })
    await sqs.send(command)
  }
  
  
  return { dispatchMessage, createMessage, queueMessage } 

}





