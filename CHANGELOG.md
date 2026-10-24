# Changelog

## [0.2.0](https://github.com/grecomatteo/Feedway/compare/v0.1.2...v0.2.0) (2026-10-24)


### Novità

* **identity:** attivazione da invito ripetibile e primo account ([#53](https://github.com/grecomatteo/Feedway/issues/53)) ([f4857a6](https://github.com/grecomatteo/Feedway/commit/f4857a6b9192c2baab29a9d8ec43d8467a3b7e7d))
* **identity:** Better Auth configurato dietro la porta Auth ([#50](https://github.com/grecomatteo/Feedway/issues/50)) ([1e13fde](https://github.com/grecomatteo/Feedway/commit/1e13fdeccf901a1f64f3ce74891dde12e40fb004))
* **identity:** link del primo account da installazione e aggiornamento ([#54](https://github.com/grecomatteo/Feedway/issues/54)) ([715295a](https://github.com/grecomatteo/Feedway/commit/715295a21f9d2821bcda04297dcabd099f584889))
* **identity:** permessi, ruoli e can() con organizzazioni ([#39](https://github.com/grecomatteo/Feedway/issues/39)) ([7f17c59](https://github.com/grecomatteo/Feedway/commit/7f17c59513b98def73013836d87055383c675b57))
* **identity:** registro degli accessi, dispositivi noti ed email di sicurezza ([#52](https://github.com/grecomatteo/Feedway/issues/52)) ([8370b37](https://github.com/grecomatteo/Feedway/commit/8370b376a7416fafa1d9964bc6a4414e3fcb12f6))
* **identity:** regole del secondo fattore, membri, inviti e reset ([#60](https://github.com/grecomatteo/Feedway/issues/60)) ([f0e0d6f](https://github.com/grecomatteo/Feedway/commit/f0e0d6fe26e3bc75996b54c61ef18372ab2e3ba0))
* **identity:** regole di password, sessioni, secondo fattore, profilo, privacy e limiti ([#40](https://github.com/grecomatteo/Feedway/issues/40)) ([9969802](https://github.com/grecomatteo/Feedway/commit/9969802f19a6c78a9f667131bc23feca95bf8589))
* **identity:** riconferma dell'identità e dispositivi collegati ([#57](https://github.com/grecomatteo/Feedway/issues/57)) ([da59c3a](https://github.com/grecomatteo/Feedway/commit/da59c3a5ddabbeb4fe8e1cdc8dcbaabd8c4ee365))
* **identity:** sessione risolta e secondo fattore obbligatorio ([#55](https://github.com/grecomatteo/Feedway/issues/55)) ([a7d055a](https://github.com/grecomatteo/Feedway/commit/a7d055ae1fee66358925a337d3b21e2c27115006))
* **identity:** tabelle di Better Auth e dati personali ([#41](https://github.com/grecomatteo/Feedway/issues/41)) ([5a34e1d](https://github.com/grecomatteo/Feedway/commit/5a34e1d563477076ea5497498b30db5ea59063af))
* **infra:** chiavi per organizzazione, token firmati, argon2id e robustezza delle password ([#43](https://github.com/grecomatteo/Feedway/issues/43)) ([45cfa0f](https://github.com/grecomatteo/Feedway/commit/45cfa0ff22c29aea4de35b84c90959dfd3035dc1))
* **infra:** limitatore condiviso, ambito delle code e regole su Better Auth ([#45](https://github.com/grecomatteo/Feedway/issues/45)) ([775c9cf](https://github.com/grecomatteo/Feedway/commit/775c9cf265affd4aa63ddba664b17f9b12035b4f))
* **infra:** porta Storage su disco con batteria di contratto ([#47](https://github.com/grecomatteo/Feedway/issues/47)) ([ac415e7](https://github.com/grecomatteo/Feedway/commit/ac415e7a9b60f6bda9fea18549bc60f1ec3e6f12))
* **infra:** radice di composizione condivisa tra web e worker ([#46](https://github.com/grecomatteo/Feedway/issues/46)) ([631667c](https://github.com/grecomatteo/Feedway/commit/631667cbe1c26a145565421fc0d4605d42d3f168))
* **infra:** unit of work con ambito, repository e registro attività ([#44](https://github.com/grecomatteo/Feedway/issues/44)) ([a779279](https://github.com/grecomatteo/Feedway/commit/a779279b9b5ea639f62c0fba2c8cb6bb5198f83b))
* **organizations:** contesto dell'agenzia per chi agisce ([#56](https://github.com/grecomatteo/Feedway/issues/56)) ([f69fb46](https://github.com/grecomatteo/Feedway/commit/f69fb46a4030ccfa9efde3f54bbb1289bfc4556e))
* **organizations:** organizzazioni, spazi, inviti, registro e RLS ([#42](https://github.com/grecomatteo/Feedway/issues/42)) ([4030efa](https://github.com/grecomatteo/Feedway/commit/4030efa52b8cb4f098961685ea33c09337e120cc))
* **platform:** organizzazioni, limiti, sospensione e CLI ([#63](https://github.com/grecomatteo/Feedway/issues/63)) ([282f254](https://github.com/grecomatteo/Feedway/commit/282f254c57917a2af4aa1acac11acefc3afcb0de))
* **web:** Better Auth montato nel pannello con CSRF, IP del client e cookie del dispositivo ([#51](https://github.com/grecomatteo/Feedway/issues/51)) ([b8b22fe](https://github.com/grecomatteo/Feedway/commit/b8b22feb264d277490a67ce6b24f5956fbeb414c))
* **workspaces:** spazi di lavoro e membri ([#68](https://github.com/grecomatteo/Feedway/issues/68)) ([dc94e48](https://github.com/grecomatteo/Feedway/commit/dc94e48f032db1670764db40f22d06098d770b42))


### Correzioni

* **infra:** aggiornamenti minor e patch con lockfile che Renovate sa rigenerare ([#64](https://github.com/grecomatteo/Feedway/issues/64)) ([304ef23](https://github.com/grecomatteo/Feedway/commit/304ef23ba6c2ed523b77c785715c635cfded3093))


### Documentazione

* funzioni dal confronto con la concorrenza e altri social come moduli ([#67](https://github.com/grecomatteo/Feedway/issues/67)) ([9bca2b0](https://github.com/grecomatteo/Feedway/commit/9bca2b0b41900e9620976faacba55a5ff1f8be0a))
* **identity:** revisione del piano della tappa 2 sul codice della tappa 1 ([#35](https://github.com/grecomatteo/Feedway/issues/35)) ([cdf7a1f](https://github.com/grecomatteo/Feedway/commit/cdf7a1fa504129ab3e845f101ddf9c5d517b5e2e))
* **identity:** verifiche preliminari di Better Auth 1.7.10 ([#37](https://github.com/grecomatteo/Feedway/issues/37)) ([397aabc](https://github.com/grecomatteo/Feedway/commit/397aabcf1b84e3555648208df6dd1d17a3e21a5b))
* **infra:** correzioni al piano B e ai controlli locali ([#59](https://github.com/grecomatteo/Feedway/issues/59)) ([cd022d2](https://github.com/grecomatteo/Feedway/commit/cd022d29236b3d38602813d5a83555bc8b37987f))
* **infra:** vietato il runner self-hosted con repository pubblico ([#61](https://github.com/grecomatteo/Feedway/issues/61)) ([7de79bb](https://github.com/grecomatteo/Feedway/commit/7de79bbcd1d0501a9c26a45983d2db78da5074ad))

## [0.1.2](https://github.com/grecomatteo/Feedway/compare/v0.1.1...v0.1.2) (2026-10-17)


### Documentazione

* **accounts:** collegamenti account multipli per Meta e altre piattaforme ([#31](https://github.com/grecomatteo/Feedway/issues/31)) ([f2e32fb](https://github.com/grecomatteo/Feedway/commit/f2e32fb5fe5e2fcbd5e79179eb79a3244543d076))
* ADR 014 accettata e eccezioni note ai container ([#34](https://github.com/grecomatteo/Feedway/issues/34)) ([c9ea5be](https://github.com/grecomatteo/Feedway/commit/c9ea5be4e0e64f39f6bebddd43a922022b3b1646))
* **ops:** runbook di installazione allineato alla prova su VPS ARM ([#33](https://github.com/grecomatteo/Feedway/issues/33)) ([525e9d1](https://github.com/grecomatteo/Feedway/commit/525e9d102133addde1d140a7a06f570ec90c7c94))

## [0.1.1](https://github.com/grecomatteo/Feedway/compare/v0.1.0...v0.1.1) (2026-10-16)


### Correzioni

* **docker:** immagine pubblicata per amd64 e arm64 ([#28](https://github.com/grecomatteo/Feedway/issues/28)) ([aed2c85](https://github.com/grecomatteo/Feedway/commit/aed2c85ff652b2ad38281dc39ca76d20caecf443))

## 0.1.0 (2026-10-16)


### Novità

* **config:** configurazione validata con supporto ai file di segreto ([#12](https://github.com/grecomatteo/Feedway/issues/12)) ([5fbc5dd](https://github.com/grecomatteo/Feedway/commit/5fbc5dd77cfe94d6be179bda217415f173c0cd64))
* **db:** ruoli separati, migrazioni e database di test ([#14](https://github.com/grecomatteo/Feedway/issues/14)) ([6fab674](https://github.com/grecomatteo/Feedway/commit/6fab6744ac306005cee325963e857095d985960d))
* **design:** prima consegna visiva e prototipo di app e landing ([#5](https://github.com/grecomatteo/Feedway/issues/5)) ([ad65cff](https://github.com/grecomatteo/Feedway/commit/ad65cfff9553fcf0d04dbf6e1f3cd75cf1ad429d))
* **docker:** immagine unica e compose irrobustiti ([#19](https://github.com/grecomatteo/Feedway/issues/19)) ([73f1c69](https://github.com/grecomatteo/Feedway/commit/73f1c6975ddb40bd5a993faed79c982f7c7991f5))
* **ops:** install.sh e update.sh con rollback ([#20](https://github.com/grecomatteo/Feedway/issues/20)) ([7a61d6f](https://github.com/grecomatteo/Feedway/commit/7a61d6f765945a0f9b0ee1e1f77875bf7a782bdd))
* porte di base, errori di dominio e log con oscuramento ([#13](https://github.com/grecomatteo/Feedway/issues/13)) ([13dbd71](https://github.com/grecomatteo/Feedway/commit/13dbd711585676b7c319190d5f471c746ee1a374))
* **queue:** adattatore pg-boss con unicità e tentativi ([#15](https://github.com/grecomatteo/Feedway/issues/15)) ([526d175](https://github.com/grecomatteo/Feedway/commit/526d175cde8dd12f5d97e1f662b80d296ec352b1))
* **web:** design system, tema chiaro/scuro e test e2e di accessibilità ([#18](https://github.com/grecomatteo/Feedway/issues/18)) ([14c6ac5](https://github.com/grecomatteo/Feedway/commit/14c6ac57074ca3bd08d60818df3c7aae38444ba5))
* **web:** salute, prontezza, header di sicurezza e ID richiesta ([#17](https://github.com/grecomatteo/Feedway/issues/17)) ([c8c9666](https://github.com/grecomatteo/Feedway/commit/c8c9666edf3415b6e67d87ed5a640694fee015bc))
* **worker:** avvio, battito, arresto pulito ([#16](https://github.com/grecomatteo/Feedway/issues/16)) ([c83ad5e](https://github.com/grecomatteo/Feedway/commit/c83ad5ee0889ed386992a8fb74843e4eb113fe9b))


### Documentazione

* copertina dei reel, anteprima video, calendario cliente e piano editoriale ([#7](https://github.com/grecomatteo/Feedway/issues/7)) ([3034270](https://github.com/grecomatteo/Feedway/commit/3034270158934f83fb84e52a2c18b0c278f40604))
* documentazione iniziale di Feedway ([#1](https://github.com/grecomatteo/Feedway/issues/1)) ([8ca99fb](https://github.com/grecomatteo/Feedway/commit/8ca99fbf16cbc0b29b2ba456bfdfb552c3e0913e))
* il nome dello strumento non compare mai in commit e PR ([#11](https://github.com/grecomatteo/Feedway/issues/11)) ([d250458](https://github.com/grecomatteo/Feedway/commit/d250458e0594a660e726683ae2fd4a2977ab7c6d))
* piano della tappa 2 con Better Auth ([#4](https://github.com/grecomatteo/Feedway/issues/4)) ([b9e65b9](https://github.com/grecomatteo/Feedway/commit/b9e65b9d992db46cd780e7781fdde5db2af00c77))
* piano editoriale confermato nella 1.0 ([#8](https://github.com/grecomatteo/Feedway/issues/8)) ([a6a32df](https://github.com/grecomatteo/Feedway/commit/a6a32dfa47c3653f95090663c92f597b63d2efa4))
* profili, contesto attivo, calendario e barra del telefono ([#6](https://github.com/grecomatteo/Feedway/issues/6)) ([42d46af](https://github.com/grecomatteo/Feedway/commit/42d46af5a8ace1c2b81097c202b2fbccee2074d4))
* specifica approvata e fusione delle PR da parte degli agenti ([#3](https://github.com/grecomatteo/Feedway/issues/3)) ([80c3947](https://github.com/grecomatteo/Feedway/commit/80c39470b226309b4a4612fc29ff802912d044d1))
