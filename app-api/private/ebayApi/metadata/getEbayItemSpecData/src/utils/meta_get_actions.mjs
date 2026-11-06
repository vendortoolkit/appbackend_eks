import {
  mapCategoryItem,
  mapEbaySuggestionToCategoryItem,
  parseLeafFlag,
} from './helpers.mjs'

import { DDB_TABLES } from '/opt/nodejs/core_module/index.mjs'

export async function getSites({ dynamo }) {
  const params = {
    TableName: DDB_TABLES.EBAY.EBAY_SITE_DETAILS.NAME,
    IndexName: DDB_TABLES.EBAY.EBAY_SITE_DETAILS.GSI.ACTIVE_SITE,
    KeyConditionExpression: 'active_site = :active',
    ExpressionAttributeValues: {
      ':active': 'true',
    },
  }

  const data = await dynamo.query(params)
  const items = data?.Items || []

  const sites = items
    .map((item) => ({
      site_id: String(item?.site_id),
      site: item?.site || '',
      marketplace_id: item?.data_MarketplaceDetails?.marketplace_id || null,
      marketplace_locale: item?.data_MarketplaceDetails?.marketplace_locale || null,
      marketplace_url: item?.data_MarketplaceDetails?.marketplace_url || null,
      global_id: item?.data_MarketplaceDetails?.global_id || null,
      category_tree_id: item?.data_MarketplaceDetails?.category_tree_id || null,
      last_site_details_update: item?.last_site_details_update || null,
    }))
    .sort((a, b) => a.site_id.localeCompare(b.site_id, undefined, { numeric: true }))

  return {
    action: 'sites',
    count: sites.length,
    sites,
  }
}

export async function getRootCategories({ siteId, dynamo }) {
  const treeMeta = await resolveActiveTreeForSite({ siteId, dynamo })
  const categories = await getChildrenByParent({
    categoryTreeId: treeMeta.category_tree_id,
    activeTreeVersion: treeMeta.active_tree_version,
    parentId: '0',
    dynamo,
  })

  return {
    action: 'root-categories',
    site_id: String(siteId),
    category_tree_id: treeMeta.category_tree_id,
    active_tree_version: treeMeta.active_tree_version,
    count: categories.length,
    categories,
  }
}

export async function getSubCategories({ siteId, parentId, dynamo }) {
  const treeMeta = await resolveActiveTreeForSite({ siteId, dynamo })
  const categories = await getChildrenByParent({
    categoryTreeId: treeMeta.category_tree_id,
    activeTreeVersion: treeMeta.active_tree_version,
    parentId: String(parentId),
    dynamo,
  })

  return {
    action: 'sub-categories',
    site_id: String(siteId),
    parent_id: String(parentId),
    category_tree_id: treeMeta.category_tree_id,
    active_tree_version: treeMeta.active_tree_version,
    count: categories.length,
    categories,
  }
}

export async function searchCategories({ siteId, searchTerm, limit, ebayAPI, dynamo }) {
  const treeMeta = await resolveActiveTreeForSite({ siteId, dynamo })

  const query = String(searchTerm || '').trim()
  if (query === '') {
    throw {
      message: 'Invalid search query',
      errors: { debug: 'Query parameter "q" must not be empty' },
      restStatus: 400,
    }
  }

  const categorySearchResults = await ebayAPI.commerce.taxonomy.getCategorySuggestions(
    treeMeta.category_tree_id,
    query,
  )
  const suggestions = categorySearchResults?.categorySuggestions || []
  if (suggestions.length === 0) {
    throw {
      message: 'No category results found',
      errors: { debug: `No eBay category suggestions found for q "${query}"` },
      restStatus: 404,
    }
  }

  const maxResults = Math.min(Math.max(Number(limit) || 25, 1), 100)
  const categories = suggestions
    .map((suggestion) => mapEbaySuggestionToCategoryItem({
      suggestion,
      activeTreeVersion: treeMeta.active_tree_version,
    }))
    .sort((a, b) => a.category_name.localeCompare(b.category_name))
    .slice(0, maxResults)

  return {
    action: 'category-search',
    site_id: String(siteId),
    q: query,
    category_tree_id: treeMeta.category_tree_id,
    active_tree_version: treeMeta.active_tree_version,
    count: categories.length,
    scanned: suggestions.length,
    categories,
  }
}

export async function getCategoryPath({ siteId, categoryId, dynamo }) {
  const treeMeta = await resolveActiveTreeForSite({ siteId, dynamo })
  const startNode = await getCategoryById({
    categoryTreeId: treeMeta.category_tree_id,
    activeTreeVersion: treeMeta.active_tree_version,
    categoryId,
    dynamo,
  })

  if (!startNode) {
    throw {
      message: 'Category not found',
      errors: { debug: `No category found for category_id "${categoryId}"` },
      restStatus: 404,
    }
  }

  const path = [mapCategoryItem(startNode)]
  let nextParent = startNode.parent_id
  const guard = 30

  for (let i = 0; i < guard; i++) {
    if (!nextParent || nextParent === 'null') {
      break
    }

    const parentNode = await getCategoryById({
      categoryTreeId: treeMeta.category_tree_id,
      activeTreeVersion: treeMeta.active_tree_version,
      categoryId: nextParent,
      dynamo,
    })

    if (!parentNode) {
      break
    }

    path.push(mapCategoryItem(parentNode))
    nextParent = parentNode.parent_id
  }

  path.reverse()

  return {
    action: 'category-path',
    site_id: String(siteId),
    category_id: String(categoryId),
    category_tree_id: treeMeta.category_tree_id,
    active_tree_version: treeMeta.active_tree_version,
    depth: path.length,
    path,
  }
}

export async function getCategoryDetail({ siteId, categoryId, dynamo }) {
  const treeMeta = await resolveActiveTreeForSite({ siteId, dynamo })
  const category = await getCategoryById({
    categoryTreeId: treeMeta.category_tree_id,
    activeTreeVersion: treeMeta.active_tree_version,
    categoryId,
    dynamo,
  })

  if (!category) {
    throw {
      message: 'Category not found',
      errors: { debug: `No category found for category_id "${categoryId}"` },
      restStatus: 404,
    }
  }

  return {
    action: 'category-detail',
    site_id: String(siteId),
    category_tree_id: treeMeta.category_tree_id,
    active_tree_version: treeMeta.active_tree_version,
    category: mapCategoryItem(category),
  }
}

export async function validateCategory({ siteId, categoryId, dynamo }) {
  const treeMeta = await resolveActiveTreeForSite({ siteId, dynamo })
  const category = await getCategoryById({
    categoryTreeId: treeMeta.category_tree_id,
    activeTreeVersion: treeMeta.active_tree_version,
    categoryId,
    dynamo,
  })

  const exists = !!category
  const isLeaf = exists && parseLeafFlag(category.leaf_category_tree_node)
  const isTreeReady = treeMeta.category_update_status === 'completed'
  const isValidListingCategory = exists && isLeaf && isTreeReady

  return {
    action: 'category-validation',
    site_id: String(siteId),
    category_id: String(categoryId),
    category_tree_id: treeMeta.category_tree_id,
    active_tree_version: treeMeta.active_tree_version,
    result: {
      is_valid_listing_category: isValidListingCategory,
      exists,
      is_leaf: isLeaf,
      category_update_status: treeMeta.category_update_status,
      tree_ready: isTreeReady,
    },
  }
}

export async function getTreeMetadata({ siteId, dynamo }) {
  const treeMeta = await resolveActiveTreeForSite({ siteId, dynamo })

  return {
    action: 'tree-metadata',
    site_id: String(siteId),
    category_tree_id: treeMeta.category_tree_id,
    active_tree_version: treeMeta.active_tree_version,
    ebay_tree_version: treeMeta.ebay_tree_version,
    category_update_status: treeMeta.category_update_status,
    last_category_data_update: treeMeta.last_category_data_update || null,
    last_category_data_check: treeMeta.last_category_data_check || null,
    cleanup_pending: treeMeta.cleanup_pending || 'false',
  }
}

async function resolveActiveTreeForSite({ siteId, dynamo }) {
  const siteData = await getSiteRecordById({ siteId, dynamo })
  const categoryTreeId = siteData?.data_MarketplaceDetails?.category_tree_id

  if (!categoryTreeId) {
    throw {
      message: 'No category tree is mapped to this site',
      errors: { debug: `Missing data_MarketplaceDetails.category_tree_id for site_id "${siteId}"` },
      restStatus: 404,
    }
  }

  const categoryDetailsParams = {
    TableName: DDB_TABLES.EBAY.EBAY_CATEGORY_DETAILS.NAME,
    Key: { category_tree_id: categoryTreeId },
  }
  const categoryDetails = await dynamo.get(categoryDetailsParams)
  const detail = categoryDetails?.Item || null

  if (!detail) {
    throw {
      message: 'Category tree metadata not found',
      errors: { debug: `No record in ${DDB_TABLES.EBAY.EBAY_CATEGORY_DETAILS.NAME} for category_tree_id "${categoryTreeId}"` },
      restStatus: 404,
    }
  }

  if (!detail?.active_tree_version) {
    throw {
      message: 'Active tree version is not set for this site',
      errors: { debug: `category_tree_id "${categoryTreeId}" has no active_tree_version` },
      restStatus: 409,
    }
  }

  return {
    site_id: String(siteId),
    category_tree_id: String(categoryTreeId),
    active_tree_version: String(detail.active_tree_version),
    ebay_tree_version: detail.ebay_tree_version || null,
    category_update_status: detail.category_update_status || null,
    last_category_data_update: detail.last_category_data_update || null,
    last_category_data_check: detail.last_category_data_check || null,
    cleanup_pending: detail.cleanup_pending || 'false',
  }
}

async function getSiteRecordById({ siteId, dynamo }) {
  const siteNum = Number(siteId)
  if (Number.isNaN(siteNum)) {
    throw {
      message: 'Invalid site_id',
      errors: { debug: `site_id "${siteId}" is not a number` },
      restStatus: 400,
    }
  }

  const params = {
    TableName: DDB_TABLES.EBAY.EBAY_SITE_DETAILS.NAME,
    Key: { site_id: siteNum },
  }
  const data = await dynamo.get(params)
  if (data?.Item) {
    return data.Item
  }

  throw {
    message: 'Site not found',
    errors: { debug: `No site record found for site_id "${siteId}"` },
    restStatus: 404,
  }
}

async function getChildrenByParent({ categoryTreeId, activeTreeVersion, parentId, dynamo }) {
  const params = {
    TableName: DDB_TABLES.EBAY.EBAY_CATEGORIES.NAME,
    IndexName: DDB_TABLES.EBAY.EBAY_CATEGORIES.GSI.PARENT_ID,
    KeyConditionExpression: 'category_tree_id = :category_tree_id AND category_tree_version = :category_tree_version AND parent_id = :parent_id',
    ExpressionAttributeValues: {
      ':parent_id': String(parentId),
      ':category_tree_id': String(categoryTreeId),
      ':category_tree_version': String(activeTreeVersion),
    },
  }

  const data = await dynamo.query(params)
  const items = data?.Items || []
  return items
    .map(mapCategoryItem)
    .sort((a, b) => a.category_name.localeCompare(b.category_name))
}

async function getCategoryById({ categoryTreeId, activeTreeVersion, categoryId, dynamo }) {
  const key = {
    category_tree_id: String(categoryTreeId),
    'category_tree_version#category_id': String(activeTreeVersion) + '#' + String(categoryId),
  }
  const params = {
    TableName: DDB_TABLES.EBAY.EBAY_CATEGORIES.NAME,
    Key: key,
  }
  const data = await dynamo.get(params)
  return data?.Item || null
}
