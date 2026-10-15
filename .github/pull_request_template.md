<!-- Titolo della PR: Conventional Commit, per esempio "feat(identity): accesso con passkey" -->

**Prima:** <!-- cosa succedeva prima, visto da chi usa il pannello o da chi sviluppa -->

**Dopo:** <!-- cosa succede ora -->

**Come:** <!-- in poche righe: l'approccio e le scelte non ovvie -->

**Come provarlo:**
1. <!-- passi concreti, con dati di esempio -->

**Riferimenti:** task <!-- piano tappa NN, Task N --> · specifica <!-- §x.y --> · Closes #<!-- issue -->

**Controlli**
- [ ] Test scritti prima del codice, verdi
- [ ] `pnpm verify` verde in locale
- [ ] Isolamento tra agenzie: rotte e lavori nuovi nella batteria di test
- [ ] Schermate: vuoto, caricamento, errore, successo; telefono; axe
- [ ] Migrazioni rilette e compatibili con la versione precedente
- [ ] Documentazione aggiornata (specifica, ADR, runbook) se serve

**Note per chi rivede:** <!-- dove guardare con più attenzione -->
