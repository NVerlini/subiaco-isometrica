/**
 * Pittura delle tile di render, a finestre, e piramide dalle tile dipinte.
 * Copyright (c) 2026 NVerlini
 *
 *   npm run paint
 *   npm run paint -- centro-storico --senza-piramide
 *   npm run paint -- --anteprima-stile
 *
 * Senza PAINT_API_KEY il provider è mock: shading pittorico deterministico,
 * niente rete. Con PAINT_PROVIDER=openai e la chiave, ogni finestra va all'API.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
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
import { creaQuadro } from "./geo.mjs";
import { ErrorePrevisto } from "./overpass.mjs";
import { esportaArea } from "./export.mjs";
import {
  chiamaOpenAI,
  coloraMaschera,
  componiPrompt,
  dipingiMock,
  dipingiMosaico,
  disegnaProva,
  rasterMaschera,
  scegliProvider,
} from "./finestre.mjs";
import { avvisiGeometria, testoAvvisi } from "./vegetazione.mjs";

function leggiJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

export function leggiStile() {
  return leggiJson(path.join(ROOT, "config/paint.json"));
}

function analizza(argv) {
  const opt = {
    ids: [],
    only: null,
    senzaPiramide: false,
    anteprimaStile: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") opt.help = true;
    else if (arg === "--senza-piramide") opt.senzaPiramide = true;
    else if (arg === "--anteprima-stile") opt.anteprimaStile = true;
    else if (arg === "--only") opt.only = argv[++i];
    else if (arg.startsWith("-")) throw new ErrorePrevisto(`Opzione sconosciuta: ${arg}`);
    else opt.ids.push(arg);
  }
  return opt;
}

function elencoRender(areaId) {
  const dir = path.join(DERIVED, areaId, "render");
  if (!existsSync(dir)) throw new ErrorePrevisto(`Manca ${dir}. Esegui prima npm run render.`);
  const tiles = [];
  for (const nome of readdirSync(dir)) {
    const m = nome.match(/^(-?\d+)_(-?\d+)\.png$/);
    if (m) tiles.push([Number(m[1]), Number(m[2])]);
  }
  if (!tiles.length) throw new ErrorePrevisto(`Nessuna tile PNG in ${dir}.`);
  return tiles.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}

async function leggiColore(file) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), width: info.width, height: info.height };
}

async function leggiAltezza(file) {
  if (!existsSync(file)) return null;
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const n = info.width * info.height;
  const altezza = new Uint16Array(n);
  const coperto = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * info.channels;
    altezza[i] = data[o] * 256 + data[o + 1];
    coperto[i] = data[o + 3] ? 1 : 0;
  }
  return { altezza, coperto, lato: info.width };
}

function mascheraTile(tx, ty, tilePx, scena, features, quadro, stile) {
  if (!scena) return null;
  return rasterMaschera({
    w: tilePx,
    h: tilePx,
    ox: tx * tilePx,
    oy: ty * tilePx,
    quadro,
    scena,
    features,
    mpp: 0.25,
    sogliaFaggeta: stile.faggeta?.sogliaQuotaM ?? 1000,
  });
}

async function providerDi(scelta, stile) {
  if (scelta.nome === "mock") return null;
  const prompt = componiPrompt(stile);
  return async (input) => {
    const renderPng = await sharp(Buffer.from(input.colore), {
      raw: { width: input.w, height: input.h, channels: 3 },
    }).png().toBuffer();
    const maskRgb = coloraMaschera(input.maschera, input.w, input.h, input.stile);
    const maskPng = await sharp(Buffer.from(maskRgb), {
      raw: { width: input.w, height: input.h, channels: 3 },
    }).png().toBuffer();
    const heightRgb = altezzaVisibile(input.altezza, input.w, input.h);
    const heightPng = await sharp(Buffer.from(heightRgb), {
      raw: { width: input.w, height: input.h, channels: 3 },
    }).png().toBuffer();
    const buf = await chiamaOpenAI({
      provider: scelta,
      prompt,
      immagini: [
        ["render.png", renderPng],
        ["maschera.png", maskPng],
        ["altezze.png", heightPng],
      ],
      fetchImpl: globalThis.fetch,
    });
    const ridotto = await sharp(buf).resize(input.w, input.h, { fit: "fill" }).removeAlpha().raw().toBuffer();
    return new Uint8Array(ridotto);
  };
}

function altezzaVisibile(altezza, w, h) {
  let min = 65535;
  let max = 0;
  for (const v of altezza) {
    if (!v) continue;
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  const span = Math.max(1, max - min);
  const out = new Uint8Array(w * h * 3);
  for (let i = 0; i < altezza.length; i++) {
    const t = altezza[i] ? Math.round(((altezza[i] - min) / span) * 255) : 0;
    out[i * 3] = t;
    out[i * 3 + 1] = t;
    out[i * 3 + 2] = t;
  }
  return out;
}

async function mosaico(tiles, dir, destinazione, tilePx) {
  const lato = 96;
  const xs = tiles.map((t) => t.tx);
  const ys = tiles.map((t) => t.ty);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const w = (Math.max(...xs) - minX + 1) * lato;
  const h = (Math.max(...ys) - minY + 1) * lato;
  const layers = [];
  for (const t of tiles) {
    const input = await sharp(t.colore, { raw: { width: tilePx, height: tilePx, channels: 3 } })
      .resize(lato, lato)
      .png()
      .toBuffer();
    layers.push({ input, left: (t.tx - minX) * lato, top: (t.ty - minY) * lato });
  }
  await sharp({
    create: { width: w, height: h, channels: 3, background: { r: 196, g: 206, b: 214 } },
  }).composite(layers).jpeg({ quality: 68 }).toFile(destinazione);
}

export async function scriviAnteprime(dir, regione, stile) {
  mkdirSync(dir, { recursive: true });
  const prova = disegnaProva(regione, stile, 640, 400);
  const maschera = coloraMaschera(prova.maschera, prova.w, prova.h, stile);
  const dipinto = path.join(dir, "fase3-anteprima.jpg");
  const classi = path.join(dir, "fase3-maschere.jpg");
  await sharp(Buffer.from(prova.dipinto), { raw: { width: prova.w, height: prova.h, channels: 3 } })
    .jpeg({ quality: 62 })
    .toFile(dipinto);
  await sharp(Buffer.from(maschera), { raw: { width: prova.w, height: prova.h, channels: 3 } })
    .jpeg({ quality: 58 })
    .toFile(classi);
  return { dipinto, classi, prova };
}

export async function dipingiArea(area, pipeline, opt, stile) {
  const scelta = scegliProvider(process.env);
  if (scelta.nome === "mock") {
    const perche = scelta.motivo === "chiave assente" ? " (PAINT_PROVIDER senza PAINT_API_KEY)" : "";
    console.log(`  provider mock${perche}: nessuna chiamata di rete`);
  } else {
    console.log(`  provider openai, modello ${scelta.model}`);
  }
  let tiles = elencoRender(area.id);
  if (opt.only) {
    const chieste = new Set(opt.only.split(";").map((t) => t.trim()));
    tiles = tiles.filter(([tx, ty]) => chieste.has(`${tx},${ty}`));
    if (!tiles.length) throw new ErrorePrevisto(`Nessuna tile fra quelle richieste (${opt.only}).`);
  }
  const sceneFile = path.join(DERIVED, area.id, "scene", "scene.json");
  const featureFile = path.join(DERIVED, area.id, "ground", "features.json");
  const scena = existsSync(sceneFile) ? leggiJson(sceneFile) : null;
  const features = existsSync(featureFile) ? leggiJson(featureFile) : null;
  const avvisi = avvisiGeometria(scena, { attesi: stile.daVerificare.edificiSenzaAltezzaMisurata });
  for (const riga of testoAvvisi(avvisi)) console.log(`  ${riga}`);
  const quadro = creaQuadro(pipeline.regione);
  const tilePx = pipeline.stile.tileArte;
  const pronti = [];
  for (const [tx, ty] of tiles) {
    const colore = await leggiColore(path.join(DERIVED, area.id, "render", `${tx}_${ty}.png`));
    if (colore.width !== tilePx || colore.height !== tilePx) {
      throw new ErrorePrevisto(`Tile ${tx}_${ty} ${colore.width}×${colore.height}, attesi ${tilePx}.`);
    }
    const alt = await leggiAltezza(path.join(DERIVED, area.id, "height", `${tx}_${ty}.png`));
    const maschera = mascheraTile(tx, ty, tilePx, scena, features, quadro, stile);
    pronti.push({
      tx,
      ty,
      colore: colore.data,
      altezza: alt?.altezza ?? new Uint16Array(tilePx * tilePx),
      latoAltezza: alt?.lato ?? tilePx,
      coperto: alt?.coperto ?? new Uint8Array(tilePx * tilePx).fill(1),
      maschera,
    });
  }
  const pittura = {
    finestra: pipeline.pittura.finestra,
    passo: pipeline.pittura.passo,
    sfumatura: pipeline.pittura.sfumatura,
  };
  console.log(`  ${pronti.length} tile, finestre ${pittura.finestra} px, passo ${pittura.passo}, sfumatura ${pittura.sfumatura}`);
  const t0 = Date.now();
  const provider = await providerDi(scelta, stile);
  const esito = await dipingiMosaico({
    tilePx,
    tiles: pronti,
    pittura,
    stile,
    regione: pipeline.regione,
    provider: provider ?? dipingiMock,
  });
  const out = cartellaDerived(area.id, "paint");
  const scritte = [];
  for (const [id, rgb] of esito.tile) {
    const [tx, ty] = id.split("_").map(Number);
    const file = path.join(out, `${tx}_${ty}.png`);
    await sharp(Buffer.from(rgb), { raw: { width: tilePx, height: tilePx, channels: 3 } })
      .png({ compressionLevel: 9 })
      .toFile(file);
    scritte.push({ tx, ty, colore: rgb });
  }
  const anteprima = path.join(out, "mosaico.jpg");
  await mosaico(scritte, out, anteprima, tilePx);
  const secondi = Math.round((Date.now() - t0) / 10) / 100;
  const report = {
    area: area.id,
    provider: scelta.nome,
    motivo: scelta.motivo ?? null,
    finestre: esito.griglia.finestre.length,
    tile: scritte.length,
    secondi,
    passoCm: pipeline.regione.codificaAltezze.passoCm,
    pittura,
    avvisi: {
      blocca: false,
      senzaAltezzaMisurata: avvisi.conteggioDalVivo ? avvisi.senzaAltezzaMisurata : avvisi.attesiNelCentro,
      split: avvisi.split,
    },
    mosaico: anteprima,
    nota: "Le tile dipinte stanno in data/ e non si versionano. La piramide si rigenera da queste PNG.",
  };
  writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  console.log(`  ${scritte.length} tile dipinte, ${esito.griglia.finestre.length} finestre, ${secondi} s`);
  console.log(`  mosaico ${anteprima}`);
  if (!opt.senzaPiramide) {
    await esportaArea(area, pipeline, { dipinte: true });
  }
  return report;
}

export async function esegui(argv) {
  richiediNode24();
  caricaEnv();
  const stile = leggiStile();
  const aree = leggiAree();
  const pipeline = leggiPipeline();
  const opt = analizza(argv);
  if (opt.help) {
    console.log(`Uso:
  npm run paint
  npm run paint -- centro-storico --senza-piramide
  npm run paint -- centro-storico --only -1,-2
  npm run paint -- --anteprima-stile

Senza PAINT_API_KEY usa il provider mock (nessuna rete).
PAINT_PROVIDER=openai e PAINT_API_KEY chiamano l'API immagini. Vedi .env.example.`);
    return;
  }
  if (opt.anteprimaStile) {
    const scritti = await scriviAnteprime(path.join(ROOT, "docs"), pipeline.regione, stile);
    console.log(`anteprima stile: ${scritti.dipinto}`);
    console.log(`maschere: ${scritti.classi}`);
    return scritti;
  }
  if (!opt.ids.length) opt.ids.push(process.env.OSM_AREA?.trim() || "centro-storico");
  console.log("Subiaco Isometrica — paint");
  for (const id of opt.ids) await dipingiArea(areaPerId(aree, id), pipeline, opt, stile);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  esegui(process.argv.slice(2)).catch((err) => {
    console.error(err instanceof ErrorePrevisto ? err.message : err.stack || err.message);
    process.exit(1);
  });
}
