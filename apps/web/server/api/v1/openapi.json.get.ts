import { openApiDocument, openApiRoute } from '@app/contracts'

const document = openApiDocument()

export default defineApiRoute(openApiRoute, () => document)
