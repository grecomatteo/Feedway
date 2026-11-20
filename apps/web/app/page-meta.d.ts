// The keys of `definePageMeta` the layouts read.
declare module '#app' {
  interface PageMeta {
    /** the auth layout's wider column, for a long text (the privacy notice) */
    authWide?: boolean
  }
}

export {}
