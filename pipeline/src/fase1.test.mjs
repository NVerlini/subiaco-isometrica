import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { finestraAltezze, pistaPrevista, scegliAltezza, statoAerialway } from "./altezze.mjs";
import { da25833 } from "./ctr.mjs";
import { leggiEndpoint, millisecondiRetryAfter } from "./overpass.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const pipeline = JSON.parse(readFileSync(path.join(ROOT, "config/pipeline.json"), "utf8"));
const aree = JSON.parse(readFileSync(path.join(ROOT, "config/areas.json"), "utf8"));
const altezze = JSON.parse(readFileSync(path.join(ROOT, "config/altezze.json"), "utf8"));

test("OVERPASS_URL http viene rifiutato", () => {
  const prima = process.env.OVERPASS_URL;
  try {
    process.env.OVERPASS_URL = "http://overpass-api.de/api/interpreter";
    assert.throws(() => leggiEndpoint(), /solo https/);
    process.env.OVERPASS_URL = "https://overpass-api.de/api/interpreter, http://interno/api";
    assert.throws(() => leggiEndpoint(), /solo https/);
  } finally {
    if (prima == null) delete process.env.OVERPASS_URL;
    else process.env.OVERPASS_URL = prima;
  }
});

test("gli endpoint di default sono https", () => {
  const prima = process.env.OVERPASS_URL;
  try {
    delete process.env.OVERPASS_URL;
    for (const url of leggiEndpoint()) assert.equal(new URL(url).protocol, "https:");
  } finally {
    if (prima == null) delete process.env.OVERPASS_URL;
    else process.env.OVERPASS_URL = prima;
  }
});

test("Retry-After in secondi e come data HTTP", () => {
  assert.equal(millisecondiRetryAfter("12"), 12_000);
  assert.equal(millisecondiRetryAfter("0"), 0);
  const adesso = Date.parse("Tue, 17 Nov 2026 21:00:00 GMT");
  assert.equal(millisecondiRetryAfter("Tue, 17 Nov 2026 21:00:08 GMT", adesso), 8_000);
  assert.equal(millisecondiRetryAfter("Tue, 17 Nov 2026 20:00:00 GMT", adesso), 0);
  assert.equal(millisecondiRetryAfter(null), null);
  assert.equal(millisecondiRetryAfter("fra-un-po"), null);
});

test("la finestra di altezza copre fondovalle e Campo dell'Osso", () => {
  const { inizio, fine } = finestraAltezze(pipeline.regione);
  const geoid = pipeline.regione.geoidM;
  const minEll = pipeline.regione.misureDem.aree["centro-storico"].min + geoid;
  const maxEll = pipeline.regione.misureDem.aree["monte-livata"].max + 50.05 + 40;
  assert.ok(inizio < minEll - 20, `inizio ${inizio} non sta sotto il fondovalle ${minEll}`);
  assert.ok(fine > maxEll, `fine ${fine} non copre la cresta ${maxEll}`);
  assert.equal(pipeline.regione.codificaAltezze.passoCm, 3);
});

test("altezza: la CTR precede i livelli, i livelli precedono il default", () => {
  const tags = { building: "yes", "building:levels": "2" };
  assert.equal(scegliAltezza({ tags, ctrM: 11.2, landmarkId: null, altezze }).fonteAltezza, "ctr-gronda");
  assert.equal(scegliAltezza({ tags, ctrM: null, landmarkId: null, altezze }).fonteAltezza, "building:levels");
  assert.equal(scegliAltezza({ tags, ctrM: null, landmarkId: null, altezze }).altezzaM, 6.4);
  const senza = scegliAltezza({ tags: { building: "yes" }, ctrM: 0.4, landmarkId: "rocca-abbaziale", altezze });
  assert.equal(senza.fonteAltezza, "default-tipologia");
  assert.equal(senza.altezzaM, 16);
});

test("a Monte Livata solo la seggiovia Monna dell'Orso è attiva", () => {
  const monte = aree.monteLivata;
  assert.equal(statoAerialway("way/131304704", monte), "attivo");
  assert.equal(statoAerialway("way/681313709", monte), "da-verificare");
  assert.equal(statoAerialway("way/903843778", monte), "da-verificare");
  assert.equal(statoAerialway("node/1", monte), "da-verificare");
  const pista = pistaPrevista(monte);
  assert.equal(pista.geometria, null);
  assert.equal(pista.osm, null);
  assert.equal(pista.id, "sci-fondo-campo-dell-osso");
});

test("un vertice CTR in EPSG:25833 cade nel centro storico", () => {
  const [lon, lat] = da25833(341527.84, 4643550.795);
  const [s, w, n, e] = aree.aree.find((a) => a.id === "centro-storico").bbox;
  assert.ok(lat > s && lat < n, `lat ${lat}`);
  assert.ok(lon > w && lon < e, `lon ${lon}`);
});
