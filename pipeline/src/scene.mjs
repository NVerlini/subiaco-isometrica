/**
 * Scena geometrica: edifici estrusi, suolo, acqua, strade, alberi, landmark, impianti.
 * L'estrusione dal suolo aperto (e non dal DSM) segue l'impostazione di scene.ts del riferimento.
 * Copyright (c) 2026 NVerlini
 * Il suolo e la camera condividono la nota MIT in geo.mjs e ground.mjs.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import earcut from "earcut";
import {
  RAW,
  aiutoStadio,
  areaPerId,
  caricaEnv,
  cartellaDerived,
  leggiAltezze,
  leggiAree,
  leggiPipeline,
  opzioni,
  richiediNode24,
} from "./config.mjs";
import {
  pistaPrevista,
  scegliAltezza,
  statoAerialway,
  tipologia,
} from "./altezze.mjs";
import { areaM2, bboxInterseca, centroide, creaQuadro, distanzaAnello, nelPoligono } from "./geo.mjs";
import { ePiantaTorre, separaTorre } from "./torri.mjs";
import { solidiPonte } from "./ponte.mjs";
import { classeVegetazione, avvisiGeometria, testoAvvisi } from "./vegetazione.mjs";
import { meshVuoto, scriviGlb } from "./glb.mjs";
import { ErrorePrevisto } from "./overpass.mjs";
import { edificiDi, eEdificio, idOsm, lineaDi, puntoDi } from "./osm.mjs";
import { COLORI, coloreClasse, linea, riempi, scriviPng, tela, testo } from "./png.mjs";

const LARGHEZZA = {
  motorway: 12, trunk: 10, primary: 8, secondary: 7, tertiary: 6.5,
  unclassified: 5, residential: 5, living_street: 4.5, service: 3.5,
  pedestrian: 5, footway: 1.8, path: 1.4, steps: 2.2, track: 3.2,
  cycleway: 2, bridleway: 2, corridor: 2,
};

function larghezza(tags) {
  const classe = String(tags.highway ?? "").replace(/_link$/, "");
  return LARGHEZZA[classe] ?? LARGHEZZA[tags.highway] ?? 4;
}

function leggi(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function esisteJson(file) {
  if (!existsSync(file)) return null;
  return leggi(file);
}

function campiona(griglia, nx, ny, x0, y0, passo, e, n) {
  const fx = (e - x0) / passo;
  const fy = (n - y0) / passo;
  if (fx < 0 || fy < 0 || fx > nx - 1 || fy > ny - 1) return null;
  const ix = Math.min(nx - 2, Math.floor(fx));
  const iy = Math.min(ny - 2, Math.floor(fy));
  const ax = fx - ix;
  const ay = fy - iy;
  const v = (x, y) => griglia[y * nx + x];
  return (v(ix, iy) * (1 - ax) + v(ix + 1, iy) * ax) * (1 - ay)
    + (v(ix, iy + 1) * (1 - ax) + v(ix + 1, iy + 1) * ax) * ay;
}

function grondaDi(elemento) {
  const quote = [];
  for (const anello of elemento.anelli ?? []) {
    for (const p of anello) {
      if (p[2] != null && p[2] > 200 && p[2] < 2500) quote.push(p[2]);
    }
  }
  if (quote.length < 3) return null;
  return {
    gronda: Math.min(...quote),
    colmo: Math.max(...quote),
    centro: centroide(elemento.anelli[0].map((p) => [p[0], p[1]])),
  };
}

function aggiungiTetto(mesh, anello, basi, tetti, colore) {
  const aperti = anello.slice(0, -1);
  if (aperti.length < 3) return;
  const flat = [];
  for (const p of aperti) flat.push(p[0], p[1]);
  const idx = earcut(flat);
  if (!idx?.length) return;
  const verts = aperti.map((p, i) => [p[0], tetti[i], -p[1]]);
  mesh.aggiungi(verts, colore, idx);
  const muri = [];
  const verticiMuro = [];
  for (let i = 0; i < aperti.length; i++) {
    const j = (i + 1) % aperti.length;
    const a = aperti[i];
    const b = aperti[j];
    const base = verticiMuro.length;
    verticiMuro.push(
      [a[0], basi[i], -a[1]],
      [b[0], basi[j], -b[1]],
      [b[0], tetti[j], -b[1]],
      [a[0], tetti[i], -a[1]],
    );
    muri.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  mesh.aggiungi(verticiMuro, colore, muri);
}

function cono(mesh, e, n, z0, altezza, raggio, colore) {
  const lati = 6;
  const verts = [[e, z0 + altezza, -n]];
  for (let i = 0; i < lati; i++) {
    const a = (i / lati) * Math.PI * 2;
    verts.push([e + Math.cos(a) * raggio, z0, -(n + Math.sin(a) * raggio)]);
  }
  const idx = [];
  for (let i = 0; i < lati; i++) idx.push(0, 1 + i, 1 + ((i + 1) % lati));
  mesh.aggiungi(verts, colore, idx);
}

function scenaArea(area, config, pipeline, altezze) {
  console.log(`scene ${area.id}`);
  const regione = pipeline.regione;
  const quadro = creaQuadro(regione);
  const raw = path.join(RAW, area.id);
  const groundDir = cartellaDerived(area.id, "ground");
  const meta = leggi(path.join(groundDir, "meta.json"));
  const suolo = leggiFloat32(path.join(groundDir, "height.bin"));
  const cover = leggiByte(path.join(groundDir, "landcover.bin"));
  const osm = leggi(path.join(raw, "osm.json"));
  const ctr = leggi(path.join(raw, "ctrn.json"));
  const unvol = esisteJson(path.join(raw, "unvol.json"));
  const unvol2020 = esisteJson(path.join(raw, "unvol-2020.json"));
  const { nx, ny, x0, y0, passoM } = meta;

  const dtm = (e, n) => campiona(suolo, nx, ny, x0, y0, passoM, e, n);

  const landmarkPerOsm = new Map();
  for (const lm of config.landmark) landmarkPerOsm.set(lm.osm, lm);
  const coperture = (ctr.stato === "ok" ? ctr.elementi : []).map(grondaDi).filter(Boolean);
  const volumi2014 = (unvol?.stato === "ok" ? unvol.elementi : []).map((v) => ({ ...v, fonte: v.fonte ?? "dbgt-2014" }));
  const volumi2020 = (unvol2020?.stato === "ok" ? unvol2020.elementi : []).map((v) => ({ ...v, fonte: "dbgt-2020" }));
  const volumi = volumi2014.concat(volumi2020);
  const volumiPerCella = indicizza(volumi);

  const edifici = [];
  const visti = new Set();
  for (const el of osm.elements ?? []) {
    const oid = idOsm(el);
    const lm = landmarkPerOsm.get(oid);
    const volumi = edificiDi(el);
    if (!volumi.length) continue;
    if (!eEdificio(el.tags) && !lm) continue;
    if (lm?.id === "ponte-san-francesco") continue;
    for (const volume of volumi) {
      const anello = volume.anello;
      if (!bboxInterseca(anello, area.bbox)) continue;
      const superficie = areaM2(anello, quadro.piano);
      if (superficie < 12 && !lm) continue;
      const centro = centroide(anello);
      const [ce, cn] = quadro.piano(centro[0], centro[1]);
      const suoloM = dtm(ce, cn);
      const agganciati = volumiEdificio(anello, volumiPerCella, quadro, superficie);
      for (const vol of agganciati.volumi) {
        if (Number.isFinite(vol._e) || !vol.centro) continue;
        const [e, n] = quadro.piano(vol.centro[0], vol.centro[1]);
        vol._e = e;
        vol._n = n;
      }
      const split = separaTorre(agganciati.volumi, superficie);
      const unitaM = split.corpo?.h ?? null;
      const fonteVolume = split.corpo?.fonte ?? null;
      const aggancio = agganciati.aggancio;
      let ctrM = null;
      let quotaGronda = null;
      let quotaColmo = null;
      if (unitaM == null) {
        for (const cop of coperture) {
          if (!nelPoligono(cop.centro, anello)) continue;
          if (suoloM == null) continue;
          const h = cop.gronda - suoloM;
          if (ctrM == null || h > ctrM) {
            ctrM = h;
            quotaGronda = cop.gronda;
            quotaColmo = cop.colmo;
          }
        }
      }
      const scelta = scegliAltezza({ tags: el.tags ?? {}, unitaM, ctrM, landmarkId: lm?.id ?? null, altezze });
      const chiave = `${oid}:${centro[0].toFixed(5)}:${centro[1].toFixed(5)}`;
      if (visti.has(chiave)) continue;
      visti.add(chiave);
      edifici.push({
        id: oid,
        nome: el.tags?.name ?? lm?.nome ?? null,
        landmark: lm?.id ?? null,
        tipologia: tipologia(el.tags ?? {}),
        anello,
        buchi: volume.buchi ?? [],
        superficieM2: Math.round(superficie),
        suoloM: suoloM == null ? null : Math.round(suoloM * 10) / 10,
        altezzaM: scelta.altezzaM,
        fonteAltezza: scelta.fonteAltezza,
        fonteVolume: scelta.fonteAltezza === "ctr-unita" ? fonteVolume : null,
        aggancio,
        parti: partiEdificio({ anello, buchi: volume.buchi ?? [], scelta, split }),
        quotaGrondaM: quotaGronda,
        quotaColmoM: quotaColmo,
        livelli: el.tags?.["building:levels"] ?? null,
      });
    }
  }

  const integrazione = integraVolumiOrfani(volumi2014, volumi2020, edifici, quadro);
  for (const ed of integrazione.edifici) {
    const centro = centroide(ed.anello);
    const [ce, cn] = quadro.piano(centro[0], centro[1]);
    const suoloM = dtm(ce, cn);
    ed.suoloM = suoloM == null ? null : Math.round(suoloM * 10) / 10;
    edifici.push(ed);
  }

  const strade = [];
  const piste = [];
  const impianti = [];
  const poi = [];
  const alberi = [];
  const ponti = [];
  for (const el of osm.elements ?? []) {
    const tags = el.tags ?? {};
    const oid = idOsm(el);
    const linea = lineaDi(el);
    if (tags.highway && linea && bboxInterseca(linea, area.bbox)) {
      const voce = {
        id: oid,
        nome: tags.name ?? null,
        classe: tags.highway,
        ponte: tags.bridge === "yes",
        larghezzaM: larghezza(tags),
        linea,
        landmark: landmarkPerOsm.get(oid)?.id ?? null,
      };
      strade.push(voce);
      if (voce.landmark === "ponte-san-francesco" || (tags.bridge === "yes" && tags.name)) {
        ponti.push({
          ...voce,
          spessoreM: altezze.ponteSpessoreM,
          nota: voce.landmark === "ponte-san-francesco"
            ? "Arco singolo sulle spalle della spezzata OSM. Il piano non segue il fondovalle. Spessore e freccia non sono misure."
            : voce.landmark ? altezze.notaPonte : null,
        });
      }
    }
    if (tags["piste:type"] && linea && bboxInterseca(linea, area.bbox)) {
      piste.push({
        id: oid,
        nome: tags.name ?? null,
        tipo: tags["piste:type"],
        linea,
      });
    }
    if (tags.aerialway) {
      const geometria = linea ?? (puntoDi(el) ? [puntoDi(el)] : null);
      if (geometria && bboxInterseca(geometria, area.bbox)) {
        impianti.push({
          id: oid,
          nome: tags.name ?? null,
          aerialway: tags.aerialway,
          stato: statoAerialway(oid, config.monteLivata),
          geometria,
        });
      }
    }
    if ((tags.amenity || tags.tourism || tags.historic) && tags.name) {
      const punto = puntoDi(el);
      if (punto && punto[1] >= area.bbox[0] && punto[1] <= area.bbox[2] && punto[0] >= area.bbox[1] && punto[0] <= area.bbox[3]) {
        poi.push({
          id: oid,
          nome: tags.name,
          amenity: tags.amenity ?? null,
          tourism: tags.tourism ?? null,
          historic: tags.historic ?? null,
          punto,
        });
      }
    }
    if (tags.natural === "tree" && el.type === "node") {
      const punto = puntoDi(el);
      if (!punto || !bboxInterseca([punto], area.bbox)) continue;
      const [e, n] = quadro.piano(punto[0], punto[1]);
      const suoloM = dtm(e, n);
      if (suoloM == null) continue;
      const hTag = Number(tags.height);
      const suoloArrot = Math.round(suoloM * 10) / 10;
      alberi.push({
        lon: punto[0],
        lat: punto[1],
        altezzaM: Number.isFinite(hTag) && hTag > 0 ? hTag : altezze.alberoDefaultM,
        fonte: Number.isFinite(hTag) && hTag > 0 ? "osm" : "default",
        leafType: tags.leaf_type ?? null,
        classeVegetazione: classeVegetazione({
          worldcover: 0,
          leafType: tags.leaf_type,
          quotaOrtometrica: suoloArrot,
        }),
        raggioM: 2.2,
        suoloM: suoloArrot,
      });
    }
  }

  const boschi = [];
  for (const el of osm.elements ?? []) {
    const tags = el.tags ?? {};
    if (tags.natural !== "wood" && tags.landuse !== "forest") continue;
    if (el.type !== "way" && el.type !== "relation") continue;
    for (const item of edificiDi(el)) {
      if (!item.anello || item.anello.length < 4) continue;
      const c = centroide(item.anello);
      const [e, n] = quadro.piano(c[0], c[1]);
      const suoloGrezzo = dtm(e, n);
      const suoloM = suoloGrezzo == null ? null : Math.round(suoloGrezzo * 10) / 10;
      boschi.push({
        id: idOsm(el),
        leafType: tags.leaf_type ?? null,
        anello: item.anello,
        suoloM,
        classeVegetazione: classeVegetazione({
          worldcover: 10,
          leafType: tags.leaf_type,
          quotaOrtometrica: suoloM,
        }),
      });
    }
  }

  const occupato = new Uint8Array(nx * ny);
  for (const ed of edifici) {
    const parti = ed.parti?.length ? ed.parti : [{ anello: ed.anello }];
    for (const parte of parti) {
      const piano = parte.anello.map(([lon, lat]) => quadro.piano(lon, lat));
      marcaPoligono(occupato, nx, ny, x0, y0, passoM, piano);
    }
  }
  for (const strada of strade) {
    if (["footway", "path", "steps", "cycleway"].includes(strada.classe)) continue;
    const pts = strada.linea.map(([lon, lat]) => quadro.piano(lon, lat));
    const mezzo = Math.max(2, strada.larghezzaM / 2);
    for (let k = 1; k < pts.length; k++) {
      const ax = pts[k - 1][0];
      const ay = pts[k - 1][1];
      const bx = pts[k][0];
      const by = pts[k][1];
      const ix0 = Math.max(0, Math.floor((Math.min(ax, bx) - mezzo - x0) / passoM));
      const ix1 = Math.min(nx - 1, Math.ceil((Math.max(ax, bx) + mezzo - x0) / passoM));
      const iy0 = Math.max(0, Math.floor((Math.min(ay, by) - mezzo - y0) / passoM));
      const iy1 = Math.min(ny - 1, Math.ceil((Math.max(ay, by) + mezzo - y0) / passoM));
      const dx = bx - ax;
      const dy = by - ay;
      const l2 = dx * dx + dy * dy || 1;
      for (let iy = iy0; iy <= iy1; iy++) {
        const nord = y0 + iy * passoM;
        for (let ix = ix0; ix <= ix1; ix++) {
          if (occupato[iy * nx + ix]) continue;
          const e = x0 + ix * passoM;
          let t = ((e - ax) * dx + (nord - ay) * dy) / l2;
          t = Math.max(0, Math.min(1, t));
          if (Math.hypot(e - (ax + t * dx), nord - (ay + t * dy)) <= mezzo) occupato[iy * nx + ix] = 2;
        }
      }
    }
  }

  let forestali = 0;
  for (let iy = 1; iy < ny - 1; iy++) {
    for (let ix = 1; ix < nx - 1; ix++) {
      const i = iy * nx + ix;
      const codice = cover[i];
      if (codice !== 10 && codice !== 20) continue;
      if (occupato[i]) continue;
      const e = x0 + ix * passoM;
      const nord = y0 + iy * passoM;
      const suoloM = suolo[i];
      const suoloArrot = Math.round(suoloM * 10) / 10;
      alberi.push({
        lon: null,
        lat: null,
        e,
        n: nord,
        altezzaM: codice === 10 ? altezze.chiomaForestaM : altezze.arbustoM,
        fonte: codice === 10 ? "worldcover-alberi" : "worldcover-arbusti",
        leafType: null,
        classeVegetazione: classeVegetazione({
          worldcover: codice,
          leafType: null,
          quotaOrtometrica: suoloArrot,
        }),
        raggioM: codice === 10 ? 3.2 : 1.4,
        suoloM: suoloArrot,
      });
      forestali++;
    }
  }

  const elementiPrevisti = area.id === "monte-livata" ? [pistaPrevista(config.monteLivata)].filter(Boolean) : [];
  const fonti = { "ctr-unita": 0, "ctr-gronda": 0, "building:levels": 0, "default-tipologia": 0 };
  for (const ed of edifici) fonti[ed.fonteAltezza] = (fonti[ed.fonteAltezza] ?? 0) + 1;
  const torri = edifici.flatMap((ed) => (ed.parti ?? []).filter((p) => p.ruolo === "torre").map((p) => ({
    id: ed.id,
    nome: ed.nome,
    altezzaM: p.altezzaM,
    corpoM: ed.altezzaM,
  })));
  const da2020 = edifici.filter((ed) => ed.fonteVolume === "dbgt-2020").length;
  const dbgt2014 = edifici.filter((ed) => ed.fonte === "dbgt-2014").length;
  const dbgt2020 = edifici.filter((ed) => ed.fonte === "dbgt-2020").length;

  const landmark = config.landmark.map((lm) => {
    const disegnato = edifici.find((ed) => ed.landmark === lm.id) ?? ponti.find((p) => p.landmark === lm.id);
    const nelBbox = lm.area === area.id || Boolean(disegnato);
    let stato = "fuori-bbox";
    if (disegnato) stato = "disegnato";
    else if (lm.area === area.id) stato = "mancante";
    return {
      id: lm.id,
      nome: lm.nome,
      osm: lm.osm,
      area: lm.area,
      stato,
      altezzaM: disegnato?.altezzaM ?? null,
      fonteAltezza: disegnato?.fonteAltezza ?? null,
      nelBbox,
    };
  });

  const out = cartellaDerived(area.id, "scene");
  const documento = {
    area: area.id,
    nome: area.nome,
    bbox: area.bbox,
    generato: new Date().toISOString(),
    attribuzioni: [
      "© contributori OpenStreetMap, ODbL",
      "© Regione Lazio, DBGT, CC BY 4.0",
      "Copernicus Sentinel-2, CC BY 4.0, via Geoportale Regione Lazio",
      "Ortofoto AGEA 2023, CC BY 4.0, via Geoportale Regione Lazio",
      "© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium",
      "Copernicus DEM GLO-30 © DLR e Airbus, programma Copernicus dell'Unione Europea",
    ],
    ctr: {
      wfs: { stato: ctr.stato, elementi: ctr.elementi?.length ?? 0, errore: ctr.errore ?? null },
      unita: { stato: unvol?.stato ?? "assente", elementi: volumi2014.length, schema: unvol?.schema ?? null, errore: unvol?.errore ?? null },
      unita2020: { stato: unvol2020?.stato ?? "assente", elementi: volumi2020.length, errore: unvol2020?.errore ?? null },
    },
    conteggi: {
      edifici: edifici.length,
      altezze: fonti,
      torri: torri.length,
      volumi2020: da2020,
      edificiOsm: edifici.length - dbgt2014 - dbgt2020,
      edificiDbgt: dbgt2014 + dbgt2020,
      edificiDbgt2014: dbgt2014,
      edificiDbgt2020: dbgt2020,
      volumiOrfani: integrazione.orfani,
      volumiScartatiPiccoli: integrazione.scartatiPiccoli,
      sogliaVolumiOrfani: SOGLIA_VOLUMI_ORFANI,
      strade: strade.length,
      alberiOsm: alberi.filter((a) => a.fonte === "osm" || a.fonte === "default").length,
      alberiWorldcover: forestali,
      faggeta: alberi.filter((a) => a.classeVegetazione === "faggeta").length + boschi.filter((b) => b.classeVegetazione === "faggeta").length,
      boschi: boschi.length,
      poi: poi.length,
      piste: piste.length,
      impianti: impianti.length,
      ponti: ponti.length,
    },
    edifici,
    strade,
    ponti,
    piste,
    impianti,
    poi,
    boschi,
    alberi: alberi.map((a) => ({
      lat: a.lat,
      lon: a.lon,
      e: a.e ?? null,
      n: a.n ?? null,
      altezzaM: a.altezzaM,
      raggioM: a.raggioM,
      fonte: a.fonte,
      leafType: a.leafType ?? null,
      classeVegetazione: a.classeVegetazione ?? null,
      suoloM: a.suoloM,
    })),
    elementiPrevisti,
    landmark,
  };
  writeFileSync(path.join(out, "scene.json"), JSON.stringify(documento));

  const mesh = meshVuoto();
  aggiungiTerreno(mesh, { nx, ny, x0, y0, passoM, suolo, cover, quadro });
  for (const ed of edifici) {
    for (const parte of ed.parti ?? [{ ruolo: "corpo", anello: ed.anello, altezzaM: ed.altezzaM, buchi: ed.buchi }]) {
      const anello = parte.anello.map(([lon, lat]) => quadro.piano(lon, lat));
      const basi = [];
      const tetti = [];
      for (const [e, n] of anello) {
        const q = dtm(e, n) ?? ed.suoloM ?? meta.quotaMin;
        const z = quadro.suOrtometrico(e, n, q);
        basi.push(z);
        tetti.push(z + parte.altezzaM);
      }
      const colore = parte.ruolo === "torre"
        ? [0.55, 0.32, 0.28]
        : ed.landmark
          ? [0.72, 0.22, 0.18]
          : [0.62, 0.38, 0.3];
      aggiungiTetto(mesh, anello, basi, tetti, colore);
    }
  }
  for (const ponte of ponti) {
    const pts = ponte.linea.map(([lon, lat]) => quadro.piano(lon, lat));
    if (ponte.landmark === "ponte-san-francesco" && pts.length >= 2) {
      const quote = pts.map(([e, n]) => {
        const q = dtm(e, n);
        return q == null ? null : quadro.suOrtometrico(e, n, q);
      });
      if (quote.every((q) => q != null)) {
        const solido = solidiPonte(pts, quote, {
          larghezzaM: ponte.larghezzaM ?? altezze.ponteLarghezzaM,
          spessoreM: ponte.spessoreM ?? altezze.ponteSpessoreM,
          frecciaMaxM: 9,
        });
        for (const faccia of solido.facce) {
          mesh.aggiungi(
            faccia.verts.map(([e, n, z]) => [e, z, -n]),
            faccia.colore,
            [0, 1, 2, 0, 2, 3],
          );
        }
        continue;
      }
    }
    const mezzo = (ponte.larghezzaM ?? altezze.ponteLarghezzaM) / 2;
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1];
      const [bx, by] = pts[i];
      const dx = bx - ax;
      const dy = by - ay;
      const len = Math.hypot(dx, dy) || 1;
      const px = (-dy / len) * mezzo;
      const py = (dx / len) * mezzo;
      const qa = dtm(ax, ay) ?? meta.quotaMin;
      const qb = dtm(bx, by) ?? meta.quotaMin;
      const za = quadro.suOrtometrico(ax, ay, qa) + altezze.ponteSpessoreM;
      const zb = quadro.suOrtometrico(bx, by, qb) + altezze.ponteSpessoreM;
      const anello = [
        [ax + px, ay + py],
        [bx + px, by + py],
        [bx - px, by - py],
        [ax - px, ay - py],
        [ax + px, ay + py],
      ];
      aggiungiTetto(mesh, anello, [za, zb, zb, za, za], [za + 0.4, zb + 0.4, zb + 0.4, za + 0.4, za + 0.4], [0.25, 0.38, 0.55]);
    }
  }
  const alberiMesh = alberi.length > 6000 ? alberi.filter((_, i) => i % 2 === 0) : alberi;
  for (const albero of alberiMesh) {
    const e = albero.e ?? quadro.piano(albero.lon, albero.lat)[0];
    const n = albero.n ?? quadro.piano(albero.lon, albero.lat)[1];
    const q = dtm(e, n) ?? albero.suoloM;
    if (q == null) continue;
    const z = quadro.suOrtometrico(e, n, q);
    const colore = albero.fonte === "worldcover-arbusti" ? [0.45, 0.58, 0.28] : [0.18, 0.42, 0.22];
    cono(mesh, e, n, z, albero.altezzaM, albero.raggioM, colore);
  }
  const congelato = mesh.congela();
  if (congelato.indici.length > 0) scriviGlb(path.join(out, "scena.glb"), congelato);

  scriviPiano(path.join(out, "anteprima.png"), {
    area, meta, cover, suolo, quadro, edifici, strade, ponti, lineeAcqua: leggi(path.join(groundDir, "features.json")),
  });
  scriviIso(path.join(out, "anteprima-isometrica.png"), {
    meta, suolo, cover, quadro, regione, edifici, dtm,
  });

  const avvisi = avvisiGeometria({ edifici });
  avvisi.volumiOrfani = integrazione.orfani;
  avvisi.sogliaVolumiOrfani = SOGLIA_VOLUMI_ORFANI;
  avvisi.avvisoVolumiOrfani = avvisoVolumiOrfani(integrazione.orfani);
  const report = {
    area: area.id,
    conteggi: documento.conteggi,
    landmark,
    ctr: documento.ctr,
    impianti: impianti.map((i) => ({ id: i.id, nome: i.nome, stato: i.stato, aerialway: i.aerialway })),
    piste: piste.map((p) => ({ id: p.id, nome: p.nome, tipo: p.tipo })),
    elementiPrevisti,
    torri,
    volumi2020: da2020,
    avvisi,
    output: ["scene.json", "anteprima.png", "anteprima-isometrica.png", "scena.glb"],
  };
  writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  for (const riga of testoAvvisi(avvisi)) console.log(`  ${riga}`);
  console.log(`  edifici ${edifici.length} (OSM ${documento.conteggi.edificiOsm}, DBGT ${dbgt2014 + dbgt2020} di cui 2014 ${dbgt2014} e 2020 ${dbgt2020}; CTR unità ${fonti["ctr-unita"]}, gronda ${fonti["ctr-gronda"]}, livelli ${fonti["building:levels"]}, default ${fonti["default-tipologia"]})`);
  console.log(`  volumi DBGT orfani ${integrazione.orfani}, scartati sotto 12 m² ${integrazione.scartatiPiccoli}`);
  console.log(`  torri staccate dal corpo: ${torri.length}`);
  for (const torre of torri) console.log(`    ${torre.nome ?? torre.id}: corpo ${torre.corpoM} m, torre ${torre.altezzaM} m`);
  console.log(`  alberi OSM ${documento.conteggi.alberiOsm}, WorldCover ${forestali}, strade ${strade.length}`);
  for (const lm of landmark) {
    console.log(`  landmark ${lm.nome}: ${lm.stato}${lm.fonteAltezza ? ` (${lm.fonteAltezza}, ${lm.altezzaM} m)` : ""}`);
  }
  for (const imp of impianti) console.log(`  aerialway ${imp.nome ?? imp.id}: ${imp.stato}`);
  for (const prev of elementiPrevisti) console.log(`  previsto ${prev.nome}: geometria ${prev.geometria}, stato ${prev.stato}`);
  console.log(`  scritto ${out}`);
  return report;
}

function marcaPoligono(mask, nx, ny, x0, y0, passo, piano) {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of piano) {
    minY = Math.min(minY, p[1]);
    maxY = Math.max(maxY, p[1]);
  }
  const iy0 = Math.max(0, Math.floor((minY - y0) / passo));
  const iy1 = Math.min(ny - 1, Math.ceil((maxY - y0) / passo));
  for (let iy = iy0; iy <= iy1; iy++) {
    const y = y0 + iy * passo;
    const xs = [];
    for (let i = 0, j = piano.length - 1; i < piano.length; j = i++) {
      const [x1, y1] = piano[i];
      const [x2, y2] = piano[j];
      if ((y1 > y) === (y2 > y)) continue;
      xs.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const ix0 = Math.max(0, Math.ceil((xs[k] - x0) / passo));
      const ix1 = Math.min(nx - 1, Math.floor((xs[k + 1] - x0) / passo));
      for (let ix = ix0; ix <= ix1; ix++) mask[iy * nx + ix] = 1;
    }
  }
}

function aggiungiTerreno(mesh, ctx) {
  const passo = ctx.passoM * 2;
  const colonne = Math.ceil(((ctx.nx - 1) * ctx.passoM) / passo);
  const righe = Math.ceil(((ctx.ny - 1) * ctx.passoM) / passo);
  const verts = [];
  const quote = [];
  for (let iy = 0; iy <= righe; iy++) {
    for (let ix = 0; ix <= colonne; ix++) {
      const e = ctx.x0 + Math.min(ctx.nx - 1, (ix * passo) / ctx.passoM) * ctx.passoM;
      const n = ctx.y0 + Math.min(ctx.ny - 1, (iy * passo) / ctx.passoM) * ctx.passoM;
      const q = campiona(ctx.suolo, ctx.nx, ctx.ny, ctx.x0, ctx.y0, ctx.passoM, e, n) ?? 0;
      const z = ctx.quadro.suOrtometrico(e, n, q);
      verts.push([e, z, -n]);
      quote.push(q);
    }
  }
  const idx = [];
  const colori = [];
  const stride = colonne + 1;
  for (let iy = 0; iy < righe; iy++) {
    for (let ix = 0; ix < colonne; ix++) {
      const a = iy * stride + ix;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  let min = Infinity;
  let max = -Infinity;
  for (const q of quote) {
    min = Math.min(min, q);
    max = Math.max(max, q);
  }
  const span = Math.max(1, max - min);
  for (const q of quote) {
    const t = (q - min) / span;
    colori.push(0.45 + t * 0.25, 0.55 + (1 - t) * 0.15, 0.32);
  }
  const base = mesh.posizioni.length / 3;
  for (let i = 0; i < verts.length; i++) {
    mesh.posizioni.push(...verts[i]);
    mesh.colori.push(colori[i * 3], colori[i * 3 + 1], colori[i * 3 + 2]);
  }
  for (const id of idx) mesh.indici.push(base + id);
}

function scriviPiano(file, ctx) {
  const { nx, ny, x0, y0, passoM } = ctx.meta;
  const scala = Math.max(2, Math.min(5, Math.floor(1400 / nx)));
  const w = nx * scala;
  const h = ny * scala;
  const t = tela(w, h, COLORI.fondo);
  const cover = ctx.cover;
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      const colore = coloreClasse(cover[iy * nx + ix]);
      const yImg = (ny - 1 - iy) * scala;
      for (let dy = 0; dy < scala; dy++) {
        for (let dx = 0; dx < scala; dx++) t.pixel(ix * scala + dx, yImg + dy, colore);
      }
    }
  }
  const aPx = (lon, lat) => {
    const [e, n] = ctx.quadro.piano(lon, lat);
    return [((e - x0) / passoM) * scala, (ny - 1 - (n - y0) / passoM) * scala];
  };
  for (const fiume of ctx.lineeAcqua.acquaLinee ?? []) {
    const pts = fiume.linea.map(([lon, lat]) => aPx(lon, lat));
    for (let i = 1; i < pts.length; i++) linea(t, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], COLORI.acqua, 2);
    if (fiume.nome && pts.length) testo(t, pts[0][0] + 4, pts[0][1] + 4, fiume.nome, COLORI.ponte, 2);
  }
  for (const strada of ctx.strade) {
    if (strada.landmark) continue;
    const pts = strada.linea.map(([lon, lat]) => aPx(lon, lat));
    const spesso = Math.max(1, Math.round(strada.larghezzaM / 4));
    for (let i = 1; i < pts.length; i++) linea(t, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], COLORI.strada, spesso);
  }
  for (const ed of ctx.edifici) {
    const parti = ed.parti?.length ? ed.parti : [{ ruolo: "corpo", anello: ed.anello }];
    for (const parte of parti) {
      const pts = parte.anello.map(([lon, lat]) => aPx(lon, lat));
      const colore = parte.ruolo === "torre" ? [120, 64, 52] : ed.landmark ? COLORI.landmark : COLORI.edificio;
      riempi(t, pts, colore);
    }
    if (ed.landmark && ed.nome) {
      const c = centroide(ed.anello);
      const [x, y] = aPx(c[0], c[1]);
      testo(t, x + 4, y - 16, ed.nome, COLORI.testo, 2);
    }
  }
  for (const ponte of ctx.ponti) {
    const pts = ponte.linea.map(([lon, lat]) => aPx(lon, lat));
    for (let i = 1; i < pts.length; i++) linea(t, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], COLORI.ponte, 3);
    if (ponte.nome && pts.length) testo(t, pts[0][0] + 4, pts[Math.floor(pts.length / 2)][1] - 14, ponte.nome, COLORI.ponte, 2);
  }
  testo(t, 12, 12, ctx.area.id.replaceAll("-", " "), COLORI.testo, 3);
  testo(t, 12, h - 28, "N", COLORI.testo, 3);
  linea(t, 28, h - 36, 28, h - 70, COLORI.testo, 1);
  scriviPng(file, w, h, t.rgb);
}

function scriviIso(file, ctx) {
  const { nx, ny, x0, y0, passoM } = ctx.meta;
  const punti = [];
  const celle = [];
  for (let iy = 0; iy < ny - 2; iy += 2) {
    for (let ix = 0; ix < nx - 2; ix += 2) {
      const e = x0 + ix * passoM;
      const n = y0 + iy * passoM;
      const q = ctx.suolo[iy * nx + ix];
      const z = ctx.quadro.suOrtometrico(e, n, q);
      const px = ctx.quadro.pixel(e, n, z);
      punti.push(px);
      celle.push({ e, n, q, px, classe: ctx.cover[iy * nx + ix] });
    }
  }
  for (const ed of ctx.edifici) {
    for (const parte of ed.parti ?? [{ anello: ed.anello, altezzaM: ed.altezzaM }]) {
      const c = centroide(parte.anello);
      const [e, n] = ctx.quadro.piano(c[0], c[1]);
      const q = ctx.dtm(e, n) ?? ed.suoloM ?? 0;
      const z = ctx.quadro.suOrtometrico(e, n, q) + parte.altezzaM;
      punti.push(ctx.quadro.pixel(e, n, z));
    }
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of punti) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const margine = 36;
  const scala = Math.min(1400 / Math.max(1, maxX - minX), 1000 / Math.max(1, maxY - minY));
  const w = Math.max(64, Math.ceil((maxX - minX) * scala) + margine * 2);
  const h = Math.max(64, Math.ceil((maxY - minY) * scala) + margine * 2);
  const t = tela(w, h, [214, 220, 226]);
  const proietta = (e, n, z) => {
    const [x, y] = ctx.quadro.pixel(e, n, z);
    return [(x - minX) * scala + margine, (y - minY) * scala + margine];
  };
  const heading = (ctx.regione.headingDeg * Math.PI) / 180;
  celle.sort((a, b) => (a.e * Math.sin(heading) + a.n * Math.cos(heading)) - (b.e * Math.sin(heading) + b.n * Math.cos(heading)));
  for (const cella of celle) {
    const z = ctx.quadro.suOrtometrico(cella.e, cella.n, cella.q);
    const p = proietta(cella.e, cella.n, z);
    t.disco(p[0], p[1], Math.max(2, scala * 8), coloreClasse(cella.classe));
  }
  const edifici = ctx.edifici.slice().sort((a, b) => {
    const ca = centroide(a.anello);
    const cb = centroide(b.anello);
    const pa = ctx.quadro.piano(ca[0], ca[1]);
    const pb = ctx.quadro.piano(cb[0], cb[1]);
    return (pa[0] * Math.sin(heading) + pa[1] * Math.cos(heading)) - (pb[0] * Math.sin(heading) + pb[1] * Math.cos(heading));
  });
  for (const ed of edifici) {
    const parti = ed.parti?.length ? ed.parti : [{ ruolo: "corpo", anello: ed.anello, altezzaM: ed.altezzaM }];
    for (const parte of parti) {
      const anello = parte.anello.map(([lon, lat]) => ctx.quadro.piano(lon, lat));
      const tetto = anello.map(([e, n]) => {
        const q = ctx.dtm(e, n) ?? ed.suoloM ?? 0;
        return proietta(e, n, ctx.quadro.suOrtometrico(e, n, q) + parte.altezzaM);
      });
      const piede = anello.map(([e, n]) => {
        const q = ctx.dtm(e, n) ?? ed.suoloM ?? 0;
        return proietta(e, n, ctx.quadro.suOrtometrico(e, n, q));
      });
      const muro = parte.ruolo === "torre" ? [110, 58, 48] : ed.landmark ? [120, 36, 32] : [140, 78, 62];
      const colmo = parte.ruolo === "torre" ? [168, 96, 78] : ed.landmark ? COLORI.landmark : [196, 122, 96];
      for (let i = 0; i < anello.length - 1; i++) {
        riempi(t, [piede[i], piede[i + 1], tetto[i + 1], tetto[i]], muro);
      }
      riempi(t, tetto, colmo);
    }
  }
  testo(t, 12, 12, "ISOMETRICA", COLORI.testo, 3);
  scriviPng(file, w, h, t.rgb);
}

export async function esegui(argv) {
  richiediNode24();
  caricaEnv();
  const config = leggiAree();
  const pipeline = leggiPipeline();
  const altezze = leggiAltezze();
  const opt = opzioni(argv, config.aree);
  if (opt.help) {
    aiutoStadio("scene");
    return;
  }
  console.log("Subiaco Isometrica — scene");
  for (const id of opt.ids) scenaArea(areaPerId(config, id), config, pipeline, altezze);
  console.log("scene completata. Output in data/derived/<area>/scene/.");
}

function partiEdificio({ anello, buchi, scelta, split }) {
  const corpo = {
    ruolo: "corpo",
    anello,
    buchi,
    altezzaM: scelta.altezzaM,
    fonteAltezza: scelta.fonteAltezza,
    areaM2: split.corpo?.areaM2 ?? null,
  };
  if (!split.torri.length) return [corpo];
  return [
    corpo,
    ...split.torri.map((vol) => ({
      ruolo: "torre",
      anello: vol.anello,
      buchi: [],
      altezzaM: Math.round(vol.h * 10) / 10,
      fonteAltezza: "ctr-unita",
      fonteVolume: vol.fonte ?? "dbgt-2014",
      areaM2: vol.areaM2 ?? null,
    })),
  ];
}

function volumiEdificio(anello, celle, quadro, superficie) {
  const piano = anello.map(([lon, lat]) => quadro.piano(lon, lat));
  const stretti = { "dbgt-2014": [], "dbgt-2020": [] };
  const rilassati = { "dbgt-2014": [], "dbgt-2020": [] };
  for (const vol of vicini(celle, anello)) {
    const fonte = vol.fonte === "dbgt-2020" ? "dbgt-2020" : "dbgt-2014";
    if (nelPoligono(vol.centro, anello)) {
      stretti[fonte].push(vol);
      continue;
    }
    const [e, n] = quadro.piano(vol.centro[0], vol.centro[1]);
    const dist = distanzaAnello([e, n], piano);
    const areaOk = !vol.areaM2 || vol.areaM2 < Math.max(80, superficie * 1.6);
    const verticeDentro = vol.anello?.some((p) => nelPoligono(p, anello));
    if (areaOk && (dist <= 6 || verticeDentro)) rilassati[fonte].push(vol);
  }
  if (stretti["dbgt-2014"].length) return { volumi: stretti["dbgt-2014"], aggancio: "centroide-2014" };
  if (stretti["dbgt-2020"].length) return { volumi: stretti["dbgt-2020"], aggancio: "centroide-2020" };
  if (rilassati["dbgt-2014"].length) return { volumi: rilassati["dbgt-2014"], aggancio: "vicino-2014" };
  if (rilassati["dbgt-2020"].length) return { volumi: rilassati["dbgt-2020"], aggancio: "vicino-2020" };
  return { volumi: [], aggancio: null };
}

function indicizza(volumi) {
  const celle = new Map();
  for (const vol of volumi) {
    const k = `${Math.floor(vol.centro[0] * 400)}:${Math.floor(vol.centro[1] * 400)}`;
    if (!celle.has(k)) celle.set(k, []);
    celle.get(k).push(vol);
  }
  return celle;
}

function vicini(celle, anello) {
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of anello) {
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }
  const fuori = [];
  for (let x = Math.floor(minLon * 400); x <= Math.floor(maxLon * 400); x++) {
    for (let y = Math.floor(minLat * 400); y <= Math.floor(maxLat * 400); y++) {
      const lista = celle.get(`${x}:${y}`);
      if (lista) fuori.push(...lista);
    }
  }
  return fuori;
}

function leggiFloat32(file) {
  const buf = readFileSync(file);
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

function leggiByte(file) {
  const buf = readFileSync(file);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

/** Stessa soglia di superficie delle impronte OSM e della porzione scoperta che diventa una parte. */
export const AREA_MIN_VOLUME_M2 = 12;
/** Due volumi dello stesso rilievo si uniscono se le piante distano al massimo così. */
export const ADIACENZA_VOLUME_M = 1.5;
/** Sopra questo numero di volumi orfani il report avvisa: la copertura OSM non basta. */
export const SOGLIA_VOLUMI_ORFANI = 50;
/** Sopra questa frazione dell'area del volume la pianta è già coperta e non si duplica. */
export const SOVRAPPOSIZIONE_MAX = 0.2;

export function avvisoVolumiOrfani(orfani, soglia = SOGLIA_VOLUMI_ORFANI) {
  if (!(orfani > soglia)) return null;
  return `attenzione: ${orfani} volumi DBGT non coperti da un edificio già tenuto (soglia ${soglia}). Entrano in scena come edifici dbgt-2014 o dbgt-2020.`;
}

function pianoDi(anello, quadro) {
  return anello.map(([lon, lat]) => quadro.piano(lon, lat));
}

function areaVolume(vol, quadro) {
  if (Number.isFinite(vol.areaM2)) return vol.areaM2;
  if (!vol.anello) return 0;
  return areaM2(vol.anello, quadro.piano);
}

function pianteVicine(a, b, adiacenzaM) {
  for (const p of a) {
    if (distanzaAnello(p, b) <= adiacenzaM) return true;
  }
  for (const p of b) {
    if (distanzaAnello(p, a) <= adiacenzaM) return true;
  }
  return false;
}

export function raggruppaVolumi(volumi, quadro, adiacenzaM = ADIACENZA_VOLUME_M) {
  const n = volumi.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const trova = (i) => {
    let x = i;
    while (parent[x] !== x) x = parent[x];
    parent[i] = x;
    return x;
  };
  const piani = volumi.map((vol) => pianoDi(vol.anello, quadro));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (pianteVicine(piani[i], piani[j], adiacenzaM)) parent[trova(i)] = trova(j);
    }
  }
  const gruppi = new Map();
  for (let i = 0; i < n; i++) {
    const radice = trova(i);
    if (!gruppi.has(radice)) gruppi.set(radice, []);
    gruppi.get(radice).push(volumi[i]);
  }
  return [...gruppi.values()];
}

function edificioDbgt(gruppo, fonte, indice) {
  const principale = gruppo.reduce((a, b) => ((b.areaM2 ?? 0) > (a.areaM2 ?? 0) ? b : a));
  const parti = gruppo.map((vol) => ({
    ruolo: "corpo",
    anello: vol.anello,
    buchi: [],
    altezzaM: Math.round(vol.h * 10) / 10,
    fonteAltezza: "ctr-unita",
    fonteVolume: fonte,
    areaM2: vol.areaM2 ?? null,
  }));
  return {
    id: `${fonte}:${indice}`,
    nome: null,
    landmark: null,
    tipologia: "dbgt",
    anello: principale.anello,
    buchi: [],
    superficieM2: gruppo.reduce((s, vol) => s + (vol.areaM2 ?? 0), 0),
    suoloM: null,
    altezzaM: Math.round(Math.max(...gruppo.map((vol) => vol.h)) * 10) / 10,
    fonteAltezza: "ctr-unita",
    fonteVolume: fonte,
    fonte,
    aggancio: gruppo.length > 1 ? "agglomerato" : "orfano",
    parti,
    quotaGrondaM: null,
    quotaColmoM: null,
    livelli: null,
  };
}

function anelloAperto(anello) {
  if (!anello?.length) return [];
  const a = anello[0];
  const b = anello[anello.length - 1];
  if (anello.length > 1 && a[0] === b[0] && a[1] === b[1]) return anello.slice(0, -1);
  return anello;
}

function areaSegnata(punti) {
  const base = anelloAperto(punti);
  let a = 0;
  for (let i = 0; i < base.length; i++) {
    const p = base[i];
    const q = base[(i + 1) % base.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

function versoPositivo(punti) {
  const base = anelloAperto(punti);
  return areaSegnata(base) < 0 ? base.slice().reverse() : base;
}

function convesso(punti) {
  let segno = 0;
  const n = punti.length;
  for (let i = 0; i < n; i++) {
    const a = punti[i];
    const b = punti[(i + 1) % n];
    const c = punti[(i + 2) % n];
    const z = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(z) < 1e-6) continue;
    const s = Math.sign(z);
    if (!segno) segno = s;
    else if (s !== segno) return false;
  }
  return true;
}

function intersezioneLati(s, e, a, b) {
  const dsx = e[0] - s[0];
  const dsy = e[1] - s[1];
  const dbx = b[0] - a[0];
  const dby = b[1] - a[1];
  const den = dsx * dby - dsy * dbx;
  if (Math.abs(den) < 1e-12) return [(s[0] + e[0]) / 2, (s[1] + e[1]) / 2];
  const t = ((a[0] - s[0]) * dby - (a[1] - s[1]) * dbx) / den;
  return [s[0] + t * dsx, s[1] + t * dsy];
}

function tagliaConvesso(soggetto, clip) {
  let output = soggetto;
  for (let i = 0; i < clip.length; i++) {
    if (!output.length) break;
    const a = clip[i];
    const b = clip[(i + 1) % clip.length];
    const input = output;
    output = [];
    for (let j = 0; j < input.length; j++) {
      const s = input[j];
      const e = input[(j + 1) % input.length];
      const sin = (b[0] - a[0]) * (s[1] - a[1]) - (b[1] - a[1]) * (s[0] - a[0]) >= -1e-8;
      const ein = (b[0] - a[0]) * (e[1] - a[1]) - (b[1] - a[1]) * (e[0] - a[0]) >= -1e-8;
      if (ein) {
        if (!sin) output.push(intersezioneLati(s, e, a, b));
        output.push(e);
      } else if (sin) output.push(intersezioneLati(s, e, a, b));
    }
  }
  return output;
}

function areaGriglia(a, b) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of a) {
    minX = Math.min(minX, p[0]);
    maxX = Math.max(maxX, p[0]);
    minY = Math.min(minY, p[1]);
    maxY = Math.max(maxY, p[1]);
  }
  const passo = Math.max(0.25, Math.max(maxX - minX, maxY - minY) / 40);
  let dentro = 0;
  let tot = 0;
  for (let y = minY + passo / 2; y < maxY; y += passo) {
    for (let x = minX + passo / 2; x < maxX; x += passo) {
      if (!nelPoligono([x, y], a)) continue;
      tot += 1;
      if (nelPoligono([x, y], b)) dentro += 1;
    }
  }
  if (!tot) return 0;
  return (dentro / tot) * Math.abs(areaSegnata(a));
}

function areaIntersezione(soggetto, clip) {
  const s = versoPositivo(soggetto);
  const c = versoPositivo(clip);
  if (s.length < 3 || c.length < 3) return 0;
  if (convesso(c)) return Math.abs(areaSegnata(tagliaConvesso(s, c)));
  if (convesso(s)) return Math.abs(areaSegnata(tagliaConvesso(c, s)));
  return areaGriglia(s, c);
}

export function frazioneSovrapposizione(anelloVol, anelloAltro, quadro) {
  const a = pianoDi(anelloAperto(anelloVol), quadro);
  const b = pianoDi(anelloAperto(anelloAltro), quadro);
  const propria = Math.abs(areaSegnata(a));
  if (!(propria > 0)) return 0;
  return areaIntersezione(a, b) / propria;
}

function anelliEdificio(ed) {
  if (ed.parti?.length) return ed.parti.map((p) => p.anello).filter(Boolean);
  return ed.anello ? [ed.anello] : [];
}

function rapportoConEdificio(vol, ed, quadro) {
  let frazione = 0;
  let dentro = false;
  for (const anello of anelliEdificio(ed)) {
    if (nelPoligono(vol.centro, anello)) dentro = true;
    frazione = Math.max(frazione, frazioneSovrapposizione(vol.anello, anello, quadro));
  }
  return { dentro, frazione, area: frazione * (vol.areaM2 ?? 0) };
}

function edificioPiuCoperto(vol, edifici, quadro) {
  let scelto = null;
  let area = 0;
  let frazione = 0;
  for (const ed of edifici) {
    const rapporto = rapportoConEdificio(vol, ed, quadro);
    if (!rapporto.dentro && !(rapporto.frazione > SOVRAPPOSIZIONE_MAX)) continue;
    if (!scelto || rapporto.area > area) {
      scelto = ed;
      area = rapporto.area;
      frazione = rapporto.frazione;
    }
  }
  return scelto ? { ed: scelto, frazione, area } : null;
}

function alzaCorpo(ed, h, fonte) {
  const altezza = Math.round(h * 10) / 10;
  if (!(altezza > (ed.altezzaM ?? 0) + 0.05)) return;
  ed.altezzaM = altezza;
  ed.fonteAltezza = "ctr-unita";
  ed.fonteVolume = fonte ?? ed.fonteVolume;
  if (!Array.isArray(ed.parti)) ed.parti = [];
  let corpo = ed.parti.find((p) => p.ruolo === "corpo" && p.anello === ed.anello)
    ?? ed.parti.find((p) => p.ruolo === "corpo");
  if (!corpo && ed.anello) {
    corpo = {
      ruolo: "corpo",
      anello: ed.anello,
      buchi: ed.buchi ?? [],
      altezzaM: altezza,
      fonteAltezza: "ctr-unita",
      fonteVolume: fonte ?? null,
      areaM2: ed.superficieM2 ?? null,
    };
    ed.parti.unshift(corpo);
  } else if (corpo) {
    corpo.altezzaM = altezza;
    corpo.fonteAltezza = "ctr-unita";
    corpo.fonteVolume = fonte ?? corpo.fonteVolume;
  }
}

function aggiungiParte(ed, vol, ruolo) {
  if (!Array.isArray(ed.parti)) ed.parti = [];
  const altezza = Math.round(vol.h * 10) / 10;
  const gia = ed.parti.find((p) => p.anello === vol.anello || (
    p.ruolo === ruolo
    && p.areaM2 != null
    && vol.areaM2 != null
    && Math.abs(p.areaM2 - vol.areaM2) <= 1
    && Math.abs(p.altezzaM - altezza) <= 0.2
  ));
  if (gia) {
    if (altezza > gia.altezzaM) {
      gia.altezzaM = altezza;
      gia.fonteAltezza = "ctr-unita";
      gia.fonteVolume = vol.fonte ?? gia.fonteVolume;
    }
    return;
  }
  ed.parti.push({
    ruolo,
    anello: vol.anello,
    buchi: [],
    altezzaM: altezza,
    fonteAltezza: "ctr-unita",
    fonteVolume: vol.fonte ?? "dbgt-2014",
    areaM2: vol.areaM2 ?? null,
  });
}

function applicaVolumiCoperti(volumi, edifici, quadro) {
  for (const vol of volumi) {
    const copertura = edificioPiuCoperto(vol, edifici, quadro);
    if (!copertura) continue;
    const { ed, frazione } = copertura;
    const torre = ePiantaTorre(vol, ed.superficieM2);
    if (!torre) alzaCorpo(ed, vol.h, vol.fonte);
    const scoperta = (vol.areaM2 ?? 0) * (1 - Math.min(1, frazione));
    if (torre || scoperta >= AREA_MIN_VOLUME_M2) aggiungiParte(ed, vol, torre ? "torre" : "corpo");
  }
}

function selezionaOrfani(volumi, edifici, quadro) {
  const orfani = [];
  const coperti = [];
  let scartatiPiccoli = 0;
  for (const vol of volumi) {
    if (!vol?.anello || !(vol.h > 0)) continue;
    const area = areaVolume(vol, quadro);
    if (area < AREA_MIN_VOLUME_M2) {
      scartatiPiccoli += 1;
      continue;
    }
    const centro = centroide(vol.anello);
    const candidato = { ...vol, centro, areaM2: vol.areaM2 ?? Math.round(area) };
    if (edificioPiuCoperto(candidato, edifici, quadro)) {
      coperti.push(candidato);
      continue;
    }
    orfani.push(candidato);
  }
  return { orfani, coperti, scartatiPiccoli };
}

/**
 * Edifici OSM già tenuti conservano la pianta. Un volume che cade dentro
 * o copre più del 20% di un edificio tenuto ne alza l'altezza e, se la
 * parte scoperta è almeno 12 m², resta come parte. Il 2020 si confronta
 * anche con i volumi 2014 tenuti e non apre un secondo edificio.
 */
export function integraVolumiOrfani(volumi2014, volumi2020, edificiOsm, quadro) {
  const prima = selezionaOrfani(volumi2014, edificiOsm, quadro);
  applicaVolumiCoperti(prima.coperti, edificiOsm, quadro);
  const gruppi2014 = raggruppaVolumi(prima.orfani, quadro);
  const edifici2014 = gruppi2014.map((gruppo, i) => edificioDbgt(gruppo, "dbgt-2014", i + 1));
  const base = edificiOsm.concat(edifici2014);
  const dopo = selezionaOrfani(volumi2020, base, quadro);
  applicaVolumiCoperti(dopo.coperti, base, quadro);
  const gruppi2020 = raggruppaVolumi(dopo.orfani, quadro);
  const edifici2020 = gruppi2020.map((gruppo, i) => edificioDbgt(gruppo, "dbgt-2020", i + 1));
  const orfani = prima.orfani.length + dopo.orfani.length;
  return {
    edifici: edifici2014.concat(edifici2020),
    orfani,
    scartatiPiccoli: prima.scartatiPiccoli + dopo.scartatiPiccoli,
    avviso: avvisoVolumiOrfani(orfani),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  esegui(process.argv.slice(2)).catch((err) => {
    console.error(err instanceof ErrorePrevisto ? err.message : err.stack || err.message);
    process.exit(1);
  });
}
