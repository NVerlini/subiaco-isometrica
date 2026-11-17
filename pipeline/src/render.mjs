/**
 * Render isometrico a tile, Chromium headless.
 * Adattato da pipeline/src/render.ts di isometricworld e Mondo Isometrico (MIT).
 * Copyright (c) 2026 Dmytro Krasun
 * Copyright (c) 2026 Domenico Gagliardi
 * Copyright (c) 2026 NVerlini
 *
 *   npm run render
 *   npm run render -- centro-storico --finestra rocca-ponte
 *   npm run render -- centro-storico --only -2,-1
 *   npm run render -- --anteprima --heading 0,30,45,315
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import esbuild from "esbuild";
import sharp from "sharp";
import {
  DERIVED,
  ROOT,
  areaPerId,
  caricaEnv,
  cartellaDerived,
  leggiAree,
  leggiPipeline,
  richiediNode24,
} from "./config.mjs";
import { STILE, cameraTile, centroide, codificaQuota, creaQuadro, decodificaQuota, tileCoperte } from "./geo.mjs";
import { ErrorePrevisto } from "./overpass.mjs";

const CIELO = { r: 0xb7, g: 0xc9, b: 0xd6 };
const FINESTRE = {
  "rocca-ponte": [41.923, 13.0865, 41.9278, 13.0972],
};

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidati = [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/local/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  for (const file of candidati) if (existsSync(file)) return file;
  throw new ErrorePrevisto("Manca Chromium. Imposta CHROME_PATH (playwright-core non scarica un browser).");
}

function analizza(argv) {
  const opt = {
    anteprima: false,
    force: false,
    ids: [],
    only: null,
    finestra: null,
    bbox: null,
    heading: null,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") opt.help = true;
    else if (arg === "--anteprima") opt.anteprima = true;
    else if (arg === "--force") opt.force = true;
    else if (arg === "--only") opt.only = argv[++i];
    else if (arg === "--finestra") opt.finestra = argv[++i];
    else if (arg === "--bbox") opt.bbox = argv[++i];
    else if (arg === "--heading") opt.heading = argv[++i];
    else if (arg.startsWith("-")) throw new ErrorePrevisto(`Opzione sconosciuta: ${arg}`);
    else opt.ids.push(arg);
  }
  return opt;
}

function bboxDi(opt, area) {
  if (opt.finestra) {
    const box = FINESTRE[opt.finestra];
    if (!box) throw new ErrorePrevisto(`Finestra sconosciuta: ${opt.finestra}. Note: ${Object.keys(FINESTRE).join(", ")}.`);
    return box;
  }
  if (opt.bbox) {
    const parti = opt.bbox.split(",").map(Number);
    if (parti.length !== 4 || parti.some((n) => !Number.isFinite(n))) {
      throw new ErrorePrevisto("bbox attesa: sud,ovest,nord,est");
    }
    return parti;
  }
  return area.bbox;
}

function regioneCon(pipeline, heading) {
  return { ...pipeline.regione, headingDeg: heading ?? pipeline.regione.headingDeg };
}

function tileArea(area, bbox, regione, meta) {
  const quadro = creaQuadro(regione);
  const [s, w, n, e] = bbox;
  const angoli = [[w, s], [e, s], [e, n], [w, n]];
  const quote = [meta.quotaMin, meta.quotaMax];
  const punti = [];
  for (const q of quote) {
    for (const [lon, lat] of angoli) {
      const [ee, nn, u] = quadro.daLonLat(lon, lat, q + regione.geoidM);
      punti.push(quadro.pixel(ee, nn, u));
      punti.push(quadro.pixel(ee, nn, u + 70));
    }
  }
  let tiles = tileCoperte(punti);
  if (!tiles.length) throw new ErrorePrevisto(`Nessuna tile per ${area.id}.`);
  return tiles.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}

async function costruisciPagina() {
  const dist = path.join(ROOT, "pipeline", "page", "dist");
  mkdirSync(dist, { recursive: true });
  await esbuild.build({
    entryPoints: [path.join(ROOT, "pipeline", "page", "renderer.js")],
    bundle: true,
    format: "esm",
    target: "es2022",
    outfile: path.join(dist, "renderer.js"),
    logLevel: "warning",
  });
  writeFileSync(
    path.join(dist, "index.html"),
    "<!doctype html><meta charset=\"utf-8\"><body style=\"margin:0;background:#000\"><script type=\"module\" src=\"/renderer.js\"></script></body>",
  );
  return dist;
}

async function apriPagina(browser, dist, areaId, heading, ss = 1) {
  const pagina = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  const groundDir = path.join(DERIVED, areaId, "ground");
  const sceneDir = path.join(DERIVED, areaId, "scene");
  await pagina.route("http://iso.local/**", (route) => {
    const nome = new URL(route.request().url()).pathname;
    let file = path.join(dist, nome === "/" ? "index.html" : nome.slice(1));
    if (nome.startsWith("/ground/")) file = path.join(groundDir, nome.slice("/ground/".length));
    else if (nome.startsWith("/scene/")) file = path.join(sceneDir, nome.slice("/scene/".length));
    else if (nome.startsWith("/config/")) file = path.join(ROOT, "config", nome.slice("/config/".length));
    if (!existsSync(file)) return route.fulfill({ status: 404, body: nome });
    const tipo = file.endsWith(".js")
      ? "text/javascript"
      : file.endsWith(".json")
        ? "application/json"
        : file.endsWith(".bin")
          ? "application/octet-stream"
          : "text/html";
    return route.fulfill({ body: readFileSync(file), contentType: tipo });
  });
  pagina.on("pageerror", (err) => console.error("  [pagina]", err.message));
  pagina.on("console", (msg) => {
    if (msg.type() === "error") console.error("  [console]", msg.text());
  });
  await pagina.goto(`http://iso.local/?heading=${heading}&ss=${ss}`);
  await pagina.waitForFunction(() => window.ready === true, null, { timeout: 120_000 });
  return pagina;
}

async function lancia() {
  const args = [
    "--ignore-gpu-blocklist",
    "--enable-unsafe-swiftshader",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--disable-dev-shm-usage",
    "--no-sandbox",
  ];
  if (process.env.CHROME_ARGS) args.push(...process.env.CHROME_ARGS.split(/\s+/).filter(Boolean));
  return chromium.launch({ executablePath: chromePath(), headless: true, args });
}

function inquadratura(bbox, regione, meta, scena) {
  const quadro = creaQuadro(regione);
  const [s, w, n, e] = bbox;
  const punti = [];
  for (const q of [meta.quotaMin, meta.quotaMax]) {
    for (const [lon, lat] of [[w, s], [e, s], [e, n], [w, n]]) {
      const [ee, nn, u] = quadro.daLonLat(lon, lat, q + regione.geoidM);
      punti.push(quadro.pixel(ee, nn, u));
      punti.push(quadro.pixel(ee, nn, u + 50));
    }
  }
  for (const ed of scena.edifici ?? []) {
    for (const parte of ed.parti ?? [{ anello: ed.anello, altezzaM: ed.altezzaM }]) {
      const c = centroide(parte.anello);
      const [ee, nn] = quadro.piano(c[0], c[1]);
      const u = quadro.suOrtometrico(ee, nn, ed.suoloM ?? meta.quotaMin) + parte.altezzaM;
      punti.push(quadro.pixel(ee, nn, u));
    }
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of punti) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const margine = 48;
  minX -= margine;
  minY -= margine;
  maxX += margine;
  maxY += margine;
  const scala = Math.min(1200 / (maxX - minX), 860 / (maxY - minY));
  return {
    x0: minX,
    y0: minY,
    x1: maxX,
    y1: maxY,
    w: Math.max(64, Math.round((maxX - minX) * scala)),
    h: Math.max(64, Math.round((maxY - minY) * scala)),
  };
}

async function scriviPngDataUrl(dataUrl, file) {
  const b64 = dataUrl.split(",")[1];
  await sharp(Buffer.from(b64, "base64"))
    .resize(STILE.tile, STILE.tile, { kernel: "lanczos3" })
    .png({ compressionLevel: 9 })
    .toFile(file);
}

async function anteprime(area, pipeline, meta, headings) {
  const scena = JSON.parse(readFileSync(path.join(DERIVED, area.id, "scene", "scene.json"), "utf8"));
  const dir = path.join(DERIVED, area.id, "heading");
  mkdirSync(dir, { recursive: true });
  const dist = await costruisciPagina();
  const browser = await lancia();
  const pagina = await apriPagina(browser, dist, area.id, headings[0], 1);
  const file = [];
  for (const heading of headings) {
    const regione = regioneCon(pipeline, heading);
    const quadro = inquadratura(area.bbox, regione, meta, scena);
    const t0 = Date.now();
    const r = await pagina.evaluate((spec) => window.renderQuadro(spec), { ...quadro, heading });
    const nome = path.join(dir, `h${String(heading).replace("-", "m").padStart(3, "0")}.jpg`);
    await sharp(Buffer.from(r.color.split(",")[1], "base64")).jpeg({ quality: 72 }).toFile(nome);
    file.push({ heading, nome, secondi: (Date.now() - t0) / 1000, w: r.w, h: r.h });
    console.log(`  heading ${heading}°: ${file.at(-1).secondi.toFixed(1)} s → ${nome}`);
  }
  await pagina.context().close();
  await browser.close();
  const foglio = await foglioContatto(file, path.join(dir, "confronto.jpg"));
  return { file, foglio };
}

async function foglioContatto(voci, destinazione) {
  const cella = 460;
  const colonne = Math.min(3, voci.length);
  const righe = Math.ceil(voci.length / colonne);
  const label = 28;
  const w = colonne * cella;
  const h = righe * (cella + label);
  const layers = [];
  for (let i = 0; i < voci.length; i++) {
    const col = i % colonne;
    const row = Math.floor(i / colonne);
    const img = await sharp(voci[i].nome).resize(cella, cella, { fit: "contain", background: CIELO }).jpeg().toBuffer();
    layers.push({ input: img, left: col * cella, top: row * (cella + label) + label });
    const svg = Buffer.from(
      `<svg width="${cella}" height="${label}"><rect width="100%" height="100%" fill="#1c1a18"/><text x="12" y="19" fill="#f4efe6" font-size="16" font-family="sans-serif">heading ${voci[i].heading}°</text></svg>`,
    );
    layers.push({ input: svg, left: col * cella, top: row * (cella + label) });
  }
  await sharp({ create: { width: w, height: h, channels: 3, background: CIELO } })
    .composite(layers)
    .jpeg({ quality: 68 })
    .toFile(destinazione);
  return destinazione;
}

async function verificaTile(file, regione) {
  const meta = await sharp(file).metadata();
  if (meta.width !== STILE.tile || meta.height !== STILE.tile) {
    throw new ErrorePrevisto(`${path.basename(file)} è ${meta.width}×${meta.height}, attesi ${STILE.tile}.`);
  }
  const stats = await sharp(file).stats();
  const variazione = stats.channels.reduce((s, c) => s + c.stdev, 0);
  return { variazione: Math.round(variazione * 10) / 10, nonVuota: variazione > 4 };
}

async function verificaAltezze(file, regione) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== 256 || info.height !== 256) {
    throw new ErrorePrevisto(`Pass altezze ${info.width}×${info.height}, attesi 256.`);
  }
  let n = 0;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3]) continue;
    const v = data[i] * 256 + data[i + 1];
    const h = decodificaQuota(v, regione);
    min = Math.min(min, h);
    max = Math.max(max, h);
    n++;
  }
  return {
    pixel: n,
    minM: Number.isFinite(min) ? Math.round(min * 10) / 10 : null,
    maxM: Number.isFinite(max) ? Math.round(max * 10) / 10 : null,
    esempio: codificaQuota((min + max) / 2, regione),
  };
}

async function mosaico(tiles, dir, destinazione) {
  const lato = 96;
  const xs = tiles.map((t) => t[0]);
  const ys = tiles.map((t) => t[1]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const w = (Math.max(...xs) - minX + 1) * lato;
  const h = (Math.max(...ys) - minY + 1) * lato;
  const layers = [];
  for (const [tx, ty] of tiles) {
    const input = await sharp(path.join(dir, `${tx}_${ty}.png`)).resize(lato, lato).png().toBuffer();
    layers.push({ input, left: (tx - minX) * lato, top: (ty - minY) * lato });
  }
  await sharp({ create: { width: w, height: h, channels: 3, background: CIELO } })
    .composite(layers)
    .jpeg({ quality: 72 })
    .toFile(destinazione);
  return { w, h, file: destinazione };
}

async function renderArea(area, pipeline, opt) {
  const groundMeta = path.join(DERIVED, area.id, "ground", "meta.json");
  const sceneFile = path.join(DERIVED, area.id, "scene", "scene.json");
  if (!existsSync(groundMeta) || !existsSync(sceneFile)) {
    throw new ErrorePrevisto(`Manca suolo o scena di ${area.id}. Esegui npm run ground e npm run scene.`);
  }
  const meta = JSON.parse(readFileSync(groundMeta, "utf8"));
  const headingRichiesto = opt.heading ? Number(opt.heading.split(",")[0]) : null;
  if (pipeline.regione.headingStato === "congelato" && headingRichiesto != null && headingRichiesto !== pipeline.regione.headingDeg && !opt.anteprima) {
    throw new ErrorePrevisto(`Heading congelato a ${pipeline.regione.headingDeg}°. Le tile non si rigenerano con un altro azimut.`);
  }
  const heading = headingRichiesto ?? pipeline.regione.headingDeg;
  const regione = regioneCon(pipeline, heading);
  const bbox = bboxDi(opt, area);

  if (opt.anteprima) {
    const lista = (opt.heading ?? String(heading)).split(",").map(Number);
    if (lista.some((n) => !Number.isFinite(n))) throw new ErrorePrevisto("heading atteso: gradi separati da virgola.");
    console.log(`anteprima ${area.id}, heading ${lista.join(", ")}°`);
    return anteprime({ ...area, bbox }, pipeline, meta, lista);
  }

  let tiles = tileArea(area, bbox, regione, meta);
  const tutte = tiles;
  if (opt.only) {
    tiles = opt.only.split(";").map((t) => t.split(",").map(Number));
  }
  const renderDir = cartellaDerived(area.id, "render");
  const heightDir = cartellaDerived(area.id, "height");
  const daFare = tiles.filter(([tx, ty]) => opt.force || !existsSync(path.join(renderDir, `${tx}_${ty}.png`)));
  console.log(`${area.id}: heading ${heading}°, ${tutte.length} tile, ${daFare.length} da disegnare`);
  const t0 = Date.now();
  if (daFare.length) {
    const dist = await costruisciPagina();
    const browser = await lancia();
    const pagina = await apriPagina(browser, dist, area.id, heading, 2);
    for (const [tx, ty] of daFare) {
      const inizio = Date.now();
      try {
        const r = await pagina.evaluate(([x, y, h]) => window.renderTile(x, y, h), [tx, ty, heading]);
        await scriviPngDataUrl(r.color, path.join(renderDir, `${tx}_${ty}.png`));
        const grezzo = Buffer.from(r.height, "base64");
        await sharp(grezzo, { raw: { width: 256, height: 256, channels: 4 } })
          .flip()
          .png()
          .toFile(path.join(heightDir, `${tx}_${ty}.png`));
        console.log(`  ${tx}_${ty}: ${((Date.now() - inizio) / 1000).toFixed(1)} s`);
      } catch (err) {
        console.error(`  ${tx}_${ty}: FALLITA ${err.message}`);
        throw err;
      }
    }
    await pagina.context().close();
    await browser.close();
  }

  const controlli = [];
  const tenute = [];
  for (const [tx, ty] of tutte) {
    const png = path.join(renderDir, `${tx}_${ty}.png`);
    if (!existsSync(png)) throw new ErrorePrevisto(`Manca la tile ${tx}_${ty}.`);
    const colore = await verificaTile(png, regione);
    if (colore.variazione < 1) {
      unlinkSync(png);
      const altezza = path.join(heightDir, `${tx}_${ty}.png`);
      if (existsSync(altezza)) unlinkSync(altezza);
      console.log(`  ${tx}_${ty}: scartata, solo cielo`);
      continue;
    }
    tenute.push([tx, ty]);
    controlli.push({ tx, ty, ...colore });
  }
  const vuote = controlli.filter((c) => !c.nonVuota);
  for (const nome of readdirSync(renderDir)) {
    const trovato = nome.match(/^(-?\d+)_(-?\d+)\.png$/);
    if (!trovato) continue;
    const tx = Number(trovato[1]);
    const ty = Number(trovato[2]);
    if (tenute.some(([x, y]) => x === tx && y === ty)) continue;
    unlinkSync(path.join(renderDir, nome));
    const altezza = path.join(heightDir, nome);
    if (existsSync(altezza)) unlinkSync(altezza);
  }
  const campione = tenute[Math.floor(tenute.length / 2)];
  const altezze = await verificaAltezze(path.join(heightDir, `${campione[0]}_${campione[1]}.png`), regione);
  const anteprima = path.join(renderDir, "mosaico.jpg");
  const foglio = await mosaico(tenute, renderDir, anteprima);
  const secondi = Math.round((Date.now() - t0) / 10) / 100;
  const report = {
    area: area.id,
    bbox,
    finestra: opt.finestra,
    headingDeg: heading,
    headingStato: pipeline.regione.headingStato,
    pitchDeg: STILE.pitchDeg,
    mpp: STILE.mpp,
    tile: STILE.tile,
    tileTotali: tenute.length,
    disegnateOra: daFare.length,
    secondi,
    chrome: chromePath(),
    vuote: vuote.map((c) => `${c.tx}_${c.ty}`),
    variazioneMedia: Math.round(controlli.reduce((s, c) => s + c.variazione, 0) / controlli.length),
    altezzeCampione: { tile: `${campione[0]}_${campione[1]}`, ...altezze },
    mosaico: anteprima,
    mosaicoPx: [foglio.w, foglio.h],
    cameraProva: cameraTile(0, 0, heading).half,
  };
  writeFileSync(path.join(renderDir, "report.json"), JSON.stringify(report, null, 2));
  console.log(`  ${tutte.length} tile, ${secondi} s, mosaico ${anteprima}`);
  if (vuote.length) console.log(`  attenzione, tile quasi piatte: ${report.vuote.join(", ")}`);
  console.log(`  altezze ${campione[0]}_${campione[1]}: ${altezze.minM}…${altezze.maxM} m ellissoidici (${altezze.pixel} pixel)`);
  return report;
}

export async function esegui(argv) {
  richiediNode24();
  caricaEnv();
  const aree = leggiAree();
  const pipeline = leggiPipeline();
  const opt = analizza(argv);
  if (opt.help) {
    console.log(`Uso:
  npm run render
  npm run render -- centro-storico --finestra rocca-ponte
  npm run render -- centro-storico --only -2,-1;-1,-1
  npm run render -- --anteprima --heading 0,30,45,315
  npm run render -- --force

Senza argomenti rende centro-storico. Le tile stanno in data/derived/<area>/render/.
--anteprima confronta gli heading senza scrivere la piramide.`);
    return;
  }
  if (!opt.ids.length) opt.ids.push(process.env.OSM_AREA?.trim() || "centro-storico");
  console.log("Subiaco Isometrica — render");
  for (const id of opt.ids) await renderArea(areaPerId(aree, id), pipeline, opt);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  esegui(process.argv.slice(2)).catch((err) => {
    console.error(err instanceof ErrorePrevisto ? err.message : err.stack || err.message);
    process.exit(1);
  });
}
