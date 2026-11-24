/**
 * Firma AWS Signature Version 4 per l'API S3 usata da Cloudflare R2.
 * Solo PutObject e PutBucketCors: niente SDK, niente segreti nei log.
 * Copyright (c) 2026 NVerlini
 */

import { createHash, createHmac } from "node:crypto";

export const HASH_VUOTO = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export function sha256Hex(dati) {
  const buf = Buffer.isBuffer(dati) ? dati : Buffer.from(dati);
  return createHash("sha256").update(buf).digest("hex");
}

/** Codifica di un segmento di percorso, come la richiede SigV4. */
export function codificaUri(valore) {
  return encodeURIComponent(String(valore)).replace(/[!'()*]/g, (c) =>
    `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function percorsoOggetto(bucket, key = "") {
  const coda = key
    ? `/${String(key).split("/").map((p) => codificaUri(p)).join("/")}`
    : "";
  return `/${codificaUri(bucket)}${coda}`;
}

export function dataAmz(adesso = new Date()) {
  return adesso.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function hmac(chiave, dati) {
  return createHmac("sha256", chiave).update(dati, "utf8").digest();
}

/**
 * Firma gli header. `headers` contiene solo quelli da firmare, host compreso.
 * I nomi vengono normalizzati in minuscolo e ordinati.
 */
export function firmaSigV4({
  method,
  percorso,
  query = "",
  headers,
  payloadHash,
  accessKey,
  secretKey,
  region,
  service = "s3",
  amzDate,
}) {
  const mappa = new Map();
  for (const [nome, valore] of Object.entries(headers)) {
    mappa.set(nome.toLowerCase(), String(valore).trim().replace(/\s+/g, " "));
  }
  const nomi = [...mappa.keys()].sort();
  const canonicalHeaders = nomi.map((n) => `${n}:${mappa.get(n)}\n`).join("");
  const signedHeaders = nomi.join(";");
  const canonicalRequest = [
    method.toUpperCase(),
    percorso,
    query,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${secretKey}`, dateStamp), region), service), "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { authorization, canonicalRequest, stringToSign, signature, signedHeaders };
}

/**
 * Richiesta firmata verso l'endpoint S3 di R2 (path-style).
 * `fetchImpl` si può sostituire nei test. Il segreto non entra nell'URL.
 */
export async function richiestaR2({
  method,
  accountId,
  bucket,
  key = "",
  query = "",
  body = null,
  contentType,
  cacheControl,
  contentMd5 = false,
  accessKey,
  secretKey,
  region = "auto",
  now = new Date(),
  fetchImpl = fetch,
}) {
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const percorso = percorsoOggetto(bucket, key);
  const payload = body == null ? Buffer.alloc(0) : Buffer.isBuffer(body) ? body : Buffer.from(body);
  const payloadHash = sha256Hex(payload);
  const amzDate = dataAmz(now);
  const headers = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (contentType) headers["content-type"] = contentType;
  if (cacheControl) headers["cache-control"] = cacheControl;
  if (contentMd5) headers["content-md5"] = createHash("md5").update(payload).digest("base64");
  const firmata = firmaSigV4({
    method,
    percorso,
    query,
    headers,
    payloadHash,
    accessKey,
    secretKey,
    region,
    service: "s3",
    amzDate,
  });
  const inviati = { ...headers, authorization: firmata.authorization };
  delete inviati.host;
  const url = `https://${host}${percorso}${query ? `?${query}` : ""}`;
  const risposta = await fetchImpl(url, {
    method,
    headers: inviati,
    body: method === "GET" || method === "HEAD" ? undefined : payload,
    redirect: "error",
  });
  return { risposta, url, authorization: firmata.authorization };
}
