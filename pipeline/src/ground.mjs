/**
 * Suolo: griglia DEM, apertura morfologica per togliere i tetti dal DSM, acqua OSM,
 * classi WorldCover. L'apertura (min poi max) è quella di ground.ts del riferimento (MIT).
 * Copyright (c) 2026 Dmytro Krasun
 * Copyright (c) 2026 Domenico Gagliardi
 * Copyright (c) 2026 NVerlini
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  RAW,
  aiutoStadio,
  areaPerId,
  caricaEnv,
  cartellaDerived,
  leggiAree,
  leggiPipeline,
  opzioni,
  richiediNode24,
} from "./config.mjs";
import { DEM_NOME, apriDem } from "./dem.mjs";
import { creaQuadro } from "./geo.mjs";
import { ErrorePrevisto } from "./overpass.mjs";
import { anelliDi, lineaDi } from "./osm.mjs";
import { COLORI, coloreClasse, linea, riempi, scriviPng, tela, testo } from "./png.mjs";
import { profiloStradale } from "./strade.mjs";
import { finestra } from "./worldcover.mjs";

const PASSO = 10;
const APERTURA_CELLE = 4;
const BUFFER_ACQUA_M = 12;

function leggi(file) {
  if (!existsSync(file)) throw new ErrorePrevisto(`Manca ${file}. Esegui prima npm run fetch.`);
  return JSON.parse(readFileSync(file, "utf8"));
}

function filtro(src, nx, ny, r, op) {
  const pass = (input, orizzontale) => {
    const dst = new Float32Array(input.length);
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        let acc = op === "min" ? Infinity : -Infinity;
        for (let d = -r; d <= r; d++) {
          const x = orizzontale ? ix + d : ix;
          const y = orizzontale ? iy : iy + d;
          if (x < 0 || y < 0 || x >= nx || y >= ny) continue;
          const v = input[y * nx + x];
          acc = op === "min" ? Math.min(acc, v) : Math.max(acc, v);
        }
        dst[iy * nx + ix] = Number.isFinite(acc) ? acc : input[iy * nx + ix];
      }
    }
    return dst;
  };
  return pass(pass(src, true), false);
}

function distanzaSegmento(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function anelliSuolo(el) {
  const grezzi = anelliDi(el);
  return grezzi.map((item) => (Array.isArray(item) ? item : item.anello)).filter((a) => a.length >= 4);
}

async function groundArea(area, regione) {
  console.log(`ground ${area.id}`);
  const quadro = creaQuadro(regione);
  const raw = path.join(RAW, area.id);
  const ground = leggi(path.join(raw, "ground.json"));
  const dem = await apriDem(path.join(RAW, "dem", DEM_NOME));
  const wcFile = path.join(RAW, "worldcover", "ESA_WorldCover_10m_2021_v200_N39E012_Map.tif");
  if (!existsSync(wcFile)) throw new ErrorePrevisto("Manca il tile WorldCover. Esegui npm run fetch.");
  const wc = await finestra(wcFile, area.bbox);

  const angoli = [
    [area.bbox[1], area.bbox[0]],
    [area.bbox[3], area.bbox[0]],
    [area.bbox[3], area.bbox[2]],
    [area.bbox[1], area.bbox[2]],
  ].map(([lon, lat]) => quadro.piano(lon, lat));
  const minX = Math.min(...angoli.map((p) => p[0])) - 40;
  const maxX = Math.max(...angoli.map((p) => p[0])) + 40;
  const minY = Math.min(...angoli.map((p) => p[1])) - 40;
  const maxY = Math.max(...angoli.map((p) => p[1])) + 40;
  const x0 = Math.floor(minX / PASSO) * PASSO;
  const y0 = Math.floor(minY / PASSO) * PASSO;
  const nx = Math.ceil((maxX - x0) / PASSO) + 1;
  const ny = Math.ceil((maxY - y0) / PASSO) + 1;
  const n = nx * ny;
  const dsm = new Float32Array(n);
  const cover = new Uint8Array(n);

  function cellaLonLat(ix, iy) {
    const e = x0 + ix * PASSO;
    const nord = y0 + iy * PASSO;
    const [lon, lat] = inversa(quadro, e, nord, regione.origine);
    return [lon, lat, e, nord];
  }

  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      const [lon, lat] = cellaLonLat(ix, iy);
      const q = dem.campione(lat, lon);
      dsm[iy * nx + ix] = Number.isFinite(q) ? q : 0;
      cover[iy * nx + ix] = wc.campione(lat, lon);
    }
  }

  const erosione = filtro(dsm, nx, ny, APERTURA_CELLE, "min");
  let suolo = filtro(erosione, nx, ny, APERTURA_CELLE, "max");
  const acqua = new Uint8Array(n);
  const lineeAcqua = [];
  const poligoniAcqua = [];
  for (const el of ground.elements ?? []) {
    const tags = el.tags ?? {};
    const eAcqua = tags.natural === "water" || tags.waterway || tags.water;
    if (!eAcqua) continue;
    const anelli = anelliSuolo(el);
    if (anelli.length && (tags.natural === "water" || tags.waterway === "riverbank" || tags.water)) {
      for (const anello of anelli) poligoniAcqua.push({ id: `${el.type}/${el.id}`, nome: tags.name ?? null, anello });
    } else {
      const lineaEl = lineaDi(el);
      if (lineaEl) lineeAcqua.push({ id: `${el.type}/${el.id}`, nome: tags.name ?? null, linea: lineaEl });
    }
  }

  for (const poly of poligoniAcqua) {
    const piano = poly.anello.map(([lon, lat]) => quadro.piano(lon, lat));
    riempiMaschera(acqua, nx, ny, x0, y0, piano);
  }
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      if (acqua[iy * nx + ix]) continue;
      const e = x0 + ix * PASSO;
      const nord = y0 + iy * PASSO;
      for (const fiume of lineeAcqua) {
        const pts = fiume.linea.map(([lon, lat]) => quadro.piano(lon, lat));
        for (let k = 1; k < pts.length; k++) {
          if (distanzaSegmento(e, nord, pts[k - 1][0], pts[k - 1][1], pts[k][0], pts[k][1]) <= BUFFER_ACQUA_M) {
            acqua[iy * nx + ix] = 1;
            break;
          }
        }
        if (acqua[iy * nx + ix]) break;
      }
    }
  }
  const classiStrada = new Set([
    "motorway", "trunk", "primary", "secondary", "tertiary", "unclassified",
    "residential", "living_street", "service", "pedestrian", "track",
  ]);
  const stradeFile = path.join(raw, "roads.json");
  const sorgenteStrade = existsSync(stradeFile) ? leggi(stradeFile) : leggi(path.join(raw, "osm.json"));
  const lineeStrada = [];
  for (const el of sorgenteStrade.elements ?? []) {
    const classe = String(el.tags?.highway ?? "").replace(/_link$/, "");
    if (!classiStrada.has(classe)) continue;
    const spezzata = lineaDi(el);
    if (!spezzata) continue;
    lineeStrada.push(spezzata.map(([lon, lat]) => quadro.piano(lon, lat)));
  }
  const statStrade = profiloStradale({
    suolo, erosione, dsm, cover, nx, ny, x0, y0, passo: PASSO, linee: lineeStrada,
  });

  for (let i = 0; i < n; i++) {
    if (!acqua[i]) continue;
    suolo[i] = Math.max(suolo[i] - 1.5, dsm[i] - 8);
    cover[i] = 80;
  }

  let qmin = Infinity;
  let qmax = -Infinity;
  for (const v of suolo) {
    qmin = Math.min(qmin, v);
    qmax = Math.max(qmax, v);
  }

  const out = cartellaDerived(area.id, "ground");
  writeFileSync(path.join(out, "height.bin"), Buffer.from(suolo.buffer));
  writeFileSync(path.join(out, "dsm.bin"), Buffer.from(dsm.buffer));
  writeFileSync(path.join(out, "landcover.bin"), Buffer.from(cover.buffer));
  const meta = {
    nx,
    ny,
    x0,
    y0,
    passoM: PASSO,
    aperturaM: APERTURA_CELLE * PASSO,
    bufferAcquaM: BUFFER_ACQUA_M,
    origine: regione.origine,
    geoidM: regione.geoidM,
    quotaMin: Math.round(qmin * 100) / 100,
    quotaMax: Math.round(qmax * 100) / 100,
    nota: "height.bin è il suolo ortometrico (DSM aperto, carreggiate riportate all'erosione, acqua incisa). dsm.bin è il Copernicus grezzo. Le quote sono metri EGM2008, riga per riga da sud a nord.",
    quotaStrada: statStrade,
    worldcover: {
      conteggio: wc.conteggio,
      licenza: "CC BY 4.0",
      citazione: "© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium",
    },
  };
  writeFileSync(path.join(out, "meta.json"), JSON.stringify(meta, null, 2));
  const elementiSuolo = (ground.elements ?? []).map((el) => ({
    id: `${el.type}/${el.id}`,
    tags: el.tags ?? {},
    linea: lineaDi(el),
    anelli: anelliSuolo(el),
  }));
  writeFileSync(path.join(out, "features.json"), JSON.stringify({
    acquaLinee: lineeAcqua,
    acquaPoligoni: poligoniAcqua,
    elementi: elementiSuolo,
  }));
  scriviAnteprima(path.join(out, "anteprima.png"), { nx, ny, x0, y0, cover, suolo, qmin, qmax, quadro, lineeAcqua, poligoniAcqua });
  console.log(`  griglia ${nx}×${ny} @ ${PASSO} m, suolo ${qmin.toFixed(1)}…${qmax.toFixed(1)} m`);
  console.log(`  strade: ${lineeStrada.length} carreggiate, ${statStrade.celle} celle abbassate (media ${statStrade.abbassamentoMedioM} m)`);
  console.log(`  acqua: ${poligoniAcqua.length} poligoni, ${lineeAcqua.length} linee (buffer ${BUFFER_ACQUA_M} m sulle linee)`);
  console.log(`  WorldCover: ${riassuntoClassi(wc.conteggio)}`);
  console.log(`  scritto ${out}`);
}

function riassuntoClassi(conteggio) {
  return Object.entries(conteggio)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([k, v]) => `${k}:${v}`)
    .join(", ");
}

function inversa(quadro, e, nord, origine) {
  let lat = origine.lat;
  let lon = origine.lon;
  for (let i = 0; i < 5; i++) {
    const [ee, nn] = quadro.piano(lon, lat);
    const mLat = 111320;
    const mLon = 111320 * Math.cos((lat * Math.PI) / 180);
    lat += (nord - nn) / mLat;
    lon += (e - ee) / mLon;
  }
  return [lon, lat];
}

function riempiMaschera(mask, nx, ny, x0, y0, piano) {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of piano) {
    minY = Math.min(minY, p[1]);
    maxY = Math.max(maxY, p[1]);
  }
  const iy0 = Math.max(0, Math.floor((minY - y0) / PASSO));
  const iy1 = Math.min(ny - 1, Math.ceil((maxY - y0) / PASSO));
  for (let iy = iy0; iy <= iy1; iy++) {
    const y = y0 + iy * PASSO;
    const xs = [];
    for (let i = 0, j = piano.length - 1; i < piano.length; j = i++) {
      const [x1, y1] = piano[i];
      const [x2, y2] = piano[j];
      if ((y1 > y) === (y2 > y)) continue;
      xs.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const ix0 = Math.max(0, Math.ceil((xs[k] - x0) / PASSO));
      const ix1 = Math.min(nx - 1, Math.floor((xs[k + 1] - x0) / PASSO));
      for (let ix = ix0; ix <= ix1; ix++) mask[iy * nx + ix] = 1;
    }
  }
}

function scriviAnteprima(file, ctx) {
  const scala = Math.max(2, Math.min(4, Math.floor(1200 / ctx.nx)));
  const w = ctx.nx * scala;
  const h = ctx.ny * scala;
  const t = tela(w, h, COLORI.fondo);
  for (let iy = 0; iy < ctx.ny; iy++) {
    for (let ix = 0; ix < ctx.nx; ix++) {
      const colore = coloreClasse(ctx.cover[iy * ctx.nx + ix]);
      const yImg = (ctx.ny - 1 - iy) * scala;
      for (let dy = 0; dy < scala; dy++) {
        for (let dx = 0; dx < scala; dx++) t.pixel(ix * scala + dx, yImg + dy, colore);
      }
    }
  }
  const aPx = (e, nord) => {
    const ix = (e - ctx.x0) / PASSO;
    const iy = (nord - ctx.y0) / PASSO;
    return [ix * scala, (ctx.ny - 1 - iy) * scala];
  };
  for (const poly of ctx.poligoniAcqua) {
    const pts = poly.anello.map(([lon, lat]) => aPx(...ctx.quadro.piano(lon, lat)));
    riempi(t, pts, COLORI.acqua);
  }
  for (const fiume of ctx.lineeAcqua) {
    const pts = fiume.linea.map(([lon, lat]) => aPx(...ctx.quadro.piano(lon, lat)));
    for (let i = 1; i < pts.length; i++) linea(t, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], COLORI.acqua, 2);
  }
  testo(t, 12, 12, "SUOLO", COLORI.testo, 3);
  scriviPng(file, w, h, t.rgb);
}

export async function esegui(argv) {
  richiediNode24();
  caricaEnv();
  const aree = leggiAree();
  const pipeline = leggiPipeline();
  const opt = opzioni(argv, aree.aree);
  if (opt.help) {
    aiutoStadio("ground");
    return;
  }
  console.log("Subiaco Isometrica — ground");
  for (const id of opt.ids) await groundArea(areaPerId(aree, id), pipeline.regione);
  console.log("ground completato. Output in data/derived/<area>/ground/.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  esegui(process.argv.slice(2)).catch((err) => {
    console.error(err instanceof ErrorePrevisto ? err.message : err.stack || err.message);
    process.exit(1);
  });
}
