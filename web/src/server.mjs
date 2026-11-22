/**
 * Server locale del viewer. Legge la piramide in data/web se c'è
 * (dipinta se world.json lo dice, altrimenti il render) e se no genera lo schema.
 * Copyright (c) 2026 NVerlini
 */

import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";
import sharp from "sharp";
import { ROOT } from "../../pipeline/src/config.mjs";
import { generaDemo } from "./demo.mjs";

const QUI = path.dirname(fileURLToPath(import.meta.url));
const PUBBLICO = path.join(QUI, "../public");
const TIPI = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".avif": "image/avif",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
};

export function trovaPiramide(root = ROOT) {
  const base = path.join(root, "data", "web", "regions", "subiaco");
  const worldFile = path.join(base, "data", "world.json");
  const indiceFile = path.join(base, "data", "tiles-photo.json");
  if (!existsSync(worldFile) || !existsSync(indiceFile)) return null;
  const world = JSON.parse(readFileSync(worldFile, "utf8"));
  if (world.demo) return null;
  const indice = JSON.parse(readFileSync(indiceFile, "utf8"));
  const n = Object.values(indice).reduce((s, livello) => s + Object.keys(livello || {}).length, 0);
  if (!n) return null;
  return {
    base,
    world,
    indice,
    fonte: world.dipinte ? "dipinta" : "render",
  };
}

async function bundle() {
  const built = await esbuild.build({
    absWorkingDir: ROOT,
    entryPoints: [path.join(QUI, "client.mjs")],
    bundle: true,
    format: "esm",
    target: "es2022",
    write: false,
    logLevel: "silent",
  });
  return built.outputFiles[0].text;
}

function invia(res, status, body, tipo, extra = {}) {
  res.writeHead(status, {
    "content-type": tipo,
    "cache-control": "no-store",
    ...extra,
  });
  res.end(body);
}

export async function creaServer(opt = {}) {
  const root = opt.root ?? ROOT;
  let piramide = opt.forzaDemo ? null : trovaPiramide(root);
  if (!piramide) {
    const dest = opt.demoDir ?? path.join(root, "data", "web", "regions", "subiaco-demo");
    const gia = path.join(dest, "data", "world.json");
    if (!opt.rigenera && existsSync(gia)) {
      piramide = {
        base: dest,
        world: JSON.parse(readFileSync(gia, "utf8")),
        indice: JSON.parse(readFileSync(path.join(dest, "data", "tiles-photo.json"), "utf8")),
        fonte: "demo",
      };
    } else {
      const demo = await generaDemo(dest);
      piramide = { base: dest, world: demo.world, indice: demo.indice, fonte: "demo", byte: demo.byte };
    }
  }
  const appJs = opt.appJs ?? await bundle();
  const jpgCache = new Map();

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      if (req.method !== "GET" && req.method !== "HEAD") {
        invia(res, 405, "metodo non ammesso", "text/plain; charset=utf-8");
        return;
      }
      if (url.pathname === "/" || url.pathname === "/index.html") {
        invia(res, 200, readFileSync(path.join(PUBBLICO, "index.html")), TIPI[".html"]);
        return;
      }
      if (url.pathname === "/stile.css") {
        invia(res, 200, readFileSync(path.join(PUBBLICO, "stile.css")), TIPI[".css"]);
        return;
      }
      if (url.pathname === "/app.js") {
        invia(res, 200, appJs, TIPI[".js"]);
        return;
      }
      if (url.pathname === "/data/world.json") {
        invia(res, 200, JSON.stringify(piramide.world), TIPI[".json"]);
        return;
      }
      if (url.pathname === "/data/tiles-photo.json") {
        invia(res, 200, JSON.stringify(piramide.indice), TIPI[".json"]);
        return;
      }
      const tile = url.pathname.match(/^\/tiles\/photo\/(\d+)\/(-?\d+)\/(-?\d+)\.(avif|jpg)$/);
      if (tile) {
        const [, z, x, y, ext] = tile;
        const dir = path.join(piramide.base, "tiles", "photo", z, x);
        const avif = path.join(dir, `${y}.avif`);
        const jpg = path.join(dir, `${y}.jpg`);
        const scelto = path.resolve(ext === "jpg" ? jpg : avif);
        if (!scelto.startsWith(path.resolve(piramide.base) + path.sep)) {
          invia(res, 400, "percorso non valido", "text/plain; charset=utf-8");
          return;
        }
        if (ext === "avif" && existsSync(avif)) {
          invia(res, 200, readFileSync(avif), TIPI[".avif"]);
          return;
        }
        if (ext === "jpg" && existsSync(jpg)) {
          invia(res, 200, readFileSync(jpg), TIPI[".jpg"]);
          return;
        }
        if (ext === "jpg" && existsSync(avif)) {
          const chiave = `${z}/${x}/${y}`;
          if (!jpgCache.has(chiave)) {
            jpgCache.set(chiave, await sharp(avif).jpeg({ quality: 70 }).toBuffer());
          }
          invia(res, 200, jpgCache.get(chiave), TIPI[".jpg"]);
          return;
        }
        invia(res, 404, "tile assente", "text/plain; charset=utf-8");
        return;
      }
      invia(res, 404, "non trovato", "text/plain; charset=utf-8");
    } catch (err) {
      invia(res, 500, err.message || "errore", "text/plain; charset=utf-8");
    }
  });
  server.piramide = piramide;
  return server;
}

export function ascolta(server, porta = 0) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(porta, "127.0.0.1", () => {
      resolve(server.address().port);
    });
  });
}

export async function avvia(argv = []) {
  let porta = Number(process.env.PORT || 4321);
  let forzaDemo = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--demo") forzaDemo = true;
    else if (arg === "--porta") porta = Number(argv[++i]);
    else if (arg === "--help" || arg === "-h") {
      console.log("Uso: npm run dev [-- --porta 4321] [--demo]\nServe il viewer. Se manca la piramide in data/web/regions/subiaco genera uno schema leggero.");
      return;
    } else {
      throw new Error(`Opzione sconosciuta: ${arg}`);
    }
  }
  const server = await creaServer({ forzaDemo });
  const effettiva = await ascolta(server, porta);
  const { fonte, byte } = server.piramide;
  const peso = byte ? `, schema ${Math.round(byte / 1024)} KB` : "";
  console.log(`viewer su http://127.0.0.1:${effettiva}/  (${fonte}${peso})`);
  console.log("Trascina per spostare, rotella per lo zoom. Ctrl+C per chiudere.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  avvia(process.argv.slice(2)).catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
