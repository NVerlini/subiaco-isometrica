/**
 * Fetch: OSM, CTR (WFS), Copernicus DEM, ESA WorldCover.
 * La cache in data/raw e il salto dei file già presenti seguono fetch.ts di
 * Mondo Isometrico / isometricworld (MIT).
 * Copyright (c) 2026 Dmytro Krasun
 * Copyright (c) 2026 Domenico Gagliardi
 * Copyright (c) 2026 NVerlini
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  RAW,
  aiutoStadio,
  areaPerId,
  caricaEnv,
  cartellaRaw,
  leggiAree,
  opzioni,
  richiediNode24,
} from "./config.mjs";
import { assicuratiDem, apriDem, misuraAree } from "./dem.mjs";
import { ErrorePrevisto, interrogaOverpass, timeoutSecondi } from "./overpass.mjs";
import { dividi, queryArea } from "./osm.mjs";
import { assicuratiUnita, scaricaCoperture } from "./ctr.mjs";
import { assicuratiWorldcover } from "./worldcover.mjs";

const PUNTI = {
  "rocca-abbaziale": [41.92609, 13.09482],
  "ponte-san-francesco": [41.92427, 13.08917],
  "santa-scolastica": [41.91846, 13.11059],
  "sacro-speco": [41.91684, 13.11814],
  livata: [41.93978, 13.14658],
  "campo-dell-osso": [41.94813, 13.16653],
};

function scrivi(file, valore) {
  writeFileSync(file, JSON.stringify(valore));
}

async function fetchArea(area, force) {
  const dir = cartellaRaw(area.id);
  const osmFile = path.join(dir, "osm.json");
  const roadsFile = path.join(dir, "roads.json");
  const groundFile = path.join(dir, "ground.json");
  console.log(`fetch ${area.id} — ${area.nome}`);
  console.log(`  bbox S,W,N,E: ${area.bbox.map((n) => n.toFixed(4)).join(", ")}`);

  if (!force && existsSync(osmFile) && existsSync(roadsFile) && existsSync(groundFile)) {
    const osm = JSON.parse(readFileSync(osmFile, "utf8"));
    console.log(`  OSM in cache (${osm.elements?.length ?? 0} elementi), salto la query`);
  } else {
    const timeout = timeoutSecondi();
    const query = queryArea(area.bbox, timeout);
    console.log("  OSM: query Overpass (edifici, strade, acqua, suolo, alberi, POI, piste, impianti)");
    const { json, host } = await interrogaOverpass(query, { timeoutSec: timeout });
    const parti = dividi(json);
    scrivi(osmFile, parti.osm);
    scrivi(roadsFile, parti.roads);
    scrivi(groundFile, parti.ground);
    console.log(`  endpoint: ${host}`);
    console.log(`  snapshot: ${json.osm3s?.timestamp_osm_base ?? "sconosciuto"}`);
    console.log(`  elementi ${parti.osm.elements.length}, strade ${parti.roads.elements.length}, suolo ${parti.ground.elements.length}`);
    console.log("  Dati © contributori OpenStreetMap (ODbL).");
  }

  const ctrFile = path.join(dir, "ctrn.json");
  if (!force && existsSync(ctrFile)) {
    const ctr = JSON.parse(readFileSync(ctrFile, "utf8"));
    console.log(`  CTR in cache (${ctr.elementi?.length ?? 0} coperture, stato ${ctr.stato})`);
  } else {
    try {
      console.log("  CTR: WFS elemento di copertura (DBGT 2014, quote 3D)");
      const ctr = await scaricaCoperture(area.bbox);
      const doc = {
        stato: "ok",
        scaricato: new Date().toISOString(),
        bbox: area.bbox,
        elementi: ctr.elementi,
        attesi: ctr.attesi,
        servizio: ctr.servizio,
        layer: ctr.layer,
        classe: ctr.classe,
        licenza: ctr.licenza,
        titolare: ctr.titolare,
        downloadFoglio: ctr.downloadFoglio,
        downloadComune2020: ctr.downloadComune2020,
        nota: "Le quote sui vertici sono assolute (EPSG:25833). L'altezza dell'edificio è la gronda meno il suolo DEM. Le coperture che non intersecano un edificio OSM non estrudono nulla.",
      };
      scrivi(ctrFile, doc);
      console.log(`  CTR: ${ctr.elementi.length} elementi di copertura (CC BY 4.0, Regione Lazio)`);
    } catch (err) {
      const doc = {
        stato: "non-disponibile",
        scaricato: new Date().toISOString(),
        bbox: area.bbox,
        elementi: [],
        errore: err.message,
        servizio: "https://geoportale.regione.lazio.it/geoserver/ows",
        layer: "geonode:web_020104_ele_cp_a",
        downloadFoglio: "2014_DBGT_5K_SHP/strati-informativi/Roma/DBT_Lazio_RM376.zip",
        downloadComune2020: "2020_DBGT_5K_SHP/Subiaco.zip",
        nota: "Il WFS non ha risposto. Le altezze usano building:levels o il default di tipologia. Per le quote misurate serve il WFS oppure lo zip del foglio RM376 / del comune 2020 dal file browser del Geoportale (login anonimo POST /cartografia/api/login).",
      };
      scrivi(ctrFile, doc);
      console.error(`  CTR non ottenuta, registro il fallback: ${err.message}`);
    }
  }

  const unvolFile = path.join(dir, "unvol.json");
  if (!force && existsSync(unvolFile)) {
    const unvol = JSON.parse(readFileSync(unvolFile, "utf8"));
    console.log(`  UN_VOL in cache (${unvol.elementi?.length ?? 0} volumi, stato ${unvol.stato})`);
  } else {
    try {
      const unvol = await assicuratiUnita(RAW, area.bbox);
      scrivi(unvolFile, { ...unvol, bbox: area.bbox, scaricato: new Date().toISOString() });
      console.log(`  UN_VOL: ${unvol.elementi.length} volumi con altezza nella bbox (CC BY 4.0, Regione Lazio)`);
    } catch (err) {
      scrivi(unvolFile, {
        stato: "non-disponibile",
        elementi: [],
        errore: err.message,
        download: "2014_DBGT_5K_SHP/strati-informativi/Roma/DBT_Lazio_RM376.zip",
        nota: "Senza lo zip del foglio RM376 le altezze tornano al WFS delle coperture e poi al default.",
      });
      console.error(`  UN_VOL non ottenuto, si usa il fallback: ${err.message}`);
    }
  }
}

async function fetchComuni(config) {
  const fileDem = await assicuratiDem(RAW);
  const dem = await apriDem(fileDem);
  const misure = misuraAree(dem.campione, config.aree, PUNTI);
  misure.generato = new Date().toISOString();
  writeFileSync(path.join(RAW, "dem", "misure.json"), JSON.stringify(misure, null, 2));
  console.log(`  DEM ${dem.tile}: ortometrico ${misure.minimoM}…${misure.massimoM} m, dislivello ${misure.dislivelloM} m`);
  for (const [id, q] of Object.entries(misure.punti)) console.log(`    ${id}: ${q} m`);
  await assicuratiWorldcover(RAW);
  console.log("  WorldCover: tile in cache (CC BY 4.0). Il ritaglio per area lo fa ground.");
}

export async function esegui(argv) {
  richiediNode24();
  caricaEnv();
  const config = leggiAree();
  const opt = opzioni(argv, config.aree);
  if (opt.help) {
    aiutoStadio("fetch");
    return;
  }
  console.log("Subiaco Isometrica — fetch");
  await fetchComuni(config);
  for (const id of opt.ids) await fetchArea(areaPerId(config, id), opt.force);
  console.log("fetch completato. Cache in data/raw/ (non versionata).");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  esegui(process.argv.slice(2)).catch((err) => {
    console.error(err instanceof ErrorePrevisto ? err.message : err.stack || err.message);
    process.exit(1);
  });
}
