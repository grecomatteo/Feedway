import type { UserAnonymizedHandler } from '../module-definition.js'

/**
 * The notifications' part of an anonymization (§10.4, plan 08 Task 4): the person's Telegram
 * links, preferences, settings and notifications in every agency go. Their rows are in many
 * agencies and in the platform's, so the system scope removes them in one transaction. Running it
 * again finds nothing left and removes nothing.
 */
export const anonymizeNotifications: UserAnonymizedHandler = async ({ userId }, { uow }) => {
  await uow.runAsSystem('notifications: anonymize a person', async (tx) => {
    await tx.telegramLinks.deleteAllForUser(userId)
    await tx.notificationPrefs.deleteAllForUser(userId)
    await tx.notifications.deleteAllForUser(userId)
  })
}
