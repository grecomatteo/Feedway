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
