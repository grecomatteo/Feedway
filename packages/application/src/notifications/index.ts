// The notifications module (plan 08): what the other modules and the composition roots use.
export {
  asString,
  contextLine,
  groupedMessage,
  kindKey,
  panelLink,
  placeOf,
  platformName,
  type AgencyPlace,
  type MessageContext,
  type NotifiedEvent,
} from './message.js'
export {
  deliverNotification,
  type DeliverDeps,
  type DeliverJob,
  type DeliverReport,
} from './deliver.js'
export {
  deliverPlatformNotification,
  dispatchNotifications,
  type DispatchDeps,
  type DispatchReport,
} from './dispatch.js'
export { createEmailChannel, notificationEmail } from './email-channel.js'
export {
  getAgencyTelegramBot,
  removeAgencyTelegramBot,
  replaceAgencyTelegramBot,
  type AgencyTelegramBotDeps,
} from './telegram-bot.js'
export { telegramBotView, verifyBotToken, type TelegramBotView } from './telegram-token.js'
export {
  LINK_CODE_MINUTES,
  listTelegramLinks,
  startTelegramLink,
  unlinkTelegram,
  type TelegramBotKey,
  type TelegramBotLink,
  type TelegramLinkDeps,
} from './telegram-links.js'
export {
  createTelegramChannel,
  telegramText,
  type TelegramChannelDeps,
  type TelegramTargets,
} from './telegram-channel.js'
export { answerTelegramQuery, type TelegramCommandDeps } from './telegram-commands.js'
export {
  TELEGRAM_TEXT_MAX,
  escapeHtml,
  fitMessage,
  type TelegramHtml,
  type TelegramSection,
} from './telegram-format.js'
export {
  createTelegramTargets,
  parseCommand,
  pollTelegram,
  type TelegramPollDeps,
  type TelegramPollReport,
} from './telegram-poll.js'
export {
  DIGEST_LOCK,
  startDigests,
  type DigestStartDeps,
  type DigestStartReport,
} from './digest-start.js'
export { sendDigest, type DigestDeps, type DigestJob, type DigestReport } from './digest.js'
