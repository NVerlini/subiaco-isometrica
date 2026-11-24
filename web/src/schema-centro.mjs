/**
 * Schema AVIF e JPEG del solo centro storico, per la cartella versionata.
 * Non è il render delle 33 tile: quelle restano in data/ e non si versionano.
 * Copyright (c) 2026 NVerlini
 */

import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { leggiAree, leggiPipeline } from "../../pipeline/src/config.mjs";
import { STILE, assi } from "../../pipeline/src/geo.mjs";
import { CREDITI } from "../../pipeline/src/crediti.mjs";
import { elencoLandmark, pixelLuogo } from "./vista.mjs";

const TILE = 512;
const NATIVO = 8;
const ZMIN = 2;
const ZMAX = 5;
const PAD = 1800;

function firma(buf) {
  return createHash("sha1").update(buf).digest("hex").slice(0, 12);
}

function span(z) {
  return TILE * 2 ** (NATIVO - z);
}

function svgQuadro(punti, artX, artY, artW, artH, pxW, pxH) {
  const sx = (x) => ((x - artX) / artW) * pxW;
  const sy = (y) => ((y - artY) / artH) * pxH;
  const lung = (m) => (m / artW) * pxW;
  const rocca = punti.find((p) => p.id === "rocca-abbaziale");
  const ponte = punti.find((p) => p.id === "ponte-san-francesco");
  const casa = (dx, dy, w, h) => {
    const x = sx(rocca.x + dx);
    const y = sy(rocca.y + dy);
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${lung(w).toFixed(1)}" height="${lung(h).toFixed(1)}" fill="#8d5a45"/>`;
  };
  const rx = sx(rocca.x);
  const ry = sy(rocca.y);
  const bx = sx(ponte.x);
  const by = sy(ponte.y);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${pxW}" height="${pxH}" viewBox="0 0 ${pxW} ${pxH}">
  <rect width="100%" height="100%" fill="#6e8f66"/>
  <ellipse cx="${rx.toFixed(1)}" cy="${ry.toFixed(1)}" rx="${lung(1700).toFixed(1)}" ry="${lung(1300).toFixed(1)}" fill="#cbbfa6"/>
  <path d="M ${sx(ponte.x - 1100).toFixed(1)} ${sy(ponte.y + 280).toFixed(1)} Q ${bx.toFixed(1)} ${by.toFixed(1)} ${sx(ponte.x + 900).toFixed(1)} ${sy(ponte.y + 420).toFixed(1)}" fill="none" stroke="#3d7e9a" stroke-width="${lung(160).toFixed(1)}" stroke-linecap="round"/>
  ${casa(-520, -280, 260, 160)}
  ${casa(180, -220, 240, 150)}
  ${casa(-300, 80, 200, 140)}
  ${casa(40, 220, 280, 160)}
  <rect x="${sx(rocca.x - 90).toFixed(1)}" y="${sy(rocca.y - 200).toFixed(1)}" width="${lung(200).toFixed(1)}" height="${lung(260).toFixed(1)}" fill="#6e3b32"/>
  <rect x="${(bx - lung(70)).toFixed(1)}" y="${(by - lung(24)).toFixed(1)}" width="${lung(140).toFixed(1)}" height="${lung(48).toFixed(1)}" fill="#5c5346"/>
</svg>`;
}

async function tileDaQuadro(master, masterW, masterH, left, top, lato) {
  const size = Math.max(1, Math.round(lato));
  const l = Math.round(left);
  const t = Math.round(top);
  const fondo = sharp({
    create: { width: size, height: size, channels: 3, background: "#6e8f66" },
  });
  const srcL = Math.max(0, l);
  const srcT = Math.max(0, t);
  const srcR = Math.min(masterW, l + size);
  const srcB = Math.min(masterH, t + size);
  let img = fondo;
  if (srcR > srcL && srcB > srcT) {
    const cut = await sharp(master).extract({
      left: srcL,
      top: srcT,
      width: srcR - srcL,
      height: srcB - srcT,
    }).png().toBuffer();
    img = fondo.composite([{ input: cut, left: srcL - l, top: srcT - t }]);
  }
  return img.resize(TILE, TILE, { kernel: "lanczos3" });
}

export async function generaSchemaCentro(dest, opt = {}) {
  const pipeline = opt.pipeline ?? leggiPipeline();
  const aree = opt.aree ?? leggiAree();
  const regione = pipeline.regione;
  const punti = elencoLandmark(aree)
    .filter((p) => p.id === "rocca-abbaziale" || p.id === "ponte-san-francesco")
    .map((lm) => ({ ...lm, ...pixelLuogo(regione, lm) }));
  if (punti.length !== 2) throw new Error("Servono i pixel della Rocca e del Ponte.");

  let x0 = Math.min(...punti.map((p) => p.x)) - PAD;
  let y0 = Math.min(...punti.map((p) => p.y)) - PAD;
  let x1 = Math.max(...punti.map((p) => p.x)) + PAD;
  let y1 = Math.max(...punti.map((p) => p.y)) + PAD;

  const spanMax = span(ZMAX);
  const tx0 = Math.floor(x0 / spanMax);
  const tx1 = Math.floor((x1 - 1) / spanMax);
  const ty0 = Math.floor(y0 / spanMax);
  const ty1 = Math.floor((y1 - 1) / spanMax);
  const artX = tx0 * spanMax;
  const artY = ty0 * spanMax;
  const nX = tx1 - tx0 + 1;
  const nY = ty1 - ty0 + 1;
  const artW = nX * spanMax;
  const artH = nY * spanMax;
  const pxW = nX * TILE;
  const pxH = nY * TILE;
  x0 = Math.min(x0, artX);
  y0 = Math.min(y0, artY);
  x1 = Math.max(x1, artX + artW);
  y1 = Math.max(y1, artY + artH);

  const svg = svgQuadro(punti, artX, artY, artW, artH, pxW, pxH);
  const master = await sharp(Buffer.from(svg)).png().toBuffer();
  const photo = path.join(dest, "tiles", "photo");
  rmSync(photo, { recursive: true, force: true });
  const indice = {};
  let byte = 0;

  for (let z = ZMAX; z >= ZMIN; z--) {
    const sp = span(z);
    const ix0 = Math.floor(x0 / sp);
    const ix1 = Math.floor((x1 - 1) / sp);
    const iy0 = Math.floor(y0 / sp);
    const iy1 = Math.floor((y1 - 1) / sp);
    indice[z] = {};
    for (let ty = iy0; ty <= iy1; ty++) {
      for (let tx = ix0; tx <= ix1; tx++) {
        const left = ((tx * sp - artX) / spanMax) * TILE;
        const top = ((ty * sp - artY) / spanMax) * TILE;
        const lato = (sp / spanMax) * TILE;
        const img = await tileDaQuadro(master, pxW, pxH, left, top, lato);
        const avif = await img.clone().avif({ quality: 40, effort: 4 }).toBuffer();
        const jpg = await img.clone().jpeg({ quality: 60 }).toBuffer();
        const dir = path.join(photo, String(z), String(tx));
        mkdirSync(dir, { recursive: true });
        writeFileSync(path.join(dir, `${ty}.avif`), avif);
        writeFileSync(path.join(dir, `${ty}.jpg`), jpg);
        indice[z][`${tx}_${ty}`] = firma(avif);
        byte += avif.length + jpg.length;
      }
    }
  }

  const block = span(ZMIN);
  const ox = Math.floor(x0 / block) * block;
  const oy = Math.floor(y0 / block) * block;
  const { right, up } = assi(regione.headingDeg);
  const m = STILE.mpp;
  const world = {
    id: regione.id,
    title: regione.titolo,
    area: "centro-storico",
    tile_size: TILE,
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
      headingDeg: regione.headingDeg,
      pitchDeg: pipeline.stile.pitchDeg,
      mpp: pipeline.stile.mpp,
      tile: pipeline.stile.tileArte,
      origin: regione.origine,
    },
    format: "avif",
    fallback: "jpg",
    maxZoomPixelRatio: pipeline.piramide.maxZoomPixelRatio,
    zoomPerScroll: pipeline.piramide.zoomPerScroll,
    layers: { photo: Object.keys(indice[ZMAX]).length },
    dipinte: false,
    demo: true,
    fonte: "schema",
    attributions: CREDITI,
    nota: "Schema del centro storico (Rocca e Ponte) per GitHub Pages. Non è il render delle 33 tile. Se tiles/dipinte/centro-storico/ contiene PNG da 1024 px, il build pubblica quelle.",
  };
  const dataDir = path.join(dest, "data");
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(path.join(dataDir, "world.json"), JSON.stringify(world, null, 2));
  writeFileSync(path.join(dataDir, "tiles-photo.json"), JSON.stringify(indice));
  byte += Buffer.byteLength(JSON.stringify(world)) + Buffer.byteLength(JSON.stringify(indice));
  return { dest, world, indice, byte, punti };
}
