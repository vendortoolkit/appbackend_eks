import validator from 'validator'

export function validateUserProfile(data) {
  const errors = {}

  // Required string fields
  const requiredFields = [
    'first_name',
    'last_name',
    'address_line1',
    'address_city',
    'address_postalcode',
    'address_region',
    'country_iso'
  ]

  for (const field of requiredFields) {
    if (
      !data[field] ||
      typeof data[field] !== 'string' ||
      data[field].trim() === ''
    ) {
      errors[field] = `${field} is required`
    }
  }

  // Optional string fields with length checks
  const optionalFields = [
    'address_line2',
    'address_line3',
    'company',
    'marketing_preferences'
  ]

  for (const field of optionalFields) {
    if (data[field] !== undefined && typeof data[field] !== 'string') {
      errors[field] = `${field} must be text`
    }
  }

  // Email validation
  if (data.extra_email && !validator.isEmail(data.extra_email)) {
    errors.extra_email = 'extra_email must be a valid email address'
  }

  // Postal code format (basic check – customize by country if needed)
  if (
    data.address_postalcode &&
    !validator.isPostalCode(data.address_postalcode, 'any')
  ) {
    errors.address_postalcode = 'address_postalcode must be a valid postal code'
  }

  // Country code format
  if (data.country_iso && !/^[A-Z]{2}$/.test(data.country_iso)) {
    errors.country_iso =
      'country_iso must be a valid ISO 3166-1 alpha-2 code (e.g., GB, US)'
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors
  }
}