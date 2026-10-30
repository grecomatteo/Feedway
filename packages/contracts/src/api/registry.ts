import { z } from 'zod'
import { ApiErrorBody, defineContract, type ApiContract } from './define.js'
import { auditRoutes } from './audit.js'
import { authRoutes } from './auth.js'
import { linkRoutes } from './links.js'
import { meRoutes } from './me.js'
import { organizationRoutes } from './organizations.js'
import { platformRoutes } from './platform.js'
import { userRoutes } from './users.js'
import { workspaceRoutes } from './workspaces.js'

/**
 * Who may read it: any signed-in person. The contract holds no secrets, but the code is
 * private and the list of routes is a map an anonymous visitor has no use for.
 */
export const openApiRoute = defineContract({
  method: 'GET',
  path: '/api/v1/openapi.json',
  summary: 'Il documento OpenAPI di queste API',
  request: {},
  response: z.record(z.string(), z.unknown()),
  auth: 'session',
  scope: 'public',
})

/** Every route of `/api/v1`. A route file without a contract here fails the OpenAPI test. */
export const apiRoutes: readonly ApiContract[] = [
  ...linkRoutes,
  ...authRoutes,
  ...meRoutes,
  ...organizationRoutes,
  ...userRoutes,
  ...workspaceRoutes,
  ...auditRoutes,
  ...platformRoutes,
  openApiRoute,
]

type JsonSchema = Record<string, unknown>

export interface OpenApiParameter {
  name: string
  in: 'path' | 'query' | 'header'
  required: boolean
  schema: JsonSchema
  description?: string
}

export interface OpenApiOperation {
  operationId: string
  summary: string
  parameters?: OpenApiParameter[]
  requestBody?: { required: true; content: { 'application/json': { schema: JsonSchema } } }
  responses: Record<string, unknown>
  security: Record<string, string[]>[]
}

export interface OpenApiDocument {
  openapi: '3.1.0'
  info: { title: string; version: string }
  paths: Record<string, Record<string, OpenApiOperation>>
  components: {
    schemas: Record<string, JsonSchema>
    responses: Record<string, unknown>
    securitySchemes: Record<string, unknown>
  }
}

function jsonSchema(schema: z.ZodType, io: 'input' | 'output'): JsonSchema {
  const generated = z.toJSONSchema(schema, { io }) as JsonSchema
  // the document declares its dialect once (OpenAPI 3.1 is JSON Schema 2020-12)
  delete generated['$schema']
  return generated
}

function parametersOf(schema: z.ZodType | undefined, where: 'path' | 'query'): OpenApiParameter[] {
  if (!(schema instanceof z.ZodObject)) return []
  return Object.entries(schema.shape as Record<string, z.ZodType>).map(([name, field]) => ({
    name,
    in: where,
    required: where === 'path' || !field.safeParse(undefined).success,
    schema: jsonSchema(field, 'input'),
  }))
}

const operationId = (route: ApiContract) =>
  [route.method.toLowerCase(), ...route.path.replace('/api/v1/', '').split(/[/.{}-]+/)]
    .filter(Boolean)
    .join('_')

function operation(route: ApiContract): OpenApiOperation {
  const parameters = [
    ...parametersOf(route.request.params, 'path'),
    ...parametersOf(route.request.query, 'query'),
    ...(route.method === 'GET'
      ? []
      : [
          {
            name: 'X-App-Request',
            in: 'header' as const,
            required: true,
            schema: { const: '1' },
            description: 'Obbligatoria su ogni richiesta che modifica, con Origin del pannello',
          },
        ]),
  ]
  return {
    operationId: operationId(route),
    summary: route.summary,
    ...(parameters.length > 0 && { parameters }),
    ...(route.request.body && {
      requestBody: {
        required: true as const,
        content: { 'application/json': { schema: jsonSchema(route.request.body, 'input') } },
      },
    }),
    responses: {
      '200': {
        description: 'OK',
        content: { 'application/json': { schema: jsonSchema(route.response, 'output') } },
      },
      default: { $ref: '#/components/responses/Error' },
    },
    security: route.auth === 'public' ? [] : [{ session: [] }],
  }
}

/** Generated from the contracts: what a client may rely on, and nothing about the server. */
export function openApiDocument(routes: readonly ApiContract[] = apiRoutes): OpenApiDocument {
  const paths: OpenApiDocument['paths'] = {}
  for (const route of routes)
    (paths[route.path] ??= {})[route.method.toLowerCase()] = operation(route)
  return {
    openapi: '3.1.0',
    // the contract version, not the app version: a version number only helps an attacker
    info: { title: 'Feedway API', version: '1' },
    paths,
    components: {
      schemas: { ApiErrorBody: jsonSchema(ApiErrorBody, 'output') },
      responses: {
        Error: {
          description: 'Errore, con un messaggio in italiano e l’ID della richiesta',
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/ApiErrorBody' } },
          },
        },
      },
      securitySchemes: {
        session: { type: 'apiKey', in: 'cookie', name: '__Host-session' },
      },
    },
  }
}
