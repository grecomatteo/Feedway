# Finto Bot API di Telegram (`@app/telegram-mock`)

Server HTTP locale che risponde come la Bot API di Telegram (piano della tappa 8, Task 7). Lo usano i test d'integrazione, gli E2E e lo sviluppo con `TELEGRAM_API_URL`. Nessun test o script parla con Telegram vero (`AGENTS.md`).

```ts
import { TELEGRAM_MOCK, startTelegramMock } from '@app/telegram-mock'

const mock = await startTelegramMock() // porta libera; { port } per fissarla
mock.userWrites(TELEGRAM_MOCK.bots.platform.token, { chatId: 42, text: '/start codice' })
mock.sent() // messaggi mandati con sendMessage
mock.block(42) // la persona ha bloccato il bot: sendMessage risponde 403
mock.reset()
await mock.stop()
```

In sviluppo: `pnpm --filter @app/telegram-mock start` (porta `TELEGRAM_MOCK_PORT`, 4020 di default) e `TELEGRAM_API_URL=http://127.0.0.1:4020`.

## Cosa risponde

- `POST|GET <url>/bot<token>/<metodo>`, parametri dall'indirizzo, da un modulo o da un corpo JSON, risposte `{ ok, result }` o `{ ok: false, error_code, description, parameters }` come Telegram.
- `getMe`; `getUpdates` con `offset` (gli aggiornamenti prima sono confermati e dimenticati), `limit` e `timeout` (long polling fino a 50 s, risponde appena qualcuno scrive); `setMyCommands` (tiene il menu di ogni bot, letto con `commands()`; nomi fuori da `a-z0-9_` o descrizioni vuote: 400); `sendMessage` (testo vuoto o oltre 4096 caratteri visibili: 400; con `parse_mode: HTML` controlla i tag e le entità come Telegram, più severo sul `&` non scritto `&amp;`: «can't parse entities», 400).
- Errori: token sconosciuto o revocato (`revoke`) 401, chat bloccata (`block`) 403, `rateLimit({ retryAfter, times, method })` 429 con `retry_after`, `unavailable({ times, method })` 502.
- `calls()` nomina il bot, mai il token.

Bot iniziali in `TELEGRAM_MOCK.bots`: `platform` (`@feedway_mock_bot`) e `agency` (`@agenzia_mock_bot`), con token finti; più `moreAgencyBot(0…7)` (`@agenzia_N_mock_bot`), per i test che girano insieme, ognuno con un'agenzia sua (un bot serve un'agenzia sola). Scritto a mano dalla documentazione della Bot API: **non confrontato** con risposte vere.
