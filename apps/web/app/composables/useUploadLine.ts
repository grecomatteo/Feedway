import type { UploadItem, UploadStore } from './useUploads'

/**
 * What an upload says, in the library's list and in the dock (spec §14.2 «Avanzamento visibile»):
 * one line under the name, its colour and its bar.
 */
export function useUploadLine() {
  const { t } = useI18n()

  const percentOf = (i: UploadItem) =>
    i.size > 0 ? Math.min(100, Math.floor((Math.min(i.sent, i.size) / i.size) * 100)) : 0
  const workPercent = (i: UploadItem) =>
    i.media?.progress ? Math.min(100, Math.max(0, Math.round(i.media.progress.percent))) : null
  const remaining = (i: UploadItem) =>
    i.rate && i.rate > 0 ? formatEta((i.size - i.sent) / i.rate) : null

  /** One line under the name, what is happening now. */
  function line(i: UploadItem): string {
    const amount = t('upload.amount', {
      sent: formatBytes(Math.min(i.sent, i.size)),
      total: formatBytes(i.size),
      percent: percentOf(i),
    })
    switch (i.state) {
      case 'queued':
        return t('upload.state.queued')
      case 'hashing':
        return i.sent > 0 ? amount : t('upload.state.hashing')
      case 'uploading': {
        const eta = remaining(i)
        return eta ? `${amount} · ${t('upload.eta', { eta })}` : amount
      }
      case 'paused':
        return `${t('upload.state.paused')} · ${amount}`
      case 'offline':
        return t('upload.state.offline')
      case 'completing':
        return t('upload.state.completing')
      case 'processing': {
        const step = i.media?.progress?.step
        const pct = workPercent(i)
        const what =
          step === 'analysis' || step === 'conversion'
            ? t(`upload.step.${step}`)
            : t('upload.state.processing')
        return pct === null ? what : `${what} · ${String(pct)}%`
      }
      case 'ready':
        return t('upload.state.ready')
      case 'failed':
        return i.media?.failure
          ? t('upload.state.failedWhy', { reason: t(`library.failure.${i.media.failure.code}`) })
          : t('upload.state.failed')
      default:
        return i.message ?? ''
    }
  }
  const tone = (i: UploadItem) =>
    i.state === 'rejected' || i.state === 'error' || i.state === 'failed'
      ? 'text-(--app-danger)'
      : i.state === 'ready'
        ? 'text-(--app-success)'
        : 'text-(--app-text-muted)'
  const showsBar = (i: UploadItem) =>
    ['hashing', 'uploading', 'paused', 'offline', 'completing', 'processing'].includes(i.state)
  /** While the worker prepares the file the bar is its progress, not the upload's. */
  const barPercent = (i: UploadItem) =>
    i.state === 'processing' ? (workPercent(i) ?? 0) : i.state === 'completing' ? 100 : percentOf(i)

  /** All the files of a store in one line: «2 di 3 file · 40 MB di 120 MB · 3 min». */
  function uploadSummary(x: UploadStore['totals']['value']) {
    const parts = [
      t('upload.overall', { done: x.uploaded, n: x.files }, x.files),
      t('upload.amountShort', { sent: formatBytes(x.sent), total: formatBytes(x.size) }),
    ]
    if (x.seconds !== null) parts.push(t('upload.eta', { eta: formatEta(x.seconds) }))
    return parts.join(' · ')
  }

  return { line, tone, showsBar, barPercent, workPercent, percentOf, uploadSummary }
}
