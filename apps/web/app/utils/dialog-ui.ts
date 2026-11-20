/**
 * The look of a window of the redesign (screens 15, 22): 480 wide with a 14 radius on a
 * computer, a sheet from the bottom on a phone; the title in Sora 16, the actions at the end of
 * a bar with a hairline above. The description is for a screen reader only: a window that needs a
 * sentence writes it in its body.
 */
export const DIALOG_UI = {
  overlay: 'bg-[rgb(36_35_33/0.4)]',
  content:
    'w-[480px] max-w-[calc(100vw-2rem)] divide-(--app-border) rounded-[14px] border border-(--app-border) bg-(--app-surface) shadow-2 ring-0 max-md:top-auto max-md:bottom-0 max-md:left-0 max-md:w-full max-md:max-w-full max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-b-none max-md:border-x-0 max-md:border-b-0',
  header: 'min-h-0 border-0 px-5 pt-5 pb-1',
  title: 'font-display text-base/[22px] font-semibold tracking-[-0.01em]',
  description: 'sr-only',
  body: 'px-5 pt-3 pb-5 sm:px-5 sm:pt-3 sm:pb-5',
  footer: 'justify-end gap-2 px-5 py-3.5 sm:px-5 max-md:pb-5',
}
