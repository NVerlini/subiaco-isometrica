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
Il resto della scena, le regole di Subiaco (landmark, torri, impianti, pista di fondo, fallback delle altezze), il viewer in `web/` e questo repository restano MIT, Copyright (c) 2026 NVerlini. Il viewer non copia OpenSeadragon né la pagina Astro del riferimento.
Il dettaglio di cosa si prende e in quale fase è in `docs/riferimenti-pipeline.md`.

## Viewer
Il piè di pagina di `web/public/index.html` cita, con link, le stesse fonti di questa pagina:

- © contributori OpenStreetMap (ODbL)
- © Regione Lazio, DBGT (CC BY 4.0)
- Copernicus Sentinel-2 e ortofoto AGEA 2023, via Geoportale Regione Lazio (CC BY 4.0)
- Copernicus DEM
- © ESA WorldCover (CC BY 4.0), con la citazione Sentinel nel titolo del link
- Meteo: Open-Meteo (CC BY 4.0)
- Mondo Isometrico e isometricworld (MIT)
- @dom_gag_96

La stessa lista, in forma breve, è `pipeline/src/crediti.mjs` e finisce in `world.json`.

## Dati
- **OpenStreetMap**: © contributori OpenStreetMap, dati disponibili con licenza [ODbL](https://opendatacommons.org/licenses/odbl/). https://www.openstreetmap.org/copyright
  Usato per edifici, strade, Aniene, uso del suolo, alberi puntuali, POI, piste e impianti, via Overpass.
- **Regione Lazio, DBGT / Carta Tecnica**: © Regione Lazio, licenza Creative Commons BY 4.0 (i livelli pubblici del Geoportale vanno citati). https://geoportale.regione.lazio.it/
  Altezze dal foglio DBGT 2014 `DBT_Lazio_RM376`, classe unità volumetriche, campo `UN_VOL_AV`.
  Integrazione dal DBGT 2020 del comune (`2020_DBGT_5K_SHP/Subiaco.zip`), stessa classe `UN_VOL`: il campo data è 20140101, quindi non è un rilievo più recente del foglio.
  Integrazione parziale dal WFS `geonode:web_020104_ele_cp_a` (elemento di copertura, quote 3D).
  I volumi UN_VOL con pianta libera entrano in scena. Se il baricentro cade in un edificio già tenuto, o la sovrapposizione supera il 20% della loro area, restano su quell'edificio e possono alzarne l'altezza. Sotto i 12 m² si scartano. Il rilievo 2020 copre solo i buchi del 2014.
  La CTRN raster 1:5 000 non contiene le altezze degli edifici.
- **Copernicus Sentinel-2** e **ortofoto AGEA 2023**: distribuite dal Geoportale della Regione Lazio, licenza CC BY 4.0. https://geoportale.regione.lazio.it/
  Servono alla pittura. Non sono ancora scaricate dalla pipeline.
- **ESA WorldCover**: © ESA WorldCover project 2021, licenza CC BY 4.0. Prodotto 10 m 2021 v200, doi:10.5281/zenodo.7254221.
  Citazione richiesta: «© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium».
- **Copernicus DEM**: Copernicus DEM GLO-30 Public, © DLR e/o Airbus, fornito nell'ambito del programma Copernicus dell'Unione Europea.
  Tile `Copernicus_DSM_COG_10_N41_00_E013_00_DEM`, quote ortometriche EGM2008.
  https://spacedata.copernicus.eu/collections/copernicus-digital-elevation-model
- **Open-Meteo**: previsioni, alba e tramonto nel viewer, senza chiave. Licenza [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). https://open-meteo.com/

Le immagini dipinte con un provider a chiave, quando si userà, saranno derivate da render dei dati sopra indicati.
Le anteprime PNG, il GLB e le tile della FASE 2 sono geometria, non pittura. Le tile non sono nel repository.
Le JPEG in `docs/fase3-anteprima.jpg` e `docs/fase3-maschere.jpg` sono lo shading procedurale del provider mock, non un'immagine di un modello e non un ritaglio di Mondo Isometrico.
La pittura (`pipeline/src/finestre.mjs`, `pipeline/src/paint.mjs`, `pipeline/src/vegetazione.mjs`, `pipeline/src/ponte.mjs`) non copia `paint.ts` dei riferimenti: ne segue i numeri di finestra, sovrapposizione e sfumatura.
