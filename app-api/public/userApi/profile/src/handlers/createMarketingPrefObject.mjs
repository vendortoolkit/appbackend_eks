import { DDB_TABLES, CONSTANTS } from '/opt/nodejs/core_module/index.mjs'

export function createMarketingPrefObject(data){

    //Set a bool for each of the messaging opt in topics
    return {
        [CONSTANTS.USER_MESSAGES.MESSAGE_TYPE.TRANSACTIONAL]: !!data?.msg_account,
        [CONSTANTS.USER_MESSAGES.MESSAGE_TYPE.ONBOARDING]: !!data?.msg_tips,
        [CONSTANTS.USER_MESSAGES.MESSAGE_TYPE.PROMOTIONAL]: !!data?.msg_offers,
    }
}

export function parseMarketingPrefObject(data){
    return {
        msgAccount: !!data?.[CONSTANTS.USER_MESSAGES.MESSAGE_TYPE.TRANSACTIONAL],
        msgTips:    !!data?.[CONSTANTS.USER_MESSAGES.MESSAGE_TYPE.ONBOARDING],
        msgOffers:  !!data?.[CONSTANTS.USER_MESSAGES.MESSAGE_TYPE.PROMOTIONAL],
    }
}