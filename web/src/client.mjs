/**
 * Viewer della piramide: pan, zoom, pin, meteo, giorno/notte, segnalazione.
 * Copyright (c) 2026 NVerlini
 */

import {
  METEO,
  TILE,
  ZOOM_NATIVO,
  elencoLandmark,
  faseGiorno,
  fontePiramide,
  indiceTile,
  livelloVista,
  oraBreve,
  pixelLuogo,
  regioneVista,
  urlMeteo,
  urlOsm,
  urlSegnalazione,
  zoomMassimo,
  etichettaFonte,
  leggiMeteo,
  baseTile,
  urlRisorsa,
} from "./vista.mjs";

const AVIF_1PX = "data:image/avif;base64,AAAAHGZ0eXBhdmlmAAAAAG1pZjFhdmlmbWlhZgAAANZtZXRhAAAAAAAAACFoZGxyAAAAAAAAAABwaWN0AAAAAAAAAAAAAAAAAAAAAA5waXRtAAAAAAABAAAAImlsb2MAAAAAREAAAQABAAAAAAD6AAEAAAAAAAAAFwAAACNpaW5mAAAAAAABAAAAFWluZmUCAAAAAAEAAGF2MDEAAAAAVmlwcnAAAAA4aXBjbwAAAAxhdjFDgSACAAAAABRpc3BlAAAAAAAAAAEAAAABAAAAEHBpeGkAAAAAAwgICAAAABZpcG1hAAAAAAAAAAEAAQOBAgMAAAAfbWRhdBIACgc4AAYQENBpMgoYAAAAQAX172To";

const vista = document.querySelector("#vista");
const tessere = document.querySelector("#tessere");
const pinStrato = document.querySelector("#pin");
const scheda = document.querySelector("#scheda");
const luoghi = document.querySelector("#luoghi");
const meteo = document.querySelector("#meteo");
const fonteEl = document.querySelector("#fonte");
const faseEl = document.querySelector("#fase");
const segnala = document.querySelector("#segnala");
const stato = document.querySelector("#stato");
const apriLuoghi = document.querySelector("#apri-luoghi");
const apriCrediti = document.querySelector("#apri-crediti");
const elencoCrediti = document.querySelector("#elenco-crediti");

const statoVista = {
  world: null,
  indice: null,
  fonte: "demo",
  formato: "avif",
  zoom: 4,
  cx: 0,
  cy: 0,
  luoghi: [],
  trascinando: false,
  mosso: false,
  ultimoX: 0,
  ultimoY: 0,
  aperto: null,
};

function scala() {
  return 2 ** (statoVista.zoom - ZOOM_NATIVO);
}

function daHash() {
  const m = location.hash.match(/^#@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  return { x: Number(m[1]), y: Number(m[2]), zoom: Number(m[3]) };
}

function scriviHash() {
  const hash = `#@${Math.round(statoVista.cx)},${Math.round(statoVista.cy)},${statoVista.zoom.toFixed(2)}`;
  if (location.hash !== hash) history.replaceState(null, "", hash);
}

function tileSottoCentro() {
  const z = livelloVista(statoVista.zoom, statoVista.world);
  const indice = indiceTile(statoVista.cx, statoVista.cy, z);
  return { z, x: indice.x, y: indice.y };
}

function aggiornaSegnala() {
  const tile = tileSottoCentro();
  segnala.href = urlSegnalazione({
    x: statoVista.cx,
    y: statoVista.cy,
    zoom: statoVista.zoom,
    tile,
    fonte: statoVista.fonte,
  });
}

function limitiZoom() {
  const min = statoVista.world.min_zoom ?? 2;
  const max = zoomMassimo(statoVista.world);
  statoVista.zoom = Math.min(max, Math.max(min, statoVista.zoom));
}

function centraSu(x, y, zoom) {
  statoVista.cx = x;
  statoVista.cy = y;
  if (zoom != null) statoVista.zoom = zoom;
  limitiZoom();
  disegna();
  scriviHash();
  aggiornaSegnala();
}

function apriScheda(luogo) {
  statoVista.aperto = luogo.id;
  scheda.hidden = false;
  scheda.querySelector("h2").textContent = luogo.nome;
  scheda.querySelector("p").textContent = luogo.scheda;
  const meta = scheda.querySelector(".meta");
  meta.textContent = `${luogo.lat.toFixed(5)} N, ${luogo.lon.toFixed(5)} E · suolo ${Math.round(luogo.quotaOrtometrica)} m · pixel ${Math.round(luogo.x)}, ${Math.round(luogo.y)}`;
  const link = scheda.querySelector("a");
  const osm = urlOsm(luogo.osm);
  if (osm) {
    link.hidden = false;
    link.href = osm;
    link.textContent = "Scheda OpenStreetMap";
  } else {
    link.hidden = true;
  }
  for (const pin of pinStrato.querySelectorAll(".pin")) {
    pin.classList.toggle("aperto", pin.dataset.id === luogo.id);
  }
  for (const voce of luoghi.querySelectorAll("button")) {
    voce.setAttribute("aria-current", voce.dataset.id === luogo.id ? "true" : "false");
  }
}

function chiudiScheda() {
  statoVista.aperto = null;
  scheda.hidden = true;
  for (const pin of pinStrato.querySelectorAll(".pin")) pin.classList.remove("aperto");
}

function disegnaPin() {
  const s = scala();
  const w = vista.clientWidth;
  const h = vista.clientHeight;
  for (const pin of pinStrato.querySelectorAll(".pin")) {
    const luogo = statoVista.luoghi.find((l) => l.id === pin.dataset.id);
    const sx = (luogo.x - statoVista.cx) * s + w / 2;
    const sy = (luogo.y - statoVista.cy) * s + h / 2;
    pin.style.transform = `translate(${sx - 14}px, ${sy - 14}px)`;
  }
}

function disegnaTessere() {
  const world = statoVista.world;
  const z = livelloVista(statoVista.zoom, world);
  const span = indiceTile(0, 0, z).span;
  const s = scala();
  const w = vista.clientWidth;
  const h = vista.clientHeight;
  const x0 = statoVista.cx - (w / 2) / s;
  const y0 = statoVista.cy - (h / 2) / s;
  const x1 = statoVista.cx + (w / 2) / s;
  const y1 = statoVista.cy + (h / 2) / s;
  const i0 = Math.floor(x0 / span) - 1;
  const j0 = Math.floor(y0 / span) - 1;
  const i1 = Math.floor(x1 / span) + 1;
  const j1 = Math.floor(y1 / span) + 1;
  const livello = statoVista.indice[String(z)] || statoVista.indice[z] || {};
  const servono = new Set();
  const lato = TILE * 2 ** (statoVista.zoom - z);
  for (let ty = j0; ty <= j1; ty++) {
    for (let tx = i0; tx <= i1; tx++) {
      if (!livello[`${tx}_${ty}`]) continue;
      const chiave = `${z}/${tx}/${ty}`;
      servono.add(chiave);
      let img = tessere.querySelector(`img[data-k="${chiave}"]`);
      if (!img) {
        img = document.createElement("img");
        img.dataset.k = chiave;
        img.alt = "";
        img.draggable = false;
        const versione = livello[`${tx}_${ty}`];
        img.src = urlRisorsa(`/tiles/photo/${z}/${tx}/${ty}.${statoVista.formato}?v=${versione}`, radiceTile);
        img.addEventListener("error", () => {
          if (statoVista.formato === "avif" && !img.dataset.jpg) {
            img.dataset.jpg = "1";
            img.src = urlRisorsa(`/tiles/photo/${z}/${tx}/${ty}.jpg?v=${versione}`, radiceTile);
          }
        });
        tessere.appendChild(img);
      }
      const sx = (tx * span - statoVista.cx) * s + w / 2;
      const sy = (ty * span - statoVista.cy) * s + h / 2;
      const misura = Math.ceil(lato) + 1;
      img.style.width = `${misura}px`;
      img.style.height = `${misura}px`;
      img.style.transform = `translate(${sx}px, ${sy}px)`;
    }
  }
  for (const img of tessere.querySelectorAll("img")) {
    if (!servono.has(img.dataset.k)) img.remove();
  }
}

function disegna() {
  disegnaTessere();
  disegnaPin();
}

function preparaLuoghi() {
  const regione = regioneVista(statoVista.world);
  statoVista.luoghi = elencoLandmark().map((lm) => ({ ...lm, ...pixelLuogo(regione, lm) }));
  pinStrato.replaceChildren();
  luoghi.replaceChildren();
  for (const luogo of statoVista.luoghi) {
    const pin = document.createElement("button");
    pin.type = "button";
    pin.className = `pin ${luogo.lato}`;
    pin.dataset.id = luogo.id;
    pin.innerHTML = `<span class="punto"></span><span class="nome"></span>`;
    pin.querySelector(".nome").textContent = luogo.nome;
    pin.addEventListener("click", (ev) => {
      ev.stopPropagation();
      apriScheda(luogo);
    });
    pinStrato.appendChild(pin);

    const voce = document.createElement("button");
    voce.type = "button";
    voce.dataset.id = luogo.id;
    voce.textContent = luogo.nome;
    voce.addEventListener("click", () => {
      mostraLuoghi(false);
      centraSu(luogo.x, luogo.y, Math.min(zoomMassimo(statoVista.world), Math.max(statoVista.zoom, 4)));
      apriScheda(luogo);
    });
    luoghi.appendChild(voce);
  }
}

function supportoAvif() {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth > 0);
    img.onerror = () => resolve(false);
    img.src = AVIF_1PX;
  });
}

async function caricaMeteo() {
  try {
    const risposta = await fetch(urlMeteo(METEO));
    if (!risposta.ok) throw new Error(String(risposta.status));
    const dati = leggiMeteo(await risposta.json());
    meteo.replaceChildren();
    for (const voce of dati) {
      const riga = document.createElement("p");
      const gradi = voce.temperatura == null ? "–" : `${Math.round(voce.temperatura)}°`;
      riga.innerHTML = `<span class="dove"></span><span class="quanto"></span>`;
      riga.querySelector(".dove").textContent = voce.nome;
      riga.querySelector(".quanto").textContent = `${gradi} · ${voce.testo}`;
      meteo.appendChild(riga);
    }
    const prima = dati[0];
    const fase = faseGiorno(Date.now(), prima?.alba, prima?.tramonto, prima?.offset ?? 0);
    document.body.classList.toggle("notte", fase === "notte");
    faseEl.hidden = false;
    faseEl.textContent = fase === "notte"
      ? `Notte · alba ${oraBreve(prima?.alba)} · tramonto ${oraBreve(prima?.tramonto)}`
      : `Giorno · alba ${oraBreve(prima?.alba)} · tramonto ${oraBreve(prima?.tramonto)}`;
  } catch {
    meteo.textContent = "Meteo non disponibile.";
    faseEl.hidden = true;
    document.body.classList.remove("notte");
  }
}

function suPuntatore(ev) {
  if (ev.button !== 0) return;
  if (ev.target.closest(".pin, .pannello, a, button")) return;
  statoVista.trascinando = true;
  statoVista.mosso = false;
  statoVista.ultimoX = ev.clientX;
  statoVista.ultimoY = ev.clientY;
  vista.setPointerCapture(ev.pointerId);
}

function muovi(ev) {
  if (!statoVista.trascinando) return;
  const dx = ev.clientX - statoVista.ultimoX;
  const dy = ev.clientY - statoVista.ultimoY;
  if (Math.hypot(dx, dy) > 3) statoVista.mosso = true;
  statoVista.ultimoX = ev.clientX;
  statoVista.ultimoY = ev.clientY;
  const s = scala();
  statoVista.cx -= dx / s;
  statoVista.cy -= dy / s;
  disegna();
}

function rilascia(ev) {
  if (!statoVista.trascinando) return;
  statoVista.trascinando = false;
  try { vista.releasePointerCapture(ev.pointerId); } catch { /* già rilasciato */ }
  scriviHash();
  aggiornaSegnala();
}

function ruota(ev) {
  ev.preventDefault();
  const rect = vista.getBoundingClientRect();
  const mx = ev.clientX - rect.left;
  const my = ev.clientY - rect.top;
  const prima = scala();
  const artX = statoVista.cx + (mx - vista.clientWidth / 2) / prima;
  const artY = statoVista.cy + (my - vista.clientHeight / 2) / prima;
  const passi = ev.deltaMode === 1 ? ev.deltaY / 3 : ev.deltaY / 100;
  const fattore = (statoVista.world.zoomPerScroll ?? 1.35) ** (-passi);
  statoVista.zoom *= fattore;
  limitiZoom();
  const dopo = scala();
  statoVista.cx = artX - (mx - vista.clientWidth / 2) / dopo;
  statoVista.cy = artY - (my - vista.clientHeight / 2) / dopo;
  disegna();
  scriviHash();
  aggiornaSegnala();
}


function mostraLuoghi(aperto) {
  luoghi.hidden = !aperto;
  apriLuoghi.setAttribute("aria-expanded", aperto ? "true" : "false");
}

function zoomDi(passi) {
  if (!statoVista.world) return;
  statoVista.zoom += passi;
  limitiZoom();
  disegna();
  scriviHash();
  aggiornaSegnala();
}

function tornaAllaRocca() {
  const rocca = statoVista.luoghi.find((l) => l.id === "rocca-abbaziale");
  if (rocca) centraSu(rocca.x, rocca.y, zoomIniziale(statoVista.world));
}

function zoomIniziale(world) {
  return world.demo ? 4 : Math.min(world.native_zoom, 5);
}

apriLuoghi.addEventListener("click", () => mostraLuoghi(luoghi.hidden));
apriCrediti.addEventListener("click", () => {
  elencoCrediti.hidden = !elencoCrediti.hidden;
  apriCrediti.setAttribute("aria-expanded", elencoCrediti.hidden ? "false" : "true");
});
document.querySelector("#zoom-piu").addEventListener("click", () => zoomDi(1));
document.querySelector("#zoom-meno").addEventListener("click", () => zoomDi(-1));
document.querySelector("#zoom-casa").addEventListener("click", tornaAllaRocca);

vista.addEventListener("pointerdown", suPuntatore);
vista.addEventListener("pointermove", muovi);
vista.addEventListener("pointerup", rilascia);
vista.addEventListener("pointercancel", rilascia);
vista.addEventListener("wheel", ruota, { passive: false });
document.querySelector("#chiudi").addEventListener("click", chiudiScheda);
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") {
    chiudiScheda();
    mostraLuoghi(false);
  }
  if (ev.target.closest?.("input, textarea")) return;
  if (ev.key === "+" || ev.key === "=") zoomDi(1);
  if (ev.key === "-" || ev.key === "_") zoomDi(-1);
});
window.addEventListener("resize", disegna);

const radiceTile = baseTile();

try {
  const [world, indice, avif] = await Promise.all([
    fetch(urlRisorsa("/data/world.json", radiceTile)).then((r) => {
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    }),
    fetch(urlRisorsa("/data/tiles-photo.json", radiceTile)).then((r) => {
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    }),
    supportoAvif(),
  ]);
  statoVista.world = world;
  statoVista.indice = indice;
  statoVista.fonte = fontePiramide(world);
  statoVista.formato = avif ? "avif" : "jpg";
  fonteEl.textContent = etichettaFonte(statoVista.fonte);
  if (!avif) fonteEl.textContent += " · JPEG";
  preparaLuoghi();
  const rocca = statoVista.luoghi.find((l) => l.id === "rocca-abbaziale");
  const hash = daHash();
  if (hash) centraSu(hash.x, hash.y, hash.zoom);
  else centraSu(rocca.x, rocca.y, zoomIniziale(world));
  stato.hidden = true;
  caricaMeteo();
  window.vistaPronta = true;
} catch {
  stato.hidden = false;
  stato.textContent = radiceTile
    ? "Le tile non rispondono. Controlla TILES_PUBLIC_URL e il CORS del bucket."
    : "Nessuna piramide su questa origine. Le tile stanno accanto alla pagina; in locale npm run dev le legge da data/.";
}
