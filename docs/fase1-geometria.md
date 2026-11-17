# FASE 1 — Geometria e dati

Pipeline `fetch → ground → scene` per le tre finestre di `config/areas.json`. Il primo test è `centro-storico`. Le stesse funzioni, senza cambiare camera, coprono `centro-monasteri` e `monte-livata`.

Eseguito il 17 novembre 2026 con Node 24. I file scaricati stanno in `data/` e non sono versionati.

## Comandi

```bash
nvm use
npm install
npm test
npm run fetch && npm run ground && npm run scene
```

Senza argomenti i tre comandi lavorano su `centro-storico`. Per le altre finestre:

```bash
npm run fetch -- centro-monasteri
npm run fetch -- monte-livata
npm run fetch -- --all
npm run ground -- --all
npm run scene -- --all
```

`--force` riscarica OSM, il WFS delle coperture e le unità volumetriche. Il DEM e WorldCover si riscaricano solo se il file non c'è: sono prodotti statici.

`OVERPASS_URL` accetta solo `https`. Su HTTP 429 il client attende l'header `Retry-After` (al massimo 180 secondi) e poi riprova.

## Cosa viene scritto

Tutto sotto `data/`, elencato in `.gitignore`.

| Percorso | Contenuto |
|---|---|
| `data/raw/<area>/osm.json` | Risposta Overpass (`out geom`): edifici, strade, acqua, suolo, alberi, POI, piste, impianti, più i landmark richiesti per id |
| `data/raw/<area>/roads.json` | Solo le way `highway` |
| `data/raw/<area>/ground.json` | Landuse, natural, leisure, acqua |
| `data/raw/<area>/ctrn.json` | Coperture 3D del WFS regionale |
| `data/raw/<area>/unvol.json` | Unità volumetriche del foglio RM376, ritagliate sulla bbox: altezza in metri |
| `data/raw/dem/` | Copernicus GLO-30, tile `N41 E013`, e `misure.json` |
| `data/raw/worldcover/` | ESA WorldCover 10 m 2021 v200, tile `N39E012` |
| `data/raw/ctrn/` | Zip del foglio DBT RM376 e gli shapefile `UN_VOL` estratti |
| `data/derived/<area>/ground/` | `height.bin` (suolo ortometrico), `dsm.bin`, `landcover.bin`, `meta.json`, `features.json`, `anteprima.png` |
| `data/derived/<area>/scene/` | `scene.json`, `report.json`, `anteprima.png`, `anteprima-isometrica.png`, `scena.glb` |

`height.bin` è il DSM aperto (raggio 40 m) con l'acqua incisa: toglie i tetti dal modello di superficie e lascia il fondovalle. Non è un DTM rilevato.

## Esito sul centro storico

Snapshot OSM `2026-11-17T21:15:25Z`. 624 elementi, 213 strade, 290 edifici estrusi.

| Fonte altezza | Edifici |
|---|---:|
| CTR, unità volumetrica `UN_VOL_AV` | 194 |
| CTR, gronda del WFS meno il suolo | 0 |
| `building:levels` | 0 |
| Default di tipologia (`config/altezze.json`) | 96 |

Landmark:

| Oggetto | Stato nel centro | Altezza |
|---|---|---|
| Rocca Abbaziale, way/153585997 | disegnata | 19,6 m, volume CTR più alto nell'impronta |
| Ponte San Francesco, way/232122864 | disegnato, spezzata OSM | spessore convenzionale 1,2 m, non è una misura |
| Santa Scolastica, relation/5733172 | fuori bbox | nella finestra `centro-monasteri`: 31 m, CTR |
| Sacro Speco, way/236976582 | fuori bbox | nella finestra `centro-monasteri`: 9,2 m, CTR |

WorldCover sulla finestra: soprattutto classe 10 (alberi, 17 082 pixel) e 50 (costruito, 7 834). Alberi in scena: 13 node OSM e 9 906 posizioni WorldCover, fuori da edifici e carreggiate. L'altezza della chioma senza tag `height` è convenzionale (12 m il bosco, 8 m l'albero OSM, 3 m l'arbusto).

## Carta Tecnica e DBGT della Regione Lazio

La CTRN pubblicata come raster (geoportale, scala 1:5 000) non ha le quote degli edifici: è una vestizione. Le altezze stanno nel Database Geotopografico.

Due accessi, entrambi CC BY 4.0, con l'obbligo di citare la Regione Lazio:

1. **WFS**, usato in automatico. Servizio `https://geoportale.regione.lazio.it/geoserver/ows`, layer `geonode:web_020104_ele_cp_a`, classe «Elemento di copertura» (020104), DBGT v. 2014. Geometrie 3D in EPSG:25833, quota assoluta sui vertici. Nel centro storico ne arrivano 63. Le quote stanno quasi sul terreno: non danno l'altezza del borgo (zero edifici del centro ne ricavano una gronda fra 2,4 e 65 m). A Monte Livata tre edifici usano questa gronda, perché lì il volume non c'era.

2. **Download del foglio**, usato in automatico ed è la fonte che regge le altezze. File browser del Geoportale: `POST https://geoportale.regione.lazio.it/cartografia/api/login` con corpo `{}` (token anonimo, non è un segreto), poi `GET .../api/raw/2014_DBGT_5K_SHP/strati-informativi/Roma/DBT_Lazio_RM376.zip` (circa 97 MB). Dentro, `UN_VOL.shp` / `UN_VOL.dbf`: 30 953 volumi sull'intero foglio. Il campo `UN_VOL_AV` è l'altezza del volume in metri; `UN_VOL_QE` è la quota assoluta di estrusione. Il foglio copre tutte e tre le finestre (1 690 volumi nel centro, 2 286 con i monasteri, 386 a Monte Livata). Si tiene il volume più alto il cui centroide cade nell'impronta OSM.

Lo zip del comune aggiornato al 2020, `2020_DBGT_5K_SHP/Subiaco.zip` (circa 132 MB), è lo stesso canale e non è stato scaricato: il foglio 2014 basta per le tre bbox. Va citato se in seguito si vogliono le classi più recenti.

Se il WFS o lo zip non rispondono, il fetch scrive `stato: non-disponibile` e la scena prosegue. Ordine dell'altezza: unità volumetrica, poi gronda WFS, poi `building:levels` × 3,2 m, poi il default di tipologia o di landmark in `config/altezze.json`. I default sono etichettati `default-tipologia` e non vanno scambiati per misure. Un edificio del centro ha `building:levels` in OSM, ma la CTR lo copre già.

## Copernicus DEM GLO-30

Tile pubblico, senza credenziali:

`https://copernicus-dem-30m.s3.eu-central-1.amazonaws.com/Copernicus_DSM_COG_10_N41_00_E013_00_DEM/Copernicus_DSM_COG_10_N41_00_E013_00_DEM.tif`

Quote ortometriche EGM2008, DSM (include tetti e chiome). Campionamento bilineare. Misure del 17 novembre 2026, ripetute dal comando `fetch` in `data/raw/dem/misure.json` e copiate in `config/pipeline.json`:

| Punto | Quota ortometrica |
|---|---:|
| Fondovalle, minimo del centro | 365,5 m |
| Ponte San Francesco | 372,8 m |
| Rocca Abbaziale (DSM sullo sperone) | 497,9 m |
| Santa Scolastica | 526,2 m |
| Sacro Speco | 633,6 m |
| Massimo del centro | 538,8 m |
| Massimo centro + monasteri | 916,2 m |
| Livata, abitato | 1 339,1 m |
| Campo dell'Osso (OSM `ele=1550`) | 1 543,2 m |
| Minimo Monte Livata | 1 276,9 m |
| Massimo Monte Livata | 1 745,3 m |

Dislivello sulle tre finestre: **1 379,8 m**.

Geoide EGM2008 (GeographicLib GeoidEval 2.5.2, stesso giorno): 49,780 m alla Rocca, 49,757 m al ponte, 49,832 m al Sacro Speco, 50,052 m a Campo dell'Osso. In config si fissa il valore all'origine, `geoidM = 49.78`. `groundH = 547.7` è la superficie ellissoidica sulla Rocca (497,9 + 49,78), non il fondovalle.

Il pass altezze del riferimento conta i centimetri in 16 bit: circa 655 m sopra `heightBase − 100`. 1 380 m non ci stanno. Non si spezza la regione. `heightBase = 420` (ellissoidico) e `codificaAltezze.passoCm = 3`: la finestra va da 320 m a circa 2 286 m ellissoidici e copre fondovalle, monasteri e la cresta, con margine per un edificio alto.

## WorldCover

Tile `ESA_WorldCover_10m_2021_v200_N39E012_Map.tif` (3°×3°, EPSG:4326), bucket pubblico `esa-worldcover`. Copre le tre aree (latitudine sotto i 42°). Licenza CC BY 4.0. Citazione da tenere:

© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium.

## Monte Livata

Quattordici elementi `aerialway`, come nel conteggio del 15 novembre. Solo way/131304704, Seggiovia Monna dell'Orso (`chair_lift`), ha `stato: attivo`. Gli altri (stazioni, piloni, i tre `platter` inclusa Bandita) sono `da-verificare`. Nessuno è disegnato come impianto in esercizio.

Le piste OSM nella finestra sono le sette discese e il collegamento già elencati in `docs/fase0-dati-osm.md` (`piste:type=downhill` o `connection`, compresa la Pista Nordica, che è una discesa). La pista di sci di fondo di Campo dell'Osso non è in OSM: in scena compare solo come `elementiPrevisti`, con `geometria: null`. Non è stato tracciato nessun anello.

## Attribuzione nel prodotto

`scene.json` riporta le quattro fonti. I crediti estesi sono in `ATTRIBUTION.md`.

## Aperto per la FASE 2

- Il render ortografico a tile (1024 px, pitch 45°, Chromium) non c'è. PNG e GLB sono un'anteprima geometrica, non la piramide.
- Il renderer del riferimento va adattato al passo di 3 cm: con 1 cm la montagna esce dalla finestra.
- L'heading 45° è ancora una proposta. Si congela al primo render.
- Il suolo sotto il borgo è un DSM aperto, non la quota di strada della CTR. Su un isolato largo l'apertura da 40 m può lasciare un dosso.
- 96 edifici del centro, e la maggioranza a Livata, non hanno un volume CTR nell'impronta: restano al default.
- L'altezza CTR usata è il volume più alto dentro l'impronta. La Basilica di Sant'Andrea arriva a 56 m perché dentro c'è un volume alto: in FASE 2 andrà distinto il corpo dal campanile.
- Gli altri impianti di Livata e la pista di fondo aspettano una verifica, non un disegno.
- Il geoide sale di circa 0,27 m fra la Rocca e Campo dell'Osso. Una sola costante all'origine è coerente col riferimento; l'errore resta sotto il passo del DEM.
- WorldCover è del 2021, a 10 m, e non separa la faggeta dalle altre chiome.
