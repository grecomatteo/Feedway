# Stack: scelte e alternative valutate

Revisione del 2026-10-15, con versioni controllate sui registri ufficiali (npm, Docker Hub, nodejs.org) in quella data. Le scelte che cambiano l'architettura hanno anche un'ADR; qui c'è il quadro completo, componente per componente.

Criteri usati, in quest'ordine: **sicurezza e supporto lungo** (la 1.0 vivrà almeno fino al 2028), **un solo linguaggio e pochi servizi da gestire** (una VPS da 2 core, un team piccolo), **dati in casa e niente costi fissi**, **maturità** (niente versioni alpha nei punti critici), **produttività con agenti di programmazione** (strumenti diffusi e ben documentati).

## Tabella

| Componente | Scelta | Alternative valutate | Perché questa | Stato al 2026-10-15 |
|---|---|---|---|---|
| Linguaggio | TypeScript 6.0, `strict` | TypeScript 7 (compilatore nativo), JavaScript | Tipi in tutto il progetto; 6.0 è l'ultima versione compatibile con gli strumenti di Vue | TypeScript 7 è uscito a luglio 2026 ed è 10 volte più veloce, ma `vue-tsc` non lo supporta ancora: si passa con una PR quando lo farà (ADR 010) |
| Runtime | Node 24 LTS | Node 26, Bun, Deno | Supporto fino ad aprile 2028, compatibilità piena con le librerie native (sharp, argon2) | **Cambio previsto:** Node 26 diventa LTS a fine ottobre 2026, con supporto fino ad aprile 2029. Si passa con una PR dedicata appena è LTS, prima della tappa 2 |
| Pannello + API | Nuxt 4 (Vue 3, Nitro) | Next.js (React), SvelteKit, SPA Vue + Hono/Fastify | Un solo progetto per pagine e API, rendering sul server, ecosistema maturo; Vue è più semplice da leggere | Nuxt 4.6 stabile; Nuxt 3 fuori supporto da luglio 2026 |
| Componenti UI | Nuxt UI 4 + token in `packages/ui` | PrimeVue, Vuetify, shadcn-vue | Accessibile (basato su Reka UI), temi con token, gratuito per intero dalla v4, stesso autore di Nuxt | 4.12 stabile |
| Database | **PostgreSQL 18** | PostgreSQL 17, MySQL, SQLite | Transazioni, JSONB, Row Level Security per l'isolamento tra agenzie, coda nello stesso database | **Cambiato da 17 a 18:** stabile da settembre 2025 (ora 18.6), `uuidv7()` nativo, I/O asincrono, supporto fino a novembre 2030 |
| ORM e migrazioni | Drizzle ORM + drizzle-kit | Prisma 7, Kysely, TypeORM, SQL a mano | Query tipizzate vicine all'SQL, migrazioni SQL leggibili, nessun motore separato, buon supporto RLS | **Da decidere a inizio tappa 1:** la 1.0 di Drizzle è in RC (1.0.0-rc.4); la stabile è 0.45. Si parte dalla 1.0 se è uscita, altrimenti dalla 0.45 con il passaggio alla 1.0 in una PR dedicata |
| Coda di lavori | pg-boss 12 | BullMQ + Redis, Graphile Worker, Temporal, Inngest | Sta in Postgres: un servizio in meno, lavori nella stessa transazione dei dati (ADR 002) | 12.38 stabile |
| Validazione | Zod 4 | Valibot, ArkType | Stessi schemi per pannello, API, configurazione e OpenAPI; il più diffuso | 4.6 stabile |
| API e documentazione | OpenAPI generata dagli schemi Zod | tRPC, GraphQL | API REST standard, utilizzabile da MCP e da client esterni (ADR 006) | |
| Accesso e account | Better Auth + passkey + 2FA, argon2id | Codice nostro, Lucia (dismessa), Auth.js, Clerk, WorkOS, Keycloak, Authentik, Zitadel | Pronta, sul nostro database, senza costi né dati negli Stati Uniti (ADR 012, decisa da Matteo) | 1.7 stabile; versione fissata e aggiornamenti di sicurezza immediati |
| Robustezza delle password | @zxcvbn-ts/core con dizionari comuni e italiani | Solo lunghezza minima, servizi esterni (Have I Been Pwned) | Funziona senza rete, rifiuta le password più comuni anche in italiano | |
| QR della 2FA | uqr | qrcode, servizi esterni | Leggero, senza dipendenze, disegnato nel browser: il segreto non esce mai | |
| Esportazione dei dati (ZIP) | fflate | archiver, yazl, jszip | Piccolo, veloce, senza dipendenze, funziona a flusso | |
| Sicurezza HTTP | nuxt-security | Header scritti a mano, Helmet | CSP con nonce, header e limiti già integrati in Nuxt | |
| Elaborazione immagini | sharp (libvips) | Jimp, ImageMagick | Il più veloce in Node, usa poca memoria | 0.35 stabile |
| Foto HEIC dell'iPhone | **libheif-js** | heic-convert, libvips di sistema con libheif, ffmpeg | sharp da solo non legge le HEIC dell'iPhone | **Cambiato:** heic-convert non è aggiornato dal 2023; libheif-js è mantenuto (ottobre 2026). Verifica con foto vere nella tappa 4 |
| Video | ffmpeg / ffprobe nell'immagine | Servizi esterni (Mux, Cloudinary) | Gratuito, in casa, standard di fatto | |
| File | Disco della VPS dietro la porta `Storage` | Storage a oggetti fin da subito | Semplice e senza costi; la porta permette il passaggio a S3 senza cambiare codice | |
| Storage a oggetti (futuro) e test S3 | Cloudflare R2 in produzione; **Garage** per i test | MinIO, SeaweedFS, RustFS, AWS S3 | R2 non fa pagare il traffico in uscita; Garage è leggero e open source | **Cambiato:** MinIO Community è in sola manutenzione, senza immagini Docker da ottobre 2025 e archiviato nel 2026 |
| Email | Nodemailer verso SMTP (Brevo o Scaleway TEM) | Resend, Postmark, SES via API | Qualsiasi provider con lo stesso codice, configurato dal pannello, dati in Europa | |
| Telegram | Bot API con grammY | Telegraf, chiamate HTTP dirette | Tipizzato e mantenuto | 1.46 stabile |
| Date e fusi | Luxon | date-fns-tz, Day.js, Temporal | Fusi e ora legale corretti, API immutabile | Temporal non c'è ancora in Node LTS: si valuta quando ci sarà |
| ID | UUID v7 dalla porta `IdGenerator` | ID numerici, ULID, nanoid | Ordinati nel tempo (indici efficienti), non indovinabili, generati nel codice e quindi testabili | Con Postgres 18 esiste anche `uuidv7()` nel database, utile per gli script |
| Log | pino (JSON) | winston, console | Il più veloce, oscuramento dei campi sensibili | 10 stabile |
| Errori | Sentry o GlitchTip (facoltativi) | Nessuno, Highlight | GlitchTip è compatibile con Sentry e si può ospitare da sé | |
| Sorveglianza esterna | healthchecks.io | Uptime Kuma sulla stessa VPS | Avvisa anche se la VPS è spenta | |
| PWA | @vite-pwa/nuxt | Service worker scritto a mano | Standard per Nuxt, aggiornamento automatico | |
| Traduzioni | @nuxtjs/i18n | vue-i18n diretto | Integrato in Nuxt, rotte per lingua sul sito | |
| Test | Vitest, Testcontainers, Playwright + axe | Jest, Cypress | Veloci, Postgres reale nei test, browser reali e accessibilità automatica | Vitest 5 e Playwright 1.64 stabili |
| Confini tra moduli | dependency-cruiser | Nx module boundaries, regole ESLint | Funziona con qualsiasi struttura, blocca la CI | |
| Lint e formato | ESLint 10 (`@nuxt/eslint`) + Prettier | Biome, oxlint | Pieno supporto ai file `.vue` e alle regole nostre (`Date` vietato nel dominio, `runAsSystem` limitato) | oxlint è stabile e molto veloce: si può aggiungere come primo passaggio se ESLint diventa lento |
| Monorepo | pnpm workspaces + Turborepo | Nx, Bun workspaces | Semplice, cache dei comandi, pnpm protegge dalle dipendenze fantasma | |
| Git e qualità | Husky, lint-staged, commitlint, release-please, Renovate | Lefthook, semantic-release, changesets, Dependabot | Versioni e changelog dai commit; Renovate raggruppa e programma gli aggiornamenti meglio di Dependabot | |
| CI | GitHub Actions | GitLab CI, CircleCI | Il repository è su GitHub; ruleset e controlli obbligatori integrati | **Aggiunto:** azioni fissate per SHA del commit, dopo la compromissione di `trivy-action` nel marzo 2026 |
| Sicurezza del codice | CodeQL, gitleaks, Trivy, `pnpm audit` | Snyk, SonarQube | Gratuiti per repository su GitHub | |
| Esecuzione | Docker Compose + `install.sh` / `update.sh` | Coolify, Dokploy, Kamal, Kubernetes | Nessun servizio in più sulla VPS, installazione e ritorno indietro con un comando | |
| Esposizione | Tailscale, poi Cloudflare Tunnel + Access | Porte aperte con Caddy, ngrok | Nessuna porta aperta sulla VPS | |
| Backup | pg_dump cifrato con age, copiato con rclone | pgBackRest, WAL-G | Semplice e sufficiente con un dump al giorno; per ripristinare a un minuto preciso si passerà a pgBackRest | |
| Sito pubblico | Nuxt statico su Cloudflare Pages | Astro, sito nel pannello, WordPress | Stesso linguaggio e stessi token del pannello, nessun server (ADR 013) | |
| Progetto grafico | Pencil | Figma, Penpot | Scelta di Matteo; i file stanno nel repository | Formato e collegamento con gli agenti da verificare con i primi file |

## Cosa cambia con questa revisione

1. **PostgreSQL 18** al posto di 17. L'immagine Docker 18 salva i dati in `/var/lib/postgresql/18/docker`, quindi il volume si monta su `/var/lib/postgresql`.
2. **libheif-js** al posto di heic-convert, che non è più aggiornato.
3. **Garage** al posto di MinIO per i test dello storage a oggetti.
4. **Azioni GitHub fissate per SHA del commit**, oltre alle immagini fissate per digest.
5. **Node 26 LTS** appena disponibile (fine ottobre 2026), con una PR dedicata.
6. **Drizzle 1.0** se è uscita all'inizio della tappa 1, altrimenti 0.45 con passaggio pianificato.

Tutto il resto resta com'era: per ogni componente l'alternativa più forte è stata considerata e scartata per i motivi in tabella.
