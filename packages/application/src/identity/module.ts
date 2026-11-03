import type { ModuleDefinition } from '../module-definition.js'

export type {
  AnonymizationSource,
  UserAnonymizedEvent,
  UserAnonymizedHandler,
} from '../module-definition.js'

export const identityModule: ModuleDefinition = {
  name: 'identity',
  permissions: ['users.manage'],
  queues: [
    'identity.security_email',
    'identity.password_reset_email',
    'identity.account_locked_notice',
    'identity.account_locked_notice_email',
    'identity.account_recovery_email',
    'identity.email_change',
    'identity.data_export',
    'identity.retention',
    'identity.anonymization_notice',
  ],
}
