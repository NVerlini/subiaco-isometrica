# Subiaco Isometrica

Mappa isometrica interattiva di **Subiaco (RM)** e **Monte Livata**, costruita da dati aperti e dipinta con AI.

Ispirata a [Mondo Isometrico](https://github.com/dg996/mondoisometrico) di Domenico ([@dom_gag_96](https://x.com/dom_gag_96)), a sua volta basato su [isometricworld](https://github.com/krasun/isometricworld).

> 🚧 FASE 0 completata (ambiente, config delle aree, verifica OSM). La geometria (FASE 1) non è ancora implementata.

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
Vedi [ROADMAP.md](ROADMAP.md). L'analisi iniziale dei dati OpenStreetMap è in [docs/fase0-dati-osm.md](docs/fase0-dati-osm.md). Le bounding box e i landmark stanno in [config/areas.json](config/areas.json). Camera, zoom, cache e cosa prendere dai riferimenti fase per fase stanno in [docs/riferimenti-pipeline.md](docs/riferimenti-pipeline.md) e in [config/pipeline.json](config/pipeline.json).

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
| `npm run check:osm` | Conta edifici, strade e altre categorie sull'area predefinita (`centro-storico`) e controlla i landmark. Non salva dati. |
| `npm run check:osm -- monte-livata` | Stessa verifica su un'altra area (`centro-storico`, `centro-monasteri`, `monte-livata`). |
| `npm run check:osm -- --list` | Elenca aree e landmark, senza rete. |
| `npm run fetch` | Segnaposto FASE 1 (fetch OSM). |
| `npm run ground` | Segnaposto FASE 1 (suolo). |
| `npm run scene` | Segnaposto FASE 1 (scena). |
| `npm run render` | Segnaposto FASE 2 (render a tile). |
| `npm run paint` | Segnaposto FASE 3 (pittura). |
| `npm run export` | Segnaposto della piramide di tile (zoom 8 → 2). Non pubblica. |
| `npm run dev` | Segnaposto FASE 4 (viewer Astro e OpenSeadragon). |
| `npm run publish` | Segnaposto FASE 5 (upload delle tile). Non contatta alcun servizio. |
| `npm run deploy` | Segnaposto FASE 5 (sito). Non contatta alcun servizio. |

I segnaposto non scaricano nulla e non contattano servizi di hosting: stampano lo stadio previsto e terminano. La pipeline prevista è la stessa dei progetti di riferimento: fetch → ground → scene → render → paint → export → viewer → publish → deploy.

Non serve un fork di Mondo Isometrico né di isometricworld. I due progetti sono MIT: il codice si può adattare più avanti, file per file, tenendo la nota di copyright. Questo repository resta indipendente. Il perché è in [docs/riferimenti-pipeline.md](docs/riferimenti-pipeline.md).

### Cartelle
- `config/areas.json` — bounding box in formato S, W, N, E e landmark con id OSM
- `config/pipeline.json` — camera a 45°, piramide di zoom, finestre di pittura, cache, regione provvisoria
- `scripts/check-osm.mjs` — verifica Overpass (`out count`, senza geometrie)
- `scripts/fase.mjs` — segnaposto degli stadi
- `pipeline/src`, `pipeline/page`, `pipeline/style` — codice futuro di fetch, ground, scene, render e paint; lo stile grafico arriva in FASE 3
- `web/src`, `web/public` — viewer futuro (Astro e OpenSeadragon, non ancora dipendenze)

## Licenza
Codice: [MIT](LICENSE). I dati restano soggetti alle licenze delle rispettive fonti: vedi [ATTRIBUTION.md](ATTRIBUTION.md).
