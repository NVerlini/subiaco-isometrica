/**
 * Pagina di render headless: scena aperta, camera ortografica, una tile per volta.
 * Adattata da pipeline/page/renderer.ts di isometricworld e Mondo Isometrico (MIT).
 * Copyright (c) 2026 Dmytro Krasun
 * Copyright (c) 2026 Domenico Gagliardi
 * Copyright (c) 2026 NVerlini
 *
 * Rispetto al riferimento: passo altezze da config (3 cm, non 1 cm), pianta del
 * borgo al posto delle facciate di Tel Aviv e di Roma, niente impianti sul tetto.
 */
import * as THREE from "three";
import { STILE, cameraRettangolo, cameraTile, creaQuadro } from "../src/geo.mjs";
import { solidiPonte } from "../src/ponte.mjs";

const params = new URLSearchParams(location.search);
const SS = Math.max(1, Math.min(3, Number(params.get("ss") || 1)));
const pipeline = await (await fetch("/config/pipeline.json")).json();
const regione = pipeline.regione;
const quadro = creaQuadro(regione);
const geoidM = regione.geoidM;
const origineQuota = regione.heightBase - 100;
const passoQuota = regione.codificaAltezze.passoCm / 100;

const meta = await (await fetch("/ground/meta.json")).json();
const terrain = new Float32Array(await (await fetch("/ground/height.bin")).arrayBuffer());
const cover = new Uint8Array(await (await fetch("/ground/landcover.bin")).arrayBuffer());
const sceneDoc = await (await fetch("/scene/scene.json")).json();
const features = await (await fetch("/ground/features.json")).json();

const CIELO = 0xb7c9d6;

function suoloOrt(x, y) {
  const fx = (x - meta.x0) / meta.passoM;
  const fy = (y - meta.y0) / meta.passoM;
  if (fx < 0 || fy < 0 || fx > meta.nx - 1 || fy > meta.ny - 1) return null;
  const ix = Math.min(meta.nx - 2, Math.floor(fx));
  const iy = Math.min(meta.ny - 2, Math.floor(fy));
  const ax = fx - ix;
  const ay = fy - iy;
  const v = (a, b) => terrain[b * meta.nx + a];
  return (v(ix, iy) * (1 - ax) + v(ix + 1, iy) * ax) * (1 - ay)
    + (v(ix, iy + 1) * (1 - ax) + v(ix + 1, iy + 1) * ax) * ay;
}

function ground(x, y) {
  const q = suoloOrt(x, y);
  if (q == null) return null;
  return q + geoidM - (x * x + y * y) / (2 * 6371000);
}

let uMin = Infinity;
let uMax = -Infinity;
for (let iy = 0; iy < meta.ny; iy += 3) {
  for (let ix = 0; ix < meta.nx; ix += 3) {
    const u = ground(meta.x0 + ix * meta.passoM, meta.y0 + iy * meta.passoM);
    if (u == null) continue;
    uMin = Math.min(uMin, u);
    uMax = Math.max(uMax, u);
  }
}
if (!Number.isFinite(uMin)) {
  uMin = 300;
  uMax = 800;
}

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false });
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(CIELO, 1);
document.body.style.margin = "0";
document.body.appendChild(renderer.domElement);

const scena = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 10);
const sole = new THREE.DirectionalLight(0xfff2e0, 1.25);
sole.position.set(-0.55, -0.35, 0.85);
scena.add(sole);
scena.add(new THREE.AmbientLight(0x9eb0c4, 0.62));
scena.add(new THREE.HemisphereLight(0xd5e4f2, 0x6a5340, 0.38));

const terreno = new THREE.Mesh(
  new THREE.BufferGeometry(),
  new THREE.MeshBasicMaterial({ color: 0xffffff }),
);
scena.add(terreno);
const textureSuolo = new THREE.CanvasTexture(document.createElement("canvas"));
textureSuolo.colorSpace = THREE.SRGBColorSpace;
terreno.material.map = textureSuolo;

const oggetti = new THREE.Group();
scena.add(oggetti);

const heightMaterial = new THREE.ShaderMaterial({
  glslVersion: THREE.GLSL3,
  uniforms: {
    origine: { value: origineQuota },
    passo: { value: passoQuota },
  },
  vertexShader: /* glsl */ `
    out vec3 vEnu;
    void main() {
      #ifdef USE_INSTANCING
        vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
      #else
        vec4 w = modelMatrix * vec4(position, 1.0);
      #endif
      vEnu = w.xyz;
      gl_Position = projectionMatrix * viewMatrix * w;
    }`,
  fragmentShader: /* glsl */ `
    uniform float origine;
    uniform float passo;
    in vec3 vEnu;
    out vec4 fragColor;
    void main() {
      float h = vEnu.z + dot(vEnu.xy, vEnu.xy) / (2.0 * 6371000.0);
      float v = clamp(floor((h - origine) / passo + 0.5), 0.0, 65535.0);
      fragColor = vec4(floor(v / 256.0) / 255.0, mod(v, 256.0) / 255.0, 0.0, 1.0);
    }`,
  depthTest: true,
  depthWrite: true,
  side: THREE.DoubleSide,
});

const COLORE_CLASSE = {
  10: [46, 110, 58],
  20: [120, 150, 60],
  30: [176, 196, 110],
  40: [206, 186, 96],
  50: [214, 202, 184],
  60: [186, 174, 154],
  70: [236, 240, 244],
  80: [64, 128, 186],
  90: [70, 140, 140],
};

function assiPieni(heading) {
  const h = (heading * Math.PI) / 180;
  const p = (STILE.pitchDeg * Math.PI) / 180;
  const fwd = [Math.sin(h), Math.cos(h), 0];
  const right = [Math.cos(h), -Math.sin(h), 0];
  const up = [fwd[0] * Math.sin(p), fwd[1] * Math.sin(p), Math.cos(p)];
  const dir = [fwd[0] * Math.cos(p), fwd[1] * Math.cos(p), -Math.sin(p)];
  return { right, up, dir };
}

function rettangoloVista(x0px, y0px, x1px, y1px, heading) {
  const { right: r, up: v, dir: d } = assiPieni(heading);
  const xs = [];
  const ys = [];
  for (const sx of [x0px * STILE.mpp, x1px * STILE.mpp]) {
    for (const sy of [y0px * STILE.mpp, y1px * STILE.mpp]) {
      for (const u of [uMin - 20, uMax + 90]) {
        const t = (u + v[2] * sy) / d[2];
        xs.push(r[0] * sx - v[0] * sy + d[0] * t);
        ys.push(r[1] * sx - v[1] * sy + d[1] * t);
      }
    }
  }
  const m = 24;
  return [Math.min(...xs) - m, Math.min(...ys) - m, Math.max(...xs) + m, Math.max(...ys) + m];
}

function nelBox(e, n, box) {
  return e >= box[0] && e <= box[2] && n >= box[1] && n <= box[3];
}

function anelloTaglia(anello, box) {
  return anello.some(([e, n]) => nelBox(e, n, box));
}

function proiettaAnello(anello) {
  return anello.map(([lon, lat]) => quadro.piano(lon, lat));
}

function senso(anello) {
  let a = 0;
  for (let i = 0; i < anello.length - 1; i++) {
    a += anello[i][0] * anello[i + 1][1] - anello[i + 1][0] * anello[i][1];
  }
  return a >= 0 ? anello : anello.slice().reverse();
}

function apri(anello) {
  if (anello.length < 2) return anello;
  const a = anello[0];
  const b = anello[anello.length - 1];
  if (a[0] === b[0] && a[1] === b[1]) return anello.slice(0, -1);
  return anello;
}

const MURO = [0.78, 0.62, 0.48];
const TETTO = [0.55, 0.28, 0.18];
const MURO_TORRE = [0.62, 0.5, 0.42];
const TETTO_TORRE = [0.32, 0.22, 0.2];
const MURO_ROCCA = [0.55, 0.28, 0.24];
const TETTO_ROCCA = [0.32, 0.16, 0.14];
const CHIESA = [0.86, 0.78, 0.66];
const TETTO_CHIESA = [0.62, 0.3, 0.2];
const PONTE = [0.45, 0.48, 0.52];

function coloriParte(parte, edificio) {
  if (parte.ruolo === "torre") return [MURO_TORRE, TETTO_TORRE];
  if (edificio.landmark === "rocca-abbaziale") return [MURO_ROCCA, TETTO_ROCCA];
  if (edificio.tipologia === "church" || edificio.tipologia === "cathedral" || edificio.tipologia === "chapel") {
    return [CHIESA, TETTO_CHIESA];
  }
  if (edificio.landmark) return [MURO_ROCCA, TETTO];
  return [MURO, TETTO];
}

function costruisciSuolo(box) {
  const [x0, y0, x1, y1] = box;
  const cv = textureSuolo.image;
  const lato = Math.max(x1 - x0, y1 - y0);
  const scala = Math.min(1.1, 1400 / Math.max(1, lato));
  cv.width = Math.max(8, Math.ceil((x1 - x0) * scala));
  cv.height = Math.max(8, Math.ceil((y1 - y0) * scala));
  const ctx = cv.getContext("2d");
  const img = ctx.createImageData(cv.width, cv.height);
  const dati = img.data;
  for (let py = 0; py < cv.height; py++) {
    const n = y1 - ((py + 0.5) / cv.height) * (y1 - y0);
    for (let px = 0; px < cv.width; px++) {
      const e = x0 + ((px + 0.5) / cv.width) * (x1 - x0);
      const ix = Math.round((e - meta.x0) / meta.passoM);
      const iy = Math.round((n - meta.y0) / meta.passoM);
      let col = [196, 188, 170];
      if (ix >= 0 && iy >= 0 && ix < meta.nx && iy < meta.ny) {
        col = COLORE_CLASSE[cover[iy * meta.nx + ix]] ?? col;
      }
      const i = (py * cv.width + px) * 4;
      dati[i] = col[0];
      dati[i + 1] = col[1];
      dati[i + 2] = col[2];
      dati[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const aPx = (e, n) => [
    ((e - x0) / (x1 - x0)) * cv.width,
    ((y1 - n) / (y1 - y0)) * cv.height,
  ];
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (const poly of features.acquaPoligoni ?? []) {
    const pts = (poly.anello ?? []).map(([lon, lat]) => aPx(...quadro.piano(lon, lat)));
    if (pts.length < 3) continue;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]);
    ctx.closePath();
    ctx.fillStyle = "#3c82c0";
    ctx.fill();
  }
  for (const fiume of features.acquaLinee ?? []) {
    const pts = (fiume.linea ?? []).map(([lon, lat]) => aPx(...quadro.piano(lon, lat)));
    if (pts.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]);
    ctx.strokeStyle = "#3c82c0";
    ctx.lineWidth = Math.max(2, 14 * scala);
    ctx.stroke();
  }
  for (const strada of sceneDoc.strade ?? []) {
    if (strada.landmark === "ponte-san-francesco") continue;
    const pts = (strada.linea ?? []).map(([lon, lat]) => aPx(...quadro.piano(lon, lat)));
    if (pts.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]);
    const larga = ["primary", "secondary", "tertiary"].includes(String(strada.classe).replace(/_link$/, ""));
    ctx.strokeStyle = larga ? "#5c5c60" : "#8a8680";
    ctx.lineWidth = Math.max(1, (strada.larghezzaM ?? 4) * scala * 0.85);
    ctx.stroke();
  }
  textureSuolo.needsUpdate = true;

  const step = meta.passoM;
  const nx = Math.ceil((x1 - x0) / step) + 1;
  const ny = Math.ceil((y1 - y0) / step) + 1;
  const pos = new Float32Array(nx * ny * 3);
  const uv = new Float32Array(nx * ny * 2);
  const idx = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const x = Math.min(x1, x0 + i * step);
      const y = Math.min(y1, y0 + j * step);
      const k = j * nx + i;
      const z = ground(x, y) ?? uMin;
      pos[k * 3] = x;
      pos[k * 3 + 1] = y;
      pos[k * 3 + 2] = z;
      uv[k * 2] = (x - x0) / (x1 - x0);
      uv[k * 2 + 1] = (y - y0) / (y1 - y0);
      if (i && j) idx.push(k - nx - 1, k - nx, k, k - nx - 1, k, k - 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  terreno.geometry.dispose();
  terreno.geometry = geo;
}

function spingi(pos, col, x, y, z, colore) {
  pos.push(x, y, z);
  col.push(colore[0], colore[1], colore[2]);
}

function quad(pos, col, verts, colore) {
  const ordine = [0, 1, 2, 0, 2, 3];
  for (const i of ordine) spingi(pos, col, verts[i][0], verts[i][1], verts[i][2], colore);
}

function estrudi(pos, col, anello, altezza, muro, tettoCol) {
  const aperti = senso(apri(anello));
  if (aperti.length < 3) return;
  const quote = aperti.map(([e, n]) => ground(e, n)).filter((q) => q != null);
  if (quote.length < 3) return;
  const base = Math.min(...quote) - 0.35;
  const colmo = Math.max(...quote) + altezza;
  for (let i = 0; i < aperti.length; i++) {
    const [ax, ay] = aperti[i];
    const [bx, by] = aperti[(i + 1) % aperti.length];
    const za = ground(ax, ay) ?? base;
    const zb = ground(bx, by) ?? base;
    const piede = Math.min(za, zb, base);
    quad(pos, col, [
      [ax, ay, piede],
      [bx, by, piede],
      [bx, by, colmo],
      [ax, ay, colmo],
    ], muro);
  }
  try {
    const shape = aperti.map(([e, n]) => new THREE.Vector2(e, n));
    const tris = THREE.ShapeUtils.triangulateShape(shape, []);
    for (const t of tris) {
      for (const i of t) spingi(pos, col, shape[i].x, shape[i].y, colmo, tettoCol);
    }
  } catch {
    /* anello non triangolabile: restano i muri */
  }
}

function costruisciOggetti(box) {
  while (oggetti.children.length) {
    const child = oggetti.children.pop();
    child.geometry?.dispose();
  }
  const pos = [];
  const col = [];
  for (const ed of sceneDoc.edifici ?? []) {
    const parti = ed.parti?.length ? ed.parti : [{ ruolo: "corpo", anello: ed.anello, altezzaM: ed.altezzaM }];
    for (const parte of parti) {
      const anello = proiettaAnello(parte.anello);
      if (!anelloTaglia(anello, box)) continue;
      const [muro, tettoCol] = coloriParte(parte, ed);
      estrudi(pos, col, anello, parte.altezzaM, muro, tettoCol);
    }
  }
  for (const ponte of sceneDoc.ponti ?? []) {
    const linea = proiettaAnello(ponte.linea);
    if (ponte.landmark === "ponte-san-francesco" && linea.length >= 2) {
      const quote = linea.map(([e, n]) => ground(e, n));
      if (quote.every((q) => q != null) && linea.some(([e, n]) => nelBox(e, n, box))) {
        const solido = solidiPonte(linea, quote, {
          larghezzaM: ponte.larghezzaM ?? 4.5,
          spessoreM: ponte.spessoreM ?? 1.2,
          frecciaMaxM: 9,
        });
        for (const faccia of solido.facce) quad(pos, col, faccia.verts, faccia.colore);
        continue;
      }
    }
    const mezzo = (ponte.larghezzaM ?? 4.5) / 2;
    for (let i = 1; i < linea.length; i++) {
      const [ax, ay] = linea[i - 1];
      const [bx, by] = linea[i];
      if (!nelBox(ax, ay, box) && !nelBox(bx, by, box)) continue;
      const len = Math.hypot(bx - ax, by - ay) || 1;
      const px = (-(by - ay) / len) * mezzo;
      const py = ((bx - ax) / len) * mezzo;
      estrudi(pos, col, [
        [ax + px, ay + py],
        [bx + px, by + py],
        [bx - px, by - py],
        [ax - px, ay - py],
        [ax + px, ay + py],
      ], ponte.spessoreM ?? 1.2, PONTE, [0.62, 0.64, 0.66]);
    }
  }
  if (pos.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    oggetti.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })));
  }

  const alberi = [];
  for (const albero of sceneDoc.alberi ?? []) {
    const e = Number.isFinite(albero.e) ? albero.e : albero.lon != null ? quadro.piano(albero.lon, albero.lat)[0] : null;
    const n = Number.isFinite(albero.n) ? albero.n : albero.lon != null ? quadro.piano(albero.lon, albero.lat)[1] : null;
    if (e == null || !nelBox(e, n, box)) continue;
    alberi.push([e, n, albero.altezzaM, albero.raggioM ?? 2.4, albero.classeVegetazione || albero.fonte]);
  }
  const passo = alberi.length > 7000 ? 2 : 1;
  const scelti = passo === 1 ? alberi : alberi.filter((_, i) => i % passo === 0);
  if (scelti.length) {
    const chiome = new THREE.InstancedMesh(
      new THREE.ConeGeometry(1, 1, 7).rotateX(Math.PI / 2).translate(0, 0, 0.5),
      new THREE.MeshLambertMaterial({ color: 0xffffff }),
      scelti.length,
    );
    const tronchi = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(1, 1, 1, 5).rotateX(Math.PI / 2).translate(0, 0, 0.5),
      new THREE.MeshLambertMaterial({ color: 0x6a5340 }),
      scelti.length,
    );
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const colore = new THREE.Color();
    scelti.forEach(([e, n, h, r, fonte], i) => {
      const g = ground(e, n);
      if (g == null) {
        m.makeScale(0, 0, 0);
        chiome.setMatrixAt(i, m);
        tronchi.setMatrixAt(i, m);
        return;
      }
      const alto = fonte === "arbusti" || fonte === "worldcover-arbusti" ? 0.55 : 1;
      m.compose(new THREE.Vector3(e, n, g + h * 0.42), q, new THREE.Vector3(r * alto, r * alto, h * 0.72));
      chiome.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(e, n, g), q, new THREE.Vector3(r * 0.12, r * 0.12, h * 0.45));
      tronchi.setMatrixAt(i, m);
      const verde = fonte === "faggeta"
        ? [0.62, 0.74, 0.38]
        : fonte === "arbusti" || fonte === "worldcover-arbusti"
          ? [0.42, 0.55, 0.24]
          : [0.16, 0.38, 0.2];
      chiome.setColorAt(i, colore.setRGB(verde[0], verde[1], verde[2]));
    });
    chiome.instanceColor.needsUpdate = true;
    oggetti.add(chiome, tronchi);
  }
}

function piazza(cam) {
  camera.left = -cam.halfX;
  camera.right = cam.halfX;
  camera.top = cam.halfY;
  camera.bottom = -cam.halfY;
  camera.near = cam.near;
  camera.far = cam.far;
  camera.position.set(cam.pos[0], cam.pos[1], cam.pos[2]);
  camera.up.set(cam.up[0], cam.up[1], cam.up[2]);
  camera.lookAt(cam.pos[0] + cam.dir[0], cam.pos[1] + cam.dir[1], cam.pos[2] + cam.dir[2]);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
}

function bufToB64(buf) {
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

let heightTarget = null;
function bersaglioAltezze() {
  if (heightTarget) return heightTarget;
  heightTarget = new THREE.WebGLRenderTarget(256, 256, { depthBuffer: true });
  heightTarget.texture.generateMipmaps = false;
  return heightTarget;
}

async function renderTile(tx, ty, heading) {
  const hdg = Number(heading);
  const x0 = tx * STILE.tile;
  const y0 = ty * STILE.tile;
  const x1 = x0 + STILE.tile;
  const y1 = y0 + STILE.tile;
  const box = rettangoloVista(x0, y0, x1, y1, hdg);
  costruisciOggetti(box);
  costruisciSuolo(box);
  piazza(cameraTile(tx, ty, hdg));
  renderer.setSize(STILE.tile * SS, STILE.tile * SS, false);
  renderer.setRenderTarget(null);
  renderer.setClearColor(CIELO, 1);
  renderer.render(scena, camera);
  const color = renderer.domElement.toDataURL("image/png");

  const target = bersaglioAltezze();
  scena.overrideMaterial = heightMaterial;
  renderer.setRenderTarget(target);
  renderer.setClearColor(0x000000, 0);
  renderer.clear(true, true, true);
  renderer.render(scena, camera);
  const buf = new Uint8Array(256 * 256 * 4);
  renderer.readRenderTargetPixels(target, 0, 0, 256, 256, buf);
  renderer.setRenderTarget(null);
  renderer.setClearColor(CIELO, 1);
  scena.overrideMaterial = null;
  return { color, height: bufToB64(buf) };
}

async function renderQuadro(spec) {
  const hdg = Number(spec.heading);
  const box = rettangoloVista(spec.x0, spec.y0, spec.x1, spec.y1, hdg);
  costruisciOggetti(box);
  costruisciSuolo(box);
  piazza(cameraRettangolo(spec.x0, spec.y0, spec.x1, spec.y1, hdg));
  renderer.setSize(spec.w, spec.h, false);
  renderer.setRenderTarget(null);
  renderer.setClearColor(CIELO, 1);
  renderer.render(scena, camera);
  return { color: renderer.domElement.toDataURL("image/png"), w: spec.w, h: spec.h };
}

window.renderTile = renderTile;
window.renderQuadro = renderQuadro;
window.ready = true;
