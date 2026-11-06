// index.mjs - shared Core dependencies

const DDB_TABLES = {
  USER: {
    EBAY_TOKENS: {
      NAME: 'vtkapp_user_ebay_tokens',
      GSI: {
        STATE_TOKEN: 'vtk_state_token_idx',
      },
    },
    EBAY_DETAILS: {
      NAME: 'vtk_user_ebay_details',
      GSI: {
        EAIS_TOKEN: 'vtk_user_ebay_details_eais_token_idx',
      },
    },
    PROFILE: {
      NAME: 'vtkapp_user_profile',
    },
    ACCOUNT_STATUS: {
      NAME: 'vtk_user_account_status',
    },
    PLAN_CONFIG: {
      NAME: 'vtk_user_plan_config',
      GSI: {
        PRODUCT_ID: 'vtk_user_plan_config_product_id_idx',
      },
    },
    SUBSCRIPTIONS_ACTIONS_ERROR_LOG: {
      NAME: 'vtk_user_subscription_actions_error_log',
      TTL_DAYS: 7,
    },
    SUBSCRIPTIONS_ACTIONS_LOG: {
      NAME: 'vtk_user_subscription_actions_log',
      TTL_DAYS: 7,
    },
    APP_SIGNUP_LOG: {
      NAME: 'vtk_signup_log',
    },
    APP_SIGNUP_ERROR_LOG: {
      NAME: 'vtk_signup_error_log',
      TTL_DAYS: 180,
    },
    GLOBAL_OFFERS: {
      NAME: 'vtk_user_global_offers',
      GSI: {
        OFFER_ELIGIBILITY_ID: 'vtk_user_global_offers_offer_eligibility_id_idx',
      },
    },
    OFFERS: {
      NAME: 'vtk_user_offers',
      GSI: {
        USER_ID: 'vtk_user_global_offers_user_id_idx',
      },
    },
  },
  EBAY: {
    CACHED_LISTINGS_JOBS: {
      NAME: 'vtk_ebay_cached_listings_jobs',
      GSI: {
        USERID: 'vtk_ebay_cached_listings_jobs_userid_idx',
        STATUS: 'vtk_ebay_cached_listings_jobs_status_idx',
      },
    },
    CACHED_LISTINGS: {
      NAME: 'vtk_ebay_cached_listings',
      GSI: {
        USERID_ITEMAVAILABLE_CATEGORYID1: 'vtk_ebay_cached_listings_userid_itemavailable_categoryid1_idx',
        USERID_ITEMAVAILABLE_CATEGORYID2: 'vtk_ebay_cached_listings_userid_itemavailable_categoryid2_idx',
        USERID_ITEMAVAILABLE_STORECATEGORY1: 'vtk_ebay_cached_listings_userid_itemavailable_storecategory1_idx',
        USERID_ITEMAVAILABLE_STORECATEGORY2: 'vtk_ebay_cached_listings_userid_itemavailable_storecategory2_idx',
        USERID_ENDTIME: 'vtk_ebay_cached_userid_endtime_idx',
        USERID_STARTTIME: 'vtk_ebay_cached_userid_starttime_idx',
      },
    },
    CACHED_LISTINGS_ERROR_LOG: {
      NAME: 'vtk_ebay_cached_listings_error_log',
      TTL_DAYS: 7,
    },
    CACHED_LISTINGS_LOG: {
      NAME: 'vtk_ebay_cached_listings_log',
      TTL_DAYS: 7,
    },
    NOTIFICATIONS_RECEIVED: {
      NAME: 'vtk_user_ebay_platform_notifications_received',
      TTL_DAYS: 30,
    },
    NOTIFICATIONS_RECEIVED_ERROR_LOG: {
      NAME: 'vtk_user_ebay_platform_notifications_received_error_log',
      TTL_DAYS: 7,
    },
    NOTIFICATIONS_ACTIONS_ERROR_LOG: {
      NAME: 'vtk_ebay_platform_notifications_actions_error_log',
      TTL_DAYS: 7,
    },
    NOTIFICATIONS_ACTIONS_LOG: {
      NAME: 'vtk_ebay_platform_notifications_actions_log',
      TTL_DAYS: 7,
    },
    NOTIFICATIONS_USAGE: {
      NAME: 'vtk_user_ebay_platform_notifications_usage',
    },
    EBAY_SITE_DETAILS: {
      NAME: 'vtk_ebay_site_details',
      GSI: {
        ACTIVE_SITE: 'vtk_ebay_site_details_active_site_idx',
      },
    },
    EBAY_CATEGORY_DETAILS: {
      NAME: 'vtk_ebay_category_details',
      GSI: {
        ACTIVE_TREE_VERSION: 'vtk_ebay_category_details_tree_id_active_tree_version_idx',
      },
    },
    EBAY_ITEMSPEC_DETAILS: {
      NAME: 'vtk_ebay_itemspec_details',
    },
    EBAY_CATEGORIES: {
      NAME: 'vtk_ebay_categories',
      GSI: {
        CATEGORY_ID: 'vtk_ebay_categories_category_id_idx',
        PARENT_ID: 'vtk_ebay_categories_parent_id_idx',
      },
    },
    EBAY_ITEMSPECS: {
      NAME: 'vtk_ebay_itemspecs',
    },
  },
  STRIPE: {
    PENDING_SESSIONS: {
      NAME: 'vtk_stripe_pending_sessions',
      GSI: {
        CHECKOUT_SESSION_ID: 'vtk_stripe_pending_sessions_checkout_session_id_idx',
        USER_ID: 'vtk_stripe_pending_sessions_user_id_idx',
      },
    },
    SESSION_LOG: {
      NAME: 'vtk_stripe_session_log',
    },
    WEBHOOK_ERROR_LOG: {
      NAME: 'vtk_stripe_webhook_error_log',
      TTL_DAYS: 7,
      GSI: {
        USERS: 'vtk_stripe_webhook_error_log_users_idx',
        EVENT_TYPE: 'vtk_stripe_webhook_error_log_event_type_idx',
      },
    },
    WEBHOOK_LOG: {
      NAME: 'vtk_stripe_webhook_log',
      TTL_DAYS: 90,
    },
    SUBSCRIPTIONS: {
      NAME: 'vtk_stripe_subscriptions',
      GSI: {
        USER_ID: 'vtk_stripe_subscriptions_user_id_idx',
      },
    },
    SUBSCRIPTIONS_HISTORY: {
      NAME: 'vtk_stripe_subscriptions_history',
      GSI: {
        USER_ID: 'vtk_stripe_subscriptions_history_user_id_idx',
      },
    },
    PAYMENTS: {
      NAME: 'vtk_stripe_payments',
      GSI: {
        SUBSCRIPTION_ID: 'vtk_stripe_payments_subscription_id_idx',
        INVOICE_ID: 'vtk_stripe_payments_invoice_id_idx',
        STATUS: 'vtk_stripe_payments_status_idx',
        CHECKOUT_SESSION_ID: 'vtk_stripe_payments_checkout_session_id_idx',
      },
    },
  },
  CORE: {
    USER_MESSAGES: {
      NAME: 'vtk_core_user_messages',
      GSI: {
        USER_ID: 'vtk_core_user_messages_user_id_idx',
        STATUS: 'vtk_core_user_messages_status_idx',
      },
    },
    MESSAGE_LIBRARY: {
      NAME: 'vtk_core_message_library',
    },
    MESSAGE_ERROR_LOG: {
      NAME: 'vtk_core_message_error_log',
    },
    MESSAGE_READ_LOG: {
      NAME: 'vtk_core_message_read_log',
    },
  },
  VTKSOLUTIONS: {
    WEBSITE_RI: {
      NAME: 'vtksolutions_website_ri',
    },
  },
}

const CONSTANTS = {
  SUBSCRIPTION_ACTIONS: {
    ADD_PLAN: 'addPackage',
    REMOVE_PLAN: 'removePackage',
    SOFTLOCK_PLAN: 'softlockPackage',
  },
  EBAY_PN_ACTIONS: {
    SUBSCRIBE: 'subscribe',
    UNSUBSCRIBE: 'unsubscribe',
  },
  PLAN_STATUSES: {
    ACTIVE: 'active',
    INACTIVE: 'inactive',
    PENDING_CHANGE: 'pending_change',
    SOFTLOCKED: 'softlocked',
    UNKNOWN: 'unknown',

  },
  ACCOUNT_STATUSES: {
    ACTIVE: 'active',
    CANCELED: 'canceled',
    PENDING: 'pending_change',
    ENDED: 'ended',
  },
  STRIPE: {
    PAYMENT_STATUSES: {
      PAID: 'paid',
      PENDING: 'pending',
      FAILED: 'failed',
    },
    SESSION_STATUSES: {
      COMPLETED: 'completed',
      PENDING: 'pending',
      EXPIRED: 'expired',
    },
    TRANSACTION_TYPES: {
      PAYMENT: 'payment',
      REFUND: 'refund',
    },
  },
  USER_OFFERS: {
    ELIGIBILTY_IDS: {
      NEW_USERS: 'NEW_USERS',
      MANUALLY_ASSIGNED: 'MANUALLY_ASSIGNED',
    },
    OFFER_STATUSES: {
      ACTIVE: 'active',
      EXPIRED: 'expired',
      REDEEMED: 'redeemed',
    },
    OFFER_TYPES: {
      DISCOUNT: 'discount',
      TRIAL: 'trial',
      OTHER: 'other',
    },
  },
  USER_MESSAGES: {
    EVENT_CODES: {
      NEW_ACCOUNT_WELCOME : 'NEW_ACCOUNT_WELCOME',
      SUBSCRIPTION_CREATED: 'SUBSCRIPTION_CREATED',
      SUBSCRIPTION_CANCELLED: 'SUBSCRIPTION_CANCELLED',
    },
    MESSAGE_SCHEDULE: {
      IMMEDIATE : 'IMMEDIATE',
    },
    EVENT_STATUS: {
      ACTIVE : 'ACTIVE',
      INACTIVE: 'INACTIVE',
    },
    STATUS: {
      AWAITING_SEND: 'AWAITING_SEND',
      SENDING: 'SENDING',
      COMPLETE: 'COMPLETE',
    },
    SEND_STATUS: {
      NOT_SENT: 'NOT_SENT',
      SUCCESS: 'SUCCESS',
      FAILED: 'FAILED',
      CANCELLED: 'CANCELLED',
    },
    MESSAGE_TYPE: {
      TRANSACTIONAL: 'TRANSACTIONAL',
      ONBOARDING: 'ONBOARDING',
      PROMOTIONAL: 'PROMOTIONAL',
    },
    DEFAULT_SCHEDULE_TIMEOUT_MINS : 120,
  },
  EBAY_METADATA: {
    ITEM_SPEC_DOWNLOAD_STATUS: {
      DOWNLOADING: 'downloading',
      DOWNLOADED: 'downloaded',
      RETRY: 'retry',
      FAILED: 'failed',
      IN_PROGRESS: 'in_progress',
      COMPLETED: 'completed',
    },
  },
}

const LAMBDA_NAMES = { 
  MESSAGE_MANAGER_LAMBDA: 'vtk_core_messageManager',
}


// Exports
export { DDB_TABLES, CONSTANTS, LAMBDA_NAMES }
