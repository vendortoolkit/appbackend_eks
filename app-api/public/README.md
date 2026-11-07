# Public API services

The public API is split into four Node.js/Express service roots: `ebayApi`,
`marketingApi`, `paymentApi`, and `userApi`. Each root calls the existing
Lambda handler functions through the shared HTTP adapter; the handler logic
and private Lambda jobs remain unchanged.

## Run a container locally

From the `app-api` directory, build one image per service root:

```sh
docker build -f public/Dockerfile --build-arg SERVICE_ROOT=ebayApi -t vendortoolkit/ebay-api:local .
docker build -f public/Dockerfile --build-arg SERVICE_ROOT=marketingApi -t vendortoolkit/marketing-api:local .
docker build -f public/Dockerfile --build-arg SERVICE_ROOT=paymentApi -t vendortoolkit/payment-api:local .
docker build -f public/Dockerfile --build-arg SERVICE_ROOT=userApi -t vendortoolkit/user-api:local .
```

Pass service configuration at runtime, for example:

```sh
docker run --env-file public/ebayApi/.env -p 3000:3000 vendortoolkit/ebay-api:local
```

Services listen on port `3000` by default. `PORT` can override it. The
`/health` endpoint is available for load-balancer health checks. Direct host
execution also requires the shared Lambda-layer modules at `/opt/nodejs`, so
use the container for a complete local run.

Do not add `.env` files or credentials to source control. The Docker build
context excludes them.

Run the shared adapter tests from any service root with `npm test`.

## ALB identity contract

Protected routes require `x-amzn-oidc-identity`, populated by the ALB OIDC
authentication action. The service maps that trusted value to the existing
handler event field `requestContext.authorizer.claims.sub`. Do not expose
these containers directly to untrusted clients: the trusted ALB must be the
only network path to the service, and incoming identity headers must not be
accepted from clients outside that authentication boundary. Public callbacks
and webhook routes do not require this header. The identity header is unsigned;
the ALB/auth layer must overwrite client-supplied values, and the target must
only trust requests received through the protected ALB path.

## Routes

| Service | Path | Methods | Identity |
| --- | --- | --- | --- |
| ebayApi | `/ebayauth/token` | GET, DELETE | Required |
| ebayApi | `/ebayauth/callback` | GET | Not required |
| ebayApi | `/ebayauth/state` | POST | Required |
| ebayApi | `/ebayapi/user/details` | GET | Required |
| ebayApi | `/ebayapi/metadata/{sites,root-categories,sub-categories,category-search,category-path,category-detail,category-validation,tree-metadata}` | GET | Required |
| ebayApi | `/ebay-pn/hk1-001` through `/ebay-pn/hk5-001` | POST | Not required |
| marketingApi | `/marketing/registerInterest` | POST | Not required |
| paymentApi | `/payments/stripeSession` | GET, POST | Required |
| paymentApi | `/stripehooks/all` | POST | Not required |
| userApi | `/appuser/profile` | GET, POST, PUT, DELETE | Required |
| userApi | `/appuser/subscription` | GET, POST, PUT, DELETE | Required |

`/marketing/registerInterest` follows the service/function naming because the
project route map did not specify a marketing URL. Verify the ALB path rule
against the existing public URL before cutover.

The supplied route map sends POST `/ebay-pn/hk1-001` to a handler that currently
accepts only GET, and includes DELETE for `/appuser/subscription` although its
handler currently accepts only GET, POST, and PUT. The router preserves these
mapped methods; those unsupported methods continue to receive the handler's
existing error response.
