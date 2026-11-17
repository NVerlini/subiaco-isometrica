/**
 * Client Overpass condiviso da check-osm e dal fetch.
 * La rotazione degli endpoint e i tentativi vengono da isometricworld (overpass.ts) e da
 * Mondo Isometrico (fetch.ts), licenza MIT.
 * Copyright (c) 2026 Dmytro Krasun
 * Copyright (c) 2026 Domenico Gagliardi
 * Copyright (c) 2026 NVerlini
 *
 * Sicurezza: si rifiuta qualunque OVERPASS_URL che non sia https, e su HTTP 429 si attende
 * l'intervallo dell'header Retry-After prima di riprovare.
 */

export class ErrorePrevisto extends Error {}

const ENDPOINT_DEFAULT = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

const USER_AGENT_DEFAULT =
  "subiaco-isometrica/0.1 (mappa isometrica di Subiaco; https://github.com/NVerlini/subiaco-isometrica)";

export function userAgent() {
  return process.env.OVERPASS_USER_AGENT?.trim() || USER_AGENT_DEFAULT;
}

export function timeoutSecondi() {
  const n = Number(process.env.OVERPASS_TIMEOUT ?? 90);
  if (!Number.isFinite(n)) return 90;
  return Math.min(180, Math.max(10, Math.round(n)));
}

/** Elenco di endpoint. Lancia se un indirizzo non è https. */
export function leggiEndpoint() {
  const raw = process.env.OVERPASS_URL?.trim();
  const list = raw
    ? raw.split(",").map((s) => s.trim()).filter(Boolean)
    : ENDPOINT_DEFAULT;
  if (list.length === 0) throw new ErrorePrevisto("OVERPASS_URL non contiene endpoint.");
  const visti = [];
  for (const url of list) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      throw new ErrorePrevisto(`OVERPASS_URL non è un indirizzo valido: ${url}`);
    }
    if (parsed.protocol !== "https:") {
      throw new ErrorePrevisto(`OVERPASS_URL rifiutato: è ammesso solo https (${url}).`);
    }
    if (!visti.includes(url)) visti.push(url);
  }
  return visti;
}

/**
 * Millisecondi da attendere. `null` se l'header manca o non si interpreta.
 * Accetta i secondi interi di Overpass e una data HTTP.
 */
export function millisecondiRetryAfter(header, adesso = Date.now()) {
  if (header == null) return null;
  const testo = String(header).trim();
  if (!testo) return null;
  if (/^\d+(\.\d+)?$/.test(testo)) return Math.max(0, Number(testo) * 1000);
  const quando = Date.parse(testo);
  if (Number.isFinite(quando)) return Math.max(0, quando - adesso);
  return null;
}

const ATTESA_MASSIMA_MS = 180_000;

function limitaAttesa(ms) {
  if (ms <= ATTESA_MASSIMA_MS) return ms;
  return ATTESA_MASSIMA_MS;
}

async function leggiRisposta(response) {
  const testo = await response.text();
  try {
    return JSON.parse(testo);
  } catch {
    const estratto = testo.slice(0, 240).replace(/\s+/g, " ");
    throw new ErrorePrevisto(`Risposta Overpass non è JSON: ${estratto}`);
  }
}

/**
 * Esegue una query. Non segue redirect: un salto verso http verrebbe rifiutato,
 * e un redirect https si considera un errore dell'endpoint (si prova il successivo).
 */
export async function interrogaOverpass(query, { timeoutSec = timeoutSecondi(), tentativi } = {}) {
  const lista = leggiEndpoint();
  const totale = tentativi ?? Math.max(lista.length, 4);
  let ultimo = "nessuna risposta";
  for (let i = 0; i < totale; i++) {
    const url = lista[i % lista.length];
    const host = new URL(url).host;
    let attesa = null;
    try {
      const response = await fetch(url, {
        method: "POST",
        redirect: "error",
        headers: {
          "User-Agent": userAgent(),
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(timeoutSec * 1000),
      });
      if (response.status >= 300 && response.status < 400) {
        const dove = response.headers.get("location") ?? "";
        ultimo = `${host} redirect ${response.status} ${dove}`;
        console.error(`  ${ultimo}, nuovo tentativo…`);
        attesa = [1500, 4000, 8000, 12000][i] ?? 12000;
      } else if (response.ok) {
        const json = await leggiRisposta(response);
        if (json.remark) throw new ErrorePrevisto(`Overpass (${host}): ${json.remark}`);
        const ts = json?.osm3s?.timestamp_osm_base ?? "";
        if (!/^\d{4}-\d{2}-\d{2}T/.test(ts)) {
          ultimo = `${host} database non aggiornato (timestamp_osm_base=${ts || "mancante"})`;
          console.error(`  ${ultimo}, nuovo tentativo…`);
          attesa = [1500, 4000, 8000, 12000][i] ?? 12000;
        } else {
          return { json, host };
        }
      } else {
        const corpo = (await response.text()).slice(0, 240).replace(/\s+/g, " ");
        ultimo = `${host} HTTP ${response.status} ${corpo}`;
        const ritentabile = [429, 502, 503, 504].includes(response.status);
        if (!ritentabile) throw new ErrorePrevisto(`Overpass ha rifiutato la query (${ultimo}).`);
        if (response.status === 429) {
          const daHeader = millisecondiRetryAfter(response.headers.get("retry-after"));
          if (daHeader == null) {
            attesa = [1500, 4000, 8000, 12000][i] ?? 12000;
            console.error(`  ${ultimo}, Retry-After assente, nuovo tentativo…`);
          } else {
            const effettiva = limitaAttesa(daHeader);
            attesa = effettiva;
            const nota = effettiva === daHeader ? "" : ` (limite ${ATTESA_MASSIMA_MS / 1000} s)`;
            console.error(`  ${ultimo}, attesa Retry-After ${Math.ceil(effettiva / 1000)} s${nota}…`);
          }
        } else {
          attesa = [1500, 4000, 8000, 12000][i] ?? 12000;
          console.error(`  ${ultimo}, nuovo tentativo…`);
        }
      }
    } catch (err) {
      if (err instanceof ErrorePrevisto) throw err;
      ultimo = `${host} ${err.name === "TimeoutError" ? "timeout" : err.message}`;
      console.error(`  ${ultimo}, nuovo tentativo…`);
      attesa = [1500, 4000, 8000, 12000][i] ?? 12000;
    }
    if (attesa != null && i < totale - 1) await new Promise((res) => setTimeout(res, attesa));
  }
  throw new ErrorePrevisto(`Overpass non raggiungibile dopo ${totale} tentativi. Ultimo errore: ${ultimo}`);
}
