/**
 * Faggeta e bosco per le maschere di pittura.
 * Copyright (c) 2026 NVerlini
 *
 * WorldCover non distingue la foglia: la classe 10 è «alberi». OSM può avere
 * leaf_type. Sopra circa 1000 m, latifoglie o bosco WorldCover senza ago
 * diventano faggeta (Monte Livata). Il resto resta bosco o arbusto.
 */

export const SOGLIA_FAGGETA_M = 1000;

export const SPLIT_DA_VERIFICARE = ["way/1047734686", "way/1180637482"];

export function classeVegetazione({
  worldcover = 0,
  leafType = null,
  quotaOrtometrica = null,
  sogliaM = SOGLIA_FAGGETA_M,
} = {}) {
  const foglia = String(leafType ?? "").trim().toLowerCase();
  const conifera = foglia === "needleleaved" || foglia === "mixed";
  const latifoglia = foglia === "broadleaved";
  const alberi = worldcover === 10;
  const arbusti = worldcover === 20;
  if (!alberi && !arbusti && !latifoglia && !conifera) return null;
  const quota = Number(quotaOrtometrica);
  const inQuota = Number.isFinite(quota) && quota > sogliaM;
  if (inQuota && !conifera && (latifoglia || alberi)) return "faggeta";
  if (arbusti && !alberi) return "arbusti";
  if (alberi || latifoglia || conifera) return "bosco";
  return null;
}

export function avvisiGeometria(scena, { attesi = 68 } = {}) {
  const edifici = scena?.edifici ?? [];
  const senza = edifici.filter((ed) => ed.fonteAltezza === "default-tipologia");
  const dalVivo = Array.isArray(scena?.edifici);
  return {
    blocca: false,
    senzaAltezzaMisurata: dalVivo ? senza.length : 0,
    conteggioDalVivo: dalVivo,
    attesiNelCentro: attesi,
    idsSenzaMisura: senza.map((ed) => ed.id),
    split: SPLIT_DA_VERIFICARE.map((id) => {
      const ed = edifici.find((e) => e.id === id);
      return {
        id,
        presente: Boolean(ed),
        altezzaM: ed?.altezzaM ?? null,
        parti: ed?.parti?.length ?? 0,
        nota: "Il volume stretto staccato dal corpo potrebbe essere un annesso e non la navata.",
      };
    }),
  };
}

export function testoAvvisi(avvisi) {
  const n = avvisi.conteggioDalVivo ? avvisi.senzaAltezzaMisurata : avvisi.attesiNelCentro;
  const righe = [
    `attenzione: ${n} edifici senza altezza misurata (default di tipologia, non una quota CTR). Non bloccano la pittura.`,
    `da verificare a occhio, senza bloccare: ${avvisi.split.map((s) => s.id).join(" e ")}. Il volume stretto potrebbe essere un annesso e non la navata.`,
  ];
  if (avvisi.avvisoVolumiOrfani) righe.push(avvisi.avvisoVolumiOrfani);
  return righe;
}
