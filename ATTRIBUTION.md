# Attribuzioni e crediti

## Progetti di riferimento
- [Mondo Isometrico](https://github.com/dg996/mondoisometrico) di Domenico (@dom_gag_96), licenza MIT
- [isometricworld](https://github.com/krasun/isometricworld) di krasun, licenza MIT

## Codice
In FASE 0 non è stato copiato sorgente né da Mondo Isometrico né da isometricworld, e non è stato fatto un fork.
È stata adottata la forma della pipeline (fetch → ground → scene → render → paint → export → viewer → publish → deploy),
la dipendenza `playwright-core` per il Chromium di sistema, e i parametri numerici dello stile
(camera a 45°, tile, zoom, finestre di pittura), trascritti in `config/pipeline.json`.
Il dettaglio di cosa si prende e in quale fase è in `docs/riferimenti-pipeline.md`.

Se in FASE 1 si adatta un file di quei repository, va conservata la nota di copyright MIT:
Copyright (c) 2026 Dmytro Krasun; per il fork Mondo Isometrico anche Copyright (c) 2026 Domenico Gagliardi.
La licenza di questo repository resta MIT (Copyright (c) 2026 NVerlini) e copre il codice originale.

## Dati
- **OpenStreetMap**: © contributori OpenStreetMap, dati disponibili con licenza [ODbL](https://opendatacommons.org/licenses/odbl/). https://www.openstreetmap.org/copyright
- **Carta Tecnica Regionale**: © Regione Lazio, secondo i termini di licenza pubblicati dalla Regione (da verificare prima dell'uso)
- **ESA WorldCover**: © ESA WorldCover project, licenza CC BY 4.0
- **Copernicus DEM**: prodotto con dati Copernicus DEM, © DLR e/o Airbus, fornito nell'ambito del programma Copernicus dell'Unione Europea

Le immagini dipinte con AI sono derivate da render dei dati sopra indicati.
