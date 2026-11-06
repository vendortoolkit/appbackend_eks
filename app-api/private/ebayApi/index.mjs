import { handler } from './user/getUserDetails/src/handlers/index.mjs'


async function ebayAPI( event ) {
  const res = await handler( event )
  return res
}

export { ebayAPI }