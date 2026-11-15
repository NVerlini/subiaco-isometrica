# FASE 0 — Verifica dati OpenStreetMap e bounding box

Analisi leggera (solo lettura) per **Subiaco Isometrica**. Nessuna modifica a GitHub o al codice.

- Fonti: [Nominatim](https://nominatim.openstreetmap.org/) e [Overpass API](https://overpass-api.de/api/interpreter) (`out count` per i totali).
- Snapshot OSM usato per i conteggi: **15 novembre 2026, 18:17 (Europe/Rome)** (`timestamp_osm_base` 2026-11-15T17:17:13Z).
- Landmark e impianti: stesso endpoint, snapshot 18:13–18:14 (Europe/Rome).
- Formato bbox: `south,west,north,east` (WGS84). I valori non sono inventati: derivano dalle coordinate Nominatim/Overpass dei landmark, dalle densità di edifici e (per Livata) dall’unione delle geometrie `piste:type` e `aerialway`.
- Nota operativa: la prima chiamata a overpass-api.de ha restituito 502 (coda piena); le query successive, dopo breve attesa, sono andate a buon fine. Nessun numero è stato stimato al posto di una query fallita.

## 1. Bounding box proposti

### a) Centro storico di Subiaco

`41.9220, 13.0845, 41.9300, 13.1050`

Circa 0,9 km (N–S) × 1,7 km (E–O), ~1,5 km².

Include la **Rocca Abbaziale** (41,92609 N, 13,09482 E) e il **Ponte San Francesco** (41,92427 N, 13,08917 E, ~510 m a ovest della Rocca), più l’Aniene e l’abitato immediatamente oltre il ponte. I bordi seguono la densità degli edifici misurata a maglia:

- il nucleo più denso è tra 41,925–41,928 N e 13,092–13,104 E (77–78 edifici per cella est–ovest, 131 nella fascia della Rocca);
- a nord di 41,928 la densità crolla (8 edifici tra 41,928 e 41,931, a parità di longitudine);
- a sud di 41,922 restano pochi edifici (12 tra 41,918 e 41,922);
- a ovest di 13,088 ci sono ancora 46 edifici oltre il fiume: vanno inclusi, perché il ponte è l’ingresso storico;
- a est la fascia 13,100–13,104 è ancora densa (75 edifici); oltre, verso Santa Scolastica (13,110), la densità cala.

**Non include** Santa Scolastica né il Sacro Speco: sono troppo fuori dal nucleo compatto (vedi sotto).

### a-bis) Centro + monasteri

`41.9145, 13.0845, 41.9300, 13.1210`

Circa 1,7 km × 3,0 km, ~5,2 km².

Stesso bordo ovest/nord del centro, esteso a sud e a est per coprire il corridoio dell’Aniene e i due monasteri:

| Landmark | Posizione OSM | Distanza in linea d’aria dalla Rocca |
|---|---|---|
| Monastero di Santa Scolastica | 41,91846 N, 13,11059 E | 1,56 km a sud-est |
| Monastero di San Benedetto (Sacro Speco) | 41,91684 N, 13,11814 E | 2,19 km a sud-est |

I due monasteri distano 0,65 km tra loro, lungo la SP 45a. Un unico bbox «centro» che li inglobasse allargherebbe di molto la scena e riempirebbe di bosco e strada il primo test di rendering: meglio due finestre, come sopra. Per un MVP del solo borgo si parte dal bbox centro; per i landmark religiosi si usa centro+monasteri (o due riquadri dedicati in un secondo momento).

### b) Monte Livata

`41.9360, 13.1435, 41.9545, 13.1940`

Circa 2,1 km × 4,2 km, ~8,6 km².

Copre tre poli che in OSM non coincidono:

1. l’abitato **Livata** (node [518570019](https://www.openstreetmap.org/node/518570019), 41,93978 N, 13,14658 E), ~4,5 km in linea d’aria a est-nord-est della Rocca (la strada è più lunga);
2. gli **impianti a nastro** (platter) subito a est dell’abitato (da ~13,150 a ~13,161);
3. le **piste da discesa** e la **Seggiovia Monna dell’Orso**, più a est, intorno a **Campo dell’Osso** (node [1330030281](https://www.openstreetmap.org/node/1330030281), 41,94813 N, 13,16653 E, `ele=1550` in OSM).

Unione delle geometrie `piste:type` + `aerialway`: `41.9384945, 13.1504311, 41.9520738, 13.1910441`. Il bbox di progetto aggiunge un margine e sposta il bordo ovest fino a includere l’abitato (13,14658), che altrimenti resterebbe fuori. Non si è usato il bbox generico di Nominatim per il casale (±0,02°), troppo largo e poco significativo.

In OSM **non risulta un oggetto chiamato «Monte Livata»** (Nominatim su quel nome è vuoto; Overpass nella zona trova Livata e Campo dell’Osso). La stazione va quindi trattata come area Livata + Campo dell’Osso, non come un singolo picco toponimo.

Il bbox amministrativo dell’intero comune (relation [41625](https://www.openstreetmap.org/relation/41625), Nominatim: `41.8894368, 13.0522396, 41.9685543, 13.2030793`) è molto più grande (~63 km²) e non va usato come finestra di lavoro: contiene entrambi i riquadri più un’ampia area montana vuota.

## 2. Conteggi OpenStreetMap

Totali `nwr` (node + way + relation) per categoria, dal snapshot del **15 novembre 2026, 18:17 (Europe/Rome)**. Per edifici con altezza si riportano anche i due tag separati e l’unione (un edificio con entrambi i tag sarebbe contato una sola volta nell’unione).

| Categoria | Centro storico | Centro + monasteri | Monte Livata |
|---|---:|---:|---:|
| `building` | 292 (289 way, 3 rel.) | 391 (386 way, 5 rel.) | 311 (311 way) |
| `building` + `height` | 0 | 0 | 0 |
| `building` + `building:levels` | 1 | 1 | 0 |
| `building` con `height` **o** `building:levels` | **1** | **1** | **0** |
| `highway` | 231 (18 node, 213 way) | 356 (22 node, 334 way) | 126 (126 way) |
| `waterway` o `natural=water` | 6 (5 way, 1 rel.) | 11 (1 node, 9 way, 1 rel.) | 19 (19 way) |
| `landuse` | 18 (16 way, 2 rel.) | 22 (19 way, 3 rel.) | 14 (2 way, 12 rel.) |
| `natural=wood` o `natural=tree` | 15 (13 node, 1 way, 1 rel.) | 24 (13 node, 8 way, 3 rel.) | 33 (2 node, 23 way, 8 rel.) |
| `amenity` / `tourism` / `historic` | 75 (56 node, 19 way) | 112 (78 node, 32 way, 2 rel.) | 26 (22 node, 1 way, 3 rel.) |
| `piste:type` | 0 | 0 | **8** (8 way) |
| `aerialway` | 0 | 0 | **14** (10 node, 4 way) |

Dettaglio impianti e piste a Livata (tutti cadono nel bbox proposto):

- `piste:type`: 7 way `downhill` + 1 way `connection`. Piste nominate: Pista Nordica (2 way: [131304583](https://www.openstreetmap.org/way/131304583), [131304584](https://www.openstreetmap.org/way/131304584)), [Pista Trasversale](https://www.openstreetmap.org/way/131304585), [Pista del Sole](https://www.openstreetmap.org/way/131304586), [Pista del Topolino](https://www.openstreetmap.org/way/131304587), [Pista dell'Orso](https://www.openstreetmap.org/way/131304588), [Pista delle Signore](https://www.openstreetmap.org/way/131304589). Sono tutte nel settore est (circa 13,181–13,191 E), non attorno all’abitato.
- `aerialway`: 1 seggiovia ([Seggiovia Monna dell'Orso](https://www.openstreetmap.org/way/131304704), `chair_lift`), 3 way `platter` (una è [Bandita](https://www.openstreetmap.org/way/681313709), presso l’abitato; le altre due senza nome: [681313710](https://www.openstreetmap.org/way/681313710), [903843778](https://www.openstreetmap.org/way/903843778)), più 3 `station` e 7 `pylon`.

## 3. Landmark

| Landmark cercato | Esito OSM | Oggetto | Link |
|---|---|---|---|
| Rocca Abbaziale (Rocca dei Borgia) | **Trovata** come «Rocca Abbaziale», `historic=castle`. Il nome «Rocca dei Borgia» **non** compare nei tag (`alt_name` assente). Wikidata [Q17025596](https://www.wikidata.org/wiki/Q17025596). | way/153585997 | https://www.openstreetmap.org/way/153585997 |
| Ponte di San Francesco | **Trovato** come «Ponte San Francesco» (senza «di»), `highway=footway`, `bridge=yes`. Wikidata [Q1481888](https://www.wikidata.org/wiki/Q1481888). Nominatim non lo trova se si cerca «Ponte *di* San Francesco». | way/232122864 | https://www.openstreetmap.org/way/232122864 |
| Santa Scolastica | **Trovato** il monastero (`amenity=monastery`, relation multipolygon). Wikidata [Q2942816](https://www.wikidata.org/wiki/Q2942816). Oggetti collegati: [Chiesa di Santa Scolastica](https://www.openstreetmap.org/way/385302738) (way/385302738), [Piazzale Santa Scolastica](https://www.openstreetmap.org/way/1048469022) (way/1048469022). | relation/5733172 | https://www.openstreetmap.org/relation/5733172 |
| Sacro Speco / Monastero di San Benedetto | **Trovato** come «Monastero di San Benedetto Sacro Speco», `amenity=monastery`. Wikidata [Q19622375](https://www.wikidata.org/wiki/Q19622375). | way/236976582 | https://www.openstreetmap.org/way/236976582 |
| Livata (abitato) | **Trovato** (`place=hamlet`). | node/518570019 | https://www.openstreetmap.org/node/518570019 |
| Campo dell'Osso | **Trovato** (`place=neighbourhood`, `ele=1550`). | node/1330030281 | https://www.openstreetmap.org/node/1330030281 |
| Piste e impianti di Livata | **Trovati** (8 piste, 4 impianti). Vedi §2. Non c’è un oggetto OSM intitolato «Monte Livata». | — | — |

Nessun landmark richiesto risulta mancante; cambiano solo i nomi rispetto all’uso comune (Ponte *San* Francesco, Rocca *Abbaziale* senza alt_name).

## 4. Valutazione della copertura

**Centro storico: geometria buona, altezze scarsissime.** Edifici (292) e strade (231) bastano per una scena isometrica del borgo; fiume e POI (75 tra amenity/tourism/historic, Rocca e ponte presenti) sono sufficienti. Di 292 edifici, **uno solo** ha `building:levels` e **nessuno** ha `height` (~0,3 %). Per l’estrusione 3D la CTR Lazio (e un’altezza di default per il tessuto storico) non è opzionale. Alberi puntuali scarsi (13 node): per la vegetazione serviranno ESA WorldCover e/o CTR. Il DSM/DEM Copernicus serve soprattutto per il dislivello verso l’Aniene.

**Centro + monasteri: geometria buona, vegetazione sufficiente, altezze ancora scarse.** I due monasteri ci sono, il corridoio dell’Aniene è meglio rappresentato (11 oggetti idrici, più poligoni `wood`). Le altezze restano a 1 su 391 edifici: stessa dipendenza da CTR/DEM. È la finestra giusta quando si vogliono i landmark religiosi, non per il primo test su area piccola.

**Monte Livata: sufficiente, con buchi sugli sci e zero altezze.** 311 edifici e 126 strade ci sono, i boschi sono meglio mappati che in paese (23 way + 8 relation `wood`). Impianti presenti e usabili. Le 8 piste però stanno **solo** nel settore est (Campo dell’Osso / Monna dell’Orso); attorno all’abitato ci sono i nastro ma **nessuna pista**. POI turistici pochi (26). Nessun edificio ha `height` o `building:levels`. Il DEM Copernicus qui è essenziale (rilievo e dislivello rispetto a Subiaco); per le piste andrà valutata un’integrazione (sopralluogo, altre fonti, o accettare un settore est più completo di quello ovest).

**Sintesi:** OSM è già una base valida per partire con la geometria su tutte e tre le finestre. Il limite serio è l’altezza degli edifici (praticamente assente) e, a Livata, la mappatura parziale delle piste. CTR Regione Lazio + Copernicus DEM (e WorldCover per i boschi) vanno previsti in FASE 1, non come optional.


## Nota dell'utente sugli impianti (15/11/2026)
Secondo l'utente a Monte Livata oggi c'è un solo impianto attivo: la seggiovia della Monna dell'Orso. Gli altri 13 elementi `aerialway` in OSM vanno verificati: probabilmente piloni, stazioni o skilift dismessi ancora mappati. Da correggere su OSM e da escludere o rappresentare come dismessi nella mappa.
- Verificare in OSM i tracciati di sci di fondo a Campo dell'Osso (dentro il bbox Livata, settore est) (`piste:type=nordic`): nel conteggio del 15/11 non risultano, probabilmente vanno mappati.
