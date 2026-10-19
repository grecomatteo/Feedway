import { activateAccount } from '@app/application'
import { z } from 'zod'

const Body = z.object({
  name: z.string().max(400),
  nickname: z.string().max(400).nullable().default(null),
  password: z.string().max(1024).nullable(),
})

export default defineEventHandler(async (event) => {
  const limited = await limitLinkRoutes(event)
  if (limited) return limited
  const body = Body.safeParse(await readBody(event).catch(() => null))
  if (!body.success) return linkError(event, 422, 'VALIDATION', 'Richiesta non valida.')
  try {
    const result = await activateAccount(identityDeps(useDeps()), {
      token: getRouterParam(event, 'token') ?? '',
      ...body.data,
      ip: getRequestHeader(event, 'x-app-client-ip') ?? null,
      userAgent: getRequestHeader(event, 'user-agent') ?? null,
      sessionUserId: await sessionUserId(event),
    })
    for (const cookie of result.setCookie) appendResponseHeader(event, 'set-cookie', cookie)
    return { organizationSlug: result.organizationSlug, next: result.next }
  } catch (error) {
    return linkDomainError(event, error)
  }
})
