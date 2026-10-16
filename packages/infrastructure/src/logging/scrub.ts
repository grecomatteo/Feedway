const PATTERNS: [RegExp, string][] = [
  [
    /\b(access_token|appsecret_proof|input_token|client_secret|refresh_token)=[^&\s"']+/gi,
    '$1=[REDACTED]',
  ],
  [/(:\/\/[^/\s:@]+):[^@\s/]+@/g, '$1:[REDACTED]@'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/g, 'Bearer [REDACTED]'],
]

/** Removes tokens, proofs, URL credentials and bearer values from free text. */
export function scrubSecrets(text: string): string {
  return PATTERNS.reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), text)
}
