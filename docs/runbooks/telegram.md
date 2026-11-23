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

## 4. Collegare il proprio Telegram

Ognuno, da **Profilo e preferenze** → **Telegram**: una riga per ogni bot che gli scrive (quello della piattaforma per le agenzie senza un bot proprio, e quello di ogni agenzia che ne ha uno).

1. **Collega Telegram**, poi **Apri Telegram**: si apre la chat del bot.
2. Premi **Avvia** entro 15 minuti. Il bot risponde «Collegato» e la riga nel pannello diventa verde da sola, entro un minuto.
3. Da lì: `/oggi` (i post di oggi), `/problemi` (cosa c'è da sistemare), `/stop` (scollega). Si scollega anche da **Scollega** nel pannello.

Un link vale una volta sola. Se un'altra persona preme **Avvia** dalla stessa chat Telegram, il collegamento passa a lei. Se qualcuno blocca il bot su Telegram, Feedway lo scollega alla prima notifica che non arriva.

Il bot risponde solo nelle chat private, entro circa un minuto: il worker legge i messaggi in long polling, senza indirizzi da aprire.

## Se il token smette di funzionare

Se qualcuno revoca il token con @BotFather (`/revoke`), Telegram lo rifiuta: la pagina del bot lo dice in rosso. Fatti dare un token nuovo da @BotFather (`/token`) e incollalo con **Sostituisci token**. Se il bot resta lo stesso, chi era collegato resta collegato. Se metti il token di un altro bot, i collegamenti del bot di prima si tolgono da soli entro un minuto e ognuno collega di nuovo Telegram. Finché il token è rifiutato, il worker non chiede più niente a quel bot.

## Rete

Il worker esce verso `api.telegram.org` (rete `egress` del compose): nessuna porta da aprire, nessun webhook. `TELEGRAM_API_URL` **non va messa** sulla VPS: serve solo in sviluppo e nei test, per il finto Bot API (`tools/telegram-mock`).
