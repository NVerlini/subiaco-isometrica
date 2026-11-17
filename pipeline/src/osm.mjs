/**
 * Lettura degli elementi Overpass (`out geom`) e suddivisione nei file di cache.
 * Copyright (c) 2026 NVerlini
 */

import { chiudi, unisciSpezzate } from "./geo.mjs";

export function idOsm(el) {
  return `${el.type}/${el.id}`;
}

export function lineaDi(el) {
  if (Array.isArray(el.geometry) && el.geometry.length >= 2 && el.geometry[0].lat != null) {
    return el.geometry.map((p) => [p.lon, p.lat]);
  }
  return null;
}

function giaChiusa(linea) {
  if (!linea || linea.length < 4) return false;
  const a = linea[0];
  const b = linea[linea.length - 1];
  return Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7;
}

export function anelliDi(el) {
  const linea = lineaDi(el);
  if (el.type === "way") {
    if (!giaChiusa(linea)) return [];
    return [chiudi(linea)];
  }
  if (el.type !== "relation") return [];
  const outer = [];
  const inner = [];
  for (const membro of el.members ?? []) {
    if (!Array.isArray(membro.geometry) || membro.geometry.length < 2) continue;
    const spezzata = membro.geometry.map((p) => [p.lon, p.lat]);
    if (membro.role === "inner") inner.push(spezzata);
    else outer.push(spezzata);
  }
  const anelli = unisciSpezzate(outer).filter((a) => a.length >= 4).map(chiudi);
  const buchi = unisciSpezzate(inner).filter((a) => a.length >= 4).map(chiudi);
  return anelli.map((anello, i) => (i === 0 ? { anello, buchi } : { anello, buchi: [] }));
}

/** Normalizza: ogni edificio è { anello, buchi }. anelliDi può restituire entrambi i formati. */
export function edificiDi(el) {
  const grezzi = anelliDi(el);
  return grezzi.map((item) => {
    if (Array.isArray(item)) return { anello: item, buchi: [] };
    return item;
  });
}

export function puntoDi(el) {
  if (el.type === "node" && Number.isFinite(el.lat) && Number.isFinite(el.lon)) return [el.lon, el.lat];
  const linea = lineaDi(el);
  if (linea?.length) {
    const i = Math.floor(linea.length / 2);
    return linea[i];
  }
  return null;
}

const TAG_SUOLO = ["landuse", "natural", "leisure", "waterway", "water", "amenity"];

export function eSuolo(tags = {}) {
  if (tags.highway) return false;
  return TAG_SUOLO.some((k) => tags[k] != null);
}

export function eEdificio(tags = {}) {
  return Boolean(tags.building) && tags.building !== "no";
}

export function queryArea(bbox, timeout) {
  const b = `(${bbox.map((n) => Number(n).toFixed(5)).join(",")})`;
  return `[out:json][timeout:${timeout}];
(
  way["building"]${b};
  relation["building"]${b};
  way["highway"]${b};
  node["natural"="tree"]${b};
  way["natural"="tree_row"]${b};
  nwr["natural"="wood"]${b};
  nwr["landuse"="forest"]${b};
  nwr["landuse"]${b};
  nwr["leisure"~"^(park|garden|pitch|playground|nature_reserve)$"]${b};
  nwr["natural"~"^(water|scrub|grassland|wood|wetland|bare_rock|heath|sand|beach)$"]${b};
  nwr["waterway"]${b};
  nwr["water"]${b};
  nwr["amenity"]${b};
  nwr["tourism"]${b};
  nwr["historic"]${b};
  way["piste:type"]${b};
  nwr["aerialway"]${b};
  way(153585997);
  way(232122864);
  relation(5733172);
  way(236976582);
  way(131304704);
);
out geom;`;
}

export function dividi(json) {
  const elementi = json.elements ?? [];
  const strade = elementi.filter((el) => el.type === "way" && el.tags?.highway && lineaDi(el));
  const suolo = elementi.filter((el) => eSuolo(el.tags));
  return {
    osm: json,
    roads: {
      type: "overpass",
      osm3s: json.osm3s,
      elements: strade,
    },
    ground: {
      type: "overpass",
      osm3s: json.osm3s,
      elements: suolo,
    },
  };
}
