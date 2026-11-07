import express from 'express'
import {
  installErrorHandlers,
  installHealthCheck,
  lazyHandler,
  registerHandlerRoute,
} from '../shared/lambdaAdapter.mjs'

const app = express()
const routes = [
  { path: '/ebayauth/token', methods: ['GET', 'DELETE'], handler: lazyHandler(() => import('./auth/token/src/handlers/index.mjs')), requiresAuth: true },
  { path: '/ebayauth/callback', methods: ['GET'], handler: lazyHandler(() => import('./auth/callback/src/handlers/index.mjs')) },
  { path: '/ebayauth/state', methods: ['POST'], handler: lazyHandler(() => import('./auth/state/src/handlers/index.mjs')), requiresAuth: true },
  { path: '/ebayapi/user/details', methods: ['GET'], handler: lazyHandler(() => import('./user/getUserDetails/src/handlers/index.mjs')), requiresAuth: true },
  { path: '/ebayapi/metadata/sites', methods: ['GET'], handler: lazyHandler(() => import('./metadata/getEbayData/src/handlers/index.mjs')), requiresAuth: true },
  { path: '/ebayapi/metadata/root-categories', methods: ['GET'], handler: lazyHandler(() => import('./metadata/getEbayData/src/handlers/index.mjs')), requiresAuth: true },
  { path: '/ebayapi/metadata/sub-categories', methods: ['GET'], handler: lazyHandler(() => import('./metadata/getEbayData/src/handlers/index.mjs')), requiresAuth: true },
  { path: '/ebayapi/metadata/category-search', methods: ['GET'], handler: lazyHandler(() => import('./metadata/getEbayData/src/handlers/index.mjs')), requiresAuth: true },
  { path: '/ebayapi/metadata/category-path', methods: ['GET'], handler: lazyHandler(() => import('./metadata/getEbayData/src/handlers/index.mjs')), requiresAuth: true },
  { path: '/ebayapi/metadata/category-detail', methods: ['GET'], handler: lazyHandler(() => import('./metadata/getEbayData/src/handlers/index.mjs')), requiresAuth: true },
  { path: '/ebayapi/metadata/category-validation', methods: ['GET'], handler: lazyHandler(() => import('./metadata/getEbayData/src/handlers/index.mjs')), requiresAuth: true },
  { path: '/ebayapi/metadata/tree-metadata', methods: ['GET'], handler: lazyHandler(() => import('./metadata/getEbayData/src/handlers/index.mjs')), requiresAuth: true },
  { path: '/ebay-pn/hk1-001', methods: ['POST'], handler: lazyHandler(() => import('./metadata/getEbayData/src/handlers/index.mjs')) },
  { path: '/ebay-pn/hk2-001', methods: ['POST'], handler: lazyHandler(() => import('./ebayPlatformNotificationHook/src/handlers/index.mjs')) },
  { path: '/ebay-pn/hk3-001', methods: ['POST'], handler: lazyHandler(() => import('./ebayPlatformNotificationHook/src/handlers/index.mjs')) },
  { path: '/ebay-pn/hk4-001', methods: ['POST'], handler: lazyHandler(() => import('./ebayPlatformNotificationHook/src/handlers/index.mjs')) },
  { path: '/ebay-pn/hk5-001', methods: ['POST'], handler: lazyHandler(() => import('./ebayPlatformNotificationHook/src/handlers/index.mjs')) },
]

app.use(express.raw({ type: '*/*', limit: '10mb', inflate: false }))
installHealthCheck(app)
for (const route of routes) {
  registerHandlerRoute(app, route)
}
installErrorHandlers(app)

const port = Number(process.env.PORT ?? 3000)
app.listen(port, '0.0.0.0', () => {
  console.info(`ebayApi listening on port ${port}`)
})
