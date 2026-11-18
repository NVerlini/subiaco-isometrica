#!/usr/bin/env node
/**
 * Segnaposto degli stadi della pipeline.
 * Stesso ordine di Mondo Isometrico / isometricworld:
 * fetch → ground → scene → render → paint → export → viewer → publish → deploy.
 * Il contratto (camera, zoom, cache) è in config/pipeline.json.
 * fetch, ground e scene sono la FASE 1. render ed export sono la FASE 2.
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
    dettaglio: "Finestre da 1024 px con 128 px di sovrapposizione. Le immagini di stile non sono ancora nel repo.",
  },
  export: {
    fase: 2,
    titolo: "Piramide di tile",
    dettaglio: "Piramide dallo zoom 8 allo zoom 2, tile web da 512 px, nella cache data/web/. In FASE 2 esporta le tile di base; dopo la pittura si riusa. Non pubblica.",
  },
  dev: {
    fase: 4,
    titolo: "Viewer di sviluppo",
    dettaglio: "Viewer Astro e OpenSeadragon, da scrivere in web/. Le dipendenze non sono ancora installate.",
  },
  publish: {
    fase: 5,
    titolo: "Pubblicazione delle tile",
    dettaglio: "Caricherebbe la cache su R2. Il bucket non esiste ancora e questo comando non contatta alcun servizio.",
  },
  deploy: {
    fase: 5,
    titolo: "Deploy del sito",
    dettaglio: "Pubblicherebbe il sito dopo le tile. Non c'è ancora una config di hosting e questo comando non contatta alcun servizio.",
  },
};

const nome = process.argv[2];
const stadio = STADI[nome];

if (!stadio) {
  console.error("Uso: node scripts/fase.mjs <fetch|ground|scene|render|paint|export|dev|publish|deploy>");
  process.exit(1);
}

if (nome === "fetch" || nome === "ground" || nome === "scene" || nome === "render" || nome === "export") {
  const modulo = await import(`../pipeline/src/${nome}.mjs`);
  await modulo.esegui(process.argv.slice(3));
} else {
  console.log(`${nome} — FASE ${stadio.fase}, non ancora implementata.`);
  console.log(stadio.titolo + ".");
  console.log(stadio.dettaglio);
  console.log("Pipeline prevista: fetch → ground → scene → render → paint → export → viewer → publish → deploy.");
  console.log("Nessun dato è stato scaricato e nessun file è stato scritto.");
  console.log("Vedi docs/riferimenti-pipeline.md e ROADMAP.md.");
}
