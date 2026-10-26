import type { Translate } from '../ports/translator.js'
import type { EmailContent } from './render-email.js'

export { renderEmail, oneLine, type EmailBlock, type EmailContent } from './render-email.js'
export { capitalize, dayAndTime, isSameDay, timeOfDay, usableTimeZone } from './email-dates.js'

/** Served from apps/web/public, without a session: mail clients fetch it anonymously. */
export const EMAIL_LOGO_PATH = '/email/feedway-logo@2x.png'

/** What every email shares: the product, the logo on this installation, the common texts. */
export function emailFrame(
  translate: Translate,
  panelUrl: URL | string,
  productName: string,
): Pick<EmailContent, 'productName' | 'logoUrl' | 'chrome'> {
  return {
    productName,
    logoUrl: new URL(EMAIL_LOGO_PATH, panelUrl).toString(),
    chrome: {
      buttonFallback: translate('email.layout.buttonFallback'),
      serviceNotice: translate('email.layout.serviceNotice'),
    },
  }
}
