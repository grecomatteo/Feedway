# Revisione UI — tappa 3, Task 12 (account social)

## Sessione

- Data: 12 novembre 2026. Revisione secondo `design/brief-feedway/06-PROMPT-REVISIONE.md` delle schermate nuove del Task 12 (PR #163–#166).
- Schermate: Account social, Aggiungi account, Prima configurazione (passo 1), Spazio → Account, selettore del contesto con i profili.
- Prove nel browser: build di produzione dell'app con `tools/meta-mock`, Playwright Chromium, 1280×720 chiaro e 390×844 scuro, ciascuna anche con zoom 200 %, focus da tastiera, nome di cliente lungo («Panificio Forno Luce di Via Garibaldi e Figli»).
- **Pencil non era disponibile** in questa sessione: nessuna osservazione sulla tela, nessun aggiornamento a `design/feedway-ui.pen`. La revisione separa quindi solo prove nel browser e controlli del codice.

## Prove nel browser

| ID | Dove | Osservazione | Esito |
|---|---|---|---|
| R1 | Spazio → Account | A 390 e a 200 % il nome lungo va a capo senza tagli; le righe account restano leggibili, «Togli» resta a destra con area ≥ 44 px | Va bene |
| R2 | Spazio → Account | Il pulsante disattivato «Scegli gli account da aggiungere» ha contrasto basso nel tema chiaro | Accettato: è un controllo disattivato (WCAG 1.4.3 lo esclude) e il testo dice cosa fare |
| R3 | Selettore del contesto | La voce «Profilo …» è rientrata sotto il cliente; l'etichetta chiusa tronca con i puntini e il nome intero resta nel menu | Va bene |
| R4 | Selettore del contesto | Nelle catture il menu appare semitrasparente | Non è un difetto: la cattura è stata presa durante l'animazione d'apertura di Nuxt UI |
| R5 | Prima configurazione | A 390 con zoom 200 % i cinque passi vanno su più righe senza sovrapporsi; stato «fatto» con icona e testo nascosto per i lettori di schermo | Va bene |
| R6 | Aggiungi account | Le tre risposte e i passi restano leggibili a 390; gli account già importati mostrano il motivo invece della casella | Va bene |
| R7 | Tutte | Il focus da tastiera è visibile (anello attorno al controllo) in chiaro e in scuro | Va bene |
| R8 | Barra in basso (telefono) | Spazio vuoto tra «Clienti» e «Utenti» | Fuori dal Task 12: è la barra esistente, da guardare nella revisione della navigazione |

## Controlli del codice

- axe (WCAG 2.2 AA) senza violazioni in tutte le E2E delle schermate nuove.
- Ogni cambio di passo nella prima configurazione porta il focus al titolo del passo.
- I nomi dei pulsanti «Togli» e «Account» dicono di quale account o cliente si tratta.

## Prossime azioni

- Nessun difetto da correggere nel Task 12.
- R8 alla prossima revisione della navigazione su telefono.
- Da verificare su Meta vera: le voci di menu citate nelle guide (Utenti di sistema, Assegna risorse, Partner) e il percorso `business.facebook.com/settings/system-users`.
