/**
 * Copernicus DEM GLO-30 Public (Cloud Optimized GeoTIFF su AWS Open Data, senza credenziali).
 * Il campionamento bilineare segue ground.ts di Mondo Isometrico / isometricworld (MIT).
 * Copyright (c) 2026 Dmytro Krasun
 * Copyright (c) 2026 Domenico Gagliardi
 * Copyright (c) 2026 NVerlini
 *
 * Quote ortometriche EGM2008, in metri. Il tile N41 E013 copre tutte e tre le aree.
 */

import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fromFile } from "geotiff";
import { ErrorePrevisto, userAgent } from "./overpass.mjs";

const TILE = "Copernicus_DSM_COG_10_N41_00_E013_00_DEM";
const URL = `https://copernicus-dem-30m.s3.eu-central-1.amazonaws.com/${TILE}/${TILE}.tif`;

export const DEM_NOME = `${TILE}.tif`;

export async function assicuratiDem(rawDir) {
  const dir = path.join(rawDir, "dem");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, DEM_NOME);
  if (existsSync(file)) return file;
  console.log(`  DEM: scarico ${TILE} (GLO-30, accesso pubblico)`);
  const response = await fetch(URL, {
    headers: { "User-Agent": userAgent() },
    redirect: "error",
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) throw new ErrorePrevisto(`Copernicus DEM HTTP ${response.status} su ${URL}`);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, Buffer.from(await response.arrayBuffer()));
  renameSync(tmp, file);
  return file;
}

export async function apriDem(file) {
  const image = await (await fromFile(file)).getImage();
  const larghezza = image.getWidth();
  const altezza = image.getHeight();
  const dati = (await image.readRasters())[0];
  const [ox, oy] = image.getOrigin();
  const [sx, sy] = image.getResolution();
  if (!(sx > 0) || !(sy < 0)) throw new ErrorePrevisto(`DEM: risoluzione inattesa ${sx}, ${sy}`);

  function campione(lat, lon) {
    const fx = (lon - ox) / sx;
    const fy = (lat - oy) / sy;
    if (fx < 0 || fy < 0 || fx > larghezza - 1 || fy > altezza - 1) return NaN;
    const ix = Math.min(larghezza - 2, Math.floor(fx));
    const iy = Math.min(altezza - 2, Math.floor(fy));
    const ax = fx - ix;
    const ay = fy - iy;
    const v = (x, y) => dati[y * larghezza + x];
    return (v(ix, iy) * (1 - ax) + v(ix + 1, iy) * ax) * (1 - ay)
      + (v(ix, iy + 1) * (1 - ax) + v(ix + 1, iy + 1) * ax) * ay;
  }

  return {
    campione,
    larghezza,
    altezza,
    origine: [ox, oy],
    risoluzione: [sx, sy],
    tile: TILE,
    url: URL,
  };
}

/** Minimo, massimo e alcuni punti, sul DSM grezzo (non sul suolo aperto). */
export function misuraAree(campione, aree, punti) {
  const risultatoAree = {};
  for (const area of aree) {
    const [s, w, n, e] = area.bbox;
    let min = Infinity;
    let max = -Infinity;
    let somma = 0;
    let conto = 0;
    const passo = 0.0003;
    for (let lat = s; lat <= n; lat += passo) {
      for (let lon = w; lon <= e; lon += passo) {
        const v = campione(lat, lon);
        if (!Number.isFinite(v) || v < -100) continue;
        min = Math.min(min, v);
        max = Math.max(max, v);
        somma += v;
        conto++;
      }
    }
    risultatoAree[area.id] = {
      min: arrotonda(min),
      max: arrotonda(max),
      media: conto ? arrotonda(somma / conto) : null,
      campioni: conto,
    };
  }
  const risultatoPunti = {};
  for (const [id, [lat, lon]] of Object.entries(punti)) {
    risultatoPunti[id] = arrotonda(campione(lat, lon));
  }
  const quote = Object.values(risultatoAree);
  const min = Math.min(...quote.map((q) => q.min));
  const max = Math.max(...quote.map((q) => q.max));
  return {
    prodotto: TILE,
    datum: "quote ortometriche EGM2008, metri, DSM GLO-30",
    aree: risultatoAree,
    punti: risultatoPunti,
    dislivelloM: arrotonda(max - min),
    minimoM: arrotonda(min),
    massimoM: arrotonda(max),
  };
}

function arrotonda(v) {
  return Math.round(v * 100) / 100;
}
