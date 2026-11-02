import { DomainError, RETENTION } from '@app/domain'
import type { AuthSessionInfo } from '../ports/auth.js'
import type { Clock } from '../ports/clock.js'
import type { IdGenerator } from '../ports/id-generator.js'
import type { JobQueue } from '../ports/job-queue.js'
import type { Logger } from '../ports/logger.js'
import type { DataExportRecord, DataExportStatus } from '../ports/repositories.js'
import type { Storage, StoredObject } from '../ports/storage.js'
import type { Tx } from '../ports/tx.js'
import type { UnitOfWork } from '../ports/unit-of-work.js'
import { assertRecentReauth } from './reauth.js'
import type { ZipEntry, ZipWriter } from '../ports/zip-writer.js'

export interface DataExportDto {
  id: string
  status: DataExportStatus
  createdAt: string
  /** When the file stops being downloadable; null until it is ready. */
  expiresAt: string | null
}

/** Requests in the last 24 hours, whatever became of them. */
export const DATA_EXPORTS_PER_DAY = 3
const DAY_MS = 24 * 3600_000
/** Activity entries read per query while the archive is built. */
const AUDIT_PAGE = 1000
/** Requests shown to the person. */
const LISTED = 5
/**
 * An export still being prepared after this long is taken as failed: the worker stopped on it.
 * The person can ask again, and a retried job may take it over.
 */
export const DATA_EXPORT_STALE_MS = 3600_000
/** At most this many activity entries go in the archive, the newest; the rest is noted. */
export const DATA_EXPORT_MAX_ACTIVITY = 50_000

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const staleBefore = (now: Date) => new Date(now.getTime() - DATA_EXPORT_STALE_MS)

/**
 * A ready file past its time is shown as expired, and one stuck in preparation as failed,
 * whatever the row still says.
 */
function statusOf(record: DataExportRecord, now: Date): DataExportStatus {
  if (record.status === 'ready' && record.expiresAt !== null && record.expiresAt <= now)
    return 'expired'
  if (
    (record.status === 'pending' || record.status === 'running') &&
    record.updatedAt < staleBefore(now)
  )
    return 'failed'
  return record.status
}

function toDto(record: DataExportRecord, now: Date): DataExportDto {
  return {
    id: record.id,
    status: statusOf(record, now),
    createdAt: record.createdAt.toISOString(),
    expiresAt: record.expiresAt?.toISOString() ?? null,
  }
}

/**
 * "Scarica i miei dati": one archive at a time. A request while one is being prepared returns
 * that one; at most three requests a day. The whole account in one file: the session must have
 * been confirmed with the password or a passkey in the last minutes (REAUTH_REQUIRED).
 */
export async function requestDataExport(
  deps: { uow: UnitOfWork; queue: Pick<JobQueue, 'send'>; clock: Clock; ids: IdGenerator },
  user: { id: string },
  session: AuthSessionInfo,
  request: { ip: string | null },
): Promise<DataExportDto> {
  const now = deps.clock.now()
  assertRecentReauth(session, now)
  return deps.uow.run({ userId: user.id }, async (tx) => {
    // the row lock puts two requests at once in line: the second finds the first
    await tx.users.findByIdForUpdate(user.id)
    const active = await tx.dataExports.findActive(user.id, staleBefore(now))
    if (active) return toDto(active, now)
    const since = new Date(now.getTime() - DAY_MS)
    if ((await tx.dataExports.countSince(user.id, since)) >= DATA_EXPORTS_PER_DAY)
      throw new DomainError(
        'RATE_LIMITED',
        'Puoi chiedere i tuoi dati al massimo 3 volte in 24 ore: riprova più tardi',
      )
    const id = deps.ids.newId()
    await tx.dataExports.create({ id, userId: user.id, createdAt: now })
    // queued before the commit: if it fails nothing is recorded; the job waits for the commit
    await deps.queue.send('identity.data_export', {
      userId: user.id,
      exportId: id,
      ip: request.ip,
    })
    const created = await tx.dataExports.find(user.id, id)
    if (!created) throw new Error('data export not found after insert')
    return toDto(created, now)
  })
}

/** The person's latest requests, newest first. */
export async function listDataExports(
  deps: { uow: UnitOfWork; clock: Clock },
  user: { id: string },
): Promise<DataExportDto[]> {
  const now = deps.clock.now()
  const records = await deps.uow.run({ userId: user.id }, (tx) =>
    tx.dataExports.listRecent(user.id, LISTED),
  )
  return records.map((r) => toDto(r, now))
}

/**
 * The archive, for its owner only (someone else's id is NOT_FOUND). Past its 24 hours it is
 * LINK_INVALID (410); still being prepared, CONFLICT.
 */
export async function openDataExport(
  deps: { uow: UnitOfWork; storage: Storage; clock: Clock },
  user: { id: string },
  session: AuthSessionInfo,
  exportId: string,
): Promise<{ object: StoredObject; createdAt: Date }> {
  // like the request: a session alone does not take the whole account away
  assertRecentReauth(session, deps.clock.now())
  if (!UUID.test(exportId)) throw new DomainError('NOT_FOUND', 'Esportazione non trovata')
  const record = await deps.uow.run({ userId: user.id }, (tx) =>
    tx.dataExports.find(user.id, exportId),
  )
  if (!record) throw new DomainError('NOT_FOUND', 'Esportazione non trovata')
  const status = statusOf(record, deps.clock.now())
  if (status === 'expired')
    throw new DomainError('LINK_INVALID', 'Il file è scaduto: chiedi di nuovo i tuoi dati')
  if (status === 'failed')
    throw new DomainError('CONFLICT', 'Il file non è stato preparato: chiedi di nuovo i tuoi dati')
  if (status !== 'ready' || record.storageKey === null)
    throw new DomainError('CONFLICT', 'Il file non è ancora pronto')
  const object = await deps.storage.get(record.storageKey)
  if (!object)
    throw new DomainError('LINK_INVALID', 'Il file non c’è più: chiedi di nuovo i tuoi dati')
  return { object, createdAt: record.createdAt }
}

export interface DataExportJobDeps {
  uow: UnitOfWork
  storage: Storage
  clock: Clock
  zip: ZipWriter
  logger: Logger
}

const exportKey = (userId: string, exportId: string) => `users/${userId}/exports/${exportId}.zip`

const json = (value: unknown) => new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`)
const iso = (date: Date | null) => date?.toISOString() ?? null

async function readAll(object: StoredObject): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of object.body) {
    chunks.push(chunk)
    size += chunk.length
  }
  const all = new Uint8Array(size)
  let at = 0
  for (const chunk of chunks) {
    all.set(chunk, at)
    at += chunk.length
  }
  return all
}

type OwnEntry = Awaited<ReturnType<Tx['audit']['listOwn']>>[number]

/** The entries of one query, newest first, page by page: at most `max`, plus one to tell. */
async function ownEntries(
  tx: Tx,
  organizationId: string | null,
  actorId: string,
  max: number,
): Promise<OwnEntry[]> {
  const all: OwnEntry[] = []
  let after: { position: string; id: string } | undefined
  while (all.length <= max) {
    const page = await tx.audit.listOwn({
      organizationId,
      actorId,
      limit: Math.min(AUDIT_PAGE, max + 1 - all.length),
      ...(after && { after }),
    })
    all.push(...page)
    const last = page.at(-1)
    if (page.length === 0 || !last) break
    after = { position: last.position, id: last.id }
  }
  return all
}

const README = `I tuoi dati personali
=====================

Questo archivio contiene i dati che il pannello conserva su di te, come li hai chiesti con
«Scarica i miei dati».

- profilo.json: nome, soprannome, email, preferenze e date dell'account.
- agenzie.json: le agenzie in cui lavori o hai lavorato, il tuo ruolo e i clienti (spazi) a
  cui hai accesso.
- sicurezza.json: le sessioni aperte (dispositivo, indirizzo IP, metodo di accesso e date), le
  passkey (nome e data), se l'app di autenticazione è attiva e i dispositivi riconosciuti.
- attivita.json: le azioni registrate a tuo nome, nel tuo account e in ogni agenzia.
- foto/avatar-256.webp: la tua foto profilo, se ne hai una.

Non contiene password, codici di sicurezza, chiavi o token: il pannello conserva solo la loro
impronta, e non serve a te.
Le date sono in UTC (formato ISO 8601).
`

const README_TRUNCATED = `
Attività: ci sono solo le ${String(DATA_EXPORT_MAX_ACTIVITY)} azioni più recenti. Per le più
vecchie scrivi all'amministratore del pannello.
`

/**
 * The job: the person's data only, read in their own scope and in each agency's scope, into
 * `users/<id>/exports/<exportId>.zip`. Never a password hash, a 2FA secret, a code or a token.
 */
export async function buildDataExport(
  deps: DataExportJobDeps,
  data: { userId: string; exportId: string; ip: string | null },
): Promise<void> {
  const { userId, exportId } = data
  const own = { userId }
  const now = () => deps.clock.now()
  const claim = await deps.uow.run(own, async (tx) => {
    const record = await tx.dataExports.find(userId, exportId)
    if (!record) return 'missing'
    // pending, or running on a worker that stopped: one run at a time, a retry takes over
    const claimed = await tx.dataExports.claim(userId, exportId, staleBefore(now()), now())
    if (!claimed) return 'done'
    const user = await tx.users.findById(userId)
    // locked or disabled after the request: whoever holds the session gets nothing
    if (!user || user.status !== 'active' || user.securityLockedAt !== null) {
      await tx.dataExports.update(userId, exportId, { status: 'failed', at: now() })
      return 'refused'
    }
    return 'claimed'
  })
  // queued before the commit: retried until the row is there
  if (claim === 'missing') throw new Error('data export not committed yet')
  if (claim !== 'claimed') return
  try {
    const entries = await collect(deps, userId)
    const archive = deps.zip.create(entries)
    const key = exportKey(userId, exportId)
    await deps.storage.put(key, Buffer.from(archive), { contentType: 'application/zip' })
    const expiresAt = new Date(deps.clock.now().getTime() + RETENTION.dataExportMs)
    await deps.uow.run(own, async (tx) => {
      await tx.dataExports.update(userId, exportId, {
        status: 'ready',
        storageKey: key,
        expiresAt,
        at: now(),
      })
      // asked from the panel: the address of the request, not the worker's
      await tx.audit.record({
        organizationId: null,
        actorId: userId,
        source: 'panel',
        action: 'user.data_exported',
        entity: 'user',
        entityId: userId,
        workspaceId: null,
        ip: data.ip,
      })
      // only the newest archive stays: an older one is shown as expired and its file goes
      for (const older of await tx.dataExports.listRecent(userId, LISTED))
        if (older.id !== exportId && older.status === 'ready')
          await tx.dataExports.update(userId, older.id, { status: 'expired', at: now() })
    })
  } catch (error) {
    // the person sees "non riuscita" and can ask again; nothing to retry on our side
    deps.logger.error({ err: error, exportId }, 'data export failed')
    await deps.uow.run(own, (tx) =>
      tx.dataExports.update(userId, exportId, { status: 'failed', at: now() }),
    )
    return
  }
  try {
    for (const file of await deps.storage.list(`users/${userId}/exports/`))
      if (file.key !== exportKey(userId, exportId)) await deps.storage.delete(file.key)
  } catch (error) {
    // the files left behind go with the retention job
    deps.logger.warn({ err: error, exportId }, 'older data exports not removed')
  }
}

async function collect(deps: DataExportJobDeps, userId: string): Promise<ZipEntry[]> {
  const personal = await deps.uow.run({ userId }, async (tx) => {
    const user = await tx.users.findById(userId)
    if (!user) throw new Error('user not found')
    return {
      user,
      memberships: await tx.orgMembers.listForUser(userId),
      sessions: await tx.sessions.findForUser(userId),
      passkeys: await tx.credentials.listPasskeys(userId),
      devices: await tx.knownDevices.list(userId),
      activity: await ownEntries(tx, null, userId, DATA_EXPORT_MAX_ACTIVITY),
    }
  })
  const { user, memberships } = personal
  const agencies = []
  let activity = personal.activity.map((entry) => ({ entry, agency: null as string | null }))
  // the newest entries across the account and every agency, never more than the limit in memory
  const keepNewest = (): boolean => {
    activity.sort((a, b) => (a.entry.position < b.entry.position ? 1 : -1))
    if (activity.length <= DATA_EXPORT_MAX_ACTIVITY) return false
    activity = activity.slice(0, DATA_EXPORT_MAX_ACTIVITY)
    return true
  }
  let truncated = keepNewest()
  for (const m of memberships) {
    const inAgency = await deps.uow.run(
      { organizationId: m.organizationId, userId },
      async (tx) => {
        const roles = await tx.workspaceMembers.rolesOf(m.organizationId, userId)
        // read as a plain member: only the workspaces the person is in, and no row locks
        const visible = await tx.workspaces.listVisible({
          userId,
          platformRole: null,
          organizationId: m.organizationId,
          orgRole: 'member',
          memberships: roles,
        })
        const workspaces = visible.flatMap((workspace) => {
          const role = roles.get(workspace.id)
          return role
            ? [
                {
                  id: workspace.id,
                  nome: workspace.name,
                  ruolo: role,
                  archiviato: workspace.archivedAt !== null,
                },
              ]
            : []
        })
        return {
          workspaces,
          activity: await ownEntries(tx, m.organizationId, userId, DATA_EXPORT_MAX_ACTIVITY),
        }
      },
    )
    agencies.push({
      id: m.organizationId,
      agenzia: m.name,
      ruolo: m.role,
      statoAppartenenza: m.status === 'active' ? 'attiva' : 'disattivata',
      statoAgenzia: m.organizationStatus === 'active' ? 'attiva' : 'sospesa',
      clienti: inAgency.workspaces,
    })
    activity.push(...inAgency.activity.map((entry) => ({ entry, agency: m.name })))
    if (keepNewest()) truncated = true
  }

  const entries: ZipEntry[] = [
    {
      path: 'LEGGIMI.txt',
      data: new TextEncoder().encode(truncated ? README + README_TRUNCATED : README),
    },
    {
      path: 'profilo.json',
      data: json({
        id: user.id,
        nome: user.name,
        soprannome: user.nickname,
        email: user.email,
        ruoloPiattaforma: user.platformRole === 'admin' ? 'amministratore' : null,
        tema: user.theme,
        lingua: user.locale,
        fusoOrario: user.timezone,
        fotoProfilo: user.avatarKey !== null,
        creatoIl: iso(user.createdAt),
        ultimoAccesso: iso(user.lastLoginAt),
      }),
    },
    { path: 'agenzie.json', data: json(agencies) },
    {
      path: 'sicurezza.json',
      data: json({
        appDiAutenticazione: user.twoFactorEnabled,
        passkey: personal.passkeys.map((p) => ({
          nome: p.name,
          tipo: p.deviceType === 'multiDevice' ? 'sincronizzata' : 'su un solo dispositivo',
          creataIl: iso(p.createdAt),
        })),
        sessioni: personal.sessions.map((s) => ({
          apertaIl: iso(s.createdAt),
          ultimaAttivita: iso(s.updatedAt),
          scadeIl: iso(s.expiresAt),
          indirizzoIp: s.ipAddress,
          dispositivo: s.userAgent,
          metodo: s.authMethod,
        })),
        dispositiviRiconosciuti: personal.devices.map((d) => ({
          primaVolta: iso(d.firstSeenAt),
          ultimaVolta: iso(d.lastSeenAt),
        })),
      }),
    },
    {
      path: 'attivita.json',
      data: json(
        activity.map(({ entry, agency }) => ({
          quando: entry.position,
          azione: entry.action,
          agenzia: agency,
          idAgenzia: entry.organizationId,
          idAutore: entry.actorId,
          origine: entry.source,
          oggetto: entry.entity,
          idOggetto: entry.entityId,
          idCliente: entry.workspaceId,
          indirizzoIp: entry.ip,
          dettagli: entry.data,
        })),
      ),
    },
  ]
  if (user.avatarKey !== null) {
    const photo = await deps.storage.get(`${user.avatarKey}.webp`)
    if (photo) entries.push({ path: 'foto/avatar-256.webp', data: await readAll(photo) })
  }
  return entries
}
