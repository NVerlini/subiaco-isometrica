# Subiaco Isometrica – Roadmap

Mappa isometrica interattiva di Subiaco (RM), Lazio, costruita da dati aperti e dipinta con AI.
Ispirata a [Mondo Isometrico / Roma Isometrica](https://github.com/dg996/mondoisometrico) di Domenico (@dom_gag_96), basato su [krasun/isometricworld](https://github.com/krasun/isometricworld) (MIT).

Fonti dati: OpenStreetMap, Carta Tecnica Regione Lazio, ESA WorldCover, Copernicus DEM.

## Stato attuale
- [x] Roadmap definita
- [x] Analisi copertura OSM e bounding box (docs/fase0-dati-osm.md)
- [x] Profilo GitHub personale creato
- [x] Via all'implementazione (FASE 0 pronta; FASE 1 geometria disponibile, render ancora da fare)

## FASE 0 – Setup e preparazione
- [x] Creare repo personale (`isometric-subiaco` o `mondoisometrico-subiaco`), fork o base su dg996/mondoisometrico o krasun/isometricworld
- [x] Ambiente locale: Node 24+, Chromium, dipendenze npm, `.env`
- [x] Verificare copertura OSM (edifici, strade, landuse) via Overpass Turbo
- [x] Definire bounding box del centro storico
- [x] README e ROADMAP.md nel repo

Esito: repo `NVerlini/subiaco-isometrica`, indipendente, senza fork. Stessi stadi della pipeline e `playwright-core` per Chromium di sistema, senza copia di sorgente. Le bounding box e i landmark stanno in `config/areas.json`. Camera (pitch 45°, 0,25 m/px, tile 1024), piramide web (tile 512, zoom 8→2), pittura a finestre e percorsi di cache stanno in `config/pipeline.json`. Il confronto fase per fase con i riferimenti è in `docs/riferimenti-pipeline.md`. La copertura OSM si riverifica con `npm run check:osm` (Overpass `out count`, senza scaricare geometrie). L'ambiente è descritto in `.env.example`; il file `.env` resta locale e non va versionato.

## FASE 1 – Geometria e dati
- [x] Fetch OSM: buildings, roads, water, landuse, monuments
- [x] Integrazione Carta Tecnica Regione Lazio (se utile)
- [x] Alberi e vegetazione da ESA WorldCover o OSM
- [x] Terrain da Copernicus DEM
- [x] Pipeline fetch → ground → scene
- [x] Landmark: Sacro Speco, Santa Scolastica, Rocca Abbaziale, Ponte di San Francesco, centro storico
- [x] Monte Livata (stazione sciistica, ~1.350 m): piste di discesa, pista di sci di fondo a Campo dell'Osso (priorità, tra le più belle d'Europa), seggiovia Monna dell'Orso, rifugi, faggete, strada di collegamento da Subiaco (OSM `piste:*`, `aerialway`), terrain DEM ad alta quota

Esito (17 novembre 2026, dettaglio in `docs/fase1-geometria.md`): `npm run fetch && npm run ground && npm run scene` sul centro storico produce OSM in cache, suolo, `scene.json`, anteprima PNG e `scena.glb`. Sul centro, 194 edifici su 290 hanno l'altezza dall'unità volumetrica CTR (foglio DBT RM376, campo `UN_VOL_AV`); gli altri 96 usano il default di tipologia. La Rocca è a 19,6 m misurati, il Ponte San Francesco è la spezzata OSM. Santa Scolastica (31 m) e il Sacro Speco (9,2 m) stanno nella finestra `centro-monasteri`. Il DEM GLO-30, tile N41 E013, misura 365 m nel fondovalle e 1 745 m sulla cresta di Monte Livata: dislivello 1 380 m, quindi il pass altezze passa da 1 cm a 3 cm (`heightBase` 420, `geoidM` 49,78, `groundH` 547,7). A Monte Livata solo la seggiovia Monna dell'Orso è attiva; gli altri aerialway sono da verificare. La pista di fondo di Campo dell'Osso non è in OSM e non ha una geometria inventata. Il render a tile resta in FASE 2.

## FASE 2 – Rendering isometrico
- [ ] Render ortografico 45° a tile
- [ ] Test su area piccola del centro storico
- [ ] Export tile di base (non dipinti)

## FASE 3 – Painting AI
- [ ] Style reference (Roma Isometrica / Tel Aviv)
- [ ] Painting progressivo partendo da finestre di test
- [ ] Gestione seam e consistenza
- [ ] Priorità: centro storico, monasteri, Aniene; poi Monte Livata (variante invernale con neve)

## FASE 4 – Interattività e feature live
- [ ] Viewer web (zoom, pan, share view)
- [ ] Meteo real-time (Open-Meteo)
- [ ] Illuminazione giorno/notte
- [ ] (Opzionale) traffico semplificato o animazioni leggere
- [ ] Bottone segnalazione bug/idee verso GitHub issues

## FASE 5 – Pubblicazione e manutenzione
- [ ] Hosting Vercel + Cloudflare R2
- [ ] Deploy iniziale del centro storico
- [ ] Documentazione: ATTRIBUTION, come estendere, crediti OSM / Regione Lazio / ESA / Copernicus
- [ ] Promozione su X taggando @dom_gag_96
- [ ] Aggiornamenti periodici dei dati OSM

## FASE 6 – Estensioni ad altri comuni (dopo Subiaco)
- [ ] Dolo (VE): Riviera del Brenta, ville venete, terreno pianeggiante; dati cartografici Regione Veneto
- [ ] Rocca di Cambio e/o Rocca di Mezzo con Campo Felice (AQ): altopiano delle Rocche e comprensorio sciistico; dati cartografici Regione Abruzzo
- [ ] Un repository separato per ogni comune (es. `isometric-dolo`, `isometric-campofelice`), riusando la stessa pipeline con config per area, fonti regionali e landmark

## FASE 7 – Comunicazione e promozione
- [ ] Piano di post su X e altri social per ogni comune pubblicato
- [ ] Contenuti sui benefici: turismo e valorizzazione del borgo, dati aperti, uso educativo, strumento per comuni e Pro Loco
- [ ] Clip e screenshot della mappa (zoom, giorno/notte, neve su Monte Livata e Campo Felice)
- [ ] Tag a @dom_gag_96 e possibili collaborazioni con enti locali
- [ ] Ogni post va preparato come bozza e pubblicato solo dopo conferma
