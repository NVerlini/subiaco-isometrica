/**
 * Build statico del viewer in web/dist.
 * TILES_PUBLIC_URL vuoto: le tile sono sulla stessa origine (percorsi relativi).
 * BASE_PATH è il prefisso di GitHub Pages, per esempio /subiaco-isometrica.
 * npm run dev non usa queste variabili: in locale le tile restano in data/.
 * Copyright (c) 2026 NVerlini
 */

import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";
import { ROOT, caricaEnv, richiediNode24 } from "../pipeline/src/config.mjs";
import { ErrorePrevisto } from "../pipeline/src/overpass.mjs";
import { normalizzaUrlPubblico } from "./publish-tiles.mjs";
import { aggiornaDaData, copiaPiramide, preparaPiramide } from "./tile-sito.mjs";

export function normalizzaBasePath(valore) {
  if (valore == null) return "";
  let testo = String(valore).trim();
  if (!testo || testo === "/") return "";
  if (!testo.startsWith("/")) {
    throw new ErrorePrevisto("BASE_PATH deve essere un percorso che inizia con /.");
  }
  testo = testo.replace(/\/+$/, "");
  if (!/^\/[A-Za-z0-9._/-]+$/.test(testo) || testo.includes("..") || testo.includes("//")) {
    throw new ErrorePrevisto(`BASE_PATH non ammesso: ${valore}`);
  }
  return testo;
}

export function htmlConBase(html, basePath) {
  const href = basePath ? `${basePath}/` : "/";
  let out = html
    .replaceAll('href="/stile.css"', 'href="stile.css"')
    .replaceAll('src="/app.js"', 'src="app.js"');
  if (!out.includes("<base ")) {
    out = out.replace("<head>", `<head>\n  <base href="${href}">`);
  }
  return out;
}

export async function costruisci(opt = {}) {
  if (!opt.env) caricaEnv();
  const env = opt.env ?? process.env;
  const url = normalizzaUrlPubblico(opt.tilesUrl ?? env.TILES_PUBLIC_URL, { obbligatorio: false });
  const basePath = normalizzaBasePath(opt.basePath ?? env.BASE_PATH);
  const root = opt.root ?? ROOT;
  const out = opt.out ?? path.join(root, "web", "dist");
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  await esbuild.build({
    absWorkingDir: root,
    entryPoints: [path.join(root, "web/src/client.mjs")],
    bundle: true,
    format: "esm",
    target: "es2022",
    outfile: path.join(out, "app.js"),
    banner: { js: `globalThis.__TILES_PUBLIC_URL__ = ${JSON.stringify(url)};` },
    logLevel: "silent",
  });
  const html = htmlConBase(readFileSync(path.join(root, "web/public/index.html"), "utf8"), basePath);
  writeFileSync(path.join(out, "index.html"), html);
  writeFileSync(path.join(out, "404.html"), html);
  cpSync(path.join(root, "web/public/stile.css"), path.join(out, "stile.css"));
  writeFileSync(path.join(out, ".nojekyll"), "");
  return { out, url, basePath };
}

export async function completaSito(opt = {}) {
  if (opt.aggiornaTile) await aggiornaDaData({ root: opt.root ?? ROOT });
  const fatto = await costruisci(opt);
  if (opt.conTile === false) return fatto;
  const piramide = await preparaPiramide({ root: opt.root ?? ROOT });
  copiaPiramide(piramide.dir, fatto.out);
  return { ...fatto, piramide };
}

async function main() {
  richiediNode24();
  const aggiornaTile = process.argv.includes("--aggiorna-tile");
  const { out, url, basePath, piramide } = await completaSito({ aggiornaTile });
  console.log(`Build del viewer in ${path.relative(ROOT, out) || out}`);
  if (basePath) console.log(`Base path: ${basePath}`);
  else console.log("Base path vuoto: il sito è alla radice dell'origine.");
  if (url) console.log(`Tile: ${url}`);
  else console.log("TILES_PUBLIC_URL è vuoto: le tile sono sulla stessa origine del sito.");
  const mb = (piramide.byte / (1024 * 1024)).toFixed(2);
  console.log(`Piramide ${piramide.fonte}: ${mb} MB (${piramide.byte} byte).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof ErrorePrevisto ? err.message : err.stack || err.message);
    process.exit(1);
  });
}
