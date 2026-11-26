/**
 * Separa il corpo dal campanile quando il volume DBGT più alto è una torre.
 * Copyright (c) 2026 NVerlini
 *
 * Il caso guida è la Basilica di Sant'Andrea: il volume di 56 m è una pianta
 * piccola, accostata ad altri volumi alti solo lì vicino. La navata sta più
 * in là ed è più bassa. Un castello compatto (la Rocca, 19,6 m su 577 m²)
 * non viene spezzato.
 */

const AREA_TORRE_M2 = 360;
const FRAZIONE_IMPRONTA = 0.4;
const SOPRA_IL_CORPO_M = 10;
const RAGGIO_GRUPPO_M = 12;

function areaDi(vol) {
  return Number.isFinite(vol.areaM2) ? vol.areaM2 : Infinity;
}

/** Mediana delle altezze, pesata sull'area. I volumi larghi contano più di una punta. */
export function medianaPesata(voci) {
  const utili = (voci ?? []).filter((v) => Number.isFinite(v.h) && v.peso > 0);
  if (!utili.length) return null;
  const ordinati = utili.slice().sort((a, b) => a.h - b.h || b.peso - a.peso);
  const meta = ordinati.reduce((s, v) => s + v.peso, 0) / 2;
  let acc = 0;
  for (const v of ordinati) {
    acc += v.peso;
    if (acc >= meta) return v.h;
  }
  return ordinati.at(-1).h;
}

function distanza(a, b) {
  if (!Number.isFinite(a?._e) || !Number.isFinite(b?._e)) return Infinity;
  return Math.hypot(a._e - b._e, a._n - b._n);
}

function accettabile(vol, areaEdificio) {
  if (!Number.isFinite(vol.areaM2)) return true;
  return vol.areaM2 <= Math.max(120, areaEdificio * 1.15);
}

export function ePiantaTorre(vol, areaEdificio) {
  const area = areaDi(vol);
  if (!vol.anello || vol.anello.length < 4) return false;
  if (!(vol.h >= 16) || area > AREA_TORRE_M2) return false;
  return area <= Math.max(80, FRAZIONE_IMPRONTA * (areaEdificio || area));
}

/**
 * @param {Array<{h:number, areaM2?:number, anello?:number[][], _e?:number, _n?:number}>} volumi
 * @param {number} areaEdificio
 */
export function separaTorre(volumi, areaEdificio) {
  const validi = (volumi ?? []).filter((v) => Number.isFinite(v.h) && v.h > 0.5 && v.h <= 80 && (v.peso > 0 || accettabile(v, areaEdificio)));
  if (!validi.length) return { corpo: null, torri: [] };
  const perAltezza = (a, b) => b.h - a.h;
  const sostanziosi = validi.filter((v) => areaDi(v) >= 80);
  const punta = validi.filter((v) => ePiantaTorre(v, areaEdificio)).sort(perAltezza)[0];
  const corpoDi = (lista) => {
    const conPeso = lista.some((v) => v.peso > 0);
    const base = lista.filter((v) => !ePiantaTorre(v, areaEdificio) && (conPeso ? v.peso > 0 : accettabile(v, areaEdificio)));
    const pesi = base.length ? base : lista;
    const h = medianaPesata(pesi.map((v) => ({
      h: v.h,
      peso: v.peso > 0 ? v.peso : Math.max(areaDi(v), 0),
    })));
    const scelto = (base.length ? base : pesi).slice().sort(perAltezza)[0];
    if (!scelto) return null;
    if (!Number.isFinite(h) || Math.abs(h - scelto.h) < 1e-6) return scelto;
    return { ...scelto, h: Math.round(h * 10) / 10 };
  };
  const corpoDiBase = corpoDi(sostanziosi.length ? sostanziosi : validi);
  if (!punta) return { corpo: corpoDiBase, torri: [] };

  const gruppo = validi.filter((v) => v === punta || (
    ePiantaTorre(v, areaEdificio)
    && distanza(v, punta) <= RAGGIO_GRUPPO_M
    && v.h >= punta.h - 20
    && areaDi(v) <= Math.max(areaDi(punta) * 1.8, 120)
  ));
  const fuori = validi.filter((v) => !gruppo.includes(v) && areaDi(v) >= 80);
  const corpo = corpoDi(fuori);
  if (!corpo || punta.h < corpo.h + SOPRA_IL_CORPO_M) {
    return { corpo: corpoDiBase, torri: [] };
  }
  return { corpo, torri: gruppo.sort(perAltezza) };
}
