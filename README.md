# Genesis

Simulazione procedurale di civiltà umane. Un mondo nasce da un **seed**, poche tribù di cacciatori-raccoglitori
si muovono su una mappa 2D e, anno dopo anno, raccolgono cibo, si riproducono, migrano, fondano insediamenti,
scoprono tecnologie, commerciano, stringono alleanze e si fanno la guerra.

Nessun LLM decide nulla: ogni evento deriva da regole esplicite, stato persistente e un PRNG seedato.
Stesso stato iniziale + stesso seed + stesso numero di tick = stesso risultato, anche se i tick sono
eseguiti in batch diversi e lo stato passa dal database (verificato dai test).

- **Stack**: Next.js 16 (App Router) · TypeScript strict · Tailwind CSS 4 · componenti in stile shadcn/ui ·
  Drizzle ORM · PostgreSQL (Supabase) / PGlite in locale · Zod · TanStack Query · Zustand (solo UI) ·
  Canvas 2D · Recharts · Vitest.
- **Deploy**: Vercel, senza server persistenti né loop lato server.

---

## Indice

1. [Avvio rapido](#avvio-rapido)
2. [Variabili d'ambiente](#variabili-dambiente)
3. [Database e migrazioni](#database-e-migrazioni)
4. [Test, lint, typecheck](#test-lint-typecheck)
5. [Deploy su Vercel con Supabase](#deploy-su-vercel-con-supabase)
6. [Architettura](#architettura)
7. [Modello di simulazione](#modello-di-simulazione)
8. [API](#api)
9. [Scalabilità](#scalabilità)
10. [Limiti noti e trade-off](#limiti-noti-e-trade-off)
11. [Roadmap tecnica](#roadmap-tecnica)

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

## Variabili d'ambiente

| Variabile                                  | Obbligatoria      | Descrizione                                                                                                               |
| ------------------------------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                             | in produzione     | Connessione runtime. Su Supabase usa il **pooler in transaction mode** (porta 6543). Fallback: `POSTGRES_URL`.            |
| `DIRECT_URL`                               | per le migrazioni | Connessione diretta/session (porta 5432) usata da `db:migrate`. Fallback: `POSTGRES_URL_NON_POOLING`, poi `DATABASE_URL`. |
| `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING` | —                 | Create automaticamente dall'integrazione Supabase del Vercel Marketplace: vengono lette senza doverle rinominare.         |
| `NEXT_PUBLIC_APP_URL`                      | no                | URL pubblico dell'app.                                                                                                    |
| `SIMULATION_MAX_TICKS_PER_REQUEST`         | no (100)          | Limite di tick per chiamata a `/simulate`.                                                                                |
| `SIMULATION_TIME_BUDGET_MS`                | no (20000)        | Budget di calcolo per richiesta: oltre questa soglia il batch si ferma e salva i tick completati (`partial: true`).       |
| `SIMULATION_LOCK_TTL_MS`                   | no (60000)        | Durata del lock per mondo (protezione da lock orfani).                                                                    |
| `DATABASE_POOL_MAX`                        | no (3)            | Connessioni massime per istanza serverless.                                                                               |
| `PGLITE_DIR`                               | no                | Cartella di PGlite in locale (default `.data/pglite`).                                                                    |
| `CRON_SECRET`                              | no                | Abilita il cron opzionale `/api/cron/advance`.                                                                            |

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
| `world_stats`                                                    | serie temporale per tick, alimenta i grafici                                                                                                                                |
| `world_snapshots`                                                | stato completo a tick 0 e ogni 100 tick (conservati gli ultimi 3 più lo 0)                                                                                                  |
| `simulation_locks`, `simulation_runs`                            | lock per mondo e log di ogni batch (durata, esito, errori)                                                                                                                  |

Scelte:

- Gli id dei mondi sono **UUID**. Le entità hanno id **deterministici e locali al mondo** (`p12`, `t3`, `s5`…)
  con chiave primaria `(world_id, id)`: lo stesso seed produce esattamente gli stessi id.
- Indici su `(world_id, tick)`, `(world_id, year)`, `(world_id, importance, seq)`, `(world_id, type, seq)`,
  coordinate delle celle (chiave primaria), un indice parziale sulle persone vive e sui nuclei familiari attivi.
- Ogni batch è salvato in **una transazione** con insert e upsert multi-riga (`INSERT … ON CONFLICT DO UPDATE`
  a blocchi di 400 righe). Delle celle si riscrivono solo quelle cambiate. Il caricamento di un mondo usa
  8 query, senza N+1.
- Le persone morte restano nel database (`alive = false`, anno e causa) ma non vengono ricaricate nella simulazione.

## Test, lint, typecheck

```bash
npm test            # Vitest: core + integrazione DB (PGlite in memoria) + API
npm run lint        # ESLint (config Next core-web-vitals + TypeScript)
npm run typecheck   # tsc --noEmit (strict, noUncheckedIndexedAccess)
npm run format      # Prettier
npm run build       # build di produzione
```

Cosa coprono i test (`packages/simulation-core/tests`, `tests/`):

- generazione deterministica della mappa (stesso seed, stesso output) e relazioni coerenti tra biomi, acqua e fertilità;
- 3–6 tribù di 15–40 persone in celle abitabili e distanziate;
- produzione e consumo di cibo, esaurimento delle risorse naturali;
- morte per fame in condizioni estreme;
- nascite solo in condizioni valide (coppia, età fertile, salute, cibo);
- fondazione di insediamenti (e rifiuto quando mancano le condizioni);
- tecnologie che rispettano prerequisiti, soglie e geografia;
- migrazione da zone inospitali;
- risultato di battaglia deterministico con seed noto (snapshot);
- **simulazione di 100 tick con invarianti**: popolazione mai negativa, risorse mai NaN o negative, coordinate nei
  limiti, nessun morto che agisce, ogni persona viva appartiene a una tribù attiva e a un insediamento valido,
  nessun evento che riferisce entità inesistenti;
- determinismo: batch da 60 = 10 + 25 + 25 con serializzazione intermedia;
- **round trip sul database**: 50 + 10 tick salvati e ricaricati da Postgres (PGlite) = 60 tick in memoria;
- lock: seconda acquisizione negata, lock scaduto ripreso, due richieste simultanee di cui una rifiutata con 409;
- validazione API: tick non consentiti (400 `TICKS_NOT_ALLOWED`), JSON non valido, mondo inesistente (404), filtri eventi.

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
5. **Cron (opzionale)**: `/api/cron/advance` avanza di 10 anni fino a 3 mondi con stato `running`. È disattivato
   se `CRON_SECRET` non è impostato. Per attivarlo aggiungi a `vercel.json`
   `"crons": [{ "path": "/api/cron/advance", "schedule": "0 * * * *" }]` e imposta `CRON_SECRET`: Vercel invia
   `Authorization: Bearer <CRON_SECRET>`. Il MVP non ne dipende: la UI avanza il tempo con chiamate esplicite.

Vercel va benissimo per UI e batch limitati. Una simulazione molto grande (decine di migliaia di individui,
molti mondi sempre attivi) va spostata su un worker con una coda esterna: vedi [Scalabilità](#scalabilità).

## Architettura

```
app/                         Next.js App Router: pagine (server) e route handler REST
  api/worlds/…               POST/GET mondi, GET/PATCH/DELETE mondo, simulate, events, stats
  api/cron/advance           cron opzionale
components/
  ui/                        primitive in stile shadcn (button, input, tabs, badge, panel…)
  world/                     mappa canvas, controlli, cronaca, statistiche, pannelli di dettaglio
lib/
  db/                        schema Drizzle, connessione (postgres-js | PGlite), mapper, repository, lock
  services/world-service.ts  casi d'uso: crea, carica, simula (lock → load → run → save), eventi, statistiche
  validation/                schemi Zod
  client/                    fetch API, store Zustand (solo UI), palette, formattazione
  utils/                     errori applicativi, risposte API, logger JSON
packages/simulation-core/    motore puro: nessun import da Next.js, Drizzle o DB
  src/                       types, prng, terrain, world-generator, agents, economy, population,
                             migration, settlements, technology, diplomacy, warfare, events,
                             simulation-engine, serialization
  tests/                     test del motore
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
volta (1/10/50/100 anni a passo, scelti con "Velocità") e aspetta la risposta prima del successivo; il cron
opzionale può fare lo stesso lato server.

**Logging**: JSON su una riga (`simulate.batch` con tempi di caricamento, calcolo e salvataggio, tick, persone,
eventi; `simulate.failed`, `api.unhandled`, `world.created`).

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

### Ordine di un tick

1. Clima: oscillazione annuale e siccità regionali casuali (seedate).
2. Rigenerazione logistica di fauna e legname; recupero della fertilità dei terreni a riposo.
3. Comunità (bande nomadi o insediamenti), capi, ruoli e **azioni individuali**.
4. Produzione di cibo e materiali.
5. Redistribuzione tra villaggi della stessa tribù, consumo, deperimento e limiti di magazzino.
6. Fame e salute.
7. Coppie (anche tra comunità amiche) e nascite.
8. Invecchiamento e mortalità naturale.
9. Morti per fame o malattia (quelle in battaglia avvengono al punto 13).
10. Migrazione delle bande, scissione delle bande troppo grandi, fusione dei gruppi minuscoli.
11. Fondazione di insediamenti, cantieri, colonie, secessioni, abbandono.
12. Ricerca tecnologica.
13. Relazioni: commercio, condivisione di conoscenza, incursioni, guerre, battaglie, pace, alleanze.
14. Eventi storici (generati lungo tutto il tick).
15. Estinzioni, civiltà, soglie di popolazione, statistiche.

### Azioni individuali

Ogni adulto ha competenze (raccolta, caccia, costruzione, combattimento, artigianato) e personalità (aggressività,
cooperazione, curiosità, tolleranza al rischio, socialità). Il ruolo nasce dall'età e dall'incontro tra competenze
e bisogni della comunità. L'azione (riposare, raccogliere, cacciare, coltivare, spostarsi, costruire, socializzare,
unirsi a un gruppo, riprodursi, difendere) è scelta con una **funzione di punteggio pesata** e un piccolo rumore
seedato (`agents.ts`). Le azioni consumano energia e allenano la competenza usata.

### Cibo (1 unità = fabbisogno annuo di un adulto)

- **Raccolta** = Σ 1,35 · (0,7 + 0,6·abilità) · efficienza · (0,6 + 0,8·fertilità media) · tecnologia.
- **Caccia** = Σ 1,7 · (0,6 + 0,8·abilità) · efficienza · tecnologia.
- Raccolta e caccia prelevano al massimo il 45% della fauna di ogni cella dell'area di lavoro, che si rigenera
  in modo logistico (`r = 0,45`): se sovrasfruttata, riparte molto lentamente.
- Pesca: +0,25 per raccoglitore se l'area tocca un fiume o la costa.
- **Agricoltura**: contadini ≤ 4 per campo; resa 2,6 · abilità · fertilità del campo · tecnologia. I campi
  impoveriscono il suolo; l'allevamento dimezza il degrado.
- Tutto viene moltiplicato per il clima locale.
- Consumo: adulto 1, bambino 0,6, anziano 0,8. Deperimento annuo 25% (dimezzato dalla ceramica). Magazzino
  limitato da capacità di trasporto (bande) o magazzini (insediamenti).
- In carenza il cibo è **razionato** (prima adulti che lavorano, poi bambini, poi anziani). La fame sale di
  (1 − quota ricevuta)·0,55 e sopra 0,3 intacca la salute; a salute zero si muore di fame.
- Il surplus alza la probabilità di nascita, la velocità di ricerca e permette colonie.

### Demografia

- Probabilità annua di nascita per donna 16–45 in coppia, con partner nella stessa comunità:
  0,24 · cibo · intenzione · età · sicurezza · alloggio · salute. È zero se la madre ha fame > 0,6, salute < 0,4
  oppure se la copertura del fabbisogno è sotto l'80%. Minimo due anni tra un parto e l'altro.
- Mortalità naturale per fasce d'età (10% nel primo anno, 35% oltre gli 85), modulata da salute e tecnologia.
- `populationSoftCap` (1.500) è solo una protezione per le prestazioni; i limiti reali sono cibo e alloggi.

### Insediamenti e infrastrutture

- **Fondazione**: banda con ≥ 25 persone, ferma da ≥ 8 anni, fabbisogno coperto, scorte, cella con abitabilità
  ≥ 0,5, nessun villaggio entro 4 celle e agricoltura conosciuta (oppure sito eccezionale su fiume o costa).
- Edifici: accampamento (alloggio 15), capanne (+8 alloggio), magazzino (+90 capacità), campo agricolo (+1 campo),
  strada (collega due villaggi: raggio doppio per redistribuzione e commercio, difesa +10%), palizzata (difesa +50%).
  Si costruiscono in ordine di priorità pagando legno e pietra; il lavoro dei costruttori fa avanzare il cantiere.
- Livelli 1–5 da popolazione, edifici e scrittura; il livello determina il raggio del territorio.
- Colonie dai villaggi sovraffollati. Secessione possibile delle colonie lontane (più rara con la scrittura).
- Abbandono dopo 3 anni di carestia o sotto i 6 abitanti: i superstiti si rifugiano in un altro villaggio o
  tornano nomadi.
- **Civiltà**: tribù con almeno 2 insediamenti e 100 abitanti.

### Tecnologie

Fuoco, utensili di pietra, agricoltura, ceramica, allevamento, lavorazione del rame, scrittura, organizzazione
militare. Ognuna ha prerequisiti, popolazione minima, eventuale obbligo di insediamento, condizioni di risorse
e geografia (rame nel territorio, terre fertili, acqua…), un costo di ricerca e **effetti misurabili**
(`technology.ts`). Il progresso annuo dipende dalla curiosità degli adulti, dal surplus e dal capo. La conoscenza
si diffonde con il commercio e la convivenza (progresso parziale), con la migrazione (le persone portano con sé
ciò che sanno) e con la conquista.

### Relazioni e guerra

Ogni coppia di tribù in contatto (≤ 14 celle) ha fiducia, ostilità, volume di scambi, memoria dei conflitti,
distanza, guerra, alleanza e tregua. L'ostilità cresce con aggressività, fame, vicinanza dei confini,
sovraffollamento, rame conteso e rancori; la fiducia cresce con cooperazione, scambi e alleanze.

- **Guerra** solo dopo 150 anni, fuori dalla tregua, con vantaggio militare, motivazione > 0,6 e una probabilità
  bassa. **Incursioni** dopo 40 anni, se c'è fame, aggressività e superiorità.
- **Battaglia astratta** (`resolveBattle`): potenza = guerrieri · salute/abilità · morale · tecnologia · difesa ·
  terreno, moltiplicata per un tiro seedato in [0,75; 1,25]. Il perdente perde il 10–40% dei combattenti,
  il vincitore il 3–12%. Seguono saccheggio, calo del morale e, con vittoria netta su un insediamento
  indebolito, occupazione (la popolazione viene assorbita dal vincitore).
- La pace arriva per stanchezza della guerra, con una tregua di 20–40 anni.

### Eventi

Tipi: nascita, morte illustre, carestia, migrazione, fondazione, costruzione, scoperta, commercio, conflitto,
battaglia, pace, collasso, crescita della popolazione, nuova civiltà, alleanza, estinzione, conquista. Il testo
è generato da template deterministici con riferimenti geografici, per esempio:
«Anno -9937 — La tribù Allaa ha lasciato le pianure del sud. Dopo 2 anni di scarsità, 27 persone hanno
raggiunto la valle del fiume Datal.»

## API

Tutte le risposte hanno la forma `{ "data": … }` oppure `{ "error": { "code", "message", "details?" } }`.

| Metodo   | Percorso                   | Note                                                                                                      |
| -------- | -------------------------- | --------------------------------------------------------------------------------------------------------- |
| `POST`   | `/api/worlds`              | `{ name, seed?, width?, height? }` (24–96). Genera mappa, tribù e popolazione. 201 → `{ worldId, world }` |
| `GET`    | `/api/worlds`              | elenco dei mondi con riepilogo                                                                            |
| `GET`    | `/api/worlds/:id`          | stato, mappa a colonne, tribù, insediamenti, civiltà, relazioni, tecnologie                               |
| `PATCH`  | `/api/worlds/:id`          | `{ status: "running" \| "paused" }`                                                                       |
| `DELETE` | `/api/worlds/:id`          | elimina il mondo (cascade)                                                                                |
| `POST`   | `/api/worlds/:id/simulate` | `{ ticks: 1 \| 10 \| 50 \| 100 }` → riepilogo, eventi principali, metriche, `partial`                     |
| `GET`    | `/api/worlds/:id/events`   | `page`, `pageSize` (≤ 100), `type` (lista separata da virgole), `minImportance`                           |
| `GET`    | `/api/worlds/:id/stats`    | serie temporali, `maxPoints` (campionamento)                                                              |

Codici di errore: `INVALID_INPUT` 400, `TICKS_NOT_ALLOWED` 400, `NOT_FOUND` 404, `SIMULATION_IN_PROGRESS` 409,
`TIMEOUT` 504, `DATABASE_ERROR` 500, `INTERNAL` 500.

## Scalabilità

Il MVP gestisce bene circa 1.000–1.500 individui attivi: 100 tick richiedono circa 0,2–0,5 s di calcolo e
0,4–1 s di salvataggio su PGlite locale. Evoluzioni previste (non ancora implementate):

- **Simulazione ibrida**: individui completi per piccoli gruppi, capi e figure rilevanti; popolazioni aggregate
  (coorti per età e sesso) per città grandi ed eserciti. `Community` è già il punto di aggregazione naturale.
- **Snapshot e event sourcing selettivo**: `world_snapshots` contiene già stati completi; con il PRNG
  serializzato si può ripartire da uno snapshot e rigiocare i tick per ricostruire o verificare la storia.
- **Aggregazioni statistiche**: viste materializzate o rollup per secolo sopra `world_stats` e `historical_events`.
- **Worker esterno**: per mondi grandi o sempre attivi, spostare `runSimulation` in un worker (Fly.io, Railway,
  un container o una Vercel Queue) alimentato da una coda. Next.js resta per UI e API; il lock passa a Redis.
- **Scrittura incrementale**: tracciare le entità modificate (dirty set) invece di riscrivere tutte le persone vive.

## Limiti noti e trade-off

- Il bilanciamento è empirico: alcuni seed producono molte bande in lotta, altri poche civiltà stabili. I parametri
  sono in `constants.ts` e nei singoli moduli.
- Molte decisioni sono prese a livello di comunità (migrazione, costruzioni, diplomazia): gli individui scelgono
  azioni e ruoli, ma non si muovono singolarmente sulla mappa.
- Ogni batch riscrive tutte le persone vive (upsert a blocchi): semplice e corretto, ma cresce con la popolazione.
- La grammatica dei template è semplificata (articoli davanti ai nomi delle tribù).
- Gli snapshot sono JSON non compressi (qualche centinaio di KB ciascuno): se ne conservano pochi.
- Nessuna autenticazione: `owner_id` è predisposto ma non usato.
- Test end-to-end Playwright non inclusi (lo scenario è coperto dai test d'integrazione su API e DB).

## Roadmap tecnica

1. Autenticazione (Supabase Auth) e `owner_id` sui mondi, con policy RLS.
2. Tracciamento delle entità modificate per salvataggi incrementali; compressione degli snapshot.
3. Coorti aggregate per popolazioni grandi (simulazione ibrida) e profiling a 10k individui.
4. Worker e coda esterna per l'avanzamento continuo; lock su Upstash Redis.
5. Smoke test Playwright (crea mondo → +10 anni → verifica timeline).
6. Narrativa opzionale con LLM applicata solo agli eventi strutturati già persistiti.
7. Nuove tecnologie ed età (bronzo, ferro, navigazione) e diplomazia multilaterale.
