import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { creaQuadro } from "./geo.mjs";
import { generaDemo } from "../../web/src/demo.mjs";
import { ascolta, creaServer } from "../../web/src/server.mjs";
import {
  elencoLandmark,
  faseGiorno,
  indiceTile,
  istanteLocale,
  leggiMeteo,
  pixelLuogo,
  testoMeteo,
  urlMeteo,
  urlOsm,
  urlSegnalazione,
} from "../../web/src/vista.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const pipeline = JSON.parse(readFileSync(path.join(ROOT, "config/pipeline.json"), "utf8"));
const aree = JSON.parse(readFileSync(path.join(ROOT, "config/areas.json"), "utf8"));
const regione = pipeline.regione;

test("i sei landmark di areas.json hanno scheda, coordinate e quota", () => {
  const attesi = [
    ...aree.landmark.map((l) => l.id),
    aree.monteLivata.impiantoAttivo.id,
    aree.monteLivata.pistaPrioritaria.id,
  ];
  const luoghi = elencoLandmark(aree);
  assert.deepEqual(luoghi.map((l) => l.id), attesi);
  for (const luogo of luoghi) {
    assert.equal(luogo.nome.length > 3, true, luogo.id);
    assert.equal(luogo.scheda.length > 40, true, luogo.id);
    assert.ok(Number.isFinite(luogo.lat) && Number.isFinite(luogo.lon), luogo.id);
    assert.ok(luogo.quotaOrtometrica > 300, luogo.id);
  }
  assert.equal(urlOsm(luoghi[0].osm), "https://www.openstreetmap.org/way/153585997");
  assert.equal(urlOsm(aree.monteLivata.pistaPrioritaria.osm), null);
});

test("il pixel della Rocca segue l'ENU a 315° e la quota del suolo", () => {
  const rocca = elencoLandmark(aree).find((l) => l.id === "rocca-abbaziale");
  const px = pixelLuogo(regione, rocca);
  const quadro = creaQuadro(regione);
  const [e, n] = quadro.piano(rocca.lon, rocca.lat);
  const u = quadro.suOrtometrico(e, n, rocca.quotaOrtometrica);
  const [x, y] = quadro.pixel(e, n, u);
  assert.ok(Math.abs(px.x - x) < 1e-6 && Math.abs(px.y - y) < 1e-6);
  assert.ok(Math.abs(px.u - (497.9 + regione.geoidM)) < 0.05, px.u);
  const attesoY = -px.u * Math.cos((45 * Math.PI) / 180) / 0.25;
  assert.ok(Math.abs(px.x) < 1e-6, px.x);
  assert.ok(Math.abs(px.y - attesoY) < 1e-6, `${px.y} contro ${attesoY}`);
  assert.ok(Math.abs(px.y - (-1549)) < 2, px.y);
});

test("a 315° il ponte sta a sinistra della Rocca, e non è la pianta a 45°", () => {
  const luoghi = elencoLandmark(aree);
  const ponte = luoghi.find((l) => l.id === "ponte-san-francesco");
  const rocca = luoghi.find((l) => l.id === "rocca-abbaziale");
  const a315 = {
    ponte: pixelLuogo(regione, ponte),
    rocca: pixelLuogo(regione, rocca),
  };
  const a45 = {
    ponte: pixelLuogo({ ...regione, headingDeg: 45 }, ponte),
    rocca: pixelLuogo({ ...regione, headingDeg: 45 }, rocca),
  };
  assert.ok(a315.ponte.x < a315.rocca.x - 500, a315.ponte.x);
  const delta315 = a315.ponte.x - a315.rocca.x;
  const delta45 = a45.ponte.x - a45.rocca.x;
  assert.ok(Math.abs(delta315 - delta45) > 500, `${delta315} ${delta45}`);
});

test("l'indice di tile è quello del percorso della piramide", () => {
  const rocca = pixelLuogo(regione, elencoLandmark(aree)[0]);
  const nativa = indiceTile(rocca.x, rocca.y, 8);
  assert.equal(nativa.span, 512);
  assert.equal(nativa.x, 0);
  assert.equal(nativa.y, -4);
  const bassa = indiceTile(-1897.3, -1728.2, 2);
  assert.equal(bassa.span, 32768);
  assert.equal(bassa.x, -1);
  assert.equal(bassa.y, -1);
});

test("la segnalazione apre un'issue senza token e con la vista", () => {
  const url = new URL(urlSegnalazione({
    x: 12.4,
    y: -1549.2,
    zoom: 4.25,
    tile: { z: 3, x: -1, y: -2 },
    fonte: "demo",
  }));
  assert.equal(url.origin + url.pathname, "https://github.com/NVerlini/subiaco-isometrica/issues/new");
  assert.equal(url.searchParams.get("title"), "Errore nel viewer di Subiaco");
  const corpo = url.searchParams.get("body");
  assert.match(corpo, /#@12,-1549,4\.25/);
  assert.match(corpo, /Tile: 3\/-1\/-2/);
  assert.match(corpo, /Sorgente: demo/);
  assert.equal(url.searchParams.has("token"), false);
  assert.equal(/authorization|bearer|api_key/i.test(url.href), false);
});

test("giorno e notte seguono alba e tramonto, il meteo non chiede una chiave", () => {
  const alba = "2026-11-22T07:05";
  const tramonto = "2026-11-22T16:41";
  const offset = 3600;
  const mezzogiorno = istanteLocale("2026-11-22T12:00", offset);
  assert.equal(faseGiorno(mezzogiorno, alba, tramonto, offset), "giorno");
  assert.equal(faseGiorno(istanteLocale(alba, offset), alba, tramonto, offset), "giorno");
  assert.equal(faseGiorno(istanteLocale(alba, offset) - 1, alba, tramonto, offset), "notte");
  assert.equal(faseGiorno(istanteLocale(tramonto, offset), alba, tramonto, offset), "notte");
  assert.equal(faseGiorno(istanteLocale("2026-11-22T06:30", offset), alba, tramonto, offset), "notte");
  assert.equal(testoMeteo(0), "sereno");
  assert.equal(testoMeteo(3), "nuvoloso");
  assert.equal(testoMeteo(80), "rovesci");
  assert.equal(testoMeteo(71), "neve");
  const url = urlMeteo();
  assert.match(url, /^https:\/\/api\.open-meteo\.com\/v1\/forecast\?/);
  assert.match(url, /latitude=41\.92609,41\.93978/);
  assert.equal(/key=|token/i.test(url), false);
  const letti = leggiMeteo([{
    utc_offset_seconds: 3600,
    current: { temperature_2m: 13.3, weather_code: 3, wind_speed_10m: 4 },
    daily: { sunrise: [alba], sunset: [tramonto] },
  }]);
  assert.equal(letti[0].nome, "Subiaco");
  assert.equal(letti[0].testo, "nuvoloso");
  assert.equal(letti[0].alba, alba);
});

test("lo schema di demo è leggero, AVIF e JPEG, e copre i landmark", async () => {
  const dest = await mkdtemp(path.join(tmpdir(), "subiaco-demo-"));
  try {
    const demo = await generaDemo(dest, { pipeline, aree });
    assert.equal(demo.world.demo, true);
    assert.equal(demo.world.dipinte, false);
    assert.equal(demo.world.camera.headingDeg, 315);
    assert.equal(demo.world.min_zoom, 2);
    assert.equal(demo.world.native_zoom, 3);
    assert.ok(demo.byte < 800_000, `schema da ${demo.byte} byte`);
    const quadro = creaQuadro(regione);
    const [dx] = quadro.pixel(1, 0, 0);
    const [, dy] = quadro.pixel(0, 0, 1);
    assert.ok(Math.abs(dx - demo.world.enu2px[0][0]) < 1e-9);
    assert.ok(Math.abs(dy - demo.world.enu2px[1][2]) < 1e-9);
    for (const punto of demo.punti) {
      let coperto = false;
      for (const [z, livello] of Object.entries(demo.indice)) {
        const t = indiceTile(punto.x, punto.y, Number(z));
        if (livello[`${t.x}_${t.y}`]) coperto = true;
      }
      assert.equal(coperto, true, punto.id);
    }
    const campione = Object.keys(demo.indice["3"])[0].split("_");
    const avif = path.join(dest, "tiles", "photo", "3", campione[0], `${campione[1]}.avif`);
    const jpg = path.join(dest, "tiles", "photo", "3", campione[0], `${campione[1]}.jpg`);
    assert.equal(existsSync(avif) && existsSync(jpg), true);
    assert.ok(statSync(avif).size > 200);
  } finally {
    await rm(dest, { recursive: true, force: true });
  }
});

test("il server serve la pagina, le tile e il JPEG anche senza il file", async () => {
  const dest = await mkdtemp(path.join(tmpdir(), "subiaco-http-"));
  const server = await creaServer({ root: dest, demoDir: dest, forzaDemo: true, rigenera: true });
  const porta = await ascolta(server);
  try {
    const base = `http://127.0.0.1:${porta}`;
    const pagina = await fetch(`${base}/`);
    assert.equal(pagina.status, 200);
    assert.match(await pagina.text(), /Subiaco Isometrica/);
    const world = await (await fetch(`${base}/data/world.json`)).json();
    assert.equal(world.demo, true);
    assert.equal(world.camera.headingDeg, 315);
    const indice = await (await fetch(`${base}/data/tiles-photo.json`)).json();
    const [x, y] = Object.keys(indice["2"])[0].split("_");
    const avif = await fetch(`${base}/tiles/photo/2/${x}/${y}.avif`);
    assert.equal(avif.status, 200);
    assert.equal(avif.headers.get("content-type"), "image/avif");
    const jpgPronto = await fetch(`${base}/tiles/photo/2/${x}/${y}.jpg`);
    assert.equal(jpgPronto.headers.get("content-type"), "image/jpeg");
    rmSync(path.join(dest, "tiles", "photo", "2", x, `${y}.jpg`));
    const jpg = await fetch(`${base}/tiles/photo/2/${x}/${y}.jpg`);
    assert.equal(jpg.status, 200);
    assert.equal(jpg.headers.get("content-type"), "image/jpeg");
    const buf = Buffer.from(await jpg.arrayBuffer());
    assert.equal(buf[0], 0xff);
    assert.equal(buf[1], 0xd8);
    assert.equal((await fetch(`${base}/tiles/photo/2/no/0.avif`)).status, 404);
    const js = await fetch(`${base}/app.js`);
    assert.equal(js.status, 200);
    assert.match(await js.text(), /vistaPronta/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(dest, { recursive: true, force: true });
  }
});
