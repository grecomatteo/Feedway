/**
 * A page of the Business Manager settings for the guides. With the agency's business id it opens
 * that business directly; without it Meta asks which one. Only digits pass, as Meta ids are.
 */
export function metaBusinessUrl(page: string, businessId: string | null): string {
  const base = `https://business.facebook.com/settings/${page}`
  return businessId !== null && /^\d{1,64}$/.test(businessId)
    ? `${base}?business_id=${businessId}`
    : base
}
