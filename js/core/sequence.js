// Calcul du programme de cintrage pour l'opérateur (Y, B, angle, compensation).
//
// Repère machine (vu depuis le pupitre) : X sens d'avance du tube, origine au point de tangence,
// Y côté où part le cintre (opposé à l'opérateur), Z vers le haut. Cintrage autour d'un axe
// vertical passant par (0, R, 0). L'extrémité AVANT entre la première dans l'outil, l'extrémité
// ARRIÈRE est serrée dans la pince du chariot.
import { sub, mul, dot, cross, unit, rot, mv, neg, perpendiculaire, DEG, RAD, copy } from "./vec.js";
import { outilPour, etalonnagePour, retour } from "./parametres.js";

export const ERREUR = "erreur", ALERTE = "alerte", INFO = "info";

export class Message {
  constructor(niveau, texte, pli = null) { this.niveau = niveau; this.texte = texte; this.pli = pli; }
  toString() { return (this.pli ? `Pli ${this.pli} : ` : "") + this.texte; }
}

const pmod = (a, n) => ((a % n) + n) % n;
const fmt1 = (x) => x.toFixed(1);
const g = (x) => String(+Number(x).toPrecision(6));    // équivalent du format « :g »

// ----------------------------------------------------------------------
// Soudure
// ----------------------------------------------------------------------
/** Vecteur radial de la soudure sur chaque droite (repère CAO). psi = 0 : côté de l'axe du dernier pli. */
export function vecteursSoudure(tube, psiDeg) {
  const ds = tube.droites, cs = tube.cintres;
  const tm = ds[ds.length - 1].direction;
  let ref;
  if (cs.length) { const a = cs[cs.length - 1].axe; ref = unit(sub(a, mul(tm, dot(a, tm)))); }
  else ref = perpendiculaire(tm);
  let r = mv(rot(tm, psiDeg * RAD), ref);
  const vecs = new Array(ds.length);
  vecs[ds.length - 1] = r;
  for (let j = cs.length - 1; j >= 0; j--) { r = mv(rot(cs[j].axe, -cs[j].angle), r); vecs[j] = r; }
  return vecs;
}

export function scoreSoudure(tube, psiDeg) {
  const cs = tube.cintres;
  if (!cs.length) return [1, 1];
  const v = vecteursSoudure(tube, psiDeg);
  const vals = cs.map((c, j) => Math.abs(dot(v[j + 1], c.axe)));
  return [Math.min(...vals), vals.reduce((a, b) => a + b, 0) / vals.length];
}

function wrap180(a) {
  a = pmod(a + 180, 360) - 180;
  return a === -180 ? 180 : a;
}

function repereAvantPli(c) {
  const w = c.tEntree.map((x) => -x), n = neg(c.axe);
  return [w, cross(n, w), n];
}

export function valeursB(tube, psiDeg, sensB) {
  const vecs = vecteursSoudure(tube, psiDeg);
  let Bprec = 0; const out = [];
  tube.cintres.forEach((c, i) => {
    const r = mv(repereAvantPli(c), vecs[i]);
    let B = -sensB * Math.atan2(-r[1], r[2]) * DEG;
    B = Bprec + wrap180(B - Bprec);
    out.push(B); Bprec = B;
  });
  return out;
}

/** Soudure la plus éloignée de l'extrados/intrados ; à qualité égale, le moins de rotation. */
export function soudureOptimale(tube, sensB = 1) {
  const scores = [];
  for (let psi = 0; psi < 360; psi++) scores.push(scoreSoudure(tube, psi));
  let best = scores[0];
  for (const s of scores) if (s[0] > best[0] || (s[0] === best[0] && s[1] > best[1])) best = s;
  const cands = [];
  scores.forEach((s, psi) => { if (s[0] >= best[0] - 1e-3 && s[1] >= best[1] - 0.01) cands.push(psi); });
  const rotTot = (psi) => {
    const b = [0, ...valeursB(tube, psi, sensB)];
    let t = 0; for (let k = 1; k < b.length; k++) t += Math.abs(b[k] - b[k - 1]);
    return Math.round(t * 10) / 10;
  };
  let psiMin = cands[0], rMin = rotTot(cands[0]);
  for (const p of cands.slice(1)) { const r = rotTot(p); if (r < rMin) { rMin = r; psiMin = p; } }
  return { psi: psiMin, score: scores[psiMin][0] };
}

// ----------------------------------------------------------------------
/** Valeur lue sur l'afficheur B : il repart à 0 au-delà de 360°. */
export function affichageB(B) {
  const v = pmod(B, 360);
  return v > 359.95 ? 0 : v;
}

/** Sens dans lequel l'opérateur tourne le tube (vu du chariot vers l'outil). */
export function sensRotation(dB, sensB) {
  if (Math.abs(dB) < 0.05) return "—";
  const horaire = (dB > 0) === (sensB === -1);
  return `${horaire ? "↻ horaire" : "↺ antihoraire"} ${Math.abs(dB).toFixed(1).replace(".", ",")}°`;
}

// ----------------------------------------------------------------------
export function calculer(tubeCao, machine, inverse = false, psi = null) {
  const tube = inverse ? tubeCao.inverse() : tubeCao;
  const msgs = [];
  const ds = tube.droites, cs = tube.cintres, m = cs.length;

  const rayons = [...new Set(cs.map((c) => Math.round(c.rayon * 10) / 10))].sort((a, b) => a - b);
  let outil = null;
  if (rayons.length > 1) msgs.push(new Message(ERREUR, "Plusieurs rayons de cintrage dans le même tube : " + rayons.map((r) => `R${g(r)}`).join(", ")));
  if (cs.length) {
    outil = outilPour(machine, tube.diametre, cs[0].rayon);
    if (!outil) msgs.push(new Message(ERREUR, `Aucun outillage pour Ø${g(tube.diametre)} R${g(cs[0].rayon)} (à ajouter dans les paramètres)`));
  } else outil = outilPour(machine, tube.diametre, null);
  if (tube.diametre > machine.diametre_max)
    msgs.push(new Message(ERREUR, `Ø${g(tube.diametre)} supérieur à la capacité avec mandrin (Ø${g(machine.diametre_max)})`));
  for (const r of rayons) {
    if (r > machine.rayon_max) msgs.push(new Message(ERREUR, `Rayon R${g(r)} supérieur au maximum machine (R${g(machine.rayon_max)})`));
    if (r < 2 * tube.diametre - 0.1) msgs.push(new Message(ALERTE, `Rayon R${g(r)} < 2 × Ø : efface-plis nécessaire`));
  }
  const etal = etalonnagePour(machine, outil ? outil.nom : "", tube.matiere);
  const droiteMini = outil ? outil.droite_mini : 150;

  const auto = psi == null;
  let sc;
  if (auto) ({ psi, score: sc } = soudureOptimale(tube, machine.sens_B));
  else sc = scoreSoudure(tube, psi)[0];
  const vecs = vecteursSoudure(tube, psi);
  if (cs.length && sc < 0.5) msgs.push(new Message(ALERTE, `Soudure proche de l'extrados ou de l'intrados sur au moins un pli (score ${sc.toFixed(2)})`));

  let ef = 0, er = 0;
  if (cs.length) {
    if (ds[0].longueur < droiteMini - 0.01) {
      const manque = droiteMini - ds[0].longueur;
      if (machine.surlongueur_auto) {
        ef = Math.ceil(manque);
        msgs.push(new Message(ALERTE, `Droite avant ${fmt1(ds[0].longueur)} < ${g(droiteMini)} mm (mors) : surlongueur avant de ${g(ef)} mm à recouper après cintrage`, 1));
      } else msgs.push(new Message(ERREUR, `Droite avant trop courte pour le mors (${fmt1(ds[0].longueur)} mm)`, 1));
    }
    for (let i = 1; i < m; i++) {
      const L = ds[i].longueur;
      if (L < droiteMini - 0.01) msgs.push(new Message(ERREUR, `Droite de ${fmt1(L)} mm entre les plis ${i} et ${i + 1} : inférieure au mors (${g(droiteMini)} mm)`, i + 1));
    }
    const dl = ds[ds.length - 1].longueur;
    if (dl < machine.droite_arriere_mini - 0.01) {
      if (machine.surlongueur_auto) {
        er = Math.ceil(machine.droite_arriere_mini - dl);
        msgs.push(new Message(ALERTE, `Il resterait ${fmt1(dl)} mm après le dernier pli (< ${g(machine.droite_arriere_mini)} mm, le chariot taperait dans l'outil) : surlongueur arrière de ${g(er)} mm à recouper`, m));
      } else msgs.push(new Message(ERREUR, `Il resterait ${fmt1(dl)} mm après le dernier pli (< ${g(machine.droite_arriere_mini)} mm) : le chariot taperait dans l'outil`, m));
    }
  }
  if (m > 30) msgs.push(new Message(ALERTE, `${m} plis : plus de 30 lignes, le programme commande sera découpé`));
  const k = etal.coef_arc;
  const Lbrut = ef + ds.reduce((s, d) => s + d.longueur, 0) + cs.reduce((s, c) => s + k * c.longueur, 0) + er;

  const prog = {
    tube, tubeCao, inverse, psi, soudureAuto: auto, scoreSoudure: sc, outil, etalonnage: etal, machine,
    surlongAvant: ef, surlongArriere: er, longueurDebit: Lbrut, K: Lbrut + machine.decalage_zero,
    etapes: [], messages: msgs, soudureVecs: vecs, coefArc: k,
    get erreurs() { return this.messages.filter((x) => x.niveau === ERREUR); },
    get alertes() { return this.messages.filter((x) => x.niveau === ALERTE); },
  };
  if (Lbrut > machine.longueur_max + 0.01)
    msgs.push(new Message(ERREUR, `Débit ${Lbrut.toFixed(0)} mm supérieur à la longueur maxi du banc (${g(machine.longueur_max)} mm, marque zéro → chariot reculé)`));

  let sBrut = ef + ds[0].longueur, sGeo = ds[0].longueur, Bprec = 0, YfinPrec = null;
  cs.forEach((c, idx) => {
    const i = idx + 1;
    const Q = repereAvantPli(c);
    const r = mv(Q, vecs[i - 1]);
    const phi = Math.atan2(-r[1], r[2]);
    const B = Bprec + wrap180(-machine.sens_B * phi * DEG - Bprec);
    const d = Lbrut - sBrut;
    const Y = prog.K - d;
    const beta = c.angle * DEG;
    const alpha = retour(etal, beta);
    prog.etapes.push({
      numero: i, Y, B, beta, alpha, rayon: c.rayon, droiteAvant: ds[i - 1].longueur,
      avance: Y - (YfinPrec ?? 0), rotation: B - Bprec, d, Q, TP: copy(c.p0), sGeo, phi,
      preExtraction: outil ? outil.pre_extraction : 0, vitesse: outil ? outil.vitesse : 100,
    });
    if (beta + alpha > machine.angle_max + 1e-6) msgs.push(new Message(ERREUR, `β + α = ${fmt1(beta + alpha)}° dépasse ${g(machine.angle_max)}°`, i));
    if (alpha > machine.retour_max + 1e-6) msgs.push(new Message(ERREUR, `Retour élastique ${fmt1(alpha)}° > ${g(machine.retour_max)}°`, i));
    Bprec = B;
    YfinPrec = Y + k * c.longueur;
    sBrut += k * c.longueur + ds[i].longueur;
    sGeo += c.longueur + ds[i].longueur;
  });
  return prog;
}
