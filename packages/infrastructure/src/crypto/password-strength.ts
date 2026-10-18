import { ZxcvbnFactory } from '@zxcvbn-ts/core'
import * as common from '@zxcvbn-ts/language-common'
import * as it from '@zxcvbn-ts/language-it'

let factory: ZxcvbnFactory | undefined

// Built on first use: loading the dictionaries takes a moment and most processes never need them.
function zxcvbn(): ZxcvbnFactory {
  factory ??= new ZxcvbnFactory({
    dictionary: { ...common.dictionary, ...it.dictionary },
    graphs: common.adjacencyGraphs,
    translations: it.translations,
  })
  return factory
}

// zxcvbn matches whole dictionary entries: "Mario Rossi" alone would not catch "rossi", so every
// input also adds its pieces: "mario.rossi@esempio.it" → mario.rossi, esempio.it, mario, rossi…
function expandInputs(userInputs: string[]): string[] {
  const pieces = userInputs.flatMap((input) => {
    const lower = input.toLowerCase()
    return [lower, ...lower.split(/[@\s]+/u), ...lower.split(/[^\p{L}\p{N}]+/u)]
  })
  return [...new Set([...userInputs, ...pieces].filter((w) => w.length >= 3))]
}

/** zxcvbn score 0–4 with common and Italian dictionaries, also against the user's own data. */
export function passwordStrength(password: string, userInputs: string[]): number {
  return zxcvbn().check(password, expandInputs(userInputs)).score
}
