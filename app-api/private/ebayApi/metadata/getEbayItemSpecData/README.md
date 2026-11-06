# vtk_api_ebayApiMetadataGetEbayData

This AWS Lambda function provides read-only eBay marketplace and category metadata for listing UI workflows.

Most actions read cached metadata from DynamoDB. The category search action calls the eBay Taxonomy API to return live category suggestions.

---

## 📌 Function Overview

- **Function Name:** `vtk_api_ebayApiMetadataGetEbayData`

- **Role ARN:** `arn:aws:iam::832635066076:role/vtk_app_lambda`

- **Repository Path:** `aws-lambda/app-api/ebayApi/metadata/getEbayData`

- **Deployment:** See [Deploying Backend App API Functions](joplin://d478e66d393340c69a3e1086489f1408)

- **Security:** Exposed as API Gateway GET endpoint. Only `GET` is accepted.

- **Runtime**: Node.js 24.x

- **Memory**: 128 MB

- **Timeout**: 10 Seconds

---

## Function Actions

### 📅 sites

Returns active eBay marketplaces from table `vtk_ebay_site_details`.

Used to populate site/marketplace selectors.

**API Route**

`GET /ebayApi/metadata/sites`

**Request Parameters :**

None

**Response Example :**

```json
{
  "action": "sites",
  "count": 3,
  "sites": [
    {
      "site_id": "0",
      "site": "US",
      "marketplace_id": "EBAY_US",
      "marketplace_locale": "en-US",
      "marketplace_url": "https://www.ebay.com",
      "global_id": "EBAY-US",
      "category_tree_id": "0",
      "last_site_details_update": "2026-06-05T00:10:12Z"
    },
    {
      "site_id": "3",
      "site": "UK",
      "marketplace_id": "EBAY_GB",
      "marketplace_locale": "en-GB",
      "marketplace_url": "https://www.ebay.co.uk",
      "global_id": "EBAY-GB",
      "category_tree_id": "3",
      "last_site_details_update": "2026-06-05T00:10:12Z"
    },
    {
      "site_id": "15",
      "site": "Australia",
      "marketplace_id": "EBAY_AU",
      "marketplace_locale": "en-AU",
      "marketplace_url": "https://www.ebay.com.au",
      "global_id": "EBAY-AU",
      "category_tree_id": "15",
      "last_site_details_update": "2026-06-05T00:10:12Z"
    }
  ]
}
```

---

### 📅 root-categories

Returns top-level categories (`parent_id = 0`) for a site from the active category tree version.

Tree resolution:
1. Site record from `vtk_ebay_site_details`
2. Active tree version from `vtk_ebay_category_details`
3. Category rows from `vtk_ebay_categories`

**API Route**

`GET /ebayApi/metadata/root-categories`

**Request Parameters :**

```json
{
  "site_id": "3"
}
```

**Response Example :**

```json
{
  "action": "root-categories",
  "site_id": "3",
  "category_tree_id": "3",
  "active_tree_version": "127",
  "count": 3,
  "categories": [
    {
      "category_id": "15032",
      "parent_id": "0",
      "category_name": "Mobile Phones & Communication",
      "category_tree_node_level": 1,
      "leaf_category_tree_node": false,
      "category_tree_version": "127"
    },
    {
      "category_id": "293",
      "parent_id": "0",
      "category_name": "Consumer Electronics",
      "category_tree_node_level": 1,
      "leaf_category_tree_node": false,
      "category_tree_version": "127"
    },
    {
      "category_id": "9800",
      "parent_id": "0",
      "category_name": "Home, Furniture & DIY",
      "category_tree_node_level": 1,
      "leaf_category_tree_node": false,
      "category_tree_version": "127"
    }
  ]
}
```

---

### 📅 sub-categories

Returns child categories for a given parent category in a site's active tree version.

**API Route**

`GET /ebayApi/metadata/sub-categories`

**Request Parameters :**

```json
{
  "site_id": "3",
  "parent_id": "20081"
}
```

**Response Example :**

```json
{
  "action": "sub-categories",
  "site_id": "3",
  "parent_id": "20081",
  "category_tree_id": "3",
  "active_tree_version": "127",
  "count": 3,
  "categories": [
    {
      "category_id": "3312",
      "parent_id": "20081",
      "category_name": "Android Phones",
      "category_tree_node_level": 3,
      "leaf_category_tree_node": false,
      "category_tree_version": "127"
    },
    {
      "category_id": "9355",
      "parent_id": "20081",
      "category_name": "Apple Phones",
      "category_tree_node_level": 3,
      "leaf_category_tree_node": false,
      "category_tree_version": "127"
    },
    {
      "category_id": "178893",
      "parent_id": "20081",
      "category_name": "Other Mobile Phones",
      "category_tree_node_level": 3,
      "leaf_category_tree_node": true,
      "category_tree_version": "127"
    }
  ]
}
```

---

### 📅 category-search

Runs eBay Taxonomy category suggestions for a site and maps the response into the local category response shape.

The optional `limit` parameter defaults to 25 and is clamped to 1..100.

If no suggestions are returned by eBay, this action returns `404`.

**API Route**

`GET /ebayApi/metadata/category-search`

**Request Parameters :**

```json
{
  "site_id": "3",
  "q": "phone",
  "limit": "20"
}
```

**Response Example :**

```json
{
  "action": "category-search",
  "site_id": "3",
  "q": "phone",
  "category_tree_id": "3",
  "active_tree_version": "127",
  "count": 3,
  "scanned": 12,
  "categories": [
    {
      "category_id": "9355",
      "parent_id": "20081",
      "category_name": "Apple Phones",
      "category_tree_node_level": 3,
      "leaf_category_tree_node": null,
      "category_tree_version": "127"
    },
    {
      "category_id": "3312",
      "parent_id": "20081",
      "category_name": "Android Phones",
      "category_tree_node_level": 3,
      "leaf_category_tree_node": null,
      "category_tree_version": "127"
    },
    {
      "category_id": "15032",
      "parent_id": "0",
      "category_name": "Mobile Phones & Communication",
      "category_tree_node_level": 1,
      "leaf_category_tree_node": null,
      "category_tree_version": "127"
    }
  ]
}
```

---

### 📅 category-path

Builds the category breadcrumb path from the selected category up to the root, then returns it in root-to-leaf order.

**API Route**

`GET /ebayApi/metadata/category-path`

**Request Parameters :**

```json
{
  "site_id": "3",
  "category_id": "9355"
}
```

**Response Example :**

```json
{
  "action": "category-path",
  "site_id": "3",
  "category_id": "9355",
  "category_tree_id": "3",
  "active_tree_version": "127",
  "depth": 3,
  "path": [
    {
      "category_id": "15032",
      "parent_id": "0",
      "category_name": "Mobile Phones & Communication",
      "category_tree_node_level": 1,
      "leaf_category_tree_node": false,
      "category_tree_version": "127"
    },
    {
      "category_id": "20081",
      "parent_id": "15032",
      "category_name": "Mobile & Smart Phones",
      "category_tree_node_level": 2,
      "leaf_category_tree_node": false,
      "category_tree_version": "127"
    },
    {
      "category_id": "9355",
      "parent_id": "20081",
      "category_name": "Apple Phones",
      "category_tree_node_level": 3,
      "leaf_category_tree_node": false,
      "category_tree_version": "127"
    }
  ]
}
```

---

### 📅 category-detail

Returns one category node and metadata from the active category tree.

**API Route**

`GET /ebayApi/metadata/category-detail`

**Request Parameters :**

```json
{
  "site_id": "3",
  "category_id": "9355"
}
```

**Response Example :**

```json
{
  "action": "category-detail",
  "site_id": "3",
  "category_tree_id": "3",
  "active_tree_version": "127",
  "category": {
    "category_id": "9355",
    "parent_id": "20081",
    "category_name": "Apple Phones",
    "category_tree_node_level": 3,
    "leaf_category_tree_node": false,
    "category_tree_version": "127"
  }
}
```

---

### 📅 category-validation

Validates whether a category can be used for listing creation.

Validation is considered successful only when all are true:
- Category exists
- Category is a leaf node
- Category tree update status is `completed`

**API Route**

`GET /ebayApi/metadata/category-validation`

**Request Parameters :**

```json
{
  "site_id": "3",
  "category_id": "9355"
}
```

**Response Example :**

```json
{
  "action": "category-validation",
  "site_id": "3",
  "category_id": "9355",
  "category_tree_id": "3",
  "active_tree_version": "127",
  "result": {
    "is_valid_listing_category": false,
    "exists": true,
    "is_leaf": false,
    "category_update_status": "completed",
    "tree_ready": true
  }
}
```

---

### 📅 tree-metadata

Returns category tree metadata and status flags for a site.

Returned fields include:
- `active_tree_version`
- `ebay_tree_version`
- `category_update_status`
- `last_category_data_update`
- `last_category_data_check`
- `cleanup_pending`

**API Route**

`GET /ebayApi/metadata/tree-metadata`

**Request Parameters :**

```json
{
  "site_id": "3"
}
```

**Response Example :**

```json
{
  "action": "tree-metadata",
  "site_id": "3",
  "category_tree_id": "3",
  "active_tree_version": "127",
  "ebay_tree_version": "129",
  "category_update_status": "completed",
  "last_category_data_update": "2026-06-05T02:00:00Z",
  "last_category_data_check": "2026-06-05T05:00:00Z",
  "cleanup_pending": "false"
}
```

---

## Error Handling

**REST Error Behaviour**

- `405` for non-GET requests
- `400` for missing/invalid query parameters and unsupported actions
- `404` when site/category/tree data does not exist, or no category-search results are returned
- `409` when a site has no active category tree version

All errors return JSON in this structure:

```json
{
  "error": {
    "message": "...",
    "errors": {
      "debug": "..."
    }
  }
}
```

**CloudWatch Alarms**

No dedicated CloudWatch alarms are configured for this function in `functions_list.tfvars` (`create_alarms` is not enabled).

**CloudWatch Log Group**:
`/aws/lambda/vtk_api_ebayApiMetadataGetEbayData`

Retention:
14 Days

---

## Recovery

This is a read-only metadata function and has no in-function state transitions that require manual reset.

If responses fail due to category tree status issues (for example no `active_tree_version`, or update status not `completed`), recover by fixing category cache state via `vtk_core_ebayApiMetadataSetEbayData` actions (`scanCategories`, `updateCategoryTree`, `cleanCategoryTrees`).
