import { auditModule } from './audit/module.js'
import { identityModule } from './identity/module.js'
import type { ModuleDefinition, UserAnonymizedHandler } from './module-definition.js'
import { organizationsModule } from './organizations/module.js'
import { platformModule } from './platform/module.js'
import { workspacesModule } from './workspaces/module.js'

/** Every module of the application: the only central list (docs/moduli.md). */
export const MODULES: readonly ModuleDefinition[] = [
  platformModule,
  identityModule,
  organizationsModule,
  workspacesModule,
  auditModule,
]

/**
 * The modules' anonymization handlers, in the order of `MODULES`. Each composition root (panel,
 * worker, CLI) passes this list to `anonymizeUser`, so no entry point forgets a module.
 */
export function userAnonymizedHandlers(): readonly UserAnonymizedHandler[] {
  return MODULES.flatMap((m) => (m.onUserAnonymized ? [m.onUserAnonymized] : []))
}
