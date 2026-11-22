# Subiaco Isometrica

Mappa isometrica interattiva di **Subiaco (RM)** e **Monte Livata**, costruita da dati aperti e dipinta con AI.

Ispirata a [Mondo Isometrico](https://github.com/dg996/mondoisometrico) a sua volta basato su [isometricworld](https://github.com/krasun/isometricworld).

> FASE 4: viewer web sulla piramide AVIF (dipinta se c'è, altrimenti il render; schema leggero se `data/` è vuoto).

## Cosa sarà
- Il centro storico di Subiaco, la Rocca Abbaziale, il Ponte San Francesco e il fiume Aniene
- I monasteri benedettini di Santa Scolastica e del Sacro Speco
- Monte Livata con la seggiovia, le piste di sci alpino a Monna dell'Orso e le pista di sci di fondo di Campo dell'Osso, immerse nella faggeta più estesa d'Europa.
- Viewer web con zoom e pan, meteo in tempo reale e ciclo giorno/notte

## Fonti dati
- [OpenStreetMap](https://www.openstreetmap.org/copyright) (© contributori OpenStreetMap, ODbL)
- Carta Tecnica Regionale della Regione Lazio
- [ESA WorldCover](https://esa-worldcover.org/)
- [Copernicus DEM](https://spacedata.copernicus.eu/collections/copernicus-digital-elevation-model)

## Roadmap
Vedi [ROADMAP.md](ROADMAP.md). L'analisi iniziale dei dati OpenStreetMap è in [docs/fase0-dati-osm.md](docs/fase0-dati-osm.md). La geometria è in [docs/fase1-geometria.md](docs/fase1-geometria.md). Il render a tile e l'heading congelato sono in [docs/fase2-render.md](docs/fase2-render.md). La pittura è in [docs/fase3-painting.md](docs/fase3-painting.md). Il viewer è in [docs/fase4-viewer.md](docs/fase4-viewer.md). Le bounding box e i landmark stanno in [config/areas.json](config/areas.json). Camera, zoom, cache e quote stanno in [docs/riferimenti-pipeline.md](docs/riferimenti-pipeline.md) e in [config/pipeline.json](config/pipeline.json). Lo stile della pittura sta in [config/paint.json](config/paint.json).

## Sviluppo

### Requisiti
- Node.js 24 o successivo. Il file `.nvmrc` contiene `24` (`nvm use`).
- npm, incluso con Node.
- Chromium o Google Chrome sul sistema, solo dal render in poi (FASE 2). La dipendenza è `playwright-core`, come in Mondo Isometrico: non scarica un browser e userà il percorso in `CHROME_PATH`. La verifica OSM non avvia Chromium.

### Primo avvio

```bash
nvm use
npm install
cp .env.example .env
npm run check:osm
```

`.env` è facoltativo per la verifica: senza file valgono i default (Overpass pubblico). Non inserire segreti nel repository. I dati scaricati, le tile e `.env` sono in `.gitignore`.

### Comandi

| Comando | Cosa fa |
|---|---|
| `npm test` | Controlli locali: Overpass, quote, render, finestre di pittura, faggeta, arco del ponte, proiezione del viewer, schema e server. |
| `npm run check:osm` | Conta edifici, strade e altre categorie sull'area predefinita (`centro-storico`) e controlla i landmark. Non salva dati. |
| `npm run check:osm -- monte-livata` | Stessa verifica su un'altra area (`centro-storico`, `centro-monasteri`, `monte-livata`). |
| `npm run check:osm -- --list` | Elenca aree e landmark, senza rete. |
| `npm run fetch` | Scarica OSM, CTR e (se mancano) DEM e WorldCover. Cache in `data/raw/`. |
| `npm run ground` | Suolo, acqua e classi WorldCover in `data/derived/<area>/ground/`. |
| `npm run scene` | Edifici, strade, landmark, alberi, GLB e anteprime PNG. |
| `npm run render` | Tile isometriche 1024 px del centro storico, più il mosaico. Vedi [docs/fase2-render.md](docs/fase2-render.md). |
| `npm run render -- centro-storico --finestra rocca-ponte` | Solo le tile intorno alla Rocca e al Ponte San Francesco. |
| `npm run paint` | Finestre da 1024 px sulle tile di render, fusione, piramide dalle tile dipinte. Vedi [docs/fase3-painting.md](docs/fase3-painting.md). |
| `npm run paint -- --anteprima-stile` | Riscrive le JPEG di stile in `docs/` con il provider mock, senza le tile del borgo. |
| `npm run export` | Piramide AVIF zoom 8 → 2, tile web da 512 px, dal render geometrico. Non pubblica. |
| `npm run export -- --dipinte` | La stessa piramide, letta da `data/derived/<area>/paint/`. |
| `npm run dev` | Viewer su `http://127.0.0.1:4321/`. Piramide in `data/web` se c'è, altrimenti uno schema leggero. Vedi [docs/fase4-viewer.md](docs/fase4-viewer.md). |
| `npm run publish` | Segnaposto FASE 5 (upload delle tile). Non contatta alcun servizio. |
| `npm run deploy` | Segnaposto FASE 5 (sito). Non contatta alcun servizio. |

Senza argomenti `fetch`, `ground`, `scene`, `render`, `paint` ed `export` usano `centro-storico`. Un'altra area si passa come argomento (`npm run scene -- monte-livata`); `--all` esegue le tre finestre su fetch, ground e scene. I dati scaricati, le tile e la piramide restano in `data/` e non vanno committati. `paint` non chiama un'API se `PAINT_API_KEY` è vuota: usa il provider mock. `npm run dev` serve il viewer in locale e, se la piramide manca, genera solo uno schema in `data/`. Il meteo, a pagina aperta, chiama Open-Meteo senza chiave. `publish` e `deploy` sono ancora segnaposto e non contattano servizi di hosting. La pipeline prevista resta: fetch → ground → scene → render → paint → export → viewer → publish → deploy.

Non serve un fork di Mondo Isometrico né di isometricworld. I due progetti sono MIT: il codice si può adattare più avanti, file per file, tenendo la nota di copyright. Questo repository resta indipendente. Il perché è in [docs/riferimenti-pipeline.md](docs/riferimenti-pipeline.md).

### Cartelle
- `config/areas.json` — bounding box in formato S, W, N, E e landmark con id OSM
- `config/pipeline.json` — camera a 45°, piramide di zoom, finestre di pittura, cache, regione con heading congelato
- `config/paint.json` — prompt, tavolozza, soglia della faggeta, edifici e split da verificare
- `scripts/check-osm.mjs` — verifica Overpass (`out count`, senza geometrie). Rifiuta `http://` e rispetta `Retry-After` sui 429
- `scripts/fase.mjs` — avvia fetch, ground, scene, render, paint, export e dev; publish e deploy restano segnaposto
- `pipeline/src` — fetch, suolo, scena, render, pittura, export, DEM, WorldCover, CTR
- `pipeline/page` — pagina Three.js del render. `pipeline/style` resta vuoto: lo stile è il testo in `config/paint.json`
- `config/altezze.json` — default di tipologia quando la CTR non ha un volume
- `web/src`, `web/public` — viewer statico (pan, zoom, luoghi, meteo, giorno/notte). Le tile non stanno in `web/public`

## Licenza
Codice: [MIT](LICENSE). I dati restano soggetti alle licenze delle rispettive fonti: vedi [ATTRIBUTION.md](ATTRIBUTION.md).
