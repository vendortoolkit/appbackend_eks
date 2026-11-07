import express from 'express'
import {
  installErrorHandlers,
  installHealthCheck,
  lazyHandler,
  registerHandlerRoute,
} from '../shared/lambdaAdapter.mjs'

const app = express()
const routes = [
  {
    path: '/payments/stripeSession',
    methods: ['GET', 'POST'],
    handler: lazyHandler(() => import('./stripeSessionManager/src/handlers/index.mjs')),
    requiresAuth: true,
  },
  {
    path: '/stripehooks/all',
    methods: ['POST'],
    handler: lazyHandler(() => import('./stripeHooks/src/handlers/index.mjs')),
  },
]

app.use(express.raw({ type: '*/*', limit: '10mb', inflate: false }))
installHealthCheck(app)
for (const route of routes) {
  registerHandlerRoute(app, route)
}
installErrorHandlers(app)

const port = Number(process.env.PORT ?? 3000)
app.listen(port, '0.0.0.0', () => {
  console.info(`paymentApi listening on port ${port}`)
})
