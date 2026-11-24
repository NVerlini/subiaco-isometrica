/**
 * Piramide che viaggia con il sito: la cartella versionata, oppure
 * le PNG dipinte da 1024 px se ci sono. Niente DBGT, DEM o Chromium.
 * Copyright (c) 2026 NVerlini
 */

import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { DATA, ROOT, leggiAree, leggiPipeline } from "../pipeline/src/config.mjs";
import { esportaArea } from "../pipeline/src/export.mjs";
import { ErrorePrevisto } from "../pipeline/src/overpass.mjs";

export const LIMITE_BYTE = 50 * 1024 * 1024;
export const REL_DIPINTE = path.join("tiles", "dipinte", "centro-storico");
export const REL_VERSIONE = path.join("web", "tiles", "centro-storico");

export function elencoPngDipinte(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((nome) => /^-?\d+_-?\d+\.png$/.test(nome)).sort();
}

export async function verificaPng1024(dir, nomi) {
  for (const nome of nomi) {
    const meta = await sharp(path.join(dir, nome)).metadata();
    if (meta.width !== 1024 || meta.height !== 1024) {
      throw new ErrorePrevisto(
        `${nome} è ${meta.width ?? "?"}×${meta.height ?? "?"}. Servono PNG da 1024 px, con il nome delle tile di render (per esempio -1_-2.png).`,
      );
    }
  }
}

export function bytePiramide(dir) {
  let totale = 0;
  const visita = (corrente) => {
    for (const nome of readdirSync(corrente)) {
      const pieno = path.join(corrente, nome);
      const st = statSync(pieno);
      if (st.isDirectory()) visita(pieno);
      else totale += st.size;
    }
  };
  if (existsSync(dir)) visita(dir);
  return totale;
}

export function controllaLimite(byte) {
  if (byte > LIMITE_BYTE) {
    const mb = (byte / (1024 * 1024)).toFixed(1);
    throw new ErrorePrevisto(`La piramide pesa ${mb} MB, sopra i 50 MB previsti per GitHub Pages.`);
  }
  return byte;
}

export async function aggiungiJpeg(radice) {
  const photo = path.join(radice, "tiles", "photo");
  if (!existsSync(photo)) throw new ErrorePrevisto(`Manca ${photo}.`);
  const visita = async (corrente) => {
    for (const nome of readdirSync(corrente)) {
      const pieno = path.join(corrente, nome);
      if (statSync(pieno).isDirectory()) {
        await visita(pieno);
        continue;
      }
      if (!nome.endsWith(".avif")) continue;
      const jpg = pieno.replace(/\.avif$/, ".jpg");
      if (existsSync(jpg)) continue;
      await sharp(pieno).jpeg({ quality: 60 }).toFile(jpg);
    }
  };
  await visita(photo);
}

export function copiaPiramide(da, verso) {
  for (const nome of ["data", "tiles"]) {
    const src = path.join(da, nome);
    if (!existsSync(src)) throw new ErrorePrevisto(`Nella piramide manca ${nome}/ (${da}).`);
    cpSync(src, path.join(verso, nome), { recursive: true });
  }
}

async function daPngDipinte(dir, dest) {
  const nomi = elencoPngDipinte(dir);
  await verificaPng1024(dir, nomi);
  const aree = leggiAree();
  const area = aree.aree.find((a) => a.id === "centro-storico");
  if (!area) throw new ErrorePrevisto("config/areas.json non ha centro-storico.");
  rmSync(dest, { recursive: true, force: true });
  await esportaArea(area, leggiPipeline(), { dipinte: true, cartella: dir, out: dest });
  await aggiungiJpeg(dest);
  return dest;
}

export async function preparaPiramide(opt = {}) {
  const root = opt.root ?? ROOT;
  const dipinteDir = opt.dipinteDir ?? path.join(root, REL_DIPINTE);
  const versioneDir = opt.versioneDir ?? path.join(root, REL_VERSIONE);
  const nomi = elencoPngDipinte(dipinteDir);
  if (nomi.length) {
    const dest = opt.destDipinte ?? mkdtempSync(path.join(tmpdir(), "subiaco-piramide-"));
    await daPngDipinte(dipinteDir, dest);
    const byte = controllaLimite(bytePiramide(dest));
    return { dir: dest, fonte: "dipinte", byte, png: nomi.length };
  }
  const world = path.join(versioneDir, "data", "world.json");
  if (!existsSync(world)) {
    throw new ErrorePrevisto(
      "Manca la piramide in web/tiles/centro-storico/. Rigenera lo schema oppure aggiungi le PNG in tiles/dipinte/centro-storico/.",
    );
  }
  const byte = controllaLimite(bytePiramide(versioneDir));
  return { dir: versioneDir, fonte: "versionata", byte, png: 0 };
}

export async function aggiornaDaData(opt = {}) {
  const root = opt.root ?? ROOT;
  const src = opt.src ?? path.join(DATA, "web", "regions", "subiaco");
  const worldFile = path.join(src, "data", "world.json");
  if (!existsSync(worldFile)) {
    throw new ErrorePrevisto("Manca data/web/regions/subiaco/. Prima npm run export, o npm run export -- --dipinte.");
  }
  const world = JSON.parse(readFileSync(worldFile, "utf8"));
  if (world.demo) throw new ErrorePrevisto("La piramide in data/ è lo schema, non il render. Non sostituisco web/tiles/.");
  const dest = opt.dest ?? path.join(root, REL_VERSIONE);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  copiaPiramide(src, dest);
  await aggiungiJpeg(dest);
  const byte = controllaLimite(bytePiramide(dest));
  return { dest, byte, dipinte: Boolean(world.dipinte) };
}
