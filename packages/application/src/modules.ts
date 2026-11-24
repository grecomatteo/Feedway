import { accountsModule } from './accounts/module.js'
import { auditModule } from './audit/module.js'
import { identityModule } from './identity/module.js'
import { mediaModule } from './media/module.js'
import { notificationsModule } from './notifications/module.js'
import type {
  CalendarEntrySource,
  DigestSection,
  ModuleDefinition,
  NotificationKind,
  UserAnonymizedHandler,
} from './module-definition.js'
import { isModuleEnabled, type OutboxEventType } from '@app/domain'
import { organizationsModule } from './organizations/module.js'
import { planModule } from './plan/module.js'
import { platformModule } from './platform/module.js'
import { postsModule } from './posts/module.js'
import { rulesModule } from './rules/module.js'
import { workspacesModule } from './workspaces/module.js'

/** Every module of the application: the only central list (docs/moduli.md). */
export const MODULES: readonly ModuleDefinition[] = [
  platformModule,
  identityModule,
  organizationsModule,
  workspacesModule,
  accountsModule,
  mediaModule,
  rulesModule,
  postsModule,
  planModule,
  notificationsModule,
  auditModule,
]

/**
 * The modules' anonymization handlers, in the order of `MODULES`. Each composition root (panel,
 * worker, CLI) passes this list to `anonymizeUser`, so no entry point forgets a module.
 */
export function userAnonymizedHandlers(): readonly UserAnonymizedHandler[] {
  return MODULES.flatMap((m) => (m.onUserAnonymized ? [m.onUserAnonymized] : []))
}

/** Every kind of notification the modules register, by its event type (§7.3). */
export function notificationKinds(): ReadonlyMap<OutboxEventType, NotificationKind> {
  return new Map(MODULES.flatMap((m) => m.notificationKinds ?? []).map((k) => [k.type, k]))
}

/** Every section of the morning digest, in their order (§12.4, §7.3). */
export function digestSections(): readonly DigestSection[] {
  return MODULES.flatMap((m) => m.digestSections ?? []).sort((a, b) => a.order - b.order)
}

/**
 * The modules the agency uses, from its settings (§7.3, plan 09 P2): a module that can be
 * turned off is on until `organizations.settings.modules` says `false`.
 */
export function enabledModules(
  settings: Record<string, unknown>,
  modules: readonly ModuleDefinition[] = MODULES,
): readonly ModuleDefinition[] {
  return modules.filter((m) => isModuleEnabled(settings, m.name))
}

/** Where the calendar reads the modules' entries (plan 09 P1), of the modules given. */
export function calendarEntrySources(
  modules: readonly ModuleDefinition[],
): readonly CalendarEntrySource[] {
  return modules.flatMap((m) => (m.calendarEntries ? [m.calendarEntries] : []))
}
