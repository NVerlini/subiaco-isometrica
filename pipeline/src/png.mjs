/**
 * PNG RGB senza dipendenze, per le anteprime di suolo e scena.
 * Copyright (c) 2026 NVerlini
 */

import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const CRC = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(tipo, dati) {
  const t = Buffer.from(tipo);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(dati.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, dati])));
  return Buffer.concat([len, t, dati, crc]);
}

export function scriviPng(file, larghezza, altezza, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(larghezza, 0);
  ihdr.writeUInt32BE(altezza, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc(altezza * (1 + larghezza * 3));
  for (let y = 0; y < altezza; y++) {
    const riga = y * (1 + larghezza * 3);
    raw[riga] = 0;
    rgb.copy(raw, riga + 1, y * larghezza * 3, (y + 1) * larghezza * 3);
  }
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  writeFileSync(file, png);
}

export function tela(larghezza, altezza, colore) {
  const rgb = Buffer.alloc(larghezza * altezza * 3);
  for (let i = 0; i < larghezza * altezza; i++) {
    rgb[i * 3] = colore[0];
    rgb[i * 3 + 1] = colore[1];
    rgb[i * 3 + 2] = colore[2];
  }
  return {
    larghezza,
    altezza,
    rgb,
    pixel(x, y, colorePx) {
      const ix = Math.round(x);
      const iy = Math.round(y);
      if (ix < 0 || iy < 0 || ix >= larghezza || iy >= altezza) return;
      const o = (iy * larghezza + ix) * 3;
      rgb[o] = colorePx[0];
      rgb[o + 1] = colorePx[1];
      rgb[o + 2] = colorePx[2];
    },
    disco(x, y, r, colorePx) {
      const rr = r * r;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy <= rr) this.pixel(x + dx, y + dy, colorePx);
        }
      }
    },
  };
}

export function linea(t, x0, y0, x1, y1, colore, spessore = 1) {
  const passi = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
  for (let i = 0; i <= passi; i++) {
    const u = i / passi;
    const x = x0 + (x1 - x0) * u;
    const y = y0 + (y1 - y0) * u;
    if (spessore <= 1) t.pixel(x, y, colore);
    else t.disco(x, y, spessore, colore);
  }
}

export function riempi(t, punti, colore) {
  if (punti.length < 3) return;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of punti) {
    minY = Math.min(minY, p[1]);
    maxY = Math.max(maxY, p[1]);
  }
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(t.altezza - 1, Math.ceil(maxY));
  for (let y = y0; y <= y1; y++) {
    const xs = [];
    for (let i = 0, j = punti.length - 1; i < punti.length; j = i++) {
      const [x1, y1p] = punti[i];
      const [x2, y2p] = punti[j];
      if ((y1p > y) === (y2p > y)) continue;
      const x = x1 + ((y - y1p) * (x2 - x1)) / (y2p - y1p);
      xs.push(x);
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const a = Math.max(0, Math.ceil(xs[k]));
      const b = Math.min(t.larghezza - 1, Math.floor(xs[k + 1]));
      for (let x = a; x <= b; x++) t.pixel(x, y, colore);
    }
  }
}

const GLIFI = {
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
  "'": ["01100", "01100", "01000", "00000", "00000", "00000", "00000"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01111", "10000", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  0: ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  1: ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  2: ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  3: ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  4: ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  5: ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
  6: ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
  7: ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  8: ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  9: ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
};

export function testo(t, x, y, stringa, colore, scala = 2) {
  let cx = x;
  const s = stringa.toUpperCase();
  for (const ch of s) {
    const g = GLIFI[ch] ?? GLIFI[" "];
    for (let gy = 0; gy < 7; gy++) {
      for (let gx = 0; gx < 5; gx++) {
        if (g[gy][gx] !== "1") continue;
        for (let sy = 0; sy < scala; sy++) {
          for (let sx = 0; sx < scala; sx++) t.pixel(cx + gx * scala + sx, y + gy * scala + sy, colore);
        }
      }
    }
    cx += 6 * scala;
  }
}

export const COLORI = {
  alberi: [46, 110, 58],
  arbusti: [120, 150, 60],
  prato: [176, 196, 110],
  colture: [206, 186, 96],
  costruito: [214, 202, 184],
  nudo: [186, 174, 154],
  neve: [236, 240, 244],
  acqua: [64, 128, 186],
  umido: [70, 140, 140],
  fondo: [232, 226, 214],
  strada: [96, 96, 98],
  edificio: [176, 92, 68],
  landmark: [168, 42, 36],
  ponte: [36, 72, 128],
  testo: [28, 24, 22],
  testoChiaro: [255, 250, 242],
};

export function coloreClasse(codice) {
  switch (codice) {
    case 10: return COLORI.alberi;
    case 20: return COLORI.arbusti;
    case 30: return COLORI.prato;
    case 40: return COLORI.colture;
    case 50: return COLORI.costruito;
    case 60: return COLORI.nudo;
    case 70: return COLORI.neve;
    case 80: return COLORI.acqua;
    case 90: return COLORI.umido;
    default: return COLORI.fondo;
  }
}
