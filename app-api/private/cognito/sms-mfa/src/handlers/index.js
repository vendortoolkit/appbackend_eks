const AWS = require('aws-sdk');
const b64 = require('base64-js');
const encryptionSdk = require('@aws-crypto/client-node');
const { Vonage } = require('@vonage/server-sdk');
//Configure the encryption SDK client with the KMS key from the environment variables.  
const { encrypt, decrypt } = encryptionSdk.buildClient(encryptionSdk.CommitmentPolicy.REQUIRE_ENCRYPT_ALLOW_DECRYPT);
const generatorKeyId = process.env.KEY_ALIAS;
const keyIds = [ process.env.KEY_ARN ];
const keyring = new encryptionSdk.KmsKeyringNode({ generatorKeyId, keyIds })

exports.handler = async (event) => {
	console.log(event);
	//Decrypt the secret code using encryption SDK.
	let plainTextCode;
	if(event.request.code){
		const { plaintext, messageHeader } = await decrypt(keyring, b64.toByteArray(event.request.code));
		plainTextCode = plaintext
	}
	
	//const VONAGE_API_KEY = process.env.VONAGE_API_KEY;
	//const VONAGE_API_SECRET = process.env.VONAGE_API_SECRET;
	const VONAGE_API_KEY = "ac9326b7"
	const VONAGE_API_SECRET = "rH4NB2EZP34AGrLJ"
	const from = "VendorTools"
	const to = event.request.userAttributes.phone_number

	const vonage = new Vonage({
	apiKey: VONAGE_API_KEY,
	apiSecret: VONAGE_API_SECRET,
	}, {debug: true});
 
	console.log('event.triggerSource is ' + event.triggerSource);	

	// MFA Code
	if(event.triggerSource == 'CustomSMSSender_Authentication'){
		const text = plainTextCode+' is your VendorToolKit code '
		await vonage.sms.send({to, from, text})
			.then(resp => { console.log('Message sent successfully'); console.log(resp); })
			.catch(err => { console.log('There was an error sending the messages.'); console.error(err); });
	}
	if(event.triggerSource == 'CustomSMSSender_SignUp'){
		//Send an SMS message to your user via a custom provider.
		//Include the temporary password in the message.
	}
	else if(event.triggerSource == 'CustomSMSSender_ResendCode'){

	}
	else if(event.triggerSource == 'CustomSMSSender_ForgotPassword'){

	}
	else if(event.triggerSource == 'CustomSMSSender_UpdateUserAttribute'){

	}
	else if(event.triggerSource == 'CustomSMSSender_VerifyUserAttribute'){
		const text = plainTextCode+' is your VendorToolKit code '
		await vonage.sms.send({to, from, text})
			.then(resp => { console.log('Message sent successfully'); console.log(resp); })
			.catch(err => { console.log('There was an error sending the messages.'); console.error(err); });
	}
	else if(event.triggerSource == 'CustomSMSSender_AdminCreateUser'){

	}
	else if(event.triggerSource == 'CustomSMSSender_AccountTakeOverNotification'){

	}
	return;
};