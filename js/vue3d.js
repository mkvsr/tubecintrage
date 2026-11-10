// Vue 3D (three.js) : pièce finie et simulation machine. Sert aussi à produire les images du PDF.
import * as THREE from "three";
import { OrbitControls } from "three/addons/OrbitControls.js";
import { Simulation } from "./core/simulation.js";
import { estCintre } from "./core/geometrie.js";
import { affichageB } from "./core/sequence.js";
import { MG030 } from "./modele_mg030.js";
import { gueulesDuTube, reculGueule, profilGueule, radiale, descriptionGueule } from "./core/gueule.js";

export const COULEURS = {
  droit: 0xbcc3cb, cintre: 0xffc400, cintreFait: 0x3b7dd8, enCours: 0xffc400, collision: 0xff1a1a,
  surlong: 0xff5fae, soudure: 0xff1a1a, machine: 0x9db3cf, chariot: 0x1c1d1f, boutonY: 0xffd000, boutonB: 0xe8141a, sol: 0xcfd5dc,
  zone: 0x7fbf7f, operateur: 0x5b8c5a, matrice: 0x5d6d7e, reglette: 0x7b8a99, gueule: 0xff7a00,
};
const PARTIE = [COULEURS.cintreFait, COULEURS.enCours, COULEURS.droit, COULEURS.collision, COULEURS.surlong];

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
    idx.push(a, a + 1, b, b, a + 1, b + 1); // sens direct vu de l'extérieur (sinon la face visible est masquée)
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
  scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa5b1, 2.3));
  const d = new THREE.DirectionalLight(0xffffff, 2.0); d.position.set(-2, -3, 5); scene.add(d);
  const d2 = new THREE.DirectionalLight(0xffffff, 1.0); d2.position.set(3, 2, 1); scene.add(d2);
}

const ligneSoudure = (pts, vecs, r) => {
  const q = pts.map((p, k) => [p[0] + vecs[k][0] * (r + 0.4), p[1] + vecs[k][1] * (r + 0.4), p[2] + vecs[k][2] * (r + 0.4)]);
  const c = q.map(() => COULEURS.soudure);
  return new THREE.Mesh(geometrieTube(q, Math.max(1.6, r * 0.14), c, 6), new THREE.MeshBasicMaterial({ color: COULEURS.soudure }));
};

// ----------------------------------------------------------------------
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Bout de tube à meuler en gueule de loup (orange), de la section droite à Lz du bout jusqu'au bord de coupe. */
function emboutGueule(g, ref, Lz, nTheta = 72, nLong = 10) {
  const pos = [], nor = [], idx = [];
  for (let k = 0; k <= nTheta; k++) {
    const th = -Math.PI + (2 * Math.PI * k) / nTheta, u = radiale(g, ref, th), t1 = reculGueule(g, ref, th);
    for (let j = 0; j <= nLong; j++) {
      const t = -Lz + ((t1 + Lz) * j) / nLong, p = add3(add3(g.E, mul3(u, g.r)), mul3(g.d, t));
      pos.push(...p); nor.push(...u);
    }
  }
  const L = nLong + 1;
  for (let k = 0; k < nTheta; k++) for (let j = 0; j < nLong; j++) {
    const a = k * L + j, b = a + L;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  geo.setIndex(idx);
  return new THREE.Mesh(geo, matCouleur(COULEURS.gueule, { side: THREE.DoubleSide, roughness: 0.5 }));
}

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
  // gueules de loup : le bout est raccourci et la zone à meuler est dessinée en orange avec la forme de la coupe
  let P = pts, C = coul, SV = sim.cadSoudure;
  const gq = gueulesDuTube(tube), embouts = [];
  for (const [g, auBout] of [[gq.avant, false], [gq.arriere, true]]) {
    if (!g) continue;
    const gg = { ...g, r }, ref = auBout ? SV[SV.length - 1] : SV[0];
    const Lz = 25 - Math.min(...profilGueule(gg, ref, 90).map((x) => x.recul));   // zone orange : 25 mm avant le creux
    const dedans = (p) => dot3(sub3(p, g.E), g.d) > -Lz;   // point dans la zone du bout
    let i0 = 0, i1 = P.length;                              // on retire les points de la zone, depuis le bout concerné
    if (auBout) while (i1 > 1 && dedans(P[i1 - 1])) i1--; else while (i0 < P.length - 1 && dedans(P[i0])) i0++;
    P = P.slice(i0, i1); C = C.slice(i0, i1); SV = SV.slice(i0, i1);
    const Q = [g.E[0] - g.d[0] * Lz, g.E[1] - g.d[1] * Lz, g.E[2] - g.d[2] * Lz];
    if (auBout) { P.push(Q); C.push(C[C.length - 1]); SV.push(SV[SV.length - 1]); } else { P.unshift(Q); C.unshift(C[0]); SV.unshift(SV[0]); }
    embouts.push({ g: gg, ref, Lz, Q });
  }
  groupe.add(new THREE.Mesh(geometrieTube(P, r, C), matTube()));
  if (soudure) groupe.add(ligneSoudure(P, SV, r));
  for (const { g, ref, Lz, Q } of embouts) {
    groupe.add(emboutGueule(g, ref, Lz));
    const bout = add3(g.E, mul3(g.d, reculGueule(g, ref, 0)));   // génératrice de la soudure jusqu'au bord de coupe
    if (soudure) groupe.add(ligneSoudure([Q, bout], [ref, ref], r));
  }
  const tous = [...pts];
  if (prog.surlongArriere > 0) {
    const d = tube.droites[tube.droites.length - 1].direction, a = tube.fin;
    const b = [a[0] + d[0] * prog.surlongArriere, a[1] + d[1] * prog.surlongArriere, a[2] + d[2] * prog.surlongArriere];
    groupe.add(new THREE.Mesh(geometrieTube([a, b], r * 1.001, [COULEURS.surlong, COULEURS.surlong]),
      matTube()));
    tous.push(b);
  }
  const etiquettes = [];
  tube.cintres.forEach((c, i) => {
    const m = c.pointA(c.angle / 2), v = [m[0] - c.centre[0], m[1] - c.centre[1], m[2] - c.centre[2]];
    const l = Math.hypot(...v), k = Math.max(r * 2.6, 45) / l;
    etiquettes.push({ pos: [m[0] + v[0] * k, m[1] + v[1] * k, m[2] + v[2] * k], ancre: m, texte: String(i + 1), type: "pli",
      detail: `${(c.angle * 180 / Math.PI).toFixed(1).replace(".", ",")}°` });
  });
  // gueule de loup indiquée dans l'étiquette du bout (évite deux étiquettes superposées)
  const gl = (g) => (g ? `<br>${descriptionGueule(g)}` : "");
  etiquettes.push({ pos: pts[0], texte: "AVANT", type: "extremite", detail: "entre en premier" + gl(gq.avant) });
  etiquettes.push({ pos: tous[tous.length - 1], texte: "ARRIÈRE", type: "extremite", detail: "pince du chariot" + gl(gq.arriere) });
  return { groupe, etiquettes, points: tous };
}

// ----------------------------------------------------------------------
// Modèle 3D de la MG030 (js/modele_mg030.js) : bâti fixe, chariot, outil et contre-pli animés.
const _tableaux = {};
function geometrieModele(nom) {
  const c = MG030.corps[nom];
  if (!_tableaux[nom]) _tableaux[nom] = { p: new Float32Array(c.p), n: new Float32Array(c.n), i: new Uint32Array(c.i) };
  const t = _tableaux[nom], g = new THREE.BufferGeometry();   // géométrie neuve à chaque fois (vider() la libère)
  g.setAttribute("position", new THREE.BufferAttribute(t.p, 3));
  if (t.n.length) g.setAttribute("normal", new THREE.BufferAttribute(t.n, 3)); else g.computeVertexNormals();
  g.setIndex(new THREE.BufferAttribute(t.i, 1));
  return g;
}
const corpsModele = (nom, materiau) => new THREE.Mesh(geometrieModele(nom), materiau);
const rayonOutil = (prog) => (prog.etapes.length ? prog.etapes[0].rayon : (prog.outil ? prog.outil.rayon : 150));
/** L'outil et le contre-pli du modèle ne valent que pour l'outil réel (Ø48,3 R145) ; sinon formes simplifiées. */
const outilDuModele = (prog) => Math.abs(rayonOutil(prog) - MG030.rayonOutil) < 1 && Math.abs(prog.tube.diametre - 48.3) < 1;

// Afficheur 7 segments (même dessin que l'afficheur de la page, js/app.js « sept »), sur un canevas
const SEG7 = { "0": "abcdef", "1": "bc", "2": "abged", "3": "abgcd", "4": "fgbc", "5": "afgcd", "6": "afgedc", "7": "abc", "8": "abcdefg", "9": "abcdfg", "-": "g", " ": "" };
function septSegments(x, texte, nb, ox, oy, s) {
  const h = 40, w = 21, pas = 29, inc = 4;
  const [ent, dec = ""] = texte.replace(",", ".").split(".");
  const chiffres = (ent + dec).padStart(nb, " ").slice(-nb), point = nb - dec.length - 1;
  const P = (x0, u, v) => [ox + (x0 + u * w + (1 - v) * inc) * s, oy + (2 + v * h) * s];
  const seg = { a: [[0.14, 0], [0.86, 0]], b: [[1, 0.08], [1, 0.44]], c: [[1, 0.56], [1, 0.92]], d: [[0.14, 1], [0.86, 1]],
    e: [[0, 0.56], [0, 0.92]], f: [[0, 0.08], [0, 0.44]], g: [[0.14, 0.5], [0.86, 0.5]] };
  x.lineWidth = 4.6 * s; x.lineCap = "round";
  for (let k = 0; k < nb; k++) {
    const x0 = 4 + k * pas + (dec && k > point ? 12 : 0), on = SEG7[chiffres[k]] ?? "";   // espace après la virgule
    for (const [n, [[u0, v0], [u1, v1]]] of Object.entries(seg)) {
      const [x1, y1] = P(x0, u0, v0), [x2, y2] = P(x0, u1, v1);
      x.strokeStyle = on.includes(n) ? "#ff2a1a" : "#2a0805";
      x.beginPath(); x.moveTo(x1, y1); x.lineTo(x2, y2); x.stroke();
    }
    if (dec && k === point) { const [cx, cy] = P(x0 + (pas - w + 12) / 2, 1, 1); x.fillStyle = "#ff2a1a"; x.beginPath(); x.arc(cx, cy, 3.6 * s, 0, 7); x.fill(); }
  }
}
const f1 = (v) => (Math.abs(v) < 0.05 ? 0 : Number(v)).toFixed(1).replace(".", ",");

/** Écran du chariot : Y (avance) et B (rotation affichée), comme la commande. */
function ecranChariot(Y, B) {
  const e = MG030.ecran, W = 512, H = Math.round((W * (e.z1 - e.z0)) / (e.y1 - e.y0));
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const x = c.getContext("2d");
  x.fillStyle = "#050607"; x.fillRect(0, 0, W, H);
  const s = 2.1, ligne = (H - 30) / 2;
  [["Y", "#f2c14e", f1(Y), 6], ["B", "#d62728", f1(B), 4]].forEach(([nom, coul, texte, nb], k) => {
    const y0 = 12 + k * (ligne + 6), hc = 45 * s;
    x.fillStyle = coul; x.fillRect(14, y0 + (ligne - hc) / 2, 62, hc);
    x.fillStyle = "#000"; x.font = `bold ${Math.round(hc * 0.62)}px sans-serif`; x.textAlign = "center"; x.textBaseline = "middle";
    x.fillText(nom, 45, y0 + ligne / 2);
    septSegments(x, texte, nb, 92, y0 + (ligne - hc) / 2 + 2, s);
  });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  // quadrilatère tourné vers +X (vers l'outil), largeur selon +Y, hauteur selon +Z
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([e.x, e.y0, e.z0, e.x, e.y1, e.z0, e.x, e.y1, e.z1, e.x, e.y0, e.z1], 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: t }));
}

/** Chariot : corps noir, bouton Y jaune, bouton B rouge, écran Y / B (si `ecran` = {Y, B}). */
function chariotModele(ecran) {
  const g = geometrieModele("chariot");
  const coul = [];   // [premier triangle, dernier, matériau]
  for (const [a, b] of MG030.boutons.Y) coul.push([a, b, 1]);
  for (const [a, b] of MG030.boutons.B) coul.push([a, b, 2]);
  coul.sort((u, v) => u[0] - v[0]);
  let t = 0;
  const nTri = g.index.count / 3;
  for (const [a, b, m] of coul) { if (a > t) g.addGroup(3 * t, 3 * (a - t), 0); g.addGroup(3 * a, 3 * (b - a + 1), m); t = b + 1; }
  if (t < nTri) g.addGroup(3 * t, 3 * (nTri - t), 0);
  const chariot = new THREE.Mesh(g, [matCouleur(COULEURS.chariot, { metalness: 0.3, roughness: 0.5 }),
    matCouleur(COULEURS.boutonY, { roughness: 0.4 }), matCouleur(COULEURS.boutonB, { roughness: 0.4 })]);
  if (ecran) chariot.add(ecranChariot(ecran.Y, ecran.B));
  return chariot;
}

/** Outil et contre-pli dans leur position pour un angle de pli (°) en cours ; groupe vide si outil non modélisé. */
function piecesMobiles(prog, angle = 0) {
  const groupe = new THREE.Group();
  if (!outilDuModele(prog)) return groupe;
  const R = MG030.rayonOutil, phi = (angle * Math.PI) / 180;
  // l'outil tourne autour de son axe vertical (0, R) dans le sens où le tube s'enroule (antihoraire vu de dessus)
  const pivot = new THREE.Group(); pivot.position.set(0, R, 0); pivot.rotation.z = phi;
  const outil = corpsModele("outil", matCouleur(COULEURS.matrice, { metalness: 0.4, roughness: 0.4 }));
  outil.position.set(0, -R, 0); pivot.add(outil); groupe.add(pivot);
  // le contre-pli (mors de 150 mm qui serre le tube sur l'outil) suit le tube : il tourne avec l'outil
  const cp = corpsModele("contrePli", matCouleur(COULEURS.reglette));
  cp.position.set(0, -R, 0); pivot.add(cp);
  return groupe;
}

/** Décor machine (sol, bâti, forme, opérateur). */
export function construireMachine(prog, { zones = false, operateur = true } = {}) {
  const groupe = new THREE.Group();
  const m = prog.machine, H = m.hauteur_axe_sol, D = prog.tube.diametre;
  const R = rayonOutil(prog);
  const sol = new THREE.Mesh(new THREE.PlaneGeometry(12000, 12000), matCouleur(COULEURS.sol, { roughness: 1 }));
  sol.position.set(-2500, 0, -H); groupe.add(sol);
  const grille = new THREE.GridHelper(12000, 24, 0xb9c1ca, 0xb9c1ca);
  grille.rotation.x = Math.PI / 2; grille.position.set(-2500, 0, -H + 0.5); groupe.add(grille);
  groupe.add(corpsModele("bati", matCouleur(COULEURS.machine)));
  for (const o of m.obstacles) {
    if (!o.actif) continue;
    const zmin = Math.max(o.zmin, -H);
    if (o.gravite === "erreur") {
      // obstacles relevés (base du calcul des collisions) : arêtes seules, le bâti modélisé fait le volume
      const b = boite(o.xmin, o.xmax, o.ymin, o.ymax, zmin, o.zmax, matCouleur(COULEURS.machine));
      const ar = new THREE.LineSegments(new THREE.EdgesGeometry(b.geometry), new THREE.LineBasicMaterial({ color: 0x6d84a3 }));
      ar.position.copy(b.position); groupe.add(ar);
      b.geometry.dispose();
    } else if (zones) {
      const b = boite(o.xmin, o.xmax, o.ymin, o.ymax, zmin, o.zmax,
        matCouleur(COULEURS.zone, { transparent: true, opacity: 0.06, depthWrite: false }));
      groupe.add(b);
      const ar = new THREE.LineSegments(new THREE.EdgesGeometry(b.geometry), new THREE.LineBasicMaterial({ color: COULEURS.zone }));
      ar.position.copy(b.position); groupe.add(ar);
    }
  }
  if (!outilDuModele(prog)) {   // autre outil que celui du modèle : forme et réglette simplifiées, fixes
    const forme = new THREE.Mesh(new THREE.CylinderGeometry(R - D / 2, R - D / 2, D * 1.6, 72), matCouleur(COULEURS.matrice, { metalness: 0.4, roughness: 0.4 }));
    forme.rotation.x = Math.PI / 2; forme.position.set(0, R, 0); groupe.add(forme);
    groupe.add(boite(-450, 0, -D * 1.2, -D / 2, -D * 0.8, D * 0.8, matCouleur(COULEURS.reglette)));
  }
  // fin de course du chariot : face avant du chariot quand il reste la droite mini derrière le dernier pli
  // (au-delà, il taperait dans l'outil ; pas de butée sur la machine). Plan rouge 200 × 200 mm centré sur l'axe.
  {
    const xFin = -m.droite_arriere_mini + 15;   // + 15 : face avant du chariot en avant de la pince (voir construireEtat)
    const plan = new THREE.Mesh(new THREE.PlaneGeometry(200, 200),
      new THREE.MeshBasicMaterial({ color: COULEURS.collision, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }));
    plan.rotation.y = Math.PI / 2; plan.position.set(xFin, 0, 0); plan.renderOrder = 2; groupe.add(plan);
    const bord = new THREE.LineSegments(new THREE.EdgesGeometry(plan.geometry), new THREE.LineBasicMaterial({ color: COULEURS.collision }));
    bord.rotation.copy(plan.rotation); bord.position.copy(plan.position); groupe.add(bord);
  }
  if (operateur) {
    const mo = matCouleur(COULEURS.operateur, { transparent: true, opacity: 0.25, depthWrite: false });
    const corps = new THREE.Mesh(new THREE.CylinderGeometry(180, 180, 1700, 24), mo);
    corps.rotation.x = Math.PI / 2; corps.position.set(-650, -1150, -H + 850); groupe.add(corps);
    corps.name = "operateur";
    const tete = new THREE.Mesh(new THREE.SphereGeometry(130, 24, 16), mo);
    tete.position.set(-650, -1150, -H + 1830); groupe.add(tete);
    tete.name = "operateur";
  }
  return groupe;
}

/** Tube, chariot, outil et contre-pli pour une image de la simulation.
 *  `coupe` : raccourcit la partie droite côté chariot (vignettes). `angle` : angle de pli en cours (°), 0 hors cintrage. */
export function construireEtat(prog, etat, collisions = [], { coupe = null, angle = 0, ecran = null } = {}) {
  const groupe = new THREE.Group();
  const D = prog.tube.diametre;
  const partie = etat.partie.slice();
  // surlongueurs à recouper (rose) : repérées par la longueur cumulée depuis l'avant et depuis l'arrière du tube
  const sa = prog.surlongAvant || 0, sr = prog.surlongArriere || 0;
  if (sa > 0 || sr > 0) {
    const P = etat.pts, cum = [0];
    for (let k = 1; k < P.length; k++) cum.push(cum[k - 1] + Math.hypot(P[k][0] - P[k - 1][0], P[k][1] - P[k - 1][1], P[k][2] - P[k - 1][2]));
    const tot = cum[cum.length - 1];
    cum.forEach((c, k) => { if (c < sa - 1e-6 || tot - c < sr - 1e-6) partie[k] = 4; });
  }
  for (const c of collisions) for (const k of c.indices) partie[k] = 3;   // une collision reste prioritaire
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
    // chariot du modèle, dessiné reculé (face avant en xAvantChariot) : on amène sa face avant sur la pince
    const chariot = chariotModele(ecran);
    chariot.position.x = etat.xArriere + 15 - MG030.xAvantChariot;
    groupe.add(chariot);
  }
  groupe.add(piecesMobiles(prog, angle));
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
export function imageEtat(prog, etat, l = 900, h = 640, angle = 0) {
  const scene = new THREE.Scene(); eclairer(scene);
  scene.add(construireMachine(prog, { operateur: false }));
  const R = prog.etapes.length ? prog.etapes[0].rayon : 145;
  const { groupe, points, coupeX } = construireEtat(prog, etat, [], { coupe: -900, angle });
  scene.add(groupe);
  const cadre = [...points, [0, 2 * R, 0], [R, R, 0], [-R, R, 0]];
  const cam = cameraCadree(cadre, DIR_MACHINE, new THREE.Vector3(0, 0, 1), l / h, 0.12);
  const etiq = [];
  if (coupeX != null) etiq.push({ pos: [coupeX, 0, 0], texte: "→ chariot", type: "extremite" });
  return versImage(rendu(l, h), scene, cam, l, h, 0xffffff, etiq, l / 900 * 1.2);
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
    g.addColorStop(0, "#ffffff"); g.addColorStop(1, "#ffffff");
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
      o.traverse((x) => {
        if (x.geometry) x.geometry.dispose();
        for (const m of [x.material].flat()) if (m) { m.map?.dispose(); m.dispose?.(); }   // textures (écran du chariot) comprises
      });
    }
  }

  rendre() {
    // mannequin opérateur : masqué seulement quand la caméra est dans sa tête (vue Recentrer), visible sinon
    if (this._operateur) {
      const loin = this.camera.position.distanceTo(this._tete) > 600;
      for (const o of this._operateur) o.visible = loin;
    }
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
    this.mode = "piece"; this._operateur = null;
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
    this._operateur = []; this.contenu.traverse((o) => { if (o.name === "operateur") this._operateur.push(o); });
    this._tete = new THREE.Vector3(-650, -1150, -prog.machine.hauteur_axe_sol + 1830);
    this._poserEtiquettes([{ pos: [-650, -1150, -prog.machine.hauteur_axe_sol + 2050], texte: "Opérateur (pupitre)", type: "info" }]);
    this.vueMachine();
  }

  _placer(oeil, cible) {
    this.camera.position.copy(oeil);
    this.controles.target.copy(cible);
    this.camera.near = 5; this.camera.far = 60000; this.camera.updateProjectionMatrix();
    this.controles.update(); this.demander();
  }

  /** Vue « Recentrer » : depuis la tête de l'opérateur au pupitre (mannequin de construireMachine), regard vers l'outil. */
  vueMachine() {
    const H = this.prog ? this.prog.machine.hauteur_axe_sol : 1015;
    this._placer(new THREE.Vector3(-650, -1150, -H + 1830), new THREE.Vector3(0, 0, 0));
  }

  /** Vue « Zoom » : 1000 mm au-dessus de l'outil, regard vers le bas, côté opérateur en bas de l'écran.
   *  Centrée entre l'axe de la forme (y = R) et l'axe du tube (y = 0) : on voit la forme et le tube qui s'y enroule. */
  vueZoom() {
    const p = this.prog;
    const R = p && p.etapes.length ? p.etapes[0].rayon : (p && p.outil ? p.outil.rayon : 150);
    // œil décalé de 1 mm vers l'opérateur : évite la vue exactement verticale (indéterminée avec camera.up = Z)
    this._placer(new THREE.Vector3(0, R / 2 - 1, 1000), new THREE.Vector3(0, R / 2, 0));
  }

  recentrer() { if (this.mode === "piece") this.vuePiece(); else if (this.mode === "simulation") this.vueMachine(); }

  image(im, collisions = []) {
    this.vider(this.dyn);
    this.dyn.add(construireEtat(this.prog, im.etat, collisions, { angle: im.phase === "cintrage" ? im.angleEnCours || 0 : 0, ecran: { Y: im.Y, B: affichageB(im.B) } }).groupe);
    this.demander();
  }

  effacer() {
    this.mode = null; this.vider(this.contenu); this.vider(this.dyn); this._poserEtiquettes([]); this.demander();
  }
}

export { affichageB };
