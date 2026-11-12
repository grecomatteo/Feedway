import { EMAIL_LOGO_CID } from '../ports/mailer.js'
import type { Translate } from '../ports/translator.js'
import type { EmailContent } from './render-email.js'

export { renderEmail, oneLine, type EmailBlock, type EmailContent } from './render-email.js'
export {
  calendarDay,
  capitalize,
  dayAndTime,
  isSameDay,
  timeOfDay,
  usableTimeZone,
} from './email-dates.js'

/** What every email shares: the product, the logo, the common texts. */
export function emailFrame(
  translate: Translate,
  productName: string,
): Pick<EmailContent, 'productName' | 'logoUrl' | 'chrome'> {
  return {
    productName,
    logoUrl: `cid:${EMAIL_LOGO_CID}`,
    chrome: {
      buttonFallback: translate('email.layout.buttonFallback'),
      serviceNotice: translate('email.layout.serviceNotice'),
    },
  }
}
