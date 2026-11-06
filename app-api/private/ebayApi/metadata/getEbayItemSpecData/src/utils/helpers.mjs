export function getActionFromEvent(event) {
  const rawPath = String(event?.path || '').trim()
  const pathParts = rawPath.split('/').filter(Boolean)
  if (pathParts.length > 0) {
    return pathParts[pathParts.length - 1].trim().toLowerCase()
  }

  throw {
    message: 'Missing action path parameter',
    errors: { debug: 'Expected path parameter "action"' },
    restStatus: 400,
  }
}

export function ensureRequiredQueryParam({ value, fieldName }) {
  if (value === undefined || value === null || String(value).trim() === '') {
    throw {
      message: `Missing required query parameter "${fieldName}"`,
      errors: { debug: `Provide "${fieldName}" in the query string` },
      restStatus: 400,
    }
  }
}

export function getRequiredQueryParams({ qs, fields }) {
  const result = {}
  for (const fieldName of fields) {
    const value = qs?.[fieldName]
    ensureRequiredQueryParam({ value, fieldName })
    result[fieldName] = value
  }
  return result
}

export function parseLeafFlag(value) {
  if (value === true || value === 'true') {
    return true
  }
  return false
}

export function mapEbaySuggestionToCategoryItem({ suggestion, activeTreeVersion }) {
  const ancestors = Array.isArray(suggestion?.categoryTreeNodeAncestors)
    ? suggestion.categoryTreeNodeAncestors
    : []
  const parentId = ancestors.length > 0
    ? ancestors[0]?.categoryId
    : '0'

  return {
    category_id: String(suggestion?.category?.categoryId || ''),
    parent_id: parentId != null ? String(parentId) : null,
    category_name: suggestion?.category?.categoryName || '',
    category_tree_node_level: Number(suggestion?.categoryTreeNodeLevel || 0),
    leaf_category_tree_node: null,
    category_tree_version: activeTreeVersion ? String(activeTreeVersion) : null,
  }
}

export function mapCategoryItem(item) {
  return {
    category_id: String(item?.category_id),
    parent_id: item?.parent_id != null ? String(item.parent_id) : null,
    category_name: item?.category_name || '',
    category_tree_node_level: Number(item?.category_tree_node_level || 0),
    leaf_category_tree_node: parseLeafFlag(item?.leaf_category_tree_node),
    category_tree_version: item?.category_tree_version ? String(item.category_tree_version) : null,
  }
}