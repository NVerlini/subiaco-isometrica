/**
 * Quote delle coperture dal Database Geotopografico della Regione Lazio.
 * Copyright (c) 2026 NVerlini
 *
 * Mondo Isometrico legge gli shapefile CTRN 2002 dei municipi di Roma (unità volumetriche,
 * campo ALTEZZA). Per Subiaco la stessa famiglia di dati è servita dal WFS del Geoportale:
 * classe 020104 «Elemento di copertura», geometrie 3D in EPSG:25833, quota assoluta sui vertici.
 * Licenza dei livelli pubblici: CC BY 4.0 (va citata la Regione Lazio).
 *
 * Il foglio 2014 (DBT_Lazio_RM376.zip) e lo zip 2020 del comune si scaricano dal file browser
 * del Geoportale con un login anonimo (non è un segreto). Restano in data/raw/ctrn.
 * Se un servizio non risponde, il fetch lo scrive nel report e le altezze ricadono sul fallback.
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

function areaUtm(anello) {
  let a = 0;
  for (let i = 0; i < anello.length - 1; i++) {
    a += anello[i][0] * anello[i + 1][1] - anello[i + 1][0] * anello[i][1];
  }
  return Math.abs(a) / 2;
}

function semplificaUtm(anello, eps = 0.35) {
  if (anello.length <= 48) return anello;
  const dist = (p, a, b) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    if (l2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
  };
  const tieni = (da, a) => {
    let imax = -1;
    let dmax = 0;
    for (let i = da + 1; i < a; i++) {
      const d = dist(anello[i], anello[da], anello[a]);
      if (d > dmax) {
        dmax = d;
        imax = i;
      }
    }
    if (dmax > eps && imax > 0) return [...tieni(da, imax), ...tieni(imax, a).slice(1)];
    return [anello[da], anello[a]];
  };
  const chiuso = anello[0][0] === anello.at(-1)[0] && anello[0][1] === anello.at(-1)[1];
  const base = chiuso ? anello.slice(0, -1) : anello;
  const out = tieni(0, base.length - 1);
  if (chiuso) out.push(out[0]);
  return out;
}

function altezzaRiga(riga) {
  const campi = ["UN_VOL_AV", "ALTEZZA", "H_EDIF", "H", "ALTEZZA_M", "UN_VOL_H"];
  for (const nome of campi) {
    if (riga[nome] == null || riga[nome] === "") continue;
    const h = Number(String(riga[nome]).replace(",", "."));
    if (h > 0.5 && h <= 80) return { h, campo: nome };
  }
  return null;
}

/**
 * Volumi con pianta. `schema` 2 conserva l'anello: serve a staccare il campanile dal corpo.
 */
export function unitaNellaBbox(shp, dbf, bbox, meta = {}) {
  const righe = leggiDbf(dbf);
  const geometrie = leggiAnelliShp(shp);
  const [s, w, n, e] = bbox;
  const margine = 0.0012;
  const elementi = [];
  const limite = Math.min(righe.length, geometrie.length);
  let campo = meta.campo ?? "UN_VOL_AV";
  for (let i = 0; i < limite; i++) {
    if (righe[i]._cancellata || geometrie[i].length === 0) continue;
    const misura = altezzaRiga(righe[i]);
    if (!misura) continue;
    campo = misura.campo;
    const pieno = geometrie[i][0];
    const superficie = areaUtm(pieno);
    if (superficie < 4 || superficie > 20000) continue;
    const anelloPieno = pieno.map(([E, N]) => da25833(E, N));
    const centro = centroide(anelloPieno);
    const anello = semplificaUtm(pieno).map(([E, N]) => {
      const [lon, lat] = da25833(E, N);
      return [Math.round(lon * 1e7) / 1e7, Math.round(lat * 1e7) / 1e7];
    });
    if (centro[1] < s - margine || centro[1] > n + margine || centro[0] < w - margine || centro[0] > e + margine) {
      continue;
    }
    elementi.push({
      h: Math.round(misura.h * 10) / 10,
      areaM2: Math.round(superficie),
      centro: [Math.round(centro[0] * 1e7) / 1e7, Math.round(centro[1] * 1e7) / 1e7],
      anello,
      fonte: meta.fonte ?? "dbgt-2014",
    });
  }
  return {
    stato: "ok",
    schema: 3,
    classe: meta.classe ?? "DBGT v. 2014 foglio RM376, unità volumetriche UN_VOL",
    campo,
    licenza: "CC BY 4.0",
    titolare: "Regione Lazio",
    download: meta.download ?? ZIP_FOGLIO,
    elementi,
  };
}

const ZIP_2020 = "2020_DBGT_5K_SHP/Subiaco.zip";

function elencoZip(zip) {
  const testo = execFileSync("unzip", ["-l", zip], { encoding: "utf8", maxBuffer: 32_000_000 });
  const nomi = [];
  for (const riga of testo.split("\n")) {
    const m = riga.match(/\d{2,4}-\d{2}-\d{2,4}\s+\d{2}:\d{2}\s+(.+)$/);
    if (m) nomi.push(m[1].trim());
  }
  return nomi;
}

function scegliShapeVolumi(nomi) {
  const shp = nomi.filter((n) => n.toLowerCase().endsWith(".shp"));
  const punteggio = (nome) => {
    const n = nome.toLowerCase();
    let p = 0;
    if (n.includes("un_vol")) p += 50;
    if (n.includes("unvol")) p += 50;
    if (n.includes("volum")) p += 40;
    if (n.includes("edif")) p += 20;
    if (n.includes("a0201")) p += 10;
    if (n.includes("cp_a") || n.includes("copert")) p -= 15;
    return p;
  };
  return shp
    .map((nome) => ({ nome, p: punteggio(nome) }))
    .filter((v) => v.p > 0)
    .sort((a, b) => b.p - a.p);
}

/**
 * DBGT 2020 del comune di Subiaco. Si unisce al foglio 2014 solo per gli edifici
 * che nel 2014 non hanno un volume. Lo zip resta in data/raw/ctrn.
 */
export async function assicuratiUnita2020(rawDir, bbox) {
  const dir = path.join(rawDir, "ctrn");
  mkdirSync(dir, { recursive: true });
  const zip = path.join(dir, "Subiaco_2020.zip");
  if (!existsSync(zip)) {
    console.log("  CTR: scarico il DBGT 2020 del comune di Subiaco (CC BY 4.0)");
    const token = await (await fetch(`${BASE_FILE}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": userAgent() },
      body: "{}",
      signal: AbortSignal.timeout(60_000),
    })).text();
    if (!token || token.length < 20) throw new ErrorePrevisto("Login anonimo del Geoportale senza token.");
    const response = await fetch(`${BASE_FILE}/api/raw/${ZIP_2020}`, {
      headers: { "X-Auth": token, "User-Agent": userAgent() },
      redirect: "error",
      signal: AbortSignal.timeout(300_000),
    });
    if (!response.ok) throw new ErrorePrevisto(`Download DBGT 2020 HTTP ${response.status}`);
    const tmp = `${zip}.tmp`;
    writeFileSync(tmp, Buffer.from(await response.arrayBuffer()));
    renameSync(tmp, zip);
  }
  const candidati = scegliShapeVolumi(elencoZip(zip));
  if (!candidati.length) throw new ErrorePrevisto("Lo zip DBGT 2020 non contiene uno shapefile di volumi o edifici.");
  const estratto = path.join(dir, "Subiaco_2020");
  mkdirSync(estratto, { recursive: true });
  let ultimo = "nessun candidato leggibile";
  for (const candidato of candidati.slice(0, 4)) {
    const base = candidato.nome.replace(/\.shp$/i, "");
    const pezzi = [`${base}.shp`, `${base}.dbf`, `${base}.shx`].filter((n) => true);
    try {
      execFileSync("unzip", ["-o", "-q", zip, ...pezzi, "-d", estratto]);
    } catch (err) {
      ultimo = err.message;
      continue;
    }
    const shp = path.join(estratto, `${base}.shp`);
    const dbf = path.join(estratto, `${base}.dbf`);
    if (!existsSync(shp) || !existsSync(dbf)) continue;
    const doc = unitaNellaBbox(shp, dbf, bbox, {
      fonte: "dbgt-2020",
      classe: `DBGT 2020 comune di Subiaco, ${path.basename(base)}`,
      download: ZIP_2020,
    });
    if (doc.elementi.length) {
      console.log(`  DBGT 2020: ${doc.elementi.length} volumi da ${path.basename(base)} (campo ${doc.campo})`);
      return doc;
    }
    ultimo = `${path.basename(base)} senza altezze nella bbox`;
  }
  throw new ErrorePrevisto(ultimo);
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
