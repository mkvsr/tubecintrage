// Tubes rectangulaires et carrés droits (40×40×3, 60×40×3…) : non cintrés (pas d'outillage), mais débit, coupes
// d'about (onglets, gueules de loup), gabarits et étiquettes. Indépendant du moteur de cintrage des tubes ronds.
//
// Repère d'un profil : d = axe (du début vers la fin), u et v = normales des faces (v ≈ vers le haut dans la CAO,
// u = v × d, donc v = d × u). Section : demi-largeur a (selon u), demi-hauteur b (selon v), rayon d'angle extérieur rc.
// Le périmètre extérieur est parcouru par l'abscisse s (0 ≤ s < P), dans le sens direct autour de d, à partir du milieu
// de la face 1 (+v, « dessus ») ; faces : 1 = +v, 2 = -u, 3 = -v, 4 = +u.
import { add, sub, mul, dot, cross, norm, unit } from "./vec.js";
import { Droite } from "./geometrie.js";
import { Message, ERREUR } from "./sequence.js";

const fmt = (x) => String(Math.round(x * 10) / 10).replace(".", ",");
export const PROFONDEUR_MINI = 0.5;
const N_PROFIL = 360;

// ----------------------------------------------------------------------
// Section : parcours du périmètre (rectangle à angles arrondis)
export function section(largeur, hauteur, epaisseur, rc = 0) {
  const a = largeur / 2, b = hauteur / 2;
  rc = Math.max(0, Math.min(rc, a, b));
  const L1 = a - rc, C = (rc * Math.PI) / 2, Lv = 2 * (b - rc), Lh = 2 * (a - rc);
  // morceaux dans l'ordre : demi-dessus gauche, angle, gauche, angle, dessous, angle, droite, angle, demi-dessus droit
  const m = [
    { l: [[0, b], [-(a - rc), b]], n: [0, 1], len: L1 },
    { c: [-(a - rc), b - rc], a0: Math.PI / 2, len: C },
    { l: [[-a, b - rc], [-a, -(b - rc)]], n: [-1, 0], len: Lv },
    { c: [-(a - rc), -(b - rc)], a0: Math.PI, len: C },
    { l: [[-(a - rc), -b], [a - rc, -b]], n: [0, -1], len: Lh },
    { c: [a - rc, -(b - rc)], a0: (3 * Math.PI) / 2, len: C },
    { l: [[a, -(b - rc)], [a, b - rc]], n: [1, 0], len: Lv },
    { c: [a - rc, b - rc], a0: 0, len: C },
    { l: [[a - rc, b], [0, b]], n: [0, 1], len: L1 },
  ];
  let s = 0; for (const p of m) { p.s0 = s; s += p.len; }
  const P = s;
  const centres = [0, L1 + C + Lv / 2, P / 2, P - (L1 + C + Lv / 2)];            // milieux des faces 1 à 4
  const angles = [L1 + C / 2, L1 + 1.5 * C + Lv, L1 + 2.5 * C + Lv + Lh, L1 + 3.5 * C + 2 * Lv + Lh];   // milieux des arrondis
  return { largeur, hauteur, epaisseur, rc, a, b, P, morceaux: m, centres, angles };
}

/** Point du périmètre extérieur à l'abscisse s : {x, y, nx, ny} (coordonnées de section). */
export function pointSection(sec, s) {
  s = ((s % sec.P) + sec.P) % sec.P;
  for (const p of sec.morceaux) {
    if (s > p.s0 + p.len + 1e-9 && p !== sec.morceaux[sec.morceaux.length - 1]) continue;
    const f = p.len > 0 ? Math.min(1, Math.max(0, (s - p.s0) / p.len)) : 0;
    if (p.l) return { x: p.l[0][0] + (p.l[1][0] - p.l[0][0]) * f, y: p.l[0][1] + (p.l[1][1] - p.l[0][1]) * f, nx: p.n[0], ny: p.n[1] };
    const ang = p.a0 + (Math.PI / 2) * f;
    return { x: p.c[0] + sec.rc * Math.cos(ang), y: p.c[1] + sec.rc * Math.sin(ang), nx: Math.cos(ang), ny: Math.sin(ang) };
  }
  return { x: 0, y: sec.b, nx: 0, ny: 1 };
}

/** Abscisse s du point du périmètre le plus proche de (x, y), et distance à ce périmètre. */
export function abscisseSection(sec, x, y) {
  let best = { s: 0, dist: Infinity };
  for (const p of sec.morceaux) {
    if (p.len <= 0) continue;
    let f, px, py;
    if (p.l) {
      const [x0, y0] = p.l[0], [x1, y1] = p.l[1], dx = x1 - x0, dy = y1 - y0;
      f = Math.min(1, Math.max(0, ((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy)));
      px = x0 + dx * f; py = y0 + dy * f;
    } else {
      let ang = Math.atan2(y - p.c[1], x - p.c[0]) - p.a0;
      ang = ((ang % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      if (ang > Math.PI / 2) ang = ang > Math.PI * 1.25 ? 0 : Math.PI / 2;
      f = ang / (Math.PI / 2);
      px = p.c[0] + sec.rc * Math.cos(p.a0 + ang); py = p.c[1] + sec.rc * Math.sin(p.a0 + ang);
    }
    const dist = Math.hypot(x - px, y - py);
    if (dist < best.dist) best = { s: p.s0 + f * p.len, dist };
  }
  return best;
}

export const nomSection = (sec) => `${sec.largeur === sec.hauteur ? "Carré" : "Rect."} ${fmt(sec.largeur)} × ${fmt(sec.hauteur)} × ${fmt(sec.epaisseur)}`;

// ----------------------------------------------------------------------
/** Tube rectangulaire droit (une pièce). debut : centre de la section au début (pointe la plus en arrière), d : axe. */
export class Profil {
  constructor(nom, { debut, d, u, largeur, hauteur, epaisseur, rc = 0, longueur }, matiere = "Acier") {
    this.nom = nom; this.debutP = debut; this.d = unit(d); this.u = unit(u); this.v = cross(this.d, this.u);
    this.largeur = largeur; this.hauteur = hauteur; this.epaisseur = epaisseur; this.rc = rc; this.longueurP = longueur;
    this.matiere = matiere; this.alertes = [];
    this.quantite = 1; this.reglages = {}; this.sources = []; this.repere = ""; this.gueules = [];
  }
  get estProfil() { return true; }
  get sec() { return section(this.largeur, this.hauteur, this.epaisseur, this.rc); }
  get nomSection() { return nomSection(this.sec); }
  get debut() { return this.debutP; }
  get fin() { return add(this.debutP, mul(this.d, this.longueurP)); }
  get longueur() { return this.longueurP; }
  // compatibilité avec le code commun aux tubes (liste, débit…) : un profil est une seule droite, sans pli
  get elements() { return [new Droite(this.debut, this.fin)]; }
  get droites() { return this.elements; }
  get cintres() { return []; }
  get diametre() { return null; }
  /** Face de la soudure (1 à 4, réglage du tube ; 1 = dessus par défaut) et abscisse s de son milieu. */
  get faceSoudure() { return Math.min(4, Math.max(1, Math.round(this.reglages.faceSoudure || 1))); }
  copie(changes = {}) {
    const t = new Profil(this.nom, { debut: this.debutP, d: this.d, u: this.u, largeur: this.largeur, hauteur: this.hauteur,
      epaisseur: this.epaisseur, rc: this.rc, longueur: this.longueurP }, this.matiere);
    t.quantite = this.quantite; t.reglages = { ...this.reglages }; t.sources = [...this.sources]; t.repere = this.repere;
    t.gueules = this.gueules || []; t.alertes = [...this.alertes];
    return Object.assign(t, changes);
  }
  inverse() { return this.copie(); }   // pas de sens de passage machine
}

/** Programme d'un profil : pas de cintrage, seulement le débit (même forme que le programme d'un tube rond). */
export function programmeProfil(t, machine) {
  const msgs = [];
  if (t.longueur > machine.barre_longueur) msgs.push(new Message(ERREUR, `Longueur ${fmt(t.longueur)} mm plus longue qu'une barre (${fmt(machine.barre_longueur)} mm)`));
  return {
    profil: true, tube: t, tubeCao: t, machine, longueurDebit: t.longueur, etapes: [], messages: msgs,
    erreurs: msgs.filter((m) => m.niveau === ERREUR), alertes: [], surlongAvant: 0, surlongArriere: 0, inverse: false,
    psi: 0, scoreSoudure: 0, outil: null,
  };
}

// ----------------------------------------------------------------------
// Reconnaissance dans un maillage OpenCascade
function facesPlanes(mesh) {
  const pos = mesh.attributes.position.array, nor = mesh.attributes.normal?.array, idx = mesh.index.array;
  if (!nor) return null;
  const plans = [], courbes = [];
  for (const bf of mesh.brep_faces) {
    const ids = new Set(); let aire = 0;
    for (let t = bf.first; t <= bf.last; t++) {
      const [i, j, k] = [idx[3 * t], idx[3 * t + 1], idx[3 * t + 2]];
      ids.add(i); ids.add(j); ids.add(k);
      const A = [pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]], B = [pos[3 * j], pos[3 * j + 1], pos[3 * j + 2]], C = [pos[3 * k], pos[3 * k + 1], pos[3 * k + 2]];
      aire += norm(cross(sub(B, A), sub(C, A))) / 2;
    }
    if (ids.size < 3) continue;   // face vide (non maillée)
    const P = [...ids].map((i) => [pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]]);
    const N = [...ids].map((i) => unit([nor[3 * i], nor[3 * i + 1], nor[3 * i + 2]]));
    const n0 = N[0];
    if (N.every((n) => dot(n, n0) > 0.9999)) plans.push({ n: n0, P, aire }); else courbes.push({ P, N, aire });
  }
  return { plans, courbes };
}

/** Tube rectangulaire droit ? Renvoie {debut, d, u, largeur, hauteur, epaisseur, rc, longueur} ou null. */
export function analyserProfil(mesh) {
  const f = facesPlanes(mesh);
  if (!f || f.plans.length < 4) return null;
  // directions des faces planes (au signe près), pondérées par l'aire
  const dirs = [];
  for (const p of f.plans) {
    const g = dirs.find((x) => Math.abs(dot(x.n, p.n)) > 0.9995);
    if (g) g.aire += p.aire; else dirs.push({ n: p.n, aire: p.aire });
  }
  dirs.sort((x, y) => y.aire - x.aire);
  let best = null;
  for (let i = 0; i < dirs.length; i++) for (let j = i + 1; j < dirs.length; j++)
    if (Math.abs(dot(dirs[i].n, dirs[j].n)) < 0.01 && (!best || dirs[i].aire + dirs[j].aire > best.aire)) best = { a: dirs[i].n, b: dirs[j].n, aire: dirs[i].aire + dirs[j].aire };
  if (!best) return null;
  const d0 = unit(cross(best.a, best.b));
  const aireTot = f.plans.reduce((s, p) => s + p.aire, 0) + f.courbes.reduce((s, p) => s + p.aire, 0);
  if (best.aire < 0.6 * aireTot) return null;                          // pas un prisme (tôle pliée, pièce massive…)
  // v : normale de face la plus verticale (dessus de la CAO) ; u = v × d
  const haut = Math.abs(d0[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
  let v = Math.abs(dot(best.a, haut)) >= Math.abs(dot(best.b, haut)) ? best.a : best.b;
  if (dot(v, haut) < 0) v = mul(v, -1);
  const u = unit(cross(v, d0));
  const pos = mesh.attributes.position.array;
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    const p = [pos[i], pos[i + 1], pos[i + 2]], x = dot(p, u), y = dot(p, v);
    xmin = Math.min(xmin, x); xmax = Math.max(xmax, x); ymin = Math.min(ymin, y); ymax = Math.max(ymax, y);
  }
  const W = xmax - xmin, H = ymax - ymin, cx = (xmin + xmax) / 2, cy = (ymin + ymax) / 2;
  // faces latérales : extérieures (sur l'enveloppe) et intérieures (tube creux)
  const lat = f.plans.filter((p) => Math.abs(dot(p.n, d0)) < 0.01);
  const off = (p, ax) => dot(p.P[0], ax);
  let ep = Infinity, rc = 0, tmin = Infinity, tmax = -Infinity;
  // section fermée : une face extérieure et une face intérieure sur chacun des 4 côtés, même épaisseur partout
  // (écarte les tôles pliées, profils ouverts en U ou en C, pièces usinées)
  const cotes = { "u+": { ext: 0, int: [] }, "u-": { ext: 0, int: [] }, "v+": { ext: 0, int: [] }, "v-": { ext: 0, int: [] } };
  const etendue = (p) => { let a = Infinity, b = -Infinity; for (const q of p.P) { const t = dot(q, d0); a = Math.min(a, t); b = Math.max(b, t); } return b - a; };
  for (const p of lat) {
    const surU = Math.abs(dot(p.n, u)) > 0.999, ax = surU ? u : v, o = off(p, ax), lo = surU ? xmin : ymin, hi = surU ? xmax : ymax;
    const ext = Math.abs(o - lo) < 0.05 || Math.abs(o - hi) < 0.05;
    const cote = (surU ? "u" : "v") + (o > (lo + hi) / 2 ? "+" : "-");
    if (!ext) {
      const e = Math.min(Math.abs(o - lo), Math.abs(o - hi));
      ep = Math.min(ep, e); cotes[cote].int.push({ e, L: etendue(p) });
    } else {
      cotes[cote].ext++;
      // rayon d'angle : la face extérieure s'arrête à rc du bord de la section
      const autre = surU ? v : u, c = surU ? cy : cx, demi = surU ? H / 2 : W / 2;
      let m = 0; for (const q of p.P) m = Math.max(m, Math.abs(dot(q, autre) - c));
      rc = Math.max(rc, demi - m);
      for (const q of p.P) { const t = dot(q, d0); tmin = Math.min(tmin, t); tmax = Math.max(tmax, t); }
    }
  }
  if (!isFinite(ep) || ep < 0.5 || ep > Math.min(W, H) / 2.5) return null;       // plein (plat, barre) ou incohérent
  const L = tmax - tmin;
  for (const c of Object.values(cotes)) {
    if (!c.ext || !c.int.length) return null;                                     // côté ouvert : profil en U, tôle pliée…
    if (!c.int.some((x) => Math.abs(x.e - ep) < 0.3 && x.L > 0.5 * L)) return null; // épaisseur différente ou face courte
  }
  if (W < 8 || H < 8 || W > 400 || H > 400 || !(tmax - tmin >= 100)) return null;
  const debut = add(add(mul(u, cx), mul(v, cy)), mul(d0, tmin));
  const r1 = (x) => Math.round(x * 100) / 100;
  return { debut, d: d0, u, largeur: r1(W), hauteur: r1(H), epaisseur: r1(ep), rc: r1(Math.max(0, rc)), longueur: tmax - tmin };
}

// ----------------------------------------------------------------------
// Coupes d'about d'un profil (repère local du bout : E centre de section, d sortant, u/v de la section)
const reperBout = (t, auDebut) => ({ E: auDebut ? t.debut : t.fin, d: auDebut ? mul(t.d, -1) : t.d, u: t.u, v: t.v });

/** Mesure la coupe modélisée d'un bout sur le maillage (bord de la surface extérieure). null si bout coupé droit. */
export function mesurerCoupeProfil(positions, index, t, auDebut) {
  const { E, d, u, v } = reperBout(t, auDebut), sec = t.sec;
  // au début, d est inversé : l'abscisse s doit rester celle du profil (repère u, v du tube)
  const nv = positions.length / 3, sommet = new Array(nv), tMin = -Math.min(t.longueur - 0.5, 4 * Math.max(sec.a, sec.b) + 50);
  for (let i = 0; i < nv; i++) {
    const p = [positions[3 * i], positions[3 * i + 1], positions[3 * i + 2]], w = sub(p, E), tt = dot(w, d);
    if (tt < tMin || tt > 1) continue;
    const r = abscisseSection(sec, dot(w, u), dot(w, v));
    if (r.dist > 0.3) continue;
    sommet[i] = [r.s, tt];
  }
  const prof = new Array(N_PROFIL).fill(-Infinity), P = sec.P;
  const arete = (A, B) => {
    let [sa, za] = A, [sb, zb] = B;
    if (sb - sa > P / 2) sb -= P; else if (sa - sb > P / 2) sb += P;
    if (sb < sa) { [sa, sb] = [sb, sa]; [za, zb] = [zb, za]; }
    const k0 = Math.ceil((sa / P) * N_PROFIL), k1 = Math.floor((sb / P) * N_PROFIL);
    for (let k = k0; k <= k1; k++) {
      const s = (k / N_PROFIL) * P, z = sb - sa < 1e-9 ? Math.max(za, zb) : za + ((zb - za) * (s - sa)) / (sb - sa);
      const kk = ((k % N_PROFIL) + N_PROFIL) % N_PROFIL;
      if (z > prof[kk]) prof[kk] = z;
    }
  };
  for (let f = 0; f < index.length; f += 3) {
    const [i, j, k] = [index[f], index[f + 1], index[f + 2]];
    if (sommet[i] && sommet[j]) arete(sommet[i], sommet[j]);
    if (sommet[j] && sommet[k]) arete(sommet[j], sommet[k]);
    if (sommet[k] && sommet[i]) arete(sommet[k], sommet[i]);
  }
  const connus = prof.filter((z) => z > -Infinity).length;
  if (connus < N_PROFIL * 0.7) return null;
  for (let k = 0; k < N_PROFIL; k++) if (prof[k] === -Infinity) {
    let a = k, b = k;
    while (prof[(a + N_PROFIL) % N_PROFIL] === -Infinity) a--;
    while (prof[b % N_PROFIL] === -Infinity) b++;
    const za = prof[(a + N_PROFIL) % N_PROFIL], zb = prof[b % N_PROFIL];
    prof[k] = za + ((zb - za) * (k - a)) / (b - a);
  }
  if (Math.max(...prof) - Math.min(...prof) < PROFONDEUR_MINI) return null;
  return { type: "mesure", profil: true, auDebut, E, d, prof: prof.map((z) => Math.min(0, z)), piece: "" };
}

/** Recul de la coupe (≤ 0, le long de d depuis le bout) à l'abscisse s du périmètre. */
export function reculProfil(g, t, s) {
  const sec = t.sec, P = sec.P;
  if (g.type === "mesure") {
    const x = ((((s % P) + P) % P) / P) * g.prof.length, k = Math.floor(x), f = x - k, n = g.prof.length;
    return g.prof[k % n] * (1 - f) + g.prof[(k + 1) % n] * f;
  }
  const { E, d, u, v } = reperBout(t, g.auDebut), q = pointSection(sec, s);
  const M = add(E, add(mul(u, q.x), mul(v, q.y)));          // point du périmètre dans la section du bout
  if (g.type === "plan") {                                   // contre une face plane (tube carré d'en face)
    const nd = dot(g.N, d); if (Math.abs(nd) < 1e-9) return 0;
    return Math.min(0, -dot(g.N, sub(M, g.P0)) / nd);
  }
  // contre un cylindre (tube rond d'en face)
  const w0 = sub(M, g.C), w0p = sub(w0, mul(g.a, dot(w0, g.a))), dp = sub(d, mul(g.a, dot(d, g.a)));
  const A = dot(dp, dp), B = 2 * dot(w0p, dp), Cq = dot(w0p, w0p) - g.Rm * g.Rm, disc = B * B - 4 * A * Cq;
  if (A < 1e-12 || disc < 0) return 0;
  return Math.min(0, (-B - Math.sqrt(disc)) / (2 * A));
}

/** Profil de coupe centré sur la face de soudure : n+1 points {s (relatif, de -P/2 à P/2), recul}.
 *  Gauche → droite = sens antihoraire vu depuis le bout (comme les gabarits des tubes ronds) : au bout de départ,
 *  l'axe sortant est -d, l'abscisse du profil est donc parcourue à l'envers. */
export function profilCoupeProfil(g, t, n = 720) {
  const sec = t.sec, s0 = sec.centres[t.faceSoudure - 1], sens = g.auDebut ? -1 : 1, out = [];
  for (let k = 0; k <= n; k++) { const ds = -sec.P / 2 + (sec.P * k) / n; out.push({ s: ds, recul: reculProfil(g, t, s0 + sens * ds) }); }
  return out;
}

export function profondeurProfil(g, t) {
  const p = profilCoupeProfil(g, t, 360).map((x) => x.recul);
  return Math.max(...p) - Math.min(...p);
}

/** Coupe calculée d'un bout de profil contre le tube d'en face (cylindre) ou une face plane d'un autre profil. */
export function chercherCoupeProfil(t, auDebut, cylindres, plans) {
  const { E, d } = reperBout(t, auDebut), sec = t.sec, demi = Math.hypot(sec.a, sec.b);
  let best = null, bestD = Infinity;
  for (const c of cylindres) {
    if (c.tubulaire === false) continue;
    const L = norm(sub(c.p1, c.p0)); if (L < 1e-6) continue;
    const a = unit(sub(c.p1, c.p0)), sinA = Math.sqrt(Math.max(1e-9, 1 - dot(d, a) ** 2));
    if (sinA < Math.sin((15 * Math.PI) / 180)) continue;
    const w = sub(E, c.p0), tt = dot(w, a), dist = norm(sub(w, mul(a, tt)));
    if (dist > c.rayon + 0.5 || tt - demi / sinA < -2 || tt + demi / sinA > L + 2) continue;
    if (dist < bestD) { bestD = dist; best = { type: "calcul", auDebut, C: c.p0, a, Rm: c.rayon, piece: c.piece }; }
  }
  for (const p of plans) {
    const g = { type: "plan", auDebut, P0: p.P0, N: p.N, piece: p.piece };
    const h = dot(p.N, sub(E, p.P0));                      // > 0 : devant la face ; < 0 : dedans
    if (h > 0.5 || h < -p.epaisseurMax) continue;
    const loc = sub(E, mul(p.N, h));                         // projection du bout sur la face
    if (Math.abs(dot(sub(loc, p.c), p.e1)) > p.h1 + 1 || Math.abs(dot(sub(loc, p.c), p.e2)) > p.h2 + 1) continue;
    if (Math.abs(dot(p.N, d)) > 0.999) continue;             // bout perpendiculaire à la face : coupe droite
    if (Math.abs(h) < bestD) { bestD = Math.abs(h); best = g; }
  }
  if (!best) return null;
  return profondeurProfil(best, t) >= PROFONDEUR_MINI ? best : null;
}

/** Faces planes extérieures d'un profil (pour les coupes des autres tubes qui viennent dessus). */
export function facesExterieures(t, piece) {
  const sec = t.sec, c0 = add(t.debut, mul(t.d, t.longueur / 2)), out = [];
  for (const [n, h, e2, h2] of [[t.v, sec.b, t.u, sec.a - sec.rc], [mul(t.u, -1), sec.a, t.v, sec.b - sec.rc],
    [mul(t.v, -1), sec.b, t.u, sec.a - sec.rc], [t.u, sec.a, t.v, sec.b - sec.rc]]) {
    out.push({ P0: add(c0, mul(n, h)), N: n, c: add(c0, mul(n, h)), e1: t.d, h1: t.longueur / 2, e2, h2: Math.max(h2, 1), piece,
      epaisseurMax: 2 * Math.max(sec.a, sec.b) });
  }
  return out;
}

export function descriptionCoupeProfil(g, t) {
  const p = fmt(profondeurProfil(g, t));
  if (g.type === "mesure") return `coupe modélisée (profondeur ${p} mm)` + (g.piece ? ` contre ${g.piece}` : "");
  if (g.type === "plan") return `coupe biaise contre une face de ${g.piece || "tube carré"} (profondeur ${p} mm)`;
  return `gueule de loup sur Ø${fmt(2 * g.Rm)}` + (g.piece ? ` (${g.piece})` : "") + `, profondeur ${p} mm`;
}

/** Coupes d'un profil rangées par bout : {avant, arriere} (avant = début du profil). */
export function coupesDuProfil(t) {
  const r = { avant: null, arriere: null };
  for (const g of t.gueules || []) if (g.auDebut) r.avant = g; else r.arriere = g;
  return r;
}

// ----------------------------------------------------------------------
// Lots (.tclot) : clé « profils », ignorée par l'ancienne version
const r3 = (v) => v.map((x) => Math.round(x * 1000) / 1000);
export function profilVersJson(t) {
  return { nom: t.nom, repere: t.repere, quantite: t.quantite, matiere: t.matiere, sources: t.sources, reglages: t.reglages,
    debut: r3(t.debut), d: r3(t.d), u: r3(t.u), largeur: t.largeur, hauteur: t.hauteur, epaisseur: t.epaisseur, rc: t.rc,
    longueur: Math.round(t.longueur * 1000) / 1000,
    coupes: (t.gueules || []).map((g) => ({ ...g, prof: g.prof ? g.prof.map((z) => Math.round(z * 100) / 100) : undefined })) };
}
export function profilDepuisJson(x) {
  const t = new Profil(x.nom, { debut: x.debut, d: x.d, u: x.u, largeur: x.largeur, hauteur: x.hauteur, epaisseur: x.epaisseur, rc: x.rc, longueur: x.longueur }, x.matiere);
  t.quantite = Number(x.quantite ?? 1); t.repere = x.repere || ""; t.sources = [...(x.sources || [])]; t.reglages = { ...(x.reglages || {}) };
  t.gueules = (x.coupes || []).map((g) => ({ ...g }));
  return t;
}
