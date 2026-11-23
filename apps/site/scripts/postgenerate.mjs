// After `nuxt generate`: writes the Cloudflare Pages `_headers` file with a CSP that allows only the
// inline scripts Nuxt emitted (by hash), plus robots.txt and sitemap.xml. With SITE_RELEASE=1 it
// also refuses a build whose privacy notice still has «DA COMPLETARE» in it.
import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

const out = new URL('../.output/public/', import.meta.url).pathname
const siteUrl = (process.env.SITE_URL ?? 'https://feedway.pages.dev').replace(/\/$/, '')

async function htmlFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = await Promise.all(
    entries.map((e) =>
      e.isDirectory()
        ? htmlFiles(join(dir, e.name))
        : e.name.endsWith('.html')
          ? [join(dir, e.name)]
          : [],
    ),
  )
  return files.flat()
}

const files = await htmlFiles(out)
const hashes = new Set()
const pages = []
let placeholders = 0
for (const file of files) {
  const html = await readFile(file, 'utf8')
  for (const m of html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (/type="application\/json"/.test(m[1])) continue
    hashes.add(`'sha256-${createHash('sha256').update(m[2]).digest('base64')}'`)
  }
  if (html.includes('DA COMPLETARE')) placeholders++
  const path =
    '/' +
    relative(out, file)
      .replace(/index\.html$/, '')
      .replace(/\.html$/, '')
  // pages marked noindex (the outcomes of the demo form) stay out of the sitemap
  if (!/^\/(200|404)$/.test(path) && !/<meta name="robots" content="noindex"/.test(html)) {
    pages.push(path)
  }
}

if (process.env.SITE_RELEASE === '1' && placeholders > 0) {
  console.error(
    `${placeholders} pagine hanno ancora «DA COMPLETARE»: compila apps/site/app/legal.ts.`,
  )
  process.exit(1)
}

const csp = [
  "default-src 'self'",
  `script-src 'self' ${[...hashes].join(' ')}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "object-src 'none'",
].join('; ')

await writeFile(
  join(out, '_headers'),
  `/*
  Content-Security-Policy: ${csp}
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()
  Cross-Origin-Opener-Policy: same-origin

/_nuxt/*
  Cache-Control: public, max-age=31536000, immutable

/fonts/*
  Cache-Control: public, max-age=31536000, immutable

https://:project.pages.dev/*
  X-Robots-Tag: noindex
`,
)

await writeFile(
  join(out, 'robots.txt'),
  `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}/sitemap.xml\n`,
)
await writeFile(
  join(out, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages
    .sort()
    .map((p) => `  <url><loc>${siteUrl}${p}</loc></url>`)
    .join('\n')}\n</urlset>\n`,
)
console.log(
  `_headers: ${hashes.size} script inline; sitemap: ${pages.length} pagine; segnaposto: ${placeholders}`,
)
