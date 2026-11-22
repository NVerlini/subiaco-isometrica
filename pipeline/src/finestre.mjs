/**
 * Finestre di pittura, fusione delle sovrapposizioni, provider e stile mock.
 * Copyright (c) 2026 NVerlini
 *
 * Stessi numeri del riferimento (1024 px, overlap 128, passo 896, sfumatura 64):
 * la geometria non si inventa, si ricolora. Il provider reale è opzionale.
 */

import { classeVegetazione } from "./vegetazione.mjs";

export const CLASSE = {
  cielo: 0,
  suolo: 1,
  edificio: 2,
  strada: 3,
  acqua: 4,
  bosco: 5,
  faggeta: 6,
  arbusti: 7,
  ponte: 8,
};

const NOME_CLASSE = Object.fromEntries(Object.entries(CLASSE).map(([k, v]) => [v, k]));

export function grigliaFinestre(tiles, tilePx, finestra, passo) {
  if (!(finestra > 0) || !(passo > 0) || !(tilePx > 0)) {
    throw new Error("finestra, passo e tile devono essere positivi");
  }
  if (!tiles.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0, finestre: [] };
  const minX = Math.min(...tiles.map((t) => t[0])) * tilePx;
  const minY = Math.min(...tiles.map((t) => t[1])) * tilePx;
  const maxX = (Math.max(...tiles.map((t) => t[0])) + 1) * tilePx;
  const maxY = (Math.max(...tiles.map((t) => t[1])) + 1) * tilePx;
  const asse = (min, max) => {
    if (max - min <= finestra) return [min];
    const out = [];
    for (let o = min; o < max + passo; o += passo) {
      const start = Math.min(o, max - finestra);
      if (!out.length || start > out[out.length - 1]) out.push(start);
      if (start + finestra >= max) break;
    }
    return out;
  };
  const finestre = [];
  for (const y of asse(minY, maxY)) {
    for (const x of asse(minX, maxX)) finestre.push({ x, y, w: finestra, h: finestra });
  }
  return { minX, minY, maxX, maxY, finestre };
}

export function rampa(distanza, sfumatura) {
  if (!(sfumatura > 0)) return 1;
  const t = Math.max(0, Math.min(1, distanza / sfumatura));
  return t * t * (3 - 2 * t);
}

function hash01(x, y, sale) {
  let n = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(sale | 0, 1442695041);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function clampByte(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function mix(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

export function metriDaCodice(valore, regione) {
  const origine = regione.heightBase - 100;
  const passo = regione.codificaAltezze.passoCm / 100;
  return origine + valore * passo;
}

export function codiceDaMetri(metri, regione) {
  const origine = regione.heightBase - 100;
  const passo = regione.codificaAltezze.passoCm / 100;
  return Math.max(0, Math.min(65535, Math.round((metri - origine) / passo)));
}

function campioneAltezza(tile, lx, ly, tilePx) {
  const buf = tile.altezza;
  const lato = tile.latoAltezza ?? tilePx;
  if (!buf) return 0;
  if (lato === tilePx) return buf[ly * tilePx + lx];
  const fx = ((lx + 0.5) * lato) / tilePx - 0.5;
  const fy = ((ly + 0.5) * lato) / tilePx - 0.5;
  const x0 = Math.max(0, Math.min(lato - 1, Math.floor(fx)));
  const y0 = Math.max(0, Math.min(lato - 1, Math.floor(fy)));
  const x1 = Math.min(lato - 1, x0 + 1);
  const y1 = Math.min(lato - 1, y0 + 1);
  const ax = Math.max(0, Math.min(1, fx - x0));
  const ay = Math.max(0, Math.min(1, fy - y0));
  const v = (x, y) => buf[y * lato + x];
  return Math.round((v(x0, y0) * (1 - ax) + v(x1, y0) * ax) * (1 - ay) + (v(x0, y1) * (1 - ax) + v(x1, y1) * ax) * ay);
}

export function dipingiMock({ colore, altezza, maschera, w, h, ox = 0, oy = 0, stile, regione }) {
  const out = new Uint8Array(w * h * 3);
  const pal = stile.palette;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const cls = maschera[i];
      const gx = ox + x;
      const gy = oy + y;
      const hm = metriDaCodice(altezza[i], regione);
      const hx = metriDaCodice(altezza[y * w + Math.min(w - 1, x + 1)], regione) - hm;
      const hy = metriDaCodice(altezza[Math.min(h - 1, y + 1) * w + x], regione) - hm;
      const pendenza = Math.hypot(hx, hy);
      const grano = hash01(gx, gy, 3);
      const macchia = hash01(gx >> 3, gy >> 3, 9);
      let rgb;
      if (cls === CLASSE.acqua) {
        rgb = mix(pal.anieneProfondo, pal.aniene, 0.3 + hash01(gx, gy >> 2, 5) * 0.7);
      } else if (cls === CLASSE.edificio) {
        const tetto = pendenza < 0.22;
        rgb = tetto ? mix(pal.coppi, pal.coppiOmbra, macchia * 0.65) : mix(pal.calcare, pal.ombraCalcare, 0.2 + grano * 0.55);
        if (tetto && (gy + Math.floor(macchia * 3)) % 4 === 0) rgb = mix(rgb, pal.coppiOmbra, 0.35);
        if (!tetto && gy % 7 === 0) rgb = mix(rgb, pal.ombraCalcare, 0.4);
      } else if (cls === CLASSE.strada) {
        rgb = mix(pal.strada, pal.calcare, grano * 0.28);
      } else if (cls === CLASSE.faggeta) {
        rgb = mix(pal.faggeta, [186, 196, 110], macchia * 0.7);
      } else if (cls === CLASSE.bosco) {
        rgb = mix(pal.bosco, [24, 48, 28], macchia * 0.65);
      } else if (cls === CLASSE.arbusti) {
        rgb = mix(pal.arbusti, pal.bosco, macchia * 0.4);
      } else if (cls === CLASSE.ponte) {
        rgb = mix(pal.ponte, pal.ombraCalcare, 0.15 + grano * 0.45);
        if (gy % 5 === 0) rgb = mix(rgb, pal.ombraCalcare, 0.25);
      } else if (cls === CLASSE.suolo) {
        rgb = mix(pal.suolo, pal.strada, macchia * 0.35);
      } else {
        rgb = pal.cielo.slice();
      }
      const luma = (0.3 * colore[i * 3] + 0.5 * colore[i * 3 + 1] + 0.2 * colore[i * 3 + 2]) / 255;
      const luce = 0.84 + 0.26 * luma;
      const jitter = (grano - 0.5) * 8;
      out[i * 3] = clampByte(rgb[0] * luce + jitter);
      out[i * 3 + 1] = clampByte(rgb[1] * luce + jitter * 0.55);
      out[i * 3 + 2] = clampByte(rgb[2] * luce + jitter * 0.25);
    }
  }
  return out;
}

function tileDi(x, tilePx) {
  const tx = Math.floor(x / tilePx);
  return { tx, locale: x - tx * tilePx };
}

export async function dipingiMosaico({
  tilePx,
  tiles,
  pittura,
  stile,
  regione,
  provider,
}) {
  const { finestra, passo, sfumatura } = pittura;
  const griglia = grigliaFinestre(tiles.map((t) => [t.tx, t.ty]), tilePx, finestra, passo);
  const indice = new Map(tiles.map((t) => [`${t.tx}_${t.ty}`, t]));
  const uscita = new Map();
  const pieno = new Map();
  for (const t of tiles) {
    const id = `${t.tx}_${t.ty}`;
    uscita.set(id, new Uint8Array(tilePx * tilePx * 3));
    pieno.set(id, new Uint8Array(tilePx * tilePx));
  }
  const cielo = stile.palette.cielo;
  const dipingi = provider ?? dipingiMock;

  for (const fin of griglia.finestre) {
    const n = finestra * finestra;
    const colore = new Uint8Array(n * 3);
    const altezza = new Uint16Array(n);
    const maschera = new Uint8Array(n);
    for (let y = 0; y < finestra; y++) {
      for (let x = 0; x < finestra; x++) {
        const X = fin.x + x;
        const Y = fin.y + y;
        const { tx, locale: lx } = tileDi(X, tilePx);
        const { tx: ty, locale: ly } = tileDi(Y, tilePx);
        const i = y * finestra + x;
        const tile = indice.get(`${tx}_${ty}`);
        if (!tile || lx < 0 || ly < 0 || lx >= tilePx || ly >= tilePx) {
          colore[i * 3] = cielo[0];
          colore[i * 3 + 1] = cielo[1];
          colore[i * 3 + 2] = cielo[2];
          continue;
        }
        const p = ly * tilePx + lx;
        colore[i * 3] = tile.colore[p * 3];
        colore[i * 3 + 1] = tile.colore[p * 3 + 1];
        colore[i * 3 + 2] = tile.colore[p * 3 + 2];
        altezza[i] = campioneAltezza(tile, lx, ly, tilePx);
        let cls = tile.maschera ? tile.maschera[p] : 0;
        const coperto = tile.coperto ? tile.coperto[p] : 1;
        if (!cls && coperto) cls = CLASSE.suolo;
        maschera[i] = cls;
      }
    }
    const dipinto = await dipingi({
      colore, altezza, maschera, w: finestra, h: finestra, ox: fin.x, oy: fin.y, stile, regione,
    });
    for (let y = 0; y < finestra; y++) {
      for (let x = 0; x < finestra; x++) {
        const X = fin.x + x;
        const Y = fin.y + y;
        const { tx, locale: lx } = tileDi(X, tilePx);
        const { tx: ty, locale: ly } = tileDi(Y, tilePx);
        if (lx < 0 || ly < 0 || lx >= tilePx || ly >= tilePx) continue;
        const id = `${tx}_${ty}`;
        const buf = uscita.get(id);
        const flag = pieno.get(id);
        if (!buf) continue;
        const j = ly * tilePx + lx;
        const src = (y * finestra + x) * 3;
        let peso = 1;
        if (x < sfumatura) {
          const sinistra = tileDi(X - 1, tilePx);
          const vicino = pieno.get(`${sinistra.tx}_${ty}`);
          if (vicino && vicino[ly * tilePx + sinistra.locale]) peso *= rampa(x, sfumatura);
        }
        if (y < sfumatura) {
          const sopra = tileDi(Y - 1, tilePx);
          const vicino = pieno.get(`${tx}_${sopra.tx}`);
          if (vicino && vicino[sopra.locale * tilePx + lx]) peso *= rampa(y, sfumatura);
        }
        if (!flag[j]) {
          buf[j * 3] = dipinto[src];
          buf[j * 3 + 1] = dipinto[src + 1];
          buf[j * 3 + 2] = dipinto[src + 2];
          flag[j] = 1;
        } else {
          buf[j * 3] = Math.round(buf[j * 3] * (1 - peso) + dipinto[src] * peso);
          buf[j * 3 + 1] = Math.round(buf[j * 3 + 1] * (1 - peso) + dipinto[src + 1] * peso);
          buf[j * 3 + 2] = Math.round(buf[j * 3 + 2] * (1 - peso) + dipinto[src + 2] * peso);
        }
      }
    }
  }
  return { griglia, tile: uscita };
}

export function scegliProvider(env = {}) {
  const nome = String(env.PAINT_PROVIDER ?? "").trim().toLowerCase();
  const chiave = String(env.PAINT_API_KEY ?? "").trim();
  if (!nome || nome === "mock" || !chiave) {
    return {
      nome: "mock",
      motivo: nome && nome !== "mock" && !chiave ? "chiave assente" : "predefinito",
    };
  }
  if (nome !== "openai") {
    throw new Error(`PAINT_PROVIDER=${nome} non è noto. Usa mock oppure openai.`);
  }
  return {
    nome: "openai",
    chiave,
    base: String(env.PAINT_API_BASE || "https://api.openai.com/v1").replace(/\/$/, ""),
    model: String(env.PAINT_MODEL || "gpt-image-1"),
  };
}

export function componiPrompt(paint) {
  const classi = Object.entries(paint.classi).map(([k, v]) => `${k}=${v}`).join(", ");
  return [paint.prompt, paint.vincoli, `Classi della maschera: ${classi}.`].filter(Boolean).join("\n");
}

export async function chiamaOpenAI({ provider, prompt, immagini, fetchImpl }) {
  const form = new FormData();
  form.set("model", provider.model);
  form.set("prompt", prompt);
  form.set("size", "1024x1024");
  for (const [nome, buf] of immagini) {
    form.append("image", new Blob([buf], { type: "image/png" }), nome);
  }
  let res;
  try {
    res = await fetchImpl(`${provider.base}/images/edits`, {
      method: "POST",
      headers: { Authorization: `Bearer ${provider.chiave}` },
      body: form,
    });
  } catch (err) {
    throw new Error(`Pittura OpenAI non raggiungibile (${err.message}).`);
  }
  if (!res.ok) {
    throw new Error(`Pittura OpenAI HTTP ${res.status}. Controlla PAINT_API_KEY e PAINT_MODEL.`);
  }
  const json = await res.json();
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new Error("Pittura OpenAI: risposta senza immagine.");
  return Buffer.from(b64, "base64");
}

export function riempiPoligono(mask, w, h, punti, valore, scrivi) {
  if (!punti || punti.length < 3) return;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of punti) {
    minY = Math.min(minY, p[1]);
    maxY = Math.max(maxY, p[1]);
  }
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(h - 1, Math.ceil(maxY));
  for (let y = y0; y <= y1; y++) {
    const ys = y + 0.5;
    const xs = [];
    for (let i = 0, j = punti.length - 1; i < punti.length; j = i++) {
      const y1p = punti[i][1];
      const y2p = punti[j][1];
      if ((y1p > ys) === (y2p > ys)) continue;
      const x1 = punti[i][0];
      const x2 = punti[j][0];
      xs.push(x1 + ((ys - y1p) * (x2 - x1)) / (y2p - y1p));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.ceil(xs[k] - 1e-6));
      const xb = Math.min(w - 1, Math.floor(xs[k + 1] + 1e-6));
      for (let x = xa; x <= xb; x++) {
        if (scrivi) scrivi(x, y);
        else mask[y * w + x] = valore;
      }
    }
  }
}

export function tracciaDisco(mask, w, h, cx, cy, raggio, valore, scrivi) {
  if (!(raggio > 0)) return;
  const x0 = Math.max(0, Math.floor(cx - raggio));
  const x1 = Math.min(w - 1, Math.ceil(cx + raggio));
  const y0 = Math.max(0, Math.floor(cy - raggio));
  const y1 = Math.min(h - 1, Math.ceil(cy + raggio));
  const r2 = raggio * raggio;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r2) {
        if (scrivi) scrivi(x, y);
        else mask[y * w + x] = valore;
      }
    }
  }
}

function classeNome(nome) {
  return CLASSE[nome] ?? 0;
}

export function rasterMaschera({ w, h, ox, oy, quadro, scena, features, mpp = 0.25, sogliaFaggeta = 1000 }) {
  const mask = new Uint8Array(w * h);
  const locale = (xy) => [xy[0] - ox, xy[1] - oy];
  const zSuolo = (e, n, suoloM) => quadro.suOrtometrico(e, n, suoloM ?? 0);

  for (const poly of features?.acquaPoligoni ?? []) {
    const anello = poly.anello ?? [];
    if (anello.length < 3) continue;
    const pts = anello.map(([lon, lat]) => {
      const [e, n] = quadro.piano(lon, lat);
      return locale(quadro.pixel(e, n, zSuolo(e, n, poly.suoloM)));
    });
    riempiPoligono(mask, w, h, pts, CLASSE.acqua);
  }
  for (const fiume of features?.acquaLinee ?? []) {
    const linea = fiume.linea ?? [];
    const r = (fiume.bufferM ?? 12) / mpp;
    for (let i = 1; i < linea.length; i++) {
      const a = proiettaPunto(quadro, linea[i - 1], fiume.suoloM);
      const b = proiettaPunto(quadro, linea[i], fiume.suoloM);
      const passi = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 4));
      for (let s = 0; s <= passi; s++) {
        const t = s / passi;
        tracciaDisco(mask, w, h, a[0] + (b[0] - a[0]) * t - ox, a[1] + (b[1] - a[1]) * t - oy, r, CLASSE.acqua);
      }
    }
  }
  for (const strada of scena?.strade ?? []) {
    if (strada.landmark === "ponte-san-francesco") continue;
    const r = Math.max(1.2, (strada.larghezzaM ?? 4) / 2) / mpp;
    const linea = strada.linea ?? [];
    for (let i = 1; i < linea.length; i++) {
      const a = proiettaPunto(quadro, linea[i - 1], strada.suoloM);
      const b = proiettaPunto(quadro, linea[i], strada.suoloM);
      const passi = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 3));
      for (let s = 0; s <= passi; s++) {
        const t = s / passi;
        tracciaDisco(mask, w, h, a[0] + (b[0] - a[0]) * t - ox, a[1] + (b[1] - a[1]) * t - oy, r, CLASSE.strada);
      }
    }
  }
  const disegnaChioma = (punto, raggioM, suoloM, classe) => {
    const [e, n] = Array.isArray(punto[0]) ? punto : quadro.piano(punto[0], punto[1]);
    const z = quadro.suOrtometrico(e, n, suoloM ?? 0);
    const [x, y] = quadro.pixel(e, n, z);
    tracciaDisco(mask, w, h, x - ox, y - oy, Math.max(1.5, (raggioM ?? 3) / mpp), classe);
  };
  for (const bosco of scena?.boschi ?? []) {
    const nome = bosco.classeVegetazione
      ?? classeVegetazione({
        worldcover: 10,
        leafType: bosco.leafType,
        quotaOrtometrica: bosco.suoloM,
        sogliaM: sogliaFaggeta,
      });
    const valore = classeNome(nome || "bosco");
    const pts = (bosco.anello ?? []).map(([lon, lat]) => {
      const [e, n] = quadro.piano(lon, lat);
      return locale(quadro.pixel(e, n, zSuolo(e, n, bosco.suoloM)));
    });
    riempiPoligono(mask, w, h, pts, valore);
  }
  for (const albero of scena?.alberi ?? []) {
    const nome = albero.classeVegetazione
      ?? classeVegetazione({
        worldcover: albero.fonte === "worldcover-alberi" ? 10 : albero.fonte === "worldcover-arbusti" ? 20 : 0,
        leafType: albero.leafType,
        quotaOrtometrica: albero.suoloM,
        sogliaM: sogliaFaggeta,
      });
    if (!nome) continue;
    const punto = Number.isFinite(albero.e) ? [albero.e, albero.n] : [albero.lon, albero.lat];
    if (punto[0] == null) continue;
    const coordinate = Number.isFinite(albero.e) ? null : punto;
    if (coordinate) disegnaChioma(coordinate, albero.raggioM, albero.suoloM, classeNome(nome));
    else {
      const z = quadro.suOrtometrico(albero.e, albero.n, albero.suoloM ?? 0);
      const [x, y] = quadro.pixel(albero.e, albero.n, z);
      tracciaDisco(mask, w, h, x - ox, y - oy, Math.max(1.5, (albero.raggioM ?? 3) / mpp), classeNome(nome));
    }
  }
  for (const ed of scena?.edifici ?? []) {
    const parti = ed.parti?.length ? ed.parti : [{ anello: ed.anello, altezzaM: ed.altezzaM }];
    for (const parte of parti) {
      const anello = (parte.anello ?? []).map(([lon, lat]) => {
        const [e, n] = quadro.piano(lon, lat);
        const base = quadro.suOrtometrico(e, n, ed.suoloM ?? 0);
        return { e, n, base, colmo: base + (parte.altezzaM ?? ed.altezzaM ?? 0) };
      });
      if (anello.length < 3) continue;
      for (let i = 0; i < anello.length - 1; i++) {
        const a = anello[i];
        const b = anello[i + 1];
        const piedeA = locale(quadro.pixel(a.e, a.n, a.base));
        const piedeB = locale(quadro.pixel(b.e, b.n, b.base));
        const tettoB = locale(quadro.pixel(b.e, b.n, b.colmo));
        const tettoA = locale(quadro.pixel(a.e, a.n, a.colmo));
        riempiPoligono(mask, w, h, [piedeA, piedeB, tettoB, tettoA], CLASSE.edificio);
      }
      riempiPoligono(mask, w, h, anello.map((p) => locale(quadro.pixel(p.e, p.n, p.colmo))), CLASSE.edificio);
    }
  }
  for (const ponte of scena?.ponti ?? []) {
    const r = Math.max(2, (ponte.larghezzaM ?? 4.5) / 2) / mpp;
    const linea = ponte.linea ?? [];
    for (let i = 1; i < linea.length; i++) {
      const a = proiettaPunto(quadro, linea[i - 1], ponte.suoloM);
      const b = proiettaPunto(quadro, linea[i], ponte.suoloM);
      const passi = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 3));
      for (let s = 0; s <= passi; s++) {
        const t = s / passi;
        tracciaDisco(mask, w, h, a[0] + (b[0] - a[0]) * t - ox, a[1] + (b[1] - a[1]) * t - oy, r, CLASSE.ponte);
      }
    }
  }
  return mask;
}

function proiettaPunto(quadro, lonlat, suoloM) {
  const [e, n] = quadro.piano(lonlat[0], lonlat[1]);
  return quadro.pixel(e, n, quadro.suOrtometrico(e, n, suoloM ?? 0));
}

export function disegnaProva(regione, stile, w = 640, h = 400) {
  const colore = new Uint8Array(w * h * 3);
  const maschera = new Uint8Array(w * h);
  const altezza = new Uint16Array(w * h);
  const tetto = new Uint8Array(w * h);
  const sx = w / 640;
  const sy = h / 400;
  const P = (x, y) => [x * sx, y * sy];
  const cielo = stile.palette.cielo;
  for (let i = 0; i < w * h; i++) {
    colore[i * 3] = cielo[0];
    colore[i * 3 + 1] = cielo[1];
    colore[i * 3 + 2] = cielo[2];
    altezza[i] = codiceDaMetri(430, regione);
  }
  const metti = (x, y, cls, rgb, metri, eTetto = false) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = y * w + x;
    maschera[i] = cls;
    colore[i * 3] = rgb[0];
    colore[i * 3 + 1] = rgb[1];
    colore[i * 3 + 2] = rgb[2];
    altezza[i] = codiceDaMetri(metri, regione);
    if (eTetto) tetto[i] = 1;
  };
  const poly = (punti, cls, rgb, metri, eTetto = false) => {
    riempiPoligono(maschera, w, h, punti, cls, (x, y) => metti(x, y, cls, rgb, metri, eTetto));
  };
  poly([P(0, 210), P(640, 170), P(640, 400), P(0, 400)], CLASSE.suolo, [150, 138, 108], 470);
  poly([P(0, 250), P(250, 210), P(310, 268), P(40, 360), P(0, 360)], CLASSE.acqua, [40, 110, 140], 455);
  const stradaA = P(300, 200);
  const stradaB = P(620, 300);
  const passi = 80;
  for (let s = 0; s <= passi; s++) {
    const t = s / passi;
    tracciaDisco(
      maschera, w, h,
      stradaA[0] + (stradaB[0] - stradaA[0]) * t,
      stradaA[1] + (stradaB[1] - stradaA[1]) * t,
      10 * sx,
      CLASSE.strada,
      (x, y) => metti(x, y, CLASSE.strada, [120, 110, 96], 472),
    );
  }
  for (const [cx, cy, r, cls] of [[430, 200, 26, CLASSE.bosco], [468, 214, 22, CLASSE.bosco], [560, 188, 24, CLASSE.faggeta], [598, 204, 20, CLASSE.faggeta]]) {
    tracciaDisco(maschera, w, h, cx * sx, cy * sy, r * sx, cls, (x, y) => {
      const metri = cls === CLASSE.faggeta ? 1180 : 640;
      metti(x, y, cls, cls === CLASSE.faggeta ? [90, 120, 60] : [30, 70, 36], metri);
    });
  }
  const roof = [P(150, 130), P(250, 86), P(330, 130), P(230, 176)];
  const wallL = [P(150, 130), P(230, 176), P(230, 250), P(150, 204)];
  const wallR = [P(230, 176), P(330, 130), P(330, 204), P(230, 250)];
  poly(wallL, CLASSE.edificio, [170, 150, 120], 500);
  poly(wallR, CLASSE.edificio, [150, 130, 108], 500);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (maschera[i] !== CLASSE.edificio || tetto[i]) continue;
      altezza[i] = codiceDaMetri(640 - y * 0.6, regione);
    }
  }
  poly(roof, CLASSE.edificio, [140, 70, 48], 528, true);
  poly([P(70, 248), P(250, 214), P(250, 236), P(70, 270)], CLASSE.ponte, [160, 150, 130], 478);
  const cx = 160 * sx;
  const cy = 242 * sy;
  const raggio = 28 * sx;
  for (let y = Math.floor(cy); y < Math.min(h, Math.ceil(cy + raggio)); y++) {
    for (let x = Math.floor(cx - raggio); x <= Math.ceil(cx + raggio); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= raggio * raggio) metti(x, y, CLASSE.acqua, [40, 110, 140], 455);
    }
  }
  const punto = (x, y) => [Math.round(x * sx), Math.round(y * sy)];
  const campioni = {
    acqua: punto(40, 300),
    coppi: punto(240, 128),
    calcare: punto(185, 200),
    faggeta: punto(560, 188),
    bosco: punto(430, 200),
    strada: punto(460, 250),
    ponte: punto(120, 236),
  };
  const dipinto = dipingiMock({ colore, altezza, maschera, w, h, stile, regione });
  return { colore, altezza, maschera, tetto, dipinto, w, h, campioni };
}

export function coloraMaschera(maschera, w, h, stile) {
  const pal = stile.palette;
  const tabella = {
    [CLASSE.cielo]: pal.cielo,
    [CLASSE.suolo]: pal.suolo,
    [CLASSE.edificio]: pal.coppi,
    [CLASSE.strada]: pal.strada,
    [CLASSE.acqua]: pal.aniene,
    [CLASSE.bosco]: pal.bosco,
    [CLASSE.faggeta]: pal.faggeta,
    [CLASSE.arbusti]: pal.arbusti,
    [CLASSE.ponte]: pal.ponte,
  };
  const out = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    const rgb = tabella[maschera[i]] ?? pal.cielo;
    out[i * 3] = rgb[0];
    out[i * 3 + 1] = rgb[1];
    out[i * 3 + 2] = rgb[2];
  }
  return out;
}

export { NOME_CLASSE };
