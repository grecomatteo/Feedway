// Sizes of the new direction (D-81): every control as tall as `--spacing-control` (36 on a
// computer, 44 on a phone), the small button 30. The sizes a page already asks for (md, lg, xl)
// all land on the same height, so the panel has one control size and the small one.
// min-height, so a label that wraps on a narrow phone still fits
const control = 'min-h-control py-1 px-3.5 text-body gap-2'
const field = 'h-control py-0 px-2.5 text-body gap-2 max-md:text-base'
const fieldSizes = { md: { base: field }, lg: { base: field }, xl: { base: field } }

export default defineAppConfig({
  ui: {
    colors: { primary: 'brand', neutral: 'stone' },
    button: {
      slots: { base: 'rounded-control font-semibold' },
      variants: {
        size: {
          sm: { base: 'min-h-control-sm py-1 px-2.5 text-detail gap-1.5' },
          md: { base: control },
          lg: { base: control },
          xl: { base: control },
        },
      },
      compoundVariants: [
        // a button with only its icon is a square as tall as the others
        ...(['md', 'lg', 'xl'] as const).map((size) => ({
          size,
          square: true,
          class: 'w-control justify-center p-0',
        })),
        { size: 'sm' as const, square: true, class: 'w-control-sm justify-center p-0' },
        // the palette's label on its accent, and a hover that keeps 4.5:1 (DESIGN.md)
        {
          color: 'primary',
          variant: 'solid',
          class: 'text-(--app-on-brand) hover:bg-(--app-brand-hover) active:bg-(--app-brand-hover)',
        },
        // the plain button: a white surface with a quiet outline and the first shadow
        {
          color: 'neutral',
          variant: 'outline',
          class:
            'bg-(--app-surface) ring-(--app-border-strong) shadow-1 hover:bg-(--app-surface-sunken) active:bg-(--app-surface-sunken)',
        },
        {
          color: 'neutral',
          variant: 'ghost',
          class: 'font-medium hover:bg-(--app-nav-hover) active:bg-(--app-nav-hover)',
        },
      ],
    },
    input: { slots: { base: 'rounded-control' }, variants: { size: fieldSizes } },
    select: { slots: { base: 'rounded-control' }, variants: { size: fieldSizes } },
    selectMenu: { slots: { base: 'rounded-control' }, variants: { size: fieldSizes } },
    inputMenu: { slots: { base: 'rounded-control' }, variants: { size: fieldSizes } },
    // ticks, radios and switches in charcoal, never in the accent (D-81)
    checkbox: { defaultVariants: { color: 'neutral' } },
    checkboxGroup: { defaultVariants: { color: 'neutral' } },
    radioGroup: { defaultVariants: { color: 'neutral' } },
    switch: {
      slots: { base: 'data-[state=unchecked]:bg-(--app-field-border)' },
      defaultVariants: { color: 'neutral' },
    },
  },
})
