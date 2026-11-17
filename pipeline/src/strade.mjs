/**
 * Quota di strada: l'apertura del DSM rialza la carreggiata verso i dossi
 * rimasti al centro degli isolati larghi. Qui la strada torna all'erosione
 * (il minimo locale) e il costruito vicino scende verso quel profilo.
 * Copyright (c) 2026 NVerlini
 */

function minimoVicino(griglia, nx, ny, ix, iy, r) {
  let acc = Infinity;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const x = ix + dx;
      const y = iy + dy;
      if (x < 0 || y < 0 || x >= nx || y >= ny) continue;
      acc = Math.min(acc, griglia[y * nx + x]);
    }
  }
  return Number.isFinite(acc) ? acc : null;
}

function cella(e, n, x0, y0, passo, nx, ny) {
  const ix = Math.round((e - x0) / passo);
  const iy = Math.round((n - y0) / passo);
  if (ix < 0 || iy < 0 || ix >= nx || iy >= ny) return -1;
  return iy * nx + ix;
}

function mediana(valori) {
  const v = valori.filter((n) => Number.isFinite(n)).slice().sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/**
 * @param {object} ctx suolo ed erosione sono Float32Array ortometrici, modificati in posto sul suolo
 * @param {Array<Array<[number, number]>>} ctx.linee spezzate ENU delle carreggiate
 */
export function profiloStradale(ctx) {
  const { suolo, erosione, cover, nx, ny, x0, y0, passo, linee } = ctx;
  const via = new Float32Array(nx * ny);
  via.fill(NaN);
  let campioni = 0;
  for (const linea of linee) {
    const grezzi = [];
    for (let i = 1; i < linea.length; i++) {
      const [ax, ay] = linea[i - 1];
      const [bx, by] = linea[i];
      const len = Math.hypot(bx - ax, by - ay);
      const n = Math.max(1, Math.ceil(len / passo));
      for (let k = 0; k <= n; k++) {
        const e = ax + ((bx - ax) * k) / n;
        const nord = ay + ((by - ay) * k) / n;
        const ix = Math.round((e - x0) / passo);
        const iy = Math.round((nord - y0) / passo);
        const q = minimoVicino(erosione, nx, ny, ix, iy, 1);
        grezzi.push({ e, nord, q });
      }
    }
    for (let i = 0; i < grezzi.length; i++) {
      const finestra = grezzi.slice(Math.max(0, i - 2), i + 3).map((p) => p.q);
      const q = mediana(finestra);
      if (q == null) continue;
      const idx = cella(grezzi[i].e, grezzi[i].nord, x0, y0, passo, nx, ny);
      if (idx < 0) continue;
      via[idx] = Number.isFinite(via[idx]) ? Math.min(via[idx], q) : q;
      campioni++;
    }
  }

  const quotaVicina = new Float32Array(nx * ny);
  const distCelle = new Float32Array(nx * ny);
  quotaVicina.fill(NaN);
  const raggio = 4;
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      let migliore = Infinity;
      let quota = NaN;
      for (let dy = -raggio; dy <= raggio; dy++) {
        for (let dx = -raggio; dx <= raggio; dx++) {
          const x = ix + dx;
          const y = iy + dy;
          if (x < 0 || y < 0 || x >= nx || y >= ny) continue;
          const q = via[y * nx + x];
          if (!Number.isFinite(q)) continue;
          const d = Math.hypot(dx, dy);
          if (d < migliore) {
            migliore = d;
            quota = q;
          }
        }
      }
      if (Number.isFinite(quota)) {
        quotaVicina[iy * nx + ix] = quota;
        distCelle[iy * nx + ix] = migliore;
      }
    }
  }

  let toccate = 0;
  let abbassamento = 0;
  for (let i = 0; i < suolo.length; i++) {
    if (!Number.isFinite(quotaVicina[i])) continue;
    const d = distCelle[i] * passo;
    const qVia = quotaVicina[i];
    const costruito = cover?.[i] === 50;
    if (!(d <= 12 || (costruito && d <= 40))) continue;
    if (suolo[i] <= qVia + 0.6) continue;
    const t = Math.min(1, d / 40);
    const tirato = qVia + (suolo[i] - qVia) * t * t;
    // Non si scende sotto l'erosione della cella: è già il minimo locale del DSM.
    const dopo = Math.min(suolo[i], Math.max(erosione[i], tirato));
    if (dopo < suolo[i] - 0.05) {
      abbassamento += suolo[i] - dopo;
      suolo[i] = dopo;
      toccate++;
    }
  }
  return {
    campioni,
    celle: toccate,
    abbassamentoMedioM: toccate ? Math.round((abbassamento / toccate) * 100) / 100 : 0,
  };
}
