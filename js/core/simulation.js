// Simulation du travail de l'opérateur : chargement, puis pour chaque ligne avance Y,
// rotation B et cintrage. Contrôle des collisions.
import { sub, add, mul, rot, mv, RAD, DEG } from "./vec.js";
import { Message, ERREUR, ALERTE, affichageB, calculer } from "./sequence.js";

export const PAS = 10;

/** État du tube : points de la fibre neutre (avant -> arrière), vecteur soudure, partie
 *  (0 = déjà cintré, 1 = pli en cours, 2 = droit non cintré). */
export class Etat {
  constructor(pts, soudure, partie) { this.pts = pts; this.soudure = soudure; this.partie = partie; }
  transforme(R = null, t = null) {
    let p = this.pts, s = this.soudure;
    if (R) { p = p.map((v) => mv(R, v)); s = s.map((v) => mv(R, v)); }
    if (t) p = p.map((v) => add(v, t));
    return new Etat(p, s, this.partie.slice());
  }
  get xArriere() { return this.pts[this.pts.length - 1][0]; }
}

const linspace = (a, b, n) => Array.from({ length: n }, (_, k) => (n === 1 ? a : a + ((b - a) * k) / (n - 1)));

export class Simulation {
  constructor(prog, pas = PAS) {
    this.prog = prog; this.pas = pas;
    const tube = prog.tube;
    let { pts, s, idx } = tube.echantillonner(pas);
    const vecs = prog.soudureVecs;
    const debut = []; let cumul = 0;
    for (const e of tube.elements) { debut.push(cumul); cumul += e.longueur; }
    let sv = pts.map((_, k) => {
      const ei = idx[k], e = tube.elements[ei];
      if (ei % 2 === 0) return vecs[ei / 2];
      return mv(rot(e.axe, (s[k] - debut[ei]) / e.rayon), vecs[(ei - 1) / 2]);
    });
    if (prog.surlongAvant > 0) {
      const t0 = tube.droites[0].direction, L = prog.surlongAvant;
      const n = Math.max(1, Math.ceil(L / pas));
      const ext = [], es = [];
      for (let j = 0; j < n; j++) { ext.push(sub(pts[0], mul(t0, (L * (n - j)) / n))); es.push((-L * (n - j)) / n); }
      pts = [...ext, ...pts]; sv = [...Array(n).fill(sv[0]), ...sv]; s = [...es, ...s];
    }
    this.cadPts = pts; this.cadS = s; this.cadSoudure = sv;
    this.K = prog.K; this.k = prog.coefArc;
  }

  _droite(longueur, sv) {
    const n = Math.max(1, Math.ceil(longueur / this.pas));
    const p = linspace(0, longueur, n + 1).map((x) => [-x, 0, 0]);
    return { p, s: p.map(() => sv) };
  }

  etatAvantPli(i) {
    const et = this.prog.etapes[i - 1];
    const P = [], S = [];
    this.cadS.forEach((sv, k) => {
      if (sv <= et.sGeo + 1e-6) { P.push(mv(et.Q, sub(this.cadPts[k], et.TP))); S.push(mv(et.Q, this.cadSoudure[k])); }
    });
    const svArr = mv(et.Q, this.prog.soudureVecs[i - 1]);
    const r = this._droite(et.d, svArr);
    return new Etat([...P, ...r.p.slice(1)], [...S, ...r.s.slice(1)],
      [...P.map(() => 0), ...r.p.slice(1).map(() => 2)]);
  }

  etatPendantPli(i, phi) {
    const et = this.prog.etapes[i - 1], R = et.rayon;
    const base = this.etatAvantPli(i);
    const nf = base.partie.filter((x) => x === 0).length;
    const Rz = rot([0, 0, 1], phi), c = [0, R, 0];
    const P = base.pts.slice(0, nf).map((v) => add(mv(Rz, sub(v, c)), c));
    const S = base.soudure.slice(0, nf).map((v) => mv(Rz, v));
    const svArr = mv(et.Q, this.prog.soudureVecs[i - 1]);
    const na = phi > 0 ? Math.max(1, Math.ceil((R * phi) / this.pas)) : 0;
    let A = [], SA = [];
    if (na) {
      const psis = linspace(phi, 0, na + 1).slice(1);
      A = psis.map((p) => [R * Math.sin(p), R * (1 - Math.cos(p)), 0]);
      SA = psis.map((p) => mv(rot([0, 0, 1], p), svArr));
    }
    const reste = Math.max(0, et.d - this.k * R * phi);
    let { p: Pr, s: Sr } = this._droite(reste, svArr);
    if (na) { Pr = Pr.slice(1); Sr = Sr.slice(1); }
    return new Etat([...P, ...A, ...Pr], [...S, ...SA, ...Sr],
      [...P.map(() => 0), ...A.map(() => 1), ...Pr.map(() => 2)]);
  }

  etatChargement() {
    const L = this.prog.longueurDebit;
    const { p, s } = this._droite(L, [0, 0, 1]);
    const xs = linspace(L, 0, p.length);
    return new Etat(p.map((v, k) => [xs[k] - this.K, 0, 0]), s, p.map(() => 2));
  }

  _Y(etat) { return this.K + etat.xArriere; }

  /** Séquence d'images : avance, rotation, cintrage pour chaque ligne. */
  images({ pasAngle = 5, pasRotation = 15, pasAvance = 250 } = {}) {
    const prog = this.prog, sB = prog.machine.sens_B, out = [];
    let etat = this.etatChargement(), B = 0;
    out.push({ titre: `Chargement : soudure ${prog.machine.position_soudure}, extrémité avant sur la marque zéro, zéros Y et B`,
      pli: 0, phase: "chargement", etat, Y: this._Y(etat), B: 0 });
    for (const et of prog.etapes) {
      const i = et.numero, L = String(i).padStart(2, "0");
      const av = et.Y - this._Y(etat);
      let n = Math.max(1, Math.ceil(Math.abs(av) / pasAvance));
      let base = etat;
      for (let j = 1; j <= n; j++) {
        const e2 = base.transforme(null, [(av * j) / n, 0, 0]);
        out.push({ titre: `Ligne ${L} : avance Y → ${et.Y.toFixed(1)}`, pli: i, phase: "avance", etat: e2, Y: this._Y(e2), B, beta: et.beta, alpha: et.alpha });
      }
      etat = out[out.length - 1].etat;
      const dB = et.B - B;
      n = Math.max(1, Math.ceil(Math.abs(dB) / pasRotation));
      base = etat;
      for (let j = 1; j <= n; j++) {
        const b = B + (dB * j) / n;
        const e2 = base.transforme(rot([1, 0, 0], -sB * (b - B) * RAD));
        out.push({ titre: `Ligne ${L} : rotation B → ${affichageB(et.B).toFixed(1)}°`, pli: i, phase: "rotation", etat: e2, Y: this._Y(e2), B: b, beta: et.beta, alpha: et.alpha });
      }
      B = et.B;
      etat = this.etatAvantPli(i);
      out[out.length - 1] = { titre: `Ligne ${L} : prêt — Y ${et.Y.toFixed(1)} / B ${affichageB(et.B).toFixed(1)}° — angle ${et.beta.toFixed(1)}°, compensation ${et.alpha.toFixed(1)}°`,
        pli: i, phase: "pret", etat, Y: et.Y, B, beta: et.beta, alpha: et.alpha };
      const th = et.beta * RAD;
      n = Math.max(2, Math.ceil(et.beta / pasAngle));
      for (let j = 1; j <= n; j++) {
        const phi = (th * j) / n;
        out.push({ titre: `Ligne ${L} : cintrage ${(phi * DEG).toFixed(0)}° / ${et.beta.toFixed(1)}°`, pli: i, phase: "cintrage",
          etat: this.etatPendantPli(i, phi), Y: et.Y + this.k * et.rayon * phi, B, beta: et.beta, alpha: et.alpha, angleEnCours: phi * DEG });
      }
      etat = out[out.length - 1].etat;
    }
    if (prog.etapes.length) out.push({ titre: "Terminé : ouvrir la pince et retirer le tube", pli: prog.etapes.length, phase: "fin", etat, Y: this._Y(etat), B });
    return out;
  }

  /** [{nom, gravite, indices}] */
  collisions(etat) {
    const m = this.prog.machine, r = this.prog.tube.diametre / 2 + m.marge_collision;
    const P = etat.pts, res = [];
    const sol = [];
    P.forEach((p, k) => { if (p[2] < -m.hauteur_axe_sol + r) sol.push(k); });
    if (sol.length) res.push({ nom: "Sol", gravite: "erreur", indices: sol });
    for (const o of m.obstacles) {
      if (!o.actif) continue;
      const dedans = [];
      P.forEach((p, k) => {
        if (p[0] > o.xmin - r && p[0] < o.xmax + r && p[1] > o.ymin - r && p[1] < o.ymax + r && p[2] > o.zmin - r && p[2] < o.zmax + r) dedans.push(k);
      });
      if (dedans.length) res.push({ nom: o.nom, gravite: o.gravite, indices: dedans });
    }
    return res;
  }
}

const NOMS_PHASE = { rotation: "pendant la rotation", avance: "pendant l'avance", pret: "avant le cintrage",
  cintrage: "pendant le cintrage", fin: "en fin de cycle", chargement: "au chargement" };

export function verifierCollisions(prog, pas = 20) {
  if (!prog.etapes.length) return [];
  const sim = new Simulation(prog, pas);
  const vus = new Set(), msgs = [];
  for (const im of sim.images({ pasAngle: 10, pasRotation: 20, pasAvance: 500 })) {
    for (const c of sim.collisions(im.etat)) {
      const cle = `${im.pli}|${im.phase === "pret" ? "avance" : im.phase}|${c.nom}`;
      if (vus.has(cle)) continue;
      vus.add(cle);
      let niveau = c.gravite === "erreur" ? ERREUR : ALERTE, nom = c.nom;
      const verbe = c.gravite !== "erreur" ? "passe dans" : "touche";
      if (niveau === ERREUR && nom !== "Sol" && !prog.machine.obstacles_mesures) { niveau = ALERTE; nom += " — dimensions estimées, à vérifier"; }
      msgs.push(new Message(niveau, `le tube ${verbe} : ${nom} (${NOMS_PHASE[im.phase] || im.phase})`, im.pli || null));
    }
  }
  return msgs;
}

function collisionRotation(sim, i, dB, pas = 10) {
  const sB = sim.prog.machine.sens_B;
  const base = sim.etatAvantPli(i).transforme(rot([1, 0, 0], sB * dB * RAD));
  const n = Math.max(2, Math.ceil(Math.abs(dB) / pas));
  for (let j = 1; j <= n; j++) {
    const e = base.transforme(rot([1, 0, 0], -sB * dB * j / n * RAD));
    if (sim.collisions(e).some((c) => c.gravite === "erreur")) return true;
  }
  return false;
}

/** Si une rotation B touche un obstacle, essaie l'autre sens (valeurs suivantes décalées de ±360°). */
export function optimiserSensRotation(prog) {
  if (!prog.etapes.length) return [];
  const sim = new Simulation(prog, 25);
  const notes = [];
  let Bprec = 0;
  for (const et of prog.etapes) {
    const dB = et.B - Bprec;
    if (Math.abs(dB) > 1e-6 && collisionRotation(sim, et.numero, dB)) {
      const alt = dB - Math.sign(dB) * 360;
      if (!collisionRotation(sim, et.numero, alt)) {
        const decal = alt - dB;
        for (const e2 of prog.etapes.slice(et.numero - 1)) e2.B += decal;
        notes.push(new Message(ALERTE, `rotation dans l'autre sens (${alt >= 0 ? "+" : ""}${alt.toFixed(1)}°) pour éviter un obstacle`, et.numero));
      }
    }
    Bprec = et.B;
  }
  prog.etapes.forEach((b, k) => { b.rotation = b.B - (k ? prog.etapes[k - 1].B : 0); });
  return notes;
}

/** Choisit le sens de passage (extrémité serrée dans la pince) s'il n'est pas imposé. */
export function calculerAuto(tubeCao, machine, inverse = null, psi = null, verifier = true) {
  const options = inverse == null ? [false, true] : [inverse];
  const res = options.map((inv) => {
    const p = calculer(tubeCao, machine, inv, psi);
    if (verifier) { p.messages.push(...optimiserSensRotation(p)); p.messages.push(...verifierCollisions(p)); }
    const cle = [p.erreurs.length, p.alertes.length, p.surlongAvant + p.surlongArriere, -Math.round(p.scoreSoudure * 1000) / 1000, inv ? 1 : 0];
    return { cle, p };
  });
  res.sort((a, b) => { for (let k = 0; k < a.cle.length; k++) if (a.cle[k] !== b.cle[k]) return a.cle[k] - b.cle[k]; return 0; });
  return res[0].p;
}
