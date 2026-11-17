/**
 * GLB minimo (glTF 2.0) con un solo mesh a colori per vertice.
 * Copyright (c) 2026 NVerlini
 *
 * Assi: X est, Y su, Z nord negato (Y-up, destrorso, come vuole glTF).
 */

import { writeFileSync } from "node:fs";

function pad(n, riempi = 0) {
  const resto = n % 4;
  return resto === 0 ? 0 : 4 - resto;
}

export function scriviGlb(file, primitive) {
  const { posizioni, colori, indici } = primitive;
  const binParti = [];
  let offset = 0;
  function vista(buffer, target) {
    const allinea = pad(offset);
    if (allinea) {
      binParti.push(Buffer.alloc(allinea));
      offset += allinea;
    }
    const byteOffset = offset;
    const buf = Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    binParti.push(buf);
    offset += buf.length;
    return { buffer: 0, byteOffset, byteLength: buf.length, target };
  }

  const viewPos = vista(posizioni, 34962);
  const viewCol = vista(colori, 34962);
  const viewIdx = vista(indici, 34963);
  const bin = Buffer.concat(binParti);
  const paddingBin = pad(bin.length);
  const binPadded = paddingBin ? Buffer.concat([bin, Buffer.alloc(paddingBin)]) : bin;

  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < posizioni.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], posizioni[i + k]);
      max[k] = Math.max(max[k], posizioni[i + k]);
    }
  }
  let imin = Infinity;
  let imax = -Infinity;
  for (const id of indici) {
    imin = Math.min(imin, id);
    imax = Math.max(imax, id);
  }

  const json = {
    asset: { version: "2.0", generator: "subiaco-isometrica fase 1" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: "scena" }],
    materials: [{
      pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 },
      doubleSided: true,
    }],
    meshes: [{
      primitives: [{
        attributes: { POSITION: 0, COLOR_0: 1 },
        indices: 2,
        material: 0,
        mode: 4,
      }],
    }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: posizioni.length / 3, type: "VEC3", min, max },
      { bufferView: 1, componentType: 5126, count: colori.length / 3, type: "VEC3" },
      { bufferView: 2, componentType: 5125, count: indici.length, type: "SCALAR", min: [imin], max: [imax] },
    ],
    bufferViews: [viewPos, viewCol, viewIdx],
    buffers: [{ byteLength: binPadded.length }],
  };

  let jsonBuf = Buffer.from(JSON.stringify(json));
  const padJson = pad(jsonBuf.length, 0x20);
  if (padJson) jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(padJson, 0x20)]);

  const totale = 12 + 8 + jsonBuf.length + 8 + binPadded.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(totale, 8);
  const cj = Buffer.alloc(8);
  cj.writeUInt32LE(jsonBuf.length, 0);
  cj.writeUInt32LE(0x4e4f534a, 4);
  const cb = Buffer.alloc(8);
  cb.writeUInt32LE(binPadded.length, 0);
  cb.writeUInt32LE(0x004e4942, 4);
  writeFileSync(file, Buffer.concat([header, cj, jsonBuf, cb, binPadded]));
}

export function meshVuoto() {
  return {
    posizioni: [],
    colori: [],
    indici: [],
    aggiungi(verts, colore, triangoli) {
      const base = this.posizioni.length / 3;
      for (const [x, y, z] of verts) {
        this.posizioni.push(x, y, z);
        this.colori.push(colore[0], colore[1], colore[2]);
      }
      for (const t of triangoli) this.indici.push(base + t);
    },
    congela() {
      return {
        posizioni: Float32Array.from(this.posizioni),
        colori: Float32Array.from(this.colori),
        indici: Uint32Array.from(this.indici),
      };
    },
  };
}
