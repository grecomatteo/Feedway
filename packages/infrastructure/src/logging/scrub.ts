const PATTERNS: [RegExp, string][] = [
  [/\b(appsecret_proof|client_secret)=[^&\s"']+/gi, '$1=[REDACTED]'],
  // any `…token=` or `…_token=` parameter, also URL-encoded (`token%3D`)
  [/(?<![A-Za-z0-9])([a-z0-9_]*token)(=|%3D)[^&\s"']+/gi, '$1$2[REDACTED]'],
  // the values of a failed query (Drizzle): tokens, emails, anything the query was given
  [/(\bparams: )[\s\S]*?(?=\n\s+at |$)/g, '$1[REDACTED]'],
  [/(:\/\/[^/\s:@]+):[^@\s/]+@/g, '$1:[REDACTED]@'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/g, 'Bearer [REDACTED]'],
  // an unused activation link creates an account
  [/(\/api\/v1\/links|\/attiva)\/[^/?#\s"']+/g, '$1/[REDACTED]'],
  // a reset link opens the account for an hour; the library's tokens are too short for pathForLog
  [/(\/reset-password)\/+[^?#\s"']*/gi, '$1/[REDACTED]'],
  // the same token as Better Auth stores it
  [/(reset-password:)[^\s,"']+/gi, '$1[REDACTED]'],
]

/** Removes tokens, proofs, URL credentials, bearer values and link tokens from free text. */
export function scrubSecrets(text: string): string {
  return PATTERNS.reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), text)
}
