import { SMTP_PORTS } from '@app/application'
import type { SmtpConfig } from '@app/application'
import { z } from 'zod'
import { normalizeHostName } from './destination.js'

// A plain address, nothing around it: no display name, no comments, no second recipient, no
// line break that could add a header.
const LOCAL = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/
const DOMAIN_LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/

/** Whether `value` is a single email address we may put in a header and in the envelope. */
export function isMailAddress(value: string): boolean {
  if (value.length > 254) return false
  const at = value.lastIndexOf('@')
  if (at < 1) return false
  const local = value.slice(0, at)
  const labels = value.slice(at + 1).split('.')
  return (
    local.length <= 64 &&
    LOCAL.test(local) &&
    labels.length >= 2 &&
    labels.every((l) => DOMAIN_LABEL.test(l))
  )
}

const smtpConfigSchema = z
  .object({
    host: z.string().refine((v) => normalizeHostName(v) === v),
    port: z.union(SMTP_PORTS.map((p) => z.literal(p))),
    security: z.enum(['tls', 'starttls']),
    username: z
      .string()
      .min(1)
      .max(254)
      .refine((v) => !/[\u0000-\u001f\u007f]/.test(v)),
    from: z.string().refine(isMailAddress),
  })
  .strict()
  // 465 speaks TLS from the first byte; 587 upgrades with STARTTLS (2525 does either)
  .refine((c) =>
    c.port === 465 ? c.security === 'tls' : c.port === 2525 || c.security === 'starttls',
  )

/** The SMTP settings, or null when they are not usable as they are. */
export function parseSmtpConfig(value: unknown): SmtpConfig | null {
  const parsed = smtpConfigSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}
