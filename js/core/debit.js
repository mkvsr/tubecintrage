// Liste de débit, regroupement des tubes identiques et plan de coupe des barres.
import { roundPy } from "./vec.js";

export function signature(tube, tolL = 0.5, tolA = 0.2) {
  const sig = ({ lignes, fin }) => {
    const r = (x) => { if (Math.abs(Math.abs(x) - 180) < tolA) x = 180; return roundPy(x / (5 * tolA)); };
    return lignes.map((l) => [roundPy(l.L / tolL), roundPy(l.A / tolA), r(l.R), roundPy(l.rayon)].join(","))
      .join(";") + "|" + roundPy(fin / tolL);
  };
  const a = sig(tube.lra()), b = sig(tube.inverse().lra());
  return [Math.round(tube.diametre * 10) / 10, Math.round(tube.epaisseur * 100) / 100,
    (tube.matiere || "").trim().toLowerCase(), a < b ? a : b].join("#");
}

/** Fusionne les tubes identiques (géométrie, même retournée, section et matière). */
export function regrouper(tubes) {
  const groupes = new Map();
  for (const t of tubes) {
    const s = signature(t), srcs = t.sources.length ? t.sources : [t.nom];
    if (groupes.has(s)) {
      const g = groupes.get(s);
      g.quantite += t.quantite;
      for (const x of srcs) if (!g.sources.includes(x)) g.sources.push(x);
    } else groupes.set(s, t.copie({ quantite: t.quantite, sources: [...srcs] }));
  }
  return [...groupes.values()];
}

export function numeroter(tubes, prefixe = "T") {
  const n = Math.max(2, String(tubes.length).length);
  tubes.forEach((t, k) => { t.repere = prefixe + String(k + 1).padStart(n, "0"); });
  return tubes;
}

/** pieces : [{repere, longueur, quantite}]. Meilleur ajustement décroissant. */
export function planDeCoupe(pieces, longueurBarre = 6000, trait = 3) {
  const liste = [];
  for (const p of pieces) for (let q = 0; q < p.quantite; q++) liste.push({ repere: p.repere, longueur: p.longueur });
  liste.sort((a, b) => b.longueur - a.longueur);
  const barres = [], tropLongues = [];
  const reste = (b) => b.longueur - b.coupes.reduce((s, c) => s + c.longueur, 0) - trait * b.coupes.length;
  for (const p of liste) {
    if (p.longueur > longueurBarre) { tropLongues.push(p); continue; }
    let best = null, bestR = Infinity;
    for (const b of barres) { const r = reste(b) - p.longueur; if (r >= -1e-6 && r < bestR) { best = b; bestR = r; } }
    if (best) best.coupes.push(p); else barres.push({ longueur: longueurBarre, coupes: [p], chute: 0 });
  }
  for (const b of barres) b.chute = reste(b);
  barres.sort((a, b) => a.chute - b.chute);
  return { barres, tropLongues };
}
