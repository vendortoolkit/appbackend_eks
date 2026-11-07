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
    path: '/appuser/profile',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    handler: lazyHandler(() => import('./profile/src/handlers/index.mjs')),
    requiresAuth: true,
  },
  {
    path: '/appuser/subscription',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    handler: lazyHandler(() => import('./subscription/src/handlers/index.mjs')),
    requiresAuth: true,
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
  console.info(`userApi listening on port ${port}`)
})
