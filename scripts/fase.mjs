#!/usr/bin/env node
/**
 * Segnaposto degli stadi della pipeline.
 * Stesso ordine di Mondo Isometrico / isometricworld:
 * fetch → ground → scene → render → paint → viewer.
 * Non scarica dati e non scrive file: la FASE 1 non è iniziata.
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
    dettaglio: "Render ortografico a 45° con Chromium headless (playwright-core e CHROME_PATH).",
  },
  paint: {
    fase: 3,
    titolo: "Pittura",
    dettaglio: "Pittura delle tile di base. Non parte in questo stadio.",
  },
  dev: {
    fase: 4,
    titolo: "Viewer di sviluppo",
    dettaglio: "Viewer web con zoom e pan. La cartella web/ è solo il posto previsto.",
  },
};

const nome = process.argv[2];
const stadio = STADI[nome];

if (!stadio) {
  console.error("Uso: node scripts/fase.mjs <fetch|ground|scene|render|paint|dev>");
  process.exit(1);
}

console.log(`${nome} — FASE ${stadio.fase}, non ancora implementata.`);
console.log(stadio.titolo + ".");
console.log(stadio.dettaglio);
console.log("Pipeline prevista: fetch → ground → scene → render → paint → viewer.");
console.log("Nessun dato è stato scaricato e nessun file è stato scritto.");
console.log("Vedi ROADMAP.md.");
