/**
 * Texts from `apps/web/i18n/locales/it.json`. `{name}` placeholders are replaced with the
 * values given; a missing key throws, so a typo never sends an empty email.
 */
export type Translate = (key: string, values?: Readonly<Record<string, string>>) => string
