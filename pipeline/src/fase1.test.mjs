import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { finestraAltezze, pistaPrevista, scegliAltezza, statoAerialway } from "./altezze.mjs";
import { SCHEMA_UNVOL, da25833 } from "./ctr.mjs";
import { centroide, creaQuadro } from "./geo.mjs";
import { leggiEndpoint, millisecondiRetryAfter } from "./overpass.mjs";
import { bboxCompatibile, cacheUsabile } from "./fetch.mjs";
import {
  ADIACENZA_VOLUME_M,
  AREA_MIN_VOLUME_M2,
  SOGLIA_VOLUMI_ORFANI,
  SOVRAPPOSIZIONE_MAX,
  avvisoVolumiOrfani,
  integraVolumiOrfani,
} from "./scene.mjs";

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

function quadrato(lon, lat, latoM) {
  const dLat = latoM / 111_320;
  const dLon = latoM / (111_320 * Math.cos((lat * Math.PI) / 180));
  return [
    [lon, lat],
    [lon + dLon, lat],
    [lon + dLon, lat + dLat],
    [lon, lat + dLat],
    [lon, lat],
  ];
}

function volume(lon, lat, latoM, h, fonte) {
  const anello = quadrato(lon, lat, latoM);
  return {
    h,
    areaM2: latoM * latoM,
    centro: [(anello[0][0] + anello[2][0]) / 2, (anello[0][1] + anello[2][1]) / 2],
    anello,
    fonte,
  };
}

test("i volumi DBGT non coperti restano edifici, i piccoli no", () => {
  const quadro = creaQuadro(pipeline.regione);
  const origineLon = 13.09;
  const origineLat = 41.926;
  const osm = {
    id: "way/1",
    anello: quadrato(origineLon, origineLat, 20),
    altezzaM: 9,
    fonteAltezza: "ctr-unita",
    fonteVolume: "dbgt-2014",
    parti: [],
  };
  const metriEst = (m) => origineLon + m / (111_320 * Math.cos((origineLat * Math.PI) / 180));
  const dentro = volume(origineLon + 0.00002, origineLat + 0.00002, 8, 11.5, "dbgt-2014");
  const vicino = volume(metriEst(22), origineLat, 10, 8, "dbgt-2014");
  const lontano = volume(metriEst(40), origineLat, 10, 14.2, "dbgt-2014");
  const adiacenteA = volume(metriEst(100), origineLat, 8, 6.5, "dbgt-2014");
  const adiacenteB = volume(metriEst(108), origineLat, 8, 9.1, "dbgt-2014");
  const staccatoA = volume(metriEst(200), origineLat, 8, 5, "dbgt-2014");
  const staccatoB = volume(metriEst(211), origineLat, 8, 5.5, "dbgt-2014");
  const piccolo = volume(metriEst(300), origineLat, 3, 4, "dbgt-2014");
  const stessoDelLontano = volume(metriEst(40), origineLat, 10, 14.2, "dbgt-2020");
  const solo2020 = volume(metriEst(400), origineLat, 12, 7.4, "dbgt-2020");
  const esito = integraVolumiOrfani(
    [dentro, vicino, lontano, adiacenteA, adiacenteB, staccatoA, staccatoB, piccolo],
    [stessoDelLontano, solo2020],
    [osm],
    quadro,
  );
  assert.equal(AREA_MIN_VOLUME_M2, 12);
  assert.equal(ADIACENZA_VOLUME_M, 1.5);
  assert.equal(esito.scartatiPiccoli, 1);
  assert.equal(esito.orfani, 7);
  assert.equal(esito.edifici.length, 6);
  assert.equal(esito.avviso, null);
  assert.equal(osm.anello.length, 5);
  assert.equal(osm.altezzaM, 9);
  const lontanoEd = esito.edifici.find((ed) => ed.parti.some((p) => p.altezzaM === 14.2));
  assert.equal(lontanoEd.fonte, "dbgt-2014");
  assert.equal(lontanoEd.fonteAltezza, "ctr-unita");
  assert.equal(lontanoEd.altezzaM, 14.2);
  assert.equal(lontanoEd.anello, lontano.anello);
  const agglomerato = esito.edifici.find((ed) => ed.aggancio === "agglomerato");
  assert.equal(agglomerato.fonte, "dbgt-2014");
  assert.equal(agglomerato.parti.length, 2);
  assert.deepEqual(agglomerato.parti.map((p) => p.altezzaM).sort((a, b) => a - b), [6.5, 9.1]);
  const staccati = esito.edifici.filter((ed) => ed.fonte === "dbgt-2014" && ed.aggancio === "orfano" && ed.altezzaM < 10);
  assert.equal(staccati.length, 3);
  const da2020 = esito.edifici.filter((ed) => ed.fonte === "dbgt-2020");
  assert.equal(da2020.length, 1);
  assert.equal(da2020[0].fonteVolume, "dbgt-2020");
  assert.equal(da2020[0].altezzaM, 7.4);
  assert.equal(avvisoVolumiOrfani(SOGLIA_VOLUMI_ORFANI), null);
  assert.match(avvisoVolumiOrfani(SOGLIA_VOLUMI_ORFANI + 1), /dbgt-2014/);
});

function rettangolo(lon, lat, larghezzaM, altezzaM) {
  const dLat = altezzaM / 111_320;
  const dLon = larghezzaM / (111_320 * Math.cos((lat * Math.PI) / 180));
  return [
    [lon, lat],
    [lon + dLon, lat],
    [lon + dLon, lat + dLat],
    [lon, lat + dLat],
    [lon, lat],
  ];
}

test("il baricentro di una pianta piccola si calcola in metri", () => {
  const lat = 41.92609;
  const lon = 13.09482;
  const lato = 4;
  const anello = rettangolo(lon, lat, lato, lato);
  const c = centroide(anello);
  const veroLon = lon + (lato / 2) / (111_320 * Math.cos((lat * Math.PI) / 180));
  const veroLat = lat + (lato / 2) / 111_320;
  const dx = (c[0] - veroLon) * 111_320 * Math.cos((lat * Math.PI) / 180);
  const dy = (c[1] - veroLat) * 111_320;
  assert.ok(Math.hypot(dx, dy) < 0.05, `scarto ${Math.hypot(dx, dy)} m`);
});

test("un volume che copre un edificio già tenuto non entra, un bordo sottile sì", () => {
  const quadro = creaQuadro(pipeline.regione);
  const lat = 41.926;
  const lon = 13.1;
  const est = (m) => lon + m / (111_320 * Math.cos((lat * Math.PI) / 180));
  const osm = { id: "way/osm", anello: rettangolo(lon, lat, 10, 40), parti: [] };
  const coperto = {
    h: 12,
    areaM2: 1600,
    anello: rettangolo(lon, lat, 40, 40),
    centro: [lon, lat],
    fonte: "dbgt-2014",
  };
  const tenuto = {
    id: "dbgt-2014:1",
    fonte: "dbgt-2014",
    anello: rettangolo(est(80), lat, 20, 20),
    parti: [{ anello: rettangolo(est(80), lat, 20, 20) }],
  };
  const doppione = {
    h: 11,
    areaM2: 400,
    anello: rettangolo(est(80), lat, 20, 20),
    centro: [0, 0],
    fonte: "dbgt-2020",
  };
  const bordo = {
    h: 9,
    areaM2: 400,
    anello: rettangolo(est(99), lat, 20, 20),
    centro: [0, 0],
    fonte: "dbgt-2020",
  };
  const esito = integraVolumiOrfani([coperto], [doppione, bordo], [osm, tenuto], quadro);
  assert.equal(SOVRAPPOSIZIONE_MAX, 0.2);
  assert.equal(esito.edifici.filter((ed) => ed.fonte === "dbgt-2014").length, 0);
  assert.equal(esito.edifici.filter((ed) => ed.fonte === "dbgt-2020").length, 1);
  assert.equal(esito.edifici[0].fonte, "dbgt-2020");
  assert.equal(esito.edifici[0].altezzaM, 9);
});

test("due case attigue restano e un doppione si scarta", () => {
  const quadro = creaQuadro(pipeline.regione);
  const lat = 41.925;
  const lon = 13.095;
  const est = (m) => lon + m / (111_320 * Math.cos((lat * Math.PI) / 180));
  const osm = { id: "way/casa", anello: quadrato(lon, lat, 10), parti: [] };
  const attigua = volume(est(12), lat, 10, 8.4, "dbgt-2014");
  const doppione = volume(lon, lat, 10, 15, "dbgt-2014");
  const copia2020 = volume(est(12), lat, 10, 8.4, "dbgt-2020");
  const esito = integraVolumiOrfani([attigua, doppione], [copia2020], [osm], quadro);
  assert.equal(esito.edifici.length, 1);
  assert.equal(esito.edifici[0].fonte, "dbgt-2014");
  assert.equal(esito.edifici[0].altezzaM, 8.4);
  assert.equal(esito.edifici.filter((ed) => ed.fonte === "dbgt-2020").length, 0);
});

test("la cache si invalida se il bbox dell'area cambia", () => {
  const prima = [41.922, 13.0845, 41.93, 13.105];
  const dopo = [41.918, 13.08, 41.932, 13.115];
  const doc = { stato: "ok", schema: 3, bbox: prima, elements: [{ id: 1 }] };
  assert.equal(bboxCompatibile(prima, prima), true);
  assert.equal(bboxCompatibile(doc.bbox, dopo), false);
  assert.equal(cacheUsabile(doc, dopo, { stato: true, schemaMin: 3 }), false);
  assert.equal(cacheUsabile({ ...doc, bbox: dopo }, dopo, { stato: true, schemaMin: 3 }), true);
  assert.equal(cacheUsabile({ elements: doc.elements }, dopo), false);
  assert.equal(cacheUsabile({ elements: doc.elements, bbox: dopo }, dopo), true);
  assert.equal(cacheUsabile({ ...doc, bbox: dopo }, dopo, { force: true, stato: true, schemaMin: 3 }), false);
  assert.equal(SCHEMA_UNVOL, 4);
  assert.equal(cacheUsabile({ stato: "ok", schema: 3, bbox: dopo }, dopo, { stato: true, schemaMin: SCHEMA_UNVOL }), false);
  assert.equal(cacheUsabile({ stato: "ok", schema: SCHEMA_UNVOL, bbox: dopo }, dopo, { stato: true, schemaMin: SCHEMA_UNVOL }), true);
});

test("un vertice CTR in EPSG:25833 cade nel centro storico", () => {
  const [lon, lat] = da25833(341527.84, 4643550.795);
  const [s, w, n, e] = aree.aree.find((a) => a.id === "centro-storico").bbox;
  assert.ok(lat > s && lat < n, `lat ${lat}`);
  assert.ok(lon > w && lon < e, `lon ${lon}`);
});
