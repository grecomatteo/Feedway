# Registro dei trattamenti

Modello del registro delle attività di trattamento (art. 30 GDPR) per il pannello Feedway, versione 1.0. Nella 1.0 l'agenzia che installa Feedway è **titolare** dei dati del proprio team (specifica §15.7).

I periodi di conservazione sono quelli che il codice applica (`RETENTION` in `packages/domain/src/identity/privacy.ts`) e che la pagina Privacy del pannello mostra. Se cambi uno, cambia anche l'altro.

> **Da completare a cura dell'agenzia** (Matteo): i campi segnati con ✎.

## Dati del titolare

| Campo | Valore |
|---|---|
| Titolare ✎ | Ragione sociale, sede, partita IVA |
| Contatto per la privacy ✎ | Lo stesso indicato in Impostazioni → Informativa privacy |
| Responsabile della protezione dei dati ✎ | Se nominato; altrimenti «non nominato» |
| Data dell'ultimo aggiornamento ✎ | |

## Trattamenti

### 1. Account del team

| | |
|---|---|
| Finalità | Dare accesso al pannello alle persone dell'agenzia, con il ruolo giusto per ogni cliente |
| Base giuridica | Contratto di lavoro o di collaborazione (art. 6.1.b); legittimo interesse a un accesso controllato (art. 6.1.f) |
| Interessati | Owner, Admin, Member dell'agenzia |
| Dati | Nome, soprannome, email, ruolo nell'agenzia e nei clienti, fuso orario, tema scelto |
| Conservazione | Finché l'account è attivo. Eliminato dalla persona («Elimina il mio account»): anonimizzato subito. Disattivato dalla piattaforma: anonimizzato dopo 24 mesi, con avviso agli Owner 30 giorni prima |
| Destinatari | Fornitore della VPS (responsabile, art. 28) ✎ |

### 2. Accesso e sessioni

| | |
|---|---|
| Finalità | Autenticare le persone e tenere il pannello sicuro |
| Base giuridica | Legittimo interesse alla sicurezza (art. 6.1.f; art. 32) |
| Dati | Password (solo l'impronta Argon2id), passkey (chiave pubblica), segreto TOTP cifrato, codici di riserva (impronte), sessioni con IP e browser |
| Conservazione | Sessioni: cancellate 30 giorni dopo la scadenza (scadono dopo 12 ore senza uso e al più dopo 30 giorni). Valori di verifica (link, codici): cancellati alla scadenza |
| Destinatari | Fornitore della VPS ✎; fornitore email per gli avvisi di sicurezza (dalla tappa 3) ✎ |

### 3. Dispositivi noti (cookie `__Host-device`)

| | |
|---|---|
| Finalità | Avvisare la persona di un accesso da un dispositivo nuovo |
| Base giuridica | Legittimo interesse alla sicurezza (art. 6.1.f); cookie tecnico (art. 122 Codice privacy) |
| Dati | Identificativo casuale del dispositivo (nessun dato personale nel cookie), browser e sistema, data dell'ultimo uso |
| Conservazione | Cookie: 400 giorni. Dispositivo in archivio: cancellato dopo 12 mesi senza uso |

### 4. Foto profilo

| | |
|---|---|
| Finalità | Riconoscere le persone nel pannello |
| Base giuridica | Consenso (art. 6.1.a): la foto è facoltativa e si toglie in ogni momento |
| Dati | Immagine ritagliata, senza metadati (posizione e fotocamera tolte al caricamento) |
| Conservazione | Finché la persona non la toglie. Foto caricate e non ritagliate: cancellate dopo 1 ora |
| Chi la vede | Solo le persone delle agenzie della persona |

### 5. Registro attività

| | |
|---|---|
| Finalità | Sapere chi ha fatto cosa e quando; ricostruire un incidente |
| Base giuridica | Legittimo interesse alla sicurezza e alla responsabilità (art. 6.1.f; art. 5.2) |
| Dati | Autore, azione, oggetto, data, indirizzo IP. Mai password, token o testi completi |
| Conservazione | Voci: 24 mesi, poi riassunte (specifica §15.7; **non ancora applicato**: oggi restano per la vita dell'agenzia). IP: abbreviati dopo 90 giorni (ultimo blocco azzerato). Una persona anonimizzata resta come «Utente rimosso» |

### 6. «Scarica i miei dati»

| | |
|---|---|
| Finalità | Diritto di accesso e portabilità (artt. 15 e 20) |
| Dati | I dati personali della persona e le sue voci del registro, in un archivio ZIP |
| Conservazione | 24 ore dopo che è pronto, poi cancellato |

### 7. Backup cifrati

| | |
|---|---|
| Finalità | Ripristinare il servizio dopo un guasto |
| Base giuridica | Legittimo interesse alla continuità (art. 6.1.f; art. 32.1.c) |
| Dati | Copia del database e dei file |
| Misure | Cifrati con `age` sulla VPS; la chiave privata non sta sul server ✎ (dove è custodita) |
| Conservazione ✎ | Secondo la rotazione dei backup scelta |
| Destinatari ✎ | Fornitore dello spazio dove finiscono i backup |

## Misure di sicurezza (art. 32)

- Pannello raggiungibile solo dalla rete privata Tailscale, in HTTPS.
- Secondo fattore obbligatorio per Owner e Admin (l'agenzia può chiederlo a tutti); passkey.
- Separazione tra agenzie nel database (row level security su ogni tabella dell'agenzia).
- Token e segreti cifrati con una chiave per agenzia; segreti dell'installazione fuori dal codice.
- Riconferma della password o passkey prima delle azioni delicate; sessioni che scadono.
- Registro attività di ogni azione amministrativa e di sicurezza.
- Procedura per le violazioni: [violazione-dati.md](../runbooks/violazione-dati.md).

## Cookie

Solo cookie tecnici, quindi niente banner. L'elenco con durate e scopi è nella pagina Privacy del pannello, generata dal codice (`PANEL_COOKIES` in `packages/infrastructure/src/auth/cookie-names.ts`).
