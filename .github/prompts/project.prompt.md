---
name: project
description: Refactor project-related prompts
---

<!-- Tip: Use /create-prompt in chat to generate content with agent assistance -->

- Refactor project-related prompts to improve clarity and consistency.
- The project is being updated from a AWS lambda based project to Nodejs project
- There are 2 main sections private and public
- Functions in public are accessisible through API gateway
- Function in private are only accessible through internal methods such as SQS, Eventbridge and are system backend jobs
- Public: each directory ebayApi, marketingAPI, paymentApi and userApi are the entry points for that API and will be an indivual docker container, i will refer to these directories as serviceRoot
  - each serviceRoot will have a index.mjs (nodejs app) running express.js
  - These will forward requests to the subservices inside serviceRoot
  - For an example of a forwarded service see: ebayApi -> user/getUserDetails
  - Some APIs will user Get and some will user POST, forward these to the functions
  - Return any results directly back from the fucntion to browser as headers, body and status
  - sub will be provided as an Authorization header (standard format)
  - Any process.env variables should be added to the .env file in each serviceRoot directory, these will be loaded at runtime
  - in each serviceRoot index.mjs file - which will act as the router, specify each API as a seperate route for readability, but create the event object once and forward it to each route  
  - Routing: 
  - routes = [
  { path = "appuser", parent="/"},
  { path = "profile", parent="appuser", methods = ["GET", "POST", "PUT", "DELETE"], path = "userapi/profile", authorizer = true},
  { path = "subscription", parent="appuser", methods = ["GET", "POST", "PUT", "DELETE"],  path = "userapi/subscription", authorizer = true},
  { path = "ebayauth", parent="/", methods = [], authorizer = true },
  { path = "token", parent="ebayauth", methods = ["GET","DELETE"], path = "ebayapi/auth/token", authorizer = true },
  { path = "callback", parent="ebayauth", methods = ["GET"], path = "ebayapi/auth/callback", authorizer = false },
  { path = "state", parent="ebayauth", methods = ["POST"], path = "ebayapi/auth/state", authorizer = true  },
  { path = "ebayapi", parent="/", methods = [], lambdaIntegrationName = "", authorizer = true },
  { path = "user", parent="ebayapi", methods = [], lambdaIntegrationName = "", authorizer = true },
  { path = "details", parent="user", methods = ["GET"],  path = "ebayapi/user/getUserDetails", authorizer = true },
  { path = "metadata", parent="ebayapi", methods = [], lambdaIntegrationName = "", authorizer = true },
  { path = "sites", parent="metadata", methods = ["GET"],  path =  "ebayapi/metadata/getEbayData", authorizer = true },
  { path = "root-categories", parent="metadata", methods = ["GET"],  path =  "ebayapi/metadata/getEbayData", authorizer = true },
  { path = "sub-categories", parent="metadata", methods = ["GET"],  path =  "ebayapi/metadata/getEbayData", authorizer = true },
  { path = "category-search", parent="metadata", methods = ["GET"],  path =  "ebayapi/metadata/getEbayData", authorizer = true },
  { path = "category-path", parent="metadata", methods = ["GET"],  path =  "ebayapi/metadata/getEbayData", authorizer = true },
  { path = "category-detail", parent="metadata", methods = ["GET"],  path =  "ebayapi/metadata/getEbayData", authorizer = true },
  { path = "tree-metadata", parent="metadata", methods = ["GET"],  path =  "ebayapi/metadata/getEbayData", authorizer = true },
  { path = "ebay-pn", parent="/", methods = [], lambdaIntegrationName = "", authorizer = true },
  { path = "hk1-001", parent="ebay-pn", methods = ["POST"], path =  "ebayapi/metadata/getEbayData", authorizer = false },
  { path = "hk2-001", parent="ebay-pn", methods = ["POST"], path = "ebayapi/ebayPlatformNotificationHook", authorizer = false },
  { path = "hk3-001", parent="ebay-pn", methods = ["POST"], path = "ebayapi/ebayPlatformNotificationHook", authorizer = false },
  { path = "hk4-001", parent="ebay-pn", methods = ["POST"], path = "ebayapi/ebayPlatformNotificationHook", authorizer = false },
  { path = "hk5-001", parent="ebay-pn", methods = ["POST"], path = "ebayapi/ebayPlatformNotificationHook", authorizer = false },
  { path = "payments", parent="/", methods = [], lambdaIntegrationName = "", authorizer = true },
  { path = "stripeSession", parent="payments", methods = ["GET","POST"], path = "paymentApi/stripeSessionManager", authorizer = true },
  { path = "stripehooks", parent="/", methods = [], lambdaIntegrationName = "", authorizer = true },
  { path = "all", parent="stripehooks", methods = ["POST"], path = "paymentApi/stripeHooks", authorizer = false },
]
- Private - do not update this yet
