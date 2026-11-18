/**
 * Ponte San Francesco: un solo arco, pianta sulla spezzata OSM.
 * Copyright (c) 2026 NVerlini
 *
 * Le quote intermedie (il fondovalle) non abbassano il piano: le spalle sono
 * i due estremi della way. L'intradosso è un arco circolare. Sotto l'arco non
 * c'è mesh, così l'acqua resta visibile. Spessore e freccia non sono misure.
 */

const CALCARE = [0.72, 0.67, 0.58];
const OMBRA = [0.48, 0.45, 0.4];
const SPALLA = [0.62, 0.58, 0.51];

export function profiloArco(lunghezza, freccia) {
  if (!(lunghezza > 0) || !(freccia > 0)) {
    return { raggio: 0, freccia: 0, lunghezza: 0, campate: 0 };
  }
  const raggio = (freccia * freccia + (lunghezza / 2) ** 2) / (2 * freccia);
  return { raggio, freccia, lunghezza, campate: 1 };
}

/** Altezza dell'intradosso sopra la linea d'imposta, t da 0 a 1 lungo la luce. */
export function quotaIntradosso(t, lunghezza, freccia) {
  const { raggio } = profiloArco(lunghezza, freccia);
  if (!(raggio > 0)) return 0;
  const x = (t - 0.5) * lunghezza;
  const dentro = raggio * raggio - x * x;
  if (dentro <= 0) return 0;
  return Math.sqrt(dentro) - (raggio - freccia);
}

function lunghezzaDi(punti) {
  const cum = [0];
  for (let i = 1; i < punti.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(punti[i][0] - punti[i - 1][0], punti[i][1] - punti[i - 1][1]));
  }
  return cum;
}

function puntoLungo(punti, cum, distanza) {
  const totale = cum[cum.length - 1];
  const d = Math.max(0, Math.min(totale, distanza));
  for (let i = 1; i < punti.length; i++) {
    if (cum[i] >= d || i === punti.length - 1) {
      const span = cum[i] - cum[i - 1] || 1;
      const u = (d - cum[i - 1]) / span;
      return [
        punti[i - 1][0] + (punti[i][0] - punti[i - 1][0]) * u,
        punti[i - 1][1] + (punti[i][1] - punti[i - 1][1]) * u,
      ];
    }
  }
  return punti[punti.length - 1];
}

function normale(punti, cum, distanza) {
  const totale = cum[cum.length - 1];
  const a = puntoLungo(punti, cum, Math.max(0, distanza - 0.5));
  const b = puntoLungo(punti, cum, Math.min(totale, distanza + 0.5));
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return [-(b[1] - a[1]) / len, (b[0] - a[0]) / len];
}

/**
 * punti: [[e, n], ...] in metri. quote: una per punto, stessa unità del renderer.
 * Si usano solo la prima e l'ultima come spalle.
 */
export function solidiPonte(punti, quote, opzioni = {}) {
  if (!punti || punti.length < 2 || !quote || quote.length < 2) {
    return { campate: 0, facce: [], campioni: [] };
  }
  const cum = lunghezzaDi(punti);
  const L = cum[cum.length - 1];
  if (L < 1) return { campate: 0, facce: [], campioni: [], luceM: L };
  const qA = quote[0];
  const qB = quote[quote.length - 1];
  const imposta = Math.min(qA, qB);
  const spessore = opzioni.spessoreM ?? 1.2;
  const anello = opzioni.spessoreArcoM ?? 0.85;
  const larghezza = opzioni.larghezzaM ?? 4.5;
  const mezzo = larghezza / 2;
  const freccia = Math.min(opzioni.frecciaMaxM ?? 9, Math.max(3.2, L * 0.42));
  const { raggio } = profiloArco(L, freccia);
  const n = opzioni.campioni ?? 14;
  const campioni = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const intra = imposta + quotaIntradosso(t, L, freccia);
    const sponda = qA * (1 - t) + qB * t;
    const chiave = imposta + freccia + spessore;
    const gobba = Math.sin(Math.PI * t);
    const piano = Math.max(sponda * (1 - gobba) + chiave * gobba, intra + spessore * 0.85);
    const extra = Math.min(piano - 0.08, intra + anello);
    campioni.push({
      t,
      distanza: t * L,
      zIntradosso: intra,
      zEstradosso: Math.max(intra, extra),
      zPiano: piano,
    });
  }
  const facce = [];
  const sposta = (campione, lato, z) => {
    const [e, n] = puntoLungo(punti, cum, campione.distanza);
    const [nx, ny] = normale(punti, cum, campione.distanza);
    return [e + nx * lato, n + ny * lato, z];
  };
  const faccia = (a, b, za, zb, ruolo, colore) => {
    facce.push({
      ruolo,
      colore,
      verts: [
        sposta(a, -mezzo, za(a)),
        sposta(b, -mezzo, zb(b)),
        sposta(b, mezzo, zb(b)),
        sposta(a, mezzo, za(a)),
      ],
    });
  };
  for (let i = 0; i < campioni.length - 1; i++) {
    const a = campioni[i];
    const b = campioni[i + 1];
    faccia(a, b, (p) => p.zPiano, (p) => p.zPiano, "piano", CALCARE);
    faccia(a, b, (p) => p.zIntradosso, (p) => p.zIntradosso, "intradosso", OMBRA);
    for (const lato of [-mezzo, mezzo]) {
      facce.push({
        ruolo: "fianco",
        colore: SPALLA,
        verts: [
          sposta(a, lato, a.zEstradosso),
          sposta(b, lato, b.zEstradosso),
          sposta(b, lato, b.zPiano),
          sposta(a, lato, a.zPiano),
        ],
      });
      facce.push({
        ruolo: "arco",
        colore: OMBRA,
        verts: [
          sposta(a, lato, a.zIntradosso),
          sposta(b, lato, b.zIntradosso),
          sposta(b, lato, b.zEstradosso),
          sposta(a, lato, a.zEstradosso),
        ],
      });
    }
  }
  const meta = campioni[Math.floor(campioni.length / 2)];
  return {
    campate: 1,
    luceM: L,
    frecciaM: freccia,
    raggioM: raggio,
    spessoreM: spessore,
    larghezzaM: larghezza,
    quotaImposta: imposta,
    quotaIntradossoCentro: meta.zIntradosso,
    quotaPianoCentro: meta.zPiano,
    facce,
    campioni,
    punti,
  };
}
