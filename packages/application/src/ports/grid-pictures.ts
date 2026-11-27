/** The account a picture of Instagram's grid belongs to, in one agency. */
export interface GridPictureScope {
  organizationId: string
  accountId: string
}

/** A post out and the platform's address of its picture, as the grid's listing gave it. */
export interface GridPicture {
  mediaId: string
  pictureUrl: string
}

/**
 * The tokens of the grid's pictures (plan 09 Task 12, P4): the listing hands one to the panel
 * for each picture, and the picture's route opens it instead of asking the platform again.
 * Sealed, not only signed: the platform's address never reaches the browser. Bound to the
 * agency and the account, and short-lived.
 */
export interface GridPictureTokens {
  seal(scope: GridPictureScope, picture: GridPicture, expiresAt: Date): string
  /** null: not one of ours, changed, of another agency or account, or expired. */
  open(scope: GridPictureScope, token: string, now: Date): GridPicture | null
}
