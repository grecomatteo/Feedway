// Better Auth lists vitest, vue and drizzle-kit as optional peers. pnpm would link the workspace's own dev tools
// as those peers, and `pnpm deploy --prod` would then ship them (and esbuild's Go binary) in the image.
const BETTER_AUTH_PACKAGES = /^(better-auth|@better-auth\/.+)$/
const DROPPED_PEERS = new Set(['vitest', 'vue', 'drizzle-kit'])

const withoutDropped = (entries) =>
  Object.fromEntries(Object.entries(entries ?? {}).filter(([name]) => !DROPPED_PEERS.has(name)))

module.exports = {
  hooks: {
    readPackage(pkg) {
      if (BETTER_AUTH_PACKAGES.test(pkg.name)) {
        pkg.peerDependencies = withoutDropped(pkg.peerDependencies)
        pkg.peerDependenciesMeta = withoutDropped(pkg.peerDependenciesMeta)
      }
      return pkg
    },
  },
}
