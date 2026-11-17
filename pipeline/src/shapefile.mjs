/**
 * Lettura di shapefile (Polygon / PolygonZ) e dBase, per le unità volumetriche della CTR.
 * Adattato da pipeline/src/ctrn.ts di Mondo Isometrico (MIT).
 * Copyright (c) 2026 Dmytro Krasun
 * Copyright (c) 2026 Domenico Gagliardi
 * Copyright (c) 2026 NVerlini
 */

import { readFileSync } from "node:fs";

export function leggiDbf(file) {
  const f = readFileSync(file);
  const n = f.readUInt32LE(4);
  const hl = f.readUInt16LE(8);
  const rl = f.readUInt16LE(10);
  const campi = [];
  for (let o = 32; f[o] !== 0x0d; o += 32) {
    campi.push([f.toString("latin1", o, o + 11).replace(/\0.*$/, ""), f[o + 16]]);
  }
  const righe = [];
  for (let r = 0; r < n; r++) {
    const cancellata = f[hl + r * rl] === 0x2a;
    let p = hl + r * rl + 1;
    const row = { _cancellata: cancellata };
    for (const [nome, len] of campi) {
      row[nome] = f.toString("latin1", p, p + len).trim();
      p += len;
    }
    righe.push(row);
  }
  return righe;
}

/** Anelli [x, y] di ogni record. I tipi PolygonZ tengono la Z dopo la pianta: qui basta il piano. */
export function leggiAnelliShp(file) {
  const s = readFileSync(file);
  const fuori = [];
  for (let o = 100; o + 8 <= s.length;) {
    const len = s.readInt32BE(o + 4) * 2;
    const c = o + 8;
    const type = s.readInt32LE(c);
    if ([3, 5, 13, 15, 23, 25].includes(type)) {
      const np = s.readInt32LE(c + 36);
      const nPts = s.readInt32LE(c + 40);
      const parti = [];
      for (let i = 0; i < np; i++) parti.push(s.readInt32LE(c + 44 + 4 * i));
      const pts = c + 44 + 4 * np;
      const anelli = [];
      for (let i = 0; i < np; i++) {
        const anello = [];
        const fine = i + 1 < np ? parti[i + 1] : nPts;
        for (let k = parti[i]; k < fine; k++) {
          anello.push([s.readDoubleLE(pts + 16 * k), s.readDoubleLE(pts + 16 * k + 8)]);
        }
        if (anello.length >= 4) anelli.push(anello);
      }
      fuori.push(anelli);
    } else {
      fuori.push([]);
    }
    o = c + len;
  }
  return fuori;
}
