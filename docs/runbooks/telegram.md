# Telegram: creare il bot con @BotFather

Feedway manda le notifiche su Telegram e risponde a `/oggi` e `/problemi` con **un bot**. Il bot della piattaforma vale per tutte le agenzie; un'agenzia può mettere un bot suo, e allora i suoi membri si collegano a quello (piano della tappa 8, Scelta 8).

Il token del bot è un segreto: chi lo ha manda messaggi a nome del bot e legge quello che le persone gli scrivono. **Si incolla solo nel pannello**, mai in una chat, in un'email o in un file. Feedway lo salva cifrato e non lo mostra più.

## 1. Creare il bot

1. Su Telegram apri **@BotFather** (quello con la spunta blu) e scrivi `/newbot`.
2. Scrivi il nome che le persone vedono, per esempio `Feedway`.
3. Scrivi il nome utente: unico su Telegram, finisce con `bot`, per esempio `feedway_notifiche_bot`.
4. @BotFather risponde con il **token**, della forma `123456789:AA…`. Copialo.
5. Facoltativo: `/setdescription` e `/setuserpic` per la descrizione e la foto del bot; `/setcommands` con
   ```
   oggi - I post di oggi
   problemi - Cosa c'è da sistemare
   stop - Smetti di ricevere le notifiche qui
   ```

## 2. Il bot della piattaforma

Da amministratore della piattaforma: menu in basso a sinistra → **Integrazioni della piattaforma** (`/piattaforma/integrazioni`) → **Bot Telegram**.

1. Incolla il token in «Token del bot» e premi **Prova e salva**.
2. Conferma la password se te la chiede (la conferma vale 10 minuti).
3. Feedway prova il token con Telegram (`getMe`): se Telegram lo accetta, la pagina mostra `@nome_del_bot` e «Attivo». Se no, dice «Telegram non accetta questo token» e non salva niente.

Per cambiarlo: **Sostituisci token**. Per toglierlo: **Togli il bot** (chi non ha un bot della sua agenzia non riceve più niente su Telegram).

## 3. Il bot di un'agenzia (facoltativo)

Da Owner dell'agenzia: **Impostazioni → Integrazioni → Bot Telegram**, stessi passi. L'Admin vede il bot ma non lo cambia. Dopo il salvataggio ogni membro collega di nuovo Telegram in «Profilo e preferenze», perché un bot nuovo non conosce le chat del vecchio. **Torna al bot della piattaforma** toglie il bot dell'agenzia.

Ogni bot serve un posto solo: il bot della piattaforma non si usa anche per un'agenzia, né lo stesso bot per due agenzie. Il pannello rifiuta il token con «Questo bot è già usato altrove»: crea un altro bot con @BotFather.

## Se il token smette di funzionare

Se qualcuno revoca il token con @BotFather (`/revoke`), Telegram lo rifiuta: la pagina del bot lo dice in rosso. Fatti dare un token nuovo da @BotFather (`/token`) e incollalo con **Sostituisci token**. Il bot resta lo stesso: quando arriverà il collegamento delle persone (seconda parte del lavoro), chi era collegato resterà collegato.

## Rete

Il worker esce verso `api.telegram.org` (rete `egress` del compose): nessuna porta da aprire, nessun webhook. `TELEGRAM_API_URL` **non va messa** sulla VPS: serve solo in sviluppo e nei test, per il finto Bot API (`tools/telegram-mock`).
