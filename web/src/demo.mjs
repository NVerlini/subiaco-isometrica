/**
 * Schema leggero quando in data/ non c'è la piramide AVIF.
 * Quattro tile allo zoom 2 e sedici allo zoom 3: non è il render del borgo.
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
const ZMIN = 2;
const ZMAX = 3;
const NATIVO = 8;
const BLOCCO = TILE * 2 ** (NATIVO - ZMIN);

function firma(buf) {
  return createHash("sha1").update(buf).digest("hex").slice(0, 12);
}

function attributi() {
  return CREDITI;
}

function svgSchema(punti, ox, oy, lato, latoArt) {
  const scala = latoArt / lato;
  const px = (art) => (art - ox) / scala;
  const py = (art) => (art - oy) / scala;
  const rocca = punti.find((p) => p.id === "rocca-abbaziale");
  const ponte = punti.find((p) => p.id === "ponte-san-francesco");
  const campo = punti.find((p) => p.id === "sci-fondo-campo-dell-osso");
  const rx = px(rocca.x);
  const ry = py(rocca.y);
  const bx = px(ponte.x);
  const by = py(ponte.y);
  const cx = px(campo.x);
  const cy = py(campo.y);
  const edifici = [
    [rx - 8, ry - 28, 18, 14],
    [rx + 14, ry - 18, 16, 12],
    [rx - 26, ry - 8, 14, 11],
    [rx + 6, ry + 8, 20, 13],
    [rx - 10, ry + 22, 12, 10],
  ];
  const rettangoli = edifici.map(([x, y, w, h]) =>
    `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w}" height="${h}" fill="#8d5a45"/>`,
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${lato}" height="${lato}" viewBox="0 0 ${lato} ${lato}">
  <rect width="100%" height="100%" fill="#6e8f66"/>
  <ellipse cx="${(cx).toFixed(1)}" cy="${cy.toFixed(1)}" rx="${lato * 0.22}" ry="${lato * 0.16}" fill="#4f6d52"/>
  <ellipse cx="${rx.toFixed(1)}" cy="${ry.toFixed(1)}" rx="${lato * 0.16}" ry="${lato * 0.13}" fill="#cbbfa6"/>
  <path d="M ${bx - 80} ${by + 30} Q ${bx} ${by - 10} ${bx + 70} ${by + 46}" fill="none" stroke="#3d7e9a" stroke-width="7" stroke-linecap="round"/>
  ${rettangoli}
  <rect x="${(rx - 4).toFixed(1)}" y="${(ry - 16).toFixed(1)}" width="14" height="18" fill="#6e3b32"/>
</svg>`;
}

export async function generaDemo(dest, opt = {}) {
  const pipeline = opt.pipeline ?? leggiPipeline();
  const aree = opt.aree ?? leggiAree();
  const regione = pipeline.regione;
  const punti = elencoLandmark(aree).map((lm) => ({ ...lm, ...pixelLuogo(regione, lm) }));
  let x0 = Math.min(...punti.map((p) => p.x)) - 4000;
  let y0 = Math.min(...punti.map((p) => p.y)) - 4000;
  let x1 = Math.max(...punti.map((p) => p.x)) + 4000;
  let y1 = Math.max(...punti.map((p) => p.y)) + 4000;
  const ox = Math.floor(x0 / BLOCCO) * BLOCCO;
  const oy = Math.floor(y0 / BLOCCO) * BLOCCO;
  const sizeX = Math.ceil((x1 - ox) / BLOCCO) * BLOCCO;
  const sizeY = Math.ceil((y1 - oy) / BLOCCO) * BLOCCO;
  if (sizeX !== sizeY) {
    const lato = Math.max(sizeX, sizeY);
    x1 = ox + lato;
    y1 = oy + lato;
  }
  const latoArt = Math.max(sizeX, sizeY);
  const colonne = latoArt / BLOCCO;
  const latoPx = colonne * TILE * 2 ** (ZMAX - ZMIN);

  const photo = path.join(dest, "tiles", "photo");
  rmSync(photo, { recursive: true, force: true });
  const svg = svgSchema(punti, ox, oy, latoPx, latoArt);
  const grande = await sharp(Buffer.from(svg)).png().toBuffer();
  const indice = {};
  let byte = 0;

  for (let z = ZMAX; z >= ZMIN; z--) {
    const fattore = 2 ** (ZMAX - z);
    const lato = latoPx / fattore;
    const ridotto = fattore === 1
      ? grande
      : await sharp(grande).resize(lato, lato, { kernel: "lanczos3" }).png().toBuffer();
    const n = lato / TILE;
    indice[z] = {};
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const tx = ox / (TILE * 2 ** (NATIVO - z)) + i;
        const ty = oy / (TILE * 2 ** (NATIVO - z)) + j;
        const box = { left: i * TILE, top: j * TILE, width: TILE, height: TILE };
        const avif = await sharp(ridotto).extract(box).avif({ quality: 40, effort: 2 }).toBuffer();
        const jpg = await sharp(ridotto).extract(box).jpeg({ quality: 60 }).toBuffer();
        const dir = path.join(photo, String(z), String(tx));
        mkdirSync(dir, { recursive: true });
        writeFileSync(path.join(dir, `${ty}.avif`), avif);
        writeFileSync(path.join(dir, `${ty}.jpg`), jpg);
        indice[z][`${tx}_${ty}`] = firma(avif);
        byte += avif.length + jpg.length;
      }
    }
  }

  const { right, up } = assi(regione.headingDeg);
  const m = STILE.mpp;
  const world = {
    id: pipeline.regione.id,
    title: pipeline.regione.titolo,
    area: "demo",
    tile_size: TILE,
    native_zoom: ZMAX,
    min_zoom: ZMIN,
    bounds: [[oy, ox], [oy + latoArt, ox + latoArt]],
    origin: [ox, oy],
    size: [latoArt, latoArt],
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
    fonte: "demo",
    attributions: attributi(),
    nota: "Schema geometrico per il viewer, non il render né la pittura. Si usa solo se data/web/regions/subiaco non ha una piramide.",
  };
  const dataDir = path.join(dest, "data");
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(path.join(dataDir, "world.json"), JSON.stringify(world, null, 2));
  writeFileSync(path.join(dataDir, "tiles-photo.json"), JSON.stringify(indice));
  return { dest, world, indice, byte, punti };
}
