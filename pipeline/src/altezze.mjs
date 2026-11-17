/**
 * Quote degli edifici quando la CTR non ne ha una utilizzabile.
 * Copyright (c) 2026 NVerlini
 *
 * Ordine: quota di gronda CTR (misura), poi building:levels, poi il default del landmark,
 * poi la tipologia del borgo. I default non sono misure: restano etichettati come tali.
 */

export function metriLivelli(tags, altezze) {
  const grezzo = tags?.["building:levels"];
  if (grezzo == null || grezzo === "") return null;
  const n = Number(String(grezzo).replace(",", "."));
  if (!Number.isFinite(n) || n <= 0 || n > 40) return null;
  const metri = Math.round(n * altezze.pianoM * 10) / 10;
  return clamp(metri, altezze);
}

export function tipologia(tags) {
  const building = tags?.building;
  if (building && building !== "yes") return building;
  if (tags?.historic === "castle") return "castle";
  if (tags?.amenity === "monastery") return "monastery";
  if (tags?.amenity === "place_of_worship") return "church";
  if (building === "yes") return "yes";
  return "yes";
}

export function metriDefault(tags, altezze, landmarkId) {
  if (landmarkId && Number.isFinite(altezze.landmark?.[landmarkId])) {
    return clamp(altezze.landmark[landmarkId], altezze);
  }
  const tipo = tipologia(tags);
  const tabella = altezze.perTipologia ?? {};
  const metri = tabella[tipo] ?? altezze.predefinitaM;
  return clamp(metri, altezze);
}

function clamp(metri, altezze) {
  const minimo = altezze.minimaM ?? 3;
  const massimo = altezze.massimaM ?? 36;
  return Math.round(Math.min(massimo, Math.max(minimo, metri)) * 10) / 10;
}

/**
 * Sceglie l'altezza e dice da dove viene.
 * `ctrM` è già la gronda meno il suolo, oppure null se la CTR non incrocia l'edificio.
 */
function misuraCtr(metri, altezze) {
  return Number.isFinite(metri) && metri >= (altezze.ctrMinM ?? 2.4) && metri <= (altezze.ctrMaxM ?? 65);
}

export function scegliAltezza({ tags, unitaM, ctrM, landmarkId, altezze }) {
  if (misuraCtr(unitaM, altezze)) {
    return { altezzaM: Math.round(unitaM * 10) / 10, fonteAltezza: "ctr-unita" };
  }
  if (misuraCtr(ctrM, altezze)) {
    return { altezzaM: Math.round(ctrM * 10) / 10, fonteAltezza: "ctr-gronda" };
  }
  const livelli = metriLivelli(tags, altezze);
  if (livelli != null) return { altezzaM: livelli, fonteAltezza: "building:levels" };
  return { altezzaM: metriDefault(tags, altezze, landmarkId), fonteAltezza: "default-tipologia" };
}

/** Solo la seggiovia configurata è attiva. Ogni altro aerialway è da verificare. */
export function statoAerialway(osmId, monteLivata) {
  const attivo = monteLivata?.impiantoAttivo?.osm;
  if (attivo && osmId === attivo) return "attivo";
  return "da-verificare";
}

/** La pista di fondo non è in OSM: si registra il previsto, senza coordinate. */
export function pistaPrevista(monteLivata) {
  const pista = monteLivata?.pistaPrioritaria;
  if (!pista) return null;
  return {
    id: pista.id,
    nome: pista.nome,
    osm: null,
    stato: pista.stato ?? "non-mappata",
    geometria: null,
    nota: pista.note ?? "",
  };
}

/**
 * La finestra 16 bit del riferimento (1 cm) non copre il dislivello misurato.
 * Ritorna l'intervallo ellissoidico coperto dalla codifica scritta in config.
 */
export function finestraAltezze(regione) {
  const passoM = regione.codificaAltezze.passoCm / 100;
  const inizio = regione.heightBase - 100;
  const ampiezza = 65536 * passoM;
  return { inizio, fine: inizio + ampiezza, passoM, ampiezza };
}
