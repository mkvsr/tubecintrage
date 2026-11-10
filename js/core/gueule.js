// Gueules de loup (coupe d'about d'un tube qui vient s'appuyer sur un autre tube), déduites de l'assemblage STEP.
// Le tube est modélisé à bout droit jusqu'au tube d'en face ; on calcule la coupe à meuler pour qu'il épouse
// la surface extérieure du tube d'en face. Indépendant du moteur de cintrage (programme inchangé).
import { add, sub, mul, dot, cross, norm, unit } from "./vec.js";

const ANGLE_MINI = (15 * Math.PI) / 180;   // en dessous, tubes presque parallèles : pas une gueule de loup
const JEU = 0.5;                           // mm : tolérance de contact

/** Une gueule de loup : bout E (point de l'axe), direction sortante d, rayon r du tube ;
 *  tube d'en face : point C de son axe, direction a, rayon Rm. Coordonnées CAO (mm). */
export const gueule = (E, d, r, C, a, Rm, piece) => ({ E, d: unit(d), r, C, a: unit(a), Rm, piece });

/** Angle entre les deux axes (°, 0 à 90). */
export const angleGueule = (g) => (Math.acos(Math.min(1, Math.abs(dot(g.d, g.a)))) * 180) / Math.PI;

/** Recherche, pour un bout de tube, le cylindre (tube d'en face) sur lequel il s'appuie.
 *  cylindres : [{p0, p1, rayon, piece}] (axes des parties droites des autres solides). */
export function chercherGueule(E, d, r, cylindres) {
  let best = null, bestD = Infinity;
  for (const c of cylindres) {
    const L = norm(sub(c.p1, c.p0)); if (L < 1e-6) continue;
    const a = unit(sub(c.p1, c.p0));
    if (Math.acos(Math.min(1, Math.abs(dot(d, a)))) < ANGLE_MINI) continue;
    const w = sub(E, c.p0), t = dot(w, a);
    if (t < -r || t > L + r) continue;                       // le bout n'est pas en face de ce tronçon
    const dist = norm(sub(w, mul(a, t)));
    if (dist > c.rayon + JEU) continue;                      // le bout ne touche pas ce tube
    if (dist < bestD) { bestD = dist; best = gueule(E, d, r, c.p0, a, c.rayon, c.piece); }
  }
  return best;
}

/** Repère autour du bout : w (référence, ⟂ d, typiquement la soudure) et v = d × w. */
function repere(g, ref) {
  let w = sub(ref, mul(g.d, dot(ref, g.d)));
  if (norm(w) < 1e-9) { w = Math.abs(g.d[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]; w = sub(w, mul(g.d, dot(w, g.d))); }
  w = unit(w);
  return { w, v: cross(g.d, w) };
}

/** Direction radiale de la génératrice θ (même repère que reculGueule). */
export function radiale(g, ref, theta) {
  const { w, v } = repere(g, ref);
  return add(mul(w, Math.cos(theta)), mul(v, Math.sin(theta)));
}

/** Recul de la coupe (mm, ≤ 0, le long de d depuis E) pour la génératrice à l'angle θ autour de d
 *  (θ = 0 sur `ref`, sens direct autour de d : antihoraire vu depuis le bout). */
export function reculGueule(g, ref, theta) {
  const { w, v } = repere(g, ref);
  const u = add(mul(w, Math.cos(theta)), mul(v, Math.sin(theta)));
  const w0 = sub(add(g.E, mul(u, g.r)), g.C);
  const w0p = sub(w0, mul(g.a, dot(w0, g.a))), dp = sub(g.d, mul(g.a, dot(g.d, g.a)));
  const A = dot(dp, dp), B = 2 * dot(w0p, dp), Cq = dot(w0p, w0p) - g.Rm * g.Rm;
  const disc = B * B - 4 * A * Cq;
  if (A < 1e-12 || disc < 0) return 0;                       // la génératrice ne rencontre pas le tube d'en face
  const t1 = (-B - Math.sqrt(disc)) / (2 * A);               // entrée dans le tube d'en face
  return Math.min(0, t1);                                    // jamais plus long que le tube CAO
}

/** Profil complet : n points {theta, recul}, theta de -π à π (soudure au milieu). */
export function profilGueule(g, ref, n = 180) {
  const out = [];
  for (let k = 0; k <= n; k++) { const theta = -Math.PI + (2 * Math.PI * k) / n; out.push({ theta, recul: reculGueule(g, ref, theta) }); }
  return out;
}

/** Profondeur de la coupe (mm) : écart entre la pointe la plus longue et le creux. */
export function profondeurGueule(g, ref = [0, 0, 1]) {
  const p = profilGueule(g, ref, 90).map((x) => x.recul);
  return Math.max(...p) - Math.min(...p);
}

/** Gueules de loup d'un tube rangées par bout du tube tel qu'il est orienté : {avant, arriere}. */
export function gueulesDuTube(tube) {
  const res = { avant: null, arriere: null };
  for (const g of tube.gueules || []) {
    const dA = norm(sub(g.E, tube.debut)), dR = norm(sub(g.E, tube.fin));
    if (Math.min(dA, dR) > 1) continue;
    if (dA <= dR) res.avant = g; else res.arriere = g;
  }
  return res;
}

/** Sérialisation (lot .tclot) : nombres arrondis au 1/1000 mm. */
const r3 = (v) => v.map((x) => Math.round(x * 1000) / 1000);
export const gueuleVersJson = (g) => ({ E: r3(g.E), d: r3(g.d), r: g.r, C: r3(g.C), a: r3(g.a), Rm: g.Rm, piece: g.piece || "" });
export const gueuleDepuisJson = (x) => gueule(x.E, x.d, x.r, x.C, x.a, x.Rm, x.piece);
