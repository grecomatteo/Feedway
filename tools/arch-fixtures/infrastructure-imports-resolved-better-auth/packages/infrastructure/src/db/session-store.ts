// Resolved on disk (unlike a bare specifier), as a real import from the infrastructure package
// would be: the rule must catch the resolved node_modules path too.
import { betterAuth } from '../../../../../../../packages/infrastructure/node_modules/better-auth/dist/index.mjs'

export const auth = betterAuth
