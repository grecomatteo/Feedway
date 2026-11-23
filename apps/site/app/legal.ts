/**
 * The facts the privacy notice depends on. Matteo fills them in; until then the pages show a visible
 * placeholder and `scripts/check-legal.mjs` stops the publication.
 */
export const LEGAL = {
  /** Who decides why and how the data is processed: a person's name or a company name. */
  controllerName: 'DA COMPLETARE',
  /** Tax number or address, if Matteo wants it shown. Empty: not shown. */
  controllerDetails: '',
  /** The address that receives privacy and deletion requests. */
  privacyEmail: 'DA COMPLETARE',
  /** Who runs the server of the panel and where, e.g. «Hetzner Online GmbH, Germania». */
  hostingProvider: 'DA COMPLETARE',
  /** Where the panel's backups go, e.g. «Google Drive (Google Ireland Ltd.)», copies encrypted or not. */
  backupProvider: 'DA COMPLETARE',
  /** Who sends the panel's emails (SMTP), e.g. «Brevo (Sendinblue SAS, Francia)». */
  emailProvider: 'DA COMPLETARE',
  /** Courts for disputes in the terms, with the preposition, e.g. «di Bologna». */
  court: 'DA COMPLETARE',
  /** Date of the last change of the notice, ISO. */
  updatedOn: '2026-11-23',
} as const

export const PLACEHOLDER = 'DA COMPLETARE'

export const SITE = {
  /** The panel's sign-in page. Empty: «Accedi» is not shown (the panel lives inside Tailscale). */
  signInUrl: '',
} as const
