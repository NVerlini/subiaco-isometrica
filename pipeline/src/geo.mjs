/**
 * Proiezione locale ENU e pixel d'arte.
 * Adattato da pipeline/src/camera.ts di isometricworld e Mondo Isometrico (MIT).
 * Copyright (c) 2026 Dmytro Krasun
 * Copyright (c) 2026 Domenico Gagliardi
 * Copyright (c) 2026 NVerlini
 *
 * L'origine e l'heading arrivano da config/pipeline.json. Il render a tile resta in FASE 2:
 * qui la stessa matematica serve a suolo, scena, GLB e anteprima.
 */

const A = 6378137.0;
const F = 1 / 298.257223563;
const E2 = F * (2 - F);
const R_TERRA = 6371000;
const rad = (g) => (g * Math.PI) / 180;

export const STILE = { pitchDeg: 45, mpp: 0.25, tile: 1024 };

export function llhToEcef(lat, lon, h) {
  const φ = rad(lat);
  const λ = rad(lon);
  const N = A / Math.sqrt(1 - E2 * Math.sin(φ) ** 2);
  return [
    (N + h) * Math.cos(φ) * Math.cos(λ),
    (N + h) * Math.cos(φ) * Math.sin(λ),
    (N * (1 - E2) + h) * Math.sin(φ),
  ];
}

/**
 * Quadro ENU sull'origine della regione (h ellissoidica dell'origine, di solito 0).
 * `geoidM` converte una quota ortometrica Copernicus nell'altezza ellissoidica.
 */
export function creaQuadro(regione) {
  const { lat, lon, h } = regione.origine;
  const geoidM = regione.geoidM;
  const φ = rad(lat);
  const λ = rad(lon);
  const east = [-Math.sin(λ), Math.cos(λ), 0];
  const north = [-Math.sin(φ) * Math.cos(λ), -Math.sin(φ) * Math.sin(λ), Math.cos(φ)];
  const up = [Math.cos(φ) * Math.cos(λ), Math.cos(φ) * Math.sin(λ), Math.sin(φ)];
  const o = llhToEcef(lat, lon, h ?? 0);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  function ecefToEnu(p) {
    const d = [p[0] - o[0], p[1] - o[1], p[2] - o[2]];
    return [dot(east, d), dot(north, d), dot(up, d)];
  }

  function daLonLat(lonP, latP, hEll = 0) {
    return ecefToEnu(llhToEcef(latP, lonP, hEll));
  }

  /** Piano locale: est, nord. L'altezza non serve per la pianta. */
  function piano(lonP, latP) {
    const [e, n] = daLonLat(lonP, latP, 0);
    return [e, n];
  }

  /** Quota ortometrica → su ENU (ellissoide meno la curvatura sotto il piano tangente). */
  function suOrtometrico(e, n, quota) {
    return quota + geoidM - (e * e + n * n) / (2 * R_TERRA);
  }

  const heading = rad(regione.headingDeg ?? 45);
  const pitch = rad(STILE.pitchDeg);
  const fwd = [Math.sin(heading), Math.cos(heading), 0];
  const right = [Math.cos(heading), -Math.sin(heading), 0];
  const suSchermo = [fwd[0] * Math.sin(pitch), fwd[1] * Math.sin(pitch), Math.cos(pitch)];

  function pixel(e, n, u) {
    return [
      (e * right[0] + n * right[1] + u * right[2]) / STILE.mpp,
      -(e * suSchermo[0] + n * suSchermo[1] + u * suSchermo[2]) / STILE.mpp,
    ];
  }

  return { daLonLat, piano, suOrtometrico, pixel, geoidM };
}

export function nelPoligono([x, y], anello) {
  let dentro = false;
  for (let i = 0, j = anello.length - 1; i < anello.length; j = i++) {
    const [xi, yi] = anello[i];
    const [xj, yj] = anello[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}

export function areaM2(anelloLonLat, piano) {
  let a = 0;
  for (let i = 0; i < anelloLonLat.length - 1; i++) {
    const [x1, y1] = piano(anelloLonLat[i][0], anelloLonLat[i][1]);
    const [x2, y2] = piano(anelloLonLat[i + 1][0], anelloLonLat[i + 1][1]);
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

export function chiudi(anello) {
  if (anello.length < 2) return anello;
  const a = anello[0];
  const b = anello[anello.length - 1];
  if (a[0] === b[0] && a[1] === b[1]) return anello;
  return [...anello, [a[0], a[1], ...(a.length > 2 ? [a[2]] : [])]];
}

/** Unisce spezzate che si toccano agli estremi (outer di un multipolygon OSM). */
export function unisciSpezzate(pezzi, eps = 1e-7) {
  const rest = pezzi.filter((p) => p.length >= 2).map((p) => p.slice());
  const fuori = [];
  const vicino = (p, r) => Math.abs(p[0] - r[0]) < eps && Math.abs(p[1] - r[1]) < eps;
  while (rest.length) {
    let linea = rest.pop();
    let cresciuta = true;
    while (cresciuta) {
      cresciuta = false;
      for (let i = 0; i < rest.length; i++) {
        const q = rest[i];
        const a = linea[0];
        const b = linea[linea.length - 1];
        const c = q[0];
        const d = q[q.length - 1];
        let unita = null;
        if (vicino(b, c)) unita = linea.concat(q.slice(1));
        else if (vicino(b, d)) unita = linea.concat(q.slice(0, -1).reverse());
        else if (vicino(a, d)) unita = q.concat(linea.slice(1));
        else if (vicino(a, c)) unita = q.slice().reverse().concat(linea.slice(1));
        if (unita) {
          linea = unita;
          rest.splice(i, 1);
          cresciuta = true;
          break;
        }
      }
    }
    fuori.push(linea);
  }
  return fuori;
}

export function bboxInterseca(anello, [s, w, n, e]) {
  for (const [lon, lat] of anello) {
    if (lat >= s && lat <= n && lon >= w && lon <= e) return true;
  }
  const cx = anello.reduce((t, p) => t + p[0], 0) / anello.length;
  const cy = anello.reduce((t, p) => t + p[1], 0) / anello.length;
  return cy >= s && cy <= n && cx >= w && cx <= e;
}

export function centroide(anello) {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < anello.length - 1; i++) {
    const [x1, y1] = anello[i];
    const [x2, y2] = anello[i + 1];
    const c = x1 * y2 - x2 * y1;
    a += c;
    cx += (x1 + x2) * c;
    cy += (y1 + y2) * c;
  }
  if (Math.abs(a) < 1e-18) {
    const n = anello.length;
    return [
      anello.reduce((t, p) => t + p[0], 0) / n,
      anello.reduce((t, p) => t + p[1], 0) / n,
    ];
  }
  return [cx / (3 * a), cy / (3 * a)];
}
