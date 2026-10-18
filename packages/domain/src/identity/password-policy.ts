export const MIN_PASSWORD_LENGTH = 12
export const MAX_PASSWORD_LENGTH = 128
/** zxcvbn-style score (0–4): 3 is "safely unguessable". */
export const MIN_PASSWORD_SCORE = 3

export type PasswordCheck =
  { ok: true } | { ok: false; reason: 'TOO_SHORT' | 'TOO_LONG' | 'TOO_WEAK' }

/** The strength estimator is injected: the domain imports no library. */
export function checkPassword(
  password: string,
  context: { email: string; name: string },
  score: (password: string, userInputs: string[]) => number,
): PasswordCheck {
  // Length in code points: an emoji or accented letter counts as one character.
  const length = Array.from(password).length
  if (length < MIN_PASSWORD_LENGTH) return { ok: false, reason: 'TOO_SHORT' }
  if (length > MAX_PASSWORD_LENGTH) return { ok: false, reason: 'TOO_LONG' }
  const inputs = [
    context.email,
    context.name,
    ...context.name.split(/\s+/),
    context.email.split('@')[0] ?? '',
  ]
  if (
    score(
      password,
      inputs.filter((i) => i !== ''),
    ) < MIN_PASSWORD_SCORE
  )
    return { ok: false, reason: 'TOO_WEAK' }
  return { ok: true }
}
