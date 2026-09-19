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
9. [Modello di simulazione](#modello-di-simulazione)
10. [API](#api)
11. [Prestazioni](#prestazioni)
12. [Scalabilità](#scalabilità)
13. [Limiti noti e trade-off](#limiti-noti-e-trade-off)
14. [Roadmap tecnica](#roadmap-tecnica)

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

Le migrazioni applicate finora:

| Migrazione           | Scopo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0000_init.sql`      | schema iniziale (mondi, celle, tribù, persone, insediamenti, civiltà, relazioni, eventi, statistiche, snapshot, lock, run)                                                                                                                                                                                                                                                                                                                                                             |
| `0001_evolution.sql` | **solo aggiunte**: colonne di clima/config/crisi sui mondi, giacimenti e pascoli sulle celle, cultura, governo, stabilità, distribuzione e adozione tecnologica sulle tribù, prestigio/istruzione/ricchezza/dinastia sulle persone, livello urbano, igiene, malcontento e influenza sugli insediamenti, rispetto/dipendenza/stato/fase sulle relazioni, sottotipo e catene causali sugli eventi, 14 nuove metriche su `world_stats`, più le tabelle `dynasties` e `civilization_stats` |

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

Lo stato del mondo ha una **versione** (`worlds.simulation_version`, oggi `2`) e un formato di serializzazione
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
npm run test:simulation # stress del motore: 250 tick con invarianti a ogni tick, 10 semi, performance
npm run test:all        # entrambe le suite
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

La suite di stress (`npm run test:simulation`) aggiunge: 250 tick con controllo di integrità **dopo ogni tick**,
assenza di `Math.random` in tutto il package di simulazione, nessun evento duplicato o orfano su 300 tick,
determinismo su 250 tick, nessun mondo che si estingue prematuramente su 10 semi diversi e i due budget di
prestazione (generazione del mondo e batch da 10 tick sotto i 3 secondi).

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
salute) o perdita di legittimità; se un governo ereditario resta senza eredi si apre una **crisi di successione**
che abbassa la legittimità e può sfociare in un colpo di stato. Chi guida a lungo e bene fonda una **dinastia**,
che sopravvive ai suoi membri e accumula prestigio. Nascite, ascese, fondazioni, morti e successioni generano
eventi; le figure di rilievo (guide, fondatori, inventori, comandanti) sono consultabili nel dettaglio.

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

### Tecnologie

Ventuno tecnologie in quattro categorie: **sopravvivenza** (fuoco, utensili di pietra, abiti, conservazione degli
alimenti, pesca), **neolitico** (agricoltura, ceramica, allevamento, tessitura, irrigazione, ruota, costruzione
avanzata), **metalli** (rame, fonderia, bronzo, ferro, attrezzi metallici) e **organizzazione** (scrittura,
tassazione, leggi, organizzazione militare, commercio a lunga distanza). Ognuna dichiara prerequisiti,
popolazione minima, eventuale obbligo di insediamento, requisiti materiali e geografici, costo, effetti misurabili
e, dove esiste, una **contropartita** (il bronzo dipende dallo stagno, spesso da importare; la tassazione alimenta
malcontento e corruzione; le rotte commerciali portano anche le epidemie).

Il progresso non è un interruttore: una tecnologia passa da sconosciuta a in osservazione, sperimentazione,
sviluppo, scoperta, diffusione e infine **adozione**. Gli effetti valgono in proporzione al livello di adozione,
che cresce con popolazione, ordine e cultura dell'innovazione ed è frenato dal tradizionalismo. La conoscenza si
diffonde con il commercio (alta probabilità fra partner frequenti), la convivenza (lenta), la migrazione
(trasferimento parziale) e la conquista (accesso immediato, adozione lentissima).

### Cultura, governo e stabilità

Ogni tribù ha nove **tratti culturali** normalizzati 0–100 — cooperazione, militarismo, apertura al commercio,
tradizionalismo, centralizzazione, gerarchia sociale, spiritualità, innovazione, espansionismo — generati
proceduralmente dal seed (nessun riferimento a popoli reali) e soggetti a deriva lenta guidata da ciò che il
gruppo vive davvero: guerre, scambi, carestie, scoperte, espansione, complessità.

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
  con vittoria netta su un insediamento indebolito, **occupazione**: la popolazione e il territorio passano al
  vincitore, che acquisisce anche le tecnologie dei vinti.
- La pace arriva per stanchezza o sfinimento, con una tregua di 20–40 anni.

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

## API

Tutte le risposte hanno la forma `{ "data": … }` oppure `{ "error": { "code", "message", "details?" } }`.

| Metodo   | Percorso                           | Note                                                                                                                                                          |
| -------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST`   | `/api/worlds`                      | `{ name, seed?, width?, height? }` (24–96). Genera mappa, tribù e popolazione. 201 → `{ worldId, world }`                                                     |
| `GET`    | `/api/worlds`                      | elenco dei mondi con riepilogo                                                                                                                                |
| `GET`    | `/api/worlds/:id`                  | stato e clima, mappa a colonne, tribù (cultura, governo, stabilità), insediamenti, civiltà, relazioni, tecnologie, dinastie, crisi, figure di rilievo         |
| `PATCH`  | `/api/worlds/:id`                  | `{ status: "running" \| "paused" }`                                                                                                                           |
| `DELETE` | `/api/worlds/:id`                  | `{ confirmation: "ELIMINA <nome>", worldName }`: elimina il mondo e tutti i suoi dati (vedi [Eliminazione](#eliminazione-di-un-mondo)) → conteggi per tabella |
| `POST`   | `/api/worlds/:id/simulate`         | `{ ticks: 1 \| 10 \| 50 \| 100 }` → riepilogo, eventi principali, metriche, `partial`                                                                         |
| `GET`    | `/api/worlds/:id/events`           | `page`, `pageSize` (≤ 100), `type` (lista separata da virgole), `minImportance`, `fromYear`, `toYear`, `actorId`, `search`                                    |
| `GET`    | `/api/worlds/:id/stats`            | `{ world, civilizations }`; `maxPoints` (campionamento), `civilizations=true` per la serie per civiltà                                                        |
| `GET`    | `/api/worlds/:id/people/:personId` | dettaglio di una persona: condizione, abilità, indole, famiglia, dinastia, conoscenze, eventi                                                                 |
| `GET`    | `/api/cron/advance`                | modalità autonoma opzionale, protetta da `CRON_SECRET` (401 se non configurata)                                                                               |

Codici di errore: `INVALID_INPUT` 400, `TICKS_NOT_ALLOWED` 400, `NOT_FOUND` 404, `SIMULATION_IN_PROGRESS` 409,
`WORLD_RUNNING` 409, `CONFIRMATION_MISMATCH` 422, `FORBIDDEN` 403, `TIMEOUT` 504, `DATABASE_ERROR` 500,
`UNAUTHORIZED` 401, `INTERNAL` 500.

Tutti i parametri (body, path e query string) sono validati con Zod: identificativi fuori formato diventano
`404` invece di raggiungere il database, la paginazione ha un massimo, la ricerca testuale è passata come
parametro con i caratteri jolly SQL neutralizzati, e nessuna risposta espone stack trace.

### Eliminazione di un mondo

Operazione distruttiva, mai automatica: parte solo da un dialog esplicito e passa da controlli lato server.

**Grafo delle dipendenze** (verificato su `schema.ts` e sulle migrazioni): tutte le tabelle di un mondo hanno
`world_id → worlds.id ON DELETE CASCADE` — `world_cells`, `tribes`, `households`, `people`, `settlements`,
`civilizations`, `world_technologies`, `relationships`, `historical_events`, `world_stats`, `world_snapshots`,
`dynasties`, `civilization_stats`, `simulation_runs`, `simulation_locks`. Gli id interni (`t3`, `s5`, `p12`…)
stanno in chiavi `(world_id, id)`, quindi nessuna riga può riferirsi a un altro mondo. `technologies` è il
catalogo globale condiviso: **non viene mai toccato**. Non esistono file o oggetti Storage legati ai mondi.
Nessuna migrazione è stata necessaria.

**Strategia** (`deleteWorldService` + `lib/db/world-deletion.ts`):

1. Zod valida `worldId` (UUID, altrimenti 404) e il corpo `{ confirmation, worldName }` (campi extra: 400).
2. Se il mondo non esiste: 404 (una seconda richiesta non ha effetti).
3. Controlli: proprietario (se `owner_id` è valorizzato serve quell'utente: una richiesta anonima riceve 403),
   frase esatta `ELIMINA <nome>` e nome confrontati con quelli **salvati nel database** (422), mondo in pausa
   (409 `WORLD_RUNNING`).
4. Acquisizione del lock di simulazione del mondo: nessun batch può partire né essere in corso (409).
5. Transazione: `SELECT … FOR UPDATE` sulla riga del mondo, nuova verifica dei controlli, conteggio ed
   eliminazione di ogni tabella figlia filtrata per `world_id`, eliminazione del mondo, verifica che nessuna
   tabella abbia più righe di quel mondo (altrimenti rollback), commit.
6. Risposta: righe eliminate per tabella e totale (inclusa la riga di lock della cancellazione stessa).
   Nessun SQL né stack trace nelle risposte; i fallimenti restituiscono `DATABASE_ERROR` senza modifiche.

La UI mostra nome, seed e cosa verrà eliminato, chiede di digitare `ELIMINA <nome>` (pulsante disabilitato
finché non coincide), impedisce il doppio invio, mette in pausa un mondo in esecuzione, svuota la cache delle
query del mondo e torna all'elenco. Aprire l'URL di un mondo eliminato mostra «Mondo non disponibile».

I test (`tests/world-deletion.test.ts`) girano su un PGlite in memoria creato dal test: id non valido,
mondo inesistente, conferma o nome errati, utente non autorizzato, mondo in esecuzione, lock preso,
eliminazione completa senza orfani né effetti su altri mondi e sul catalogo, idempotenza, richieste
concorrenti, rollback con un guasto iniettato da un trigger.

### Sicurezza

Non esiste ancora autenticazione: la colonna `owner_id` è predisposta ma non usata (tranne che per negare
l'eliminazione di un mondo con proprietario a chi non lo è), e non viene introdotta in questa fase per non
rendere invasivo il cambiamento. Il database è raggiunto **solo dal server** attraverso
`postgres-js`: nessuna chiave Supabase arriva al browser e `SUPABASE_SERVICE_ROLE_KEY` non è mai esposta.

Quando verrà introdotta l'autenticazione (Supabase Auth), le tabelle esposte al client andranno protette con
**RLS attiva e una policy per operazione** basata su `owner_id`, come raccomanda la documentazione Supabase:
finché l'accesso passa solo dal server con credenziali di servizio, l'RLS non è aggirabile dal browser perché il
browser non parla mai direttamente con il database.

## Prestazioni

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

## Limiti noti e trade-off

- Il bilanciamento è empirico: alcuni seed producono molte bande in lotta, altri poche civiltà stabili. I
  parametri fissi sono in `constants.ts`, quelli regolabili in `config.ts` (e salvati sul mondo).
- Le popolazioni oscillano con cicli di crescita e crisi (sovrappopolazione → carestia → ripresa): è un esito
  voluto del modello malthusiano, non un difetto, ma rende i numeri assoluti poco stabili fra un secolo e l'altro.
- La stagionalità è calcolata per anno, non per giorno: le quattro stagioni pesano sulla produzione e sui consumi,
  ma non esiste uno stato del mondo "a metà anno".
- Molte decisioni sono prese a livello di comunità (migrazione, costruzioni, diplomazia): gli individui scelgono
  azioni e ruoli, ma non si muovono singolarmente sulla mappa.
- Ogni batch riscrive tutte le persone vive (upsert a blocchi): semplice e corretto, ma cresce con la popolazione.
- La grammatica dei template è semplificata (articoli davanti ai nomi delle tribù).
- Gli snapshot sono JSON non compressi (qualche centinaio di KB ciascuno): se ne conservano pochi.
- Nessuna autenticazione: `owner_id` è predisposto ma non usato, e con esso l'RLS.
- La guerra è un sistema strategico aggregato: non esiste una mappa tattica né il movimento degli eserciti.
- Le persone comuni restano individui completi: l'interfaccia di aggregazione è prevista ma non implementata,
  quindi oltre ~1.500 individui attivi le prestazioni degradano.
- Test end-to-end Playwright non inclusi (lo scenario è coperto dai test d'integrazione su API e DB).

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
9. **IA narrativa opzionale e locale**: un livello puramente descrittivo sopra gli eventi già persistiti, non
   deterministico e sempre disattivabile, che non partecipa mai alle decisioni degli agenti.
