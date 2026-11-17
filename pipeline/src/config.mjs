/**
 * Lettura di config/areas.json e config/pipeline.json, e percorsi della cache in data/.
 * Copyright (c) 2026 NVerlini
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ErrorePrevisto } from "./overpass.mjs";

const QUI = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(QUI, "../..");
export const DATA = path.join(ROOT, "data");
export const RAW = path.join(DATA, "raw");
export const DERIVED = path.join(DATA, "derived");

export function caricaEnv() {
  const envPath = path.join(ROOT, ".env");
  if (existsSync(envPath)) process.loadEnvFile(envPath);
}

export function richiediNode24() {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 24) {
    throw new ErrorePrevisto(
      `Serve Node.js 24 o successivo (in uso: ${process.versions.node}). Il file .nvmrc contiene 24.`,
    );
  }
}

function leggiJson(relativo) {
  const file = path.join(ROOT, relativo);
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    throw new ErrorePrevisto(`Impossibile leggere ${relativo}: ${err.message}`);
  }
}

export function leggiAree() {
  const config = leggiJson("config/areas.json");
  if (!Array.isArray(config.aree) || config.aree.length === 0) {
    throw new ErrorePrevisto("config/areas.json non contiene aree.");
  }
  return config;
}

export function leggiPipeline() {
  const config = leggiJson("config/pipeline.json");
  const regione = config.regione;
  if (!regione?.origine || !Number.isFinite(regione.origine.lat) || !Number.isFinite(regione.origine.lon)) {
    throw new ErrorePrevisto("config/pipeline.json non ha l'origine della regione.");
  }
  for (const chiave of ["geoidM", "groundH", "heightBase"]) {
    if (!Number.isFinite(regione[chiave])) {
      throw new ErrorePrevisto(`config/pipeline.json: ${chiave} non è un numero. Va fissato sulle misure del DEM.`);
    }
  }
  const codifica = regione.codificaAltezze;
  if (!codifica || !Number.isFinite(codifica.passoCm) || codifica.passoCm <= 0) {
    throw new ErrorePrevisto("config/pipeline.json: manca codificaAltezze.passoCm.");
  }
  return config;
}

export function leggiAltezze() {
  return leggiJson("config/altezze.json");
}

export function cartellaRaw(areaId) {
  const dir = path.join(RAW, areaId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function cartellaDerived(areaId, stadio) {
  const dir = path.join(DERIVED, areaId, stadio);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * `npm run fetch -- centro-monasteri`, `--all`, `--force`.
 * Senza argomenti usa OSM_AREA oppure centro-storico.
 */
export function opzioni(argv, aree) {
  let force = false;
  let all = false;
  const ids = [];
  for (const arg of argv) {
    if (arg === "--force") force = true;
    else if (arg === "--all") all = true;
    else if (arg === "--help" || arg === "-h") return { help: true, force, ids: [] };
    else if (arg.startsWith("-")) throw new ErrorePrevisto(`Opzione sconosciuta: ${arg}`);
    else ids.push(arg);
  }
  const noti = new Set(aree.map((a) => a.id));
  const scelti = all ? aree.map((a) => a.id) : ids;
  if (scelti.length === 0) scelti.push(process.env.OSM_AREA?.trim() || "centro-storico");
  for (const id of scelti) {
    if (!noti.has(id)) {
      throw new ErrorePrevisto(`Area sconosciuta: ${id}. Aree: ${[...noti].join(", ")}.`);
    }
  }
  return { help: false, force, ids: scelti };
}

export function areaPerId(config, id) {
  const area = config.aree.find((a) => a.id === id);
  if (!area) throw new ErrorePrevisto(`Area sconosciuta: ${id}`);
  return area;
}

export function aiutoStadio(nome) {
  console.log(`Uso:
  npm run ${nome}
  npm run ${nome} -- centro-monasteri
  npm run ${nome} -- --all
  npm run ${nome} -- --force

Senza argomenti lavora su centro-storico (o su OSM_AREA).
--all esegue centro-storico, centro-monasteri e monte-livata.
--force riscarica OSM e la CTR anche se la cache c'è già.
DEM e WorldCover si riscaricano solo se il file non c'è: sono prodotti statici, e data/ non è versionata.`);
}
