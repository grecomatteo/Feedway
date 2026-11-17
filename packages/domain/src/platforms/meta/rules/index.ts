import type { PlatformRules } from '../../../rules/types.js'
import { FACEBOOK_RULES } from './facebook.js'
import { INSTAGRAM_RULES } from './instagram.js'

/** Meta's two platforms; the composition root makes `platformRulesMap(META_RULES)` of them. */
export const META_RULES: readonly PlatformRules[] = [INSTAGRAM_RULES, FACEBOOK_RULES]

export { INSTAGRAM_RULES, FACEBOOK_RULES }
export { META_LIMITS, type MetaLimit, type MetaLimitName } from './limits.js'
export {
  CONTENT_TYPES,
  FACEBOOK_FORMATS,
  INSTAGRAM_FORMATS,
  type FacebookFormat,
  type InstagramFormat,
} from './content-types.js'
