// Import STEP dans le navigateur.
// occt-import-js (OpenCascade compilé en WebAssembly) lit le fichier et fournit, pour chaque face B-rep,
// son maillage (points + normales). On reconnaît ici les faces cylindriques (droites) et toriques
// (cintres) par ajustement, puis on reconstruit la fibre neutre comme la version Python.
import { add, sub, mul, dot, cross, norm, unit, angleEntre, neg } from "./vec.js";
import { chainer } from "./importation.js";
import { tubeDepuisSegments } from "./geometrie.js";
import { chercherGueule, mesurerCoupe, descriptionGueule } from "./gueule.js";

export class ErreurStep extends Error {}

// ----------------------------------------------------------------------
// Chargement d'occt-import-js (navigateur : script dans vendor/, Node : option `occt`)
let _occt = null;
export async function obtenirOcct(options = {}) {
  if (options.occt) return options.occt;
  if (_occt) return _occt;
  const emb = globalThis.TC_EMBARQUE;
  if (emb && emb.occtWasm && globalThis.occtimportjs) {     // version « fichier unique » : tout est dans la page
    const bin = Uint8Array.from(atob(emb.occtWasm), (c) => c.charCodeAt(0));
    _occt = await globalThis.occtimportjs({ wasmBinary: bin });
    return _occt;
  }
  const base = options.cheminVendor || new URL("../../vendor/", import.meta.url).href;
  if (!globalThis.occtimportjs) {
    await new Promise((ok, ko) => {
      const s = document.createElement("script");
      s.src = base + "occt-import-js.js";
      s.onload = ok; s.onerror = () => ko(new ErreurStep("Module STEP introuvable (vendor/occt-import-js.js)"));
      document.head.appendChild(s);
    });
  }
  _occt = await globalThis.occtimportjs({ locateFile: (f) => base + f });
  return _occt;
}

// ----------------------------------------------------------------------
// Algèbre : valeurs/vecteurs propres d'une matrice symétrique 3x3 (Jacobi)
function eigSym(A) {
  const a = A.map((r) => r.slice());
  const V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let it = 0; it < 50; it++) {
    let p = 0, q = 1, max = Math.abs(a[0][1]);
    if (Math.abs(a[0][2]) > max) { p = 0; q = 2; max = Math.abs(a[0][2]); }
    if (Math.abs(a[1][2]) > max) { p = 1; q = 2; max = Math.abs(a[1][2]); }
    if (max < 1e-15) break;
    const th = (a[q][q] - a[p][p]) / (2 * a[p][q]);
    const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
    const c = 1 / Math.sqrt(t * t + 1), s = t * c;
    for (let k = 0; k < 3; k++) {
      const akp = a[k][p], akq = a[k][q];
      a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq;
    }
    for (let k = 0; k < 3; k++) {
      const apk = a[p][k], aqk = a[q][k];
      a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk;
    }
    for (let k = 0; k < 3; k++) {
      const vkp = V[k][p], vkq = V[k][q];
      V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq;
    }
  }
  const vals = [a[0][0], a[1][1], a[2][2]];
  const ordre = [0, 1, 2].sort((i, j) => vals[i] - vals[j]);
  return { valeurs: ordre.map((i) => vals[i]), vecteurs: ordre.map((i) => unit([V[0][i], V[1][i], V[2][i]])) };
}

function resoudre3(M, b) {
  // élimination de Gauss avec pivot
  const A = M.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    if (Math.abs(A[c][c]) < 1e-14) return null;
    for (let r = 0; r < 3; r++) if (r !== c) {
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 4; k++) A[r][k] -= f * A[c][k];
    }
  }
  return [A[0][3] / A[0][0], A[1][3] / A[1][1], A[2][3] / A[2][2]];
}

const moyenne = (P) => mul(P.reduce((s, p) => add(s, p), [0, 0, 0]), 1 / P.length);

function covariance(P, c) {
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of P) { const d = sub(p, c); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i][j] += d[i] * d[j]; }
  return C.map((r) => r.map((x) => x / P.length));
}

/** Cercle 2D (Kasa) : renvoie {cu, cv, R, rms}. */
function cercle2D(U, V) {
  let suu = 0, suv = 0, svv = 0, su = 0, sv = 0, n = U.length, sz = 0, szu = 0, szv = 0;
  for (let k = 0; k < n; k++) {
    const u = U[k], v = V[k], z = u * u + v * v;
    suu += u * u; suv += u * v; svv += v * v; su += u; sv += v; sz += z; szu += z * u; szv += z * v;
  }
  const s = resoudre3([[suu, suv, su], [suv, svv, sv], [su, sv, n]], [-szu, -szv, -sz]);
  if (!s) return null;
  const cu = -s[0] / 2, cv = -s[1] / 2, R = Math.sqrt(Math.max(0, cu * cu + cv * cv - s[2]));
  let e = 0;
  for (let k = 0; k < n; k++) e += (Math.hypot(U[k] - cu, V[k] - cv) - R) ** 2;
  return { cu, cv, R, rms: Math.sqrt(e / n) };
}

// ----------------------------------------------------------------------
// Moindres carrés non linéaires (Levenberg-Marquardt, jacobien numérique)
function resoudreN(M, b) {
  const n = b.length, A = M.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    if (Math.abs(A[c][c]) < 1e-18) return null;
    for (let r = 0; r < n; r++) if (r !== c) {
      const f = A[r][c] / A[c][c];
      for (let k = c; k <= n; k++) A[r][k] -= f * A[c][k];
    }
  }
  return A.map((r, i) => r[n] / r[i]);
}

function lm(residus, x0, iterations = 30) {
  let x = x0.slice(), r = residus(x), cout = r.reduce((s, v) => s + v * v, 0), lambda = 1e-3;
  const n = x.length;
  for (let it = 0; it < iterations; it++) {
    const J = [];
    for (let j = 0; j < n; j++) {
      const h = 1e-6 * Math.max(1, Math.abs(x[j])), xh = x.slice(); xh[j] += h;
      const rh = residus(xh); J.push(rh.map((v, k) => (v - r[k]) / h));
    }
    const JtJ = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => J[i].reduce((s, v, k) => s + v * J[j][k], 0)));
    const Jtr = J.map((Ji) => Ji.reduce((s, v, k) => s + v * r[k], 0));
    let progres = false;
    for (let essai = 0; essai < 8; essai++) {
      const M = JtJ.map((row, i) => row.map((v, j) => (i === j ? v * (1 + lambda) + 1e-12 : v)));
      const dx = resoudreN(M, Jtr.map((v) => -v));
      if (!dx) break;
      const xn = x.map((v, i) => v + dx[i]), rn = residus(xn), cn = rn.reduce((s, v) => s + v * v, 0);
      if (cn < cout) { x = xn; r = rn; lambda = Math.max(lambda / 10, 1e-9); progres = cout - cn > 1e-14 * cout; cout = cn; break; }
      lambda *= 10;
    }
    if (!progres) break;
  }
  return { x, rms: Math.sqrt(cout / r.length) };
}

// axe = a0 perturbé dans le plan ⟂ (u, v)
const baseAxe = (a0) => { const u = Math.abs(a0[0]) < 0.9 ? unit(cross(a0, [1, 0, 0])) : unit(cross(a0, [0, 1, 0])); return [u, cross(a0, u)]; };
const axeDe = (a0, u, v, du, dv) => unit(add(a0, add(mul(u, du), mul(v, dv))));

// ----------------------------------------------------------------------
// Ajustement d'une face. Les normales du maillage sont approchées (lissées) : elles ne servent
// qu'à classer la face et à fournir une estimation de départ ; l'ajustement final se fait sur les points.
function ajusterCylindre(P, N) {
  const S = covariance(N, [0, 0, 0]);
  const { valeurs, vecteurs } = eigSym(S);
  if (valeurs[0] > 1e-4) return null;          // les normales ne sont pas toutes ⟂ à un axe
  const d0 = vecteurs[0];
  const [u, v] = baseAxe(d0);
  const c0 = moyenne(P);
  const U = P.map((p) => dot(sub(p, c0), u)), V = P.map((p) => dot(sub(p, c0), v));
  const cf = cercle2D(U, V);
  if (!cf || cf.R < 0.5 || cf.rms > 2) return null;
  const base = add(c0, add(mul(u, cf.cu), mul(v, cf.cv)));
  const res = (x) => {
    const c = add(base, add(mul(u, x[0]), mul(v, x[1]))), d = axeDe(d0, u, v, x[2], x[3]);
    return P.map((p) => { const w = sub(p, c); return norm(sub(w, mul(d, dot(w, d)))) - x[4]; });
  };
  const { x, rms } = lm(res, [0, 0, 0, 0, cf.R]);
  if (rms > 0.02) return null;
  const c = add(base, add(mul(u, x[0]), mul(v, x[1]))), d = axeDe(d0, u, v, x[2], x[3]);
  let tmin = Infinity, tmax = -Infinity;
  for (const p of P) { const t = dot(sub(p, c), d); tmin = Math.min(tmin, t); tmax = Math.max(tmax, t); }
  return { type: "cyl", rayon: Math.abs(x[4]), p0: add(c, mul(d, tmin)), p1: add(c, mul(d, tmax)) };
}

export function cercle3D(Q) {
  const c0 = moyenne(Q);
  const { valeurs, vecteurs } = eigSym(covariance(Q, c0));
  const a = vecteurs[0], e1 = vecteurs[2], e2 = cross(a, e1);
  const U = Q.map((q) => dot(sub(q, c0), e1)), V = Q.map((q) => dot(sub(q, c0), e2));
  const cf = cercle2D(U, V);
  if (!cf) return null;
  const plan = Math.sqrt(Math.max(0, valeurs[0]));
  return { centre: add(c0, add(mul(e1, cf.cu), mul(e2, cf.cv))), axe: a, e1, e2, R: cf.R, rms: Math.hypot(cf.rms, plan) };
}

export function ajusterTore(P, N, rayonsConnus) {
  // estimation : les points p - s·n décrivent le cercle directeur (s = rayon du tube)
  const essai = (s) => cercle3D(P.map((p, k) => sub(p, mul(N[k], s))));
  let best = Infinity, bestS = 0;
  const cands = [];
  for (const r of rayonsConnus) cands.push(r, -r);
  for (let s = -80; s <= 80; s += 2) if (s) cands.push(s);
  for (const s of cands) { const c = essai(s); if (c && c.rms < best) { best = c.rms; bestS = s; } }
  const e = essai(bestS);
  if (!e || e.rms > 5 || e.R < Math.abs(bestS)) return null;
  // affinage sur les positions : distance au cercle directeur = rayon du tube
  const a0 = e.axe, [u, v] = baseAxe(a0);
  const geo = (x) => ({ c: add(e.centre, [x[0], x[1], x[2]]), a: axeDe(a0, u, v, x[3], x[4]), R: x[5], r: x[6] });
  const res = (x) => {
    const { c, a, R, r } = geo(x);
    return P.map((p) => { const w = sub(p, c), h = dot(w, a), rho = norm(sub(w, mul(a, h))); return Math.hypot(rho - R, h) - r; });
  };
  const { x, rms } = lm(res, [0, 0, 0, 0, 0, e.R, Math.abs(bestS)], 40);
  const { c, a, R, r } = geo(x);
  if (rms > 0.02 || r < 0.5 || R < r) return null;
  const e1 = unit(sub(P[0], add(c, mul(a, dot(sub(P[0], c), a))))), e2 = cross(a, e1);
  const ang = P.map((p) => { const w = sub(p, c); return Math.atan2(dot(w, e2), dot(w, e1)); }).sort((x, y) => x - y);
  let gap = ang[0] + 2 * Math.PI - ang[ang.length - 1], debut = ang[0];
  for (let k = 1; k < ang.length; k++) if (ang[k] - ang[k - 1] > gap) { gap = ang[k] - ang[k - 1]; debut = ang[k]; }
  const balayage = 2 * Math.PI - gap;
  const pt = (t) => add(c, add(mul(e1, R * Math.cos(t)), mul(e2, R * Math.sin(t))));
  return { type: "tor", rayon: r, centre: c, axe: a, R, p0: pt(debut), p1: pt(debut + balayage), angle: balayage };
}

function estPlan(N) {
  const n0 = N[0];
  return N.every((n) => dot(n, n0) > 0.99999);
}

// ----------------------------------------------------------------------
// Fusion des faces coaxiales (copie de la logique Python)
function fusionDroites(cyls, tol = 0.2) {
  const groupes = [];
  for (const f of cyls) {
    const a = f.p0, b = f.p1;
    if (norm(sub(b, a)) < 1e-6) continue;
    const d = unit(sub(b, a));
    let place = false;
    for (const g of groupes) {
      if (angleEntre(d, g.d) < 1e-3 || angleEntre(d, neg(g.d)) < 1e-3) {
        const w = sub(a, g.p);
        if (norm(sub(w, mul(g.d, dot(w, g.d)))) < tol) {
          const ta = dot(sub(a, g.p), g.d), tb = dot(sub(b, g.p), g.d);
          g.iv.push([Math.min(ta, tb), Math.max(ta, tb)]); place = true; break;
        }
      }
    }
    if (!place) groupes.push({ p: a, d, iv: [[0, norm(sub(b, a))]] });
  }
  const segs = [];
  for (const g of groupes) {
    g.iv.sort((x, y) => x[0] - y[0]);
    let cur = g.iv[0].slice();
    const pousser = () => segs.push({ type: "ligne", p0: add(g.p, mul(g.d, cur[0])), p1: add(g.p, mul(g.d, cur[1])) });
    for (const [t0, t1] of g.iv.slice(1)) {
      if (t0 <= cur[1] + tol) cur[1] = Math.max(cur[1], t1); else { pousser(); cur = [t0, t1]; }
    }
    pousser();
  }
  return segs;
}

function fusionArcs(tors, tol = 0.2) {
  const groupes = [];
  for (const f of tors) {
    let place = false;
    for (const g of groupes) {
      if (norm(sub(f.centre, g.C)) < tol && Math.abs(f.R - g.R) < tol &&
          (angleEntre(f.axe, g.axe) < 1e-2 || angleEntre(f.axe, neg(g.axe)) < 1e-2)) {
        const s = dot(f.axe, g.axe) > 0 ? 1 : -1;
        const Y = cross(g.axe, g.X);
        const angle = (p) => { const v = sub(p, g.C); return Math.atan2(dot(v, Y), dot(v, g.X)); };
        const a0 = angle(s > 0 ? f.p0 : f.p1);
        g.iv.push([a0, a0 + f.angle]); place = true; break;
      }
    }
    if (!place) groupes.push({ C: f.centre, axe: f.axe, R: f.R, X: unit(sub(f.p0, f.centre)), iv: [[0, f.angle]] });
  }
  const segs = [];
  for (const g of groupes) {
    const Y = cross(g.axe, g.X);
    const base = g.iv.map(([u0, u1]) => {
      while (u0 < -1e-6) { u0 += 2 * Math.PI; u1 += 2 * Math.PI; }
      while (u0 >= 2 * Math.PI - 1e-6) { u0 -= 2 * Math.PI; u1 -= 2 * Math.PI; }
      return [u0, u1];
    }).sort((x, y) => x[0] - y[0]);
    let cur = base[0].slice();
    const res = [];
    for (const [u0, u1] of base.slice(1)) {
      if (u0 <= cur[1] + 1e-2) cur[1] = Math.max(cur[1], u1); else { res.push(cur); cur = [u0, u1]; }
    }
    res.push(cur);
    if (res.length > 1 && res[res.length - 1][1] >= 2 * Math.PI - 1e-2 && res[0][0] <= 1e-2) {
      res[0] = [res[res.length - 1][0] - 2 * Math.PI, res[0][1]]; res.pop();
    }
    const pt = (u) => add(g.C, add(mul(g.X, g.R * Math.cos(u)), mul(Y, g.R * Math.sin(u))));
    for (const [u0, u1] of res)
      segs.push({ type: "arc", p0: pt(u0), p1: pt(u1), centre: g.C, normale: g.axe, rayon: g.R });
  }
  return segs;
}

// ----------------------------------------------------------------------
function facesDuMaillage(mesh) {
  const pos = mesh.attributes.position.array, nor = mesh.attributes.normal ? mesh.attributes.normal.array : null;
  const idx = mesh.index.array;
  const faces = [];
  for (const bf of mesh.brep_faces) {
    const vus = new Set();
    for (let t = bf.first; t <= bf.last; t++) for (let j = 0; j < 3; j++) vus.add(idx[3 * t + j]);
    let ids = [...vus];
    if (ids.length > 600) { const pas = ids.length / 600; ids = Array.from({ length: 600 }, (_, k) => ids[Math.floor(k * pas)]); }
    const P = ids.map((i) => [pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]]);
    const N = nor ? ids.map((i) => unit([nor[3 * i], nor[3 * i + 1], nor[3 * i + 2]])) : null;
    faces.push({ P, N });
  }
  return faces;
}

export function analyserMaillage(mesh) {
  const faces = facesDuMaillage(mesh);
  if (!faces.length || !faces[0].N) return null;
  const cyls = [], tors = [], restes = [];
  let autres = 0;
  for (const f of faces) {
    if (f.P.length < 4) { autres++; continue; }
    if (estPlan(f.N)) { autres++; continue; }
    const c = ajusterCylindre(f.P, f.N);
    if (c) cyls.push(c); else restes.push(f);
  }
  const rayonsConnus = [...new Set(cyls.map((c) => Math.round(c.rayon * 100) / 100))];
  for (const f of restes) {
    const t = ajusterTore(f.P, f.N, rayonsConnus);
    if (t) tors.push(t); else autres++;
  }
  if (!cyls.length && !tors.length) return null;
  // regroupe les rayons proches
  const rayons = [];
  for (const r of [...cyls, ...tors].map((f) => f.rayon).sort((a, b) => a - b))
    if (!rayons.length || r - rayons[rayons.length - 1] > 0.05) rayons.push(r);
  const rExt = rayons[rayons.length - 1], rInt = rayons.length > 1 ? rayons[0] : null;
  const rem = [];
  const tubeR = [rExt, ...(rInt != null ? [rInt] : [])];
  const ignores = rayons.filter((r) => !tubeR.some((x) => Math.abs(x - r) < 0.05));
  if (ignores.length) rem.push("faces cylindriques d'autres rayons ignorées : " + ignores.map((r) => `R${r.toFixed(2)}`).join(", "));
  const garde = (f) => tubeR.some((r) => Math.abs(f.rayon - r) < 0.05);
  const segs = [...fusionDroites(cyls.filter(garde)), ...fusionArcs(tors.filter(garde))];
  return { segs, diametre: 2 * rExt, epaisseur: rInt != null ? rExt - rInt : null, rem, autres };
}

const longueurSeg = (s) => (s.type === "ligne" ? norm(sub(s.p1, s.p0)) : (norm(sub(s.p1, s.p0)) || s.rayon));

const fmt = (x) => String(Math.round(x * 10) / 10).replace(".", ",");
const LONGUEUR_MINI_FILTRE = 150;   // mm : plus court qu'un mors, ce n'est pas un tube à cintrer

/** Lit un STEP (ArrayBuffer). Renvoie {tubes, rapport}.
 *  options.diametresOutils : diamètres des outils déclarés. Si fourni, seuls les solides à l'un de ces diamètres
 *  (± 0,5 mm) et d'au moins 150 mm sont gardés : les renforts d'un assemblage sont écartés. Si aucun solide ne
 *  correspond, tout est gardé (nouveau diamètre sans outil) avec une remarque. */
export async function chargerStep(buffer, nomFichier = "piece.step", options = {}) {
  const occt = await obtenirOcct(options);
  const r = occt.ReadStepFile(new Uint8Array(buffer), {
    linearUnit: "millimeter", linearDeflectionType: "absolute_value", linearDeflection: 0.2, angularDeflection: 0.3,
  });
  if (!r.success) throw new ErreurStep("Lecture du fichier STEP impossible");
  const piece = nomFichier.replace(/\.[^.]+$/, "");
  const tubes = [], rapport = [];
  const meshes = r.meshes;
  // nom de la pièce dans l'assemblage (fourni par OpenCascade) ; sinon « fichier – corps k » (pièce multicorps)
  const generique = (n) => !n || !n.trim() || /^Open CASCADE STEP translator/i.test(n);
  const vus = new Map();
  const noms = meshes.map((mesh, k) => {
    if (generique(mesh.name)) return meshes.length > 1 ? `${piece} – corps ${k + 1}` : piece;
    const n = mesh.name.trim(), c = (vus.get(n) || 0) + 1; vus.set(n, c);
    return c > 1 ? `${n} (${c})` : n;
  });
  const analyses = meshes.map((mesh, k) => ({ nomS: noms[k], res: analyserMaillage(mesh) }));
  // filtre des renforts : diamètre d'un outil déclaré
  const diams = options.diametresOutils?.length ? options.diametresOutils : null;
  const auDiametre = (res) => diams.some((d) => Math.abs(d - res.diametre) <= 0.5);
  const filtrer = !!diams && analyses.some((a) => a.res && auDiametre(a.res));
  if (diams && !filtrer && analyses.some((a) => a.res))
    rapport.push(`aucun solide au diamètre d'un outil déclaré (${diams.map((d) => "Ø" + fmt(d)).join(", ")}) : tous les solides sont gardés`);
  const ecartes = [], solideDe = new Map();
  analyses.forEach(({ nomS, res }, kSolide) => {
    if (!res) { (filtrer ? ecartes : rapport).push(filtrer ? `${nomS} (pas de forme de tube)` : `${nomS} : pas de face cylindrique ou torique, ignoré`); return; }
    if (filtrer && !auDiametre(res)) { ecartes.push(`${nomS} (Ø${fmt(res.diametre)})`); return; }
    rapport.push(...res.rem.map((x) => `${nomS} : ${x}`));
    let ep = res.epaisseur;
    if (ep == null) { rapport.push(`${nomS} : tube plein ou épaisseur non trouvée, 2 mm par défaut`); ep = 2.0; }
    let chaines = chainer(res.segs, true, 0.5).filter((c) => c.reduce((s, x) => s + longueurSeg(x), 0) > 1);
    if (filtrer) {
      const L = (c) => c.reduce((s, x) => s + longueurSeg(x), 0);
      const courts = chaines.filter((c) => L(c) < LONGUEUR_MINI_FILTRE);
      if (courts.length) ecartes.push(`${nomS} (${courts.map((c) => fmt(L(c)) + " mm").join(", ")} : trop court)`);
      chaines = chaines.filter((c) => L(c) >= LONGUEUR_MINI_FILTRE);
    }
    if (chaines.length > 1) rapport.push(`${nomS} : ${chaines.length} tronçons non raccordés (coupes, gueules de loup ou angles vifs) traités comme des tubes séparés`);
    chaines.forEach((ch, j) => {
      const nom = nomS + (chaines.length > 1 ? ` – T${j + 1}` : "");
      try {
        const t = tubeDepuisSegments(nom, ch, Math.round(res.diametre * 100) / 100, Math.round(ep * 100) / 100,
          options.matiere || "Acier", options.rayonDefaut ?? null);
        tubes.push(t); solideDe.set(t, kSolide);
      } catch (e) { rapport.push(`${nom} : ${e.message}`); }
    });
  });
  if (ecartes.length) rapport.push(`pièces écartées (renforts, pas d'outil à ce diamètre ou trop courtes) : ${ecartes.join(", ")}`);
  // gueules de loup : bouts de tube qui arrivent sur un autre solide de l'assemblage (renforts écartés compris)
  const cylindres = [];
  analyses.forEach(({ nomS, res }, k) => {
    // tubulaire : rond plein, ou paroi mince devant le rayon (une tôle à découpes arrondies donne une « épaisseur » énorme)
    const tubulaire = !res || res.epaisseur == null || res.epaisseur <= 0.5 * (res.diametre / 2);
    if (res) for (const s of res.segs) if (s.type === "ligne") cylindres.push({ p0: s.p0, p1: s.p1, rayon: res.diametre / 2, piece: nomS, k, tubulaire });
  });
  // 1) coupe déjà modélisée sur la pièce (gueule de loup, coupe biaise…) : mesurée sur le maillage, prioritaire ;
  // 2) sinon, bout droit qui arrive sur un autre tube : coupe calculée contre ce tube.
  const dirDe = (e) => { try { return e.direction || null; } catch { return null; } };   // null pour un cintre
  const boutsDe = (t) => {
    const premier = t.elements[0], dernier = t.elements[t.elements.length - 1], b = [];
    if (dirDe(premier)) b.push(["bout 1", t.debut, mul(dirDe(premier), -1), premier.longueur]);
    if (dirDe(dernier)) b.push(["bout 2", t.fin, dirDe(dernier), dernier.longueur]);
    return b;
  };
  const mesurer = (mesh, t, E, d, L) => mesurerCoupe(mesh.attributes.position.array, mesh.index.array, E, d, t.diametre / 2, L);
  // le maillage de l'analyse est grossier (17°) : s'il y a une coupe modélisée, on la remesure sur un maillage fin
  let fins = null;
  if (tubes.some((t) => boutsDe(t).some(([, E, d, L]) => mesurer(meshes[solideDe.get(t)], t, E, d, L)))) {
    const rf = occt.ReadStepFile(new Uint8Array(buffer), {
      linearUnit: "millimeter", linearDeflectionType: "absolute_value", linearDeflection: 0.05, angularDeflection: 0.05,
    });
    if (rf.success && rf.meshes.length === meshes.length) fins = rf.meshes;
  }
  for (const t of tubes) {
    const k = solideDe.get(t), autres = cylindres.filter((c) => c.k !== k);
    t.gueules = [];
    const notes = [];
    for (const [cote, E, d, L] of boutsDe(t)) {
      const voisin = chercherGueule(E, d, t.diametre / 2, autres);
      let g = mesurer((fins || meshes)[k], t, E, d, L);
      if (g) g.piece = voisin?.piece || ""; else g = voisin;
      if (g) { t.gueules.push(g); notes.push(`${cote} : ${descriptionGueule(g)}`); }
    }
    if (notes.length) rapport.push(`${t.nom} : ${notes.join(" ; ")} — affichée en orange, gabarit dans le dossier PDF`);
  }
  if (!meshes.length) throw new ErreurStep("Aucun solide dans le fichier STEP");
  return { tubes, rapport };
}
