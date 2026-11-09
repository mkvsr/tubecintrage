// Vue 3D (three.js) : pièce finie et simulation machine. Sert aussi à produire les images du PDF.
import * as THREE from "three";
import { OrbitControls } from "three/addons/OrbitControls.js";
import { Simulation } from "./core/simulation.js";
import { estCintre } from "./core/geometrie.js";
import { affichageB } from "./core/sequence.js";

export const COULEURS = {
  droit: 0x9aa3ad, cintre: 0xe08a2e, cintreFait: 0x3b7dd8, enCours: 0xe08a2e, collision: 0xd62728,
  surlong: 0xc9b8ff, soudure: 0xc0392b, machine: 0x9db3cf, chariot: 0xf2c14e, sol: 0xcfd5dc,
  zone: 0x7fbf7f, operateur: 0x5b8c5a, matrice: 0x5d6d7e, reglette: 0x7b8a99,
};
const PARTIE = [COULEURS.cintreFait, COULEURS.enCours, COULEURS.droit, COULEURS.collision];

// ----------------------------------------------------------------------
// Géométrie d'un tube le long d'une polyligne (repère par transport parallèle), couleur par point
export function geometrieTube(pts, rayon, couleurs = null, cotes = 18, fermer = true) {
  const P = [], C = [];
  pts.forEach((p, k) => {
    if (P.length) { const q = P[P.length - 1]; if (Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < 1e-6) return; }
    P.push(p); C.push(couleurs ? couleurs[k] : null);
  });
  const n = P.length;
  const g = new THREE.BufferGeometry();
  if (n < 2) return g;
  const V = P.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
  const T = V.map((v, k) => {
    const a = V[Math.max(0, k - 1)], b = V[Math.min(n - 1, k + 1)];
    return b.clone().sub(a).normalize();
  });
  let N0 = new THREE.Vector3(0, 0, 1);
  if (Math.abs(T[0].dot(N0)) > 0.9) N0 = new THREE.Vector3(1, 0, 0);
  N0 = N0.sub(T[0].clone().multiplyScalar(N0.dot(T[0]))).normalize();
  const Ns = [N0];
  for (let k = 1; k < n; k++) {
    const ax = new THREE.Vector3().crossVectors(T[k - 1], T[k]);
    let Nk = Ns[k - 1].clone();
    const l = ax.length();
    if (l > 1e-9) Nk.applyAxisAngle(ax.divideScalar(l), Math.acos(Math.max(-1, Math.min(1, T[k - 1].dot(T[k])))));
    Nk.sub(T[k].clone().multiplyScalar(Nk.dot(T[k]))).normalize();
    Ns.push(Nk);
  }
  const pos = [], nor = [], col = [], idx = [];
  const coul = new THREE.Color();
  for (let k = 0; k < n; k++) {
    const B = new THREE.Vector3().crossVectors(T[k], Ns[k]);
    coul.set(C[k] ?? COULEURS.droit);
    for (let j = 0; j <= cotes; j++) {
      const a = (j / cotes) * Math.PI * 2;
      const d = Ns[k].clone().multiplyScalar(Math.cos(a)).add(B.clone().multiplyScalar(Math.sin(a)));
      pos.push(V[k].x + d.x * rayon, V[k].y + d.y * rayon, V[k].z + d.z * rayon);
      nor.push(d.x, d.y, d.z); col.push(coul.r, coul.g, coul.b);
    }
  }
  const L = cotes + 1;
  for (let k = 0; k < n - 1; k++) for (let j = 0; j < cotes; j++) {
    const a = k * L + j, b = a + L;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  if (fermer) for (const [k, sgn] of [[0, -1], [n - 1, 1]]) {
    const c0 = pos.length / 3;
    coul.set(C[k] ?? COULEURS.droit);
    pos.push(V[k].x, V[k].y, V[k].z); nor.push(T[k].x * sgn, T[k].y * sgn, T[k].z * sgn); col.push(coul.r, coul.g, coul.b);
    for (let j = 0; j <= cotes; j++) {
      const i = k * L + j;
      pos.push(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]); nor.push(T[k].x * sgn, T[k].y * sgn, T[k].z * sgn); col.push(coul.r, coul.g, coul.b);
    }
    for (let j = 0; j < cotes; j++) sgn > 0 ? idx.push(c0, c0 + 1 + j, c0 + 2 + j) : idx.push(c0, c0 + 2 + j, c0 + 1 + j);
  }
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

const matTube = () => new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.25, roughness: 0.45 });
const matCouleur = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, metalness: 0.1, roughness: 0.7, ...o });

function boite(xmin, xmax, ymin, ymax, zmin, zmax, materiau) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(xmax - xmin, ymax - ymin, zmax - zmin), materiau);
  m.position.set((xmin + xmax) / 2, (ymin + ymax) / 2, (zmin + zmax) / 2);
  return m;
}

function eclairer(scene) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a96a3, 1.6));
  const d = new THREE.DirectionalLight(0xffffff, 1.6); d.position.set(-2, -3, 5); scene.add(d);
  const d2 = new THREE.DirectionalLight(0xffffff, 0.6); d2.position.set(3, 2, 1); scene.add(d2);
}

const ligneSoudure = (pts, vecs, r) => {
  const q = pts.map((p, k) => [p[0] + vecs[k][0] * (r + 0.4), p[1] + vecs[k][1] * (r + 0.4), p[2] + vecs[k][2] * (r + 0.4)]);
  const c = q.map(() => COULEURS.soudure);
  return new THREE.Mesh(geometrieTube(q, Math.max(0.8, r * 0.07), c, 6), new THREE.MeshBasicMaterial({ color: COULEURS.soudure }));
};

// ----------------------------------------------------------------------
/** Contenu « pièce finie » : renvoie {groupe, etiquettes, points}. */
export function construirePiece(prog, { soudure = true } = {}) {
  const groupe = new THREE.Group();
  const tube = prog.tube, r = tube.diametre / 2;
  const sim = new Simulation(prog, 6);
  const pts = sim.cadPts, s = sim.cadS;
  const bornes = []; let cum = 0;
  for (const e of tube.elements) { bornes.push([cum, cum + e.longueur, estCintre(e)]); cum += e.longueur; }
  const coul = s.map((sv) => {
    if (sv < 0) return COULEURS.surlong;
    for (const [a, b, c] of bornes) if (sv >= a - 1e-9 && sv <= b + 1e-9) return c ? COULEURS.cintre : COULEURS.droit;
    return COULEURS.droit;
  });
  groupe.add(new THREE.Mesh(geometrieTube(pts, r, coul), matTube()));
  if (soudure) groupe.add(ligneSoudure(pts, sim.cadSoudure, r));
  const tous = [...pts];
  if (prog.surlongArriere > 0) {
    const d = tube.droites[tube.droites.length - 1].direction, a = tube.fin;
    const b = [a[0] + d[0] * prog.surlongArriere, a[1] + d[1] * prog.surlongArriere, a[2] + d[2] * prog.surlongArriere];
    groupe.add(new THREE.Mesh(geometrieTube([a, b], r * 1.001, [COULEURS.surlong, COULEURS.surlong]),
      new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.6 })));
    tous.push(b);
  }
  const etiquettes = [];
  tube.cintres.forEach((c, i) => {
    const m = c.pointA(c.angle / 2), v = [m[0] - c.centre[0], m[1] - c.centre[1], m[2] - c.centre[2]];
    const l = Math.hypot(...v), k = Math.max(r * 2.6, 45) / l;
    etiquettes.push({ pos: [m[0] + v[0] * k, m[1] + v[1] * k, m[2] + v[2] * k], ancre: m, texte: String(i + 1), type: "pli",
      detail: `${(c.angle * 180 / Math.PI).toFixed(1).replace(".", ",")}°` });
  });
  etiquettes.push({ pos: pts[0], texte: "AVANT", type: "extremite", detail: "entre en premier" });
  etiquettes.push({ pos: tous[tous.length - 1], texte: "ARRIÈRE", type: "extremite", detail: "pince du chariot" });
  return { groupe, etiquettes, points: tous };
}

/** Décor machine (sol, bâti, forme, opérateur). */
export function construireMachine(prog, { zones = false, operateur = true } = {}) {
  const groupe = new THREE.Group();
  const m = prog.machine, H = m.hauteur_axe_sol, D = prog.tube.diametre;
  const R = prog.etapes.length ? prog.etapes[0].rayon : (prog.outil ? prog.outil.rayon : 150);
  const sol = new THREE.Mesh(new THREE.PlaneGeometry(12000, 12000), matCouleur(COULEURS.sol, { roughness: 1 }));
  sol.position.set(-2500, 0, -H); groupe.add(sol);
  const grille = new THREE.GridHelper(12000, 24, 0xb9c1ca, 0xb9c1ca);
  grille.rotation.x = Math.PI / 2; grille.position.set(-2500, 0, -H + 0.5); groupe.add(grille);
  for (const o of m.obstacles) {
    if (!o.actif) continue;
    const zmin = Math.max(o.zmin, -H);
    if (o.gravite === "erreur") {
      const b = boite(o.xmin, o.xmax, o.ymin, o.ymax, zmin, o.zmax, matCouleur(COULEURS.machine));
      groupe.add(b);
      const ar = new THREE.LineSegments(new THREE.EdgesGeometry(b.geometry), new THREE.LineBasicMaterial({ color: 0x6d84a3 }));
      ar.position.copy(b.position); groupe.add(ar);
    } else if (zones) {
      const b = boite(o.xmin, o.xmax, o.ymin, o.ymax, zmin, o.zmax,
        matCouleur(COULEURS.zone, { transparent: true, opacity: 0.06, depthWrite: false }));
      groupe.add(b);
      const ar = new THREE.LineSegments(new THREE.EdgesGeometry(b.geometry), new THREE.LineBasicMaterial({ color: COULEURS.zone }));
      ar.position.copy(b.position); groupe.add(ar);
    }
  }
  const forme = new THREE.Mesh(new THREE.CylinderGeometry(R - D / 2, R - D / 2, D * 1.6, 72), matCouleur(COULEURS.matrice, { metalness: 0.4, roughness: 0.4 }));
  forme.rotation.x = Math.PI / 2; forme.position.set(0, R, 0); groupe.add(forme);
  groupe.add(boite(-450, 0, -D * 1.2, -D / 2, -D * 0.8, D * 0.8, matCouleur(COULEURS.reglette)));
  if (operateur) {
    const mo = matCouleur(COULEURS.operateur, { transparent: true, opacity: 0.25, depthWrite: false });
    const corps = new THREE.Mesh(new THREE.CylinderGeometry(180, 180, 1700, 24), mo);
    corps.rotation.x = Math.PI / 2; corps.position.set(-650, -1150, -H + 850); groupe.add(corps);
    const tete = new THREE.Mesh(new THREE.SphereGeometry(130, 24, 16), mo);
    tete.position.set(-650, -1150, -H + 1830); groupe.add(tete);
  }
  return groupe;
}

/** Tube et chariot pour une image de la simulation. `coupe` : raccourcit la partie droite côté chariot (vignettes). */
export function construireEtat(prog, etat, collisions = [], { coupe = null } = {}) {
  const groupe = new THREE.Group();
  const D = prog.tube.diametre;
  const partie = etat.partie.slice();
  for (const c of collisions) for (const k of c.indices) partie[k] = 3;
  let pts = etat.pts, sv = etat.soudure;
  let coupeX = null;
  if (coupe != null) {
    const garde = pts.map((p, k) => !(etat.partie[k] === 2 && p[0] < coupe));
    if (garde.some((g) => !g)) coupeX = coupe;
    const P2 = [], S2 = [], C2 = [];
    pts.forEach((p, k) => { if (garde[k]) { P2.push(p); S2.push(sv[k]); C2.push(partie[k]); } });
    pts = P2; sv = S2; partie.length = 0; partie.push(...C2);
  }
  groupe.add(new THREE.Mesh(geometrieTube(pts, D / 2, partie.map((p) => PARTIE[p])), matTube()));
  groupe.add(ligneSoudure(pts, sv, D / 2));
  if (coupeX == null) {
    const xr = etat.xArriere;
    groupe.add(boite(xr - 260, xr + 15, -130, 130, -110, 140, matCouleur(COULEURS.chariot)));
  }
  return { groupe, points: pts, coupeX };
}

// ----------------------------------------------------------------------
const V3 = (p) => new THREE.Vector3(p[0], p[1], p[2]);

/** Direction de vue automatique pour la pièce : à peu près perpendiculaire au plan moyen, inclinée. */
export function vueAutomatique(points) {
  const n = points.length, c = [0, 0, 0];
  for (const p of points) { c[0] += p[0] / n; c[1] += p[1] / n; c[2] += p[2] / n; }
  const M = new THREE.Matrix3();
  const a = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const p of points) {
    const d = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) a[3 * i + j] += d[i] * d[j];
  }
  M.fromArray(a);
  const { vecteurs } = jacobi3(a);
  let [e1, e2, e3] = vecteurs;        // variance décroissante
  if (e3.z < -1e-6 || (Math.abs(e3.z) < 1e-6 && e3.y > 0)) e3.negate();
  if (e2.dot(new THREE.Vector3(0, 0, 1)) < 0) e2.negate();
  e1 = new THREE.Vector3().crossVectors(e2, e3);
  const dir = e3.clone().multiplyScalar(0.72).add(e2.clone().multiplyScalar(-0.52)).add(e1.clone().multiplyScalar(0.42)).normalize();
  const up = e2.clone().sub(dir.clone().multiplyScalar(e2.dot(dir))).normalize();
  return { centre: V3(c), dir, up };
}

function jacobi3(a) {
  const A = [[a[0], a[1], a[2]], [a[3], a[4], a[5]], [a[6], a[7], a[8]]];
  const V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let it = 0; it < 60; it++) {
    let p = 0, q = 1;
    if (Math.abs(A[0][2]) > Math.abs(A[p][q])) { p = 0; q = 2; }
    if (Math.abs(A[1][2]) > Math.abs(A[p][q])) { p = 1; q = 2; }
    if (Math.abs(A[p][q]) < 1e-9) break;
    const th = (A[q][q] - A[p][p]) / (2 * A[p][q]);
    const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
    const c = 1 / Math.sqrt(t * t + 1), s = t * c;
    for (let k = 0; k < 3; k++) { const x = A[k][p], y = A[k][q]; A[k][p] = c * x - s * y; A[k][q] = s * x + c * y; }
    for (let k = 0; k < 3; k++) { const x = A[p][k], y = A[q][k]; A[p][k] = c * x - s * y; A[q][k] = s * x + c * y; }
    for (let k = 0; k < 3; k++) { const x = V[k][p], y = V[k][q]; V[k][p] = c * x - s * y; V[k][q] = s * x + c * y; }
  }
  const ordre = [0, 1, 2].sort((i, j) => A[j][j] - A[i][i]);
  return { vecteurs: ordre.map((i) => new THREE.Vector3(V[0][i], V[1][i], V[2][i]).normalize()) };
}

/** Caméra orthographique cadrée exactement sur des points (pour les images du PDF). */
function cameraCadree(points, dir, up, aspect, marge = 0.06) {
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -1e5, 1e5);
  const centre = new THREE.Vector3();
  points.forEach((p) => centre.add(V3(p))); centre.divideScalar(points.length);
  cam.up.copy(up);
  cam.position.copy(centre).add(dir.clone().multiplyScalar(10000));
  cam.lookAt(centre);
  cam.updateMatrixWorld();
  const inv = cam.matrixWorldInverse;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of points) { const q = V3(p).applyMatrix4(inv); x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); }
  let w = (x1 - x0) * (1 + 2 * marge), h = (y1 - y0) * (1 + 2 * marge);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  if (w / h > aspect) h = w / aspect; else w = h * aspect;
  cam.left = cx - w / 2; cam.right = cx + w / 2; cam.top = cy + h / 2; cam.bottom = cy - h / 2;
  cam.updateProjectionMatrix();
  return cam;
}

// ----------------------------------------------------------------------
// Rendu hors écran pour le PDF
let _rendu = null;
function rendu(l, h) {
  if (!_rendu) {
    const canvas = document.createElement("canvas");
    _rendu = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, alpha: false });
    _rendu.setPixelRatio(1);
  }
  _rendu.setSize(l, h, false);
  return _rendu;
}

function dessinerEtiquettes(ctx, cam, etiquettes, l, h, echelle) {
  const proj = (p) => { const v = V3(p).project(cam); return [(v.x + 1) / 2 * l, (1 - v.y) / 2 * h]; };
  for (const e of etiquettes) {
    const [x, y] = proj(e.pos);
    if (e.type === "pli") {
      const r = 15 * echelle;
      if (e.ancre) {
        const [ax, ay] = proj(e.ancre);
        ctx.strokeStyle = "#1f3b57"; ctx.lineWidth = 1.5 * echelle;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(x, y); ctx.stroke();
      }
      ctx.fillStyle = "#ffffff"; ctx.strokeStyle = "#1f3b57"; ctx.lineWidth = 2.2 * echelle;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#1f3b57"; ctx.font = `bold ${17 * echelle}px DejaVu Sans, Arial, sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(e.texte, x, y + 1);
    } else {
      ctx.font = `bold ${15 * echelle}px DejaVu Sans, Arial, sans-serif`;
      const txt = e.texte, w = ctx.measureText(txt).width + 12 * echelle, hh = 22 * echelle;
      let bx = x + 10 * echelle, by = y - hh - 4 * echelle;
      bx = Math.min(Math.max(2, bx), l - w - 2); by = Math.min(Math.max(2, by), h - hh - 2);
      ctx.fillStyle = "rgba(255,255,255,0.9)"; ctx.strokeStyle = "#1f3b57"; ctx.lineWidth = 1.2 * echelle;
      ctx.fillRect(bx, by, w, hh); ctx.strokeRect(bx, by, w, hh);
      ctx.fillStyle = "#1f3b57"; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(txt, bx + 6 * echelle, by + hh / 2 + 1);
    }
  }
}

function versImage(renderer, scene, cam, l, h, fond, etiquettes, echelle) {
  scene.background = new THREE.Color(fond);
  renderer.render(scene, cam);
  const c = document.createElement("canvas"); c.width = l; c.height = h;
  const ctx = c.getContext("2d");
  ctx.drawImage(renderer.domElement, 0, 0);
  if (etiquettes) dessinerEtiquettes(ctx, cam, etiquettes, l, h, echelle);
  return c.toDataURL("image/jpeg", 0.9);
}

/** Image de la pièce finie, orientée automatiquement. */
export function imagePiece(prog, l = 1100, h = 760) {
  const scene = new THREE.Scene(); eclairer(scene);
  const { groupe, etiquettes, points } = construirePiece(prog);
  scene.add(groupe);
  const { dir, up } = vueAutomatique(points);
  const tous = [...points, ...etiquettes.map((e) => e.pos)];
  // tourne l'image autour de l'axe de vue pour que la pièce remplisse le cadre (à peu près « debout »)
  const Z = new THREE.Vector3(0, 0, 1);
  let best = null;
  for (let a = 0; a < 180; a += 7.5) {
    const u = up.clone().applyAxisAngle(dir, (a * Math.PI) / 180);
    for (const uu of [u, u.clone().negate()]) {
      const c = cameraCadree(tous, dir, uu, l / h, 0);
      const ech = 1 / (c.right - c.left);
      const score = ech * (1 + 0.04 * uu.dot(Z));
      if (!best || score > best.score) best = { score, uu };
    }
  }
  const cam = cameraCadree(tous, dir, best.uu, l / h, 0.07);
  return versImage(rendu(l, h), scene, cam, l, h, 0xffffff, etiquettes, l / 1100 * 1.8);
}

export const DIR_MACHINE = new THREE.Vector3(-2550, -3650, 2550).normalize();

/** Vignette de simulation (vue de 3/4 comme dans le logiciel). */
export function imageEtat(prog, etat, l = 900, h = 640) {
  const scene = new THREE.Scene(); eclairer(scene);
  scene.add(construireMachine(prog, { operateur: false }));
  const R = prog.etapes.length ? prog.etapes[0].rayon : 145;
  const { groupe, points, coupeX } = construireEtat(prog, etat, [], { coupe: -900 });
  scene.add(groupe);
  const cadre = [...points, [0, 2 * R, 0], [R, R, 0], [-R, R, 0]];
  const cam = cameraCadree(cadre, DIR_MACHINE, new THREE.Vector3(0, 0, 1), l / h, 0.12);
  const etiq = [];
  if (coupeX != null) etiq.push({ pos: [coupeX, 0, 0], texte: "→ chariot", type: "extremite" });
  return versImage(rendu(l, h), scene, cam, l, h, 0xe9edf2, etiq, l / 900 * 1.2);
}

// ----------------------------------------------------------------------
/** Vue interactive dans la page. */
export class Vue3D {
  constructor(conteneur) {
    this.conteneur = conteneur;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    conteneur.appendChild(this.renderer.domElement);
    this.etiq = document.createElement("div"); this.etiq.className = "etiquettes3d";
    conteneur.appendChild(this.etiq);
    this.scene = new THREE.Scene();
    eclairer(this.scene);
    this.camera = new THREE.PerspectiveCamera(38, 1, 5, 60000);
    this.camera.up.set(0, 0, 1);
    this.controles = new OrbitControls(this.camera, this.renderer.domElement);
    this.controles.enableDamping = true; this.controles.dampingFactor = 0.15;
    this.controles.addEventListener("change", () => this.demander());
    this.contenu = new THREE.Group(); this.scene.add(this.contenu);
    this.dyn = new THREE.Group(); this.scene.add(this.dyn);
    this.etiquettes = [];
    this.mode = null;
    this._fond();
    new ResizeObserver(() => this.redimensionner()).observe(conteneur);
    this.redimensionner();
    const boucle = () => { requestAnimationFrame(boucle); if (this.controles.update() || this._sale) { this._sale = false; this.rendre(); } };
    boucle();
  }

  _fond() {
    const c = document.createElement("canvas"); c.width = 2; c.height = 256;
    const x = c.getContext("2d"), g = x.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, "#f4f6f9"); g.addColorStop(1, "#d5dbe2");
    x.fillStyle = g; x.fillRect(0, 0, 2, 256);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = t;
  }

  demander() { this._sale = true; }

  redimensionner() {
    const l = this.conteneur.clientWidth || 1, h = this.conteneur.clientHeight || 1;
    this.renderer.setSize(l, h, false);
    this.renderer.domElement.style.width = l + "px"; this.renderer.domElement.style.height = h + "px";
    this.camera.aspect = l / h; this.camera.updateProjectionMatrix();
    this.demander();
  }

  vider(groupe) {
    for (const o of [...groupe.children]) {
      groupe.remove(o);
      o.traverse((x) => { if (x.geometry) x.geometry.dispose(); if (x.material) x.material.dispose?.(); });
    }
  }

  rendre() {
    this.renderer.render(this.scene, this.camera);
    const l = this.conteneur.clientWidth, h = this.conteneur.clientHeight;
    this.etiquettes.forEach((e) => {
      const v = V3(e.pos).project(this.camera);
      const visible = v.z < 1 && v.z > -1;
      e.el.style.display = visible ? "" : "none";
      e.el.style.transform = `translate(${(v.x + 1) / 2 * l}px, ${(1 - v.y) / 2 * h}px)`;
    });
  }

  _poserEtiquettes(liste) {
    this.etiq.innerHTML = "";
    this.etiquettes = liste.map((e) => {
      const el = document.createElement("div");
      el.className = "etq etq-" + e.type;
      el.innerHTML = `<span>${e.texte}</span>${e.detail ? `<small>${e.detail}</small>` : ""}`;
      this.etiq.appendChild(el);
      return { ...e, el };
    });
  }

  piece(prog) {
    this.mode = "piece";
    this.vider(this.contenu); this.vider(this.dyn);
    const { groupe, etiquettes, points } = construirePiece(prog);
    this.contenu.add(groupe);
    this._poserEtiquettes(etiquettes);
    this._pointsPiece = points;
    this.vuePiece();
  }

  vuePiece() {
    const pts = this._pointsPiece; if (!pts) return;
    const { centre, dir, up } = vueAutomatique(pts);
    let r = 0; for (const p of pts) r = Math.max(r, V3(p).distanceTo(centre));
    const d = (r * 1.15) / Math.sin((this.camera.fov * Math.PI) / 360) / Math.min(1, this.camera.aspect);
    this.camera.position.copy(centre).add(dir.clone().multiplyScalar(d));
    this.controles.target.copy(centre);
    this.camera.near = Math.max(1, d / 100); this.camera.far = d * 20; this.camera.updateProjectionMatrix();
    this.controles.update(); this.demander();
  }

  preparerSimulation(prog, zones = false) {
    this.mode = "simulation";
    this.prog = prog;
    this.vider(this.contenu); this.vider(this.dyn); this._poserEtiquettes([]);
    this.contenu.add(construireMachine(prog, { zones }));
    this._poserEtiquettes([{ pos: [-650, -1150, -prog.machine.hauteur_axe_sol + 2050], texte: "Opérateur (pupitre)", type: "info" }]);
    this.vueMachine();
  }

  vueMachine() {
    const cible = new THREE.Vector3(-250, 300, -300);
    this.camera.position.copy(cible).add(new THREE.Vector3(-2550, -3650, 2550).multiplyScalar(1.2 * Math.pow(Math.max(1, 1.6 / this.camera.aspect), 0.85)));
    this.controles.target.copy(cible);
    this.camera.near = 5; this.camera.far = 60000; this.camera.updateProjectionMatrix();
    this.controles.update(); this.demander();
  }

  recentrer() { if (this.mode === "piece") this.vuePiece(); else if (this.mode === "simulation") this.vueMachine(); }

  image(im, collisions = []) {
    this.vider(this.dyn);
    this.dyn.add(construireEtat(this.prog, im.etat, collisions).groupe);
    this.demander();
  }

  effacer() {
    this.mode = null; this.vider(this.contenu); this.vider(this.dyn); this._poserEtiquettes([]); this.demander();
  }
}

export { affichageB };
