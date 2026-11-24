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

Il riferimento non dipinge con una chiave API nel repository: usa la Codex CLI (`codex exec`) sull'account locale, a finestre da 1024 px con 128 px di sovrapposizione, poi fonde con una sfumatura di 64 px. Ogni finestra riceve il render e il pass altezze. I vicini già dipinti entrano nella striscia di overlap. La geometria non si inventa.

Qui i numeri sono gli stessi (`config/pipeline.json`, `pipeline/src/finestre.mjs`). Il pass altezze si legge a 3 cm, non al centimetro del riferimento. In più c'è la maschera delle classi, compresa la faggeta sopra i 1000 m. Lo stile è il prompt in `config/paint.json`: non sono stati copiati `reference.png` né il foglio alberi, che pesano diversi megabyte. Il provider è configurabile da `.env`. Senza `PAINT_API_KEY` un mock deterministico fa girare finestre, fusione e piramide senza rete. Il dettaglio è in `docs/fase3-painting.md`.

`pipeline/style/` resta vuoto. Una variante invernale per Monte Livata, come nel riferimento per un clima diverso da Tel Aviv, non è in questa fase: c'è solo la classe di faggeta.

## FASE 4 — viewer

Il riferimento usa Astro e OpenSeadragon. Qui la pagina è statica, in `web/`, e il viewer è scritto per questa piramide: stessi numeri (zoom 2–8, tile 512, overlap 0, `maxZoomPixelRatio` 2,5, `zoomPerScroll` 1,35), deep link `#@x,y,zoom`, tile lette da `data/web/` e non da `web/public`. Non è stato copiato il sorgente del viewer di Roma. Il dettaglio è in `docs/fase4-viewer.md`.

Open-Meteo e il filtro giorno/notte ci sono. Il proxy TomTom, i gatti e i treni del riferimento no. Il traffico della roadmap resta facoltativo e non è stato fatto.

## FASE 5 — pubblicazione

Ordine del riferimento, da tenere:

1. `export` costruisce la piramide (zoom 8 → 2) in `data/web/regions/subiaco/`. Le URL delle tile portano l'hash (`?v=`) e si possono tenere in cache un anno. `world.json` si riscrive sul posto e ha una cache corta.
2. `publish:tiles` carica quella cartella su R2 (API S3). Salta i file il cui SHA-256 è già nel manifest locale. Non svuota `data/web/`: la cache resta, il manifest evita il secondo invio. Non copia l'account id né il nome dei bucket scritti in `HOSTING.md` del riferimento.
3. Il sito è Vercel, output `web/dist`, config in `vercel.json`. `npm run deploy` non chiama Vercel: il collegamento del repository lo fa chi ha l'account. Le tile non fanno parte del deploy. Il viewer di produzione legge `TILES_PUBLIC_URL`; `npm run dev` legge `data/`.

`data/derived/` (render e pitture) e `data/web-state/` non si cancellano: sono ore di lavoro. `data/web/` è la coda di upload e resta in locale.

Il Worker Cloudflare, in Mondo Isometrico, è un backup e non il percorso di rilascio. I passi per bucket, variabili e progetto Vercel sono in `docs/fase5-pubblicazione.md`. Gli aggiornamenti OSM sono un workflow manuale, senza pubblicazione automatica.

## Cosa resta volutamente fuori

- Il deploy vero su Vercel e il primo upload sul bucket: servono gli account di chi pubblica. I comandi e `vercel.json` ci sono; `npm run deploy` non contatta il servizio. Fetch, ground, scene, render, pittura ed export sono fatti per il centro storico. La pittura, senza chiave, non chiama un'API.
- I PNG di stile dei riferimenti. Il prompt sta in `config/paint.json`.
- Workspace npm `pipeline/` + `web/`: ha senso quando quei pacchetti hanno dipendenze (Astro). Oggi c'è un solo `package.json`. Three.js e sharp sono già dipendenze del render.
- `geoidM`, `groundH`, `heightBase` e l'heading (315°) sono fissati.
