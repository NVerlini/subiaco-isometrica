/**
 * Piramide web delle tile non dipinte (niente upload).
 * Adattata dalla costruzione degli zoom in pipeline/src/export.ts di
 * isometricworld e Mondo Isometrico (MIT).
 * Copyright (c) 2026 Dmytro Krasun
 * Copyright (c) 2026 Domenico Gagliardi
 * Copyright (c) 2026 NVerlini
 *
 * La tile (x, y) allo zoom z copre i pixel d'arte [x·512·2^(8-z), …).
 * Lo zoom 8 è 1:1: ogni PNG di render da 1024 px diventa quattro tile da 512.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import {
  DATA,
  DERIVED,
  areaPerId,
  caricaEnv,
  leggiAree,
  leggiPipeline,
  richiediNode24,
} from "./config.mjs";
import { STILE, assi } from "./geo.mjs";
import { CREDITI } from "./crediti.mjs";
import { ErrorePrevisto } from "./overpass.mjs";

const TS = 512;
const ZMAX = 8;
const ZMIN = 2;
const SPLIT = STILE.tile / TS;
const FORMATO = "avif";
const CIELO = { r: 0xb7, g: 0xc9, b: 0xd6 };

export function cartellaSorgente(areaId, dipinte = false) {
  return path.join(DERIVED, areaId, dipinte ? "paint" : "render");
}

function elencoRender(areaId, dipinte = false, cartella) {
  const dir = cartella ?? cartellaSorgente(areaId, dipinte);
  if (!existsSync(dir)) {
    throw new ErrorePrevisto(dipinte
      ? `Manca ${dir}. Esegui prima npm run paint, oppure metti le PNG in tiles/dipinte/centro-storico/.`
      : `Manca ${dir}. Esegui prima npm run render.`);
  }
  const tiles = [];
  for (const nome of readdirSync(dir)) {
    const m = nome.match(/^(-?\d+)_(-?\d+)\.png$/);
    if (m) tiles.push([Number(m[1]), Number(m[2])]);
  }
  if (!tiles.length) throw new ErrorePrevisto(`Nessuna tile PNG in ${dir}.`);
  return tiles.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}

function hashBuf(buf) {
  return createHash("sha1").update(buf).digest("hex").slice(0, 12);
}

async function scriviAvif(img, file) {
  mkdirSync(path.dirname(file), { recursive: true });
  const buf = await img.avif({ quality: 50, effort: 4 }).toBuffer();
  writeFileSync(file, buf);
  return hashBuf(buf);
}

export async function esportaArea(area, pipeline, opt = {}) {
  const dipinte = Boolean(opt.dipinte);
  const cartella = opt.cartella ?? cartellaSorgente(area.id, dipinte);
  const tiles = elencoRender(area.id, dipinte, cartella);
  const out = opt.out ?? path.join(DATA, "web", "regions", pipeline.regione.id);
  const photo = path.join(out, "tiles", "photo");
  rmSync(photo, { recursive: true, force: true });
  const indice = {};
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const nativi = new Set();
  console.log(`export ${area.id}: ${tiles.length} tile ${dipinte ? "dipinte" : "di render"} → piramide ${ZMAX}→${ZMIN}`);
  const t0 = Date.now();

  for (const [tx, ty] of tiles) {
    x0 = Math.min(x0, tx * STILE.tile);
    y0 = Math.min(y0, ty * STILE.tile);
    x1 = Math.max(x1, (tx + 1) * STILE.tile);
    y1 = Math.max(y1, (ty + 1) * STILE.tile);
    const sorgente = path.join(cartella, `${tx}_${ty}.png`);
    for (let j = 0; j < SPLIT; j++) {
      for (let i = 0; i < SPLIT; i++) {
        const x = tx * SPLIT + i;
        const y = ty * SPLIT + j;
        const file = path.join(photo, String(ZMAX), String(x), `${y}.${FORMATO}`);
        const firma = await scriviAvif(
          sharp(sorgente).extract({ left: i * TS, top: j * TS, width: TS, height: TS }),
          file,
        );
        if (!indice[ZMAX]) indice[ZMAX] = {};
        indice[ZMAX][`${x}_${y}`] = firma;
        nativi.add(`${x},${y}`);
      }
    }
  }
  console.log(`  z${ZMAX}: ${nativi.size} tile`);

  let livello = nativi;
  for (let z = ZMAX - 1; z >= ZMIN; z--) {
    const genitori = new Set();
    for (const chiave of livello) {
      const [x, y] = chiave.split(",").map(Number);
      genitori.add(`${Math.floor(x / 2)},${Math.floor(y / 2)}`);
    }
    indice[z] = {};
    for (const chiave of genitori) {
      const [px, py] = chiave.split(",").map(Number);
      const layers = [];
      for (let j = 0; j < 2; j++) {
        for (let i = 0; i < 2; i++) {
          const x = px * 2 + i;
          const y = py * 2 + j;
          const figlio = path.join(photo, String(z + 1), String(x), `${y}.${FORMATO}`);
          if (!existsSync(figlio)) continue;
          layers.push({ input: figlio, left: i * TS, top: j * TS });
        }
      }
      const base = sharp({
        create: { width: TS * 2, height: TS * 2, channels: 3, background: CIELO },
      });
      // sharp applica resize prima di composite: si unisce prima in un buffer, poi si riduce.
      const unito = await base.composite(layers).png().toBuffer();
      const firma = await scriviAvif(
        sharp(unito).resize(TS, TS, { kernel: "lanczos3" }),
        path.join(photo, String(z), String(px), `${py}.${FORMATO}`),
      );
      indice[z][`${px}_${py}`] = firma;
    }
    console.log(`  z${z}: ${genitori.size} tile`);
    livello = genitori;
  }

  const block = TS * 2 ** (ZMAX - ZMIN);
  const ox = Math.floor(x0 / block) * block;
  const oy = Math.floor(y0 / block) * block;
  const { right, up } = assi(pipeline.regione.headingDeg);
  const m = STILE.mpp;
  const world = {
    id: pipeline.regione.id,
    title: pipeline.regione.titolo,
    area: area.id,
    tile_size: TS,
    native_zoom: ZMAX,
    min_zoom: ZMIN,
    bounds: [[y0, x0], [y1, x1]],
    origin: [ox, oy],
    size: [Math.ceil((x1 - ox) / block) * block, Math.ceil((y1 - oy) / block) * block],
    enu2px: [
      [right[0] / m, right[1] / m, right[2] / m],
      [-up[0] / m, -up[1] / m, -up[2] / m],
    ],
    camera: {
      headingDeg: pipeline.regione.headingDeg,
      pitchDeg: pipeline.stile.pitchDeg,
      mpp: pipeline.stile.mpp,
      tile: pipeline.stile.tileArte,
      origin: pipeline.regione.origine,
    },
    format: FORMATO,
    layers: { photo: nativi.size },
    dipinte,
    attributions: CREDITI,
    nota: dipinte
      ? "Piramide delle tile dipinte. Il viewer (FASE 4) somma origin/span all'indice di OpenSeadragon."
      : "Piramide delle tile non dipinte. Il viewer (FASE 4) somma origin/span all'indice di OpenSeadragon.",
  };
  const dataDir = path.join(out, "data");
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(path.join(dataDir, "world.json"), JSON.stringify(world, null, 2));
  writeFileSync(path.join(dataDir, "tiles-photo.json"), JSON.stringify(indice));
  const secondi = Math.round((Date.now() - t0) / 10) / 100;
  const report = {
    area: area.id,
    secondi,
    zoom: [ZMIN, ZMAX],
    tileNative: nativi.size,
    tileRender: tiles.length,
    world: path.join(dataDir, "world.json"),
    cartella: photo,
  };
  writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  console.log(`  piramide in ${photo} (${secondi} s)`);
  console.log(`  world.json ${path.join(dataDir, "world.json")}`);
  return report;
}

export async function esegui(argv) {
  richiediNode24();
  caricaEnv();
  const aree = leggiAree();
  const pipeline = leggiPipeline();
  const opt = { dipinte: false, all: false, ids: [], help: false };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") opt.help = true;
    else if (arg === "--dipinte") opt.dipinte = true;
    else if (arg === "--all") opt.all = true;
    else if (arg.startsWith("-")) throw new ErrorePrevisto(`Opzione sconosciuta: ${arg}`);
    else opt.ids.push(arg);
  }
  if (opt.help) {
    console.log("Uso: npm run export [-- centro-storico] [--dipinte]\nScrive la piramide AVIF in data/web/regions/subiaco/. --dipinte legge le tile in paint/. Non pubblica.");
    return;
  }
  const ids = opt.all ? aree.aree.map((a) => a.id) : opt.ids;
  if (!ids.length) ids.push(process.env.OSM_AREA?.trim() || "centro-storico");
  for (const id of ids) {
    if (!aree.aree.some((a) => a.id === id)) throw new ErrorePrevisto(`Area sconosciuta: ${id}.`);
  }
  console.log("Subiaco Isometrica — export");
  for (const id of ids) await esportaArea(areaPerId(aree, id), pipeline, opt);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  esegui(process.argv.slice(2)).catch((err) => {
    console.error(err instanceof ErrorePrevisto ? err.message : err.stack || err.message);
    process.exit(1);
  });
}
