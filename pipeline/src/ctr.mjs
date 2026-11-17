/**
 * Quote delle coperture dal Database Geotopografico della Regione Lazio.
 * Copyright (c) 2026 NVerlini
 *
 * Mondo Isometrico legge gli shapefile CTRN 2002 dei municipi di Roma (unità volumetriche,
 * campo ALTEZZA). Per Subiaco la stessa famiglia di dati è servita dal WFS del Geoportale:
 * classe 020104 «Elemento di copertura», geometrie 3D in EPSG:25833, quota assoluta sui vertici.
 * Licenza dei livelli pubblici: CC BY 4.0 (va citata la Regione Lazio).
 *
 * Il foglio intero (DBT_Lazio_RM376.zip, ~100 MB) e lo zip 2020 del comune (~132 MB) restano
 * scaricabili a mano dal file browser del Geoportale. La pipeline non li scarica: per la bbox
 * basta il WFS. Se il servizio non risponde, il fetch lo scrive nel report e le altezze
 * ricadono sul fallback (livelli OSM o default di tipologia).
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import proj4 from "proj4";
import { centroide } from "./geo.mjs";
import { leggiAnelliShp, leggiDbf } from "./shapefile.mjs";
import { ErrorePrevisto, userAgent } from "./overpass.mjs";

const WFS = "https://geoportale.regione.lazio.it/geoserver/ows";
const LAYER = "geonode:web_020104_ele_cp_a";

proj4.defs(
  "EPSG:25833",
  "+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs",
);

export function da25833(x, y) {
  const [lon, lat] = proj4("EPSG:25833", "EPSG:4326", [x, y]);
  return [lon, lat];
}

export const FONTE_CTR = {
  servizio: WFS,
  layer: LAYER,
  classe: "DBGT v. 2014 — Elemento di copertura (020104)",
  licenza: "CC BY 4.0",
  titolare: "Regione Lazio",
  downloadFoglio: "2014_DBGT_5K_SHP/strati-informativi/Roma/DBT_Lazio_RM376.zip",
  downloadComune2020: "2020_DBGT_5K_SHP/Subiaco.zip",
  fileBrowser: "https://geoportale.regione.lazio.it/cartografia/api/raw/",
  login: "POST https://geoportale.regione.lazio.it/cartografia/api/login con corpo {}",
};

function appiattisci(coords, acc) {
  if (!Array.isArray(coords)) return;
  if (typeof coords[0] === "number") {
    acc.push(coords);
    return;
  }
  for (const parte of coords) appiattisci(parte, acc);
}

function anelliDaGeometria(geometria) {
  if (!geometria) return [];
  const tipo = geometria.type;
  const coords = geometria.coordinates;
  if (tipo === "Polygon") return coords.map((anello) => vertici(anello));
  if (tipo === "MultiPolygon") return coords.flatMap((poly) => poly.map((anello) => vertici(anello)));
  const punti = [];
  appiattisci(coords, punti);
  return punti.length >= 3 ? [vertici(punti)] : [];
}

function vertici(anello) {
  const fuori = [];
  for (const p of anello) {
    if (!Array.isArray(p) || p.length < 2) continue;
    const [lon, lat] = da25833(p[0], p[1]);
    const z = p.length > 2 ? Number(p[2]) : NaN;
    fuori.push([
      Math.round(lon * 1e7) / 1e7,
      Math.round(lat * 1e7) / 1e7,
      Number.isFinite(z) ? Math.round(z * 100) / 100 : null,
    ]);
  }
  return fuori;
}

async function pagina(bbox, start, count) {
  const url = new URL(WFS);
  url.searchParams.set("service", "WFS");
  url.searchParams.set("version", "2.0.0");
  url.searchParams.set("request", "GetFeature");
  url.searchParams.set("typeNames", LAYER);
  url.searchParams.set("outputFormat", "application/json");
  url.searchParams.set("srsName", "EPSG:25833");
  url.searchParams.set("bbox", `${bbox[1]},${bbox[0]},${bbox[3]},${bbox[2]},EPSG:4326`);
  url.searchParams.set("count", String(count));
  url.searchParams.set("startIndex", String(start));
  const response = await fetch(url, {
    headers: { "User-Agent": userAgent(), Accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new ErrorePrevisto(`CTR WFS HTTP ${response.status}`);
  const json = await response.json();
  if (json.exceptions || json.exception) {
    throw new ErrorePrevisto(`CTR WFS: ${JSON.stringify(json.exceptions ?? json.exception).slice(0, 240)}`);
  }
  return json;
}

const ZIP_FOGLIO = "2014_DBGT_5K_SHP/strati-informativi/Roma/DBT_Lazio_RM376.zip";
const BASE_FILE = "https://geoportale.regione.lazio.it/cartografia";

/**
 * Il foglio DBT RM376 contiene la classe UN_VOL: ogni volume ha UN_VOL_AV,
 * l'altezza in metri sul suolo. È la misura che manca al WFS delle coperture,
 * il quale nel centro storico restituisce poche falde e quote quasi a terra.
 * Lo zip (~100 MB) resta in data/raw/ctrn e non si versiona.
 */
export async function assicuratiUnita(rawDir, bbox) {
  const dir = path.join(rawDir, "ctrn");
  mkdirSync(dir, { recursive: true });
  const zip = path.join(dir, "DBT_Lazio_RM376.zip");
  if (!existsSync(zip)) {
    console.log("  CTR: scarico il foglio DBT RM376 (unità volumetriche, CC BY 4.0)");
    const token = await (await fetch(`${BASE_FILE}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": userAgent() },
      body: "{}",
      signal: AbortSignal.timeout(60_000),
    })).text();
    if (!token || token.length < 20) throw new ErrorePrevisto("Login anonimo del Geoportale senza token.");
    const response = await fetch(`${BASE_FILE}/api/raw/${ZIP_FOGLIO}`, {
      headers: { "X-Auth": token, "User-Agent": userAgent() },
      redirect: "error",
      signal: AbortSignal.timeout(180_000),
    });
    if (!response.ok) throw new ErrorePrevisto(`Download CTR RM376 HTTP ${response.status}`);
    const tmp = `${zip}.tmp`;
    writeFileSync(tmp, Buffer.from(await response.arrayBuffer()));
    renameSync(tmp, zip);
  }
  const estratto = path.join(dir, "RM376");
  const shp = path.join(estratto, "DBT_Lazio_RM376", "UN_VOL.shp");
  const dbf = path.join(estratto, "DBT_Lazio_RM376", "UN_VOL.dbf");
  if (!existsSync(shp) || !existsSync(dbf)) {
    mkdirSync(estratto, { recursive: true });
    execFileSync("unzip", ["-o", "-q", zip, "DBT_Lazio_RM376/UN_VOL.shp", "DBT_Lazio_RM376/UN_VOL.dbf", "-d", estratto]);
  }
  return unitaNellaBbox(shp, dbf, bbox);
}

export function unitaNellaBbox(shp, dbf, bbox) {
  const righe = leggiDbf(dbf);
  const geometrie = leggiAnelliShp(shp);
  const [s, w, n, e] = bbox;
  const margine = 0.0012;
  const elementi = [];
  const limite = Math.min(righe.length, geometrie.length);
  for (let i = 0; i < limite; i++) {
    if (righe[i]._cancellata || geometrie[i].length === 0) continue;
    const h = Number(righe[i].UN_VOL_AV);
    if (!(h > 0.5) || h > 80) continue;
    const anello = geometrie[i][0].map(([E, N]) => {
      const [lon, lat] = da25833(E, N);
      return [lon, lat];
    });
    const centro = centroide(anello);
    if (centro[1] < s - margine || centro[1] > n + margine || centro[0] < w - margine || centro[0] > e + margine) {
      continue;
    }
    elementi.push({
      h: Math.round(h * 10) / 10,
      centro: [Math.round(centro[0] * 1e7) / 1e7, Math.round(centro[1] * 1e7) / 1e7],
    });
  }
  return {
    stato: "ok",
    classe: "DBGT v. 2014 foglio RM376, unità volumetriche UN_VOL",
    campo: "UN_VOL_AV",
    licenza: "CC BY 4.0",
    titolare: "Regione Lazio",
    download: ZIP_FOGLIO,
    elementi,
  };
}

export async function scaricaCoperture(bbox) {
  const elementi = [];
  const count = 400;
  let attesi = Infinity;
  for (let start = 0; start < 20000; start += count) {
    let json = null;
    let ultimo = "nessuna risposta";
    for (let tentativo = 1; tentativo <= 4; tentativo++) {
      try {
        json = await pagina(bbox, start, count);
        break;
      } catch (err) {
        ultimo = err.message;
        console.error(`  CTR WFS: ${ultimo}, nuovo tentativo…`);
        await new Promise((res) => setTimeout(res, 1500 * tentativo));
      }
    }
    if (!json) throw new ErrorePrevisto(`CTR WFS non raggiungibile (${ultimo}).`);
    const feats = json.features ?? [];
    attesi = Number(json.numberMatched ?? json.totalFeatures ?? elementi.length + feats.length);
    for (const feat of feats) {
      const anelli = anelliDaGeometria(feat.geometry).filter((a) => a.length >= 4);
      if (!anelli.length) continue;
      elementi.push({
        id: String(feat.id ?? feat.properties?.fk ?? elementi.length),
        tipo: feat.properties?.ele_cp_ty ?? null,
        anelli,
      });
    }
    if (feats.length === 0 || elementi.length >= attesi || feats.length < count) break;
  }
  return { elementi, attesi: Number.isFinite(attesi) ? attesi : elementi.length, ...FONTE_CTR };
}
