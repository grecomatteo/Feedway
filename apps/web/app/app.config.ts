export default defineAppConfig({
  ui: {
    colors: { primary: 'brand', neutral: 'stone' },
    button: {
      compoundVariants: [
        // charcoal label on the orange brand colour, in both themes (DESIGN.md)
        { color: 'primary', variant: 'solid', class: 'text-(--app-on-brand)' },
      ],
    },
  },
})
