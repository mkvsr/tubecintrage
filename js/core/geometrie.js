// Géométrie du tube : fibre neutre composée de droites et de cintres.
// Un tube est une suite alternée Droite / Cintre / Droite ... qui commence et finit
// par une Droite (éventuellement de longueur nulle). Unités : mm et radians.
import { add, sub, mul, neg, dot, cross, norm, unit, rot, mv, perpendiculaire, angleEntre, copy, RAD, DEG }
  from "./vec.js";

export const TOL = 1e-6;
export const TOL_POINT = 0.05;
export const TOL_TANGENCE = 1 * RAD;

export class Droite {
  constructor(p0, p1, directionDefaut = null) {
    this.p0 = p0; this.p1 = p1; this.directionDefaut = directionDefaut;
  }
  get longueur() { return norm(sub(this.p1, this.p0)); }
  get direction() {
    if (this.longueur > TOL) return unit(sub(this.p1, this.p0));
    if (this.directionDefaut) return unit(this.directionDefaut);
    throw new Error("direction indéfinie pour une droite de longueur nulle");
  }
  inverse() { return new Droite(copy(this.p1), copy(this.p0), this.directionDefaut ? neg(this.directionDefaut) : null); }
  points(pas) {
    const n = Math.max(1, Math.ceil(this.longueur / pas));
    const out = [];
    for (let k = 0; k <= n; k++) out.push(add(this.p0, mul(sub(this.p1, this.p0), k / n)));
    return out;
  }
}

/** Arc de la fibre neutre. t_sortie = rot(axe, angle) · t_entree. */
export class Cintre {
  constructor(p0, p1, centre, axe, angle, rayon) {
    Object.assign(this, { p0, p1, centre, axe, angle, rayon });
  }
  get longueur() { return this.rayon * this.angle; }
  get tEntree() { return unit(cross(this.axe, sub(this.p0, this.centre))); }
  get tSortie() { return unit(cross(this.axe, sub(this.p1, this.centre))); }
  inverse() { return new Cintre(copy(this.p1), copy(this.p0), copy(this.centre), neg(this.axe), this.angle, this.rayon); }
  pointA(a) { return add(this.centre, mv(rot(this.axe, a), sub(this.p0, this.centre))); }
  points(pas) {
    const n = Math.max(2, Math.ceil(this.longueur / pas));
    const out = [];
    for (let k = 0; k <= n; k++) out.push(this.pointA(this.angle * k / n));
    return out;
  }
}

export const estCintre = (e) => e instanceof Cintre;
export const estDroite = (e) => e instanceof Droite;

export class Tube {
  constructor(nom, elements, diametre = 48.3, epaisseur = 2.0, matiere = "Acier", alertes = []) {
    this.nom = nom; this.elements = elements; this.diametre = diametre; this.epaisseur = epaisseur;
    this.matiere = matiere; this.alertes = alertes;
    this.quantite = 1; this.reglages = {}; this.sources = []; this.repere = ""; this.gueules = [];
  }
  get droites() { return this.elements.filter(estDroite); }
  get cintres() { return this.elements.filter(estCintre); }
  get longueur() { return this.elements.reduce((s, e) => s + e.longueur, 0); }
  get debut() { return this.elements[0].p0; }
  get fin() { return this.elements[this.elements.length - 1].p1; }

  copie(changes = {}) {
    const t = new Tube(this.nom, [...this.elements], this.diametre, this.epaisseur, this.matiere, [...this.alertes]);
    t.quantite = this.quantite; t.reglages = { ...this.reglages }; t.sources = [...this.sources]; t.repere = this.repere;
    t.gueules = this.gueules || [];   // gueules de loup (coordonnées CAO, rattachées au bout par sa position : suivent un retournement)
    return Object.assign(t, changes);
  }
  inverse() {
    const t = this.copie();
    t.elements = [...this.elements].reverse().map((e) => e.inverse());
    return t;
  }

  /** Échantillonnage : {pts, s, idx} (points, abscisse curviligne, index d'élément). */
  echantillonner(pas = 10) {
    const pts = [], s = [], idx = [];
    let cumul = 0;
    this.elements.forEach((e, k) => {
      const ep = e.longueur > TOL ? e.points(pas) : [e.p0, e.p1];
      const n = ep.length - 1;
      ep.forEach((p, j) => {
        if (pts.length && j === 0) return;
        pts.push(p); s.push(cumul + e.longueur * (n ? j / n : 0)); idx.push(k);
      });
      cumul += e.longueur;
    });
    return { pts, s, idx };
  }

  /** Table L / R / A (rotation entre plans successifs, degrés). */
  lra() {
    const lignes = [], ds = this.droites, cs = this.cintres;
    let axePrec = null;
    cs.forEach((c, i) => {
      let rotation = 0;
      if (axePrec) {
        const t = c.tEntree;
        const a0 = sub(axePrec, mul(t, dot(axePrec, t)));
        const a1 = sub(c.axe, mul(t, dot(c.axe, t)));
        rotation = Math.atan2(dot(cross(a0, a1), t), dot(a0, a1)) * DEG;
      }
      lignes.push({ L: ds[i].longueur, R: rotation, A: c.angle * DEG, rayon: c.rayon });
      axePrec = c.axe;
    });
    return { lignes, fin: ds[ds.length - 1].longueur };
  }
}

// ----------------------------------------------------------------------
export function normaliser(elements) {
  const out = [];
  for (const e of elements) {
    if (e instanceof Droite) {
      const prev = out[out.length - 1];
      if (prev instanceof Droite) {
        const dirs = [];
        for (const d of [prev, e]) { try { dirs.push(d.direction); } catch { /* droite nulle */ } }
        if (dirs.length === 2 && angleEntre(dirs[0], dirs[1]) > TOL_TANGENCE)
          throw new Error("Angle vif sans rayon entre deux droites");
        out[out.length - 1] = new Droite(prev.p0, e.p1, dirs.length ? dirs[0] : null);
      } else out.push(e);
    } else {
      if (!out.length || out[out.length - 1] instanceof Cintre) out.push(new Droite(copy(e.p0), copy(e.p0), e.tEntree));
      out.push(e);
    }
  }
  if (out.length && out[out.length - 1] instanceof Cintre) {
    const c = out[out.length - 1];
    out.push(new Droite(copy(c.p1), copy(c.p1), c.tSortie));
  }
  out.forEach((e, k) => {
    if (e instanceof Droite && e.longueur < TOL && !e.directionDefaut) {
      if (out[k + 1] instanceof Cintre) e.directionDefaut = out[k + 1].tEntree;
      else if (out[k - 1] instanceof Cintre) e.directionDefaut = out[k - 1].tSortie;
    }
  });
  return out;
}

export function cintreEntre(dIn, dOut, sommet, rayon) {
  const theta = angleEntre(dIn, dOut);
  const T = rayon * Math.tan(theta / 2);
  const a = sub(sommet, mul(dIn, T)), b = add(sommet, mul(dOut, T));
  const axe = unit(cross(dIn, dOut));
  const centre = add(a, mul(cross(axe, dIn), rayon));
  return { c: new Cintre(a, b, centre, axe, theta, rayon), T };
}

/** Tube par ses points d'intersection (P0, sommets…, Pn) et un rayon par sommet. */
export function tubeDepuisPoints(nom, points, rayons, diametre = 48.3, epaisseur = 2.0, matiere = "Acier") {
  const P = points.map((p) => p.map(Number));
  if (P.length < 2) throw new Error("Il faut au moins deux points");
  if (!Array.isArray(rayons)) rayons = P.map(() => Number(rayons));
  const alertes = [];
  const Q = [P[0]], R = [null];
  for (let i = 1; i < P.length - 1; i++) {
    const dIn = unit(sub(P[i], Q[Q.length - 1])), dOut = unit(sub(P[i + 1], P[i]));
    if (angleEntre(dIn, dOut) < 0.05 * RAD) continue;
    Q.push(P[i]); R.push(Number(rayons.length > i ? rayons[i] : rayons[rayons.length - 1]));
  }
  Q.push(P[P.length - 1]); R.push(null);
  const elements = [];
  let debut = Q[0], Tprec = 0;
  for (let i = 1; i < Q.length - 1; i++) {
    const dIn = unit(sub(Q[i], Q[i - 1])), dOut = unit(sub(Q[i + 1], Q[i]));
    const { c, T } = cintreEntre(dIn, dOut, Q[i], R[i]);
    const seg = norm(sub(Q[i], Q[i - 1]));
    if (seg - T - Tprec < -0.01) alertes.push(`Les cintres se chevauchent avant le sommet ${i} (droite négative)`);
    elements.push(new Droite(debut, c.p0)); elements.push(c);
    debut = c.p1; Tprec = T;
  }
  elements.push(new Droite(debut, Q[Q.length - 1]));
  return new Tube(nom, normaliser(elements), diametre, epaisseur, matiere, alertes);
}

function orienterArcs(elems) {
  const resolu = elems.map((e) => e instanceof Droite);
  const candidats = (c) => [c, new Cintre(c.p0, c.p1, c.centre, neg(c.axe), 2 * Math.PI - c.angle, c.rayon)];
  const dirSortie = (e) => (e instanceof Cintre ? e.tSortie : e.direction);
  const dirEntree = (e) => (e instanceof Cintre ? e.tEntree : e.direction);
  for (let it = 0; it <= elems.length; it++) {
    let change = false;
    elems.forEach((e, k) => {
      if (resolu[k]) return;
      let meilleur = null, score = null;
      for (const cand of candidats(e)) {
        const sc = [];
        if (k > 0 && resolu[k - 1]) sc.push(angleEntre(dirSortie(elems[k - 1]), cand.tEntree));
        if (k + 1 < elems.length && resolu[k + 1]) sc.push(angleEntre(cand.tSortie, dirEntree(elems[k + 1])));
        if (!sc.length) continue;
        const v = Math.max(...sc);
        if (score === null || v < score) { meilleur = cand; score = v; }
      }
      if (meilleur) { elems[k] = meilleur; resolu[k] = true; change = true; }
    });
    if (!change) break;
  }
  elems.forEach((e, k) => { if (!resolu[k] && e.angle > Math.PI) elems[k] = candidats(e)[1]; });
}

/** segments : [{type:'ligne', p0, p1} | {type:'arc', p0, p1, centre, normale, rayon}] ordonnés et orientés. */
export function tubeDepuisSegments(nom, segments, diametre = 48.3, epaisseur = 2.0, matiere = "Acier", rayonDefaut = null) {
  const alertes = [], elems = [];
  for (const s of segments) {
    const p0 = s.p0.map(Number), p1 = s.p1.map(Number);
    if (s.type === "ligne") {
      if (norm(sub(p1, p0)) > TOL) elems.push(new Droite(p0, p1));
    } else {
      const c = s.centre.map(Number), n = unit(s.normale.map(Number));
      const r0 = sub(p0, c), r1 = sub(p1, c);
      const R = Number(s.rayon) || norm(r0);
      let ang = Math.atan2(dot(cross(r0, r1), n), dot(r0, r1));
      if (ang <= 1e-9) ang += 2 * Math.PI;
      elems.push(new Cintre(p0, p1, c, n, ang, R));
    }
  }
  orienterArcs(elems);
  const out = [];
  for (const e of elems) {
    const prev = out[out.length - 1];
    if (prev && e instanceof Droite && prev instanceof Droite) {
      const a = angleEntre(prev.direction, e.direction);
      if (a > TOL_TANGENCE) {
        if (rayonDefaut == null) {
          alertes.push(`Angle vif de ${(a * DEG).toFixed(1)}° sans rayon`);
          out.push(e); continue;
        }
        const { c, T } = cintreEntre(prev.direction, e.direction, prev.p1, rayonDefaut);
        if (T > prev.longueur || T > e.longueur) alertes.push("Droite trop courte pour ajouter le rayon de cintrage");
        out[out.length - 1] = new Droite(prev.p0, c.p0);
        out.push(c); out.push(new Droite(c.p1, e.p1));
        alertes.push(`Angle vif de ${(a * DEG).toFixed(1)}° : rayon ${rayonDefaut} ajouté`);
        continue;
      }
    }
    out.push(e);
  }
  for (let k = 0; k + 1 < out.length; k++) {
    const a = out[k], b = out[k + 1];
    const ta = a instanceof Cintre ? a.tSortie : a.direction;
    const tb = b instanceof Cintre ? b.tEntree : b.direction;
    if (angleEntre(ta, tb) > TOL_TANGENCE) alertes.push(`Raccord non tangent (${(angleEntre(ta, tb) * DEG).toFixed(1)}°)`);
  }
  return new Tube(nom, normaliser(out), diametre, epaisseur, matiere, alertes);
}

export { perpendiculaire };
