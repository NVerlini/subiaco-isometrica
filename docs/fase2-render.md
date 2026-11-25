# FASE 2 — Render isometrico

Render ortografico a tile del centro storico, pitch 45°, heading congelato a **315°**. Eseguito il 17 novembre 2026 con Node 24 e Google Chrome di sistema (`playwright-core`, SwiftShader). I PNG, le altezze e la piramide AVIF stanno in `data/` e non si versionano.

## Comandi

```bash
nvm use
npm install
npm test
npm run fetch && npm run ground && npm run scene
npm run render -- centro-storico --finestra rocca-ponte
npm run render
npm run export
```

`CHROME_PATH` è facoltativo: se manca, il render cerca `google-chrome` e `chromium`. `playwright-core` non scarica un browser.

| Comando | Cosa fa |
|---|---|
| `npm run render` | Tutte le tile del bbox di lavoro del centro abitato (circa 76), 1024×1024 a 0,25 m/px, in `data/derived/centro-storico/render/`, pass altezze in `height/`, mosaico `render/mosaico.jpg` |
| `npm run render -- centro-storico --finestra rocca-ponte` | Solo la finestra di prova intorno alla Rocca Abbaziale e al Ponte San Francesco |
| `npm run render -- centro-storico --only -1,-2` | Una tile (o più, separate da `;`) |
| `npm run render -- --force` | Ridisegna anche le tile già presenti |
| `npm run render -- --anteprima --heading 0,45,315` | Quadri di confronto, senza toccare le tile. Dopo il congelamento non riallinea la piramide |
| `npm run export` | Piramide web AVIF, zoom 8→2, tile da 512 px, in `data/web/regions/subiaco/` |

Una tile già scritta non si rifà. Cambiare l'heading dopo il congelamento sposta ogni tile: il render lo rifiuta.

## Pubblicazione del centro abitato

Il bbox di lavoro è `41.918, 13.080, 41.932, 13.115` (`config/areas.json`, circa 76 tile). Per rigenerare geometria e piramide su tutto quel riquadro, non solo sulla finestra di prova:

```bash
npm run fetch -- centro-storico
npm run ground -- centro-storico
npm run scene -- centro-storico
npm run render -- centro-storico
npm run export -- centro-storico
```

`npm run render` senza `--finestra` usa l'intero bbox. `--finestra rocca-ponte` resta il test sulla Rocca e sul Ponte. `scene` aggiunge gli edifici DBGT che non cadono in una pianta già tenuta. Un volume si assegna a un solo edificio. Il corpo intero si alza solo se il volume ne copre almeno l'80%. Una parte si aggiunge solo se supera il corpo di oltre 1,5 m. Sotto i 12 m² il volume si scarta. Il 2020 non duplica una parte 2014 già presente. I dati DBGT restano in `data/` e non si versionano.

## Heading 315°

La camera guarda a nord-ovest (azimut 315). Il pitch resta 45° sotto l'orizzonte, come nel riferimento: facciate e tetti insieme. L'origine ENU è la Rocca (41,92609 N, 13,09482 E).

Confronto fatto sulle anteprime dell'intero centro, prima di scrivere la piramide. Il foglio piccolo è [fase2-heading.jpg](fase2-heading.jpg).

| Heading | Cosa si vede |
|---|---|
| 0° | Quasi una pianta. L'Aniene sta in basso, in primo piano, non a sinistra. Lo sperone della Rocca non si stacca dal borgo. |
| 45° | Diagonale come a Roma. Il fiume finisce sul bordo destro e la Rocca si mescola al tessuto a est. |
| 285° | L'Aniene è un bordo sinistro netto, ma il borgo si schiaccia contro l'acqua e il bosco occupa metà quadro. |
| 300° | Fiume a sinistra e curva in basso. Buona, un po' più chiusa di 315°. |
| **315°** | Stessa diagonale a 45°, specchiata. L'Aniene entra da sinistra e piega in primo piano (il tratto del Ponte San Francesco). La Rocca resta lo sperone al centro. Il borgo sale verso destra, lungo il fiume e sulla sella. |

315° è quello che tiene insieme le tre cose chieste: borgo, Rocca e Aniene, con il fiume a sinistra come previsto in `config/pipeline.json`. È scritto `headingStato: congelato`.

## Esito sul centro storico

33 tile da 1024 px, nessuna vuota. Il mosaico è [fase2-mosaico.jpg](fase2-mosaico.jpg); l'originale, più largo, è `data/derived/centro-storico/render/mosaico.jpg`.

| Passaggio | Tile | Tempo |
|---|---:|---:|
| Finestra Rocca e Ponte San Francesco | 14 | 8,9 s di disegno |
| Centro storico, insieme tenuto | 33 | circa 0,5 s a tile; la passata che ha completato il centro ha disegnato le tile mancanti in 12,3 s. La verifica sulle 33 già in cache dura 2,6 s |
| Piramide AVIF, zoom 8 → 2 | 132 allo zoom 8 (33 × 4), poi 33, 11, 5, 4, 4, 4 | circa 90 s |

Chrome: `/usr/bin/google-chrome`, headless, SwiftShader. Supersampling 2, poi riduzione Lanczos a 1024.

Il pass altezze della tile `0_-2` (quella della Rocca) decodifica **452,1–563,1 m ellissoidici**, tutti i 256×256 pixel coperti. La superficie sulla Rocca è 547,7 m (DSM 497,9 + geoide 49,78); i tetti arrivano poco sopra. Il passo è 3 cm, origine `heightBase − 100` (320 m), come in `codificaAltezze`: con 1 cm la montagna uscirebbe dai 16 bit.

`data/web/regions/subiaco/data/world.json` ha camera, `origin` allineata allo zoom 2 e la matrice ENU → pixel d'arte. Le tile web sono `tiles/photo/{z}/{x}/{y}.avif`. Non sono dipinte e non sono pubblicate.

## Geometria ritoccata per il render

Tre correzioni della FASE 1, rieseguite con `ground` e `scene` prima del render.

**Campanile.** Se il volume DBGT più alto è una pianta piccola e sta almeno 10 m sopra un corpo più lontano, diventa una parte `torre` con la sua pianta. La Basilica di Sant'Andrea (way/486865307) non è più un blocco da 56 m: il corpo è **25,4 m**, i due volumi del campanile **42,4 m** e **56,3 m**. La Rocca resta un volume solo, **19,6 m**: la pianta è larga (577 m²) e non è una torre. Altri due edifici senza nome hanno un volume stretto staccato (way/1047734686, way/1180637482).

**I 96 senza volume.** Il centroide si calcola sull'anello intero, non su quello semplificato: la semplificazione aveva spostato di qualche metro il volume da 19,6 m della Rocca e lo faceva uscire dall'impronta. In più si accettano volumi il cui centroide è entro 6 m, se non cadono in un altro edificio, e si legge anche lo zip DBGT 2020 del comune (`Subiaco.zip`, CC BY 4.0). Esito: **222** edifici con unità volumetrica (di cui **26** agganciati al file 2020), **68** ancora al default di tipologia. Erano 194 e 96. Lo zip 2020, classe `UN_VOL`, ha `DATA_AGG` 20140101: è lo stesso rilievo del foglio RM376 ritagliato sul comune, non un aggiornamento delle quote. Il guadagno è l'aggancio, non una misura nuova.

**Quota strada.** L'apertura del DSM (minimo poi massimo, raggio 40 m) rialza la carreggiata verso i dossi rimasti negli isolati larghi. Dopo l'apertura la strada torna all'erosione, spianata lungo la spezzata OSM, e il costruito entro 40 m scende verso quel profilo senza andare sotto l'erosione della cella. Sul centro: 149 carreggiate, 6049 celle abbassate, media **10,5 m**. Non è la quota di progetto della CTR: è il minimo locale del Copernicus, tolti i tetti.

## File adattati dai riferimenti

MIT, nota di copyright nei file:

- `pipeline/src/geo.mjs` — anche `cameraTile`, gli assi e la codifica a 3 cm, da `camera.ts`
- `pipeline/page/renderer.js` — pagina Three.js, da `pipeline/page/renderer.ts` (niente facciate di Tel Aviv o di Roma, niente oggetti sul tetto)
- `pipeline/src/render.mjs` — Chromium via `playwright-core`, da `render.ts`
- `pipeline/src/export.mjs` — solo la piramide degli zoom, da `export.ts`. Nessun upload

Dipendenze aggiunte: `three`, `sharp`, `esbuild`. Esbuild impacchetta la pagina; sharp scrive PNG, JPEG e AVIF.

## Aperto per la FASE 3

- Le 33 tile sono geometria colorata, non pittura. Mancano stile, finestre da 1024 px con overlap 128 e il foglio alberi.
- 68 edifici del centro sono ancora un default di tipologia. Il DBGT 2020 non porta quote più recenti.
- La quota strada è un minimo del DSM, non un profilo rilevato. Una cella di carreggiata può restare alta se l'erosione a 40 m non incontra il fondovalle.
- Gli alberi sono coni uguali, uno ogni 10 m di WorldCover. La faggeta non è distinta. In pittura servirà un foglio proprio.
- Il Ponte San Francesco è ancora la spezzata OSM con spessore convenzionale di 1,2 m.
- Due split minori (way/1047734686, way/1180637482) andrebbero guardati a occhio: il corpo basso potrebbe essere un annesso e non la navata.
- `centro-monasteri` e `monte-livata` non sono stati renderizzati. Stessa camera, altro bbox.
- Il pass altezze è a 3 cm. La pittura deve leggere quella codifica, non i centimetri del riferimento.
