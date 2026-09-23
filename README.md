# Genesis

Simulazione storica emergente di civiltà umane. Un mondo nasce da un **seed**, poche tribù di
cacciatori-raccoglitori si muovono su una mappa 2D e, anno dopo anno, attraversano le stagioni, raccolgono
e coltivano cibo, si riproducono, migrano, fondano villaggi e città, scoprono e adottano tecnologie,
si danno forme di governo, commerciano, si ammalano, si ribellano, stringono alleanze e si fanno la guerra.

Nessun LLM decide nulla: ogni evento deriva da regole esplicite, stato persistente e un PRNG seedato.
Stesso stato iniziale + stesso seed + stesso numero di tick = stesso risultato, anche se i tick sono
eseguiti in batch diversi e lo stato passa dal database (verificato dai test).

L'obiettivo non è replicare la storia umana, ma costruire un sistema in cui **cause e conseguenze siano
osservabili, spiegabili e riproducibili**: ogni evento della cronaca porta con sé i numeri che lo hanno
prodotto, e l'interfaccia li mostra nel pannello «Perché è successo?».

- **Stack**: Next.js 16 (App Router) · TypeScript strict · Tailwind CSS 4 · componenti in stile shadcn/ui ·
  Drizzle ORM · PostgreSQL (Supabase) / PGlite in locale · Zod · TanStack Query · Zustand (solo UI) ·
  Canvas 2D · Recharts · Vitest.
- **Deploy**: Vercel, senza server persistenti né loop lato server.

---

## Indice

1. [Avvio rapido](#avvio-rapido)
2. [Variabili d'ambiente](#variabili-dambiente)
3. [Database e migrazioni](#database-e-migrazioni)
4. [Compatibilità dei mondi esistenti](#compatibilità-dei-mondi-esistenti)
5. [Test, lint, typecheck](#test-lint-typecheck)
6. [Deploy su Vercel con Supabase](#deploy-su-vercel-con-supabase)
7. [Cron opzionale](#cron-opzionale)
8. [Architettura](#architettura) · [Schermata del mondo](#schermata-del-mondo) ·
   [Mappa esagonale](#mappa-esagonale) · [Mappa isometrica (classica)](#mappa-isometrica-classica) ·
   [Eliminazione di un mondo](#eliminazione-di-un-mondo)
9. [Modello di simulazione](#modello-di-simulazione) · [Identità storiche](#identità-storiche) ·
   [Vassallaggi e occupazioni](#vassallaggi-e-occupazioni) · [Fusioni](#fusioni-e-identità-composite)
10. [API](#api)
11. [Prestazioni](#prestazioni)
12. [Scalabilità](#scalabilità)
13. [Limiti attuali](#limiti-attuali)
14. [Prossima milestone](#prossima-milestone)
15. [Roadmap tecnica](#roadmap-tecnica)

---

## Avvio rapido

Requisiti: Node.js ≥ 20.9 (testato con Node 25), npm.

```bash
npm install
cp .env.example .env.local      # facoltativo in locale
npm run dev                     # http://localhost:3000
```

Senza `DATABASE_URL` l'app usa **PGlite** (Postgres compilato in WASM) salvato in `.data/pglite`: le migrazioni
vengono applicate automaticamente al primo accesso, quindi non serve installare Postgres per provarla.
Per usare un Postgres reale (Supabase, Docker, locale) basta impostare `DATABASE_URL` e lanciare `npm run db:migrate`.

Esecuzione headless del solo motore (utile per tarare i parametri):

```bash
npm run sim:run -- <seed> <anni> [ogni-quanti-anni-stampare]
npm run sim:run -- genesis 1000 100
```

**Come si usa l'applicazione**

1. Dalla home crea un mondo scegliendo nome, seed (facoltativo) e dimensione della mappa (24–96).
2. La pagina del mondo è una **mappa esagonale a tutto schermo**: l'HUD in alto mostra nome, stato, risorse
   (con la variazione dall'ultimo avanzamento), anno e stagione, controlli del tempo, notifiche e menu.
3. ▶ avvia la simulazione automatica (velocità 1×, 2×, 5×); «Avanza» esegue a mano `+1 / +10 / +50 / +100`
   anni. Il browser invia un batch alla volta: sul server non gira nessun ciclo.
4. La toolbar verticale a sinistra ha zoom, «centra mondo», «centra selezione», «segui», le **lenti**
   (territori, risorse, infrastrutture, conflitti, commercio, clima), etichette, griglia esagonale, minimappa,
   tutti i livelli e la legenda. In «Tutti i livelli» si sceglie anche la rappresentazione: esagonale,
   isometrica classica o mappa tecnica di debug.
5. Un clic su una cella, un villaggio o una banda apre il **pannello di selezione** flottante (un bottom sheet
   su mobile), con «centra», «segui», «dettaglio completo» e «riduci». L'icona a colonne nell'HUD apre gli
   elenchi di civiltà, insediamenti, tribù e figure di rilievo.
6. La barra in basso mostra l'ultima notifica importante; espansa, l'elenco filtrabile per categoria (un clic
   centra la mappa sull'entità). Da lì si aprono «Cronaca» (filtri per periodo, importanza, tipo,
   protagonista e testo, con «Perché è successo?») e «Statistiche».
7. Il menu (☰) contiene torna ai mondi, informazioni, snapshot, impostazioni mappa, modalità debug ed
   **Elimina mondo** (anche dalla scheda del mondo nell'elenco).

## Variabili d'ambiente

| Variabile                                                  | Obbligatoria      | Descrizione                                                                                                                                   |
| ---------------------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                             | in produzione     | Connessione runtime. Su Supabase usa il **pooler in transaction mode** (porta 6543). Fallback: `POSTGRES_URL`.                                |
| `DIRECT_URL`                                               | per le migrazioni | Connessione diretta/session (porta 5432) usata da `db:migrate`. Fallback: `POSTGRES_URL_NON_POOLING`, poi `DATABASE_URL`.                     |
| `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`                 | —                 | Create automaticamente dall'integrazione Supabase del Vercel Marketplace: vengono lette senza doverle rinominare.                             |
| `GODGAME_POSTGRES_URL`, `GODGAME_POSTGRES_URL_NON_POOLING` | —                 | Variabili del database **god_game_db** (Supabase via Vercel), create con il prefisso `GODGAME_`. Lette come fallback runtime e migrazioni.    |
| `DATABASE_ENV_PREFIX`                                      | no (`GODGAME_`)   | Prefisso delle variabili dell'integrazione, se cambia.                                                                                        |
| `NEXT_PUBLIC_APP_URL`                                      | no                | URL pubblico dell'app.                                                                                                                        |
| `NEXT_PUBLIC_MAP_RENDERER`                                 | no (`hex`)        | Mappa mostrata di default: `hex` (esagonale), `isometric` (classica) oppure `debug` (mappa tecnica dall'alto). L'utente può sempre cambiarla. |
| `NEXT_PUBLIC_MAP_DEBUG`                                    | no                | `1` apre di default il pannello prestazioni della mappa (FPS, tempo di frame, tile e chunk visibili).                                         |
| `SIMULATION_MAX_TICKS_PER_REQUEST`                         | no (100)          | Limite di tick per chiamata a `/simulate`.                                                                                                    |
| `SIMULATION_TIME_BUDGET_MS`                                | no (20000)        | Budget di calcolo per richiesta: oltre questa soglia il batch si ferma e salva i tick completati (`partial: true`).                           |
| `SIMULATION_LOCK_TTL_MS`                                   | no (60000)        | Durata del lock per mondo (protezione da lock orfani).                                                                                        |
| `DATABASE_POOL_MAX`                                        | no (3)            | Connessioni massime per istanza serverless.                                                                                                   |
| `PGLITE_DIR`                                               | no                | Cartella di PGlite in locale (default `.data/pglite`).                                                                                        |
| `CRON_SECRET`                                              | no                | Abilita il cron opzionale `/api/cron/advance`. Senza di esso la route risponde 401.                                                           |
| `CRON_WORLDS_PER_RUN`                                      | no (3)            | Mondi avanzati al massimo da una singola esecuzione del cron.                                                                                 |
| `CRON_TICKS_PER_WORLD`                                     | no (10)           | Anni simulati per ogni mondo a ogni esecuzione del cron.                                                                                      |
| `CRON_BUDGET_MS`                                           | no (45000)        | Tempo massimo speso da un'esecuzione del cron prima di fermarsi con i mondi già avanzati salvati.                                             |

Le variabili di `god_game_db` sono **sensibili** e definite solo per Preview e Production: Vercel le inietta
nei deploy (build e runtime) ma `vercel env pull` non può scaricarle. Per usare Supabase anche in locale copia
le stringhe di connessione dal dashboard Supabase (_Connect_) in `.env.local` come `DATABASE_URL` (pooler,
porta 6543) e `DIRECT_URL` (porta 5432), oppure resta su PGlite. I segnaposto `[SENSITIVE]` scritti da
`vercel env pull` vengono ignorati.

I parametri non standard presenti negli URL Supabase (per esempio `supa=base-pooler.x`) vengono rimossi
automaticamente (`lib/db/config.ts`), perché Postgres li rifiuterebbe come opzioni di avvio.

## Database e migrazioni

Schema: `lib/db/schema.ts`. Migrazioni SQL generate: `drizzle/`.

```bash
npm run db:generate   # dopo aver modificato schema.ts: genera una nuova migrazione
npm run db:migrate    # applica le migrazioni (DIRECT_URL → POSTGRES_URL_NON_POOLING → DATABASE_URL → PGlite)
npm run db:studio     # Drizzle Studio (richiede un Postgres raggiungibile)
```

Tabelle principali:

| Tabella                                                          | Contenuto                                                                                                                                                                   |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `worlds`                                                         | seed, dimensioni, `current_tick`, `current_year`, `status`, `rng_state`, `settings`, contatori id, clima, riepilogo cache, `owner_id` (riservato all'autenticazione futura) |
| `world_cells`                                                    | una riga per cella: biomi, risorse dinamiche, proprietario, strade, campi                                                                                                   |
| `tribes`, `people`, `households`, `settlements`, `civilizations` | entità della simulazione                                                                                                                                                    |
| `technologies`, `world_technologies`                             | catalogo globale e scoperte per tribù                                                                                                                                       |
| `relationships`                                                  | fiducia, ostilità, commercio, memoria dei conflitti, guerra/alleanza/tregua                                                                                                 |
| `historical_events`                                              | eventi strutturati (tipo, importanza 1–5, attori, coordinate, testo, metadata)                                                                                              |
| `world_stats`                                                    | serie temporale per tick (30 metriche), alimenta i grafici                                                                                                                  |
| `civilization_stats`                                             | serie per civiltà, campionata ogni `observability.civStatsInterval` tick (default 5)                                                                                        |
| `dynasties`                                                      | famiglie regnanti: fondatore, anni, numero di guide, prestigio                                                                                                              |
| `world_snapshots`                                                | stato completo a tick 0 e ogni `observability.snapshotInterval` tick (conservati gli ultimi 3 più lo 0)                                                                     |
| `simulation_locks`, `simulation_runs`                            | lock per mondo e log di ogni batch (durata, esito, errori)                                                                                                                  |
| `vassal_relationships`, `occupations`                            | rapporti di vassallaggio e occupazioni di insediamenti, attivi e conclusi (mai cancellati finché il mondo esiste)                                                           |
| `composite_identities`                                           | identità nate da fusioni nel mondo; indice univoco `(world_id, member_key)`: la stessa combinazione non può esistere due volte                                              |
| `world_deletion_jobs`                                            | stato di ogni eliminazione (fase, righe per tabella, progresso, lease, errore); senza FK: sopravvive al mondo eliminato                                                     |

Le migrazioni applicate finora:

| Migrazione           | Scopo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0000_init.sql`      | schema iniziale (mondi, celle, tribù, persone, insediamenti, civiltà, relazioni, eventi, statistiche, snapshot, lock, run)                                                                                                                                                                                                                                                                                                                                                             |
| `0001_evolution.sql` | **solo aggiunte**: colonne di clima/config/crisi sui mondi, giacimenti e pascoli sulle celle, cultura, governo, stabilità, distribuzione e adozione tecnologica sulle tribù, prestigio/istruzione/ricchezza/dinastia sulle persone, livello urbano, igiene, malcontento e influenza sugli insediamenti, rispetto/dipendenza/stato/fase sulle relazioni, sottotipo e catene causali sugli eventi, 14 nuove metriche su `world_stats`, più le tabelle `dynasties` e `civilization_stats` |

| `0002_identities.sql` | **solo aggiunte**: identità storiche su tribù e civiltà, roster sul mondo, indici `(world_id, identity_id)` e `(world_id, status)` |
| `0003_world_deletion_jobs.sql` | **solo aggiunte**: tabella `world_deletion_jobs` e i suoi indici (uno univoco parziale: al massimo un job aperto per mondo). `worlds.status` è testo, quindi il valore `deleting` non richiede DDL |
| `0004_civilization_name_pattern.sql` | **solo aggiunte**: colonna nullable `civilizations.name_pattern` (gli stati esistenti restano `NULL` = regola di nome precedente) |
| `0005_political_relations.sql` | **solo aggiunte**: tabelle `vassal_relationships`, `occupations`, `composite_identities` (FK `CASCADE`, indicizzate) e colonna `relationships.fusion_years` con default 0 |

Nessuna migrazione contiene `DROP`, `TRUNCATE` né `ALTER … DROP COLUMN`, e nessuna esegue `UPDATE` di massa.
Ogni file inizia con un commento che ne dichiara la natura non distruttiva e il rollback manuale possibile.

`0001_evolution.sql` non contiene `DROP`, `TRUNCATE` né `ALTER … DROP COLUMN`: ogni colonna nuova è nullable
oppure ha un valore di default, quindi si applica senza rischi anche a un database già popolato.

Scelte:

- Gli id dei mondi sono **UUID**. Le entità hanno id **deterministici e locali al mondo** (`p12`, `t3`, `s5`…)
  con chiave primaria `(world_id, id)`: lo stesso seed produce esattamente gli stessi id.
- Indici su `(world_id, tick)`, `(world_id, year)`, `(world_id, importance, seq)`, `(world_id, type, seq)`,
  coordinate delle celle (chiave primaria), un indice parziale sulle persone vive e sui nuclei familiari attivi.
- Ogni batch è salvato in **una transazione** con insert e upsert multi-riga (`INSERT … ON CONFLICT DO UPDATE`
  a blocchi di 400 righe). Delle celle si riscrivono solo quelle cambiate. Il caricamento di un mondo usa
  8 query, senza N+1.
- Le persone morte restano nel database (`alive = false`, anno e causa) ma non vengono ricaricate nella simulazione.
- Le risorse introdotte dopo la prima release vivono in una colonna JSONB `goods`: le quattro storiche
  (cibo, legname, pietra, rame) mantengono le loro colonne, così nessun dato preesistente va riscritto.

## Compatibilità dei mondi esistenti

Lo stato del mondo ha una **versione** (`worlds.simulation_version`, oggi `3`: occupazioni e vassallaggi
espliciti, fusioni, testi grammaticali, fasce di posizionamento) e un formato di serializzazione
versionato (`STATE_VERSION`). Un mondo creato da una versione precedente del motore viene completato al
caricamento da `packages/simulation-core/src/normalize.ts`:

- i campi mancanti ricevono un default **deterministico** (la cultura di una tribù legacy deriva da un hash
  stabile di seed + id, i giacimenti di argilla, stagno e carbone derivano dal terreno della cella);
- i vecchi cantieri `{ type, progress, required }` diventano progetti completi con risorse e lavoro;
- le siccità salvate nel vecchio formato diventano calamità del nuovo modello;
- `migrateState` è **idempotente** e non sovrascrive mai un valore già presente (nemmeno un `null` esplicito:
  distingue "campo assente" da "campo vuoto", altrimenti il replay non sarebbe più deterministico).

Il tutto è coperto da `packages/simulation-core/tests/compatibility.test.ts`, che costruisce uno stato in
formato 1 rimuovendo ogni campo introdotto dopo, lo ricarica e continua a simulare verificando gli invarianti.
Un secondo caso simula un mondo della versione 2 (senza vassallaggi, occupazioni, fusioni, `fusion_years`,
`name_pattern` né rapporto di posizionamento): si carica con liste vuote e default, **nessun nome di popolo o
di stato cambia**, nessuna identità (tanto meno moderna) viene assegnata retroattivamente, e la simulazione
prosegue. I mondi esistenti restano `legacy`/`procedural`; una conversione manuale dei dati storici non è
prevista né eseguita automaticamente (servirebbero backup e anteprima espliciti).

La migrazione `0002_identities` è **additiva e non distruttiva**: aggiunge `identity_id`, `identity_type`
(default `'legacy'`), `absorbed_identity_ids` e `absorbed_by_tribe_id` a `tribes`, `identity_id`,
`identity_type`, `political_stem` e `former_names` a `civilizations`, `roster` (nullable) a `worlds`, più gli
indici `(world_id, identity_id)` e `(world_id, status)`. Le tribù e le civiltà esistenti diventano `legacy` per
default di colonna (nessun `UPDATE` di massa): conservano nome, eventi e snapshot, non vengono mai rinominate
né associate a un'identità. I nuovi mondi usano il roster storico (o `procedural`, per le tribù inventate).
Test: `packages/simulation-core/tests/identity-continuity.test.ts` (stato legacy senza campi di identità) e
`tests/identity-api.test.ts` (righe legacy nel database).

Per applicare la migrazione a un database esistente:

```bash
# in locale o puntando a Supabase con DIRECT_URL impostata
npm run db:migrate
```

Su Vercel viene eseguita automaticamente dal `buildCommand` (`npm run build:vercel`). Non è previsto (né
necessario) un backfill: i valori mancanti vengono calcolati al primo caricamento e persistiti al primo
salvataggio. La migrazione non è reversibile da Drizzle, ma essendo puramente additiva un rollback del codice
continua a funzionare sulle stesse tabelle (le colonne nuove restano inutilizzate).

## Test, lint, typecheck

```bash
npm test                # Vitest: core + integrazione DB (PGlite in memoria) + API
npm run test:simulation # stress del motore: invarianti, 20 seed × mappe piccole/medie/grandi, 100–250 tick
npm run test:world-delete  # eliminazione dei mondi (PGlite; + Postgres reale se TEST_DATABASE_URL è impostata)
npm run diagnose:world-delete -- --world-id <uuid>  # diagnosi in sola lettura di un'eliminazione
npm run test:all        # entrambe le suite
npm run simulation:run -- --scenario fertile-valley --seed test-001 --ticks 200 [--profile]
npm run simulation:compare -- --scenario trade-corridor --seed test-002
npm run simulation:stress -- [--seeds 20] [--ticks 200] [--scenario-seeds 3]
npm run simulation:replay -- --seed test-003 --snapshot 100 --ticks 100
npm run lint            # ESLint (config Next core-web-vitals + TypeScript)
npm run typecheck       # tsc --noEmit (strict, noUncheckedIndexedAccess)
npm run format          # Prettier
npm run build           # build di produzione
```

Cosa coprono i test (`packages/simulation-core/tests`, `tests/`):

- generazione deterministica della mappa (stesso seed, stesso output) e relazioni coerenti tra biomi, acqua e fertilità;
- 3–6 tribù di 15–40 persone in celle abitabili e distanziate;
- **clima**: quattro stagioni deterministiche per anno, inverno più duro in tundra che in pianura, deserto meno
  produttivo della pianura, siccità che riduce la resa nella sua area, valori sempre nei limiti su 200 anni,
  calamità rare e con causa dichiarata nei metadata;
- **economia**: helper delle risorse che non producono mai NaN o valori negativi, produzione dipendente da
  lavoratori, stagione e terreno, deperimento del cibo, limite di magazzino, resilienza portata dalla ceramica,
  usura degli strumenti;
- morte per fame in condizioni estreme;
- **famiglie**: nascite con genitori e nuclei validi, nessuna coppia fra consanguinei diretti, nessuna persona
  che sia genitore di sé stessa, nessun morto che agisce, eredità che azzera la ricchezza del defunto;
- **leadership**: successione con eredi idonei, punteggio basato sui meriti, eventi di ascesa e crisi;
- **cultura e governo**: tratti sempre in 0–100, stabilità in 0–1, forme di governo che evolvono solo al
  raggiungimento delle condizioni, rivolte rare;
- **insediamenti**: fondazione che rispetta i prerequisiti, cantieri che richiedono risorse e lavoro, livelli
  guadagnati (una carestia blocca la promozione a città), territorio sempre dentro la mappa, collasso che
  ricolloca le persone e libera le celle;
- tecnologie che rispettano prerequisiti, soglie e geografia, con adozione graduale;
- migrazione da zone inospitali;
- **diplomazia e guerra**: relazioni coerenti e simmetriche, commercio con costo di trasporto, guerra solo con
  condizioni sufficienti e dopo la scala di tensione, battaglia deterministica, conseguenze valide su
  popolazione e territorio;
- **crisi**: epidemie che rispettano le condizioni, immunità di una generazione, crisi che scadono senza restare
  appese, catene causali valide;
- **compatibilità**: uno stato in formato 1 viene caricato, completato e continua a simulare; la migrazione è
  idempotente; il round-trip non perde dati; le versioni future sono rifiutate;
- **invarianti** (modulo riusabile `checkInvariants`): popolazione mai negativa, risorse mai NaN o negative,
  coordinate nei limiti, riferimenti fra entità sempre validi, tecnologie con prerequisiti soddisfatti,
  relazioni diplomatiche coerenti, nessun evento orfano;
- determinismo: batch da 60 = 10 + 25 + 25 con serializzazione intermedia;
- **round trip sul database**: 50 + 10 tick salvati e ricaricati da Postgres (PGlite) = 60 tick in memoria;
- lock: seconda acquisizione negata, lock scaduto ripreso, due richieste simultanee di cui una rifiutata con 409;
- validazione API: tick non consentiti (400 `TICKS_NOT_ALLOWED`), JSON non valido, mondo inesistente (404),
  filtri eventi (periodo, tipo, importanza, protagonista, ricerca testuale con wildcard SQL neutralizzate),
  identificativi di persona non validi, cron non autorizzato, nessuno stack trace nelle risposte.

Test aggiunti con identità moderne, fusioni, vassallaggi/occupazioni, linguaggio e posizionamento:
`identity-modern.test.ts` (catalogo moderno, partenza uniforme dichiarata, filtri per epoca, «Italiani in un
mondo preistorico»), `fusion.test.ts`, `politics.test.ts`, `language.test.ts` (articoli, preposizioni,
singolare/plurale, identità storiche, legacy, composite, forme politiche, leader, eventi e uno _sweep_ sui
testi reali del motore), `placement.test.ts`, `tests/politics-persistence.test.ts` (persistenza, API, stati di
continuità, indice univoco delle composite, cancellazione), `tests/world-deletion*.test.ts` (vedi
[Eliminazione](#eliminazione-di-un-mondo)).

La suite di stress (`npm run test:simulation`) aggiunge: 250 tick con controllo di integrità **dopo ogni tick**,
assenza di `Math.random` in tutto il package di simulazione, nessun evento duplicato o orfano su 300 tick,
determinismo su 250 tick, nessun mondo che si estingue prematuramente su 10 semi diversi e i due budget di
prestazione (generazione del mondo e batch da 10 tick sotto i 3 secondi). La **matrice di stress**
(`matrix.stress.test.ts`) esegue 20 seed su mappe 24×24 (150 tick), 20 seed su 48×48 con identità moderne
(200 tick), 3 mondi 96×96 (250 tick) e 8 mondi procedurali/legacy (200 tick), con invarianti ogni 25 tick
(incluse quelle politiche e di continuità delle identità) e controllo dei testi generati.

## Deploy su Vercel con Supabase

1. **Progetto**: importa il repository su Vercel (framework Next.js, rilevato in automatico).
2. **Database**: in Vercel apri _Storage → Create Database → Supabase_ (Marketplace). Scegli una regione vicina
   alle Functions (per esempio Francoforte) e collegalo al progetto per Development, Preview e Production.
   L'integrazione crea `POSTGRES_URL` (pooler, 6543) e `POSTGRES_URL_NON_POOLING` (5432), già lette dall'app.
   In alternativa, con un progetto Supabase creato a mano, imposta `DATABASE_URL` (pooler transaction, 6543)
   e `DIRECT_URL` (connessione diretta o session, 5432) in _Settings → Environment Variables_.
3. **Migrazioni**: `vercel.json` usa `npm run build:vercel`, che esegue `db:migrate` e poi `next build`. Le migrazioni
   Drizzle sono idempotenti (tabella `drizzle.__drizzle_migrations`). Per applicarle a mano:
   `vercel env pull .env.local && npm run db:migrate`.
4. **Durata delle funzioni**: `/simulate` dichiara `maxDuration = 60` s; il motore si ferma prima grazie a
   `SIMULATION_TIME_BUDGET_MS` e salva i tick già calcolati.
5. **Cron (opzionale)**: vedi la sezione seguente. Il progetto non ne dipende: la UI avanza il tempo con
   chiamate esplicite.

Vercel va benissimo per UI e batch limitati. Una simulazione molto grande (decine di migliaia di individui,
molti mondi sempre attivi) va spostata su un worker con una coda esterna: vedi [Scalabilità](#scalabilità).

## Cron opzionale

La modalità autonoma è **disattivata per impostazione predefinita**: senza `CRON_SECRET` la route
`/api/cron/advance` risponde `401` e nessun mondo avanza da solo.

Per abilitarla:

1. imposta `CRON_SECRET` nelle variabili d'ambiente del progetto su Vercel;
2. copia il blocco `crons` da [`vercel.cron.example.json`](./vercel.cron.example.json) dentro `vercel.json`;
3. fai un nuovo deploy.

```json
"crons": [{ "path": "/api/cron/advance", "schedule": "0 * * * *" }]
```

Gli schedule dei cron di Vercel sono sempre interpretati in **UTC**: `0 * * * *` significa "all'inizio di ogni
ora UTC". Vercel invia l'header `Authorization: Bearer <CRON_SECRET>`.

Comportamento di ogni esecuzione:

- seleziona al massimo `CRON_WORLDS_PER_RUN` mondi (default 3) in stato `running`, i meno aggiornati per primi;
- avanza ciascuno di `CRON_TICKS_PER_WORLD` anni (default 10) passando dallo stesso servizio dell'API, quindi
  con lock per mondo, budget di tempo e transazione;
- si ferma appena supera `CRON_BUDGET_MS` (default 45 s), lasciando i mondi già avanzati correttamente salvati;
- non tocca i mondi in pausa; l'errore su un mondo non blocca gli altri e finisce nei log strutturati;
- è idempotente nel senso che conta: il lock impedisce che due esecuzioni sovrapposte simulino lo stesso mondo,
  e ogni batch riparte dallo stato salvato.

In locale puoi provarlo così:

```bash
CRON_SECRET=test npm run dev
curl -H "Authorization: Bearer test" http://localhost:3000/api/cron/advance
```

## Architettura

```
app/                         Next.js App Router: pagine (server) e route handler REST
  (site)/                    home ed elenco mondi (con l'header del sito)
  (game)/worlds/[worldId]/   schermata del mondo a tutto schermo, loading, not-found «Mondo non disponibile»
  api/worlds/…               POST/GET mondi, GET/PATCH/DELETE mondo, simulate, events, stats
  api/cron/advance           cron opzionale
components/
  ui/                        primitive in stile shadcn (button, input, tabs, badge, panel, dialog, menu…)
  world/                     cronaca, statistiche, pannelli di dettaglio, dialog di eliminazione, mappa tecnica
  world/screen/              schermata del mondo: HUD, controlli del tempo, menu, pannelli flottanti, notifiche
  world/map/                 mappa a tutto schermo: canvas (hex | isometrico), toolbar, minimappa, livelli, legenda
lib/
  db/                        schema Drizzle, connessione (postgres-js | PGlite), mapper, repository, lock
  services/world-service.ts  casi d'uso: crea, carica, simula (lock → load → run → save), eventi, statistiche
  validation/                schemi Zod
  client/                    fetch API, store Zustand (solo UI), HUD, notifiche, eliminazione lato client
  map-renderer/              renderer Canvas 2D (isometrico e, in hex/, esagonale): puro TypeScript, niente React né DB
  utils/                     errori applicativi, risposte API, logger JSON
packages/simulation-core/    motore puro: nessun import da Next.js, Drizzle o DB
  src/                       config (Zod), types, prng, stock (risorse), terrain, world-generator,
                             climate (stagioni e calamità), agents, economy, population, leadership,
                             culture, crises, migration, settlements, technology, diplomacy, warfare,
                             events, invariants, normalize (compatibilità), simulation-engine, serialization
  tests/                     test del motore
  tests/stress/              suite lunga: invarianti a ogni tick, determinismo, performance
scripts/                     migrate.ts, run-simulation.ts
drizzle/                     migrazioni SQL
tests/                       integrazione DB e API
```

Il core è importato con l'alias `@genesis/simulation-core` (tsconfig paths). È un pacchetto logico, non un
workspace npm separato: per il primo commit un monorepo sarebbe stato eccessivo, ma i confini sono netti e
spostarlo in un workspace richiede solo un `package.json`.

**Flusso di una richiesta `/simulate`**: validazione Zod → verifica esistenza → acquisizione lock per mondo →
caricamento completo dello stato → `runSimulation(state, n, { deadline })` in memoria → persistenza in una
transazione → registrazione in `simulation_runs` → rilascio del lock nel `finally`. Tra una richiesta e l'altra
sul server non resta nulla: la fonte di verità è il database.

**Lock**: `SimulationLock` è un'interfaccia (`acquire`/`release`). L'implementazione attuale usa la tabella
`simulation_locks` con `INSERT … ON CONFLICT DO UPDATE … WHERE expires_at < now()`: un lock scaduto può essere
ripreso, quindi una funzione morta non blocca il mondo. Per passare a Upstash Redis basta un'implementazione
con `SET key token NX PX ttl` e un rilascio condizionato al token.

**Pausa/Riprendi**: lo stato `running` è salvato nel mondo. Con il mondo in corso il browser invia un batch alla
volta e aspetta la risposta prima del successivo; la velocità sceglie batch e pausa (1× = 10 anni ogni 1,4 s,
2× = 10 anni ogni 0,45 s, 5× = 50 anni ogni 0,45 s, più il tempo di calcolo). Il cron opzionale può fare lo
stesso lato server.

**Logging**: JSON su una riga. `world.created` (celle, tribù, persone, durata), `simulate.batch` (tick
richiesti ed eseguiti, persone, insediamenti, tribù, eventi, `loadMs`, `computeMs`, `saveMs`, `msPerTick`,
durata totale), `cron.advance`, `simulate.failed`, `api.unhandled`. Nessun dato sensibile finisce nei log e le
risposte di errore non espongono stack trace.

### Schermata del mondo

La mappa occupa tutta la viewport e tutto il resto le fluttua sopra; nessun pannello la restringe.

```
WorldScreen (components/world/screen/world-screen.tsx)
  ├── WorldMapContainer   mappa a tutto schermo (MapCanvas hex | isometrica, oppure mappa tecnica)
  │     ├── MapToolbar    zoom, camera, lenti, etichette, griglia, minimappa, livelli, legenda
  │     ├── Minimap       vista d'insieme cliccabile (solo esagonale; nascosta su mobile)
  │     └── Livelli / Legenda / pannello prestazioni
  ├── TopHud              nome, stato, risorse con variazioni e tooltip, anno e stagione, notifiche, menu
  │     ├── SpeedControls ▶/⏸, 1× 2× 5×, avanza +1 +10 +50 +100 (disabilitati durante una richiesta)
  │     └── WorldMenu     mondi, info, cronaca, statistiche, mappa, debug, snapshot, elimina
  ├── SelectionPanel      cella, insediamento, tribù, civiltà, persona o guerra; riducibile; bottom sheet su mobile
  ├── OverviewPanel       civiltà, insediamenti, tribù, figure (aperto su richiesta)
  ├── EventLog            ultima notifica; espanso: notifiche filtrabili, collegate a entità e cella
  └── Dialog              cronaca, statistiche, informazioni/snapshot, dettaglio completo, eliminazione
```

Lo stato della UI (selezione, pannelli, lenti, velocità, minimappa, notifiche lette) vive nello store Zustand
`lib/client/store.ts` e non è mai fonte di verità. Gli indicatori dell'HUD (`lib/client/hud.ts`) e le notifiche
(`lib/client/notifications.ts`) sono funzioni pure derivate dai dati già caricati: nessuna query in più tranne
una pagina di eventi importanti, invalidata dopo ogni avanzamento. Le notifiche escludono i micro-eventi
(nascite, commerci, crescita), sono deduplicate per id e unite quando identiche nello stesso anno.

Dopo un avanzamento si invalida la query del mondo: la mappa riceve un nuovo view model e ridisegna solo i
chunk la cui firma è cambiata, senza ricaricare la pagina. `Esc` chiude il pannello laterale aperto, poi la
selezione; i dialog nativi (`<dialog>`) intrappolano il focus e lo restituiscono alla chiusura.

### Mappa esagonale

Renderer predefinito, in `lib/map-renderer/hex/`, con lo stesso contratto del renderer isometrico
(`MapRenderer` in `map-renderer.ts`): il componente `MapCanvas` ospita l'uno o l'altro.

**Convenzione unica** (`hex/geometry.ts`):

- esagoni **pointy-top**, righe orizzontali;
- la simulazione resta sulla sua griglia quadrata: la cella `(x, y)` è l'esagono in colonna `x`, riga `y` del
  layout offset **odd-r** (righe dispari spostate a destra di mezzo esagono). Nessuna migrazione dei dati;
- rendering, distanza, vicini e picking in coordinate **assiali** `(q, r)`; le **cubiche** servono per
  l'arrotondamento e la distanza; sono disponibili tutte le conversioni `even-q/odd-q/even-r/odd-r`;
- mondo: `x = size·√3·(q + r/2)`, `y = size·3/2·r`, con `size = 36` px (un esagono è largo ~62 px a zoom 1,
  come i vecchi tile da 64 px, quindi soglie di zoom ed edifici procedurali restano validi);
- bordi: la mappa non si avvolge; le celle fuori da `0..width-1 × 0..height-1` non esistono.

Le adiacenze della vista sono quelle esagonali; il motore continua a ragionare sulla sua griglia. Per questo
fiumi e strade non collegano ogni coppia di celle vicine (sugli esagoni formerebbero triangoli): un fiume scorre
verso il vicino più basso o verso il mare, le strade seguono un albero ricoprente della loro rete
(`hex/hex-links.ts`).

| Modulo (`lib/map-renderer/hex/`) | Ruolo                                                                                               |
| -------------------------------- | --------------------------------------------------------------------------------------------------- |
| `geometry.ts`                    | offset ↔ assiali ↔ cubiche ↔ mondo, distanza, vicini, range, vertici, lati, hit test, `HexGrid`     |
| `hex-terrain.ts`                 | tessere, rilievo (luce da nord-ovest), acqua e schiuma, campi, clima, decorazioni; chunk con bordo  |
| `hex-links.ts`                   | collegamenti ad albero di fiumi e strade                                                            |
| `borders.ts`                     | confini solo dove cambia il proprietario, lati uniti in polilinee, rientro verso la propria regione |
| `hex-settlements.ts`             | layout deterministici degli insediamenti ancorati all'esagono, edifici, mura, tende nomadi          |
| `hex-renderer.ts`                | passaggi di disegno, soglie di dettaglio, selezione, etichette, statistiche di frame                |
| `../minimap.ts`                  | minimappa dal view model già in memoria (nessuna query)                                             |

**Livelli di dettaglio**. Da lontano: biomi, rilievo, acqua, territori con i nomi delle civiltà, icone di
capitali e città; la griglia è nascosta e i confini sottili compaiono solo per la regione selezionata e per i
tratti contesi. Da vicino: griglia sottile e semitrasparente (sopra 0,5×), confini di tutte le regioni, campi,
strade, risorse per cella, edifici, mura e porti. Un villaggio sta nel suo esagono, una città ne occupa anche i
vicini, una capitale il primo anello, con palazzo e alone dorato. Il colore della civiltà tinge poco il terreno
(alpha 0,17) e si ritrova su tetti, stendardi ed etichette; la regione selezionata ha anche un tratteggio e un
bordo doppio, così il territorio non si distingue solo per colore.

**Prestazioni** (Chromium headless con rendering software, mondo 96×96 dopo 400 anni, viewport 1600×1000):

| Vista                      | Tempo di frame | Tile visibili | Chunk visibili  |
| -------------------------- | -------------- | ------------- | --------------- |
| Vista d'insieme (0,27×)    | ~0,3 ms        | ~7.600        | 30              |
| Zoom alto (2,3×, bucket 2) | ~8 ms          | ~200          | 4               |
| Zoom massimo (3,2×)        | ~1,7 ms        | ~130          | disegno diretto |

Gli FPS misurati (35–40) sono limitati dagli eventi sintetici del test, non dal renderer. Primo canvas in
~1,4 s dall'apertura della pagina (payload completo del mondo 96×96).

### Mappa isometrica (classica)

La mappa isometrica 2:1 precedente resta disponibile («Tutti i livelli» → Rappresentazione, oppure
`NEXT_PUBLIC_MAP_RENDERER=isometric`) finché quella esagonale non è considerata stabile, insieme alla
**mappa tecnica** dall'alto (`debug`), che subentra anche quando un renderer fallisce: un error boundary e la
gestione degli errori nel ciclo di disegno offrono "Riprova" o "Usa la mappa tecnica".

**Perché Canvas 2D e non PixiJS o Phaser**: le mappe vanno da 24×24 a 96×96 celle (al massimo 9.216 tile). Con
il disegno su richiesta, cioè solo quando cambiano camera o dati, e la cache a chunk, Canvas 2D resta sotto i
3 ms per frame anche a 96×96. Una libreria WebGL avrebbe aggiunto centinaia di KB al bundle e un contesto
WebGL da gestire (perdita del contesto, SSR, dispositivi limitati) senza un guadagno misurabile a queste
dimensioni.

**Flusso dei dati**: `WorldDetail` (API) → `buildIsometricMapViewModel` (`lib/map-renderer/view-model.ts`,
l'unico modulo che conosce i DTO) → `IsometricRenderer`. Il renderer non fa query e non conosce lo schema
Drizzle. Le battaglie recenti, con coordinate e caduti reali, arrivano dall'endpoint eventi già esistente
(`type=battle`). Non ci sono nuove API né nuove tabelle.

| Modulo (`lib/map-renderer/`)    | Ruolo                                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------------- |
| `projection.ts`, `camera.ts`    | conversioni griglia ↔ mondo ↔ schermo, zoom centrato sul cursore, vincoli, interpolazione         |
| `render-order.ts`               | ordine dei passaggi e ordinamento per profondità (`x + y`) degli sprite                           |
| `tile-renderer.ts`              | un tile: pareti, faccia, acqua e schiuma, campi, fiumi, strade, tinta del territorio, decorazioni |
| `elevation-renderer.ts`         | terrazzamenti e pareti laterali                                                                   |
| `terrain-renderer.ts`           | chunk 16×16 in canvas offscreen, bucket di risoluzione, firma per l'invalidazione, budget LRU     |
| `settlement-layout.ts`          | layout deterministico degli insediamenti (`f(seed, id, indice)`)                                  |
| `building-renderer.ts`          | primitive procedurali: casa, capanna, tenda, magazzino, mura, torre, mercato, tempio, palazzo…    |
| `settlement-renderer.ts`        | sprite degli insediamenti, icone a zoom basso, etichette                                          |
| `border-renderer.ts`            | confini: solo dove cambia proprietario, lati collineari uniti; fronti di guerra                   |
| `route-renderer.ts`             | rotte commerciali ad arco tratteggiato, spessore in base al volume                                |
| `conflict-renderer.ts`          | fronti, campagne, battaglie recenti, calamità, crisi                                              |
| `resource-renderer.ts`          | risorse notevoli con clustering in base allo zoom                                                 |
| `hit-testing.ts`                | selezione con priorità (edificio > insediamento > conflitto > cella), tile rialzati               |
| `asset-registry.ts`             | sprite opzionali con fallback procedurale                                                         |
| `visibility.ts`                 | livelli predefiniti e soglie di zoom                                                              |
| `performance.ts`, `describe.ts` | statistiche di frame; testi di tooltip e annunci                                                  |

**Densità visiva**. I livelli attivi di default sono terreno, rilievo, acqua, fiumi, insediamenti, edifici,
strade, territori e nomi. Risorse, fertilità, commercio, conflitti e griglia debug sono spenti. I dettagli
compaiono con lo zoom (`ZOOM` in `visibility.ts`):

- **da lontano**: biomi, territori con i nomi delle civiltà, icone delle capitali e delle città;
- **a zoom medio**: villaggi, strade, edifici principali;
- **da vicino**: singole case, campi, risorse una per cella, rovine.

Le etichette si scartano se si sovrappongono, con priorità a selezione, capitali e città. Le rotte mostrate sono
solo le 12 più intense e si evidenziano quando è selezionato un insediamento. Ogni guerra è **un** fronte, cioè i
lati condivisi dai due territori, oppure una freccia di campagna, con un'icona che apre il pannello della guerra.

**Insediamenti**. Il livello visivo deriva da `tier`: accampamento, villaggio, città (`town`), città-stato e
capitale. La capitale è anche il `capitalSettlementId` di una civiltà attiva. Numero di case, magazzini,
mercato, tempio, pozzo, fornaci, caserme, mura o palizzata, miniere, cave e porto seguono i conteggi reali di
`buildings`. Le posizioni sono deterministiche e stabili: quando un villaggio cresce, le case esistenti restano
dove sono. I tile più alti davanti a un insediamento vengono ridisegnati sopra i suoi edifici, così una casa
dietro una collina non viene dipinta sopra la collina.

**Prestazioni** (Chromium headless senza GPU, mondo 96×96 con 43 insediamenti, viewport 820×780):

| Vista                | Tempo di frame | Tile visibili | Entità | Chunk visibili |
| -------------------- | -------------- | ------------- | ------ | -------------- |
| Mappa intera (0,13×) | ~0,7 ms        | ~8.900        | 13     | 36             |
| Zoom medio (0,46×)   | ~2,8 ms        | ~2.900        | ~800   | 21             |
| Zoom alto (2,6×)     | ~3 ms          | ~95           | ~45    | 6              |

Il terreno statico è cotto in chunk che vengono rifatti solo quando cambia la firma delle loro celle (bioma,
quota, proprietario, strade, campi, fiumi) o i livelli. Un avanzamento della simulazione ricostruisce quindi
solo le zone cambiate. Oltre una scala di 2,5 pixel di dispositivo per pixel di mondo i tile visibili si
disegnano direttamente, per nitidezza. La camera, l'hover e le animazioni vivono in ref: pan e zoom non
causano re-render React e il ciclo `requestAnimationFrame` si ferma quando nulla cambia. Il pannello
prestazioni (icona a forma di insetto) mostra FPS, tempo di frame, tile ed entità visibili, chunk e tempo di
hit test.

**Asset grafici**. Oggi tutto è procedurale, quindi la mappa non dipende da file esterni. Per usare uno
spritesheet, mettilo in `public/assets/map/` e registra ogni sprite all'avvio:

```ts
import { sharedAssetRegistry } from "@/lib/map-renderer";

const image = new Image();
image.src = "/assets/map/buildings.png";
sharedAssetRegistry.register("building:house", {
  kind: "sprite",
  image,
  frame: { x: 0, y: 0, width: 48, height: 48 }, // riquadro nello spritesheet (es. da un JSON TexturePacker)
  anchorX: 24, // punto a terra dentro l'immagine
  anchorY: 42,
  scale: 0.5,
});
```

Finché l'immagine non è caricata, o se manca, `registry.get` restituisce il disegno procedurale: il rendering
non si rompe mai. Lo sprite viene scelto al momento del disegno, quindi uno caricato dopo l'apertura della mappa
compare dal primo frame che la mappa ridisegna. Gli id disponibili sono `building:<tipo>` (vedi `BuildingKind` in `settlement-layout.ts`).

**Accessibilità**. Tutti i dati della mappa restano disponibili come testo: elenchi di civiltà, insediamenti,
tribù e figure (pannello «Civiltà e insediamenti»), pannelli di dettaglio, legenda testuale, tooltip con
descrizione della cella o dell'entità. La selezione è annunciata in una regione `aria-live`, così come
l'avanzamento della simulazione. Controlli, lenti e pulsanti hanno `aria-label` e `aria-pressed`, i menu si
usano con frecce, Home/End ed Esc, il focus è sempre visibile. Dalla tastiera: frecce per muoversi, `+`/`−`
per lo zoom, `0` per la vista d'insieme, `Invio` per selezionare al centro, `Esc` per chiudere pannello o
selezione. Territori e capitali non si distinguono solo per colore (bordi, tratteggio, forme diverse nella
minimappa). Su mobile toolbar con pulsanti grandi, livelli e legenda in un pannello dal basso, selezione in un
bottom sheet, minimappa nascosta.

## Modello di simulazione

Un tick corrisponde a un anno. L'anno iniziale predefinito è −10.000.

### Determinismo

- PRNG **sfc32** con stato a 128 bit serializzato in `worlds.rng_state` e riportato su disco a ogni batch.
- La generazione del mondo usa flussi derivati (`seed::altitude`, `seed::rivers`…).
- All'inizio di ogni tick gli array sono ordinati in modo canonico per numero di sequenza, così l'ordine di
  iterazione non dipende da come lo stato è stato caricato o da quanti tick contiene il batch.
- I valori continui sono arrotondati e salvati come `double precision`: il round trip JSON/DB è esatto.

### Mappa

Rumore a valori su più ottave, con una caduta radiale che forma un continente. L'umidità e la temperatura
dipendono dalla latitudine e dall'altitudine. I biomi sono oceano, costa, pianura, foresta, collina, montagna,
deserto e tundra. I fiumi scendono lungo il pendio più ripido fino al mare e rendono più umide le celle vicine.
Da bioma, umidità, clima e fiumi derivano fertilità, acqua, fauna, legname, pietra, giacimenti di rame e ferro
e abitabilità.

### Configurazione della simulazione

Tutti i parametri regolabili vivono in un oggetto `SimulationConfig` validato con Zod
(`packages/simulation-core/src/config.ts`) e salvato sul mondo (`worlds.config`): clima (ampiezza dei cicli,
probabilità di siccità, alluvioni, incendi e inverni rigidi, sovracosto invernale), economia (deperimento,
quota stagionale del lavoro, quota di surplus commerciabile, costo di trasporto), società (anni di malcontento
prima di una rivolta, deriva culturale, inerzia della stabilità), crisi (probabilità e letalità delle epidemie,
anni di carestia prima dell'abbandono) e osservabilità (importanza minima degli eventi salvati, frequenza delle
statistiche per civiltà e degli snapshot). Un mondo con configurazione parziale o non valida viene normalizzato
sui valori di default, mai rifiutato.

### Ordine di un tick

L'ordine è fisso e documentato: lo stesso stato con lo stesso PRNG produce sempre lo stesso stato successivo.

1. **Clima e stagioni**: deriva lenta, anomalia dell'anno, quattro stagioni, calamità (siccità, alluvioni, incendi).
2. **Risorse**: rigenerazione logistica di fauna e legname, recupero della fertilità a riposo.
3. **Bisogni, ruoli e salute**: comunità (bande o insediamenti), leader, assegnazione dei ruoli.
4. **Assegnazione del lavoro**: ogni persona sceglie un'azione con una funzione di punteggio pesata.
5. **Produzione**: raccolta, caccia, pesca, agricoltura, allevamento, estrazione, artigianato, costruzione.
6. **Distribuzione e consumo**: redistribuzione tra villaggi della stessa tribù, razionamento secondo la
   politica distributiva, deperimento, limiti di magazzino, fame e salute.
7. **Demografia**: coppie (anche fra comunità amiche), nascite, invecchiamento, mortalità, epidemie, istruzione.
8. **Migrazione**: spostamento delle bande, scissioni, fusione dei gruppi minuscoli.
9. **Infrastrutture**: fondazione di insediamenti, cantieri, manutenzione, colonie, secessioni, abbandono, territorio.
10. **Tecnologia**: ricerca e adozione interna.
11. **Cultura e politica**: deriva culturale, forma di governo, stabilità, distribuzione, rivolte e colpi di stato.
12. **Commercio**: scambi fra comunità in contatto, con costo di trasporto e mercati.
13. **Diplomazia e conflitti**: scala di tensione, incursioni, dichiarazioni di guerra, alleanze, paci.
14. **Guerra**: battaglie e assedi con le loro conseguenze.
15. **Crisi ed eventi**: scadenza delle crisi, estinzioni, civiltà, soglie di popolazione.
16. **Metriche**: statistiche del tick e, alla frequenza configurata, serie per civiltà e snapshot.

### Invarianti

`checkInvariants(state)` (`invariants.ts`) è un modulo riusabile, chiamato dai test e attivabile in sviluppo con
`runSimulation(state, n, { checkInvariants: true })`. Verifica: popolazioni e risorse mai negative o NaN,
coordinate dentro la mappa, nessun morto nello stato attivo o che agisce, riferimenti fra entità sempre
risolvibili, tecnologie con prerequisiti soddisfatti, insediamenti in celle valide e coerenti con la tribù
proprietaria, relazioni diplomatiche coerenti (nessuna coppia in guerra e alleata, `atWar` sempre allineato allo
stato), eventi con importanza valida e catene causali che puntano solo a eventi realmente emessi in precedenza.

### Azioni individuali

Ogni adulto ha competenze (raccolta, caccia, costruzione, combattimento, artigianato, comando) e personalità
(aggressività, cooperazione, curiosità, tolleranza al rischio, socialità), oltre a prestigio, istruzione e
ricchezza personale. Il ruolo nasce dall'età e dall'incontro tra competenze e bisogni della comunità:
raccoglitore, cacciatore, pescatore, agricoltore, allevatore, minatore, artigiano, costruttore, guerriero,
anziano, guida. L'azione è scelta con una **funzione di punteggio pesata** e un piccolo rumore seedato
(`agents.ts`). Le azioni consumano energia e allenano la competenza usata.

### Clima e stagioni

Un tick resta **un anno**, ma ogni anno viene risolto in **quattro stagioni** deterministiche. Il segnale globale
(anomalia dell'anno, deriva pluridecennale, inverno rigido) si combina con un profilo climatico derivato dal
terreno di ogni cella: temperatura media, escursione stagionale, precipitazioni, rigore invernale, aridità,
rischio di incendio e di alluvione.

- La resa annuale di una cella è la media delle quattro stagioni pesata per la quota di lavoro di ciascuna
  (27% primavera, 31% estate, 29% autunno, 13% inverno), **normalizzata** su una cella temperata di riferimento:
  una terra buona in un anno normale vale ~1, un deserto o una tundra molto meno.
- L'inverno riduce quasi a zero la resa dove il rigore è alto, aumenta il consumo di cibo (fino a +14% modulato
  dal clima locale, di più in un inverno eccezionale) e la mortalità di bambini e anziani; capanne, accampamenti
  e la tecnica degli abiti la attenuano.
- Fiumi e coste danno acqua, pesca, argilla, fertilità e commercio; le zone aride producono meno e sono le prime
  a soffrire la siccità.
- Le calamità non sono mai gratuite: il sito è scelto con un peso per rischio (la siccità colpisce le terre
  aride, l'alluvione fiumi e coste, l'incendio i boschi secchi) fra le regioni abitate, e ogni calamità genera un
  evento con causa, intensità, raggio e durata nei metadata. Le conseguenze successive (carestie, migrazioni)
  citano l'evento originario in `causeEventIds`.

### Economia

Dodici risorse: cibo, acqua, legname, pietra, argilla, pelli e tessuti, rame, stagno, ferro, combustibile,
strumenti, ricchezza. Le quattro storiche restano colonne dedicate, le altre vivono in un sacchetto JSONB;
l'accesso passa sempre da helper type-safe (`getResourceAmount`, `addResource`, `consumeResource`,
`transferResource`, `clampResource`, `hasRequiredResources`) che non producono mai NaN o valori negativi.

Flussi di produzione distinti, ognuno con i propri requisiti: **raccolta**, **caccia** (dà anche pelli),
**pesca** (serve fiume o costa; il porto la potenzia), **agricoltura** (campi, fertilità, irrigazione),
**allevamento** (pascoli: cibo e pelli anche d'inverno), **estrazione** (giacimenti finiti di rame, stagno,
ferro, carbone e argilla; le miniere si esauriscono), **artigianato** (la fonderia trasforma minerale e
combustibile in strumenti) e **costruzione**. Ogni flusso dipende da lavoratori idonei, età, salute, abilità,
stagione, bioma, risorse disponibili, strumenti posseduti, tecnologie, infrastrutture e clima locale.

Scorte e conservazione: ogni gruppo ha un magazzino con capacità massima (base + magazzini + fornaci +
moltiplicatore tecnologico), il cibo deperisce del 25% l'anno (dimezzato dalla ceramica, ridotto dalla
conservazione degli alimenti), pelli e tessuti si rovinano, gli strumenti si consumano con l'uso.

Distribuzione: le risorse entrano nel magazzino del gruppo, si soddisfano prima i bisogni essenziali e in
carenza si applica la **politica distributiva** della tribù — egualitaria, orientata ai lavoratori, ai guerrieri
o alle élite. Una distribuzione iniqua sfama prima chi combatte o comanda, ma erode coesione e alza la tensione
sociale: un vantaggio nel breve periodo pagato nel lungo.

### Demografia, famiglie e dinastie

- Probabilità annua di nascita per donna 16–45 in coppia, con partner nella stessa comunità:
  0,24 · cibo · intenzione · età · sicurezza · alloggio · salute. È zero se la madre ha fame > 0,6, salute < 0,4
  oppure se la copertura del fabbisogno è sotto l'80%. Minimo due anni tra un parto e l'altro.
- Ogni persona ha madre, padre, eventuale partner, nucleo familiare, insediamento di nascita ed eventuale
  dinastia. Sono escluse le unioni fra consanguinei diretti (genitori, figli, fratelli e fratellastri).
- Prestigio, istruzione e ricchezza crescono con il lavoro, i successi e l'insegnamento degli adulti; alla morte
  la ricchezza e parte del prestigio passano ai figli, e ciò che nessuno reclama torna al gruppo.
- Mortalità naturale per fasce d'età (10% nel primo anno, 35% oltre gli 85), modulata da salute, tecnologia e
  rigore dell'inverno.
- `populationSoftCap` (1.500) è solo una protezione per le prestazioni; i limiti reali sono cibo e alloggi.

### Leadership e successione

La guida non viene sorteggiata: il punteggio combina età, prestigio, abilità di comando, ricchezza, successi in
guerra, conoscenza, appartenenza dinastica e sostegno del gruppo, con **pesi che dipendono dalla forma di
governo** (consenso, anzianità, forza, eredità, elezione). La successione scatta per morte, incapacità (età o
salute) o perdita di legittimità. Nascite, ascese, fondazioni, morti e successioni generano eventi; le figure di
rilievo (guide, fondatori, inventori, comandanti) sono consultabili nel dettaglio.

#### Case regnanti

Un capo trasforma il comando in una **casa regnante** quando c'è qualcosa da trasmettere: prestigio ≥ 0,5,
gerarchia ≥ 45, centralizzazione ≥ 40, legittimità ≥ 0,45, almeno 60 persone e dei figli a cui lasciarlo
(`canFoundDynasty`). Ogni casa registra la propria **legge di successione** (ereditaria, elettiva, per consiglio,
militare, religiosa, per merito), che segue la forma di governo e viene riletta quando questa cambia: una casa può
sopravvivere alla regola che l'ha creata. Registra inoltre la propria **legittimità**, il capo in carica, il numero
di sovrani dati, le crisi attraversate e — quando finisce — lo stato (`overthrown`, `extinct`, `merged`) con la
causa (`no_heir`, `usurpation`, `extinct_people`, `merged`, `reform`). Una casa non viene mai cancellata.

#### Crisi di successione

Finché una casa regna, il passaggio di potere può andare male. `successionCrisisRisk` è una funzione pura che
somma le cause reali: più pretendenti con prestigio ravvicinato, un erede ancora minorenne (`MAJORITY_AGE`), la
morte improvvisa del sovrano, una casa screditata, istituzioni debilitate, potere disperso, vassalli inquieti. Un
erede unico in una casa solida ha rischio **esattamente zero**; senza eredi la crisi è certa.

L'esito è uno fra `peaceful`, `regency` (reggenza fino alla maggiore età), `disputed` (trono conteso),
`usurpation` (lo prende chi non apparteneva alla casa, che cade) e `interregnum` (nessun successore). Ogni esito
è scritto nei metadata dell'evento di successione insieme al rischio calcolato e alla causa; le crisi costano
legittimità alla casa e al popolo e aprono una crisi di tipo `succession`. Una casa spodestata può **tornare al
potere** attraverso un discendente, ma non prima di dieci anni e solo dove il potere si trasmette ancora per
sangue (`restoreDynasty`): gli anni fuori dal potere restano nel record.

#### Guerra civile e frammentazione

Quando il trono è conteso da qualcuno che può davvero contenderlo — un fratello di pari rango o, assai più
spesso, una figura potente fuori dalla casa — la successione può essere decisa con le armi
(`CIVIL_WAR_RISK`, `CIVIL_WAR_MIN_CLAIMANTS`). Costa vite, ordine, coesione e legittimità. Se il perdente
tiene un insediamento suo, il popolo **si spezza**: nasce un secondo governo dello stesso popolo, con la
stessa identità, le stesse tecniche e la stessa credenza, e una relazione che parte da nemici.

La separazione usa la stessa funzione della secessione (`forkTribe`): un popolo che si divide per una guerra
di successione e uno che si divide per lontananza producono lo stesso tipo di successore, e differiscono solo
nella relazione da cui partono.

_Misura_: 1 guerra civile e 1 frammentazione su 10 mondi × 600 tick. Un primo tentativo che richiedeva **due
fratelli rivali** produceva 0 casi, perché un sovrano lascia raramente più di un figlio idoneo.

#### Matrimoni dinastici

Due case regnanti possono legarsi con un matrimonio (`marryHouses`), registrato come accordo diplomatico: la
sposa raggiunge il popolo dello sposo, entrambi restano della propria casa, e la fiducia fra i due popoli
sale. Le età ammesse partono sotto l'età adulta perché le unioni dinastiche erano promesse fra ragazzi; non ne
nasce nulla prima dei 16 anni, che è l'età fertile del motore.

### Credenze e sistemi di valori

Non esiste nessuna religione reale nel codice. Una **credenza** nasce fra un popolo diventato abbastanza
spirituale (`BELIEF_MIN_SPIRITUALITY`, tarata sulla distribuzione che il motore produce davvero) e grande
abbastanza da sostenerne i riti (`BELIEF_MIN_POPULATION`), e prende la forma di quello che quel popolo ha
davanti: un grande fiume, il sole sopra il deserto, le montagne, i propri morti, uno stato che vuole essere
sacro, una scuola che discute. `beliefTypeFor` è puro e **non legge l'identità storica**: due popoli sullo stesso
fiume producono lo stesso tipo di culto, qualunque nome portino.

Ogni credenza ha autorità, tolleranza e pressione missionaria; da queste derivano coesione, legittimità e
attrito (`applyDerivedEffects`): più una credenza presta autorità a chi governa, meno facilmente convive con
un'altra. Gli effetti sulla stabilità **scalano con l'adesione** del popolo (`beliefEffects`), che cresce nella
quiete e si incrina con la fame e la guerra (`adherenceDrift`); una fede prosciugata lascia il popolo senza
credenza, con un evento dedicato. La differenza di credenze entra nella distanza culturale usata dalla
diplomazia (`beliefDistance`), con peso 0,25 contro 0,75 dei tratti culturali.

I **missionari** portano una credenza ai vicini in contatto: la probabilità dipende da quanto quella credenza
spinge verso l'esterno, da quanto il popolo che la riceve è tollerante e aperto, e da quanto tiene alla propria
fede — chi crede ancora fermamente non si converte (`CONVERSION_MAX_HOLD`). Uno **scisma** nasce quando un
popolo pratica da tempo una credenza fondata da altri, la sua cultura se ne è allontanata e quel culto chiede
molto e concede poco: il ramo che nasce è più severo e meno tollerante di quello da cui si è staccato, e tiene
il genitore agli atti.

Il **sincretismo** unisce due culti di popoli che sono stati vicini e indisturbati per una generazione
(`SYNCRETISM_YEARS`), entrambi tolleranti e aperti. Non richiede fiducia diplomatica: in questo motore la
fiducia si accumula solo col commercio attivo, e due popoli possono restare in pace per tre secoli con fiducia
zero — che è esattamente la situazione in cui i riti si mescolano. I due culti d'origine non vengono cancellati:
passano a `absorbed` e restano citati come genitori del nuovo.

Conversione e sincretismo non competono: si converte chi ha una fede debole, si fondono i riti di due popoli
che credono entrambi fermamente e quindi non possono convertirsi a vicenda.

_Misura_ (10 mondi × 600 tick): 39 credenze fondate, **27 conversioni**, **5 scismi**, 0 sincretismi; i popoli
vivi che seguono una credenza salgono dal 54% al **67%**.

### Accordi diplomatici e reputazione

`Relationship` dice come due popoli si sentono l'uno verso l'altro. Gli **accordi** dicono che cosa hanno
davvero messo per iscritto, e la **reputazione** che cosa ciascuno è noto per fare di quella firma: sono tre
cose diverse, e un popolo può essere benvoluto e allo stesso tempo famoso per stracciare i patti.

Sette tipi si negoziano da soli (commercio, non aggressione, passaggio, scambio di conoscenze, alleanza
difensiva, alleanza militare, garanzia d'indipendenza); tributo, embargo e pace sono conseguenze che il motore
registra, non proposte. Ogni tipo dichiara la fiducia che richiede, l'ostilità che tollera e la durata; le
soglie sono lette sulla distribuzione che questo motore produce davvero, non su ideali 0–1. Nessuno firma con
chi ha `treatyRespect` sotto 0,25.

Dichiarare guerra a chi aveva firmato **rompe tutti i patti in piedi con quella coppia** e lo mette agli atti
di chi ha attaccato: `treatyRespect` −0,20, `reliability` −0,15. La reputazione (`reliability`, `aggression`,
`tradeReliability`, `treatyRespect`, `threatLevel`) si muove lentamente e **solo per quello che è successo**.

La reputazione ha effetti reali: `knowledgeOpenness` decide quanto sapere passa fra due popoli. Uno scambio di
conoscenze firmato più che raddoppia il flusso, un embargo lo azzera quasi, e un popolo non mostra le proprie
botteghe a chi considera pericoloso o inaffidabile.

### Crisi e resilienza

La **resilienza non è una statistica che il motore ricorda e fa derivare**: è ricalcolata ogni anno da quello
che il popolo ha davvero — scorte, terre libere, rete di città, strade, tecnologie _effettivamente adottate_,
un governo ancora in grado di dare ordini, vicini disposti ad aiutare. Nove indicatori, tutti 0–1, più un
valore complessivo (`overallResilience`).

Le tecnologie contano **in proporzione a quanto sono adottate**: una conservazione degli alimenti conosciuta ma
usata al 10% protegge quasi quanto non averla.

Quando arriva il colpo, `rankCrisisResponses` classifica dieci risposte possibili (razionamento, migrazione,
commercio, riforma, repressione, redistribuzione, colonizzazione, guerra, richiesta d'aiuto, abbandono) con un
punteggio **e il motivo** di quel punteggio. La scelta è deterministica e finisce nei metadata dell'evento di
carestia, così la cronologia può dire _perché_ quel popolo ha razionato invece di marciare. Senza un vicino più
debole a portata, la guerra vale esattamente zero: la fame non basta a giustificarla.

### Insediamenti e infrastrutture

### Informazione incompleta e spionaggio

Il motore conosce la verità; i popoli no. Per ogni altro popolo incontrato, ciascuno tiene un record
(`CivilizationKnowledge`) di **stime**: quanti sono, quanto sono forti, quanto sono ordinati, quali tecniche
usano, se sono ostili — ognuna con fiducia, anno e fonte. Gli esploratori vedono dove vivono e più o meno quanti
sono; i mercanti contano le teste e vedono gli attrezzi in uso; gli ambasciatori capiscono le intenzioni; la
battaglia misura l'esercito. Ogni anno senza notizie la fiducia scende (`KNOWLEDGE_DECAY`), sotto una soglia
la stima diventa «voce» e poi si dimentica; resta solo l'ultima posizione nota.

L'errore è **deterministico** (hash del seme, della coppia, del tipo di dato e dell'anno) e cresce al calare
della fiducia: a fiducia piena la stima è esatta, a fiducia zero può sbagliare fino all'80%.

Lo **spionaggio** si rivolge a rivali e nemici, raramente (`spyEffort`): riuscito porta stime sicure e un po'
del sapere del bersaglio; ingannato porta un errore sicuro di sé; scoperto alza l'ostilità. La **decisione di
dichiarare guerra si basa sulla stima** (`perceivedPower`), la battaglia sulla realtà: un popolo che
sopravvaluta il proprio vantaggio attacca e perde, e l'evento lo dice («da una stima del nemico più ottimista
del vero», con `advantage` percepito e `realAdvantage` nei metadata).

Filtraggio per osservatore: `/civilizations/:id/knowledge` restituisce **solo** il record dell'osservatore —
il contratto non ha un campo che possa trasportare la verità — e le tecniche «viste nei vicini» di
`/discoverable` vengono dalla conoscenza, non da ciò che i vicini usano davvero.

### Causalità: perché è successo

Ogni evento porta le proprie cause (`causeEventIds`). Molte però sono emesse in un batch precedente e non sono
più in memoria: una pace arriva anni dopo la guerra che chiude. Per questo ogni popolo tiene pochi
**ancoraggi causali** (`causality.ts`): l'ultima guerra con ciascun nemico, l'ultima carestia, l'ultimo
collasso, l'ultima morte del sovrano, l'ultima rivolta, l'ultima tecnica perduta. Gli eventi successivi li
citano se sono abbastanza recenti: la battaglia cita la guerra, la pace la guerra che chiude, il crollo la
carestia, la successione la morte del sovrano, la riscoperta la perdita. Sono al massimo 24 per popolo e
vengono rilasciati quando la loro storia si chiude.

Il pannello «Perché è successo?» risale la catena **nel database** (`/events/:eventId/causality`): cause fino
a quattro livelli e conseguenze dirette, una query per livello. Prima le cause si vedevano solo se capitavano
sulla stessa pagina della cronaca.

#### Replay

Il motore è deterministico e porta il proprio generatore dentro lo stato: uno snapshot preso al tick N e
rigiocato per M tick deve riprodurre, evento per evento, quello che la corsa originale ha prodotto fra N e
N+M. `replay.ts` lo verifica confrontando l'hash dello stato e la firma di ogni evento, e dice dove le due
storie smettono di coincidere. È verifica, non un secondo motore: non simula nulla di proprio.

```bash
npm run simulation:replay -- --seed test-003 --snapshot 100 --ticks 100
```

Indice GIN su `cause_event_ids`: **non aggiunto**, dopo aver misurato il piano. La ricerca delle conseguenze
(`@>` su JSONB) usa l'indice per mondo e filtra: 7,6 ms su 20.000 eventi nello stesso mondo, contro qualche
migliaio in un mondo reale a 500 tick. L'indice costerebbe su ogni inserimento di evento — la tabella con più
scritture — per risparmiare millisecondi su un click. Da rivalutare oltre i 100.000 eventi per mondo.

### Insediamenti e infrastrutture

- **Fondazione**: banda con ≥ 25 persone, ferma da ≥ 8 anni, fabbisogno coperto, scorte, cella con abitabilità
  ≥ 0,5, nessun villaggio entro 4 celle e agricoltura conosciuta (oppure sito eccezionale su fiume o costa).
- **Livelli guadagnati**, non concessi dal calendario: accampamento → villaggio → città → città-stato →
  capitale, ognuno con condizioni verificabili di popolazione, stabilità alimentare (una carestia in corso
  blocca la promozione), magazzini, infrastrutture, sicurezza e tecnologie.
- Diciassette tipi di edificio: accampamento, capanne, magazzino, campo, pascolo, pozzo, cava, miniera, fornace,
  fonderia, mercato, tempio, caserma, palizzata, mura, strada, porto. Ognuno ha prerequisiti (tecnologia e
  livello), costo in risorse, lavoro richiesto, manutenzione ed effetti quantitativi.
- **I cantieri non sono istantanei**: il progetto elenca risorse richieste e consegnate, lavoro richiesto e
  completato, cella, stato (`planned`, `building`, `paused`, `completed`, `abandoned`) e anno di inizio. Finché
  i materiali non arrivano il cantiere resta fermo; l'interfaccia mostra che cosa manca. Gli edifici con
  manutenzione decadono se il gruppo non riesce più a mantenerli.
- **Territorio a influenza**: ogni insediamento proietta influenza (livello, popolazione, strade, tempio,
  mercato, capitale) che decade con la distanza; dove due insediamenti si sovrappongono vince l'influenza
  maggiore, e la terra che nessuno raggiunge più torna libera.
- Colonie dai villaggi sovraffollati. Secessione possibile delle colonie lontane, più probabile con malcontento
  e tensione, più rara con scrittura e leggi.
- Abbandono dopo 3 anni di carestia o sotto i 6 abitanti: i superstiti si rifugiano in un altro villaggio o
  tornano nomadi.
- **Civiltà**: tribù con almeno 2 insediamenti e 100 abitanti.

#### Memoria storica di un luogo

Ogni insediamento porta con sé un riassunto compatto di sé stesso (`SettlementHistory`), deliberatamente
limitato perché viaggia in ogni payload: la cronologia completa resta in `historical_events` e si interroga a
richiesta.

- **Perché è stato scelto** (`foundingReason`): letto una volta sola, alla fondazione, da terra e circostanze —
  migrazione, terra fertile, posizione di scambio, punto da presidiare, luogo di culto, giacimento, sede di
  governo, rifugio. Non viene mai ricalcolato.
- **Per cosa è conosciuto** (`specializations`): ricalcolato da ciò che il luogo ha davvero — campi e pascoli,
  miniere e cave, caserme e mura, mercato, porto, tempio, fornace, e lo status di capitale.
- **Il massimo che è stato**: popolazione di picco e anno.
- **Distruzioni e ricostruzioni**, anni passati sotto occupazione, **periodi come capitale** (solo l'ultimo può
  essere ancora aperto) e una lista **limitata** (`MAX_NOTABLE_EVENTS`) degli eventi che l'hanno segnato.

Un luogo abbandonato non è finito: una banda che si ferma dove stava una città **vi rientra** invece di fondarne
una seconda accanto alle rovine (`reviveSettlement`). Mantiene nome, anno di fondazione, fondatore e tutto ciò
che era stato; `reconstructions` sale di uno. Solo una parte di quello che stava in piedi sopravvive
(`survivingInfrastructure`: −3% per ogni anno di abbandono), e dopo `RUINS_FORGOTTEN_AFTER` anni le rovine non
sono più riutilizzabili.

### Tecnologie

Ventidue tecnologie in quattro categorie: **sopravvivenza** (fuoco, utensili di pietra, abiti, conservazione degli
alimenti, pesca), **neolitico** (agricoltura, ceramica, allevamento, tessitura, irrigazione, ruota, costruzione
avanzata), **metalli** (rame, fonderia, bronzo, ferro, attrezzi metallici) e **organizzazione** (scrittura,
tassazione, leggi, organizzazione militare, commercio a lunga distanza). Ognuna dichiara prerequisiti,
popolazione minima, eventuale obbligo di insediamento, requisiti materiali e geografici, costo, effetti misurabili
e, dove esiste, una **contropartita** (il bronzo dipende dallo stagno, spesso da importare; la tassazione alimenta
malcontento e corruzione; le rotte commerciali portano anche le epidemie).

Il progresso non è un interruttore: una tecnologia passa da sconosciuta a in osservazione, sperimentazione,
sviluppo, scoperta, diffusione e infine **adozione**, e può poi tornare indietro fino a essere **perduta**. Gli
effetti valgono in proporzione al livello di adozione, che cresce con popolazione, ordine e cultura
dell'innovazione ed è frenato dal tradizionalismo. La conoscenza si diffonde con il commercio (alta probabilità
fra partner frequenti), la convivenza (lenta), la migrazione (trasferimento parziale) e la conquista (accesso
immediato, adozione lentissima).

#### Il catalogo è globale, lo stato è locale

`TECHNOLOGIES` è un catalogo di definizioni condiviso da tutto il mondo; **quello che un popolo sa è suo e
soltanto suo**, e vive in `Tribe.techs`, `techProgress`, `techAdoption` e `techLost` (in database:
`world_technologies`, con chiave primaria `(world_id, tribe_id, tech_id)`). Una scoperta non sblocca mai nulla
per gli altri: chi vuole quella tecnica deve svilupparla da sé o riceverla da chi la usa davvero.

Tutti i popoli partono **esattamente dalle stesse tecnologie** (`STARTING_CIVILIZATION_STATE`): nessuno riceve
l'agricoltura perché si chiama Egizi, la scrittura perché si chiama Sumeri o l'ingegneria perché si chiama
Romani. L'identità storica è colore, nomi ed estetica, mai un bonus tecnologico.

#### Perché due popoli non seguono la stessa strada

Ogni anno un popolo dispone di un **budget di ricerca** (`researchBudget`) costruito da contributi nominati e
testabili: adulti curiosi e istruiti, surplus alimentare, moltiplicatore d'innovazione delle tecniche già in uso,
sostegno del capo, spinta culturale, stabilità interna, densità urbana e contatti esterni. Quel budget non viene
spalmato su tutto ciò che è ricercabile: `allocateResearch` lo **distribuisce per quote**, pesate da

- **affinità** — che cosa offre la terra intorno (argilla, rame, un fiume, suolo fertile);
- **bisogno** — fame, guerra, commercio, materiali, amministrazione, freddo;
- **inclinazione** — una propensione stabile del popolo per una famiglia di tecniche, derivata per hash dal seme
  del mondo e dall'id della tribù (`researchAptitude`), mai dall'identità storica.

Le quote sono concentrate (`RESEARCH_FOCUS`), così un popolo insegue davvero quello che gli serve invece di
avanzare su tutti i fronti: è questa la ragione per cui, a parità di partenza, i percorsi divergono per ordine,
ritmo e contenuto.

#### Perdita e riscoperta

Una tecnica che il gruppo non riesce più a praticare si spegne gradualmente: `knowledgeStrain` misura la
pressione (troppe poche braccia per i suoi specialisti, villaggi perduti, ordine crollato, anni di carestia) e
l'adozione scende anno dopo anno finché la conoscenza è **perduta**, con evento dedicato e la causa nel testo.
Un popolo sano non perde mai nulla: senza pressione la deriva è esattamente zero. Le tecniche senza prerequisiti
— il fuoco, gli utensili di pietra — non si perdono: ogni generazione le ritrova vivendo.

Il registro `techLost` conserva l'anno della perdita per sempre. Chi la ritrova paga un costo ridotto
(`REDISCOVERY_SPEED`): restano le rovine, gli attrezzi, i racconti degli anziani. La riscoperta genera un evento
con `subtype: "rediscovery"` e l'anno in cui la tecnica era stata perduta.

#### Varianti locali

Una tecnica ha una forma locale solo quando la terra la richiede davvero: l'agricoltura su un fiume che
esonda diventa **Coltura delle Piene**, sulle colline **Coltivazione a terrazze**; la pesca su una costa aperta
diventa **Pesca d'altura**. Nove forme per sette tecniche, scelte da `variantFor` leggendo l'area lavorata —
mai l'identità storica: due popoli sulla stessa costa pescano allo stesso modo. Chi impara una tecnica da un
altro popolo la adatta alla **propria** terra. Ogni forma porta un piccolo effetto coerente con l'ambiente (un
solo moltiplicatore, al massimo +12%), scalato dall'adozione come ogni effetto tecnologico, e si perde insieme
alla tecnica. Il nome locale compare nella cronaca, nelle schede e nell'API (`localName`, `localDescription`,
`localCause`).

### Cultura, governo e stabilità

Ogni tribù ha nove **tratti culturali** normalizzati 0–100 — cooperazione, militarismo, apertura al commercio,
tradizionalismo, centralizzazione, gerarchia sociale, spiritualità, innovazione, espansionismo — generati
proceduralmente dal seed (nessun riferimento a popoli reali) e soggetti a deriva lenta guidata da ciò che il
gruppo vive davvero: guerre, scambi, carestie, scoperte, espansione, complessità.

Alla pressione si somma una **disposizione** stabile per tratto (`cultureDisposition`, ±16 punti), derivata per
hash dal seme del mondo e dall'id della tribù. Serve a impedire che la sola deriva faccia convergere tutti sugli
stessi numeri: due popoli che vivono la stessa storia non diventano lo stesso popolo, perché leggono gli stessi
fatti in modo diverso. Come per l'inclinazione tecnologica, non dipende dall'identità storica e non costa stato:
i mondi salvati prima che esistesse la ricevono al caricamento senza migrazione.

Ai nove tratti originari se ne aggiungono quattro: **tolleranza** (quanto il popolo vive bene accanto a chi è
diverso), **esplorazione** (quanto va a vedere cosa c'è oltre), **capacità amministrativa** (quanto di sé
riesce davvero a governare) e **coesione culturale** (quanto i suoi membri si sentono una cosa sola). Reagiscono
a due nuove pressioni: la convivenza con popoli diversi e la forza di una credenza condivisa.

Ogni popolo tiene un **registro delle variazioni** (`cultureHistory`): per ogni scostamento superiore a
`CULTURE_RECORD_THRESHOLD` salva anno, tratto, valore precedente e nuovo, la pressione responsabile e il motivo
in chiaro. È un anello limitato a `MAX_CULTURE_HISTORY` voci, perché viaggia con ogni tribù in ogni payload.
Il registro viene scritto percorrendo un **ordine canonico dei tratti** (`CULTURE_TRAITS`) e non
`Object.keys`: JSONB non conserva l'ordine delle chiavi, e una cultura ricaricata dal database itererebbe
diversamente da una costruita in memoria.

Le **forme di governo** evolvono un passo alla volta al raggiungimento delle condizioni: clan → consiglio degli
anziani → chiefdom → monarchia tribale → città-stato → repubblica mercantile, con regressione possibile quando
il gruppo si riduce. Ognuna determina tassazione, rapidità decisionale, legittimità di base, rischio di rivolta,
capacità militare, innovazione, commercio e regola di successione.

La **stabilità** è misurata da benessere, coesione, legittimità, tensione sociale, ordine pubblico, corruzione e
rischio di rivolta, tutti 0–1 e con inerzia: peggiorano con fame, tassazione, distribuzione iniqua, sconfitte,
morte del capo, crisi dinastiche, distanza dal centro, crescita troppo rapida, distanza culturale dai vicini ed
epidemie. Le rivolte e i colpi di stato richiedono **anni consecutivi** sopra la soglia: sono rari e portano
sempre con sé le cause nei metadata.

### Commercio, diplomazia e guerra

Ogni coppia di tribù in contatto (≤ 14 celle) ha fiducia, ostilità, rispetto, volume di scambi, dipendenza
commerciale, distanza culturale, memoria dei conflitti, stato diplomatico (sconosciuti, contatto, neutrali,
partner commerciali, alleati, rivali, guerra, tregua) e fase del conflitto.

- **Commercio** basato su eccedenze e carenze: ciascuno cede ciò che ha in surplus relativo, la distanza costa
  parte del carico (dimezzata dalle strade), mercati e tecnologie aumentano il volume. Gli scambi fanno crescere
  fiducia, ricchezza e diffusione tecnologica, e si interrompono con la guerra o durante un'epidemia (quarantena).
- **Scala di tensione** prima della guerra: pace → tensione → richieste → minaccia → incursioni → guerra
  dichiarata → battaglia o assedio → tregua → pace. Ogni gradino richiede tempo, motivazione e dimensioni
  minime: due manciate di persone non fanno la storia.
- **Battaglia astratta** (`resolveBattle`): potenza = guerrieri · salute/abilità · morale · tecnologia · difesa ·
  terreno · logistica · comando, moltiplicata per un tiro seedato in [0,75; 1,25]. Le mura trasformano l'assalto
  in assedio; la distanza dalla base penalizza l'attaccante. Il perdente perde il 10–40% dei combattenti, il
  vincitore il 3–12%. Seguono saccheggio (con distruzione di edifici), calo del morale e della legittimità e,
  con vittoria netta su un insediamento indebolito, **occupazione** esplicita: l'insediamento resta del
  proprietario finché l'occupazione non si risolve in annessione, liberazione, autonomia o restituzione (vedi
  [Vassallaggi e occupazioni](#vassallaggi-e-occupazioni)). Solo con l'annessione popolazione e territorio
  passano al vincitore, che acquisisce anche le tecnologie dei vinti. I vassalli inviano una leva alle battaglie
  del signore.
- La pace arriva per stanchezza o sfinimento, con una tregua di 20–40 anni; imposta da un vincitore molto più
  forte può trasformare il vinto in vassallo.

### Crisi, epidemie e collassi

Le **epidemie** non scoppiano a caso: servono densità abitativa, scarsa igiene, fame e contatti. Il rischio è
calcolato e leggibile (`epidemicRisk`), la letalità dipende da salute, densità, stagione e conoscenze, e i
sopravvissuti restano immuni per una generazione. Durante un'epidemia il commercio si interrompe. Le altre
crisi — siccità, alluvione, incendio, inverno estremo, carestia, rivolta, crisi di successione — seguono lo
stesso schema: condizioni, durata, intensità, evento con cause, conseguenze misurabili. Un insediamento può
decadere, essere abbandonato o conquistato: gli abitanti migrano, muoiono o si uniscono ad altri gruppi, e ciò
che resta torna alla mappa.

### Eventi e catene causali

Ventitré tipi di evento, ognuno con **sottotipo**, importanza 1–5, attori, luogo, titolo, descrizione e metadata
strutturati. Gli eventi sono selezionati, non generati per ogni piccolo cambiamento: un evento identico (stesso
anno, stesso tipo, stessi attori) viene unito invece di essere ripetuto, e la morte di una guida vale quanto pesa
il gruppo che guidava.

| Livello | Significato       | Esempi                                                  |
| ------- | ----------------- | ------------------------------------------------------- |
| 1       | micro-evento      | nascita di un figlio di una guida, prima capanna        |
| 2       | evento locale     | primi scambi, incursione, magazzino completato          |
| 3       | evento importante | carestia, epidemia, successione, scoperta               |
| 4       | evento regionale  | guerra dichiarata, collasso, cambio di forma di governo |
| 5       | svolta storica    | nascita di una civiltà, conquista di una città          |

Gli eventi che nascono da altri eventi portano `causeEventIds`: una carestia cita la siccità che l'ha causata,
una migrazione cita la calamità da cui fugge, le vittime di un'epidemia citano il focolaio. L'interfaccia usa
questi dati per il pannello **«Perché è successo?»**, che ricostruisce la spiegazione da template deterministici
sui numeri del motore — senza alcun modello linguistico.

### Statistiche

Per ogni tick vengono salvate 30 metriche: popolazione, nascite, morti totali e per causa (fame, conflitto,
epidemia), cibo prodotto, consumato e stoccato, surplus, capacità di magazzino, beni prodotti, scambi,
ricchezza aggregata, edifici, insediamenti, civiltà, tecnologie, guerre, battaglie, territorio controllato,
migrazioni, temperatura media, stress climatico, stabilità media e stagione. A frequenza configurabile
(default ogni 5 tick) viene salvata anche una riga per civiltà, usata dal confronto nei grafici.

## Identità storiche

Genesis è una **sandbox di storia alternativa**: i popoli di un mondo possono portare il nome di civiltà
realmente esistite (Egizi, Romani, Maya…), ma il mondo non ne ricostruisce la storia. Il nome è un punto di
partenza estetico e culturale, non una previsione.

### Tre livelli separati

| Livello                                   | Dove                                               | Cosa contiene                                                                                                                                                                             |
| ----------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identità (`HistoricalIdentityDefinition`) | `packages/simulation-core/src/identity/catalog.ts` | catalogo statico e versionato: nome, alias, palette, emblema, profilo dei nomi, tag culturali, modificatori leggeri, descrizione e fonti. Mai date, leader, città, territori o tecnologie |
| Istanza politica (`Tribe`)                | tabella `tribes` (`identity_id`, `identity_type`)  | il popolo dentro uno specifico mondo: può dividersi, essere assorbito o estinguersi                                                                                                       |
| Storia generata                           | eventi, statistiche, dinastie, `civilizations`     | tutto ciò che la simulazione produce: scoperte, leader, stati, guerre, trasformazioni                                                                                                     |

**Scelta del modello: un'identità, più entità politiche.** Una stessa identità può essere portata da più
tribù _solo per discendenza_: una banda che si divide o una colonia che si separa conserva `identity_id` e
registra `parent_tribe_id` ("Egizi del Nord", "Egizi di Naru"). Per questo non esiste un vincolo unico
`(world_id, identity_id)` sulle tribù, che impedirebbe la frammentazione. L'unicità è imposta dove conta:

- nel **roster di fondazione** (`worlds.roster`), dove un'identità compare una volta sola salvo
  `allowDuplicateCulturalIdentity` esplicito (e anche allora con nomi distinti);
- da un **invariante** (`checkIdentityLineage`, controllato a ogni tick nei test) che rifiuta qualsiasi tribù
  con un'identità che non discenda dal roster: un popolo non può ricomparire dal nulla;
- da un secondo invariante: due tribù vive non possono avere lo stesso nome.

Le fini di un popolo sono sempre raccontate da un evento: `tribe_extinct` (estinzione), `migration/absorption`
(assorbimento, con `absorbed_by_tribe_id` e l'identità conservata in `absorbed_identity_ids` dell'ospite),
`conquest/annexation` (alla fine di un'occupazione: l'identità dei vinti entra fra quelle assorbite dal
conquistatore), `fusion` (i popoli d'origine diventano `merged` in un'identità composita), `civilization_transformed/collapse`
(fine di uno stato). Lo stato (`civilizations`) eredita l'identità della tribù fondatrice e prende un **nome
politico** che dipende dal governo raggiunto e da un luogo del mondo ("Confederazione di Naru" → "Regno di
Naru"): ogni cambio genera un evento `civilization_transformed/government` e il nome precedente resta in
`former_names`.

### Catalogo: 30 identità, 10 dell'età moderna

Il catalogo (`identity/catalog.ts`, versione `2026.09-2`) contiene 20 identità antiche, classiche, medievali
e indigene e **10 dell'età moderna e contemporanea**: Francesi, Inglesi, Spagnoli, Portoghesi, Ottomani
(`early_modern`), Italiani, Tedeschi, Russi, Etiopi, Statunitensi (`modern`). Cinesi, Indiani e Giapponesi
erano già presenti come identità uniche e non sono stati duplicati.

Le identità moderne sono **sandbox culturali/visive, non stati già formati**: possono comparire in un mondo
preistorico, partono esattamente come le altre (pietra, accampamento, clan), non ricevono tecnologie, governi o
città moderne, e **non hanno modificatori comportamentali** (gli stereotipi nazionali non sono una meccanica di
gioco). Ogni voce lo dichiara nelle `representationNotes`, e la UI mostra l'avviso «Identità dell'età moderna:
ispirazione culturale e visiva, non uno stato moderno già formato». Un test crea gli **Italiani in un mondo
preistorico** e verifica: utensili di pietra, accampamento, nessuna scrittura né agricoltura, nessuna tecnologia
moderna, leader procedurale (mai un nome riservato), tecnologie successive solo da eventi del mondo, storie
diverse con seed diversi e identiche con lo stesso seed.

Filtri per epoca nella UI e in `GET /api/historical-identities?era=`: antiche, classiche, medievali,
**moderne** (`early_modern` + `modern`), indigene, regionali (oggi vuota, filtro disabilitato con conteggio 0).

Ogni identità dichiara esplicitamente la partenza comune (`uniformStart`: `defaultGovernment: "clan"`,
`startingTechnologies: ["stone_tools"]`, `startingInfrastructure: ["camp"]`, `startingPopulationRange:
[15, 40]`): lo schema Zod accetta **solo** questi valori letterali, e `STARTING_CIVILIZATION_STATE` deriva
dalla stessa costante.

### Linguaggio naturale

Ogni identità ha un profilo grammaticale (`language`: `singularNoun`, `pluralNoun`, `adjective`,
`adjectiveFeminine`, `collectiveName`, `articleGender`, `politicalNamePatterns`, `leaderTitlePatterns`,
`settlementNamePatterns`) e il motore scrive i testi con template controllati
(`language/italian.ts`, `language/format.ts`): ogni popolo, stato, leader o insediamento è un _sintagma
nominale_ con genere e numero, quindi articoli, preposizioni articolate e verbi concordano sempre.

- Popoli storici e compositi: plurale con articolo («**Gli Egizi** hanno fondato…», «dagli Inca», «dei
  Romano-Celti»). Mai «la tribù Egizi».
- Popoli procedurali/legacy: il nome inventato resta il nome di una tribù, al singolare («**La tribù Kanar** è
  nata», «della tribù Kanar»).
- Stati: il genere viene dalla forma politica («**Il Regno di Naru** ha dichiarato guerra **alla Lega
  Romana**», «Crolla il Regno…»). In diplomazia agisce lo stato se esiste, altrimenti il popolo.
- Leader: titolo dal governo prodotto dalla simulazione («re Menka», «regina Iria», «Menka, guida del clan»).
- I nuovi stati di un popolo storico scelgono (in modo deterministico, da un flusso derivato da seed + id) un
  pattern del profilo: «{forma} di {capitale}» oppure «{forma} {aggettivo}» con accordo («Regno Egizio»,
  «Lega Egizia»); il pattern è salvato in `name_pattern` e riapplicato al cambio di governo. Gli stati
  esistenti non cambiano nome.
- API: `formatCivilizationName`, `formatCivilizationSubject`, `formatPoliticalEntityName`,
  `formatLeaderTitle`, `formatEventDescription` (template con `{Art:x}`, `{di:x}`, `{v:x:singolare|plurale}`;
  un parametro mancante è un errore, mai un «{x}» nel testo).

### Posizionamento iniziale: fasce di qualità esplicite

`placement.ts` definisce una `PlacementQualityBand` per dimensione di mappa (piccola < 40×40, grande ≥ 72×72):

| Mappa   | Fascia preferita (qualità minima · scarto massimo) | Fascia di ripiego | Soglia di avviso |
| ------- | -------------------------------------------------- | ----------------- | ---------------- |
| grande  | ≥ 0,55 · ≤ 0,05                                    | ≥ 0,45 · ≤ 0,12   | 0,50             |
| media   | ≥ 0,50 · ≤ 0,08                                    | ≥ 0,42 · ≤ 0,18   | 0,47             |
| piccola | ≥ 0,45 · ≤ 0,12                                    | ≥ 0,40 · ≤ 0,25   | 0,44             |

Il motore prova prima la fascia preferita (acqua per tutti, distanza ampia), poi quella di ripiego, infine
nessun bilanciamento; mai celle d'oceano, montagna o poco abitabili. Il posizionamento usa un flusso proprio
(`deriveRng(seed, "placement")`): è deterministico e non sposta il PRNG della simulazione. Le celle scelte
ruotano di un offset seedato, così il primo slot del roster non riceve sistematicamente il posto migliore
(verificato su 20 seed). Il roster registra per ogni partenza qualità, acqua, fertilità, risorse, penalità
climatica, distanza dalla partenza più vicina e `placementFallback`; il mondo registra fascia, livello usato,
numero di ripieghi, distanza minima e intervallo di qualità. La UI mostra un avviso sulle partenze di ripiego e
il riepilogo nelle informazioni del mondo. Nessun mondo esistente viene modificato retroattivamente.

### Vassallaggi e occupazioni

Una vittoria decisiva su un insediamento **non** lo annette più: crea un'**occupazione** (`occupations`).
L'insediamento resta del proprietario, gli abitanti conservano la loro identità; l'occupante paga la guarnigione
(cibo in base alla distanza), preleva secondo la propria politica (militare, amministrativa, estrattiva,
integrativa — scelta dalla sua cultura), e controllo e resistenza evolvono ogni anno (forza relativa, politica,
distanza culturale, malcontento, vicinanza del proprietario). Esiti: **annessione** dopo anni di controllo saldo
(solo allora l'insediamento passa di mano e l'identità dei vinti entra fra quelle assorbite), **liberazione**
se la resistenza prevale, **autonomia** negoziata dopo una lunga occupazione senza controllo, **restituzione**
con una pace di vassallaggio, abbandono se l'occupante scompare. Un'occupazione mal gestita aumenta la
tensione e riduce la legittimità dell'occupante.

Una pace imposta da un vincitore almeno **due volte più forte**, che occupa insediamenti del vinto o ha vinto
molte battaglie, crea un **vassallaggio** (`vassal_relationships`): il vassallo conserva identità, capitale,
cultura e guida, paga un tributo (leggero/ordinario/pesante secondo la centralizzazione del signore, ridotto
dall'autonomia, con perdite di trasporto), invia una leva alle battaglie del signore nel raggio di 15 celle
(le perdite ricadono sulle sole forze proprie) e non entra nella scala di escalation con il signore. L'autonomia
cresce con la forza relativa e la distanza: al massimo diventa **indipendenza** pacifica; un vassallo forte e
risentito può **ribellarsi** (la relazione passa in guerra), e alla pace la ribellione è vinta (indipendenza) o
repressa (meno autonomia, tributo pesante). Un popolo ha un solo signore alla volta, non può essere vassallo di
sé stesso né, direttamente o indirettamente, del proprio vassallo (invarianti verificati a ogni tick).

Stati diplomatici espliciti: `vassalage` e `occupation`. Stati di continuità esposti dall'API civiltà:
`active`, `successor`, `vassal`, `occupied`, `absorbed`, `merged`, `dissolved`. Tutto è visibile nei pannelli
del popolo e dell'insediamento, nella diplomazia e nella cronologia (eventi `vassalage/*`, `occupation/*`,
`conquest/annexation`). Misura su 20 seed × 250 tick (mappe 48×48, 8 civiltà): **67 occupazioni**, 43 chiuse
con restituzione e **12 sfociate in annessione**, **81 vassallaggi**, 10 ribellioni (4 vinte, 6 represse) e 2
indipendenze, con **zero** violazioni degli invarianti.

### Fusioni e identità composite

Due popoli con identità **diverse** possono fondersi solo dopo condizioni persistenti: alleanza con fiducia ≥
0,6 **oppure** un vassallaggio stretto (autonomia ≤ 0,3) da almeno 20 anni; in entrambi i casi distanza
culturale ≤ 0,22, ostilità ≤ 0,15, vicinanza (≤ 8 celle), almeno 25 persone ciascuno, nessuna guerra o
ribellione. Ogni anno idoneo aggiunge pressione a `relationships.fusion_years` (di più con un nemico comune o
scambi intensi), ogni anno non idoneo la consuma; la fusione avviene solo dopo 30 anni di pressione **e** in un
anno idoneo. Nessun tiro casuale: stessa situazione, stesso risultato.

La fusione crea un'**identità composita** (`composite_identities`) e una nuova istanza politica che la porta:
nome procedurale ma leggibile costruito dalla grammatica delle sorgenti (Romani + Celti → «**Romano-Celti**»,
aggettivo «romano-celtico/a», stato «**Lega Romano-Celtica**»; il popolo più numeroso dà la testa del
composto), fonetica fusa dei due profili, palette mescolata, emblema del popolo maggiore, cultura media pesata e
unione dei tag. Conserva i riferimenti a tutte le identità e le istanze d'origine, che restano nel mondo come
popoli `merged` (mai cancellati); persone, insediamenti, territorio, relazioni con terzi, vassallaggi e
occupazioni passano alla nuova istanza (cicli ereditati spezzati). Un evento `fusion` racconta la nascita; la
stessa combinazione di identità non può fondersi due volte nello stesso mondo (controllo nel motore **e** indice
univoco nel database). Le composite non sono mai presentate come civiltà storiche: la UI le marca «Identità
composita · generata dalla simulazione» ed elenca le identità e i popoli d'origine.

**Frequenza reale.** Con la taratura attuale della diplomazia le fusioni sono **rare**: in 20 seed × 250 tick
non se ne è prodotta nessuna, perché le alleanze non si formano mai (0 su ~7.700 osservazioni di coppie: la
soglia di fiducia 0,7 dell'alleanza non viene raggiunta) e nei vassallaggi il tributo mantiene l'ostilità alta
(0,5–1,0). Le soglie non sono state abbassate per forzare fusioni fra popoli che si detestano: il motore è
pronto e testato, la taratura della diplomazia è nella prossima milestone.

### Partenza uniforme

Ogni popolo di un mondo storico parte da `STARTING_CIVILIZATION_STATE`: utensili di pietra, governo di clan,
accampamento nomade, 0,5 di cibo a testa, nessun insediamento. Con `equalStartingLevel` (default) tutti hanno
anche lo **stesso numero di persone**. Agricoltura, scrittura, metallurgia, navigazione e organizzazione statale
emergono solo dal motore (area, surplus, popolazione, curiosità, contatti), come per i mondi classici.

I **modificatori d'identità** sono al massimo ±5 punti su una scala 0..100 dei tratti culturali (la cultura
iniziale ha già uno scarto casuale di ±30), la loro somma è zero, ogni vantaggio ha un compromesso esplicito, si
applicano una sola volta alla cultura iniziale (che poi deriva liberamente) e si spengono con
`enableIdentityModifiers: false` (preset competitivo). Lo schema Zod del catalogo rifiuta qualsiasi voce che
violi queste regole.

**Neutralità dell'identità.** Nomi di persone, luoghi e successori sono generati da flussi pseudo-casuali
**derivati da seed + id**, mai dal PRNG della simulazione. Ne segue una proprietà verificata dai test: con i
modificatori spenti, due mondi con lo stesso seed e identità diverse (Egizi/Romani/Maya… contro
Inca/Greci/Celti…) producono **esattamente la stessa storia** slot per slot. Il nome non può dare vantaggi.

### Roster e creazione del mondo

`POST /api/worlds` accetta `roster` (schema condiviso con il motore, `civilizationRosterConfigSchema`):

| Modalità      | Effetto                                                           |
| ------------- | ----------------------------------------------------------------- |
| `random-real` | il seed sceglie `civilizationCount` identità (default, 6)         |
| `selected`    | esattamente le identità in `identityKeys`                         |
| `custom`      | le identità scelte, completate a caso fino a `civilizationCount`  |
| `all-real`    | tutto il catalogo (serve una mappa grande: ~60 celle per civiltà) |
| `procedural`  | tribù classiche dai nomi inventati, identiche ai mondi di prima   |

Il roster viene estratto **una sola volta**, in `createWorld`, da un flusso derivato dal seed, ed è salvato in
`worlds.roster`: ricaricare la pagina, rileggere il mondo o riavviare il server non lo rigenera mai. Le chiavi
sono normalizzate nell'ordine del catalogo, quindi la stessa scelta in ordine diverso produce lo stesso mondo.
Chi parte dove è una permutazione indipendente dalle identità: nessuno viene messo nella "propria" regione storica.

Con `balancedPlacement` (default) i punti di partenza seguono le fasce di qualità descritte in
[Posizionamento iniziale](#posizionamento-iniziale-fasce-di-qualità-esplicite); le differenze che restano non
vengono compensate durante la partita: fanno parte del mondo.

### Leader, titoli e nomi

Il leader iniziale è una persona generata dalla simulazione (la più cooperativa e socievole fra gli adulti
della banda), con nome coerente con il profilo fonetico dell'identità. Ogni profilo ha una lista di **nomi
riservati** (sovrani e città storiche) che il generatore non produce mai. I titoli dipendono solo dal
governo effettivamente raggiunto (`politicalTitle`: guida del clan, primo anziano, signore della valle,
re/regina, custode della città, console), mai dalla fama dell'identità. Insediamenti, dinastie ("Casa di
Menka") e stati prendono nomi nuovi, coerenti con l'identità ma inventati.

### Rappresentazione

Le descrizioni del catalogo sono contesto statico, mostrate nella scheda come "Nota storica", e citano opere
di consultazione generale (`sources`). Ogni voce ha `representationNotes` che spiegano semplificazioni ed
etichette moderne (per esempio "Vichinghi" contro "Norreni", "Aztechi" contro "Mexica"). Il modello non usa mai
la categoria "razza" e nessun tratto psicologico è attribuito a un popolo come verità: i modificatori sono lievi,
bilanciati e spegnibili, e la cultura evolve con la storia del mondo. L'interfaccia mostra ovunque il
disclaimer: _"Le identità storiche sono utilizzate come ispirazione culturale e visuale. Gli eventi, i leader
e i percorsi di sviluppo sono generati dalla simulazione e non rappresentano la storia reale."_

Per aggiungere un'identità: nuova voce in `catalog.ts` con `key` stabile (è persistita), colore primario non
ancora usato, profilo dei nomi con i nomi riservati, fonti e note; poi aumentare `IDENTITY_CATALOG_VERSION`.

## API

Tutte le risposte hanno la forma `{ "data": … }` oppure `{ "error": { "code", "message", "details?" } }`.

| Metodo   | Percorso                                                         | Note                                                                                                                                                       |
| -------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST`   | `/api/worlds`                                                    | `{ name, seed?, width?, height?, roster? }` (24–96). Genera mappa, roster, popoli e popolazione. 201 → `{ worldId, world }`                                |
| `GET`    | `/api/worlds`                                                    | elenco dei mondi con riepilogo                                                                                                                             |
| `GET`    | `/api/worlds/:id`                                                | stato e clima, mappa a colonne, tribù (cultura, governo, stabilità), insediamenti, civiltà, relazioni, tecnologie, dinastie, crisi, figure di rilievo      |
| `PATCH`  | `/api/worlds/:id`                                                | `{ status: "running" \| "paused" }`                                                                                                                        |
| `DELETE` | `/api/worlds/:id`                                                | `{ confirmation: "ELIMINA <nome>", worldName }`: 200 eliminato e verificato, 202 in corso (vedi [Eliminazione](#eliminazione-di-un-mondo))                 |
| `GET`    | `/api/worlds/:id/deletion`                                       | stato dell'ultima eliminazione del mondo (job, fase, progresso, righe per tabella)                                                                         |
| `POST`   | `/api/worlds/:id/deletion`                                       | prosegue un'eliminazione già confermata per un budget di tempo (idempotente): 200 completata, 202 in corso                                                 |
| `POST`   | `/api/worlds/:id/simulate`                                       | `{ ticks: 1 \| 10 \| 50 \| 100 }` → riepilogo, eventi principali, metriche, `partial`                                                                      |
| `GET`    | `/api/worlds/:id/events`                                         | `page`, `pageSize` (≤ 100), `type` (lista separata da virgole), `minImportance`, `fromYear`, `toYear`, `actorId`, `search`                                 |
| `GET`    | `/api/worlds/:id/stats`                                          | `{ world, civilizations }`; `maxPoints` (campionamento), `civilizations=true` per la serie per civiltà                                                     |
| `GET`    | `/api/worlds/:id/people/:personId`                               | dettaglio di una persona: condizione, abilità, indole, famiglia, dinastia, conoscenze, eventi                                                              |
| `GET`    | `/api/worlds/:id/civilizations`                                  | popoli del mondo (istanze politiche): identità, stato, leader con titolo, stato politico, predecessori/successori, identità assorbite                      |
| `GET`    | `/api/worlds/:id/civilizations/:civId`                           | scheda: identità, fondazione (tick 0, leader iniziale, tecnologia iniziale, qualità della partenza), primo insediamento, `realHistoryApplied: false`       |
| `GET`    | `/api/worlds/:id/civilizations/:civId/history`                   | storia generata: eventi paginati (`page`, `pageSize`), tecnologie in ordine di scoperta, eventi di guida                                                   |
| `GET`    | `/api/worlds/:id/technologies`                                   | catalogo del mondo con quante civiltà **davvero** possiedono ciascuna tecnologia, pioniere, anno della prima scoperta, quante l'hanno persa                |
| `GET`    | `/api/worlds/:id/civilizations/:civId/technologies`              | stato per popolo: `status`, progresso, adozione, fonte, prerequisiti mancanti. Filtri `status=` e `category=` (CSV), `page`, `pageSize`                    |
| `GET`    | `/api/worlds/:id/civilizations/:civId/technologies/discoverable` | solo ciò che è a portata (in corso, a un prerequisito, già visto nei vicini, o perso), con affinità, peso e requisiti mancanti                             |
| `GET`    | `/api/worlds/:id/technologies/:techId/history`                   | come una tecnologia ha viaggiato in quel mondo: pioniere, chi l'ha presa e come, chi l'ha persa, anni di diffusione, eventi collegati                      |
| `GET`    | `/api/worlds/:id/settlements/:settlementId/history`              | memoria del luogo: ragione della fondazione, fondatore, specializzazioni, picco, distruzioni, ricostruzioni, periodi come capitale, cronologia paginata    |
| `GET`    | `/api/worlds/:id/civilizations/:civId/knowledge`                 | ciò che un popolo **crede** degli altri: stime con fiducia, anno e fonte, mai la verità; i popoli mai incontrati non compaiono                             |
| `GET`    | `/api/worlds/:id/events/:eventId/causality`                      | catena delle cause (fino a 4 livelli, max 40 eventi) e conseguenze dirette, risolte nel database                                                           |
| `GET`    | `/api/historical-identities`                                     | catalogo: `search` (nome, alias, regione), `era` (ancient, classical, medieval, modern, indigenous, regional), `category`, `continent`, `page`, `pageSize` |
| `GET`    | `/api/historical-identities/:key`                                | dettaglio di un'identità, con modificatori, fonti, note e stato iniziale comune                                                                            |
| `GET`    | `/api/cron/advance`                                              | modalità autonoma opzionale, protetta da `CRON_SECRET` (401 se non configurata)                                                                            |

Codici di errore: `INVALID_INPUT` 400, `TICKS_NOT_ALLOWED` 400, `NOT_FOUND` 404, `SIMULATION_IN_PROGRESS` 409,
`WORLD_RUNNING` 409, `WORLD_BUSY` 409 (lock sul mondo non ottenuto entro `lock_timeout`), `CONFIRMATION_MISMATCH`
422, `FORBIDDEN` 403, `TIMEOUT` 504 (statement timeout del database, mai un'attesa infinita), `DATABASE_ERROR`
500, `DELETION_FAILED` 500, `UNAUTHORIZED` 401, `INTERNAL` 500. Gli errori delle rotte di eliminazione
includono `requestId` (anche nell'header `x-request-id`) per ritrovare i log.

`GET /api/worlds/:id` include anche `vassalages`, `occupations` e `composites` (con `sourceNames`), e il
roster con il rapporto di posizionamento.

Non esiste un endpoint per aggiungere civiltà a un mondo esistente: il roster è assegnato solo alla creazione.
Le nuove risposte sono validate anche in uscita con gli schemi Zod di `lib/validation/identity.ts`.

Tutti i parametri (body, path e query string) sono validati con Zod: identificativi fuori formato diventano
`404` invece di raggiungere il database, la paginazione ha un massimo, la ricerca testuale è passata come
parametro con i caratteri jolly SQL neutralizzati, e nessuna risposta espone stack trace.

### Eliminazione di un mondo

Operazione distruttiva, mai automatica: parte solo da un dialog esplicito e passa da controlli lato server.

#### L'errore HTTP 504: analisi, causa e correzione

**Sintomo.** In produzione l'eliminazione di mondi vecchi rispondeva 504 (la Function Vercel superava
`maxDuration`, 60 s). I log Vercel e il database di produzione **non erano accessibili da questo ambiente**
(nessuna CLI Vercel né credenziale): l'analisi è stata fatta sul codice, riprodotta in locale e verificata su
Postgres 17 reale multi-connessione. I nuovi log strutturati (vedi sotto) permettono ora di confermarla
anche in produzione.

**Cosa è stato escluso, con misure:**

| Ipotesi                                | Esito                                                                                                                                                                                           |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Volume di dati / cascata troppo grande | Un mondo 96×96 dopo 500 anni ha ~32.000 righe (≈30 MB, snapshot inclusi): eliminarlo richiede **79 ms** su PGlite; su Postgres reale un 96×96 dopo 300 anni si elimina in poche centinaia di ms |
| Foreign key senza indice               | Tutte le FK `world_id` sono la prima colonna della chiave primaria: la cascata usa sempre un indice (verificato su `pg_constraint`/`pg_index` da un test e dallo script diagnostico)            |
| Trigger lenti                          | Nessun trigger applicativo (verificato su `pg_trigger`)                                                                                                                                         |
| Query N+1 / loop applicativo           | L'eliminazione era già set-based (una `DELETE … WHERE world_id` per tabella), ma faceva **tre passate** su ogni riga: `count(*)` prima, `DELETE`, ricontrollo finale                            |
| Dati orfani / tabelle indirette        | Nessuna tabella con dati di un mondo fuori dal grafo `world_id → worlds.id ON DELETE CASCADE` (test d'audit)                                                                                    |

**Causa radice (riprodotta).** Nessuna transazione impostava `lock_timeout`, `statement_timeout` o
`idle_in_transaction_session_timeout`. Una Function interrotta o congelata a metà transazione (per esempio un
`simulate` che supera il budget durante il salvataggio, che aggiorna la riga `worlds`) lascia la propria
connessione, attraverso il pooler transazionale di Supabase, **idle in transaction con i lock presi**. La
`DELETE` successiva esegue `SELECT … FOR UPDATE` sulla stessa riga e **attende senza limite**: su Postgres 17
reale il test ha misurato `wait_event: transactionid` per tutta la durata, finché la piattaforma uccide la
richiesta (504). Il tentativo fallito diventa a sua volta un nuovo "zombie": un nuovo tentativo riceve 409 per
60 s (il lock di simulazione ancora valido) e poi si blocca di nuovo. Ecco perché i 504 colpivano sempre gli
stessi mondi, quelli simulati di più. Aumentare `maxDuration` non avrebbe risolto nulla: l'attesa era infinita.

**Correzione.**

1. **Transazioni limitate ovunque** (`lib/db/tx.ts`, `boundedTransaction`): `lock_timeout`,
   `statement_timeout` e `idle_in_transaction_session_timeout` impostati con `set_config(..., true)` (cioè
   `SET LOCAL`, sicuro con il pooler) in eliminazione, salvataggio della simulazione, creazione del mondo e
   acquisizione del lock. Un lock tenuto da una transazione orfana produce ora **409 `WORLD_BUSY` in ~3 s**,
   e Postgres chiude da solo le sessioni che restano mute a metà transazione (nessun nuovo zombie).
2. **Tombstone + job riprendibile** (`lib/db/world-deletion.ts`, tabella `world_deletion_jobs`):
   - una transazione breve blocca la riga del mondo (con `lock_timeout`), ricontrolla conferma, proprietario,
     stato e lock di simulazione, marca il mondo `deleting` e apre un job. Da quel momento il mondo è invisibile
     a tutte le letture e scritture (dettaglio, simulazione, pausa/ripresa: 404) e compare nell'elenco solo
     come "in eliminazione";
   - l'epurazione avviene **a blocchi set-based** (`DELETE … WHERE world_id = $1 AND ctid = ANY(ARRAY(SELECT
ctid … LIMIT n))`, piano `Tid Scan`), una transazione limitata per blocco, con il progresso del job
     aggiornato **nella stessa transazione** del blocco (contabilità esatta anche dopo un crash);
   - un **lease** con scadenza rende esclusiva ogni tranche e si libera da solo se la Function muore;
   - ogni richiesta lavora al massimo `WORLD_DELETE_BUDGET_MS` (15 s): i mondi piccoli e medi finiscono
     subito (200), un mondo enorme risponde 202 e viene ripreso dal client (`POST …/deletion`) o dal cron;
   - ultimo passo: eliminazione della riga `worlds` (la cascata resta come rete di sicurezza) e verifica in
     una sola query che nessuna tabella contenga più righe del mondo, poi job `completed`.
3. **Osservabilità**: log JSON per fase (`world.delete.accepted`, `slice_start`, `batch`, `slice_paused`,
   `transient_error`, `failed`, `completed`) con `worldId`, `jobId`, `requestId` (header `x-vercel-id`),
   fase corrente, righe eliminate, durata e codice SQLSTATE; nessun segreto. Ogni risposta d'errore contiene
   `requestId` (e l'header `x-request-id`), mai uno stack trace.

**Contratto dell'endpoint** `DELETE /api/worlds/:id` (`{ confirmation: "ELIMINA <nome>", worldName }`):

| Risposta               | Quando                                                                                       |
| ---------------------- | -------------------------------------------------------------------------------------------- |
| 200 `completed: true`  | mondo e dati eliminati e verificati (conteggi per tabella, totale)                           |
| 202 `completed: false` | confermato e in corso (mondo enorme o errore transitorio): riprendere dopo `retryAfterMs`    |
| 400 / 404              | corpo non valido / mondo inesistente o già eliminato (idempotente)                           |
| 403 / 422              | non proprietario / frase o nome errati — nessun dato toccato                                 |
| 409                    | `WORLD_RUNNING`, `SIMULATION_IN_PROGRESS`, `WORLD_BUSY` (lock non ottenuto entro il timeout) |
| 500 `DELETION_FAILED`  | errore non transitorio durante l'epurazione: il mondo resta nascosto, il job è riprendibile  |

`GET /api/worlds/:id/deletion` legge lo stato dell'ultimo job; `POST /api/worlds/:id/deletion` prosegue un
job già confermato (idempotente, sicuro in concorrenza grazie al lease). Il cron opzionale riprende i job
abbandonati (scheda chiusa a metà). La UI mostra la percentuale e riprende da sola i mondi "in eliminazione".

**Semantica delle transazioni.** La conferma (tombstone) è atomica: se fallisce non cambia nulla. L'epurazione
è monotona e riprendibile: un blocco che fallisce viene annullato per intero (nessuna riga persa a metà), il
mondo resta nascosto, e la ripresa completa il lavoro. Nessuna riga di un altro mondo può essere toccata:
ogni istruzione è filtrata per `world_id` e gli id interni vivono in chiavi `(world_id, id)`.

**Grafo delle dipendenze** (verificato su `schema.ts`, migrazioni e `pg_constraint`): `world_cells`, `tribes`,
`households`, `people`, `settlements`, `civilizations`, `world_technologies`, `relationships`,
`historical_events`, `world_stats`, `world_snapshots`, `dynasties`, `civilization_stats`, `simulation_runs`,
`vassal_relationships`, `occupations`, `composite_identities`, `simulation_locks` — tutte `world_id →
worlds.id ON DELETE CASCADE`, indicizzate. `technologies` è il catalogo globale: **mai toccato**.
`world_deletion_jobs` non ha FK di proposito: il record dell'eliminazione sopravvive al mondo.

**Diagnosi senza rischi**:

```bash
npm run diagnose:world-delete -- --world-id <uuid>        # oppure --json
```

Esegue solo letture dentro una transazione `READ ONLY`: righe e dimensioni per tabella, foreign key
(`ON DELETE`, indice sulla colonna figlia), trigger, timeout della sessione, **sessioni sospette** (idle in
transaction, in attesa di lock, con lock sulle tabelle dei mondi, con `pg_blocking_pids`), piano `EXPLAIN` di
un blocco, stima dei tempi e piano consigliato. Suggerisce `pg_terminate_backend(<pid>)` per una sessione
orfana confermata, ma non lo esegue mai. Non usarlo per "provare" un'eliminazione su un mondo di produzione.

**Test** (`npm run test:world-delete`):

- `tests/world-deletion.test.ts` (PGlite in memoria): audit dello schema (ogni tabella con `world_id`
  registrata, ogni FK `CASCADE` e indicizzata, nessun trigger), id non valido, conferma o nome errati,
  mondo inesistente, utente non autorizzato, mondo in esecuzione, simulazione in corso, mondo piccolo, mondo con
  dati in **ogni** tabella figlia, mondo legacy, nessuna query per record (conteggio delle `DELETE`
  eseguite), idempotenza, richieste concorrenti (un solo job), tombstone invisibile a letture e scritture,
  batch di simulazione concorrente scartato, budget esaurito (202 e ripresa fino al completamento con
  progresso monotono e contabilità esatta), lease di una Function morta, rollback di un blocco e del passo
  finale con guasti iniettati, errore transitorio (SQLSTATE 55P03 → 202 riprendibile), endpoint che risponde
  sempre (guasto inatteso → 500 con `requestId`), lock e lease rilasciati, nessuna transazione lasciata aperta.
- `tests/world-deletion.pg.test.ts` (**Postgres reale**, solo con `TEST_DATABASE_URL` che punta a un
  database usa-e-getta il cui nome contiene "test"): la transazione orfana che causava il 504 ora produce 409
  `WORLD_BUSY` in pochi secondi, lo stesso per il lock di simulazione, `idle_in_transaction_session_timeout`
  chiude la sessione orfana e l'eliminazione procede, richieste concorrenti su più connessioni, mondo 96×96
  dopo 300 anni eliminato ben dentro il budget.

### Sicurezza

Non esiste ancora autenticazione: la colonna `owner_id` è predisposta ma non usata (tranne che per negare
l'eliminazione di un mondo con proprietario a chi non lo è), e non viene introdotta in questa fase per non
rendere invasivo il cambiamento. Il database è raggiunto **solo dal server** attraverso
`postgres-js`: nessuna chiave Supabase arriva al browser e `SUPABASE_SERVICE_ROLE_KEY` non è mai esposta.

Quando verrà introdotta l'autenticazione (Supabase Auth), le tabelle esposte al client andranno protette con
**RLS attiva e una policy per operazione** basata su `owner_id`, come raccomanda la documentazione Supabase:
finché l'accesso passa solo dal server con credenziali di servizio, l'RLS non è aggirabile dal browser perché il
browser non parla mai direttamente con il database.

## Scenari e stress

Tredici scenari riproducibili (`scenarios.ts`) rimodellano un mondo generato per porre una domanda sola al
motore: valle fertile, deserto, isola, corridoio commerciale, due potenze rivali, regione mineraria, città
sovrappopolata, civiltà frammentata, identità moderne, popoli inclini alla fusione, diffusione intensa, mondo
isolato, più la baseline. Ogni modifica usa uno stream derivato dal seme, mai l'RNG della simulazione.

`simulation:stress` (20 semi × mappe 32/48/72 × 200 tick, più ogni scenario su 3 semi, ~1 minuto) controlla:
invarianti, determinismo (un colpo contro lotti irregolari), che non tutti scoprano nello stesso ordine, che
qualcuno scopra, che la diffusione non domini, che la perdita non sia troppo frequente, che nessun popolo
diventi irrecuperabile, che le culture non convergano. Esito con questa milestone: **tutti superati** — 0% di
run con un solo ordine di scoperta, 1459 scoperte e 502 acquisizioni per diffusione, perdite al 3% delle
acquisizioni, un popolo sopra l'85% della popolazione nel 2% dei run. Esce con codice 1 solo se si rompe una
garanzia; gli odori di bilanciamento sono avvisi. Una versione ridotta degli stessi controlli è nella suite
`test:simulation`.

Medie per scenario (3 semi × 200 tick):

| Scenario       | Popolazione | Tecniche (max) | Diffusione | Guerre | Fusioni |
| -------------- | ----------: | -------------: | ---------: | -----: | ------: |
| baseline       |         589 |            6,0 |        4,0 |    5,0 |       0 |
| fertile-valley |       1.136 |            7,3 |       12,7 |   19,3 |       0 |
| desert         |         122 |            4,3 |        0,0 |    0,7 |       0 |
| island         |         388 |            6,0 |        5,0 |    7,0 |       0 |
| trade-corridor |       1.068 |            7,3 |       14,3 |   26,7 |       0 |
| tech-diffusion |       1.003 |            7,0 |       23,0 |   47,3 |       0 |
| fusion-prone   |       1.088 |            7,0 |       16,3 |   28,0 |       0 |
| isolated       |         515 |            6,7 |        0,7 |    0,3 |       0 |

## Prestazioni

Il tick si può profilare fase per fase senza cambiarne i risultati (`RunOptions.profile`; un test verifica
che l'hash del mondo sia identico con e senza). Ogni batch registra le fasi in `phasesMs` nel log
`simulate.batch`, quello che Vercel Observability raccoglie. Su 300 tick, mappa 64×64, ~3 ms per tick: clima e
risorse 22%, guida e azioni 15%, insediamenti 13,4%, produzione e consumo 9,2%, nascite 7,1%, chiusura del
tick 6,7%, tecnologia 5,7%, diplomazia 5,3%, morti ed epidemie 4,7%, cultura e stabilità 4,1%; le fasi
introdotte da questa milestone (resilienza, credenze, conoscenza, accordi) pesano insieme il **5,2%**.

Misure su ambiente di sviluppo locale (PGlite, Node 22), mappa 48×48:

| Operazione                              | Tempo osservato                           |
| --------------------------------------- | ----------------------------------------- |
| Generazione mondo (mappa + popolazione) | < 0,3 s (budget del test: 3 s)            |
| Batch di 10 tick                        | < 0,2 s di calcolo (budget del test: 3 s) |
| Batch di 100 tick, ~200 persone         | ~1 s totale (calcolo + salvataggio)       |
| Batch di 100 tick, ~800 persone         | ~2,2 s totale                             |
| 500 tick headless, 10 semi              | 0,3–2,7 s per mondo                       |

Ogni batch registra nei log `loadMs`, `computeMs`, `saveMs`, `msPerTick`, numero di persone, insediamenti,
tribù ed eventi: un mondo lento è diagnosticabile senza strumenti aggiuntivi. Il caricamento di un mondo usa
9 query (nessun N+1), la timeline e le persone non sono mai caricate senza paginazione, e la mappa è disegnata
su canvas (nessuna cella come nodo DOM). Se un batch rischia di superare il budget si ferma e salva i tick già
completati (`partial: true`): non esiste uno stato "a metà".

## Scalabilità

Il progetto gestisce bene circa 1.000–1.500 individui attivi. Evoluzioni previste (non ancora implementate):

- **Simulazione ibrida**: individui completi per piccoli gruppi, capi e figure rilevanti; popolazioni aggregate
  (coorti per età e sesso) per città grandi ed eserciti. `Community` è già il punto di aggregazione naturale e
  le figure di rilievo sono già distinte dal resto della popolazione (`notable`, prestigio, titoli).
- **Snapshot e event sourcing selettivo**: `world_snapshots` contiene già stati completi; con il PRNG
  serializzato si può ripartire da uno snapshot e rigiocare i tick per ricostruire o verificare la storia.
- **Aggregazioni statistiche**: viste materializzate o rollup per secolo sopra `world_stats` e `historical_events`.
- **Worker esterno**: per mondi grandi o sempre attivi, spostare `runSimulation` in un worker (Fly.io, Railway,
  un container o una Vercel Queue) alimentato da una coda. Next.js resta per UI e API; il lock passa a Redis.
- **Scrittura incrementale**: tracciare le entità modificate (dirty set) invece di riscrivere tutte le persone vive.

## Limiti attuali

Stato reale delle funzionalità (implementato · parziale · previsto):

0. **Tecnologia locale per civiltà** — _implementata e misurata_: catalogo globale, stato per popolo, parità
   iniziale, budget e quote di ricerca divergenti, diffusione che non aggira i requisiti materiali, perdita e
   riscoperta. Misure su 5 semi × 250 tick, mappa 64×64: i set tecnologici distinti fra popoli vivi passano da
   **1 a 4–8**, gli ordini di scoperta distinti da **1–3 a 4–10** e il tetto raggiunto da **5 a 8** tecnologie
   (16–17 su 600 tick). _Limiti_: la **riscoperta è rara nelle partite standard** (0–1 casi su 600 tick),
   perché quasi tutte le perdite colpiscono popoli che poi si estinguono. Le **varianti locali** esistono
   (9 forme per 7 tecniche, vedi «Varianti locali»): il 23% delle tecniche che ne ammettono una è praticato
   in forma locale, ma 2 varianti su 9 (pesca di fiume, canali di bonifica) non sono comparse nelle misure.
   Il catalogo resta di 22 tecnologie e non copre l'età classica, medievale, moderna o industriale.
1. **Identità dell'età moderna** — _implementate_: 10 identità (Francesi, Inglesi, Spagnoli, Portoghesi,
   Ottomani, Italiani, Tedeschi, Russi, Etiopi, Statunitensi) come sandbox culturali. Mancano altre identità
   moderne e la categoria `regional` è vuota.
2. **Fusioni in identità composite** — _implementate nel motore e testate, ma rare_: con la taratura attuale
   della diplomazia le precondizioni (alleanza con fiducia alta, o vassallaggio lungo e pacificato) non si
   verificano nelle simulazioni standard (0 fusioni in 20 seed × 250 tick). Le soglie non sono state
   abbassate artificialmente.
3. **Vassallaggi e occupazioni** — _implementati come stati espliciti_ (creazione, tributo, autonomia, leva,
   ribellione, indipendenza; occupazione con costi, prelievi, controllo, resistenza, annessione, liberazione,
   autonomia, restituzione). _Parziali_: il vassallo non può essere annesso pacificamente, la leva è astratta
   (nessun movimento di eserciti), la mappa non distingue ancora graficamente vassalli e occupanti.
4. **Linguaggio** — _migliorato_: nessun «la tribù Egizi», articoli, preposizioni, accordo di verbi e
   participi, forme politiche e leader gestiti da template controllati; un test controlla i testi reali del
   motore. _Limiti_: i template restano in italiano soltanto e alcune frasi restano formulaiche; gli eventi già
   salvati nei mondi esistenti mantengono il testo originale.
5. **Mappe piccole** — la fascia di qualità si allarga (dichiarata, registrata e segnalata in UI): le partenze
   possono essere meno omogenee che sulle mappe grandi.
6. **Catalogo parziale**: 30 identità, prevalentemente eurasiatiche; Oceania e molte regioni non sono coperte.
7. Le identità reali sono **ispirazione culturale e visiva**, non una ricostruzione della storia reale.
8. I **leader sono procedurali**: mai personaggi storici (i nomi riservati non vengono generati).
9. Le **identità composite** sono generate dal motore e non vanno presentate come civiltà storiche reali.
10. **Scalabilità**: oltre ~1.500 individui attivi le prestazioni degradano; va verificata con stress test
    dedicati a popolazioni maggiori.
11. **Eliminazione di mondi molto grandi**: avviene a job con blocchi e ripresa (202). Se il browser si chiude
    a metà, il mondo resta nascosto e il job viene ripreso riaprendo l'elenco o dal cron opzionale; senza né
    l'uno né l'altro i dati restano in attesa di ripresa.
12. **Causa del 504**: individuata e riprodotta localmente su Postgres reale (transazioni orfane senza
    `lock_timeout`), ma **non confermata sui log di produzione**, che non erano accessibili. I nuovi log
    strutturati e `npm run diagnose:world-delete` servono a confermarla.
13. La **diplomazia** non forma quasi mai alleanze (soglia di fiducia 0,7 irraggiungibile in pratica) e il
    tributo mantiene alta l'ostilità nei vassallaggi: è il motivo per cui le fusioni sono rare. Non esistono
    **accordi diplomatici espliciti** (`DiplomaticAgreement`) né **reputazione** (`DiplomaticReputation`): le
    relazioni sono ancora descritte da fiducia, ostilità, stato e fase.
14. **Dinastie e successioni** — _implementate e misurate_. Prima di questa milestone il sistema dinastico era
    **contenuto morto**: `tribal_monarchy` richiedeva `dynastyId !== null` ma le case si fondavano solo sotto
    `tribal_monarchy`, un vincolo circolare che produceva **0 dinastie in 500 tick su ogni seme**. Sbloccato
    permettendo al capo di un chiefdom di rendere ereditario il comando: ora 5–9 case per mondo (500 tick,
    mappa 64×64), fino a 10 sovrani per casa, fini con causa registrata e restaurazioni. _Limiti_: gli esiti
    `disputed` e `usurpation` restano rari nelle partite standard (prevalgono `peaceful`, `regency` e
    `interregnum`) perché dipendono da più pretendenti con prestigio ravvicinato. **Guerra civile** e
    **frammentazione** esistono ma sono rare: 1 e 1 su 10 mondi × 600 tick, perché richiedono una successione
    contesa, un pretendente forte e almeno sei persone idonee; un primo tentativo che pretendeva due fratelli
    rivali ne produceva 0. I **matrimoni dinastici** sono implementati e provati da test costruiti ma **non
    avvengono mai nelle partite standard**: su 3 mondi × 600 tick, i casi in cui due popoli hanno entrambi una
    casa regnante e abbastanza fiducia sono 129, e in nessuno c'era un parente della casa ancora libero. Non
    esistono ostaggi politici; la **timeline dinastica in UI non è stata realizzata** — i dati sono esposti dall'API
    (`legitimacy`, `successionLaw`, `status`, `endReason`, `crises`, `currentLeaderId`) ma nessun pannello li
    disegna.
15. **Credenze** — _implementate e misurate_: 71 credenze su 10 mondi × 600 tick, con **54% dei popoli
    sopravvissuti** che ne segue una — **67%** da quando esistono i missionari — e forme davvero diverse
    (culto degli antenati, spiritualità della natura, culto del fiume, pantheon, culto dello stato). Nessuna è
    assegnata per identità storica. **Conversione missionaria e scismi** sono implementati e misurati: 27
    conversioni e 5 scismi su 10 mondi × 600 tick. _Limiti_: il **sincretismo non avviene più nelle partite
    standard** (0 casi contro i 2 di prima) perché la conversione raggiunge la coppia per prima — una fede
    appena nata è debole e viene assorbita; l'**adesione satura a 1,00** nei popoli stabili e non torna a
    scendere se non con fame o guerra; non esistono **festività né clero come specialisti**; i tipi `solar_cult`, `mountain_cult` e
    `philosophical` sono raggiungibili ma non compaiono nelle misure fatte.
16. **Memoria storica delle città** — _implementata e misurata_ su 303 insediamenti (6 mondi × 600 tick):
    ragioni di fondazione distribuite (migrazione 207, giacimento 30, presidio 23, scambio 22, agricoltura 11,
    rifugio 10), 35 luoghi che sono stati capitale, 245 distruzioni e **11 rinascite** con continuità di nome,
    anno di fondazione e fondatore. _Limiti_: la ragione `religious` e le specializzazioni `military`,
    `commercial`, `religious` e `craft` **non compaiono** nelle misure, perché dipendono da edifici (caserma,
    mercato, tempio, fornace) che il motore costruisce raramente: è un limite del sistema di costruzione, non
    della memoria; la memoria è **aggregata** (contatori e picchi, più una lista di al massimo 12 eventi), non
    una cronologia per luogo; **nessun pannello UI** mostra ancora fondazione, specializzazioni, occupazioni e
    periodi come capitale.
17. **Accordi diplomatici e reputazione** — _implementati e misurati_: 19–208 patti per mondo (5 semi × 600
    tick), tutti e sette i tipi negoziabili compaiono, 83 violazioni registrate, e le reputazioni divergono
    davvero (`treatyRespect` fra 0,50 e 0,99, `threatLevel` fra 0,01 e 0,62). La reputazione influenza la
    diffusione tecnologica (`knowledgeOpenness`). _Limiti_: l'**aggressività resta vicina a 0,01** quasi
    ovunque, perché le guerre dichiarate sono rare e la media le diluisce; il matrimonio dinastico è ora un
    tipo di accordo ma non viene mai firmato (vedi punto 14); non esistono **ostaggi politici, ultimatum né
    coalizioni**; embargo, tributo e pace sono modellati ma **non vengono mai
    firmati dal motore** — sono registrabili, non ancora prodotti.
18. **Crisi e resilienza** — _implementati e misurati_: profili con resilienza complessiva fra 0,31 e 0,81, e
    risposte alle crisi differenziate (redistribuzione 105, commercio 50, migrazione 36, colonizzazione 3 su
    5 mondi × 600 tick). _Limiti_: **sei risposte su dieci non compaiono mai** nelle partite standard
    (razionamento, riforma, repressione, guerra, richiesta d'aiuto, abbandono): la redistribuzione domina
    perché coesione e cooperazione restano alte. La resilienza è **calcolata ma non retroagisce**: nessun
    effetto meccanico su mortalità o collasso, solo la scelta della risposta e la visualizzazione.
19. **API e interfaccia** — _implementate_: cinque nuovi endpoint (catalogo del mondo, tecnologie per civiltà
    con filtri e paginazione, tecnologie raggiungibili, storia di una tecnologia, memoria di un luogo), tutti
    con contratto Zod verificato in uscita, catalogo statico costruito una volta per istanza e nessuna query
    per riga. In interfaccia: dinastia, credenze, resilienza, reputazione e accordi nella scheda del popolo;
    memoria del luogo nella scheda dell'insediamento; «Tecnologie del mondo» (menu) con chi ha scoperto,
    preso e perso ogni tecnica. _Limiti_: il **filtraggio per osservatore riguarda solo ciò che un popolo sa
    degli altri** (`/knowledge`, e i vicini visti in `/discoverable`): la mappa e le schede restano la vista
    del narratore onnisciente, com'è giusto in un gioco d'osservazione, ma non esiste una modalità «gioca
    come questo popolo»; la **velocità di diffusione** è mostrata come anni fra primo e ultimo possessore, non
    come curva disegnata. L'interfaccia è stata verificata via HTTP sull'app in esecuzione e con i test, **non
    con un browser**: nessuna schermata è stata controllata a occhio.
20. **Informazione incompleta** — _implementata e misurata_: ogni popolo tiene stime (mai la verità) degli
    altri, con fiducia, anno e fonte; le stime invecchiano e possono essere sbagliate. La **decisione di
    dichiarare guerra usa la stima**, la battaglia la realtà: su 12 semi × 300 tick il 41% delle guerre
    nasce da una stima troppo ottimista e l'attaccante perde il 39% delle battaglie contro il 35% di prima.
    _Limiti_: solo guerra e movente leggono le stime; commercio, accordi, vassallaggi e occupazioni decidono
    ancora sulla verità. Non esiste una **mappa esplorata** per popolo (fog of war sulla mappa): conta solo il
    «dove li ho visti l'ultima volta». Gli **informatori** e le **stime delle risorse** non sono modellati.
    Lo spionaggio vale il 6–8% degli eventi di importanza ≥3 quando è a importanza 3, e per questo è stato
    abbassato a 2.
21. **Causalità e replay** — _implementate e misurate_: gli eventi di importanza ≥4 con cause registrate passano dal
    **9% al 36%** (3 semi × 500 tick); ogni causa citata esiste ed è precedente. La catena si risale nel
    database, non più solo nella pagina di cronaca visibile. _Limiti_: le categorie rimaste senza causa sono
    soprattutto quelle che non hanno un evento-causa (epidemie, invenzioni, prime fondazioni) e sono spiegate
    dai metadata. Il **replay** ricostruisce la storia da uno snapshot e verifica che coincida evento per
    evento (`npm run simulation:replay`). _Limite_: lavora su snapshot presi in memoria, e **non esiste un
    comando che rigiochi uno snapshot già salvato nel database** di un mondo reale.
22. **Scenari e stress** — _implementati_: 13 scenari riproducibili e tre comandi senza database. Su 20 semi ×
    3 dimensioni × 200 tick tutti i controlli richiesti passano (vedi «Scenari e stress»). _Limiti_: **anche
    lo scenario più favorevole alle fusioni ne produce 0** e vi si contano 28 guerre in 200 anni; il deserto
    e l'isolamento si comportano come previsto, ma lo scenario «isolato» non produce percorsi tecnologici
    più diversi della baseline (3,4 set distinti contro 3,2), perché i popoli si dividono e le bande figlie
    restano vicine alle madri.
23. La **cultura emergente** è passata a 13 tratti, con l'aggiunta di `tolerance`, `exploration`,
    `administrativeCapacity` e `culturalCohesion`, e ogni popolo tiene un registro limitato delle proprie
    variazioni. La convergenza culturale è stata **misurata e corretta** (deviazione standard fra popoli vivi
    dopo 400 tick: cooperazione da ±2,6 a ±11,5, tradizionalismo da ±1,8 a ±6,4, innovazione da ±4,0 a ±8,2),
    ma il militarismo resta poco distinguibile perché è dominato dalla guerra. Aggiungere i quattro tratti ha
    cambiato il consumo del PRNG in generazione: **i mondi creati da semi precedenti non sono più identici**
    a com'erano prima di questa milestone (i mondi già salvati non sono toccati e si ricaricano invariati).

Trade-off noti che restano validi:

- Il bilanciamento è empirico: alcuni seed producono molte bande in lotta, altri poche civiltà stabili. I
  parametri fissi sono in `constants.ts`, `politics.ts` (`POLITICS`), `fusion.ts` (`FUSION`), `placement.ts`
  (`PLACEMENT_BANDS`); quelli regolabili in `config.ts` (e salvati sul mondo).
- Le popolazioni oscillano con cicli di crescita e crisi: esito voluto del modello malthusiano.
- La stagionalità è calcolata per anno; molte decisioni sono prese a livello di comunità.
- Ogni batch riscrive tutte le persone vive (upsert a blocchi): semplice e corretto, ma cresce con la popolazione.
- Gli snapshot sono JSON non compressi: se ne conservano pochi.
- Nessuna autenticazione: `owner_id` è predisposto ma non usato, e con esso l'RLS.
- La guerra è un sistema strategico aggregato: non esiste una mappa tattica né il movimento degli eserciti.
- Test end-to-end Playwright non inclusi (lo scenario è coperto dai test d'integrazione su API e DB).

## Prossima milestone

In ordine di priorità (il database è stato reso affidabile prima di estendere le funzionalità):

0. **Chiudere la milestone «civiltà vive»**: far decidere sulle stime anche commercio, accordi e
   vassallaggi; mappa esplorata per popolo; clero come specialisti e festività; replay di uno snapshot già
   salvato nel database; timeline dinastica in interfaccia; verifica visiva dell'interfaccia nel browser
   (oggi verificata solo via HTTP e test). Vanno inoltre riviste le condizioni dei **matrimoni dinastici**,
   oggi mai soddisfatte, e del **sincretismo**, ora soppiantato dalla conversione.
1. **Catalogo**: estendere le identità reali (Oceania, Africa subsahariana, Asia centrale e sudorientale,
   Americhe) e popolare la categoria `regional`.
2. **Età moderna**: altre identità moderne selezionabili, sempre con partenza uniforme e senza modificatori.
3. **Fusioni realmente frequenti**: ritarare la diplomazia (formazione delle alleanze, effetto del tributo
   sull'ostilità) in modo che le precondizioni delle fusioni emergano in partite lunghe, misurandolo con la
   matrice di stress; aggiungere l'annessione pacifica di vassalli integrati.
4. **Vassallaggi e occupazioni**: leva visibile, obblighi negoziati, occupazioni di territorio senza
   insediamento, coalizioni di liberazione.
5. **Lingua**: distinguere sistematicamente popolo, civiltà, regno, impero, confederazione e stato; template
   per le composite di composite; eventuale localizzazione.
6. **Mappe piccole**: mantenere la fascia allargata ma documentata, con metriche di equità per partita e
   possibili mappe "consigliate" per numero di civiltà.
7. **Mappa**: disegnare emblemi delle civiltà, simboli delle dinastie, stili architettonici coerenti con
   l'identità, indicatori per le composite e differenze visive fra vassalli, occupanti e stati indipendenti.
8. **Legenda e tooltip** per distinguere identità storica, civiltà procedurale, identità composita, stato
   occupato, vassallo e successore.
9. **Font e template** degli eventi: tipografia della cronologia e varianti dei template.
10. **Profiling del database e della cancellazione** in produzione: confermare la causa del 504 sui log,
    misurare i job su mondi reali, eventualmente spostare la ripresa su una coda (Vercel Queues/Workflow).

## Roadmap tecnica

1. **Aggregazione della popolazione**: coorti per età e sesso per le città grandi, individui completi solo per
   le figure rilevanti (simulazione ibrida), con profiling a 10.000 individui.
2. **Worker e coda dedicati**: spostare `runSimulation` fuori da Vercel per i mondi grandi o sempre attivi;
   lock su Upstash Redis.
3. **Replay avanzato**: ripartire da uno snapshot e rigiocare i tick per ispezionare o verificare la storia,
   sfruttando il PRNG serializzato.
4. **Multiplayer osservativo**: più spettatori sullo stesso mondo, con aggiornamenti in tempo reale.
5. **Mappe più grandi** (oltre 96×96) con territorio a chunk e rendering a livelli.
6. Autenticazione (Supabase Auth) e `owner_id` sui mondi, con policy RLS e test dedicati.
7. Tracciamento delle entità modificate per salvataggi incrementali; compressione degli snapshot.
8. Smoke test Playwright (crea mondo → +10 anni → verifica timeline).
9. **Identità**: vedi [Prossima milestone](#prossima-milestone).
10. **IA narrativa opzionale e locale**: un livello puramente descrittivo sopra gli eventi già persistiti, non
    deterministico e sempre disattivabile, che non partecipa mai alle decisioni degli agenti.
