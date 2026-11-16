export default defineAppConfig({
  ui: {
    colors: { primary: 'brand', neutral: 'stone' },
    button: {
      compoundVariants: [
        // the palette's label on its accent, and a hover that keeps 4.5:1 (DESIGN.md)
        {
          color: 'primary',
          variant: 'solid',
          class: 'text-(--app-on-brand) hover:bg-(--app-brand-hover) active:bg-(--app-brand-hover)',
        },
      ],
    },
  },
})
