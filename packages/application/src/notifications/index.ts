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
  DIGEST_LOCK,
  startDigests,
  type DigestStartDeps,
  type DigestStartReport,
} from './digest-start.js'
export { sendDigest, type DigestDeps, type DigestJob, type DigestReport } from './digest.js'
