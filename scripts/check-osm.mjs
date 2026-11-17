#!/usr/bin/env node
/**
 * Verifica leggera della copertura OpenStreetMap per una bbox di config/areas.json.
 *
 * Usa Overpass `out count` e `out ids`: non scarica geometrie e non scrive file.
 * I conteggi di riferimento (15 novembre 2026) sono in docs/fase0-dati-osm.md;
 * questo script li riverifica sullo snapshot attuale.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ErrorePrevisto, interrogaOverpass, timeoutSecondi } from "../pipeline/src/overpass.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_PATH = path.join(ROOT, "config", "areas.json");

const CATEGORIE = [
  { id: "building", etichetta: "Edifici (building)", filtri: ['["building"]'] },
  { id: "building-height", etichetta: "Edifici con height", filtri: ['["building"]["height"]'] },
  { id: "building-levels", etichetta: "Edifici con building:levels", filtri: ['["building"]["building:levels"]'] },
  { id: "highway", etichetta: "Strade (highway)", filtri: ['["highway"]'] },
  { id: "water", etichetta: "Acqua (waterway o natural=water)", filtri: ['["waterway"]', '["natural"="water"]'] },
  { id: "landuse", etichetta: "Uso del suolo (landuse)", filtri: ['["landuse"]'] },
  { id: "wood", etichetta: "Boschi e alberi (natural=wood o tree)", filtri: ['["natural"="wood"]', '["natural"="tree"]'] },
  { id: "poi", etichetta: "POI (amenity, tourism, historic)", filtri: ['["amenity"]', '["tourism"]', '["historic"]'] },
  { id: "piste", etichetta: "Piste (piste:type)", filtri: ['["piste:type"]'] },
  { id: "aerialway", etichetta: "Impianti (aerialway)", filtri: ['["aerialway"]'] },
];

function richiediNode24() {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 24) {
    throw new ErrorePrevisto(
      `Serve Node.js 24 o successivo (in uso: ${process.versions.node}). Il file .nvmrc contiene 24.`,
    );
  }
}

function caricaEnv() {
  const envPath = path.join(ROOT, ".env");
  if (existsSync(envPath)) process.loadEnvFile(envPath);
}

function leggiConfig() {
  let config;
  try {
    config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch (err) {
    throw new ErrorePrevisto(`Impossibile leggere ${path.relative(ROOT, CONFIG_PATH)}: ${err.message}`);
  }
  if (!Array.isArray(config.aree) || config.aree.length === 0) {
    throw new ErrorePrevisto("config/areas.json non contiene aree.");
  }
  if (!Array.isArray(config.landmark) || config.landmark.length === 0) {
    throw new ErrorePrevisto("config/areas.json non contiene landmark.");
  }
  const ids = new Set();
  for (const area of config.aree) {
    if (!area.id || ids.has(area.id)) throw new ErrorePrevisto(`Area non valida o duplicata: ${area.id}`);
    ids.add(area.id);
    if (!Array.isArray(area.bbox) || area.bbox.length !== 4 || area.bbox.some((n) => !Number.isFinite(n))) {
      throw new ErrorePrevisto(`BBox non valida per ${area.id}: servono quattro numeri S,W,N,E.`);
    }
    const [south, west, north, east] = area.bbox;
    if (south < -90 || north > 90 || south >= north || west < -180 || east > 180 || west >= east) {
      throw new ErrorePrevisto(`BBox fuori intervallo per ${area.id}: ${area.bbox.join(",")}`);
    }
  }
  for (const lm of config.landmark) analizzaOsm(lm.osm, lm.nome);
  const impianto = config.monteLivata?.impiantoAttivo;
  if (impianto?.osm) analizzaOsm(impianto.osm, impianto.nome);
  return config;
}

function analizzaOsm(osm, nome) {
  const match = /^(node|way|relation)\/(\d+)$/.exec(osm ?? "");
  if (!match) throw new ErrorePrevisto(`Id OSM non valido per «${nome}»: ${osm}`);
  return { tipo: match[1], id: Number(match[2]) };
}

function parseArgs(argv) {
  const out = { list: false, help: false, area: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--list") out.list = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--area") out.area = argv[++i];
    else if (arg.startsWith("--area=")) out.area = arg.slice("--area=".length);
    else if (arg.startsWith("-")) throw new ErrorePrevisto(`Opzione sconosciuta: ${arg}`);
    else if (!out.area) out.area = arg;
    else throw new ErrorePrevisto(`Argomento inatteso: ${arg}`);
  }
  return out;
}

function aiuto() {
  console.log(`Uso:
  npm run check:osm
  npm run check:osm -- centro-storico
  npm run check:osm -- --area monte-livata
  npm run check:osm -- --list

Aree: centro-storico, centro-monasteri, monte-livata (config/areas.json).
Conta edifici, strade e altre categorie nella bbox e controlla che i landmark esistano.
Non scarica geometrie e non scrive file.`);
}

function stampaElenco(config) {
  console.log("Aree (bbox S, W, N, E):");
  for (const area of config.aree) {
    console.log(`  ${area.id.padEnd(18)} ${formattaBbox(area.bbox).padEnd(36)} ${area.nome}`);
  }
  console.log("Landmark:");
  for (const lm of config.landmark) {
    console.log(`  ${lm.osm.padEnd(20)} ${lm.nome}`);
  }
  const impianto = config.monteLivata?.impiantoAttivo;
  const pista = config.monteLivata?.pistaPrioritaria;
  if (impianto) console.log(`Impianto attivo: ${impianto.nome} (${impianto.osm})`);
  if (pista) console.log(`Pista prioritaria: ${pista.nome} (${pista.osm ?? "non mappata in OSM"})`);
}

function formattaBbox(bbox) {
  return bbox.map((n) => n.toFixed(4)).join(", ");
}

function queryOverpass(bbox, oggetti, timeout) {
  const b = `(${bbox.map((n) => Number(n).toFixed(4)).join(",")})`;
  const conteggi = CATEGORIE.map((cat) => {
    const righe = cat.filtri.map((filtro) => `  nwr${filtro}${b};`).join("\n");
    return `(\n${righe}\n);\nout count;`;
  }).join("\n");
  const ids = oggetti.map((ogg) => `${ogg.tipo}(${ogg.id});\nout ids;`).join("\n");
  return `[out:json][timeout:${timeout}];\n${conteggi}\n${ids}\n`;
}

function stampaConteggi(elements) {
  const conteggi = elements.filter((el) => el.type === "count");
  if (conteggi.length !== CATEGORIE.length) {
    throw new ErrorePrevisto(
      `Overpass ha restituito ${conteggi.length} conteggi, attesi ${CATEGORIE.length}.`,
    );
  }
  const righe = CATEGORIE.map((cat, i) => {
    const tags = conteggi[i].tags ?? {};
    for (const chiave of ["nodes", "ways", "relations", "total"]) {
      if (tags[chiave] == null) throw new ErrorePrevisto(`Conteggio incompleto per ${cat.id}.`);
    }
    return { etichetta: cat.etichetta, tags };
  });
  const larghezza = Math.max(...righe.map((r) => r.etichetta.length), "Categoria".length);
  const cella = (valore, n) => String(valore).padStart(n);
  console.log(`${"Categoria".padEnd(larghezza)}  nodi  way  rel.  totale`);
  for (const riga of righe) {
    const { nodes, ways, relations, total } = riga.tags;
    console.log(
      `${riga.etichetta.padEnd(larghezza)}  ${cella(nodes, 4)}  ${cella(ways, 3)}  ${cella(relations, 4)}  ${cella(total, 6)}`,
    );
  }
}

function presenti(elements) {
  const set = new Set();
  for (const el of elements) {
    if (el.type === "node" || el.type === "way" || el.type === "relation") set.add(`${el.type}/${el.id}`);
  }
  return set;
}

function stampaOggetti(titolo, oggetti, trovati) {
  console.log(titolo);
  const mancanti = [];
  for (const ogg of oggetti) {
    const trovato = trovati.has(ogg.osm);
    console.log(`  ${ogg.osm.padEnd(20)} ${trovato ? "presente" : "ASSENTE "}  ${ogg.nome}`);
    if (!trovato) mancanti.push(ogg.osm);
  }
  return mancanti;
}

async function main() {
  richiediNode24();
  caricaEnv();
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    aiuto();
    return;
  }
  const config = leggiConfig();
  if (args.list) {
    stampaElenco(config);
    return;
  }

  const areaId = args.area ?? (process.env.OSM_AREA?.trim() || "centro-storico");
  const area = config.aree.find((a) => a.id === areaId);
  if (!area) {
    throw new ErrorePrevisto(
      `Area sconosciuta: ${areaId}. Aree: ${config.aree.map((a) => a.id).join(", ")}.`,
    );
  }

  const oggetti = config.landmark.map((lm) => ({ ...analizzaOsm(lm.osm, lm.nome), osm: lm.osm, nome: lm.nome }));
  const impianto = config.monteLivata?.impiantoAttivo;
  if (impianto?.osm) {
    oggetti.push({ ...analizzaOsm(impianto.osm, impianto.nome), osm: impianto.osm, nome: impianto.nome });
  }

  const timeout = timeoutSecondi();
  const query = queryOverpass(area.bbox, oggetti, timeout);
  console.log("Subiaco Isometrica — verifica OSM");
  console.log(`Area: ${area.id} — ${area.nome}`);
  console.log(`BBox (S, W, N, E): ${formattaBbox(area.bbox)}`);
  console.log("Query: out count + out ids (nessuna geometria, nessun file scritto)");

  const { json, host } = await interrogaOverpass(query, { timeoutSec: timeout });
  const elements = json.elements;
  if (!Array.isArray(elements)) throw new ErrorePrevisto(`Risposta Overpass senza elenco elementi (${host}).`);

  console.log(`Endpoint: ${host}`);
  if (json.osm3s?.timestamp_osm_base) console.log(`Snapshot OSM: ${json.osm3s.timestamp_osm_base}`);
  console.log("Dati © contributori OpenStreetMap (ODbL).");
  console.log("");
  stampaConteggi(elements);
  console.log("");

  const trovati = presenti(elements);
  const mancanti = stampaOggetti("Landmark", config.landmark, trovati);
  if (impianto?.osm) {
    console.log("Impianto attivo a Monte Livata");
    const stato = trovati.has(impianto.osm) ? "presente" : "ASSENTE ";
    console.log(`  ${impianto.osm.padEnd(20)} ${stato}  ${impianto.nome}`);
    if (!trovati.has(impianto.osm)) mancanti.push(impianto.osm);
  }
  const pista = config.monteLivata?.pistaPrioritaria;
  if (pista) {
    console.log(`Pista prioritaria: ${pista.nome} — ${pista.osm ?? "non mappata in OSM"}.`);
    if (pista.note) console.log(`  ${pista.note}`);
  }
  if (area.note?.length) {
    console.log("Note:");
    for (const nota of area.note) console.log(`  - ${nota}`);
  }
  if (mancanti.length) {
    throw new ErrorePrevisto(`Oggetti OSM assenti: ${mancanti.join(", ")}.`);
  }
}

main().catch((err) => {
  console.error(err instanceof ErrorePrevisto ? err.message : err.stack || err.message);
  process.exit(1);
});
