# Attribuzioni e crediti

## Progetti di riferimento
- [Mondo Isometrico](https://github.com/dg996/mondoisometrico) di Domenico (@dom_gag_96), licenza MIT
- [isometricworld](https://github.com/krasun/isometricworld) di krasun, licenza MIT

## Codice
Non è stato fatto un fork. In FASE 0 non era stato copiato sorgente.
In FASE 1 e in FASE 2 alcuni moduli riprendono, adattandoli, pezzi di isometricworld e di Mondo Isometrico.
Quei file portano la nota MIT:

- Copyright (c) 2026 Dmytro Krasun
- Copyright (c) 2026 Domenico Gagliardi (dove il sorgente viene dal fork di Roma)
- Copyright (c) 2026 NVerlini

File con quella nota: `pipeline/src/geo.mjs` (camera ENU e camera di tile), `pipeline/page/renderer.js` (pagina Three.js), `pipeline/src/render.mjs` (Chromium), `pipeline/src/export.mjs` (piramide degli zoom), `pipeline/src/overpass.mjs`, `pipeline/src/dem.mjs`, `pipeline/src/worldcover.mjs` (tavolozza), `pipeline/src/shapefile.mjs` (lettura shp/dbf della CTR), `pipeline/src/fetch.mjs` e `pipeline/src/ground.mjs` (cache e apertura del DSM).
Il resto della scena, le regole di Subiaco (landmark, torri, impianti, pista di fondo, fallback delle altezze) e questo repository restano MIT, Copyright (c) 2026 NVerlini.
Il dettaglio di cosa si prende e in quale fase è in `docs/riferimenti-pipeline.md`.

## Dati
- **OpenStreetMap**: © contributori OpenStreetMap, dati disponibili con licenza [ODbL](https://opendatacommons.org/licenses/odbl/). https://www.openstreetmap.org/copyright
  Usato per edifici, strade, Aniene, uso del suolo, alberi puntuali, POI, piste e impianti, via Overpass.
- **Regione Lazio, DBGT / Carta Tecnica**: © Regione Lazio, licenza Creative Commons BY 4.0 (i livelli pubblici del Geoportale vanno citati). https://geoportale.regione.lazio.it/
  Altezze dal foglio DBGT 2014 `DBT_Lazio_RM376`, classe unità volumetriche, campo `UN_VOL_AV`.
  Integrazione dal DBGT 2020 del comune (`2020_DBGT_5K_SHP/Subiaco.zip`), stessa classe `UN_VOL`: il campo data è 20140101, quindi non è un rilievo più recente del foglio.
  Integrazione parziale dal WFS `geonode:web_020104_ele_cp_a` (elemento di copertura, quote 3D).
  La CTRN raster 1:5 000 non contiene le altezze degli edifici.
- **ESA WorldCover**: © ESA WorldCover project 2021, licenza CC BY 4.0. Prodotto 10 m 2021 v200, doi:10.5281/zenodo.7254221.
  Citazione richiesta: «© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium».
- **Copernicus DEM**: Copernicus DEM GLO-30 Public, © DLR e/o Airbus, fornito nell'ambito del programma Copernicus dell'Unione Europea.
  Tile `Copernicus_DSM_COG_10_N41_00_E013_00_DEM`, quote ortometriche EGM2008.
  https://spacedata.copernicus.eu/collections/copernicus-digital-elevation-model

Le immagini dipinte con AI, quando ci saranno, saranno derivate da render dei dati sopra indicati.
Le anteprime PNG, il GLB e le tile della FASE 2 sono geometria, non pittura. Le tile non sono nel repository.
