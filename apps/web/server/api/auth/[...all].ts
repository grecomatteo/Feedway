export default defineEventHandler((event) => useDeps().auth.handler(toWebRequest(event)))
