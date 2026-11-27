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
  deliverGroup,
  deliverNotification,
  type DeliverDeps,
  type DeliverJob,
  type DeliverReport,
} from './deliver.js'
export {
  deliverPlatformNotification,
  dispatchNotifications,
  notificationsOf,
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
  createTelegramPollHealth,
  type TelegramPollHealth,
  type TelegramPollHealthOptions,
} from './telegram-poll-health.js'
export {
  CENTRE_PAGE_DEFAULT,
  CENTRE_PAGE_MAX,
  countMyUnreadNotifications,
  decodeCursor,
  encodeCursor,
  listMyNotifications,
  markAllMyNotificationsRead,
  markMyNotificationRead,
  panelPath,
  type CentreDeps,
  type CentreItem,
  type CentrePage,
  type CentreQuery,
} from './centre.js'
export {
  getMyNotificationPreferences,
  saveMyNotificationSettings,
  setMyNotificationKind,
  type KindPreference,
  type MyNotificationPreferences,
  type PreferencesDeps,
} from './preferences.js'
export {
  DIGEST_LOCK,
  startDigests,
  type DigestStartDeps,
  type DigestStartReport,
} from './digest-start.js'
export { sendDigest, type DigestDeps, type DigestJob, type DigestReport } from './digest.js'
