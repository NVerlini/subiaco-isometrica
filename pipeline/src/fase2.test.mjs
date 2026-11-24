import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assi, cameraTile, codificaQuota, creaQuadro, decodificaQuota, tileCoperte } from "./geo.mjs";
import { profiloStradale } from "./strade.mjs";
import { separaTorre } from "./torri.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const pipeline = JSON.parse(readFileSync(path.join(ROOT, "config/pipeline.json"), "utf8"));

function quadroProva(headingDeg) {
  return creaQuadro({ ...pipeline.regione, headingDeg });
}

test("l'heading di Subiaco è congelato a 315 gradi", () => {
  assert.equal(pipeline.regione.headingDeg, 315);
  assert.equal(pipeline.regione.headingStato, "congelato");
  assert.equal(pipeline.stile.pitchDeg, 45);
  assert.equal(pipeline.stile.mpp, 0.25);
  assert.equal(pipeline.stile.tileArte, 1024);
  assert.equal(pipeline.piramide.tileWeb, 512);
  assert.equal(pipeline.piramide.zoomNativo, 8);
  assert.equal(pipeline.piramide.zoomMinimo, 2);
});

test("il centro della tile è il pixel centrale", () => {
  const heading = 45;
  const tx = 2;
  const ty = -1;
  const quadro = quadroProva(heading);
  const { right, up } = assi(heading);
  const cx = (tx + 0.5) * 1024 * 0.25;
  const cy = (ty + 0.5) * 1024 * 0.25;
  const p0 = [0, 1, 2].map((k) => right[k] * cx - up[k] * cy);
  const [px, py] = quadro.pixel(p0[0], p0[1], p0[2]);
  assert.ok(Math.abs(px - (tx + 0.5) * 1024) < 1e-6, `x ${px}`);
  assert.ok(Math.abs(py - (ty + 0.5) * 1024) < 1e-6, `y ${py}`);
  const cam = cameraTile(tx, ty, heading);
  assert.equal(cam.halfX, 128);
  assert.equal(cam.halfY, 128);
});

test("l'origine ENU a quota zero è il pixel (0, 0)", () => {
  const quadro = quadroProva(30);
  const [e, n, u] = quadro.daLonLat(pipeline.regione.origine.lon, pipeline.regione.origine.lat, 0);
  assert.ok(Math.hypot(e, n, u) < 0.05, `${e} ${n} ${u}`);
  const [px, py] = quadro.pixel(e, n, u);
  assert.ok(Math.abs(px) < 0.2 && Math.abs(py) < 0.2, `${px} ${py}`);
});

test("la codifica a 3 cm copre fondovalle e cresta", () => {
  const regione = pipeline.regione;
  const fondovalle = regione.misureDem.aree["centro-storico"].min + regione.geoidM;
  const cresta = regione.misureDem.aree["monte-livata"].max + 50.05 + 40;
  for (const h of [fondovalle, cresta, regione.groundH]) {
    const v = codificaQuota(h, regione);
    assert.ok(v > 0 && v < 65535, `valore ${v} per ${h}`);
    assert.ok(Math.abs(decodificaQuota(v, regione) - h) <= regione.codificaAltezze.passoCm / 100 / 2 + 1e-6);
  }
});

test("le tile del centro storico non sono vuote", () => {
  const quadro = quadroProva(pipeline.regione.headingDeg);
  const aree = JSON.parse(readFileSync(path.join(ROOT, "config/areas.json"), "utf8"));
  const [s, w, n, e] = aree.aree.find((a) => a.id === "centro-storico").bbox;
  assert.deepEqual([s, w, n, e], [41.918, 13.08, 41.932, 13.115]);
  const punti = [];
  for (const q of [365.5, 538.8]) {
    for (const [lon, lat] of [[w, s], [e, s], [e, n], [w, n]]) {
      const [ee, nn, u] = quadro.daLonLat(lon, lat, q + pipeline.regione.geoidM);
      punti.push(quadro.pixel(ee, nn, u));
      punti.push(quadro.pixel(ee, nn, u + 70));
    }
  }
  const tiles = tileCoperte(punti);
  assert.equal(tiles.length, 76);
});

test("il volume alto e stretto diventa una torre, il corpo no", () => {
  const anello = [[0, 0], [1, 0], [1, 1], [0, 0]];
  const navata = { h: 14.2, areaM2: 420, anello };
  const campanile = { h: 56.3, areaM2: 36, anello };
  const split = separaTorre([navata, campanile], 480);
  assert.equal(split.corpo.h, 14.2);
  assert.equal(split.torri.length, 1);
  assert.equal(split.torri[0].h, 56.3);

  const solo = separaTorre([campanile], 36);
  assert.equal(solo.torri.length, 0);
  assert.equal(solo.corpo.h, 56.3);

  const largo = separaTorre(
    [{ h: 56, areaM2: 700, anello }, { h: 12, areaM2: 180, anello }],
    800,
  );
  assert.equal(largo.torri.length, 0);
  assert.equal(largo.corpo.h, 56);

  const anelloT = [[0, 0], [1, 0], [1, 1], [0, 0]];
  const andrea = separaTorre([
    { h: 56.3, areaM2: 274, anello: anelloT, _e: 0, _n: 0 },
    { h: 42.4, areaM2: 253, anello: anelloT, _e: 1, _n: -10 },
    { h: 41.8, areaM2: 2316, anello: anelloT, _e: 8, _n: 9 },
    { h: 25.4, areaM2: 132, anello: anelloT, _e: 13, _n: 16 },
    { h: 17.8, areaM2: 115, anello: anelloT, _e: -8, _n: 29 },
  ], 1855);
  assert.equal(andrea.corpo.h, 25.4);
  assert.deepEqual(andrea.torri.map((t) => t.h).sort((a, b) => b - a), [56.3, 42.4]);

  const casa = separaTorre([
    { h: 27.7, areaM2: 48, anello: anelloT, _e: 0, _n: 0 },
    { h: 25.5, areaM2: 332, anello: anelloT, _e: 8, _n: 4 },
    { h: 6, areaM2: 131, anello: anelloT, _e: 30, _n: 0 },
  ], 513);
  assert.equal(casa.torri.length, 0);
  assert.equal(casa.corpo.h, 25.5);

  const rocca = separaTorre([
    { h: 19.6, areaM2: 577, anello: anelloT, _e: 0, _n: 0 },
    { h: 9.5, areaM2: 316, anello: anelloT, _e: 6, _n: 2 },
  ], 723);
  assert.equal(rocca.torri.length, 0);
  assert.equal(rocca.corpo.h, 19.6);
});

test("la carreggiata scende verso l'erosione e il costruito vicino la segue", () => {
  const n = 8;
  const suolo = new Float32Array(n * n).fill(420);
  const erosione = new Float32Array(n * n).fill(400);
  const dsm = new Float32Array(n * n).fill(430);
  const cover = new Uint8Array(n * n);
  cover[3 * n + 1] = 50;
  const stats = profiloStradale({
    suolo, erosione, dsm, cover, nx: n, ny: n, x0: 0, y0: 0, passo: 10,
    linee: [[[5, 5], [65, 5]]],
  });
  assert.ok(stats.celle > 0, "nessuna cella toccata");
  assert.ok(suolo[1] < 410, `strada rimasta a ${suolo[1]}`);
  assert.ok(suolo[3 * n + 1] < 418, `costruito rimasto a ${suolo[3 * n + 1]}`);
  assert.ok(suolo[7 * n + 7] > 419, "il bosco lontano non va spianato");
});
