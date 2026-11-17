/**
 * ESA WorldCover 10 m 2021 v200 (CC BY 4.0), tile 3°×3° N39E012.
 * La tavolozza RGB è quella di pipeline/src/worldcover.ts di Mondo Isometrico (MIT).
 * Copyright (c) 2026 Dmytro Krasun
 * Copyright (c) 2026 Domenico Gagliardi
 * Copyright (c) 2026 NVerlini
 *
 * Attribuzione da riportare: © ESA WorldCover project 2021 / Contains modified
 * Copernicus Sentinel data (2021) processed by ESA WorldCover consortium.
 */

import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fromFile } from "geotiff";
import { ErrorePrevisto, userAgent } from "./overpass.mjs";

const NOME = "ESA_WorldCover_10m_2021_v200_N39E012_Map.tif";
const URL = `https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/${NOME}`;

const PALETTE = {
  "0,100,0": 10,
  "255,187,34": 20,
  "255,255,76": 30,
  "240,150,255": 40,
  "250,0,0": 50,
  "180,180,180": 60,
  "240,240,240": 70,
  "0,100,200": 80,
  "0,150,160": 90,
  "0,207,117": 95,
  "250,230,160": 100,
  "0,0,0": 0,
};

export const CLASSI = {
  0: "nessuno",
  10: "alberi",
  20: "arbusti",
  30: "prato",
  40: "colture",
  50: "costruito",
  60: "suolo-nudo",
  70: "neve",
  80: "acqua",
  90: "zona-umida",
  95: "mangrovie",
  100: "muschio",
};

export async function assicuratiWorldcover(rawDir) {
  const dir = path.join(rawDir, "worldcover");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, NOME);
  if (existsSync(file)) return file;
  console.log("  WorldCover: scarico il tile N39E012 (10 m, 2021 v200)");
  const response = await fetch(URL, {
    headers: { "User-Agent": userAgent() },
    redirect: "error",
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) throw new ErrorePrevisto(`ESA WorldCover HTTP ${response.status}`);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, Buffer.from(await response.arrayBuffer()));
  renameSync(tmp, file);
  return file;
}

/**
 * Legge solo la finestra della bbox (con un piccolo margine in pixel).
 * Il GeoTIFF è spesso indicizzato: i valori sono già i codici di classe.
 * Se arriva in RGB si usa la tavolozza del riferimento.
 */
export async function finestra(file, bbox) {
  const image = await (await fromFile(file)).getImage();
  const [minX, minY, maxX, maxY] = image.getBoundingBox();
  const larghezza = image.getWidth();
  const altezza = image.getHeight();
  const [s, w, n, e] = bbox;
  const margine = 2;
  let left = Math.floor(((w - minX) / (maxX - minX)) * larghezza) - margine;
  let right = Math.ceil(((e - minX) / (maxX - minX)) * larghezza) + margine;
  let top = Math.floor(((maxY - n) / (maxY - minY)) * altezza) - margine;
  let bottom = Math.ceil(((maxY - s) / (maxY - minY)) * altezza) + margine;
  left = Math.max(0, left);
  top = Math.max(0, top);
  right = Math.min(larghezza, Math.max(left + 1, right));
  bottom = Math.min(altezza, Math.max(top + 1, bottom));

  const rasters = await image.readRasters({ window: [left, top, right, bottom], interleave: true });
  const wPx = right - left;
  const hPx = bottom - top;
  const bande = image.getSamplesPerPixel();
  const classi = new Uint8Array(wPx * hPx);
  if (bande === 1) {
    for (let i = 0; i < classi.length; i++) classi[i] = rasters[i];
  } else {
    for (let i = 0; i < classi.length; i++) {
      const chiave = `${rasters[i * bande]},${rasters[i * bande + 1]},${rasters[i * bande + 2]}`;
      const codice = PALETTE[chiave];
      if (codice === undefined) {
        throw new ErrorePrevisto(`WorldCover: colore sconosciuto ${chiave} al pixel ${i}`);
      }
      classi[i] = codice;
    }
  }

  const passoLon = (maxX - minX) / larghezza;
  const passoLat = (maxY - minY) / altezza;
  const lon0 = minX + left * passoLon;
  const lat0 = maxY - top * passoLat;

  function campione(lat, lon) {
    const ix = Math.floor((lon - lon0) / passoLon);
    const iy = Math.floor((lat0 - lat) / passoLat);
    if (ix < 0 || iy < 0 || ix >= wPx || iy >= hPx) return 0;
    return classi[iy * wPx + ix];
  }

  const conteggio = {};
  for (const c of classi) conteggio[c] = (conteggio[c] ?? 0) + 1;

  return {
    classi,
    larghezza: wPx,
    altezza: hPx,
    lon0,
    lat0,
    passoLon,
    passoLat,
    campione,
    conteggio,
    url: URL,
    nome: NOME,
  };
}
