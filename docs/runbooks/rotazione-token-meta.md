# Sostituire il token dell'utente di sistema e il secret dell'app Meta

Questo runbook serve all'Owner e agli Admin dell'agenzia: il token lo sostituiscono entrambi, l'App Secret solo l'Owner. Spiega come cambiare le due credenziali che Feedway usa per parlare con Meta, senza fermare le pubblicazioni:

- il **token dell'utente di sistema**, che sta sul collegamento (Account social);
- l'**App Secret** dell'app Meta, che sta nell'integrazione (Impostazioni → Integrazioni → Meta).

Feedway non mostra mai il token né il secret salvati: per cambiarli se ne incolla uno nuovo, che Feedway verifica con Meta **prima** di salvarlo. Finché la verifica non riesce resta valido quello di prima.

Il token e il secret si incollano **solo nel pannello**. Mai in una chat, un'email, un ticket o un file, nemmeno per pochi minuti.

## Quando farlo

| Motivo | Cosa cambiare | Quanto in fretta |
|---|---|---|
| Il token è comparso dove non doveva (screenshot, chat, log, un file condiviso) | il token | subito |
| Il secret è comparso dove non doveva | il secret, poi controlla i collegamenti | subito |
| Una persona che conosceva il secret lascia l'agenzia | il secret | appena puoi |
| Feedway dice «Manca un permesso Meta» | il token, con tutti i permessi | appena puoi |
| Gli account del collegamento sono «Da ricollegare» | il token | appena puoi: i suoi account non pubblicano |
| Controllo periodico | il token | se vuoi, per esempio una volta l'anno |

Il token dell'utente di sistema **non scade** (verificato il 2026-11-11): Feedway non lo rinnova e non serve sostituirlo a una data fissa.

## Sostituire il token dell'utente di sistema

1. Nel Business Manager dell'agenzia: **Impostazioni del business → Utenti → Utenti di sistema** → l'utente di sistema di Feedway → **«Genera token»**.
2. Scegli l'app Meta di Feedway, la scadenza **«Mai»** e i sei permessi: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic`, `instagram_content_publish`, `business_management`.
3. Nel pannello: **Account social** → nel riquadro Collegamenti, sull'utente di sistema, premi **«Sostituisci token»** (oppure **«Ricollega»** se il collegamento è rosso). Conferma la password se te la chiede, incolla il token e premi **«Verifica e salva»**.
4. Il risultato:
   - «Token sostituito: il collegamento funziona di nuovo»: fatto. Gli account restano quelli di prima, con i clienti a cui sono assegnati.
   - «Meta ha accettato il token, ma mancano dei permessi»: non è stato salvato niente. Rigenera il token spuntando quelli in rosso.
   - «Token salvato: è un nuovo collegamento, con un altro utente di sistema»: hai generato il token da un **altro** utente di sistema. Il vecchio collegamento resta com'era. Se non era quello che volevi, rigenera il token dall'utente di sistema giusto.
5. Premi **Sincronizza** sul collegamento: dopo qualche minuto gli account devono essere «Attivo».
6. **Revoca il token vecchio** su Meta, dalla stessa pagina dell'utente di sistema. Generare un token nuovo **non** revoca quello vecchio: se il vecchio è finito dove non doveva, è questo il passo che lo rende inutile.
7. Dopo 5 minuti (Sincronizza si può premere una volta ogni 5 minuti) premi di nuovo **Sincronizza**: il collegamento deve restare «funziona». Se diventa «token scaduto: va ricollegato», hai revocato il token nuovo invece del vecchio: torna al passo 1 e usa «Ricollega».

**Non verificato:**
- che generare un token nuovo lasci valido quello vecchio fino alla revoca;
- il nome esatto del comando per revocare un token dell'utente di sistema;
- il sottocodice che Meta dà a un token revocato. Feedway lo tratta come «Il token del collegamento non vale più».

Si provano con il Task 13 del piano 03.

Il registro attività segna «ha sostituito il token di un collegamento», senza il token.

## Sostituire l'App Secret

Il secret firma ogni chiamata di Feedway (`appsecret_proof`). Tra il momento in cui lo cambi su Meta e quello in cui lo salvi in Feedway, **le chiamate a Meta falliscono**: il controllo notturno, le sincronizzazioni e, dalla tappa 7, le pubblicazioni. Fai i due passi uno dopo l'altro, fuori dagli orari di pubblicazione.

1. Apri due schede: il pannello su **Impostazioni → Integrazioni → Meta**, e developers.facebook.com → l'app → **Impostazioni → Di base**.
2. Su Meta, accanto ad App Secret, premi **«Reimposta»** e conferma. Copia il secret nuovo.
3. Nel pannello scrivi il secret nuovo nel campo App Secret, lascia il resto com'è e premi **«Salva e verifica»**. Conferma la password se te la chiede. Feedway salva solo se Meta accetta il secret: se risponde «Meta non accetta questo App ID con questo App Secret», ricopialo (spesso è uno spazio in più).
4. Premi **Prova**: deve dire «Funziona».
5. In **Account social** premi **Sincronizza** su ogni collegamento e controlla che gli account tornino «Attivo».

Se al passo 5 un collegamento diventa «token scaduto: va ricollegato», il token non vale più con il secret nuovo: sostituiscilo come sopra, con «Ricollega».

**Non verificato:** se Meta invalida subito il secret vecchio, e se i token degli utenti di sistema restano validi dopo la reimpostazione del secret. Il passo 5 serve a scoprirlo.

Il registro attività segna «ha cambiato l'integrazione Meta», senza il secret.

## Se il secret o il token sono stati esposti

1. Sostituisci subito quello che è stato esposto, come sopra, e revoca il token vecchio.
2. Nel Business Manager controlla in **Utenti di sistema** che non ci siano utenti di sistema che non conosci, e che quello di Feedway abbia solo le risorse che gli hai assegnato.
3. Controlla il registro attività di Feedway per modifiche all'integrazione o ai collegamenti che non hai fatto tu.
4. Se pensi che qualcuno abbia usato le credenziali, segui [violazione-dati.md](violazione-dati.md).

## Vedi anche
- [meta-collegamento-account.md](meta-collegamento-account.md): preparare l'app e collegare gli account.
- [`docs/platforms/meta.md`](../platforms/meta.md): cosa è stato verificato su Meta vera e quando.
