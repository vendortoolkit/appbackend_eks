  
export async function getStripeCredentials({  SSMClient,  GetParametersCommand,  sharedConfig, stripeEnv }) {
  
  const ssm = new SSMClient(sharedConfig)

  const params = {
    Names: Object.values(stripeEnv),
    WithDecryption: true,
  }

  try {
    const command = new GetParametersCommand(params)
    const res = await ssm.send(command)

    const result = {}
    res.Parameters.forEach((param) => {
    //return each with their original key names
      const credentialName = Object.keys(stripeEnv).find(key => stripeEnv[key] === param.Name)
      result[credentialName] = param.Value
    })
    return result
  } catch (err) {
    throw new Error(`Error getting Stripe Keys from SSM: ${err.message}`)
  }
}