# Cosa prendiamo dai riferimenti, e quando

Confronto tra questa base e [isometricworld](https://github.com/krasun/isometricworld) (krasun) e [Mondo Isometrico](https://github.com/dg996/mondoisometrico) (dg996), che è il fork di Roma dello stesso progetto. I due repository condividono camera, piramide di zoom, cache e viewer. Mondo Isometrico aggiunge i dati laziali (CTR, WorldCover, Copernicus) e il sito di Roma.

I numeri da rispettare stanno in [config/pipeline.json](../config/pipeline.json). Le aree di Subiaco stanno in [config/areas.json](../config/areas.json). Qui non c'è il codice delle fasi: solo il contratto, così la FASE 1 non riparte da zero e non congela scelte sbagliate.

## Non serve un fork

Il repository resta indipendente. La licenza MIT dei due progetti permette di riusare il codice senza fork, a patto di tenere la nota di copyright nei file effettivamente copiati. Un fork porterebbe storia, issue e codice di Tel Aviv, Stoccarda e Roma (GIS comunale, ATAC, LoD2 del Baden-Württemberg) che non servono a Subiaco. La FASE 6 della roadmap prevede comunque un repository per comune, con la stessa pipeline e una config di area: un fork di Roma non è quel modello.

L'obbligo MIT, finché non si copia un file, è il credito già in [ATTRIBUTION.md](../ATTRIBUTION.md). Quando si adatterà un sorgente, quel file dovrà riportare Copyright (c) 2026 Dmytro Krasun e, se viene dal fork di Roma, anche Copyright (c) 2026 Domenico Gagliardi.

## Parametri già scritti

| Parametro | Valore | Dove sta nel riferimento |
|---|---|---|
| Inclinazione camera | 45° sotto l'orizzonte | `CAMERA.pitchDeg` |
| Metri per pixel d'arte | 0,25 | `CAMERA.mpp` |
| Tile di render | 1024 px | `CAMERA.tile` |
| Tile web | 512 px | export, `TS` |
| Zoom nativo / minimo | 8 / 2 | export, `NATIVE_Z` / `MIN_Z` |
| Overlap tile | 0 | OpenSeadragon |
| Finestra di pittura | 1024 px, overlap 128, passo 896, sfumatura 64 | `paint.ts` |
| Formato pubblicato | AVIF | export |

L'heading di 45° della regione Roma è l'azimut verso cui guarda la camera. Per Subiaco è congelato a 315° in FASE 2: stessa diagonale, specchiata, così l'Aniene sta a sinistra. Vedi `docs/fase2-render.md`.

## FASE 0 — fatto

Preso come setup, senza sorgente:

- Nomi degli stadi e degli script: `fetch`, `ground`, `scene`, `render`, `paint`, `export`, `dev`, `publish`, `deploy`.
- Cartelle `pipeline/` (src, page, style), `web/` (pages, scripts, components, public).
- `playwright-core` e Chromium di sistema (`CHROME_PATH`), non il browser scaricato da Playwright.
- Layout della cache sotto `data/`, tutto gitignorato.
- Licenza MIT propria e attribuzione delle fonti. Non è stato copiato l'account Cloudflare né il nome dei bucket (`isometricworldtiles`, `mondoisometricotiles`) che compaiono nei riferimenti.

Non preso: proiezione, Three.js, Astro, immagini di stile, script di publish reale.

## FASE 1 — geometria e dati

Portato, adattando i file e tenendo la nota di copyright dove il sorgente è ripreso (vedi `ATTRIBUTION.md` e `docs/fase1-geometria.md`):

- Scarico OSM in `data/raw/<area>/` (`osm.json`, `roads.json`, `ground.json`), saltando il file se c'è già. In più: coperture WFS e unità volumetriche CTR.
- DEM Copernicus in `data/raw/dem/`. Tile unico `N41 E013`, misurato.
- WorldCover 2021 in `data/raw/worldcover/`.
- Suolo e scena in `data/derived/<area>/`, con anteprima PNG e GLB.
- Una regione sola, `subiaco`, origine sulla Rocca Abbaziale (41,92609 N, 13,09482 E). L'heading è congelato a 315° dal render della FASE 2.

Da non portare: layer ArcGIS di Tel Aviv, LoD2/DGM1 della LGL, estratti Geofabrik di Stoccarda, bus ATAC.

Misure chiuse il 17 novembre 2026, scritte in `config/pipeline.json`:

- `geoidM` 49,78 m (EGM2008 all'origine, GeographicLib GeoidEval).
- `groundH` 547,7 m ellissoidici (DSM sulla Rocca 497,9 m + geoide).
- `heightBase` 420 m ellissoidici. Il dislivello ortometrico misurato è 1380 m (fondovalle 365 m, cresta di Monte Livata 1745 m) e non entra nei 655 m del riferimento. La codifica si allarga a 3 cm per unità a 16 bit (`codificaAltezze`), una sola regione.
- Altezze: unità volumetriche CTR (campo `UN_VOL_AV`) dove il volume cade nell'edificio; altrimenti `building:levels`, altrimenti il default di `config/altezze.json`.
- Alberi: ESA WorldCover (classi 10 e 20) più i node OSM.
- Heading congelato a 315° (FASE 2).

## FASE 2 — render isometrico

Portato, adattando i file e tenendo la nota di copyright (vedi `ATTRIBUTION.md` e `docs/fase2-render.md`):

- `cameraTile` in `pipeline/src/geo.mjs`, dalla matematica di `camera.ts` (ECEF → ENU → pixel d'arte, camera ortografica per tile).
- Pagina Three.js in `pipeline/page/renderer.js`, lanciata con Chromium via `playwright-core`.
- Output: `data/derived/<area>/render/<tx>_<ty>.png` (1024²) e `height/<tx>_<ty>.png` (256², passo 3 cm).
- Piramide non dipinta in `data/web/regions/subiaco/tiles/photo/{z}/{x}/{y}.avif`, zoom 8 → 2, tile 512.

Il primo test è la finestra Rocca–Ponte San Francesco, poi il bbox `centro-storico`. `centro-monasteri` e `monte-livata` restano aree della stessa regione, non altre camere. L'heading non si cambia più.

## FASE 3 — pittura

Il riferimento non dipinge con una chiave API. Usa la Codex CLI (`codex exec`) sull'account locale, a finestre da 1024 px con 128 px di sovrapposizione, poi fonde con una sfumatura di 64 px. Ogni finestra riceve il render, il pass altezze, `pipeline/style/reference.png` e il foglio degli alberi. I vicini già dipinti entrano nella striscia di overlap. La geometria non si inventa: il risultato viene confrontato con il render.

La cartella `pipeline/style/` è vuota di proposito. Lo stile (Roma Isometrica o Tel Aviv) si sceglie in questa fase. I PNG dei riferimenti pesano diversi megabyte e non vanno copiati prima di quella scelta. Per il clima di Subiaco e per la neve a Monte Livata servirà quasi certamente un foglio alberi proprio, e una variante invernale: il riferimento lo prevede per un clima diverso da Tel Aviv.

## FASE 4 — viewer

Stack del riferimento: Astro e OpenSeadragon. Non sono dipendenze di questa fase di setup, così `npm install` non scarica il sito prima che esista una tile.

Contratto da rispettare quando si scriverà `web/`:

- Una pagina per vista, slug ASCII (`/subiaco`), dati regione letti da `world.json` pubblicato.
- Piramide sparsa, `minLevel` 2 e `maxLevel` 8, `tileOverlap` 0, `maxZoomPixelRatio` 2,5, `zoomPerScroll` 1,35.
- Deep link `#@x,y,zoom` in pixel d'arte globali.
- Le tile non stanno in `web/public`: in locale il dev server legge `data/web/` sopra l'origine di produzione.
- Crediti OSM visibili, come richiede l'ODbL.

Traffico, gatti, treni, meteo e ciclo giorno/notte sono funzioni del riferimento o della roadmap, non prerequisiti del viewer. Il meteo (Open-Meteo) e il giorno/notte sono in FASE 4 della roadmap; il traffico è facoltativo. Non si porta il proxy TomTom di Mondo Isometrico.

## FASE 5 — pubblicazione

Ordine del riferimento, da tenere:

1. `export` costruisce la piramide (zoom 8 → 2) in `data/web/regions/subiaco/` e aggiorna `data/web-state/`. Riesegue solo le tile la cui impronta è cambiata.
2. `publish` carica la cache su R2 e poi la svuota. Le URL delle tile portano l'hash (`?v=`) e si possono tenere in cache un anno. `world.json` si riscrive sul posto e ha una cache corta.
3. `deploy` pubblica il sito (nel riferimento: Vercel, `web/dist`). Le tile non fanno parte del deploy.

`data/derived/` (render e pitture) e `data/web-state/` non si cancellano: sono ore di lavoro. `data/web/` è sacrificabile, è solo la coda di upload.

Non creare ancora `vercel.json` né `wrangler.jsonc`: senza sito e senza bucket sarebbero config finte. Il Worker Cloudflare, in Mondo Isometrico, è un backup e non il percorso di rilascio. L'account id scritto in `HOSTING.md` di quel repository non va copiato.

## Cosa resta volutamente fuori

- Pittura, viewer, publish, deploy. Fetch, ground, scene, render ed export delle tile non dipinte sono fatti per il centro storico.
- Immagini di stile e prompt di pittura.
- Workspace npm `pipeline/` + `web/`: ha senso quando quei pacchetti hanno dipendenze (Three.js, sharp, Astro). Oggi c'è un solo `package.json`.
- `geoidM`, `groundH`, `heightBase` e l'heading (315°) sono fissati.
