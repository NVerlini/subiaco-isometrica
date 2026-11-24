# FASE 5 — Pubblicazione

Il sito in uso è **GitHub Pages**. Vercel e Cloudflare R2, più sotto, restano la strada successiva: i comandi di questo repository non creano account, non chiedono token e non fanno un deploy da soli. Nessun segreto va committato. I valori di R2 stanno solo in `.env`, che è gitignorato.

In locale `npm run dev` ignora `TILES_PUBLIC_URL` e legge le tile da `data/`. In produzione, con `TILES_PUBLIC_URL` vuoto, le tile sono sulla stessa origine del sito.

## GitHub Pages

Indirizzo: [https://nverlini.github.io/subiaco-isometrica/](https://nverlini.github.io/subiaco-isometrica/).

L'unica cosa da fare sull'account: **Settings → Pages → Source: GitHub Actions**. Poi un push su `main`, oppure **Actions → Pagine → Run workflow**. Non servono token, variabili d'ambiente o segreti. Il primo avvio crea l'ambiente `github-pages`.

Il workflow `.github/workflows/pages.yml` parte su `push` a `main` e su `workflow_dispatch`. Permessi: `pages: write`, `id-token: write`, `contents: read`. I passi sono `actions/configure-pages`, Node 24, `npm ci`, `npm run build`, `actions/upload-pages-artifact` da `web/dist` e `actions/deploy-pages`.

`configure-pages` fornisce il base path (`/subiaco-isometrica`). Il build lo scrive in `<base href>` di `index.html` e di `404.html`. Foglio di stile, script e tile usano percorsi relativi, così restano sotto quel prefisso. `TILES_PUBLIC_URL` nel workflow è vuoto: niente bucket e niente CORS.

### Perché la piramide non si rigenera nel runner

Scaricare il DBGT (login anonimo del geoportale, zip da circa 100 MB), il Copernicus DEM, WorldCover, e avviare Chromium a ogni push è fragile. Il workflow non lo fa.

Nel repository c'è una piramide leggera del solo centro storico, AVIF più JPEG di riserva, in `web/tiles/centro-storico/`. È uno schema della Rocca e del Ponte San Francesco, non le 33 tile del render (quelle restano in `data/` e non si versionano). `npm run build` la copia in `web/dist` e si ferma se il totale supera 50 MB. Il viewer la segnala come schema.

### Tile dipinte a mano, o generate fuori dalla pipeline

Cartella: `tiles/dipinte/centro-storico/`. Istruzioni anche nel README di quella cartella.

- PNG **1024×1024**.
- Nome uguale alle tile di render: `tx_ty.png`, per esempio `-1_-2.png`.
- Se il build ne trova almeno una, ricostruisce la piramide con sharp (niente Chromium, niente download) e pubblica quella al posto dello schema. `world.json` ha `dipinte: true`.
- Senza PNG, resta lo schema versionato.

Per sostituire lo schema con un export locale già pronto:

```bash
npm run export
npm run build -- --aggiorna-tile
```

`--dipinte` vale lo stesso, se le PNG stanno in `data/derived/centro-storico/paint/`. Il comando aggiunge il JPEG accanto a ogni AVIF, copia il risultato in `web/tiles/centro-storico/` e rifiuta uno schema o una piramide sopra i 50 MB. La cartella va poi committata.

## 1. Bucket Cloudflare R2

Questa sezione non è il percorso in uso. Resta per quando le tile usciranno dal repository.

1. Entra nel pannello Cloudflare, sezione R2, e crea un bucket nuovo. Il nome lo scegli tu: non riusare i bucket di Mondo Isometrico o di isometricworld.
2. In **Settings** del bucket attiva l'accesso pubblico in lettura. Due strade equivalenti per il viewer:
   - sottodominio `r2.dev` (Cloudflare mostra un URL del tipo `https://pub-….r2.dev`);
   - un dominio tuo, per esempio `tiles.example.com`, collegato al bucket.
3. CORS, sempre nelle impostazioni del bucket. Senza, il browser scarica le immagini ma non i JSON (`world.json`, `tiles-photo.json`). Regola minima:

   - origini consentite: `*` (oppure solo l'origine del sito Vercel, quando la conosci);
   - metodi: `GET`, `HEAD`;
   - header consentiti: `*`;
   - `MaxAgeSeconds`: `86400`.

   `npm run publish:tiles` prova a scrivere la stessa regola via API. Se il token non ha il permesso, l'upload delle tile resta valido e il comando lo dice: in quel caso incolla la regola a mano.
4. Crea un token API R2 con permesso **Object Read & Write** su quel bucket. Ti servono Account ID, Access Key ID e Secret Access Key. Il secret si vede una volta sola.

## 2. Variabili locali

```bash
cp .env.example .env
```

Compila solo queste righe, senza virgolette e senza spazi:

```bash
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
TILES_PUBLIC_URL=
```

`TILES_PUBLIC_URL` è l'indirizzo pubblico, `https`, senza barra finale e senza utente o password.

- Se l'URL è la radice del bucket (`https://pub-….r2.dev`), i file finiscono alla radice.
- Se l'URL ha un percorso (`https://tiles.example.com/subiaco`), lo stesso percorso diventa il prefisso degli oggetti. Il viewer e l'upload leggono la stessa variabile, quindi i due devono coincidere.

Controlla che `.env` non sia tracciato da git (`git status` non deve mostrarlo).

## 3. Caricare le tile

Prima serve la piramide in locale (`npm run export`, oppure `npm run export -- --dipinte` se parti dalle tile dipinte).

```bash
npm run publish:tiles -- --dry-run
npm run publish:tiles
```

Il dry-run non apre connessioni e funziona anche senza credenziali: elenca cosa verrebbe caricato. Senza credenziali, il comando senza `--dry-run` si ferma e nomina le variabili mancanti.

L'upload è incrementale. Un file il cui SHA-256 è già in `data/web/regions/subiaco/.publish-manifest.json` (gitignorato, insieme a `data/`) non viene rimandato. Se cambi bucket o prefisso, parte di nuovo. I file tolti in locale non vengono cancellati dal bucket.

Header impostati dal comando:

| File | Content-Type | Cache-Control |
|---|---|---|
| `.avif` | `image/avif` | un anno, `immutable` (l'URL ha già `?v=` con l'hash) |
| `.jpg` / `.jpeg` | `image/jpeg` | un anno, `immutable` |
| `world.json`, `tiles-photo.json`, `report.json` | `application/json` | 5 minuti, `must-revalidate` |

Il comando non pubblica il sito. `npm run publish` è lo stesso upload. `npm run deploy` stampa solo queste istruzioni e non chiama Vercel.

La piramide vera è AVIF. Il server locale, se manca il JPEG, lo ricava con sharp. R2 serve i file che ci sono: un browser senza AVIF non ha il JPEG di riserva finché non lo generi e non lo ricarichi.

## 4. Progetto Vercel

1. Su Vercel, **Add New Project** e importa il repository GitHub `NVerlini/subiaco-isometrica`. Framework: nessuno (c'è `vercel.json`).
2. Build command: `npm run build`. Output directory: `web/dist`. Node: la versione di `.nvmrc` (24).
3. In **Settings → Environment Variables** aggiungi `TILES_PUBLIC_URL` con lo stesso valore del `.env`. Vale per Production (e per Preview, se vuoi le stesse tile). Non inserire le chiavi R2 su Vercel: il sito non carica nulla, legge solo l'URL.
4. Lancia un deploy dal pannello, oppure fai push sul branch che Vercel segue. `npm run build` in locale fa la stessa cartella, per controllare.

`vercel.json` manda gli header di sicurezza su tutte le risposte. La CSP tiene gli script sull'origine del sito (`script-src 'self'`, niente inline e niente eval) e lascia `https:` solo per le immagini e per `connect-src`, perché l'host delle tile lo scegli tu. Quando l'URL è stabile puoi restringere `img-src` e `connect-src` a quell'host e a `https://api.open-meteo.com`. La pagina e `index.html` non vanno in cache; `app.js` e `stile.css` un'ora. Un percorso sconosciuto torna a `index.html`: la vista sta nell'hash (`#@x,y,zoom`), non in un'altra route.

Dopo il deploy apri il sito, controlla che la Rocca compaia e che la console non parli di CORS. Se le tile non rispondono, il viewer lo scrive in pagina.

## 5. Aggiornamenti OSM

Il workflow `.github/workflows/osm-aggiornamenti.yml` è solo manuale: **Actions → Aggiornamenti OSM → Run workflow**. Puoi limitarlo a un'area (`centro-storico`, `centro-monasteri`, `monte-livata`) o lasciarlo vuoto per tutte e tre.

Fa, in ordine:

1. `npm run fetch -- --solo-osm --force` (solo OpenStreetMap: niente DEM, WorldCover o CTR, che non cambiano con le modifiche al borgo);
2. `npm run osm:diff`, che confronta gli edifici in `data/raw/<area>/osm.json` con `config/osm-baseline.json` (conteggi del 15 novembre 2026) e segnala i landmark assenti;
3. `npm run check:osm` sulle stesse aree.

Il rapporto finisce nel sommario del job e nell'artefatto `osm-diff`. Non carica R2 e non tocca Vercel. Non riscrive la baseline: se le differenze ti tornano, in locale lanci `npm run osm:diff -- --scrivi-baseline` e committi `config/osm-baseline.json` dopo averlo riletto.

Il cron mensile (il giorno 1 alle 06:00 UTC) è nel file ma commentato. Per attivarlo, togli il cancelletto alle due righe `schedule` e `cron`.

## 6. Crediti

Il piè di pagina del viewer e `ATTRIBUTION.md` citano le stesse fonti: OpenStreetMap (ODbL), Regione Lazio DBGT (CC BY 4.0), Copernicus DEM, ESA WorldCover (CC BY 4.0, con la formula Sentinel), Open-Meteo (CC BY 4.0), Mondo Isometrico e isometricworld (MIT), Domenico Gagliardi (@dom_gag_96).

## Bozza per X

Testo soltanto. Non è stato pubblicato. Sostituisci l'URL quando il deploy è quello vero, e pubblicalo solo se ti va.

```
Subiaco, in isometrica.

Il borgo, la Rocca Abbaziale e il Ponte San Francesco, letti da dati aperti: OpenStreetMap, la Carta Tecnica della Regione Lazio, Copernicus DEM, ESA WorldCover. Il meteo è Open-Meteo.

Questa mappa esiste perché esiste Mondo Isometrico. Grazie @dom_gag_96 per averla resa una cosa che si può continuare.

[URL del viewer]
```
