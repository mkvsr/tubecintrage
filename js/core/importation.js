// Import des tubes depuis le texte d'un fichier : JSON de la macro SolidWorks, points (CSV/TXT), lot (.tclot).
// L'import STEP est dans step.js (chargé à la demande).
import { sub, cross, unit, norm, neg, angleEntre } from "./vec.js";
import { tubeDepuisSegments, tubeDepuisPoints, TOL_POINT, TOL_TANGENCE, Droite } from "./geometrie.js";

export class ErreurImport extends Error {}

function dirExtremite(seg, enP0) {
  const p0 = seg.p0, p1 = seg.p1;
  if (seg.type === "ligne") return enP0 ? unit(sub(p1, p0)) : unit(sub(p0, p1));
  const c = seg.centre, n = unit(seg.normale);
  return enP0 ? unit(cross(n, sub(p0, c))) : neg(unit(cross(n, sub(p1, c))));
}

export function inverserSegment(seg) {
  const s = { ...seg, p0: seg.p1, p1: seg.p0 };
  if (seg.type === "arc") s.normale = seg.normale.map((v) => -v);
  return s;
}

/** Regroupe des segments en chaînes continues (une chaîne = un tube). */
export function chainer(segments, couperAnglesVifs = true, tol = TOL_POINT) {
  const noeuds = [];
  const noeud = (p) => {
    for (let k = 0; k < noeuds.length; k++) if (norm(sub(p, noeuds[k])) < tol) return k;
    noeuds.push(p); return noeuds.length - 1;
  };
  const aretes = [];
  for (const s of segments) {
    const a = noeud(s.p0), b = noeud(s.p1);
    if (a !== b) aretes.push([a, b, s]);
  }
  const adj = new Map();
  aretes.forEach(([a, b], k) => {
    if (!adj.has(a)) adj.set(a, []); adj.get(a).push(k);
    if (!adj.has(b)) adj.set(b, []); adj.get(b).push(k);
  });
  const continueIci = (n, kEntree) => {
    const ks = adj.get(n) || [];
    if (ks.length !== 2) return null;
    const k2 = ks.find((k) => k !== kEntree);
    if (couperAnglesVifs) {
      const [a, , s1] = aretes[kEntree], [a2, , s2] = aretes[k2];
      const d1 = neg(dirExtremite(s1, a === n)), d2 = dirExtremite(s2, a2 === n);
      let ang = angleEntre(d1, d2);
      if (s1.type === "arc" || s2.type === "arc") ang = Math.min(ang, Math.PI - ang);
      if (ang > TOL_TANGENCE) return null;
    }
    return k2;
  };
  const utilise = new Set(), chaines = [];
  const parcourir = (k0, depart) => {
    const chaine = [];
    let k = k0, n = depart;
    while (k != null && !utilise.has(k)) {
      utilise.add(k);
      const [a, b, s] = aretes[k];
      if (a === n) { chaine.push(s); n = b; } else { chaine.push(inverserSegment(s)); n = a; }
      k = continueIci(n, k);
    }
    return chaine;
  };
  for (const [n, ks] of adj) {
    for (const k of ks) {
      if (utilise.has(k)) continue;
      const autre = ks.filter((kk) => kk !== k);
      if (ks.length === 2 && continueIci(n, autre[0]) === k) continue;
      chaines.push(parcourir(k, n));
    }
  }
  aretes.forEach((ar, k) => { if (!utilise.has(k)) chaines.push(parcourir(k, ar[0])); });
  return chaines;
}

const versNombres = (s) => ({ ...s, p0: s.p0.map(Number), p1: s.p1.map(Number),
  ...(s.type === "arc" ? { centre: s.centre.map(Number), normale: s.normale.map(Number) } : {}) });

export function chargerJson(texte, nomFichier = "", couperAnglesVifs = true, rayonDefaut = null) {
  const d = JSON.parse(texte.replace(/^﻿/, ""));
  if (!d.esquisses) throw new ErreurImport("Fichier JSON non reconnu (clé 'esquisses' absente)");
  const D = Number(d.diametre) || 48.3, ep = Number(d.epaisseur) || 2.0, mat = d.matiere || "Acier";
  const piece = d.piece || nomFichier.replace(/\.[^.]+$/, "");
  const tubes = [], rapport = [];
  for (const esq of d.esquisses) {
    const segs = (esq.segments || []).map(versNombres);
    if (segs.length && segs.every((sg) => norm(sub(sg.p1, sg.p0)) < 1e-9 && !sg.p0.some((v) => v)))
      throw new ErreurImport(`Esquisse « ${esq.nom} » : toutes les coordonnées exportées sont nulles.\n`
        + "Le fichier a été produit par une ancienne version de la macro : réimportez ExportTubes.bas (version 0.1.1) puis relancez l'export.");
    for (const w of esq.ignores || []) rapport.push(`${esq.nom} : ${w}`);
    const chaines = chainer(segs, couperAnglesVifs);
    chaines.forEach((ch, j) => {
      let nom = `${piece} – ${esq.nom || "Esquisse"}`;
      if (chaines.length > 1) nom += ` – T${j + 1}`;
      try {
        const t = tubeDepuisSegments(nom, ch, D, ep, mat, rayonDefaut);
        if (t.longueur >= 1) tubes.push(t);
      } catch (e) { rapport.push(`${nom} : ${e.message}`); }
    });
  }
  return { tubes, rapport };
}

const nombre = (x) => {
  const v = Number(String(x).trim().replace(",", "."));
  if (!Number.isFinite(v) || String(x).trim() === "") throw new Error("nombre");
  return v;
};

/** Une ligne par point « x;y;z » ou « x;y;z;rayon ». Séparateurs ; tabulation ou espaces. */
export function chargerPoints(texte, nomFichier = "points", rayonDefaut = 145, diametre = 48.3, epaisseur = 2.0, matiere = "Acier") {
  const pts = [], rayons = [];
  for (let ligne of texte.replace(/^﻿/, "").split(/\r?\n/)) {
    ligne = ligne.trim();
    if (!ligne || ligne.startsWith("#")) continue;
    let champs;
    if (ligne.includes(";")) champs = ligne.split(";");
    else if (ligne.includes("\t")) champs = ligne.split("\t");
    else champs = ligne.replace(/,/g, ".").split(/\s+/);
    let v;
    try { v = champs.filter((c) => c.trim()).map(nombre); } catch { continue; }
    if (v.length < 3) continue;
    pts.push(v.slice(0, 3)); rayons.push(v.length > 3 ? v[3] : rayonDefaut);
  }
  if (pts.length < 2) throw new ErreurImport("Moins de deux points lus dans le fichier");
  return { tubes: [tubeDepuisPoints(nomFichier.replace(/\.[^.]+$/, ""), pts, rayons, diametre, epaisseur, matiere)], rapport: [] };
}

// ----------------------------------------------------------------------
// Lot (.tclot) : même format que la version Python
export const FORMAT_LOT = "tubecintrage-lot/1";

function segmentsDe(tube) {
  const out = [];
  for (const e of tube.elements) {
    if (e instanceof Droite) { if (e.longueur > 1e-9) out.push({ type: "ligne", p0: e.p0, p1: e.p1 }); }
    else out.push({ type: "arc", p0: e.p0, p1: e.p1, centre: e.centre, normale: e.axe, rayon: e.rayon });
  }
  return out;
}

export function lotVersTexte(tubes, nom = "") {
  return JSON.stringify({
    format: FORMAT_LOT, nom,
    tubes: tubes.map((t) => ({ nom: t.nom, repere: t.repere, quantite: t.quantite, diametre: t.diametre,
      epaisseur: t.epaisseur, matiere: t.matiere, sources: t.sources, reglages: t.reglages, segments: segmentsDe(t) })),
  }, null, 1);
}

export function chargerLot(texte) {
  const d = JSON.parse(texte.replace(/^﻿/, ""));
  if (d.format !== FORMAT_LOT) throw new ErreurImport("Ce fichier n'est pas un lot TubeCintrage");
  const tubes = [], rapport = [];
  for (const x of d.tubes) {
    try {
      const t = tubeDepuisSegments(x.nom, x.segments.map(versNombres), x.diametre, x.epaisseur, x.matiere);
      t.quantite = Number(x.quantite ?? 1); t.sources = [...(x.sources || [])];
      t.reglages = { ...(x.reglages || {}) }; t.repere = x.repere || "";
      tubes.push(t);
    } catch (e) { rapport.push(`${x.nom} : ${e.message}`); }
  }
  return { tubes, rapport, nom: d.nom || "" };
}

/** Choisit l'import selon l'extension. `contenu` : texte, ou ArrayBuffer pour un STEP. */
export async function chargerFichier(nomFichier, contenu, options = {}) {
  const ext = (nomFichier.match(/\.[^.]+$/) || [""])[0].toLowerCase();
  if (ext === ".tclot") return chargerLot(contenu);
  if (ext === ".step" || ext === ".stp") {
    const { chargerStep } = await import("./step.js");
    return chargerStep(contenu, nomFichier, options);
  }
  if (ext === ".json") return chargerJson(contenu, nomFichier, true, options.rayonDefaut ?? null);
  return chargerPoints(contenu, nomFichier, options.rayonDefaut ?? 145);
}
