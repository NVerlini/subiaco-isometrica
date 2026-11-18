import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { distanzaSegmento, creaQuadro } from "./geo.mjs";
import { cartellaSorgente } from "./export.mjs";
import {
  CLASSE,
  chiamaOpenAI,
  codiceDaMetri,
  componiPrompt,
  dipingiMock,
  dipingiMosaico,
  disegnaProva,
  grigliaFinestre,
  rasterMaschera,
  scegliProvider,
} from "./finestre.mjs";
import { profiloArco, quotaIntradosso, solidiPonte } from "./ponte.mjs";
import { avvisiGeometria, classeVegetazione, testoAvvisi } from "./vegetazione.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const pipeline = JSON.parse(readFileSync(path.join(ROOT, "config/pipeline.json"), "utf8"));
const stile = JSON.parse(readFileSync(path.join(ROOT, "config/paint.json"), "utf8"));
const regione = pipeline.regione;

test("le finestre di pittura restano 1024 con overlap 128", () => {
  assert.equal(pipeline.pittura.finestra, 1024);
  assert.equal(pipeline.pittura.sovrapposizione, 128);
  assert.equal(pipeline.pittura.passo, 896);
  assert.equal(pipeline.pittura.sfumatura, 64);
  assert.equal(pipeline.regione.codificaAltezze.passoCm, 3);
  const g = grigliaFinestre([[0, 0], [1, 0]], 1024, 1024, 896);
  assert.equal(g.finestre[1].x - g.finestre[0].x, 896);
  assert.ok(g.finestre.at(-1).x + 1024 >= g.maxX);
  const una = grigliaFinestre([[-1, -2]], 1024, 1024, 896);
  assert.deepEqual(una.finestre, [{ x: -1024, y: -2048, w: 1024, h: 1024 }]);
});

test("la fusione non lascia un gradino se il colore è lo stesso", async () => {
  const tilePx = 32;
  const n = tilePx * tilePx;
  const tile = (tx) => ({
    tx,
    ty: 0,
    colore: new Uint8Array(n * 3).fill(150),
    altezza: new Uint16Array(n).fill(codiceDaMetri(480, regione)),
    maschera: new Uint8Array(n).fill(CLASSE.suolo),
    coperto: new Uint8Array(n).fill(1),
  });
  const esito = await dipingiMosaico({
    tilePx,
    tiles: [tile(0), tile(1)],
    pittura: { finestra: 32, passo: 24, sfumatura: 8 },
    stile,
    regione,
    provider: dipingiMock,
  });
  const intero = new Uint8Array(64 * 32 * 3).fill(150);
  const altezza = new Uint16Array(64 * 32).fill(codiceDaMetri(480, regione));
  const maschera = new Uint8Array(64 * 32).fill(CLASSE.suolo);
  const atteso = dipingiMock({ colore: intero, altezza, maschera, w: 64, h: 32, stile, regione });
  const a = esito.tile.get("0_0");
  const b = esito.tile.get("1_0");
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 64; x++) {
      const src = (x < 32 ? a : b)[((y * 32) + (x % 32)) * 3];
      const ref = atteso[(y * 64 + x) * 3];
      assert.equal(src, ref, `giuntura in ${x},${y}: ${src} contro ${ref}`);
    }
  }
});

test("la sfumatura mescola due finestre di colore diverso", async () => {
  const tilePx = 32;
  const n = tilePx * tilePx;
  const tile = (tx) => ({
    tx,
    ty: 0,
    colore: new Uint8Array(n * 3).fill(100),
    altezza: new Uint16Array(n),
    maschera: new Uint8Array(n).fill(CLASSE.cielo),
    coperto: new Uint8Array(n),
  });
  const esito = await dipingiMosaico({
    tilePx,
    tiles: [tile(0), tile(1)],
    pittura: { finestra: 32, passo: 24, sfumatura: 8 },
    stile,
    regione,
    provider: ({ w, h, ox }) => {
      const out = new Uint8Array(w * h * 3);
      const rosso = ox === 0 ? 200 : 20;
      for (let i = 0; i < w * h; i++) out[i * 3] = rosso;
      return out;
    },
  });
  const px = (x) => esito.tile.get(x < 32 ? "0_0" : "1_0")[((x % 32)) * 3];
  assert.equal(px(0), 200);
  assert.equal(px(63), 20);
  const mezzo = px(28);
  assert.ok(mezzo > 40 && mezzo < 180, `sfumatura ${mezzo}`);
});

test("il mock usa i 3 cm: coppi sul tetto piano, calcare sulla parete", () => {
  const w = 8;
  const h = 8;
  const colore = new Uint8Array(w * h * 3).fill(128);
  const maschera = new Uint8Array(w * h).fill(CLASSE.edificio);
  const altezza = new Uint16Array(w * h);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < w; x++) altezza[y * w + x] = codiceDaMetri(530, regione);
  }
  for (let y = 4; y < 8; y++) {
    for (let x = 0; x < w; x++) altezza[y * w + x] = codiceDaMetri(530 - (y - 3) * 2, regione);
  }
  assert.equal(codiceDaMetri(400.03, regione) - codiceDaMetri(400, regione), 1);
  const out = dipingiMock({ colore, altezza, maschera, w, h, stile, regione });
  const diff = (x, y) => out[(y * w + x) * 3] - out[(y * w + x) * 3 + 2];
  assert.ok(diff(3, 1) > diff(3, 6) + 25, `tetto ${diff(3, 1)} muro ${diff(3, 6)}`);
  maschera.fill(CLASSE.acqua);
  const acqua = dipingiMock({ colore, altezza, maschera, w, h, stile, regione });
  assert.ok(acqua[2] > acqua[0], "l'Aniene è più blu che rosso");
});

test("la faggeta sta sopra i 1000 m e non è una conifera", () => {
  assert.equal(classeVegetazione({ leafType: "broadleaved", quotaOrtometrica: 1100 }), "faggeta");
  assert.equal(classeVegetazione({ worldcover: 10, quotaOrtometrica: 1339 }), "faggeta");
  assert.equal(classeVegetazione({ leafType: "broadleaved", quotaOrtometrica: 480 }), "bosco");
  assert.equal(classeVegetazione({ worldcover: 10, quotaOrtometrica: 500 }), "bosco");
  assert.equal(classeVegetazione({ worldcover: 10, leafType: "needleleaved", quotaOrtometrica: 1500 }), "bosco");
  assert.equal(classeVegetazione({ leafType: "mixed", quotaOrtometrica: 1400 }), "bosco");
  assert.equal(classeVegetazione({ worldcover: 20, quotaOrtometrica: 1400 }), "arbusti");
  assert.equal(stile.faggeta.sogliaQuotaM, 1000);
});

test("il Ponte San Francesco è un solo arco e non scende nel fiume", () => {
  const punti = [[0, 0], [12, 1], [24, 0]];
  const solido = solidiPonte(punti, [410, 280, 408], { larghezzaM: 4, spessoreM: 1.2, frecciaMaxM: 9 });
  assert.equal(solido.campate, 1);
  assert.equal(profiloArco(solido.luceM, solido.frecciaM).campate, 1);
  assert.equal(solido.quotaImposta, 408);
  assert.ok(Math.abs(quotaIntradosso(0.5, solido.luceM, solido.frecciaM) - solido.frecciaM) < 1e-6);
  assert.ok(quotaIntradosso(0, solido.luceM, solido.frecciaM) < 0.05);
  assert.ok(solido.quotaPianoCentro - solido.quotaIntradossoCentro >= 1);
  assert.ok(solido.quotaIntradossoCentro > 400);
  let minimo = Infinity;
  for (const faccia of solido.facce) {
    for (const vertice of faccia.verts) minimo = Math.min(minimo, vertice[2]);
  }
  assert.ok(minimo > 400, `la mesh scende a ${minimo}, sotto la spalla`);
  for (const faccia of solido.facce) {
    if (faccia.ruolo !== "piano") continue;
    for (const [e, n] of faccia.verts) {
      let d = Infinity;
      for (let i = 1; i < punti.length; i++) {
        d = Math.min(d, distanzaSegmento(e, n, punti[i - 1][0], punti[i - 1][1], punti[i][0], punti[i][1]));
      }
      assert.ok(d <= solido.larghezzaM / 2 + 0.05, `fuori pianta ${d}`);
    }
  }
  assert.equal(stile.ponte.osm, "way/232122864");
});

test("gli edifici senza quota e gli split si segnalano senza bloccare", () => {
  const avvisi = avvisiGeometria({
    edifici: [
      { id: "way/1", fonteAltezza: "default-tipologia" },
      { id: "way/1047734686", fonteAltezza: "ctr-unita", altezzaM: 12, parti: [{}, {}] },
    ],
  });
  assert.equal(avvisi.blocca, false);
  assert.equal(avvisi.senzaAltezzaMisurata, 1);
  assert.equal(avvisi.split[0].presente, true);
  assert.equal(avvisi.split[1].id, "way/1180637482");
  assert.equal(avvisi.split[1].presente, false);
  const testo = testoAvvisi(avvisi).join(" ");
  assert.match(testo, /1047734686/);
  assert.match(testo, /1180637482/);
  assert.match(testo, /Non bloccano/);
  const fermo = testoAvvisi(avvisiGeometria(null, { attesi: 68 })).join(" ");
  assert.match(fermo, /68/);
  assert.equal(stile.daVerificare.edificiSenzaAltezzaMisurata, 68);
});

test("senza chiave il provider è mock e l'errore OpenAI non ripete la chiave", async () => {
  assert.equal(scegliProvider({}).nome, "mock");
  assert.equal(scegliProvider({ PAINT_PROVIDER: "openai" }).nome, "mock");
  assert.equal(scegliProvider({ PAINT_PROVIDER: "openai" }).motivo, "chiave assente");
  const chiave = "segreto-di-prova-fase3";
  const scelto = scegliProvider({
    PAINT_PROVIDER: "openai",
    PAINT_API_KEY: chiave,
    PAINT_MODEL: "gpt-image-1",
  });
  assert.equal(scelto.nome, "openai");
  assert.match(componiPrompt(stile), /3 cm/);
  let messaggio = "";
  try {
    await chiamaOpenAI({
      provider: scelto,
      prompt: componiPrompt(stile),
      immagini: [["render.png", Buffer.from("png")]],
      fetchImpl: async (url, init) => {
        assert.equal(url, "https://api.openai.com/v1/images/edits");
        assert.equal(init.headers.Authorization, `Bearer ${chiave}`);
        assert.equal(init.body.get("model"), "gpt-image-1");
        assert.match(init.body.get("prompt"), /Aniene/);
        return { ok: false, status: 401 };
      },
    });
  } catch (err) {
    messaggio = err.message;
  }
  assert.match(messaggio, /HTTP 401/);
  assert.equal(messaggio.includes(chiave), false);
  const esempio = readFileSync(path.join(ROOT, ".env.example"), "utf8");
  assert.match(esempio, /^PAINT_API_KEY=$/m);
  assert.match(esempio, /^PAINT_PROVIDER=$/m);
  assert.equal(cartellaSorgente("centro-storico", true).endsWith(`${path.sep}paint`), true);
  assert.equal(cartellaSorgente("centro-storico", false).endsWith(`${path.sep}render`), true);
});

test("la maschera distingue edificio, acqua e faggeta", () => {
  const quadro = creaQuadro(regione);
  const { lon, lat } = regione.origine;
  const d = 0.00012;
  const anello = [
    [lon - d, lat - d],
    [lon + d, lat - d],
    [lon + d, lat + d],
    [lon - d, lat + d],
    [lon - d, lat - d],
  ];
  const [e, n] = quadro.piano(lon, lat);
  const suolo = quadro.suOrtometrico(e, n, 500);
  const [px, py] = quadro.pixel(e, n, suolo);
  const mask = rasterMaschera({
    w: 280,
    h: 280,
    ox: Math.floor(px - 140),
    oy: Math.floor(py - 140),
    quadro,
    scena: {
      edifici: [{ suoloM: 500, altezzaM: 10, anello, parti: [{ anello, altezzaM: 10 }] }],
      alberi: [{ e: e + 28, n: n - 18, suoloM: 500, raggioM: 7, classeVegetazione: "faggeta" }],
      strade: [{ linea: [[lon + 0.00025, lat - 0.00005], [lon + 0.00045, lat - 0.00005]], larghezzaM: 6, suoloM: 500 }],
      ponti: [],
    },
    features: {
      acquaLinee: [{ linea: [[lon - 0.0002, lat + 0.00015], [lon + 0.0002, lat + 0.00015]], suoloM: 500, bufferM: 8 }],
    },
  });
  const conti = {};
  for (const v of mask) conti[v] = (conti[v] ?? 0) + 1;
  assert.ok(conti[CLASSE.edificio] > 10, `edificio ${conti[CLASSE.edificio]}`);
  assert.ok(conti[CLASSE.acqua] > 10, `acqua ${conti[CLASSE.acqua]}`);
  assert.ok(conti[CLASSE.faggeta] > 5, `faggeta ${conti[CLASSE.faggeta]}`);
  assert.ok(conti[CLASSE.strada] > 5, `strada ${conti[CLASSE.strada]}`);
});

test("l'anteprima di stile tiene coppi, calcare, Aniene e faggeta", () => {
  const prova = disegnaProva(regione, stile, 320, 200);
  const rgb = (nome) => {
    const [x, y] = prova.campioni[nome];
    const i = (y * prova.w + x) * 3;
    return [prova.dipinto[i], prova.dipinto[i + 1], prova.dipinto[i + 2]];
  };
  const coppi = rgb("coppi");
  const muro = rgb("calcare");
  const fiume = rgb("acqua");
  const faggio = rgb("faggeta");
  const bosco = rgb("bosco");
  assert.ok(coppi[0] - coppi[2] > muro[0] - muro[2], `coppi ${coppi} muro ${muro}`);
  assert.ok(fiume[2] > fiume[0] && fiume[1] > fiume[0], `aniene ${fiume}`);
  assert.ok(faggio[1] > bosco[1] + 20, `faggeta ${faggio} bosco ${bosco}`);
});
