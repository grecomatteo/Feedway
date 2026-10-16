export default defineEventHandler((event) => {
  if (useDeps().config.panelUrl.protocol === 'https:') {
    setResponseHeader(event, 'strict-transport-security', 'max-age=31536000; includeSubDomains')
  }
})
