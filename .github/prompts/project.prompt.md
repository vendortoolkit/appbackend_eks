---
name: project
description: Migrate public API Lambda entry points to Express Node.js services
---

Migrate public HTTP entry points from AWS Lambda to long-running Node.js/Express
services while preserving the existing handler business logic.

## Architecture

- The public service roots are `app-api/public/ebayApi`, `marketingApi`,
  `paymentApi`, and `userApi`. Each root is a separate container.
- API Gateway route definitions are a reference for public paths, methods, and
  authorization behavior. HTTP requests are forwarded to these services by an
  ALB; do not add API Gateway infrastructure as part of this migration.
- Use an Express router in each service root to adapt HTTP requests to the
  existing Lambda event format and return the handler's status, headers, and
  body to the caller.
- Preserve handler logic and the `/opt/nodejs` layer imports. Existing calls
  from public handlers to private Lambda jobs remain unchanged.
- Private functions are internal jobs invoked through mechanisms such as SQS,
  EventBridge, or existing service integrations. Do not migrate or otherwise
  update them in this phase.
- The ALB OIDC authentication action must supply the trusted
  `x-amzn-oidc-identity` header. Map it to
  `requestContext.authorizer.claims.sub` on authenticated routes. Never derive
  this claim from a query parameter or an unverified `Authorization` header.
  The identity header is unsigned: the ALB/auth layer must overwrite
  client-supplied values, and services must only accept traffic through the
  protected ALB path.
- Keep each service's environment in its runtime `.env` file. Commit only
  `.env.example` files; do not commit credentials or secrets.
- Build images with `app-api/public/Dockerfile`, selecting the service root with
  the `SERVICE_ROOT` build argument. Do not add cluster or deployment
  configuration unless separately requested.

## Public route map

| Service root | Public path | Methods | Handler | Auth |
| --- | --- | --- | --- | --- |
| `userApi` | `/appuser/profile` | GET, POST, PUT, DELETE | `userApi/profile` | Required |
| `userApi` | `/appuser/subscription` | GET, POST, PUT, DELETE | `userApi/subscription` | Required |
| `ebayApi` | `/ebayauth/token` | GET, DELETE | `ebayApi/auth/token` | Required |
| `ebayApi` | `/ebayauth/callback` | GET | `ebayApi/auth/callback` | Not required |
| `ebayApi` | `/ebayauth/state` | POST | `ebayApi/auth/state` | Required |
| `ebayApi` | `/ebayapi/user/details` | GET | `ebayApi/user/getUserDetails` | Required |
| `ebayApi` | `/ebayapi/metadata/{sites,root-categories,sub-categories,category-search,category-path,category-detail,category-validation,tree-metadata}` | GET | `ebayApi/metadata/getEbayData` | Required |
| `ebayApi` | `/ebay-pn/hk1-001` | POST | `ebayApi/metadata/getEbayData` | Not required |
| `ebayApi` | `/ebay-pn/hk{2,3,4,5}-001` | POST | `ebayApi/ebayPlatformNotificationHook` | Not required |
| `paymentApi` | `/payments/stripeSession` | GET, POST | `paymentApi/stripeSessionManager` | Required |
| `paymentApi` | `/stripehooks/all` | POST | `paymentApi/stripeHooks` | Not required |
| `marketingApi` | `/marketing/registerInterest` | POST | `marketingApi/registerInterest` | Not required |

`/marketing/registerInterest` is the current service route; verify it against
the existing API Gateway mapping before cutover because that mapping was not
included in the original route list. The supplied route map sends POST
`/ebay-pn/hk1-001` to a handler that currently accepts only GET, and includes
DELETE for `userApi/subscription` although its handler currently accepts only
GET, POST, and PUT. Preserve these existing handler behaviors rather than
silently changing business logic.
