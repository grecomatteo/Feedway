// The posts module (plan 06 Task 4): its one entry for the routes and the other modules.
// `createDraft` and `getStatuses` work inside the caller's transaction (for stage 9).
export { createDraft, createPost, deletePost, updatePost } from './drafts.js'
export type { CreateDraftInput } from './drafts.js'
export type { PostContent, PostsDeps, PostWhenInput, UpdatePostInput } from './common.js'
export { cancelPost, schedulePost, unschedulePost } from './schedule.js'
export { getPost, listPosts } from './read.js'
export type { PostDto, PostMediaDto } from './read.js'
export { getStatuses } from './statuses.js'
export { toCheckInput } from './to-check-input.js'
// The content settings of a workspace and the notes of a post (plan 06 Task 7).
export { createLabel, deleteLabel, listLabels, updateLabel } from './labels.js'
export type { LabelDto } from './labels.js'
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
export type { PostNoteDto } from './notes.js'
