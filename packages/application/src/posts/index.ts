// The posts module (plan 06 Task 4): its one entry for the routes and the other modules.
// `createDraft` and `getStatuses` work inside the caller's transaction (for stage 9).
export { createDraft, createPost, deletePost, updatePost } from './drafts.js'
export type { CreateDraftInput } from './drafts.js'
export type { PostContent, PostsDeps, PostWhenInput, UpdatePostInput } from './common.js'
// the agency's day, for the /oggi of Telegram (plan 08 Task 7)
export { agencyDay } from './common.js'
export { cancelPost, publishNow, schedulePost, unschedulePost } from './schedule.js'
export { getPost, listPosts } from './read.js'
export type { PostDto, PostMediaDto } from './read.js'
export { getStatuses, isPostOf } from './statuses.js'
export { ACTIVITY_KINDS, getPostOutcome } from './outcome.js'
export type { ActivityDto, DestinationOutcomeDto, PostOutcomeDto } from './outcome.js'
export type { OutcomeFileDto, OutcomePreviewDto, OutcomeVersionDto } from './outcome-preview.js'
export { toCheckInput } from './to-check-input.js'
// The content settings of a workspace and the notes of a post (plan 06 Task 7).
export { createLabel, deleteLabel, listLabels, updateLabel } from './labels.js'
export type { LabelDto } from './labels.js'
export {
  FREE_SLOTS_MAX,
  findFreeSlots,
  findNextFreeSlot,
  freeSlotOn,
  listTimeSlots,
  replaceTimeSlots,
} from './time-slots.js'
export type { NextFreeSlotDto, TimeSlotsDto } from './time-slots.js'
export {
  createCaptionTemplate,
  deleteCaptionTemplate,
  listCaptionTemplates,
  updateCaptionTemplate,
} from './caption-templates.js'
export type { CaptionTemplateDto } from './caption-templates.js'
export {
  createAccountGroup,
  deleteAccountGroup,
  listAccountGroups,
  updateAccountGroup,
} from './account-groups.js'
export type { AccountGroupDto } from './account-groups.js'
export { addNote, deleteNote, listNotes } from './notes.js'
// «Eliminati» (plan 09 Scelta 12, Task 14).
export { PURGE_ALL_MAX, purgePosts, restorePosts, trashPosts } from './trash.js'
export { cleanupDrafts } from './drafts-cleanup.js'
export type { DraftsCleanupDeps, DraftsCleanupReport } from './drafts-cleanup.js'
export type { PostNoteDto } from './notes.js'
// The calendar's posts and its list (plan 09 Task 2), for the `calendar` module.
export {
  EMPTY_DRAFTS_MAX,
  GRID_POSTS_MAX,
  deleteEmptyDrafts,
  listGridPosts,
  listPostsInRange,
} from './calendar.js'
export type { CalendarPostDto, PostRangeFilters } from './calendar.js'
// Instagram's grid (plan 09 Task 12): two scheduled posts swap their times.
export { swapScheduledTimes } from './swap.js'
export { sendAfterSchedule } from './schedule.js'
export type { AfterSchedule } from './schedule.js'
export type { SwapInput, SwapResult, SwapSide } from './swap.js'
// «Oggi» (redesign R3): the agenda of the clients the person sees.
export {
  AGENDA_MAX_DAYS,
  DRAFTS_MAX,
  agendaPeriod,
  draftMissing,
  listAgenda,
  listAgendaIssues,
  listClientActivity,
  listDraftsToFinish,
  textStart,
} from './agenda.js'
export type {
  AgendaIssueDto,
  AgendaPostDto,
  AgendaThumbnail,
  ClientActivityDto,
  DraftMissing,
  DraftToFinishDto,
} from './agenda.js'
export {
  QUOTA_LOW_BELOW,
  copyKey,
  prepareTarget,
  publishCopiesInUse,
  publishTarget,
  recheckTarget,
  reconcilePublishing,
  cancelPaused,
  cancelTarget,
  markVerified,
  resumePaused,
  retryTarget,
  searchTarget,
  verifyTarget,
  type CopiesInUse,
  type ProblemReason,
  type RecheckOutcome,
  type PublishingWorkerDeps,
  type ReconcileReport,
  type StepLog,
  type TargetJob,
} from './publishing/index.js'
export { untitledPost } from './title.js'
// Programming in bulk and «Duplica» (plan 09 Task 10).
export { blockingCodes, createScheduled } from './create-scheduled.js'
export type { CreatedPost } from './create-scheduled.js'
export {
  bulkImportNotFound,
  duplicatePost,
  getBulkImport,
  runBulkImport,
  startBulkImport,
  undoBulkImport,
} from './bulk.js'
export type { BulkImportDto, BulkImportReport, DuplicateDate } from './bulk.js'
