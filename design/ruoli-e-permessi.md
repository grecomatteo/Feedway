# Ruoli, permessi, attività e note

Riassunto in parole semplici della specifica approvata (`docs/superpowers/specs/2026-10-15-feedway-design.md` §10 e §18.4), con le proposte emerse dalla revisione del 16 ottobre 2026. Dove questo file e la specifica non coincidono, vale la specifica finché Matteo non decide.

## Due livelli di ruolo

**Nell'agenzia**: chi può gestire l'agenzia nel suo insieme.

| Ruolo | Cosa fa |
|---|---|
| Owner | Il titolare. Vede e gestisce tutto, nomina gli Admin. Uno per agenzia, nessuno può declassarlo. |
| Admin | Gestisce persone, clienti, account social e integrazioni. Le impostazioni dell'agenzia le vede in sola lettura. |
| Member | Tutti gli altri: vedono solo i clienti in cui hanno un ruolo. |

**In ogni cliente**: cosa può fare una persona su quel cliente. La stessa persona può essere Manager di un cliente ed Editor di un altro.

| Ruolo | Cosa fa |
|---|---|
| Manager | Responsabile del cliente: programma, modifica e annulla anche i post degli altri, gestisce il team del cliente, crea i link cliente. |
| Publisher | Crea e programma i propri post; riprova solo le proprie pubblicazioni fallite. |
| Editor | Carica media e prepara bozze. Non programma: lo fa un Manager o un Publisher. |
| Viewer | Consulta calendario e storico. Non carica e non modifica. |

## Chi può fare cosa

| Permesso | Owner | Admin | Manager | Publisher | Editor | Viewer |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Vedere calendario e post del cliente | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Caricare media e usare la libreria | ✓ | ✓ | ✓ | ✓ | ✓ | |
| Creare bozze e note sui post | ✓ | ✓ | ✓ | ✓ | ✓ | |
| Programmare e pubblicare, anche in blocco | ✓ | ✓ | ✓ | ✓ | | |
| Modificare o annullare post di altri | ✓ | ✓ | ✓ | | | |
| Riprovare pubblicazioni fallite | ✓ | ✓ | ✓ | solo propri | | |
| Etichette, modelli, fasce orarie, gruppi di account | ✓ | ✓ | ✓ | | | |
| Gestire il team del cliente e invitare | ✓ | ✓ | ruoli inferiori | | | |
| Creare e revocare link cliente | ✓ | ✓ | ✓ | | | |
| Registro attività del cliente | ✓ | ✓ | ✓ | | | |
| Creare clienti, aggiungere account Meta | ✓ | ✓ | | | | |
| Impostazioni, brand e integrazioni dell'agenzia | ✓ | sola lettura | | | | |

Ruoli personalizzati dall'interfaccia: esclusi dalla 1.0, ma il modello dei permessi li rende possibili in futuro.

## Note

- **Nella 1.0**: note interne sul post, visibili a chi lavora su quel cliente, mai al cliente.
- **Proposta**: aggiungere alla nota la scelta «solo per me» oppure «per il team del cliente». È una piccola estensione della tabella `post_notes` (campo di visibilità) e la mostra già il prototipo. Da confermare.
- **Versione 1.5**: note e scheda del cliente (brief, contatti, tono di voce, linee guida, hashtag e orari preferiti), con cronologia.

## Attività e to-do (versione 1.5)

- To-do personale (solo tuo), attività dell'agenzia, attività di un cliente (visibili a chi lavora su quel cliente).
- Titolo, descrizione, scadenza, priorità, stato, sotto-attività, commenti, collegamento a un post o a un account.
- **Chi può assegnare** è un'impostazione dell'agenzia: tutti, solo a chi lavora sugli stessi clienti (predefinito), oppure solo da Manager in su. Owner e Admin assegnano sempre.
- Viste «Le mie attività», per cliente e per persona; scadenze visibili nel calendario; notifiche su pannello, email e Telegram.

**Decisione aperta per Matteo**: tenere attività e note personali nella 1.5 (consigliato: la 1.0 si concentra sul pubblicare in modo affidabile, e l'interfaccia ha già il posto pronto) oppure anticiparle nella 1.0.

## Nel prototipo

`/demo/team` mostra ruoli, persone di esempio e la matrice, con le righe 1.5 segnate. Nel dettaglio di un post ci sono le note «solo per me» / «per il team»: la nota personale di un'altra persona non compare. Il selettore «Ruolo» nella barra della demo cambia ciò che si può fare.
