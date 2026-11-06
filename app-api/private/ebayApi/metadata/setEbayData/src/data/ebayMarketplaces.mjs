// Static eBay marketplace reference data — not available via the Trading API.
// Keyed by site_id for O(1) lookup. Used to write data_MarketplaceDetails to
// vtk_ebay_site_details. Belgium and Canada are separate entries per site_id/locale.

export const EBAY_MARKETPLACE_BY_SITE_ID = {
  0:   { global_id: 'EBAY-US',    marketplace_id: 'EBAY_US',    marketplace_url: 'https://www.ebay.com',        marketplace_locale: 'en-US' },
  2:   { global_id: 'EBAY-ENCA',  marketplace_id: 'EBAY_CA',  marketplace_url: 'https://www.ebay.ca',         marketplace_locale: 'en-CA' },
  3:   { global_id: 'EBAY-GB',    marketplace_id: 'EBAY_GB',    marketplace_url: 'https://www.ebay.co.uk',      marketplace_locale: 'en-GB' },
  15:  { global_id: 'EBAY-AU',    marketplace_id: 'EBAY_AU',    marketplace_url: 'https://www.ebay.com.au',     marketplace_locale: 'en-AU' },
  16:  { global_id: 'EBAY-AT',    marketplace_id: 'EBAY_AT',    marketplace_url: 'https://www.ebay.at',         marketplace_locale: 'de-AT' },
  23:  { global_id: 'EBAY-FRBE',  marketplace_id: 'EBAY_BE',  marketplace_url: 'https://www.befr.ebay.be/',   marketplace_locale: 'fr-BE' },
  71:  { global_id: 'EBAY-FR',    marketplace_id: 'EBAY_FR',    marketplace_url: 'https://www.ebay.fr',         marketplace_locale: 'fr-FR' },
  77:  { global_id: 'EBAY-DE',    marketplace_id: 'EBAY_DE',    marketplace_url: 'https://www.ebay.de',         marketplace_locale: 'de-DE' },
  100: { global_id: 'EBAY-MOTOR', marketplace_id: 'EBAY_MOTORS_US', marketplace_url: 'https://www.ebay.com/motors',  marketplace_locale: 'en-US' },
  101: { global_id: 'EBAY-IT',    marketplace_id: 'EBAY_IT',    marketplace_url: 'https://www.ebay.it',         marketplace_locale: 'it-IT' },
  123: { global_id: 'EBAY-NLBE',  marketplace_id: 'EBAY_BE',  marketplace_url: 'https://www.benl.ebay.be/',   marketplace_locale: 'nl-BE' },
  146: { global_id: 'EBAY-NL',    marketplace_id: 'EBAY_NL',    marketplace_url: 'https://www.ebay.nl',         marketplace_locale: 'nl-NL' },
  186: { global_id: 'EBAY-ES',    marketplace_id: 'EBAY_ES',    marketplace_url: 'https://www.ebay.es',         marketplace_locale: 'es-ES' },
  193: { global_id: 'EBAY-CH',    marketplace_id: 'EBAY_CH',    marketplace_url: 'https://www.ebay.ch',         marketplace_locale: 'de-CH' },
  201: { global_id: 'EBAY-HK',    marketplace_id: 'EBAY_HK',    marketplace_url: 'https://www.ebay.com.hk',     marketplace_locale: 'zh-HK' },
  205: { global_id: 'EBAY-IE',    marketplace_id: 'EBAY_IE',    marketplace_url: 'https://www.ebay.ie',         marketplace_locale: 'en-IE' },
  207: { global_id: 'EBAY-MY',    marketplace_id: 'EBAY_MY',    marketplace_url: 'https://www.ebay.com.my',     marketplace_locale: 'en-US' },
  210: { global_id: 'EBAY-FRCA',  marketplace_id: 'EBAY_CA',  marketplace_url: 'https://www.cafr.ebay.ca/',   marketplace_locale: 'fr-CA' },
  211: { global_id: 'EBAY-PH',    marketplace_id: 'EBAY_PH',    marketplace_url: 'https://www.ebay.ph',         marketplace_locale: 'en-PH' },
  212: { global_id: 'EBAY-PL',    marketplace_id: 'EBAY_PL',    marketplace_url: 'https://www.ebay.pl',         marketplace_locale: 'pl-PL' },
  216: { global_id: 'EBAY-SG',    marketplace_id: 'EBAY_SG',    marketplace_url: 'https://www.ebay.com.sg',     marketplace_locale: 'en-US' },
}
