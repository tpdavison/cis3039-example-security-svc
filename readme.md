# Secure Backend Service Example

## Project

This project provides Azure Functions for managing products.

### Available Endpoints

- `GET /api/products` - List all products (supports OAuth2 token with optional `read:products` scope)
- `POST /api/products` - Upsert (create or update) a product
- `PUT /api/products` - Upsert (create or update) a product

### OAuth2 Token Validation and Price Redaction

The `GET /api/products` endpoint supports optional OAuth2 access token validation using the `jose` library.

- **Without a valid token**: Products are returned with `pricePence` set to `null` (prices are redacted).
- **With a valid token but missing `read:products` scope**: Products are returned with `pricePence` set to `null`.
- **With a valid token and `read:products` scope**: Products are returned with actual prices.

OAuth2 token validation must be enabled via configuration (see below).

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Create your local settings file:

Copy the template to create your local development settings:

```bash
cp local.settings.template.json local.settings.json
```

> **Note:** Never commit your `local.settings.json` to source control. The template is safe to share.

3. Build the project:

```bash
npm run build
```

## Local testing with curl

### Start the Function App

```bash
npm start
```

The function app will start on `http://localhost:7071`.

### List Products

Split the VS Code terminal so you can see the output from the localling running app whilst having a new shell prompt to make a test HTTP call:

```bash
curl -i http://localhost:7071/api/products
```

The fake repo initialises empty, so expect an empty array of products.

### Upsert a Product

Using the sample data file (and a new bash terminal):

```bash
curl -i -X POST http://localhost:7071/api/products \
  -H "Content-Type: application/json" \
  -d @samples/product-post.json
```

Repeating the list products call should now show the new item.

## Azure Setup

### Sign into Azure CLI

Prepare for using the az CLI commands.

1. Ensure you are signed in:

```bash
az login
az account show
```

You should see your account properties displayed if you are successfully signed in.

2. Ensure you know which locations (e.g. uksouth) you are permitted to use:

```bash
az policy assignment list \
  --query "[?name.contains(@, 'sys.regionrestriction')].parameters.listOfAllowedLocations.value | []" \
  -o tsv
```

### Create a Resource Group and Azure Function App

1. Create a resource group (if you do not already have one for this deployment):

```bash
az group create \
  --name <your-resource-group> \
  --location <permitted-location>
```

Remember to follow our naming convention, e.g. shopping-lab-ab47-rg

2. Create a storage account (required for Azure Functions):

```bash
az storage account create \
  --name <yourfuncstorageaccount> \
  --location <permitted-location> \
  --resource-group <your-resource-group> \
  --sku Standard_LRS
```

3. Create the Function App:

```bash
az functionapp create \
  --name <your-function-app> \
  --resource-group <your-resource-group> \
  --storage-account <yourfuncstorageaccount> \
  --consumption-plan-location <permitted-location> \
  --runtime node \
  --functions-version 4
```

### Publish the Project to Azure

Deploy your code to the Function App:

```bash
func azure functionapp publish <your-function-app>
```

You can now access your endpoints at:

```
https://<your-function-app>.azurewebsites.net/api/products
```

If needed, allow cross-domain calls from your app domain and/or localhost, for example:

```bash
az functionapp cors add \
  --name <your-function-app> \
  --resource-group <your-resource-group> \
  --allowed-origins http://localhost:5173
```

### Read the host auth key

```bash
az functionapp keys list \
  --name <your-function-app> \
  --resource-group <your-resource-group> \
  --query masterKey \
  --output tsv
```

This key will need to be shared with any backend service that needs to call `upsertProduct`. Calls to `upsertProduct` must include the key in the `x-functions-key` HTTP header. It is also possible to acquire a key that just works for `upsertProduct` (rather than for the whole service).

## Product Updated Notifications

This service emits a "product updated" integration event after a successful upsert.

- Default behaviour: uses a dummy adapter that logs the event to the console.
- HTTP adapter: enabled when the environment variable `PRODUCT_UPDATED_BASE_URL` is set.

When enabled, the service will POST to:

- `POST ${PRODUCT_UPDATED_BASE_URL}/integration/events/product-updated`

with a JSON body shaped as:

```
{
  "id": "string",
  "name": "string",
  "pricePence": 1234,
  "description": "string",
  "updatedAt": "2025-01-01T12:34:56.000Z" // ISO string
}
```

### Configure locally

Update `local.settings.json` (created from the template) to include the base URL of your receiver. If your receiver is an Azure Function protected by a host key, also include the key. The adapter uses the `x-functions-key` header automatically.

```
{
  "IsEncrypted": false,
  "Values": {
    "FUNCTIONS_WORKER_RUNTIME": "node",
    "PRODUCT_UPDATED_BASE_URL": "https://your-receiver.azurewebsites.net",
    "PRODUCT_UPDATED_KEY": "<your-host-key>"
  }
}
```

Remove `PRODUCT_UPDATED_BASE_URL` (or leave it empty) to fall back to the dummy logger.

### Configure in Azure

Set the application setting `PRODUCT_UPDATED_BASE_URL` on your Function App to the receiver's base URL. If your receiver requires a host key, also set `PRODUCT_UPDATED_KEY`. The app will automatically switch to the HTTP adapter at startup.

You can set this via Azure CLI:

```bash
az functionapp config appsettings set \
  --name <your-function-app> \
  --resource-group <your-resource-group> \
  --settings \
    PRODUCT_UPDATED_BASE_URL=https://your-receiver.azurewebsites.net \
    PRODUCT_UPDATED_KEY=<your-host-key>
```

If needed, restart the Function App to pick up changes immediately:

```bash
az functionapp restart \
  --name <your-function-app> \
  --resource-group <your-resource-group>
```

## Auth0 Setup

### 1. Create an Auth0 Tenancy (if you don't have one already)

Visit [auth0.com](https://auth0.com/) and sign-up. Create and name your first tenancy following our usual naming conventions, for example `shopping-dev-ab47`.

### 2. Sign-in to Auth0 CLI

In the VSCode terminal:

```bash
auth0 login
```

Confirm your Auth0 domain (e.g. shopping-dev-ab47.uk.auth0.com):

```bash
auth0 tenants list
```

Keep a note of your domain as you will need it later.

### 3. Register an API (resource server)

Call you api registration something like `products-dev-api`. Use something like `https://products.shopping.thamco.com` for the identifier (it looks like a domain name but doesn't need to actually exist).

```bash
auth0 apis create \
 --name <your-api-name> \
 --identifier <your-api-identifier> \
 --scopes "read:products" \
 --no-input \
 --json
```

> The `identifier` will become the audience (`aud`) for the access tokens your app acquires to access your backend service.

The `scopes` above are examples and can be changed to match your needs.

Since you are the frontend app and backend api author, you can skip requesting user consent to use the API: In the Auth0 web dashboard: APIs → your API → Settings → Access Settings → “Allow Skipping User Consent”.

To use role based access control with your api it will need enabling in the Auth0 web dashboard: APIs → your API → Settings → RBAC Settings → “Enable RBAC” and “Add Permissions in the Access Token”.

### 4. Give users permission to use the API

A role can include one or more API permissions (scopes).

> You must have enabled RBAC on your API (above) for these steps to work.

Create a role (if you don’t have one):

```bash
auth0 roles create \
  --name "ProductReader" \
  --description "Can read products including prices"
```

Assign API scopes (permissions) to the role (if you've just created one):

```bash
auth0 roles permissions add <ROLE_ID> \
  --api-id <API_ID> \
  --permissions "read:products"
```

Again, the permissions above are examples to be tailored for your needs.

Create a test user (if you don't already have one):

```bash
auth0 users create \
  --connection-name "Username-Password-Authentication" \
  --email "testuser1@example.com" \
  --password "P@ssw0rd!" \
  --no-input
```

Note the user id as you'll need it below.

Assign the role to a user:

```bash
auth0 users roles add "<USER_ID>" --roles <ROLE_ID>
```

Now that user has all permissions associated with the role — and when they log in, Auth0 includes those permissions in their access token if you’ve enabled “Add Permissions in the Access Token” for that API.

## OAuth2 Access Tokens

> You must have an auth server (see Auth0 setup above).

To enable OAuth2 validation, set the following environment variables:

- `OAUTH2_JWKS_URI`: The JWKS endpoint URL for your OAuth2 provider (e.g., `https://your-tenant.auth0.com/.well-known/jwks.json`)
- `OAUTH2_ISSUER`: The expected token issuer (e.g., `https://your-tenant.auth0.com/`)
- `OAUTH2_AUDIENCE`: The expected audience/API identifier (e.g., `https://products.shopping.thamco.com`)

If these variables are not set, the endpoint still works but treats all requests as unauthenticated (prices will be redacted).

### Local Configuration

Update `local.settings.json`:

```json
{
  "IsEncrypted": false,
  "Values": {
    "FUNCTIONS_WORKER_RUNTIME": "node",
    "OAUTH2_JWKS_URI": "https://your-tenant.auth0.com/.well-known/jwks.json",
    "OAUTH2_ISSUER": "https://your-tenant.auth0.com/",
    "OAUTH2_AUDIENCE": "https://products.shopping.thamco.com"
  }
}
```

### Azure Configuration

Set the OAuth2 configuration via Azure CLI:

```bash
az functionapp config appsettings set \
  --name <your-function-app> \
  --resource-group <your-resource-group> \
  --settings \
    OAUTH2_JWKS_URI=https://your-tenant.auth0.com/.well-known/jwks.json \
    OAUTH2_ISSUER=https://your-tenant.auth0.com/ \
    OAUTH2_AUDIENCE=https://products.shopping.thamco.com
```

### Testing with a Token

To test with an OAuth2 access token, include it in the `Authorization` header:

```bash
curl -i http://localhost:7071/api/products \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

The token must:

- Be signed by the configured issuer
- Have the configured audience
- Be valid (not expired)
- Include the `read:products` scope (either in the `scope` or `scp` claim) to see actual prices

Tokens can be obtained using Postman, but it will probably be easier to test via the products app.
