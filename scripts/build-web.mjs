/**
 * Build statico del viewer in web/dist.
 * TILES_PUBLIC_URL, se c'è, viene scritto nel bundle. npm run dev non lo usa:
 * in locale le tile restano in data/.
 * Copyright (c) 2026 NVerlini
 */

import { cpSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";
import { ROOT, caricaEnv, richiediNode24 } from "../pipeline/src/config.mjs";
import { ErrorePrevisto } from "../pipeline/src/overpass.mjs";
import { normalizzaUrlPubblico } from "./publish-tiles.mjs";

export async function costruisci(opt = {}) {
  if (!opt.env) caricaEnv();
  const env = opt.env ?? process.env;
  const url = normalizzaUrlPubblico(opt.tilesUrl ?? env.TILES_PUBLIC_URL, { obbligatorio: false });
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
  cpSync(path.join(root, "web/public/index.html"), path.join(out, "index.html"));
  cpSync(path.join(root, "web/public/stile.css"), path.join(out, "stile.css"));
  return { out, url };
}

async function main() {
  richiediNode24();
  const { out, url } = await costruisci();
  console.log(`Build del viewer in ${path.relative(ROOT, out) || out}`);
  if (url) console.log(`Tile: ${url}`);
  else {
    console.log("TILES_PUBLIC_URL è vuoto: il bundle non punta a R2.");
    console.log("In locale npm run dev legge data/. Su Vercel imposta la variabile e rifai il build.");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof ErrorePrevisto ? err.message : err.stack || err.message);
    process.exit(1);
  });
}
