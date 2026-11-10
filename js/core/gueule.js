// Coupes d'about des tubes (gueules de loup, coupes biaises), tirées du STEP. Deux cas :
//  - « mesure » : la coupe est déjà modélisée sur la pièce (gueule de loup, coupe biaise, toute autre forme) ;
//    on relève le bord de la surface extérieure du tube, génératrice par génératrice.
//  - « calcul » : le tube est modélisé à bout droit jusqu'au tube d'en face (assemblage) ; on calcule la coupe
//    qui épouse la surface extérieure du tube d'en face.
// Indépendant du moteur de cintrage (programme inchangé).
import { add, sub, mul, dot, cross, norm, unit } from "./vec.js";

const ANGLE_MINI = (15 * Math.PI) / 180;   // en dessous, tubes presque parallèles : pas une gueule de loup
const JEU = 0.5;                           // mm : tolérance de contact
export const PROFONDEUR_MINI = 0.5;        // mm : en dessous, le bout est considéré comme coupé droit
const N_MESURE = 360;                      // points du profil mesuré (1°)

const fmt = (x) => String(Math.round(x * 10) / 10).replace(".", ",");

/** Coupe calculée : bout E (point de l'axe), direction sortante d, rayon r du tube ;
 *  tube d'en face : point C de son axe, direction a, rayon Rm. Coordonnées CAO (mm). */
export const gueule = (E, d, r, C, a, Rm, piece) => ({ type: "calcul", E, d: unit(d), r, C, a: unit(a), Rm, piece });

/** Coupe mesurée : profil `prof` (N reculs ≤ 0, de -π à π autour de d, origine w0). */
export const gueuleMesuree = (E, d, r, w0, prof, piece = "") => ({ type: "mesure", E, d: unit(d), r, w0: unit(w0), prof, piece });

/** Angle entre les deux axes (°, 0 à 90) ; null pour une coupe mesurée. */
export const angleGueule = (g) => (g.type === "mesure" ? null : (Math.acos(Math.min(1, Math.abs(dot(g.d, g.a)))) * 180) / Math.PI);

/** Texte court pour les étiquettes et le PDF. */
export function descriptionGueule(g) {
  if (g.type === "mesure") return `coupe modélisée (profondeur ${fmt(profondeurGueule(g))} mm)` + (g.piece ? ` contre ${g.piece}` : "");
  return `gueule de loup sur Ø${fmt(2 * g.Rm)} à ${fmt(angleGueule(g))}°` + (g.piece ? ` (${g.piece})` : "");
}

/** Recherche, pour un bout de tube, le cylindre (tube d'en face) sur lequel il s'appuie.
 *  cylindres : [{p0, p1, rayon, piece}] (axes des parties droites des autres solides). */
export function chercherGueule(E, d, r, cylindres) {
  let best = null, bestD = Infinity;
  for (const c of cylindres) {
    const L = norm(sub(c.p1, c.p0)); if (L < 1e-6) continue;
    const a = unit(sub(c.p1, c.p0));
    if (Math.acos(Math.min(1, Math.abs(dot(d, a)))) < ANGLE_MINI) continue;
    if (c.tubulaire === false) continue;                     // tôle, gousset… : faces courbes de découpe, pas un tube
    const w = sub(E, c.p0), t = dot(w, a);
    // l'empreinte du bout sur l'axe d'en face (± r / sin angle) doit tenir sur la longueur du tronçon :
    // écarte les petits cylindres (congés, arrondis, épaisseur d'une tôle) et les bouts qui dépassent du tube
    const sinA = Math.sqrt(Math.max(1e-9, 1 - dot(d, a) ** 2)), demi = r / sinA;
    if (t - demi < -2 || t + demi > L + 2) continue;
    const dist = norm(sub(w, mul(a, t)));
    if (dist > c.rayon + JEU) continue;                      // le bout ne touche pas ce tube
    if (dist < bestD) { bestD = dist; best = gueule(E, d, r, c.p0, a, c.rayon, c.piece); }
  }
  return best;
}

/** Vecteur ⟂ à d, fixe (origine des angles du profil mesuré). */
function perpFixe(d) {
  let w = Math.abs(d[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  return unit(sub(w, mul(d, dot(w, d))));
}

/** Mesure la coupe d'un bout sur le maillage du solide (positions et triangles OpenCascade).
 *  E : bout (pointe la plus longue, sur l'axe), d : direction sortante, r : rayon extérieur,
 *  Lmax : longueur de droite disponible derrière le bout. Renvoie une coupe « mesure » ou null (bout droit). */
export function mesurerCoupe(positions, index, E, d, r, Lmax) {
  d = unit(d);
  const w0 = perpFixe(d), v0 = cross(d, w0);
  const tolR = Math.max(0.3, r * 0.01), tMin = -Math.min(Lmax - 0.5, 6 * r);
  // sommets sur la surface extérieure de la droite d'about : (θ, t)
  const nv = positions.length / 3, sommet = new Array(nv);
  for (let i = 0; i < nv; i++) {
    const p = [positions[3 * i], positions[3 * i + 1], positions[3 * i + 2]];
    const w = sub(p, E), t = dot(w, d);
    if (t < tMin || t > 1) continue;
    const rad = sub(w, mul(d, t));
    if (Math.abs(norm(rad) - r) > tolR) continue;
    sommet[i] = [Math.atan2(dot(rad, v0), dot(rad, w0)), t];
  }
  // enveloppe haute des arêtes de triangles de cette surface : le bord de coupe
  const prof = new Array(N_MESURE).fill(-Infinity);
  const bin = (th) => ((th + Math.PI) / (2 * Math.PI)) * N_MESURE;
  const arete = (a, b) => {
    let [ta, za] = a, [tb, zb] = b;
    if (tb - ta > Math.PI) tb -= 2 * Math.PI; else if (ta - tb > Math.PI) tb += 2 * Math.PI;
    if (tb < ta) { [ta, tb] = [tb, ta]; [za, zb] = [zb, za]; }
    const k0 = Math.ceil(bin(ta)), k1 = Math.floor(bin(tb));
    for (let k = k0; k <= k1; k++) {
      const th = -Math.PI + (2 * Math.PI * k) / N_MESURE, z = tb - ta < 1e-9 ? Math.max(za, zb) : za + ((zb - za) * (th - ta)) / (tb - ta);
      const kk = ((k % N_MESURE) + N_MESURE) % N_MESURE;
      if (z > prof[kk]) prof[kk] = z;
    }
  };
  for (let f = 0; f < index.length; f += 3) {
    const [i, j, k] = [index[f], index[f + 1], index[f + 2]];
    if (sommet[i] && sommet[j]) arete(sommet[i], sommet[j]);
    if (sommet[j] && sommet[k]) arete(sommet[j], sommet[k]);
    if (sommet[k] && sommet[i]) arete(sommet[k], sommet[i]);
  }
  // trous éventuels : interpolation circulaire entre voisins connus
  const connus = prof.map((z, k) => (z > -Infinity ? k : -1)).filter((k) => k >= 0);
  if (connus.length < N_MESURE * 0.7) return null;
  for (let k = 0; k < N_MESURE; k++) if (prof[k] === -Infinity) {
    let a = k, b = k;
    while (prof[(a + N_MESURE) % N_MESURE] === -Infinity) a--;
    while (prof[b % N_MESURE] === -Infinity) b++;
    const za = prof[(a + N_MESURE) % N_MESURE], zb = prof[b % N_MESURE];
    prof[k] = za + ((zb - za) * (k - a)) / (b - a);
  }
  const zmax = Math.max(...prof), zmin = Math.min(...prof);
  if (zmax - zmin < PROFONDEUR_MINI) return null;            // bout coupé droit
  return gueuleMesuree(E, d, r, w0, prof.map((z) => Math.min(0, z)));
}

/** Repère autour du bout : w (référence, ⟂ d, typiquement la soudure) et v = d × w. */
function repere(g, ref) {
  let w = sub(ref, mul(g.d, dot(ref, g.d)));
  if (norm(w) < 1e-9) w = perpFixe(g.d);
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
  if (g.type === "mesure") {
    const v0 = cross(g.d, g.w0), th = Math.atan2(dot(u, v0), dot(u, g.w0));
    const x = ((th + Math.PI) / (2 * Math.PI)) * g.prof.length, k = Math.floor(x), f = x - k, n = g.prof.length;
    return g.prof[((k % n) + n) % n] * (1 - f) + g.prof[(k + 1) % n] * f;
  }
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
export function profondeurGueule(g, ref = null) {
  const p = g.type === "mesure" ? g.prof : profilGueule(g, ref || perpFixe(g.d), 720).map((x) => x.recul);   // 0,5° : pointes effilées
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

/** Sérialisation (lot .tclot) : nombres arrondis au 1/1000 mm (profil au 1/100). */
const r3 = (v) => v.map((x) => Math.round(x * 1000) / 1000);
export function gueuleVersJson(g) {
  if (g.type === "mesure") return { type: "mesure", E: r3(g.E), d: r3(g.d), r: g.r, w0: r3(g.w0), prof: g.prof.map((z) => Math.round(z * 100) / 100), piece: g.piece || "" };
  return { E: r3(g.E), d: r3(g.d), r: g.r, C: r3(g.C), a: r3(g.a), Rm: g.Rm, piece: g.piece || "" };
}
export const gueuleDepuisJson = (x) => (x.type === "mesure" ? gueuleMesuree(x.E, x.d, x.r, x.w0, x.prof, x.piece)
  : gueule(x.E, x.d, x.r, x.C, x.a, x.Rm, x.piece));
