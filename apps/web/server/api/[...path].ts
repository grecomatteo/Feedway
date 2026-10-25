// Any API path without a route: a JSON 404 at once, instead of rendering the whole app first.
export default defineEventHandler((event) => sendApiError(event, new HttpProblem('NOT_FOUND')))
