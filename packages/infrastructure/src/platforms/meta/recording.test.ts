import { expect, test } from 'vitest'
import { createRecordingRedactor } from './recording.js'

test('a recorded answer loses tokens, signed image parameters, ids and names', () => {
  const redact = createRecordingRedactor()
  const answer = {
    data: [
      {
        id: '112233445566',
        name: 'Forno Luce',
        access_token: 'EAAGreal-page-token',
        picture: {
          data: { url: 'https://scontent.xx.fbcdn.net/p.jpg?_nc_cat=1&oh=00_abc&oe=6A00' },
        },
        instagram_business_account: { id: '178414', username: 'fornoluce' },
      },
    ],
    paging: {
      next: 'https://graph.facebook.com/v25.0/me/accounts?access_token=EAAGreal&after=QVFI',
    },
    granular_scopes: [{ scope: 'instagram_basic', target_ids: ['178414'] }],
    client_business_id: '998877',
  }
  const text = JSON.stringify(redact(answer))

  for (const real of [
    '112233445566',
    'Forno Luce',
    'EAAGreal',
    '00_abc',
    '6A00',
    '178414',
    'fornoluce',
    '998877',
  ])
    expect(text).not.toContain(real)
  expect(text).toContain('_nc_cat=1')
  expect(text).toContain('after=QVFI')

  // the same real id gives the same fake id, so references between answers still match
  const again = redact({ id: '178414' }) as { id: string }
  const first = redact(answer) as { granular_scopes: { target_ids: string[] }[] }
  expect(first.granular_scopes[0]?.target_ids[0]).toBe(again.id)
})
