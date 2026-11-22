/**
 * Carica data/web/regions/<regione>/ su Cloudflare R2 (API S3).
 * Le credenziali stanno solo in .env. Senza, il comando fallisce;
 * con --dry-run elenca i file e non apre connessioni.
 * Copyright (c) 2026 NVerlini
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ROOT, caricaEnv, leggiPipeline, richiediNode24 } from "../pipeline/src/config.mjs";
import { ErrorePrevisto } from "../pipeline/src/overpass.mjs";
import { richiestaR2 } from "./s3.mjs";

export const VARIABILI_R2 = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
  "TILES_PUBLIC_URL",
];

const MANIFEST = ".publish-manifest.json";

export function variabiliMancanti(env = process.env) {
  return VARIABILI_R2.filter((chiave) => !String(env[chiave] ?? "").trim());
}

export function tipoContenuto(relativo) {
  switch (path.posix.extname(relativo).toLowerCase()) {
    case ".avif": return "image/avif";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".json": return "application/json; charset=utf-8";
    case ".png": return "image/png";
    case ".webp": return "image/webp";
    case ".svg": return "image/svg+xml";
    default: return "application/octet-stream";
  }
}

/** Le tile hanno l'hash nell'URL (?v=) e si tengono un anno. I JSON si riscrivono sul posto. */
export function cacheDi(relativo) {
  const nome = path.posix.basename(relativo);
  if (nome === "world.json" || nome === "tiles-photo.json" || nome === "report.json") {
    return "public, max-age=300, must-revalidate";
  }
  const ext = path.posix.extname(nome).toLowerCase();
  if (ext === ".avif" || ext === ".jpg" || ext === ".jpeg" || ext === ".png" || ext === ".webp") {
    return "public, max-age=31536000, immutable";
  }
  if (ext === ".json") return "public, max-age=300, must-revalidate";
  return "public, max-age=3600";
}

export function normalizzaUrlPubblico(url, { obbligatorio }) {
  const testo = String(url ?? "").trim();
  if (!testo) {
    if (obbligatorio) {
      throw new ErrorePrevisto("Manca TILES_PUBLIC_URL. È l'URL pubblico del bucket, solo https, senza credenziali.");
    }
    return "";
  }
  let parsed;
  try {
    parsed = new URL(testo);
  } catch {
    throw new ErrorePrevisto(`TILES_PUBLIC_URL non è un indirizzo valido: ${testo}`);
  }
  if (parsed.protocol !== "https:") {
    throw new ErrorePrevisto("TILES_PUBLIC_URL deve usare https.");
  }
  if (parsed.username || parsed.password) {
    throw new ErrorePrevisto("TILES_PUBLIC_URL non deve contenere utente o password.");
  }
  return testo.replace(/\/+$/, "");
}

export function prefissoDaUrl(url) {
  if (!url) return "";
  return new URL(url).pathname.replace(/^\/+|\/+$/g, "");
}

export function chiaveOggetto(prefisso, relativo) {
  const rel = String(relativo).split(path.sep).join("/");
  const pre = String(prefisso || "").replace(/^\/+|\/+$/g, "");
  if (rel.startsWith("/") || rel.includes("..")) {
    throw new ErrorePrevisto(`Percorso tile non valido: ${relativo}`);
  }
  return pre ? `${pre}/${rel}` : rel;
}

export function elencaRelativi(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  const visita = (corrente) => {
    for (const voce of readdirSync(corrente, { withFileTypes: true })) {
      if (voce.name.startsWith(".")) continue;
      const pieno = path.join(corrente, voce.name);
      if (voce.isSymbolicLink()) continue;
      if (voce.isDirectory()) visita(pieno);
      else if (voce.isFile()) out.push(path.relative(dir, pieno).split(path.sep).join("/"));
    }
  };
  visita(dir);
  return out.sort();
}

export function improntaFile(cartella, relativo) {
  const buf = readFileSync(path.join(cartella, relativo));
  return {
    relativo,
    byte: buf.length,
    sha256: createHash("sha256").update(buf).digest("hex"),
  };
}

export function leggiManifest(file) {
  if (!existsSync(file)) return { versione: 1, file: {} };
  const json = JSON.parse(readFileSync(file, "utf8"));
  return { versione: 1, file: {}, ...json, file: json.file ?? {} };
}

/** true se il file va rimandato. Il manifest locale evita di ricaricare byte identici. */
export function vaCaricato(file, manifest, dest) {
  const prec = manifest?.file?.[file.relativo];
  if (!prec || prec.sha256 !== file.sha256 || prec.byte !== file.byte) return true;
  if (dest.bucket && manifest.bucket && manifest.bucket !== dest.bucket) return true;
  if (typeof manifest.prefisso === "string" && manifest.prefisso !== dest.prefisso) return true;
  return false;
}

export function xmlCors() {
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<CORSConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">`,
    `  <CORSRule>`,
    `    <AllowedOrigin>*</AllowedOrigin>`,
    `    <AllowedMethod>GET</AllowedMethod>`,
    `    <AllowedMethod>HEAD</AllowedMethod>`,
    `    <AllowedHeader>*</AllowedHeader>`,
    `    <MaxAgeSeconds>86400</MaxAgeSeconds>`,
    `  </CORSRule>`,
    `</CORSConfiguration>`,
  ].join("\n");
}

export function argomenti(argv) {
  const out = { dryRun: false, help: false, area: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") out.dryRun = true;
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
  npm run publish:tiles -- --dry-run
  npm run publish:tiles
  npm run publish:tiles -- subiaco

Carica data/web/regions/<regione>/ sul bucket R2. La regione predefinita è quella di config/pipeline.json (subiaco).
Salta i file il cui SHA-256 è già nel manifest locale ${MANIFEST}.
Senza le variabili in .env il comando si ferma. Con --dry-run non contatta R2.

Variabili (vuote in .env.example): ${VARIABILI_R2.join(", ")}.`);
}

function messaggioCredenziali(mancanti) {
  return [
    `Mancano le variabili R2 nel file .env: ${mancanti.join(", ")}.`,
    "Sono R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET e TILES_PUBLIC_URL.",
    "Vanno solo in .env, mai nel repository. Per una prova senza rete: npm run publish:tiles -- --dry-run",
  ].join(" ");
}

async function leggiErrore(risposta) {
  try {
    return (await risposta.text()).slice(0, 300);
  } catch {
    return "";
  }
}

export async function esegui(argv = [], dipendenze = {}) {
  if (!dipendenze.env) caricaEnv();
  const env = dipendenze.env ?? process.env;
  const fetchImpl = dipendenze.fetchImpl ?? fetch;
  const opt = argomenti(argv);
  if (opt.help) {
    aiuto();
    return { aiuto: true };
  }
  const pipeline = dipendenze.pipeline ?? leggiPipeline();
  const area = opt.area || pipeline.regione.id;
  const root = dipendenze.root ?? ROOT;
  const cartella = path.join(root, "data", "web", "regions", area);
  if (!existsSync(cartella)) {
    throw new ErrorePrevisto(
      `Manca ${path.relative(root, cartella) || cartella}. Esegui npm run export: la piramide sta in data/web/regions/${pipeline.regione.id}/.`,
    );
  }
  for (const relativo of ["data/world.json", "data/tiles-photo.json"]) {
    if (!existsSync(path.join(cartella, relativo))) {
      throw new ErrorePrevisto(`Manca ${relativo} in data/web/regions/${area}/. Esegui npm run export.`);
    }
  }
  const mancanti = variabiliMancanti(env);
  if (!opt.dryRun && mancanti.length) throw new ErrorePrevisto(messaggioCredenziali(mancanti));
  const urlPubblico = normalizzaUrlPubblico(env.TILES_PUBLIC_URL, { obbligatorio: !opt.dryRun });
  const prefisso = prefissoDaUrl(urlPubblico);
  const bucket = String(env.R2_BUCKET ?? "").trim();
  const manifestFile = path.join(cartella, MANIFEST);
  const manifest = leggiManifest(manifestFile);
  const dest = { bucket, prefisso };
  const descritti = elencaRelativi(cartella).map((relativo) => improntaFile(cartella, relativo));
  const daCaricare = descritti.filter((file) => vaCaricato(file, manifest, dest));
  const invariati = descritti.filter((file) => !vaCaricato(file, manifest, dest));
  const byte = daCaricare.reduce((s, file) => s + file.byte, 0);
  const riepilogo = {
    dryRun: opt.dryRun,
    area,
    cartella,
    urlPubblico,
    prefisso,
    totale: descritti.length,
    daCaricare: daCaricare.length,
    invariati: invariati.length,
    byte,
    cors: null,
  };
  console.log(opt.dryRun ? "publish:tiles — dry-run" : "publish:tiles");
  console.log(`Cartella: ${path.relative(root, cartella) || cartella}`);
  console.log(`File: ${descritti.length}. Da caricare: ${daCaricare.length} (${byte} byte). Invariati: ${invariati.length}.`);
  if (urlPubblico) console.log(`URL pubblico: ${urlPubblico}`);
  if (opt.dryRun) {
    for (const file of daCaricare) {
      console.log(`  caricherebbe ${file.relativo}  ${tipoContenuto(file.relativo)}  ${cacheDi(file.relativo)}`);
    }
    console.log("Nessuna richiesta è stata inviata.");
    if (mancanti.length) console.log(`Credenziali assenti (${mancanti.join(", ")}): il dry-run non le richiede.`);
    return riepilogo;
  }

  const accountId = env.R2_ACCOUNT_ID.trim();
  const accessKey = env.R2_ACCESS_KEY_ID.trim();
  const secretKey = env.R2_SECRET_ACCESS_KEY.trim();
  const aggiornati = { ...manifest.file };
  const scrivi = () => {
    const doc = {
      versione: 1,
      bucket,
      prefisso,
      aggiornato: new Date().toISOString(),
      file: aggiornati,
    };
    writeFileSync(manifestFile, JSON.stringify(doc, null, 2));
  };

  try {
    for (const file of daCaricare) {
      const corpo = readFileSync(path.join(cartella, file.relativo));
      const chiave = chiaveOggetto(prefisso, file.relativo);
      const { risposta } = await richiestaR2({
        method: "PUT",
        accountId,
        bucket,
        key: chiave,
        body: corpo,
        contentType: tipoContenuto(file.relativo),
        cacheControl: cacheDi(file.relativo),
        accessKey,
        secretKey,
        fetchImpl,
      });
      if (!risposta.ok) {
        const dettaglio = await leggiErrore(risposta);
        throw new ErrorePrevisto(`Upload fallito per ${chiave} (HTTP ${risposta.status}). ${dettaglio}`.trim());
      }
      aggiornati[file.relativo] = { sha256: file.sha256, byte: file.byte };
      console.log(`  caricato ${chiave}`);
    }
  } finally {
    if (Object.keys(aggiornati).length) {
      mkdirSync(cartella, { recursive: true });
      scrivi();
    }
  }

  const cors = await richiestaR2({
    method: "PUT",
    accountId,
    bucket,
    query: "cors=",
    body: xmlCors(),
    contentType: "application/xml",
    contentMd5: true,
    accessKey,
    secretKey,
    fetchImpl,
  });
  if (cors.risposta.ok) {
    riepilogo.cors = "ok";
    console.log("CORS del bucket: GET e HEAD da qualunque origine, così il viewer legge i JSON.");
  } else {
    riepilogo.cors = "mancato";
    const dettaglio = await leggiErrore(cors.risposta);
    console.log(`CORS non impostato (HTTP ${cors.risposta.status}). ${dettaglio}`.trim());
    console.log("Le tile sono caricate. Imposta il CORS dal pannello R2: GET e HEAD, origine *, header *. Vedi docs/fase5-pubblicazione.md.");
  }
  console.log(daCaricare.length ? "Upload completato. Il sito non è stato pubblicato." : "Niente da caricare. Il sito non è stato pubblicato.");
  return riepilogo;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  Promise.resolve().then(() => {
    richiediNode24();
    return esegui(process.argv.slice(2));
  }).catch((err) => {
    console.error(err instanceof ErrorePrevisto ? err.message : err.stack || err.message);
    process.exit(1);
  });
}
