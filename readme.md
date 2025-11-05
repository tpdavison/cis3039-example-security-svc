# Secure Backend Service Example

## Project

This project provides Azure Functions for managing products.

### Available Endpoints

- `GET /api/products` - Public products, or products including prices with a valid OAuth2 token granting `read:products`
- `POST /api/products` - Upsert (create or update) a product
- `PUT /api/products` - Upsert (create or update) a product

### OAuth2 Token Validation and Price Redaction

The `GET /api/products` endpoint supports optional OAuth2 access token validation using the `jose` library.

- **Without an Authorization header**: `200 OK`, with `pricePence` set to `null` in the response JSON.
- **With a malformed, invalid, expired or expiry-less bearer token**: `401 Unauthorized`, with no Product data.
- **With a valid token but missing `read:products` scope**: `403 Forbidden`, with no Product data.
- **With a valid token and `read:products` scope**: `200 OK`, including prices. In this example, this scope gates access to restricted price information.

Token validation requires `exp` and checks the signature, issuer, audience and relevant time claims using `jose`. A correctly signed token without an expiry is rejected with `401`. A verification infrastructure/configuration failure returns `503 Service Unavailable`, rather than treating the token as invalid or returning anonymous data. OAuth2 token validation must be enabled via configuration (see below).

### Trace the GET request

`src/functions/list-products-http.ts` extracts the bearer token from the
Authorization header with `parseBearerToken` from `src/infra/parse-bearer-token.ts` and maps results
and authentication failures to HTTP responses. It passes the token string
(or `null` for an absent header) to
`createListProductsDeps` in `src/config/composition-root.ts`. That request-scoped
composition function invokes the configured validator for a supplied token,
obtains the plain `AuthContext` and assembles the Product dependencies.
`src/app/list-products.ts` then enforces `read:products` and redacts anonymous
prices. Neither the composition root nor the validator depends on Azure's
`HttpRequest` type; header extraction and HTTP decisions stay in the handler.

## Development environment

Use VS Code, a working container runtime and the Dev Containers extension.
Follow the Week 5–6 history-preserving private-copy workflow:

1. In VS Code, choose **Git: Clone** from the Command Palette and enter
   `https://github.com/tpdavison/cis3039-example-security-svc.git`.
2. Open the cloned folder, then choose **Dev Containers: Reopen in Container**.
3. In GitHub, create an empty **private** repository named
   `cis3039-example-security-svc`, without a README, licence or `.gitignore`.
4. In the container terminal, replace `YOUR_GITHUB_USERNAME` and set the remote:

```bash
git remote set-url origin https://github.com/YOUR_GITHUB_USERNAME/cis3039-example-security-svc.git
git remote -v
git branch --show-current
```

Confirm that both remote URLs name your private repository and the branch is
`main`, then push the existing history:

```bash
git push -u origin main
```

If you already have a private copy, continue there. Keep the existing history;
do not initialise a new repository or create a public fork. This practice copy
is separate from your assessment implementation.

Run all remaining Bash commands from this repository's root inside the course
Dev Container, including on Windows. It uses
`ghcr.io/tpdavison/devops-labs:2026-latest`, Node.js 22, TypeScript 7 and Azure
Functions runtime/Core Tools 4. Check the tools and restore locked dependencies:

```bash
node --version
npm --version
func --version
az version
auth0 --version
npm ci
```

Stop if installation fails; retain the lockfile and confirm you are in the
supported container. `npm test` is a placeholder that exits with status 1;
no automated test suite is supplied for this lab.

## Local setup and checks

Copy the non-secret template only if you do not already have local settings:

```bash
if [ ! -f local.settings.json ]; then
  cp local.settings.template.json local.settings.json
fi
npm run typecheck
npm run build
```

Keep `FUNCTIONS_WORKER_RUNTIME` set to `node`. Remove any `PRODUCT_UPDATED_KEY`
entry from an older local settings file; provide keys only through shell
variables. Keep host keys and access tokens out of settings files, Git, browser
assets and screenshots. Azure application settings supply deployed secrets.
Refer briefly to Week 5 for assessment configuration practice.

For this first local check, leave the editable `PRODUCT_UPDATED_ENDPOINT`
constant empty in `src/config/composition-root.ts` so the dummy logger is selected:

```bash
npm start
```

`npm start` cleans and rebuilds `dist/` before starting the Functions host at
`http://localhost:7071`. Check that GET, POST and PUT are registered on
`/api/products`. Leave the host running and open a second Bash terminal at the
same repository root for HTTP calls. If port 7071 is occupied, stop your own
previous Functions host before retrying.

### List the seeded Products

```bash
curl -i http://localhost:7071/api/products
```

Expect `200` and two seeded Products: `p-001` (Seeded Widget) and `p-002`
(Seeded Gadget). Each has `pricePence: null` in the anonymous response JSON.
No Auth0 settings are needed for this anonymous check.

### Upsert a Product

```bash
curl -i http://localhost:7071/api/products \
  -H 'Content-Type: application/json' \
  --data-binary @samples/product-post.json
```

`--data-binary` sends a POST. Expect `200` with `id: "product-123"` and
`pricePence: 1999`. The host terminal logs `Product updated event:` through the
dummy adapter. Repeat the GET to see `product-123` with its price redacted.
Repeating the POST updates the same ID; PUT is also supported.

Check malformed input separately:

```bash
curl -i http://localhost:7071/api/products \
  -H 'Content-Type: application/json' \
  --data-binary '{'
```

Expect `400` and `Request body must be valid JSON`, without a notification.
A `502` on the valid POST means an HTTP notifier is configured; stop the host
and check the endpoint constant before repeating this dummy check.

If the host reports a storage-health warning, check the actual HTTP responses
above: this HTTP-only fake-repository example uses no storage bindings. A host
that fails to register or serve these routes has not passed the checkpoint.

The repository is an in-memory fake: saved Products disappear on process
restart and are not shared across Azure instances. Do not use a later Azure
GET as the only proof of a successful upsert. Use its POST response and the
receiver log for downstream delivery evidence. No database is introduced here.
Stop the local host with Ctrl+C before proceeding.

## Azure setup

### Select the subscription and resource names

Sign in, select your course subscription and confirm it before creating resources:

```bash
az login
az account list \
  --query '[].{subscriptionName:name,subscriptionId:id}' --output table
read -r -p 'Course subscription ID: ' SECURITY_SUBSCRIPTION_ID
az account set --subscription "$SECURITY_SUBSCRIPTION_ID"
az account show \
  --query '{subscriptionName:name,subscriptionId:id}' --output table
```

Use a region permitted by your course subscription and the same Linux
Consumption approach as the Week 5 API and `devnull-svc`. If you need to check
inherited region restrictions, inspect subscription policy:

```bash
az policy assignment list \
  --scope "/subscriptions/${SECURITY_SUBSCRIPTION_ID}" \
  --disable-scope-strict-match true --output json
```

If region or capacity policy is unclear, check with the tutor before creation.
Replace every `YOUR_...` value below. Use a dedicated disposable resource group.
Function App and storage account names must be globally unique; storage names
use 3–24 lowercase letters and digits.

```bash
SECURITY_RESOURCE_GROUP='security-test-YOUR_UID-rg'
SECURITY_APP_NAME='security-test-YOUR_UID-func'
SECURITY_STORAGE_ACCOUNT='YOUR_UNIQUE_LOWERCASE_STORAGE_NAME'
SECURITY_REGION='YOUR_PERMITTED_REGION'
```

### Create the resources

These commands create the security caller, not the separate receiver. They
explicitly select Linux, Functions 4 and Node.js 22, matching `package.json`.
Run commands individually and resolve each error before continuing.

```bash
az group create \
  --name "$SECURITY_RESOURCE_GROUP" \
  --location "$SECURITY_REGION" \
  --output none

az storage account create \
  --name "$SECURITY_STORAGE_ACCOUNT" \
  --resource-group "$SECURITY_RESOURCE_GROUP" \
  --location "$SECURITY_REGION" \
  --sku Standard_LRS --kind StorageV2 \
  --output none

az functionapp create \
  --name "$SECURITY_APP_NAME" \
  --resource-group "$SECURITY_RESOURCE_GROUP" \
  --storage-account "$SECURITY_STORAGE_ACCOUNT" \
  --consumption-plan-location "$SECURITY_REGION" \
  --os-type Linux --runtime node --runtime-version 22 \
  --functions-version 4 --https-only true \
  --output none

az functionapp config set \
  --name "$SECURITY_APP_NAME" \
  --resource-group "$SECURITY_RESOURCE_GROUP" \
  --linux-fx-version 'NODE|22' \
  --output none

az functionapp config show \
  --name "$SECURITY_APP_NAME" \
  --resource-group "$SECURITY_RESOURCE_GROUP" \
  --query linuxFxVersion --output tsv
```

Expect `NODE|22`. Stop on resource, runtime or policy errors instead of changing
the hosting approach as part of this security exercise.

### Publish and discover the actual hostname

Build locally, then publish the compiled output without a second build:

```bash
npm run build
func azure functionapp publish "$SECURITY_APP_NAME" --no-build
```

Stop if either step fails. Run from the course Linux container; do not use
`--publish-local-settings`. The ignored local settings file does not configure
the deployed app. Retrieve the hostname rather than deriving it from the app name:

```bash
SECURITY_HOSTNAME=$(az functionapp show \
  --name "$SECURITY_APP_NAME" \
  --resource-group "$SECURITY_RESOURCE_GROUP" \
  --query defaultHostName --output tsv)
```

Stop if retrieval fails, is empty or returns `None`. Then set the base URL:

```bash
SECURITY_API_BASE_URL="https://${SECURITY_HOSTNAME}/api"
curl -i "${SECURITY_API_BASE_URL}/products"
```

Expect `200` with the seeded public Products and `pricePence: null`.
The base URL ends in `/api` without a trailing slash. A `404` suggests a route,
hostname or deployment problem; verify the build and publication before proceeding.

For browser calls from the local SPA, allow its origin on the backend:

```bash
az functionapp cors add \
  --name "$SECURITY_APP_NAME" \
  --resource-group "$SECURITY_RESOURCE_GROUP" \
  --allowed-origins http://localhost:5173 \
  --output none
```

Add the actual deployed SPA origin when it is available. CORS and HTTPS are
separate from authentication and application authorisation. For local SPA →
local backend work, stop the host and run `npm start -- --cors http://localhost:5173`.
The Auth0 section below configures Auth0's own callback and origin lists separately.

### Retrieve this service's ordinary host key

Run these Bash commands from the repository root in the course Dev Container.
Reuse `SECURITY_APP_NAME` and `SECURITY_RESOURCE_GROUP` from deployment. In a new
terminal, enter those same names before retrieving the key:

```bash
read -r -p 'Security Function App name: ' SECURITY_APP_NAME
read -r -p 'Security resource group: ' SECURITY_RESOURCE_GROUP
SECURITY_HOST_KEY=$(az functionapp keys list \
  --name "$SECURITY_APP_NAME" \
  --resource-group "$SECURITY_RESOURCE_GROUP" \
  --query functionKeys.default \
  --output tsv)
```

Stop if retrieval fails, or the value is empty or `None`. Check the selected
subscription, app name and completed deployment before retrying. Do not print
the key. Once retrieval succeeds, export it for calls from this terminal:

```bash
export SECURITY_HOST_KEY
```

This is the ordinary host key named `default`, not the administrative `_master`
key. A host key authorises functions with `authLevel: 'function'` throughout its
receiving Function App. A function-scoped key restricts access to one function.
The master key also permits administrative operations and must not be used for
routine application calls. See [Microsoft's access-key guidance](https://learn.microsoft.com/en-us/azure/azure-functions/function-keys-how-to).

| Secret                | Receiving Function App | Where it is used                                                                    |
| --------------------- | ---------------------- | ----------------------------------------------------------------------------------- |
| `SECURITY_HOST_KEY`   | This security service  | A backend caller sends it in `x-functions-key` to POST/PUT `/api/products`.         |
| `PRODUCT_UPDATED_KEY` | `devnull-svc`          | This security service sends it in `x-functions-key` to POST `/api/product-updated`. |

These are different secrets for different receiving apps. Neither belongs in the
SPA, a `VITE_*` variable, repository files or screenshots. Keep shell tracing
(`set -x`) off and avoid verbose HTTP output that could expose request headers.
Do not publish local settings containing secrets. GET `/api/products` retains
its separate public/bearer-token contract; a host key does not grant price access.

### Verify deployed upsert key enforcement

Discover the actual hostname in the same terminal:

```bash
SECURITY_HOSTNAME=$(az functionapp show \
  --name "$SECURITY_APP_NAME" \
  --resource-group "$SECURITY_RESOURCE_GROUP" \
  --query defaultHostName --output tsv)
```

Stop if retrieval fails, is empty or returns `None`. Then set the API base URL:

```bash
SECURITY_API_BASE_URL="https://${SECURITY_HOSTNAME}/api"
```

With a valid sample, a missing key and an incorrect key must each return `401`:

```bash
curl -i "${SECURITY_API_BASE_URL}/products" \
  -H 'Content-Type: application/json' \
  --data-binary @samples/product-post.json
curl -i "${SECURITY_API_BASE_URL}/products" \
  -H 'Content-Type: application/json' \
  -H 'x-functions-key: deliberately-invalid-key' \
  --data-binary @samples/product-post.json
```

The correct key passes host authentication and, with a working notifier, returns
`200` with the saved Product:

```bash
curl -i "${SECURITY_API_BASE_URL}/products" \
  -H 'Content-Type: application/json' \
  -H "x-functions-key: ${SECURITY_HOST_KEY}" \
  --data-binary @samples/product-post.json
```

A `502` instead means the save completed but downstream notification failed;
check the receiver settings below. A `404` suggests a hostname, route or deployment
problem. If the correct key gives `401`, confirm it belongs to this app, not the
receiver. The local Functions host normally bypasses key enforcement, so local
calls cannot prove these negative checks.

## Product Updated Notifications

This service saves the Product, then synchronously sends a "product updated" notification.
A GET only lists Products; use POST or PUT to trigger the notification.

- Default behaviour: uses a dummy adapter that logs the event to the console.
- HTTP adapter: enabled when the editable `PRODUCT_UPDATED_ENDPOINT` constant in
  `src/config/composition-root.ts` contains the complete receiver URL.

The lab keeps three non-secret values together in that composition root:

| Constant                   | Value to enter                                                                                                                     |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH0_ISSUER`             | Your exact Auth0 issuer, e.g. `https://YOUR_AUTH0_DOMAIN/`, including the trailing slash                                           |
| `AUTH0_AUDIENCE`           | The Auth0 Products API identifier                                                                                                  |
| `PRODUCT_UPDATED_ENDPOINT` | The complete receiver URL, e.g. `https://YOUR_RECEIVER_HOSTNAME/api/product-updated`; empty deliberately selects the dummy adapter |

These constants start empty so the initial anonymous/dummy check needs no cloud
configuration. Edit them for your lab resources. The notifier POSTs directly to
the endpoint; it appends no route and does not use a base URL. The receiver
returns `202 Accepted` and logs `Product updated:` with the validated payload.
Only `PRODUCT_UPDATED_KEY` is supplied through the local shell or Azure
application settings. There is no `PRODUCT_UPDATED_BASE_URL` environment setting.
For assessment work, refer to Week 5 to externalise the non-secret settings too;
Week 7 focuses on the security code. The SPA's separate `/api` base-URL convention
is unchanged.

The notification has a JSON body shaped as:

```
{
  "id": "string",
  "name": "string",
  "pricePence": 1234,
  "description": "string",
  "updatedAt": "2025-01-01T12:34:56.000Z" // ISO string
}
```

### Switch from dummy mode to the real receiver locally

Stop the local host. In `src/config/composition-root.ts`, set the endpoint
constant to your receiver's full URL, using its actual deployed hostname:

```typescript
const PRODUCT_UPDATED_ENDPOINT: string =
  'https://YOUR_RECEIVER_HOSTNAME/api/product-updated';
```

In the Bash terminal used to start this service, capture the receiver's ordinary
host key without printing it or putting it in a file, then restart:

```bash
read -r -s -p 'Receiver host key: ' PRODUCT_UPDATED_KEY
printf '\n'
export PRODUCT_UPDATED_KEY
npm start
```

`npm start` rebuilds before starting, so it picks up the edited constant. The
adapter sends `PRODUCT_UPDATED_KEY` in `x-functions-key`. It belongs to the
receiver, and is separate from this service's inbound upsert key. Changing
only the shell key still requires restarting the local host. Keep secrets out
of Git, screenshots and SPA settings.

To return to dummy mode, stop the host, set the endpoint constant back to `''`
and run `npm start` again. Never put a literal key in the source constants.

### Configure the deployed caller and republish

Keep the real endpoint in the composition root. In the terminal with the
receiver's exported `PRODUCT_UPDATED_KEY` and the security caller resource names,
set **only the key** as an Azure application setting:

```bash
az functionapp config appsettings set \
  --name "$SECURITY_APP_NAME" \
  --resource-group "$SECURITY_RESOURCE_GROUP" \
  --settings "PRODUCT_UPDATED_KEY=${PRODUCT_UPDATED_KEY}" \
  --output none
npm run build
func azure functionapp publish "$SECURITY_APP_NAME" --no-build
```

Stop if the setting, build or publication fails. The endpoint is compiled into
the app; changing it or the Auth0 constants requires rebuilding and republishing.
Local settings files and shell non-secret values do not override these constants.
A key-only update uses the application-setting command and needs no code
publication. The app restarts as settings are applied; if necessary restart it:

```bash
az functionapp restart \
  --name "$SECURITY_APP_NAME" \
  --resource-group "$SECURITY_RESOURCE_GROUP"
```

### Verify delivery and failure handling

From a second Bash terminal at this repository's root, with the local caller
running against the deployed receiver:

```bash
curl -i http://localhost:7071/api/products \
  -H 'Content-Type: application/json' \
  --data-binary @samples/product-post.json
```

Expect `200` with the saved Product. Check the deployed receiver's invocation
logs for `Product updated:` and the matching Product ID and timestamp. A local
dummy-adapter log is not evidence of receiver delivery.

After building/publishing the real receiver endpoint and setting the deployed caller's `PRODUCT_UPDATED_KEY`,
repeat in the terminal where you retrieved this service's `SECURITY_HOST_KEY`
and discovered `SECURITY_API_BASE_URL` above. If using a new terminal, repeat
those retrieval steps first. Send the sample with this service's own key:

```bash
curl -i "${SECURITY_API_BASE_URL}/products" \
  -H 'Content-Type: application/json' \
  -H "x-functions-key: ${SECURITY_HOST_KEY}" \
  --data-binary @samples/product-post.json
```

Expect `200` and the corresponding receiver log again. Check inbound key
rejection on deployed endpoints; the local Functions host normally bypasses it.

| Failure                                                                  | Caller response                               |
| ------------------------------------------------------------------------ | --------------------------------------------- |
| Malformed JSON or invalid Product fields                                 | `400`; no save or notification                |
| Configuration failure (invalid/non-HTTPS endpoint or blank receiver key) | `500`; no save or outbound request            |
| Save failure                                                             | `500`; notification not attempted             |
| Receiver rejects delivery (including `401` or `500`), or network failure | `502`, `success: false`, `productSaved: true` |

For a negative delivery check, temporarily give the **local caller** a deliberately
incorrect `PRODUCT_UPDATED_KEY`, restart it and repeat the POST. Expect `502`,
not `200` or `400`; the denied receiver request should not reach its handler.
Restore the correct key and restart before continuing.

HTTP configuration is validated before saving: a non-blank endpoint must be an
absolute HTTPS URL, and HTTP mode requires a non-blank receiver key. Configuration
failure returns a generic `500`; an incorrect non-blank key still reaches the
receiver and exercises the post-save failure path. Blank endpoint selects dummy
mode without requiring a key.

A notification failure happens **after the save**: the response does not imply
rollback, and repeating the request can send another notification. This is the
same save-then-communicate partial-failure pattern in **Week 6 worksheet B3**,
which demonstrates an in-memory repository save followed by failed publication.
The saved Product remains present while that process continues. The process
can stop between saving and notifying, and a timeout can leave delivery uncertain.
Keep this interaction synchronous; no retries or resilience redesign are introduced
here.

Clear secrets from the relevant terminal when finished:

```bash
unset PRODUCT_UPDATED_KEY SECURITY_HOST_KEY
```

## Auth0 Setup

Use this ordered setup for the backend and Product SPA together. Reuse one
tenant, one Products API, one SPA application and the same test users; do not
repeat tenant or user creation when moving to `cis3039-example-security-app`.
Run Bash commands in this backend repository's course Dev Container unless a
step explicitly switches to the SPA. Stop and resolve errors before continuing.

### 1. Select the shared tenant

If needed, create a tenant in the Auth0 Dashboard with the course naming
convention (for example, `shopping-dev-ab47`). Otherwise reuse your teaching
tenant. Sign in and list the available tenants:

```bash
auth0 login
auth0 tenants list
read -r -p 'Auth0 tenant domain (without https:// or trailing slash): ' AUTH0_DOMAIN
auth0 tenants use "$AUTH0_DOMAIN"
```

Confirm that the active tenant is the one intended for both examples. Keep the
actual domain, including its region suffix, for the backend and SPA settings.

### 2. Register the Products API and enable RBAC

Choose a stable API identifier, for example `https://products.shopping.thamco.com`.
It is an identifier for the token audience, not an address that must resolve.
It is separate from this backend's deployed `https://.../api` HTTP base URL.

```bash
read -r -p 'Products API identifier/audience: ' AUTH0_AUDIENCE
auth0 apis create \
  --name products-dev-api \
  --identifier "$AUTH0_AUDIENCE" \
  --scopes read:products \
  --signing-alg RS256 \
  --enforce-policies \
  --token-dialect access_token \
  --offline-access=false \
  --no-input --json
```

If the API already exists, open that API in the Dashboard instead of creating
another. Under **Applications → APIs → your API**, check that:

- **Permissions** defines `read:products`.
- **Settings → RBAC Settings → Enable RBAC** is on.
- **Add Permissions in the Access Token** is off. The backend checks granted
  `scope`, not the optional `permissions` array.
- Tokens use RS256; offline access/refresh tokens are not needed for this example.

Keep the API identifier exactly the same in every backend and SPA audience
setting. Accept consent when Auth0 asks; localhost may still require it, so
skipping consent is not a prerequisite for this lab.

### 3. Create a reader role and two test users

Create the role once, or reuse an existing role with the same API permission:

```bash
auth0 roles create \
  --name ProductReader \
  --description 'Can read products including prices' \
  --no-input --json
```

Record the returned role `id` (beginning `rol_`), then attach the API permission:

```bash
read -r -p 'ProductReader role ID: ' AUTH0_ROLE_ID
auth0 roles permissions add "$AUTH0_ROLE_ID" \
  --api-id "$AUTH0_AUDIENCE" \
  --permissions read:products \
  --no-input
```

Despite the flag name, `--api-id` here takes the API **identifier/audience**,
not the API record's internal `id`.

In the Auth0 Dashboard, open **User Management → Users → Create User**. Create
two disposable test identities in the database connection
`Username-Password-Authentication` (or your tenant's equivalent). Choose your
own distinct test email addresses and passwords meeting that connection's
policy; no shared example password is supplied. Reuse existing suitable test
users if you already have them.

Record each user's `user_id`. Give only the reader user the ProductReader role:

```bash
read -r -p 'Reader user ID: ' AUTH0_READER_USER_ID
auth0 users roles assign "$AUTH0_READER_USER_ID" \
  --roles "$AUTH0_ROLE_ID" \
  --no-input
```

Leave the second user without `read:products`, including any direct permission
or other role granting it. In the user's Roles/Permissions tabs, confirm the
reader has the permission and the second user does not.

The flow is **role → API permissions → requested/granted scope → backend
check**. With RBAC enabled, the granted API scope is the intersection of what
the SPA requests and what the user has. Signing in alone does not grant price
access. See [Auth0's RBAC guidance](https://auth0.com/docs/get-started/apis/enable-role-based-access-control-for-apis).

### 4. Configure this backend

In `src/config/composition-root.ts`, edit the non-secret constants using the
same tenant and API identifier chosen above:

```typescript
const AUTH0_ISSUER: string = 'https://YOUR_AUTH0_DOMAIN/';
const AUTH0_AUDIENCE: string = 'YOUR_PRODUCTS_API_IDENTIFIER';
```

Use your actual values, not the placeholders. The issuer's trailing slash
matters: the composition root derives the JWKS URL by appending
`.well-known/jwks.json`. No separate JWKS setting is needed. The API audience
is an identifier, not the backend hostname. Keep the real receiver endpoint
constant if continuing the backend-to-backend checks.

Stop and restart the local host to rebuild the constants:

```bash
npm start
```

For the deployed backend, rebuild and republish from the same source:

```bash
npm run build
func azure functionapp publish "$SECURITY_APP_NAME" --no-build
```

Keep `PRODUCT_UPDATED_KEY` in Azure application settings as configured above;
there are no `OAUTH2_*` application settings for this lab. Remove obsolete
non-secret entries from older local settings files to avoid confusion. Their
values are not read by this version of the example.

Anonymous requests still work with the Auth0 constants empty. A supplied bearer
token without verification configuration gets `503`, not an anonymous success.
In assessment work, follow Week 5 for externalising the non-secret settings.

### 5. Hand off the shared settings to the Product SPA

In the same Auth0 tenant, register one **Single Page Application**, or reuse the
existing Product SPA registration. For local development:

```bash
auth0 apps create \
  --name products-dev-app \
  --type spa \
  --auth-method None \
  --callbacks http://localhost:5173 \
  --logout-urls http://localhost:5173 \
  --web-origins http://localhost:5173 \
  --no-input --json
```

Record its `client_id`; a SPA needs no client secret. In its Dashboard settings,
confirm Allowed Callback URLs, Allowed Logout URLs and Allowed Web Origins
contain `http://localhost:5173`. When deploying the SPA, add its actual HTTPS
origin to all three lists, matching the SDK's callback/logout URLs exactly.
Ensure the test users' database connection is enabled for this SPA under its
Connections tab.

Switch to the SPA repository for frontend configuration and startup. Its public
settings must use the same tenant, client ID and API audience:

```dotenv
VITE_AUTH0_DOMAIN=YOUR_ACTUAL_AUTH0_DOMAIN
VITE_AUTH0_CLIENT_ID=YOUR_SPA_CLIENT_ID
VITE_AUTH0_AUDIENCE=YOUR_PRODUCTS_API_IDENTIFIER
VITE_API_BASE_URL=https://YOUR_ACTUAL_TEST_HOSTNAME/api
```

The HTTP base URL is the security backend's real hostname; the audience is the
Auth0 API identifier. Neither setting is a host key. Configure the backend's
Azure CORS list separately for the local/deployed SPA origin; Auth0's allowed
origins do not configure backend CORS or authorise Product requests.

The SPA integration must explicitly request `read:products` in the SDK's
`authorizationParams.scope` (alongside `openid profile email`) and pass the
API audience. Setting an audience alone does not request this permission.
Keep the Auth0 SDK's default in-memory session behaviour and Authorization Code
with PKCE; no explicit refresh-token or persistent `localStorage` configuration
is required. Token-acquisition failures must be displayed as errors, without
falling back to anonymous requests.

### 6. Verify the token and permission states

Use the SPA to sign in with each test user and obtain a fresh API access token.
Use an **access token**, not an ID token or a host key. After changing role or
permission assignments, sign out and sign back in so verification uses a newly
issued token; an existing JWT does not acquire updated permissions.

For a direct API check, capture the access token in a shell variable without
printing it, saving it to a file or pasting it into a third-party token decoder:

```bash
read -r -s -p 'API access token: ' ACCESS_TOKEN
printf '\n'
curl -i http://localhost:7071/api/products \
  -H "Authorization: Bearer ${ACCESS_TOKEN}"
unset ACCESS_TOKEN
```

| Request                                                                            | Expected result                                 |
| ---------------------------------------------------------------------------------- | ----------------------------------------------- |
| No Authorization header                                                            | `200`, with `pricePence: null` in response JSON |
| Malformed, invalid, expired or expiry-less bearer token                            | `401`, no Product data                          |
| Fresh valid token for the user without `read:products`                             | `403`, no Product data                          |
| Fresh valid token for the reader, with the requested/granted `read:products` scope | `200`, including prices                         |
| Verification service/configuration unavailable                                     | `503`, no anonymous fallback                    |

Also verify sign-out returns the SPA to public data and removes previously
received prices. A `401` suggests issuer, audience, signature or time validation;
a `403` means a valid token lacks the required scope. Check RBAC, the role's API
identifier and the SPA's requested scope before changing backend rules.

Keep test credentials and tokens out of Git and screenshots. Retain the test
users and role until the SPA checks are complete; afterwards remove disposable
identities/resources that are no longer needed.

## Cleanup

Keep the caller, receiver and Auth0 test setup until the Product SPA checks are
complete. Remove only disposable resources that are no longer needed. First
confirm the subscription and inspect the dedicated security resource group:

```bash
az account show \
  --query '{subscriptionName:name,subscriptionId:id}' --output table
az resource list --resource-group "$SECURITY_RESOURCE_GROUP" \
  --query '[].{resourceName:name,resourceType:type}' --output table
```

If the group contains anything needed for subsequent work, retain it. Otherwise
delete the group and all resources within it, checking its name in the confirmation
prompt. The following command waits for deletion; it is not a verification command:

```bash
az group delete --name "$SECURITY_RESOURCE_GROUP"
```

Clean up the receiver separately using its README, and remove disposable Auth0
users/roles/SPA/API only when no other example uses them. Stop local hosts and
clear secret variables in every terminal where they were set:

```bash
unset SECURITY_HOST_KEY PRODUCT_UPDATED_KEY ACCESS_TOKEN
```

CLI syntax and build guidance are checked against the course tooling and the
[Azure Function App CLI reference](https://learn.microsoft.com/en-us/cli/azure/functionapp?view=azure-cli-latest)
and [TypeScript deployment guidance](https://learn.microsoft.com/en-us/azure/azure-functions/typescript-build-options).
Cloud success, denied-key behaviour and Auth0 transitions still require the
live rehearsal described above; a local build or dry-run is not that evidence.
