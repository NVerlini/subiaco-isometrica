/**
 * Confronta gli edifici scaricati da fetch con config/osm-baseline.json
 * e segnala i landmark assenti. Non pubblica e non riscrive la baseline
 * se non si passa --scrivi-baseline.
 * Copyright (c) 2026 NVerlini
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ROOT, caricaEnv, leggiAree, richiediNode24 } from "../pipeline/src/config.mjs";
import { ErrorePrevisto } from "../pipeline/src/overpass.mjs";

export function edificiDaOsm(json) {
  const ids = [];
  for (const el of json?.elements ?? []) {
    const tag = el?.tags?.building;
    if (!tag || tag === "no") continue;
    if (el.type !== "way" && el.type !== "relation" && el.type !== "node") continue;
    if (!Number.isFinite(el.id)) continue;
    ids.push(`${el.type}/${el.id}`);
  }
  return [...new Set(ids)].sort();
}

export function oggettiNoti(config) {
  const lista = config.landmark.map((lm) => ({ id: lm.id, nome: lm.nome, osm: lm.osm }));
  const impianto = config.monteLivata?.impiantoAttivo;
  if (impianto) lista.push({ id: impianto.id, nome: impianto.nome, osm: impianto.osm });
  const pista = config.monteLivata?.pistaPrioritaria;
  if (pista) lista.push({ id: pista.id, nome: pista.nome, osm: pista.osm ?? null });
  return lista;
}

export function confrontaEdifici(riferimento = {}, idsAttuali = []) {
  const prima = Number(riferimento.edifici);
  const dopo = idsAttuali.length;
  const esito = {
    prima: Number.isFinite(prima) ? prima : null,
    dopo,
    delta: Number.isFinite(prima) ? dopo - prima : null,
    aggiunti: null,
    rimossi: null,
  };
  if (Array.isArray(riferimento.ids)) {
    const attesi = new Set(riferimento.ids);
    const nuovi = new Set(idsAttuali);
    esito.aggiunti = idsAttuali.filter((id) => !attesi.has(id));
    esito.rimossi = riferimento.ids.filter((id) => !nuovi.has(id)).sort();
  }
  return esito;
}

export function verificaLandmark(oggetti, presenti) {
  return oggetti.map((ogg) => ({
    ...ogg,
    stato: ogg.osm ? (presenti.has(ogg.osm) ? "presente" : "assente") : "non-mappato",
  }));
}

function elencoBreve(ids, massimo = 25) {
  if (!ids.length) return "nessuno";
  const testa = ids.slice(0, massimo).join(", ");
  const resto = ids.length - massimo;
  return resto > 0 ? `${testa} e altri ${resto}` : testa;
}

export function rapportoMarkdown({ baseline, aree, landmark }) {
  const righe = [
    "# Differenze OSM",
    "",
    "Rapporto di confronto. Non pubblica tile e non aggiorna il sito.",
    `Riferimento edifici: ${baseline.snapshot ?? "sconosciuto"}.`,
    "",
  ];
  for (const area of aree) {
    righe.push(`## ${area.id}`);
    if (area.manca) {
      righe.push("");
      righe.push(`Manca data/raw/${area.id}/osm.json. Lancia \`npm run fetch -- --solo-osm ${area.id}\`.`);
      righe.push("");
      continue;
    }
    const { prima, dopo, delta, aggiunti, rimossi } = area.edifici;
    const segno = delta > 0 ? `+${delta}` : String(delta);
    righe.push("");
    if (prima == null) righe.push(`Edifici nel fetch: ${dopo}. Questa area non è nella baseline.`);
    else righe.push(`Edifici: ${prima} nel riferimento, ${dopo} nel fetch (${segno}).`);
    if (aggiunti == null) {
      righe.push("Elenco degli id non presente nella baseline: si vede il totale, non quali edifici sono entrati o usciti.");
    } else {
      righe.push(`Aggiunti (${aggiunti.length}): ${elencoBreve(aggiunti)}.`);
      righe.push(`Rimossi (${rimossi.length}): ${elencoBreve(rimossi)}.`);
    }
    righe.push("");
  }
  righe.push("## Landmark");
  righe.push("");
  for (const lm of landmark) {
    const osm = lm.osm ?? "senza oggetto OSM";
    righe.push(`- ${lm.nome} (${osm}): ${lm.stato}`);
  }
  righe.push("");
  righe.push("La pista di fondo, finché `osm` è null, resta non mappata: non è una differenza nuova.");
  righe.push("Per aggiornare gli id di riferimento, in locale e dopo aver letto il rapporto: `npm run osm:diff -- --scrivi-baseline`.");
  righe.push("");
  return righe.join("\n");
}

function argomenti(argv) {
  const out = { help: false, scrivi: false, aree: [] };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--scrivi-baseline") out.scrivi = true;
    else if (arg.startsWith("-")) throw new ErrorePrevisto(`Opzione sconosciuta: ${arg}`);
    else out.aree.push(arg);
  }
  return out;
}

function aiuto() {
  console.log(`Uso:
  npm run osm:diff
  npm run osm:diff -- centro-storico
  npm run osm:diff -- --scrivi-baseline

Legge data/raw/<area>/osm.json (dopo npm run fetch) e lo confronta con config/osm-baseline.json.
Segnala totali degli edifici, id aggiunti o rimossi se la baseline li ha, e landmark assenti.
Non carica tile e non parla con Vercel. --scrivi-baseline aggiorna il riferimento in locale: il workflow non lo passa.`);
}

export function analizza({ config, baseline, osmPerArea, aree }) {
  const scelti = aree?.length ? aree : config.aree.map((a) => a.id);
  const noti = new Set(config.aree.map((a) => a.id));
  for (const id of scelti) {
    if (!noti.has(id)) throw new ErrorePrevisto(`Area sconosciuta: ${id}.`);
  }
  const presenti = new Set();
  const reportAree = [];
  for (const id of scelti) {
    const json = osmPerArea[id];
    if (!json) {
      reportAree.push({ id, manca: true, edifici: null });
      continue;
    }
    const ids = edificiDaOsm(json);
    for (const el of json.elements ?? []) {
      if (el?.type && el.id != null) presenti.add(`${el.type}/${el.id}`);
    }
    reportAree.push({
      id,
      manca: false,
      edifici: confrontaEdifici(baseline.aree?.[id], ids),
      ids,
    });
  }
  const landmark = verificaLandmark(oggettiNoti(config), presenti);
  return { aree: reportAree, landmark };
}

export async function esegui(argv = [], dipendenze = {}) {
  if (!dipendenze.env) caricaEnv();
  const opt = argomenti(argv);
  if (opt.help) {
    aiuto();
    return { aiuto: true, codice: 0 };
  }
  const root = dipendenze.root ?? ROOT;
  const config = dipendenze.config ?? leggiAree();
  const baselineFile = path.join(root, "config", "osm-baseline.json");
  if (!existsSync(baselineFile)) throw new ErrorePrevisto("Manca config/osm-baseline.json.");
  const baseline = JSON.parse(readFileSync(baselineFile, "utf8"));
  const scelti = opt.aree.length ? opt.aree : config.aree.map((a) => a.id);
  const osmPerArea = {};
  for (const id of scelti) {
    const file = path.join(root, "data", "raw", id, "osm.json");
    osmPerArea[id] = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
  }
  const analisi = analizza({ config, baseline, osmPerArea, aree: scelti });
  const testo = rapportoMarkdown({ baseline, ...analisi });
  console.log(testo);
  const destinazione = path.join(root, "data", "osm-diff.md");
  mkdirSync(path.dirname(destinazione), { recursive: true });
  writeFileSync(destinazione, testo);
  console.log(`Rapporto scritto in ${path.relative(root, destinazione)}.`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, testo, { flag: "a" });
  }
  if (opt.scrivi) {
    const prossimo = {
      ...baseline,
      aggiornato: new Date().toISOString(),
      fonte: "Aggiornata in locale con npm run osm:diff -- --scrivi-baseline. Il workflow non riscrive questo file.",
      aree: { ...baseline.aree },
    };
    for (const area of analisi.aree) {
      if (area.manca) continue;
      prossimo.aree[area.id] = { edifici: area.ids.length, ids: area.ids };
    }
    writeFileSync(baselineFile, `${JSON.stringify(prossimo, null, 2)}\n`);
    console.log("Baseline aggiornata in config/osm-baseline.json. Va riletta e committata a mano, se le differenze ti tornano.");
  }
  const mancaFile = analisi.aree.some((a) => a.manca);
  const mancaLandmark = analisi.landmark.some((lm) => lm.stato === "assente");
  const codice = mancaFile || mancaLandmark ? 1 : 0;
  return { ...analisi, testo, codice };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  Promise.resolve().then(() => {
    richiediNode24();
    return esegui(process.argv.slice(2));
  }).then((esito) => {
    if (esito && esito.codice) process.exit(esito.codice);
  }).catch((err) => {
    console.error(err instanceof ErrorePrevisto ? err.message : err.stack || err.message);
    process.exit(1);
  });
}
