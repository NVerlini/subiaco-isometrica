import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import { fileURLToPath } from "node:url";
import { CREDITI } from "./crediti.mjs";
import { ErrorePrevisto } from "./overpass.mjs";
import { completaSito, costruisci, normalizzaBasePath } from "../../scripts/build-web.mjs";
import {
  LIMITE_BYTE,
  REL_VERSIONE,
  aggiornaDaData,
  bytePiramide,
  controllaLimite,
  preparaPiramide,
  verificaPng1024,
} from "../../scripts/tile-sito.mjs";
import {
  analizza,
  confrontaEdifici,
  edificiDaOsm,
  esegui as diffOsm,
  rapportoMarkdown,
  verificaLandmark,
} from "../../scripts/osm-diff.mjs";
import {
  cacheDi,
  chiaveOggetto,
  esegui as pubblica,
  normalizzaUrlPubblico,
  tipoContenuto,
  vaCaricato,
  variabiliMancanti,
  xmlCors,
} from "../../scripts/publish-tiles.mjs";
import { HASH_VUOTO, firmaSigV4 } from "../../scripts/s3.mjs";
import { baseTile, urlRisorsa } from "../../web/src/vista.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PIPELINE = { regione: { id: "subiaco" } };

function piramide(root) {
  const dir = path.join(root, "data", "web", "regions", "subiaco");
  mkdirSync(path.join(dir, "data"), { recursive: true });
  mkdirSync(path.join(dir, "tiles", "photo", "2", "0"), { recursive: true });
  writeFileSync(path.join(dir, "data", "world.json"), "{}\n");
  writeFileSync(path.join(dir, "data", "tiles-photo.json"), "{}\n");
  writeFileSync(path.join(dir, "tiles", "photo", "2", "0", "0.avif"), Buffer.from("avif-finto"));
  return dir;
}

test("la base delle tile è vuota in locale e punta all'URL in produzione", () => {
  assert.equal(urlRisorsa("/data/world.json", ""), "data/world.json");
  assert.equal(
    urlRisorsa("/tiles/photo/8/0/-4.avif?v=abc", "https://tiles.example/subiaco/"),
    "https://tiles.example/subiaco/tiles/photo/8/0/-4.avif?v=abc",
  );
  assert.equal(baseTile(""), "");
  assert.equal(baseTile("https://pub.example"), "https://pub.example");
  const prima = globalThis.__TILES_PUBLIC_URL__;
  globalThis.__TILES_PUBLIC_URL__ = "https://cdn.example";
  try {
    assert.equal(baseTile(), "https://cdn.example");
  } finally {
    if (prima === undefined) delete globalThis.__TILES_PUBLIC_URL__;
    else globalThis.__TILES_PUBLIC_URL__ = prima;
  }
});

test("SigV4 riproduce l'esempio GET di AWS", () => {
  const firma = firmaSigV4({
    method: "GET",
    percorso: "/test.txt",
    query: "",
    headers: {
      host: "examplebucket.s3.amazonaws.com",
      range: "bytes=0-9",
      "x-amz-content-sha256": HASH_VUOTO,
      "x-amz-date": "20130524T000000Z",
    },
    payloadHash: HASH_VUOTO,
    accessKey: "AKIAIOSFODNN7EXAMPLE",
    secretKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    region: "us-east-1",
    service: "s3",
    amzDate: "20130524T000000Z",
  });
  assert.equal(firma.signature, "f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
  assert.match(firma.canonicalRequest, /^GET\n\/test\.txt\n\nhost:examplebucket/);
});

test("content-type e cache delle tile e dei JSON", () => {
  assert.equal(tipoContenuto("tiles/photo/8/0/-1.avif"), "image/avif");
  assert.equal(tipoContenuto("tiles/photo/8/0/-1.jpg"), "image/jpeg");
  assert.equal(tipoContenuto("data/world.json"), "application/json; charset=utf-8");
  assert.equal(cacheDi("tiles/photo/8/0/-1.avif"), "public, max-age=31536000, immutable");
  assert.equal(cacheDi("tiles/photo/3/1/2.jpeg"), "public, max-age=31536000, immutable");
  assert.equal(cacheDi("data/world.json"), "public, max-age=300, must-revalidate");
  assert.equal(cacheDi("data/tiles-photo.json"), "public, max-age=300, must-revalidate");
  assert.equal(chiaveOggetto("", "data/world.json"), "data/world.json");
  assert.equal(chiaveOggetto("subiaco", "tiles/photo/2/0/0.avif"), "subiaco/tiles/photo/2/0/0.avif");
  assert.throws(() => chiaveOggetto("", "../segreto"), ErrorePrevisto);
  assert.equal(normalizzaUrlPubblico("https://pub.example/subiaco/", { obbligatorio: true }), "https://pub.example/subiaco");
  assert.throws(() => normalizzaUrlPubblico("http://pub.example", { obbligatorio: true }), /https/);
  assert.throws(() => normalizzaUrlPubblico("https://chiave@pub.example", { obbligatorio: true }), /password/);
  assert.match(xmlCors(), /<AllowedMethod>GET<\/AllowedMethod>/);
  assert.match(xmlCors(), /<AllowedMethod>HEAD<\/AllowedMethod>/);
});

test("il manifest salta i file con lo stesso hash e ricarica se cambia destinazione", () => {
  const file = { relativo: "data/world.json", sha256: "abc", byte: 3 };
  const manifest = { versione: 1, bucket: "b", prefisso: "", file: { "data/world.json": { sha256: "abc", byte: 3 } } };
  assert.equal(vaCaricato(file, manifest, { bucket: "b", prefisso: "" }), false);
  assert.equal(vaCaricato({ ...file, sha256: "def" }, manifest, { bucket: "b", prefisso: "" }), true);
  assert.equal(vaCaricato(file, manifest, { bucket: "altro", prefisso: "" }), true);
  assert.equal(vaCaricato(file, manifest, { bucket: "b", prefisso: "subiaco" }), true);
  assert.equal(vaCaricato(file, { file: {} }, { bucket: "", prefisso: "" }), true);
});

test("senza credenziali publish fallisce, il dry-run no e non apre la rete", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "subiaco-r2-"));
  try {
    piramide(root);
    const segreto = "super-secret-value";
    await assert.rejects(
      () => pubblica([], {
        root,
        pipeline: PIPELINE,
        env: { R2_SECRET_ACCESS_KEY: segreto },
        fetchImpl: () => { throw new Error("rete"); },
      }),
      (err) => {
        assert.equal(err instanceof ErrorePrevisto, true);
        assert.match(err.message, /R2_ACCOUNT_ID/);
        assert.match(err.message, /TILES_PUBLIC_URL/);
        assert.equal(err.message.includes(segreto), false);
        return true;
      },
    );
    let chiamate = 0;
    const piano = await pubblica(["--dry-run"], {
      root,
      pipeline: PIPELINE,
      env: {},
      fetchImpl: () => { chiamate += 1; throw new Error("rete"); },
    });
    assert.equal(chiamate, 0);
    assert.equal(piano.dryRun, true);
    assert.equal(piano.daCaricare, 3);
    assert.equal(existsSync(path.join(root, "data", "web", "regions", "subiaco", ".publish-manifest.json")), false);
    assert.deepEqual(variabiliMancanti({}), [
      "R2_ACCOUNT_ID",
      "R2_ACCESS_KEY_ID",
      "R2_SECRET_ACCESS_KEY",
      "R2_BUCKET",
      "TILES_PUBLIC_URL",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("l'upload reale manda AVIF e JSON con gli header giusti e salta ciò che non è cambiato", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "subiaco-put-"));
  try {
    const dir = piramide(root);
    const mondo = readFileSync(path.join(dir, "data", "world.json"));
    const { createHash } = await import("node:crypto");
    const sha = createHash("sha256").update(mondo).digest("hex");
    writeFileSync(path.join(dir, ".publish-manifest.json"), JSON.stringify({
      versione: 1,
      bucket: "bucket-test",
      prefisso: "",
      file: { "data/world.json": { sha256: sha, byte: mondo.length } },
    }));
    const chiamate = [];
    const env = {
      R2_ACCOUNT_ID: "accounttest",
      R2_ACCESS_KEY_ID: "access-test",
      R2_SECRET_ACCESS_KEY: "secret-test-value",
      R2_BUCKET: "bucket-test",
      TILES_PUBLIC_URL: "https://pub.example",
    };
    const esito = await pubblica([], {
      root,
      pipeline: PIPELINE,
      env,
      fetchImpl: async (url, init) => {
        chiamate.push({ url, method: init.method, headers: init.headers });
        assert.equal(url.includes(env.R2_SECRET_ACCESS_KEY), false);
        assert.equal(url.includes("secret-test-value"), false);
        return { ok: true, status: 200, async text() { return ""; } };
      },
    });
    assert.equal(esito.daCaricare, 2);
    assert.equal(esito.invariati, 1);
    assert.equal(esito.cors, "ok");
    const avif = chiamate.find((c) => c.url.endsWith("/tiles/photo/2/0/0.avif"));
    assert.ok(avif, chiamate.map((c) => c.url).join("\n"));
    assert.equal(avif.headers["content-type"], "image/avif");
    assert.equal(avif.headers["cache-control"], "public, max-age=31536000, immutable");
    assert.match(avif.headers.authorization, /^AWS4-HMAC-SHA256 /);
    const json = chiamate.find((c) => c.url.endsWith("/data/tiles-photo.json"));
    assert.equal(json.headers["content-type"], "application/json; charset=utf-8");
    assert.equal(json.headers["cache-control"], "public, max-age=300, must-revalidate");
    const cors = chiamate.find((c) => c.url.includes("cors"));
    assert.equal(cors.headers["content-type"], "application/xml");
    assert.ok(cors.headers["content-md5"]);
    const manifest = readFileSync(path.join(dir, ".publish-manifest.json"), "utf8");
    assert.equal(manifest.includes("secret-test-value"), false);
    assert.equal(manifest.includes("access-test"), false);
    const secondo = [];
    await pubblica([], {
      root,
      pipeline: PIPELINE,
      env,
      fetchImpl: async (url, init) => {
        secondo.push(url + init.method);
        return { ok: true, status: 200, async text() { return ""; } };
      },
    });
    assert.deepEqual(secondo.map((u) => u.includes("cors")), [true]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("il build scrive web/dist con l'URL delle tile e i crediti", async () => {
  const out = await mkdtemp(path.join(tmpdir(), "subiaco-dist-"));
  const vuoto = await mkdtemp(path.join(tmpdir(), "subiaco-dist-vuoto-"));
  try {
    const fatto = await costruisci({
      env: { TILES_PUBLIC_URL: "https://tiles.example/subiaco" },
      out,
    });
    assert.equal(fatto.url, "https://tiles.example/subiaco");
    const js = readFileSync(path.join(out, "app.js"), "utf8");
    assert.match(js, /https:\/\/tiles\.example\/subiaco/);
    assert.match(js, /vistaPronta/);
    const html = readFileSync(path.join(out, "index.html"), "utf8");
    for (const pezzo of [
      "ODbL",
      "DBGT",
      "CC BY 4.0",
      "Copernicus DEM",
      "ESA WorldCover",
      "Open-Meteo",
      "isometricworld",
      "MIT",
      "mondoisometrico",
      "openstreetmap.org/copyright",
    ]) {
      assert.match(html, new RegExp(pezzo.replace(/[.]/g, "\\$&")));
    }
    const senza = await costruisci({ env: {}, out: vuoto });
    assert.equal(senza.url, "");
    const jsVuoto = readFileSync(path.join(vuoto, "app.js"), "utf8");
    assert.match(jsVuoto, /__TILES_PUBLIC_URL__ = ""/);
    assert.equal(jsVuoto.includes("tiles.example"), false);
    assert.equal(html.includes("x.com/dom_gag_96"), false);
  } finally {
    await rm(out, { recursive: true, force: true });
    await rm(vuoto, { recursive: true, force: true });
  }
});

test("le differenze OSM elencano edifici e landmark e non pubblicano", () => {
  const osm = {
    elements: [
      { type: "way", id: 1, tags: { building: "yes" } },
      { type: "way", id: 2, tags: { building: "yes" } },
      { type: "way", id: 9, tags: { building: "no" } },
      { type: "way", id: 153585997, tags: { historic: "castle" } },
    ],
  };
  assert.deepEqual(edificiDaOsm(osm), ["way/1", "way/2"]);
  const totale = confrontaEdifici({ edifici: 1 }, ["way/1", "way/2"]);
  assert.equal(totale.delta, 1);
  assert.equal(totale.aggiunti, null);
  const ids = confrontaEdifici({ edifici: 2, ids: ["way/1", "way/3"] }, ["way/1", "way/2"]);
  assert.deepEqual(ids.aggiunti, ["way/2"]);
  assert.deepEqual(ids.rimossi, ["way/3"]);
  const landmark = verificaLandmark([
    { id: "rocca", nome: "Rocca", osm: "way/153585997" },
    { id: "ponte", nome: "Ponte", osm: "way/232122864" },
    { id: "fondo", nome: "Fondo", osm: null },
  ], new Set(["way/153585997"]));
  assert.deepEqual(landmark.map((l) => l.stato), ["presente", "assente", "non-mappato"]);
  const testo = rapportoMarkdown({
    baseline: { snapshot: "2026-11-15T17:17:13Z" },
    aree: [{ id: "centro-storico", manca: false, edifici: ids }],
    landmark,
  });
  assert.match(testo, /way\/2/);
  assert.match(testo, /way\/3/);
  assert.match(testo, /assente/);
  assert.match(testo, /Non pubblica tile/);
  for (const nome of ["OpenStreetMap", "DBGT", "Sentinel-2", "AGEA", "Copernicus", "WorldCover", "Open-Meteo", "@dom_gag_96", "isometricworld"]) {
    assert.equal(CREDITI.some((r) => r.includes(nome)), true, nome);
  }
});

test("osm:diff legge la cache, segnala un landmark assente e non riscrive la baseline", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "subiaco-osm-"));
  try {
    const config = {
      aree: [{ id: "centro-storico" }],
      landmark: [{ id: "rocca-abbaziale", nome: "Rocca Abbaziale", osm: "way/153585997" }],
      monteLivata: {
        impiantoAttivo: { id: "seggiovia", nome: "Seggiovia", osm: "way/131304704" },
        pistaPrioritaria: { id: "fondo", nome: "Fondo", osm: null },
      },
    };
    mkdirSync(path.join(root, "config"), { recursive: true });
    mkdirSync(path.join(root, "data", "raw", "centro-storico"), { recursive: true });
    const baseline = { snapshot: "2026-11-15T17:17:13Z", aree: { "centro-storico": { edifici: 1, ids: ["way/1"] } } };
    writeFileSync(path.join(root, "config", "osm-baseline.json"), JSON.stringify(baseline));
    writeFileSync(path.join(root, "data", "raw", "centro-storico", "osm.json"), JSON.stringify({
      elements: [
        { type: "way", id: 1, tags: { building: "yes" } },
        { type: "way", id: 4, tags: { building: "house" } },
      ],
    }));
    const esito = await diffOsm([], { root, config, env: {} });
    assert.equal(esito.codice, 1);
    assert.match(esito.testo, /way\/4/);
    assert.match(esito.testo, /assente/);
    assert.equal(existsSync(path.join(root, "data", "osm-diff.md")), true);
    const riletta = JSON.parse(readFileSync(path.join(root, "config", "osm-baseline.json"), "utf8"));
    assert.deepEqual(riletta.aree["centro-storico"].ids, ["way/1"]);
    const analisi = analizza({
      config,
      baseline,
      osmPerArea: { "centro-storico": { elements: [] } },
      aree: ["centro-storico"],
    });
    assert.equal(analisi.aree[0].edifici.dopo, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("vercel, il workflow e .env.example non contengono segreti né un cron attivo", () => {
  const vercel = JSON.parse(readFileSync(path.join(ROOT, "vercel.json"), "utf8"));
  assert.equal(vercel.outputDirectory, "web/dist");
  assert.equal(vercel.buildCommand, "npm run build");
  const csp = vercel.headers[0].headers.find((h) => h.key === "Content-Security-Policy").value;
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.equal(/unsafe-inline|unsafe-eval/.test(csp), false);
  assert.equal(vercel.headers.some((b) => b.headers.some((h) => h.key === "Cache-Control" && /max-age=31536000/.test(h.value) === false && /app\.js/.test(b.source))), true);
  assert.ok(vercel.rewrites?.length);
  const flusso = readFileSync(path.join(ROOT, ".github/workflows/osm-aggiornamenti.yml"), "utf8");
  assert.match(flusso, /workflow_dispatch:/);
  assert.match(flusso, /#\s*schedule:/);
  const attive = flusso.split("\n").map((r) => r.trim()).filter((r) => r.startsWith("schedule:") || r.startsWith("- cron:"));
  assert.deepEqual(attive, []);
  assert.equal(flusso.includes("publish:tiles"), false);
  assert.equal(flusso.includes("npm run publish"), false);
  assert.equal(/vercel/i.test(flusso), false);
  assert.equal(flusso.includes("R2_"), false);
  assert.equal(flusso.includes("secrets."), false);
  const env = readFileSync(path.join(ROOT, ".env.example"), "utf8");
  for (const chiave of ["R2_ACCOUNT_ID=", "R2_ACCESS_KEY_ID=", "R2_SECRET_ACCESS_KEY=", "R2_BUCKET=", "TILES_PUBLIC_URL="]) {
    assert.equal(env.includes(chiave), true, chiave);
    const riga = env.split("\n").find((l) => l.startsWith(chiave));
    assert.equal(riga, chiave);
  }
  assert.equal(env.includes("CLOUDFLARE_API_TOKEN"), false);
  const html = readFileSync(path.join(ROOT, "web/public/index.html"), "utf8");
  assert.match(html, /Open-Meteo/);
  assert.match(html, /DBGT/);
  assert.match(html, /Sentinel-2/);
  assert.match(html, /AGEA 2023/);
  assert.match(html, /mondoisometrico/);
  assert.match(html, /isometricworld/);
  assert.match(html, /\(MIT\)/);
  assert.equal(html.includes("x.com/dom_gag_96"), false);
  assert.match(html, /href="stile.css"/);
  assert.match(html, /src="app.js"/);
});

test("GitHub Pages usa il base path, percorsi relativi e la piramide sotto i 50 MB", async () => {
  assert.equal(normalizzaBasePath("/subiaco-isometrica/"), "/subiaco-isometrica");
  assert.equal(normalizzaBasePath(""), "");
  assert.throws(() => normalizzaBasePath("https://evil.example"), /BASE_PATH/);
  assert.throws(() => normalizzaBasePath("/../segreto"), /BASE_PATH/);
  const out = await mkdtemp(path.join(tmpdir(), "subiaco-pages-"));
  try {
    const fatto = await completaSito({
      env: { TILES_PUBLIC_URL: "", BASE_PATH: "/subiaco-isometrica" },
      basePath: "/subiaco-isometrica",
      out,
    });
    assert.equal(fatto.url, "");
    assert.equal(fatto.basePath, "/subiaco-isometrica");
    assert.equal(fatto.piramide.fonte, "versionata");
    assert.ok(fatto.piramide.byte > 0 && fatto.piramide.byte < LIMITE_BYTE);
    const html = readFileSync(path.join(out, "index.html"), "utf8");
    assert.equal(readFileSync(path.join(out, "404.html"), "utf8"), html);
    assert.match(html, /<base href="\/subiaco-isometrica\/">/);
    assert.match(html, /href="stile.css"/);
    assert.match(html, /src="app.js"/);
    assert.equal(html.includes('src="/app.js"'), false);
    const js = readFileSync(path.join(out, "app.js"), "utf8");
    assert.match(js, /__TILES_PUBLIC_URL__ = ""/);
    const world = JSON.parse(readFileSync(path.join(out, "data", "world.json"), "utf8"));
    assert.notEqual(world.demo, true);
    assert.equal(world.area, "centro-storico");
    assert.equal(world.dipinte, false);
    const indice = JSON.parse(readFileSync(path.join(out, "data", "tiles-photo.json"), "utf8"));
    let coppie = 0;
    for (const [z, livello] of Object.entries(indice)) {
      for (const chiave of Object.keys(livello)) {
        const [x, y] = chiave.split("_");
        assert.equal(existsSync(path.join(out, "tiles", "photo", z, x, `${y}.avif`)), true);
        assert.equal(existsSync(path.join(out, "tiles", "photo", z, x, `${y}.jpg`)), true);
        coppie += 1;
      }
    }
    assert.ok(coppie > 0);
    assert.ok(bytePiramide(path.join(ROOT, REL_VERSIONE)) < LIMITE_BYTE);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("le PNG dipinte da 1024 px diventano una piramide AVIF e JPEG", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "subiaco-png-"));
  try {
    const dir = path.join(root, "tiles", "dipinte", "centro-storico");
    mkdirSync(dir, { recursive: true });
    await sharp({ create: { width: 16, height: 16, channels: 3, background: "#888" } }).png().toFile(path.join(dir, "0_0.png"));
    await assert.rejects(() => verificaPng1024(dir, ["0_0.png"]), /1024/);
    await sharp({ create: { width: 1024, height: 1024, channels: 3, background: "#c45" } }).png().toFile(path.join(dir, "0_0.png"));
    const dest = path.join(root, "piramide");
    const fatto = await preparaPiramide({ root, destDipinte: dest });
    assert.equal(fatto.fonte, "dipinte");
    assert.ok(fatto.byte < LIMITE_BYTE);
    const world = JSON.parse(readFileSync(path.join(dest, "data", "world.json"), "utf8"));
    assert.equal(world.dipinte, true);
    const avif = path.join(dest, "tiles", "photo", "8", "0", "0.avif");
    assert.equal(existsSync(avif), true);
    assert.equal(existsSync(avif.replace(/\.avif$/, ".jpg")), true);
    assert.throws(() => controllaLimite(LIMITE_BYTE + 1), /50 MB/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("aggiorna-tile rifiuta lo schema e aggiunge il JPEG", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "subiaco-agg-"));
  try {
    const src = path.join(root, "src");
    mkdirSync(path.join(src, "data"), { recursive: true });
    mkdirSync(path.join(src, "tiles", "photo", "2", "0"), { recursive: true });
    writeFileSync(path.join(src, "data", "world.json"), JSON.stringify({ demo: true }));
    writeFileSync(path.join(src, "data", "tiles-photo.json"), "{}");
    await assert.rejects(() => aggiornaDaData({ src, dest: path.join(root, "out") }), /schema/);
    writeFileSync(path.join(src, "data", "world.json"), JSON.stringify({ demo: false, dipinte: false }));
    const avif = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#123" } }).avif().toBuffer();
    writeFileSync(path.join(src, "tiles", "photo", "2", "0", "0.avif"), avif);
    const esito = await aggiornaDaData({ src, dest: path.join(root, "out") });
    assert.equal(existsSync(path.join(esito.dest, "tiles", "photo", "2", "0", "0.jpg")), true);
    assert.ok(esito.byte < LIMITE_BYTE);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("il workflow delle Pagine non ha segreti e pubblica web/dist", () => {
  const yml = readFileSync(path.join(ROOT, ".github/workflows/pages.yml"), "utf8");
  assert.match(yml, /workflow_dispatch:/);
  assert.match(yml, /branches:\n\s+- main/);
  assert.match(yml, /pages: write/);
  assert.match(yml, /id-token: write/);
  assert.match(yml, /contents: read/);
  assert.match(yml, /actions\/configure-pages@v5/);
  assert.match(yml, /actions\/setup-node@v4/);
  assert.match(yml, /node-version: 24/);
  assert.match(yml, /npm ci/);
  assert.match(yml, /npm run build/);
  assert.match(yml, /actions\/upload-pages-artifact@v3/);
  assert.match(yml, /path: web\/dist/);
  assert.match(yml, /actions\/deploy-pages@v4/);
  assert.match(yml, /TILES_PUBLIC_URL: ""/);
  assert.equal(yml.includes("secrets."), false);
  assert.equal(yml.includes("R2_"), false);
  assert.equal(yml.includes("PAINT_API"), false);
  const ignora = spawnSync("git", ["check-ignore", "-q", "tiles/altro.png"], { cwd: ROOT });
  assert.equal(ignora.status, 0);
  const tieni = spawnSync("git", ["check-ignore", "-q", "tiles/dipinte/centro-storico/README.md"], { cwd: ROOT });
  assert.equal(tieni.status, 1);
  const web = spawnSync("git", ["check-ignore", "-q", "web/tiles/centro-storico/data/world.json"], { cwd: ROOT });
  assert.equal(web.status, 1);
});
