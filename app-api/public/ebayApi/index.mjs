//Main entry point for the API handler
import express from 'express'
const app = express()
const port = 3000

import { handler as getUserDetails } from './user/getUserDetails/src/handlers/index.mjs'

//Build the object to be compatible with AWS lambda
const event = {};


// Runs for every request, before any route
app.use((req, res, next) => {
  res.locals.event = {
    httpMethod: req.method,
    path: req.path,
    queryStringParameters: req.query,
    headers: req.headers,
    requestContext: { authorizer: { claims: { sub: req.query.sub } } },
  }
  next()
})

app.get('/connect', async (req, res) => {
    console.log(res.locals.event)
     const result = await getUserDetails(res.locals.event)
    res.status(Number(result.statusCode)).set(result.headers).send(result.body)
})


app.get('/', async (req, res) => {

  res.send('Root!')

})


//  import { handler } from './user/getUserDetails/src/handlers/index.mjs'

//  const res = await handler({
//        httpMethod: 'GET',
//        requestContext: { authorizer: { claims: { sub: 'user-id' } } },
//  })
//  console.log(res)




app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})