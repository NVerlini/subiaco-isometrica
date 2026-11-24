#!/usr/bin/env node
/**
 * Segnaposto degli stadi della pipeline.
 * Stesso ordine di Mondo Isometrico / isometricworld:
 * fetch → ground → scene → render → paint → export → viewer → publish → deploy.
 * Il contratto (camera, zoom, cache) è in config/pipeline.json.
 * fetch, ground e scene sono la FASE 1. render ed export sono la FASE 2.
 * paint è la FASE 3. export --dipinte ricostruisce la piramide dalle tile dipinte.
 * dev è la FASE 4: viewer statico, con schema leggero se la piramide non c'è.
 * publish è la FASE 5: carica le tile su R2. deploy non contatta Vercel.
 */

const STADI = {
  fetch: {
    fase: 1,
    titolo: "Fetch dei dati OSM",
    dettaglio: "Edifici, strade, acqua, uso del suolo, monumenti, piste e impianti, dentro le bbox di config/areas.json.",
  },
  ground: {
    fase: 1,
    titolo: "Suolo (ground)",
    dettaglio: "Suolo a partire da landuse, acqua e vegetazione, più il terreno quando ci sarà il DEM.",
  },
  scene: {
    fase: 1,
    titolo: "Scena",
    dettaglio: "Scena con edifici, strade, landmark e, a Monte Livata, impianti e piste.",
  },
  render: {
    fase: 2,
    titolo: "Render isometrico a tile",
    dettaglio: "Render ortografico, pitch 45°, tile da 1024 px, con Chromium headless (playwright-core e CHROME_PATH). Parametri in config/pipeline.json.",
  },
  paint: {
    fase: 3,
    titolo: "Pittura",
    dettaglio: "Finestre da 1024 px con 128 px di sovrapposizione sul render, maschere di classe e pass altezze a 3 cm. Senza PAINT_API_KEY usa il provider mock.",
  },
  export: {
    fase: 2,
    titolo: "Piramide di tile",
    dettaglio: "Piramide dallo zoom 8 allo zoom 2, tile web da 512 px, nella cache data/web/. In FASE 2 esporta le tile di base; dopo la pittura si riusa. Non pubblica.",
  },
  dev: {
    fase: 4,
    titolo: "Viewer di sviluppo",
    dettaglio: "Viewer statico in web/. Serve la piramide AVIF in data/web se c'è, altrimenti uno schema leggero.",
  },
  publish: {
    fase: 5,
    titolo: "Pubblicazione delle tile",
    dettaglio: "Carica data/web/regions/<regione>/ su R2. Senza credenziali in .env si ferma; con --dry-run non contatta il bucket.",
  },
  deploy: {
    fase: 5,
    titolo: "Deploy del sito",
    dettaglio: "Non contatta Vercel. Il sito si pubblica collegando il repository: vedi docs/fase5-pubblicazione.md. npm run build prepara web/dist.",
  },
};

const nome = process.argv[2];
const stadio = STADI[nome];

if (!stadio) {
  console.error("Uso: node scripts/fase.mjs <fetch|ground|scene|render|paint|export|dev|publish|deploy>");
  process.exit(1);
}

if (nome === "fetch" || nome === "ground" || nome === "scene" || nome === "render" || nome === "paint" || nome === "export") {
  const modulo = await import(`../pipeline/src/${nome}.mjs`);
  await modulo.esegui(process.argv.slice(3));
} else if (nome === "dev") {
  const modulo = await import("../web/src/server.mjs");
  await modulo.avvia(process.argv.slice(3));
} else if (nome === "publish") {
  const { richiediNode24 } = await import("../pipeline/src/config.mjs");
  richiediNode24();
  const modulo = await import("../scripts/publish-tiles.mjs");
  await modulo.esegui(process.argv.slice(3));
} else if (nome === "deploy") {
  console.log("deploy — FASE 5. Questo comando non contatta Vercel e non pubblica il sito.");
  console.log("Collega il repository a un progetto Vercel (build: npm run build, output: web/dist)");
  console.log("e imposta TILES_PUBLIC_URL. I passi sono in docs/fase5-pubblicazione.md.");
  console.log("Le tile si caricano a parte, con npm run publish:tiles, sul bucket R2.");
} else {
  console.log(`${nome} — FASE ${stadio.fase}, non ancora implementata.`);
  console.log(stadio.titolo + ".");
  console.log(stadio.dettaglio);
  console.log("Pipeline prevista: fetch → ground → scene → render → paint → export → viewer → publish → deploy.");
  console.log("Nessun dato è stato scaricato e nessun file è stato scritto.");
  console.log("Vedi docs/riferimenti-pipeline.md e ROADMAP.md.");
}
