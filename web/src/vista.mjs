/**
 * Vista del viewer: pixel d'arte, landmark, meteo, giorno/notte, segnalazione.
 * La proiezione è quella di pipeline/src/geo.mjs (ENU, pitch 45°, heading della regione).
 * Copyright (c) 2026 NVerlini
 */

import aree from "../../config/areas.json" with { type: "json" };
import pipeline from "../../config/pipeline.json" with { type: "json" };
import { creaQuadro } from "../../pipeline/src/geo.mjs";

export const PIPELINE = pipeline;
export const REGIONE = pipeline.regione;

/** Tile web da 512 px. Lo zoom 8 è 1:1 con i pixel d'arte, come in export.mjs. */
export const TILE = 512;
export const ZOOM_NATIVO = 8;

/**
 * Punti usati per i pin. I nomi restano in config/areas.json.
 * Le quote ortometriche, tranne la seggiovia, sono le misure DEM del 17 novembre 2026
 * in config/pipeline.json. La seggiovia è il punto medio delle due stazioni OSM
 * di way/131304704 (API OSM, 22 novembre 2026); la quota è l'elevazione Open-Meteo
 * in quel punto (1669 m), non una cella del DSM di progetto.
 */
const POSTI = {
  "rocca-abbaziale": {
    lat: 41.92609,
    lon: 13.09482,
    quotaOrtometrica: 497.9,
    lato: "destra",
    scheda: "Castello sul costone sopra il borgo. È l'origine della proiezione. In OpenStreetMap il nome è Rocca Abbaziale: «Rocca dei Borgia» non compare nei tag.",
  },
  "ponte-san-francesco": {
    lat: 41.92427,
    lon: 13.08917,
    quotaOrtometrica: 372.8,
    lato: "sinistra",
    scheda: "Ponte pedonale sull'Aniene, all'ingresso del paese. In OpenStreetMap si chiama «Ponte San Francesco», senza «di».",
  },
  "santa-scolastica": {
    lat: 41.91846,
    lon: 13.11059,
    quotaOrtometrica: 526.2,
    lato: "destra",
    scheda: "Monastero benedettino a valle del borgo, lungo l'Aniene. Sta fuori dal riquadro del solo centro storico.",
  },
  "sacro-speco": {
    lat: 41.91684,
    lon: 13.11814,
    quotaOrtometrica: 633.6,
    lato: "destra",
    scheda: "Monastero di San Benedetto, aggrappato alla parete sopra il fiume. In OpenStreetMap: «Monastero di San Benedetto Sacro Speco». Fuori dal centro storico.",
  },
  "seggiovia-monna-dell-orso": {
    lat: 41.949461,
    lon: 13.184623,
    quotaOrtometrica: 1669,
    lato: "sinistra",
    scheda: "Unico impianto di risalita indicato come attivo a Monte Livata. Il punto è a metà fra le due stazioni della way OSM. Gli altri aerialway della zona non sono segnati come attivi.",
  },
  "sci-fondo-campo-dell-osso": {
    lat: 41.94813,
    lon: 13.16653,
    quotaOrtometrica: 1543.2,
    lato: "destra",
    scheda: "Pista di fondo prioritaria per il progetto. Al 15 novembre 2026 in OpenStreetMap non risulta un tracciato piste:type=nordic: il punto è il luogo Campo dell'Osso, non una pista rilevata.",
  },
};

export const METEO = [
  { id: "subiaco", nome: "Subiaco", lat: 41.92609, lon: 13.09482 },
  { id: "monte-livata", nome: "Monte Livata", lat: 41.93978, lon: 13.14658 },
];

export function elencoLandmark(config = aree) {
  const voci = [
    ...config.landmark,
    config.monteLivata.impiantoAttivo,
    config.monteLivata.pistaPrioritaria,
  ];
  return voci.map((lm) => {
    const posto = POSTI[lm.id];
    if (!posto) throw new Error(`Manca il punto geografico per ${lm.id}.`);
    return { ...lm, ...posto };
  });
}

/** Regione effettiva: l'heading e l'origine sono quelli scritti nella piramide. */
export function regioneVista(world, regione = REGIONE) {
  return {
    ...regione,
    headingDeg: world?.camera?.headingDeg ?? regione.headingDeg,
    origine: world?.camera?.origin ?? regione.origine,
  };
}

/**
 * Lat/lon e quota ortometrica → pixel d'arte.
 * Stessa catena della FASE 2: ECEF, ENU, suOrtometrico, pixel con heading e pitch.
 */
export function pixelLuogo(regione, luogo) {
  const quadro = creaQuadro(regione);
  const [e, n] = quadro.piano(luogo.lon, luogo.lat);
  const u = quadro.suOrtometrico(e, n, luogo.quotaOrtometrica);
  const [x, y] = quadro.pixel(e, n, u);
  return { e, n, u, x, y };
}

export function spanTile(zoom, tile = TILE, nativo = ZOOM_NATIVO) {
  return tile * 2 ** (nativo - zoom);
}

/** Indice assoluto della tile, lo stesso del percorso tiles/photo/{z}/{x}/{y}. */
export function indiceTile(x, y, zoom, tile = TILE, nativo = ZOOM_NATIVO) {
  const span = spanTile(zoom, tile, nativo);
  return { x: Math.floor(x / span), y: Math.floor(y / span), span };
}

export function urlOsm(osm) {
  if (!osm || !osm.includes("/")) return null;
  const [tipo, id] = osm.split("/");
  if (!/^(node|way|relation)$/.test(tipo) || !/^\d+$/.test(id)) return null;
  return `https://www.openstreetmap.org/${tipo}/${id}`;
}

export function testoMeteo(codice) {
  const n = Number(codice);
  if (!Number.isFinite(n)) return "cielo non indicato";
  if (n === 0) return "sereno";
  if (n <= 3) return "nuvoloso";
  if (n === 45 || n === 48) return "nebbia";
  if (n >= 51 && n <= 57) return "pioviggine";
  if (n >= 61 && n <= 67) return "pioggia";
  if (n >= 71 && n <= 77) return "neve";
  if (n >= 80 && n <= 82) return "rovesci";
  if (n >= 85 && n <= 86) return "neve";
  if (n >= 95) return "temporale";
  return "cielo coperto";
}

export function urlMeteo(punti = METEO) {
  const lat = punti.map((p) => p.lat).join(",");
  const lon = punti.map((p) => p.lon).join(",");
  return "https://api.open-meteo.com/v1/forecast?"
    + `latitude=${lat}&longitude=${lon}`
    + "&current=temperature_2m,weather_code,wind_speed_10m"
    + "&daily=sunrise,sunset&timezone=Europe%2FRome&forecast_days=1";
}

export function leggiMeteo(payload, punti = METEO) {
  const lista = Array.isArray(payload) ? payload : [payload];
  return lista.map((voce, i) => ({
    id: punti[i]?.id ?? `luogo-${i}`,
    nome: punti[i]?.nome ?? voce?.timezone ?? `Località ${i + 1}`,
    temperatura: voce?.current?.temperature_2m ?? null,
    codice: voce?.current?.weather_code ?? null,
    vento: voce?.current?.wind_speed_10m ?? null,
    testo: testoMeteo(voce?.current?.weather_code),
    alba: voce?.daily?.sunrise?.[0] ?? null,
    tramonto: voce?.daily?.sunset?.[0] ?? null,
    offset: voce?.utc_offset_seconds ?? 0,
  }));
}

/** «2026-11-22T07:05» è l'ora di Europe/Rome: si toglie l'offset per avere l'istante UTC. */
export function istanteLocale(iso, offsetSecondi) {
  const [data, ora = "00:00"] = String(iso).split("T");
  const [anno, mese, giorno] = data.split("-").map(Number);
  const [hh, mm, ss] = ora.split(":").map(Number);
  return Date.UTC(anno, mese - 1, giorno, hh || 0, mm || 0, ss || 0) - offsetSecondi * 1000;
}

/** Alba inclusa nel giorno, tramonto incluso nella notte. */
export function faseGiorno(adessoMs, albaIso, tramontoIso, offsetSecondi) {
  if (!albaIso || !tramontoIso) return "giorno";
  const alba = istanteLocale(albaIso, offsetSecondi);
  const tramonto = istanteLocale(tramontoIso, offsetSecondi);
  if (adessoMs < alba || adessoMs >= tramonto) return "notte";
  return "giorno";
}

export function oraBreve(iso) {
  if (!iso) return "–";
  const ora = iso.split("T")[1] || "";
  return ora.slice(0, 5);
}

/**
 * Issue nuova, senza token. GitHub legge titolo e corpo dalla query.
 * Le coordinate sono i pixel d'arte al centro della vista e la tile sotto quel punto.
 */
export function urlSegnalazione({ x, y, zoom, tile, fonte }) {
  const title = "Errore nel viewer di Subiaco";
  const body = [
    "Segnalazione dal viewer.",
    "",
    `Vista: #@${Math.round(x)},${Math.round(y)},${Number(zoom).toFixed(2)}`,
    `Tile: ${tile.z}/${tile.x}/${tile.y}`,
    `Sorgente: ${fonte}`,
    "",
    "Cosa non torna:",
    "",
  ].join("\n");
  const params = new URLSearchParams({ title, body });
  return `https://github.com/NVerlini/subiaco-isometrica/issues/new?${params}`;
}

export function fontePiramide(world) {
  if (world?.demo) return "demo";
  if (world?.dipinte) return "dipinta";
  return "render";
}

export function etichettaFonte(fonte) {
  if (fonte === "dipinta") return "Piramide dipinta";
  if (fonte === "render") return "Render, non dipinto";
  return "Schema di demo";
}

export function zoomMassimo(world) {
  const nativo = world?.native_zoom ?? ZOOM_NATIVO;
  const rapporto = world?.maxZoomPixelRatio ?? pipeline.piramide.maxZoomPixelRatio ?? 2.5;
  return nativo + Math.log2(rapporto);
}

export function livelloVista(zoom, world) {
  const min = world?.min_zoom ?? 2;
  const max = world?.native_zoom ?? ZOOM_NATIVO;
  return Math.min(max, Math.max(min, Math.floor(zoom)));
}

/** Base pubblica delle tile. Vuota in locale: il server di dev legge data/. */
export function normalizzaBaseTile(base) {
  if (base == null) return "";
  const testo = String(base).trim();
  if (!testo) return "";
  return testo.replace(/\/+$/, "");
}

export function baseTile(valore = globalThis.__TILES_PUBLIC_URL__) {
  return normalizzaBaseTile(typeof valore === "string" ? valore : "");
}

/** Percorso assoluto del viewer, preceduto dalla base solo se c'è. */
export function urlRisorsa(percorso, base = baseTile()) {
  if (!String(percorso).startsWith("/")) throw new Error(`Percorso non assoluto: ${percorso}`);
  return `${normalizzaBaseTile(base)}${percorso}`;
}
