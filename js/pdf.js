// Dossier de travail PDF (jsPDF) : débit + plan de coupe, puis une fiche et une page de simulation par tube.
import { ERREUR, ALERTE, affichageB, sensRotation } from "./core/sequence.js";
import { Simulation } from "./core/simulation.js";
import { planDeCoupe } from "./core/debit.js";
import { aVerifier } from "./core/parametres.js";
import { imagePiece, imageEtat } from "./vue3d.js";

const BLEU = "#1f3b57", GRIS = "#5d6d7e", CLAIR = "#eef2f6", ROUGE = "#b03a2e", JAUNE_TXT = "#9a6a00", TRAIT = "#c5ced8";
const JAUNE = "#f2c14e", ROUGE_B = "#d62728";
const L = 210, H = 297, MG = 15, LU = L - 2 * MG;

export const f1 = (v, n = 1) => (Math.abs(v) < 0.5 * 10 ** -n ? 0 : Number(v)).toFixed(n).replace(".", ",");
const g = (x) => String(+Number(x).toPrecision(6)).replace(".", ",");
const rep = (t) => t.repere || t.nom;
const dateFr = () => new Date().toLocaleDateString("fr-FR");

// ----------------------------------------------------------------------
let _polices = null;
async function polices() {
  if (_polices) return _polices;
  if (globalThis.TC_EMBARQUE?.polices) return (_polices = globalThis.TC_EMBARQUE.polices);
  const b64 = async (url) => {
    const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
    let s = ""; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const base = new URL("../vendor/fonts/", import.meta.url).href;
  _polices = { n: await b64(base + "DejaVuSans.ttf"), b: await b64(base + "DejaVuSans-Bold.ttf") };
  return _polices;
}

class Doc {
  constructor(jsPDF, fontes) {
    this.d = new jsPDF({ unit: "mm", format: "a4", compress: true });
    this.d.addFileToVFS("DV.ttf", fontes.n); this.d.addFont("DV.ttf", "DV", "normal");
    this.d.addFileToVFS("DVB.ttf", fontes.b); this.d.addFont("DVB.ttf", "DV", "bold");
    this.d.setProperties({ title: "Dossier de cintrage", creator: "TubeCintrage" });
    this.y = MG; this.page = 1;
    this.police(9);
  }
  police(taille, gras = false, couleur = "#000000") { this.d.setFont("DV", gras ? "bold" : "normal"); this.d.setFontSize(taille); this.d.setTextColor(couleur); }
  nouvellePage() { this.d.addPage(); this.page++; this.y = 12; }
  reste() { return H - 16 - this.y; }
  besoin(h) { if (this.reste() < h) this.nouvellePage(); }
  texte(t, x, y, o = {}) { this.d.text(t, x, y, o); }
  /** Paragraphe avec retour à la ligne ; renvoie la hauteur. */
  para(t, x, y, largeur, taille = 9, gras = false, couleur = "#000000", interligne = 1.3) {
    this.police(taille, gras, couleur);
    const lignes = this.d.splitTextToSize(t, largeur);
    const h = taille * 0.3528 * interligne;
    lignes.forEach((l, k) => this.d.text(l, x, y + k * h, { baseline: "top" }));
    return lignes.length * h;
  }
  rect(x, y, w, h, fond = null, trait = null, ep = 0.3, r = 0) {
    if (fond) this.d.setFillColor(fond);
    if (trait) { this.d.setDrawColor(trait); this.d.setLineWidth(ep); }
    const style = fond && trait ? "FD" : fond ? "F" : "S";
    if (r) this.d.roundedRect(x, y, w, h, r, r, style); else this.d.rect(x, y, w, h, style);
  }
  entete(titre, sous, soustitre2 = null) {
    const h = soustitre2 ? 21 : 16;
    this.rect(MG, this.y, LU, h, BLEU);
    let tp = 14;
    this.police(tp, true, "#ffffff");
    while (tp > 9 && this.d.getTextWidth(titre) > LU - 8) { tp -= 0.5; this.police(tp, true, "#ffffff"); }
    this.texte(titre, MG + 4, this.y + 6.5);
    this.police(8.5, false, "#ffffff"); this.texte(sous, MG + 4, this.y + 12, { maxWidth: LU - 8 });
    if (soustitre2) { this.police(7.5, false, "#dbe4ee"); this.texte(soustitre2, MG + 4, this.y + 17, { maxWidth: LU - 8 }); }
    this.y += h + 4;
  }
  titre2(t) { this.besoin(12); this.police(11, true, BLEU); this.texte(t, MG, this.y + 4); this.y += 7; }
  pieds() {
    const n = this.d.getNumberOfPages();
    for (let p = 1; p <= n; p++) {
      this.d.setPage(p); this.police(7, false, GRIS);
      this.texte("TubeCintrage — fiche générée automatiquement, vérifier la première pièce", MG, H - 8);
      this.texte(`page ${p} / ${n}`, L - MG, H - 8, { align: "right" });
    }
  }

  /** Tableau simple. cols : [{t, w, align, taille, gras, couleur, fond}] ; lignes : tableaux de textes (ou {t, couleur, gras}). */
  tableau(cols, lignes, { x = MG, entete = BLEU, enteteTexte = "#ffffff", hl = 7, zebra = true, taille = 9, bordure = BLEU } = {}) {
    const W = cols.reduce((s, c) => s + c.w, 0);
    const dessinerEntete = () => {
      this.rect(x, this.y, W, 6.5, entete);
      let cx = x;
      for (const c of cols) {
        this.police(7.8, true, enteteTexte);
        this.texte(c.t, c.align === "left" ? cx + 1.8 : cx + c.w / 2, this.y + 4.3, { align: c.align === "left" ? "left" : "center", maxWidth: c.w - 2 });
        cx += c.w;
      }
      this.y += 6.5;
    };
    this.besoin(6.5 + hl * Math.min(lignes.length, 3));
    let y0 = this.y; dessinerEntete();
    lignes.forEach((l, k) => {
      // hauteur de la ligne : texte multiligne éventuel
      let h = hl;
      const cellules = l.map((v, j) => {
        const o = typeof v === "object" && v !== null ? v : { t: String(v) };
        const c = cols[j];
        this.police(o.taille || c.taille || taille, o.gras ?? c.gras ?? false);
        const lignesTxt = c.retour ? this.d.splitTextToSize(o.t, c.w - 3) : [o.t];
        const lh = (o.taille || c.taille || taille) * 0.3528 * 1.25;
        let sousL = [];
        if (o.sous) { this.police(6.5); sousL = this.d.splitTextToSize(o.sous, c.w - 3); }
        h = Math.max(h, lignesTxt.length * lh + sousL.length * 2.8 + 3);
        return { o, c, lignesTxt, lh, sousL };
      });
      if (this.reste() < h) {
        this.rect(x, y0, W, this.y - y0, null, bordure, 0.5);
        this.nouvellePage(); y0 = this.y; dessinerEntete();
      }
      if (zebra && k % 2) this.rect(x, this.y, W, h, CLAIR);
      let cx = x;
      for (const { o, c, lignesTxt, lh, sousL } of cellules) {
        if (o.fond) this.rect(cx, this.y, c.w, h, o.fond);
        this.police(o.taille || c.taille || taille, o.gras ?? c.gras ?? false, o.couleur || c.couleur || "#000000");
        const total = lignesTxt.length * lh + sousL.length * 2.8;
        let ty = this.y + (h - total) / 2 + lh * 0.78;
        for (const lt of lignesTxt) {
          this.texte(lt, c.align === "left" ? cx + 1.8 : cx + c.w / 2, ty, { align: c.align === "left" ? "left" : "center" });
          ty += lh;
        }
        this.police(6.5, false, GRIS);
        sousL.forEach((sl, i) => this.texte(sl, c.align === "left" ? cx + 1.8 : cx + c.w / 2, ty - lh * 0.25 + 1.6 + i * 2.8, { align: c.align === "left" ? "left" : "center" }));
        cx += c.w;
      }
      this.d.setDrawColor(TRAIT); this.d.setLineWidth(0.2);
      this.d.line(x, this.y + h, x + W, this.y + h);
      this.y += h;
    });
    // traits verticaux
    this.d.setDrawColor(TRAIT); this.d.setLineWidth(0.2);
    this.rect(x, y0, W, this.y - y0, null, bordure, 0.5);
    return W;
  }
}

// ----------------------------------------------------------------------
// Afficheur 7 segments (style de l'afficheur de la machine)
const SEG = { "0": "abcdef", "1": "bc", "2": "abged", "3": "abgcd", "4": "fgbc", "5": "afgcd", "6": "afgedc",
  "7": "abc", "8": "abcdefg", "9": "abcdfg", "-": "g", " ": "" };

function chiffre7(doc, x, y, h, c, allume, eteint) {
  const w = h * 0.52, e = h * 0.11, inc = h * 0.1;      // inclinaison vers la droite
  const P = (u, v) => [x + u * w + (1 - v) * inc, y + v * h];  // u: 0..1 gauche→droite, v: 0..1 haut→bas
  const segs = { a: [P(0.12, 0), P(0.88, 0)], b: [P(1, 0.08), P(1, 0.44)], c: [P(1, 0.56), P(1, 0.92)],
    d: [P(0.12, 1), P(0.88, 1)], e: [P(0, 0.56), P(0, 0.92)], f: [P(0, 0.08), P(0, 0.44)], g: [P(0.12, 0.5), P(0.88, 0.5)] };
  const on = SEG[c] ?? "";
  doc.setLineCap("round"); doc.setLineWidth(e);
  for (const [k, [p0, p1]] of Object.entries(segs)) {
    doc.setDrawColor(on.includes(k) ? allume : eteint);
    doc.line(p0[0], p0[1], p1[0], p1[1]);
  }
  doc.setLineCap("butt");
  return w + h * 0.3;
}

/** Afficheur : cadre de couleur, lettre (Y ou B), fond noir, chiffres rouges. Renvoie la largeur. */
function afficheur(D, x, y, lettre, valeur, couleurCadre, { h = 11.5, nb = 6 } = {}) {
  const d = D.d, hc = h * 0.5;
  const largeurChiffres = nb * (hc * 0.52 + hc * 0.3) + hc * 0.3;
  const w = 8 + largeurChiffres + 3;
  D.rect(x, y, w, h, "#000000", couleurCadre, 1.1, 1.4);
  D.rect(x + 1.2, y + 1.2, 6, h - 2.4, couleurCadre, null, 0, 0.8);
  D.police(11, true, "#000000"); D.texte(lettre, x + 4.2, y + h / 2 + 1.5, { align: "center" });
  // texte → chiffres, la virgule devient un point lumineux
  let s = valeur.replace(",", ".");
  const ent = s.split(".")[0], dec = s.split(".")[1] ?? "";
  const brut = (ent + dec).padStart(nb, " ");
  const posPoint = nb - dec.length;   // point après le chiffre d'index posPoint-1
  let cx = x + 8 + 1.5;
  const cy = y + (h - hc) / 2;
  for (let k = 0; k < nb; k++) {
    const pas = chiffre7(d, cx, cy, hc, brut[k], "#ff2a1a", "#2a0805");
    if (dec.length && k === posPoint - 1) { d.setFillColor("#ff2a1a"); d.circle(cx + pas - hc * 0.2, cy + hc, hc * 0.065, "F"); }
    cx += pas;
  }
  return w;
}

// ----------------------------------------------------------------------
function sections(progs) {
  const sec = new Map();
  for (const p of progs) {
    const t = p.tubeCao;
    if (t.quantite <= 0) continue;
    const cle = `${Math.round(t.diametre * 10) / 10}|${Math.round(t.epaisseur * 100) / 100}|${t.matiere}`;
    if (!sec.has(cle)) sec.set(cle, { D: t.diametre, ep: t.epaisseur, mat: t.matiere, pieces: [] });
    sec.get(cle).pieces.push({ repere: rep(t), longueur: Math.ceil(p.longueurDebit), quantite: t.quantite });
  }
  return [...sec.values()];
}

const TEINTES = ["#cfe0f3", "#f6dcc0", "#d6ecd2", "#e6dcf3", "#f3e7b8", "#d4e9ec"];

/** Plan de coupe dessiné barre par barre ; les barres identiques sont regroupées. */
function dessinerPlan(D, m, barres, couleurs) {
  const d = D.d;
  const xL = MG, wL = 17, xB = MG + wL, wB = LU - wL - 22, hB = 11;
  const groupes = [];
  for (const b of barres) {
    const cle = b.coupes.map((c) => c.repere + ":" + c.longueur).join("|");
    const g0 = groupes.find((x) => x.cle === cle);
    if (g0) g0.n++; else groupes.push({ cle, b, n: 1, premier: 0 });
  }
  let num = 1;
  for (const gr of groupes) {
    D.besoin(hB + 9);
    const b = gr.b, ech = wB / b.longueur, y = D.y + 3.2;
    // étiquette barre
    D.police(8.5, true, BLEU);
    D.texte(gr.n > 1 ? `Barres ${num}–${num + gr.n - 1}` : `Barre ${num}`, xL, y + hB / 2 - 0.6);
    if (gr.n > 1) { D.police(10, true, ROUGE); D.texte(`× ${gr.n}`, xL, y + hB / 2 + 4); }
    num += gr.n;
    let x = xB;
    b.coupes.forEach((c, k) => {
      const w = c.longueur * ech;
      D.rect(x, y, w, hB, couleurs.get(c.repere) || TEINTES[k % TEINTES.length], "#4a6b8a", 0.3);
      if (w >= 11) {
        D.police(w >= 16 ? 9 : 7.5, true, "#10273d"); D.texte(c.repere, x + w / 2, y + 4.6, { align: "center" });
        D.police(w >= 16 ? 8 : 6.5, false, "#10273d"); D.texte(g(c.longueur), x + w / 2, y + 8.8, { align: "center" });
      } else {
        D.police(6.5, true, "#10273d");
        d.text(`${c.repere} ${g(c.longueur)}`, x + w / 2 + 1, y + hB - 1, { angle: 90 });
      }
      x += w;
      if (k < b.coupes.length - 1 || b.chute > 0.5) { // trait de scie
        d.setFillColor("#1f3b57"); d.rect(x, y - 0.8, Math.max(0.35, m.trait_scie * ech), hB + 1.6, "F");
        x += m.trait_scie * ech;
      }
    });
    const wc = xB + wB - x;
    if (wc > 0.2) {
      const reut = b.chute >= m.chute_reutilisable;
      D.rect(x, y, wc, hB, reut ? "#e3f1e0" : "#eceff2", "#9aa5b1", 0.25);
      d.setDrawColor(reut ? "#a8cfa0" : "#c3cad2"); d.setLineWidth(0.2);
      for (let hx = x - hB; hx < x + wc; hx += 2.2) {
        const xa = Math.max(x, hx), ya = y + hB - (xa - hx), xb = Math.min(x + wc, hx + hB), yb = y + hB - (xb - hx);
        if (xb > xa) d.line(xa, ya, xb, yb);
      }
    }
    // chute (à droite)
    const reut = b.chute >= m.chute_reutilisable;
    D.police(8.5, true, reut ? "#2e7d32" : GRIS); D.texte(`${f1(b.chute, 0)}`, xB + wB + 2, y + 4.8);
    D.police(6.3, false, reut ? "#2e7d32" : GRIS); D.texte(reut ? "chute réutil." : "chute", xB + wB + 2, y + 8.6);
    D.y = y + hB + 2.5;
  }
  // échelle
  D.police(6.5, false, GRIS);
  D.texte(`Barre de ${g(m.barre_longueur)} mm à l'échelle · trait foncé = trait de scie ${g(m.trait_scie)} mm · hachures = chute (verte si ≥ ${g(m.chute_reutilisable)} mm)`, xB, D.y + 2);
  D.y += 5;
}

function pageDebit(D, progs, titreLot) {
  const m = progs[0].machine;
  const nP = progs.reduce((s, p) => s + p.tubeCao.quantite, 0);
  D.entete("Liste de débit et plan de coupe" + (titreLot ? ` — ${titreLot}` : ""),
    `${progs.length} repère(s), ${nP} pièce(s) · barres de ${g(m.barre_longueur)} mm · trait de scie ${g(m.trait_scie)} mm · édité le ${dateFr()}`);
  const couleurs = new Map();
  progs.forEach((p, k) => couleurs.set(rep(p.tubeCao), TEINTES[k % TEINTES.length]));
  D.tableau([
    { t: "Repère", w: 17, gras: true }, { t: "Désignation", w: 62, align: "left", retour: true, taille: 8.5 },
    { t: "Qté", w: 11 }, { t: "Ø × ép.", w: 24 }, { t: "Matière", w: 24, retour: true, taille: 8.5 },
    { t: "Débit (mm)", w: 20, gras: true }, { t: "Plis", w: 11 }, { t: "", w: 11, couleur: ROUGE },
  ], progs.map((p) => {
    const t = p.tubeCao;
    return [{ t: rep(t), fond: couleurs.get(rep(t)), gras: true }, { t: t.nom, sous: t.sources.length > 1 ? t.sources.join(", ") : null },
      String(t.quantite), `${f1(t.diametre)} × ${f1(t.epaisseur)}`, t.matiere, f1(p.longueurDebit), String(p.etapes.length),
      { t: p.erreurs.length ? "✖" : p.alertes.length ? "⚠" : "", couleur: p.erreurs.length ? ROUGE : JAUNE_TXT }];
  }), { taille: 8.5 });
  D.y += 3;
  for (const s of sections(progs)) {
    const { barres, tropLongues } = planDeCoupe(s.pieces, m.barre_longueur, m.trait_scie);
    const utile = s.pieces.filter((p) => p.longueur <= m.barre_longueur).reduce((a, p) => a + p.longueur * p.quantite, 0);
    const total = barres.length * m.barre_longueur, chute = barres.reduce((a, b) => a + b.chute, 0);
    const reut = barres.filter((b) => b.chute >= m.chute_reutilisable);
    D.titre2(`Plan de coupe Ø${f1(s.D)} × ${f1(s.ep)} — ${s.mat} : ${barres.length} barre(s)`);
    D.police(8.5, false, "#000000");
    D.texte(`Tube utile ${f1(utile / 1000, 2)} m sur ${f1(total / 1000, 2)} m (utilisation ${f1(total ? 100 * utile / total : 0, 1)} %) · chutes ${f1(chute / 1000, 2)} m`
      + (reut.length ? `, dont ${reut.length} réutilisable(s) ≥ ${g(m.chute_reutilisable)} mm` : ""), MG, D.y + 2);
    D.y += 4;
    dessinerPlan(D, m, barres, couleurs);
    for (const p of tropLongues) { D.police(8.5, false, ROUGE); D.texte(`✖ ${p.repere} : ${g(p.longueur)} mm plus long qu'une barre`, MG, D.y + 3); D.y += 5; }
  }
  const av = aVerifier(m);
  if (av.length) {
    D.titre2("Paramètres machine à vérifier");
    for (const x of av) { D.police(8.5, false, GRIS); D.texte("ℹ " + x, MG, D.y + 3); D.y += 4.5; }
  }
}

// ----------------------------------------------------------------------
function ficheTube(D, prog, remarquesMachine) {
  const m = prog.machine, t = prog.tubeCao;
  const titre = t.repere ? `${t.repere} — ${t.nom}` : `Fiche de cintrage — ${t.nom}`;
  D.entete(titre, `Quantité : ${t.quantite}  ·  Ø${f1(t.diametre)} × ${f1(t.epaisseur)} mm  ·  ${t.matiere}  ·  ${m.nom}  ·  édité le ${dateFr()}`,
    t.sources.length > 1 ? "Pièces : " + t.sources.join(", ") : null);
  // bloc d'informations
  const y0 = D.y, hI = 17;
  D.rect(MG, y0, LU, hI, CLAIR, GRIS, 0.3);
  D.d.setDrawColor("#ffffff"); D.d.setLineWidth(0.4);
  D.d.line(MG + 100, y0, MG + 100, y0 + hI); D.d.line(MG + 100, y0 + hI / 2, MG + LU, y0 + hI / 2);
  D.police(8, false, GRIS); D.texte("Longueur de débit", MG + 3, y0 + 5);
  D.police(20, true, BLEU); D.texte(`${f1(prog.longueurDebit)} mm`, MG + 3, y0 + 13.5);
  const sl = prog.surlongAvant || prog.surlongArriere ? `avant ${g(prog.surlongAvant)} · arrière ${g(prog.surlongArriere)} mm` : "aucune";
  D.police(8, false, GRIS); D.texte("Surlongueurs à recouper", MG + 54, y0 + 5);
  D.police(9, true, prog.surlongAvant || prog.surlongArriere ? ROUGE : "#000000"); D.texte(sl, MG + 54, y0 + 11, { maxWidth: 44 });
  D.police(8, false, GRIS); D.texte("Outillage", MG + 103, y0 + 5.5); D.police(9, true); D.texte(prog.outil ? prog.outil.nom : "—", MG + 128, y0 + 5.5);
  D.police(8, false, GRIS); D.texte("Nombre de plis", MG + 103, y0 + 14); D.police(9, true); D.texte(String(prog.etapes.length), MG + 128, y0 + 14);
  D.y = y0 + hI + 3;

  // image + préparation côte à côte
  const wImg = 96, hImg = 66;
  const img = imagePiece(prog, 1100, Math.round(1100 * hImg / wImg));
  D.d.addImage(img, "JPEG", MG, D.y, wImg, hImg);
  D.rect(MG, D.y, wImg, hImg, null, TRAIT, 0.25);
  const xP = MG + wImg + 5, wP = LU - wImg - 5;
  D.police(10, true, BLEU); D.texte("Préparation", xP, D.y + 3.5);
  const cote = prog.inverse ? "la FIN" : "le DÉBUT";
  const prep = [
    `Couper le tube à ${f1(prog.longueurDebit)} mm.`,
    "Repérer la soudure du tube (trait de marqueur si besoin).",
    "Saisir le programme (tableau 1) dans la commande, ligne par ligne.",
    `Engager l'extrémité ARRIÈRE dans la pince du chariot, soudure ${m.position_soudure}, serrer.`,
    "Extrémité AVANT sur la marque zéro de l'outil, puis bouton jaune (zéro Y) et bouton rouge (zéro B).",
    `L'extrémité AVANT correspond à ${cote} de l'esquisse CAO.`,
  ];
  let yp = D.y + 7;
  prep.forEach((p, k) => {
    D.d.setFillColor(BLEU); D.d.circle(xP + 2, yp + 1.6, 2, "F");
    D.police(7, true, "#ffffff"); D.texte(String(k + 1), xP + 2, yp + 2.5, { align: "center" });
    yp += D.para(p, xP + 5.5, yp, wP - 5.5, 8, false, "#1b2631", 1.25) + 1.6;
  });
  D.y += hImg + 1.5;
  D.police(6.8, false, GRIS);
  D.texte("Gris : droites · orange : plis numérotés dans l'ordre de cintrage · trait rouge : soudure"
    + (prog.surlongAvant || prog.surlongArriere ? " · violet : surlongueur à recouper" : ""), MG, D.y + 2.5);
  D.y += 5;

  if (prog.etapes.length) {
    D.besoin(14 + 7 * Math.min(prog.etapes.length, 6));
    D.titre2("1. Programme à saisir dans la commande");
    D.tableau([
      { t: "Ligne", w: 18, couleur: ROUGE, gras: true, taille: 11 }, { t: "Angle", w: 32, gras: true, taille: 11 },
      { t: "Compensation", w: 34, gras: true, taille: 11 }, { t: "Pré-extraction", w: 32, couleur: GRIS, taille: 9.5 },
      { t: "Vitesse", w: 26, couleur: GRIS, taille: 9.5 },
    ], prog.etapes.map((e) => [String(e.numero).padStart(2, "0"), `${f1(e.beta)}°`, `${f1(e.alpha)}°`, `${f1(e.preExtraction)}°`, `${g(e.vitesse)} %`]),
    { entete: CLAIR, enteteTexte: BLEU, zebra: false, hl: 6.8 });
    D.y += 1;
    D.y += D.para(`Compensation ${f1(prog.etapes[0].alpha)}° ${prog.etalonnage.etalonne ? "(étalonnée)" : "(valeur habituelle)"} : si le tube d'essai de la série ne donne pas l'angle voulu, corriger toutes les lignes de (angle voulu − angle mesuré).  Compensation corrigée : ________`,
      MG, D.y, LU, 7.2, false, GRIS) + 2;

    D.besoin(14 + 8 * Math.min(prog.etapes.length, 6));
    D.titre2("2. Cintrage — pour chaque ligne : avancer jusqu'à Y, puis tourner jusqu'à B, pédale");
    D.tableau([
      { t: "Ligne", w: 15, gras: true, taille: 12 }, { t: "Afficheur Y", w: 31, gras: true, taille: 12.5 },
      { t: "Afficheur B", w: 29, gras: true, taille: 12.5 }, { t: "Sens de rotation", w: 37, taille: 9 },
      { t: "Angle", w: 22, couleur: GRIS, taille: 9 }, { t: "Droite", w: 22, couleur: GRIS, taille: 9 }, { t: "Fait", w: 12, taille: 13 },
    ], prog.etapes.map((e) => [String(e.numero).padStart(2, "0"), f1(e.Y), `${f1(affichageB(e.B))}°`, sensRotation(e.rotation, m.sens_B),
      `${f1(e.beta)}°`, f1(e.droiteAvant), "☐"]), { hl: 8 });
    D.y += 1;
    const reste = prog.tube.droites[prog.tube.droites.length - 1].longueur + prog.surlongArriere;
    D.y += D.para(`Y et B depuis les zéros pris extrémité avant sur la marque : ne pas refaire de zéro pendant le tube. Après le dernier pli il reste ${f1(reste, 0)} mm de tube (mini ${g(m.droite_arriere_mini)} mm). L'afficheur B repart à 0 au-delà de 360° : tourner dans le sens indiqué. « Droite » est donnée pour contrôle.`,
      MG, D.y, LU, 7.2, false, GRIS) + 2;
  }
  const msgs = prog.messages, av = remarquesMachine ? aVerifier(m) : [];
  if (msgs.length || av.length) {
    D.titre2("Contrôles");
    for (const x of msgs) {
      const col = x.niveau === ERREUR ? ROUGE : x.niveau === ALERTE ? JAUNE_TXT : "#34495e";
      const sym = x.niveau === ERREUR ? "✖" : x.niveau === ALERTE ? "⚠" : "ℹ";
      D.besoin(5);
      D.police(8.5, false, col); D.texte(sym, MG, D.y + 3);
      D.y += D.para(String(x), MG + 5, D.y, LU - 5, 8.5, false, "#000000") + 1;
    }
    for (const x of av) { D.besoin(5); D.y += D.para("ℹ Paramètre machine : " + x, MG, D.y, LU, 8.5, false, GRIS) + 1; }
  }
}

function pageSimulation(D, prog) {
  const t = prog.tubeCao;
  D.nouvellePage();
  D.entete(`Simulation pas à pas — ${t.repere ? t.repere + " · " : ""}${t.nom}`,
    "Position du tube juste avant chaque cintrage, vue de l'opérateur. Bleu : déjà cintré · gris : partie droite · trait rouge : soudure.");
  const sim = new Simulation(prog, 12);
  const vignettes = prog.etapes.map((et) => ({ et, etat: sim.etatAvantPli(et.numero) }));
  const der = prog.etapes[prog.etapes.length - 1];
  vignettes.push({ et: null, etat: sim.etatPendantPli(der.numero, der.beta * Math.PI / 180), fin: true });
  const wV = (LU - 6) / 2, hI = 58, hBande = 15, hV = hI + hBande + 3;
  vignettes.forEach((v, k) => {
    const col = k % 2;
    if (col === 0) D.besoin(hV + 2);
    const x = MG + col * (wV + 6), y = D.y;
    const img = imageEtat(prog, v.etat, 900, Math.round(900 * hI / wV), v.fin ? der.beta : 0);
    D.d.addImage(img, "JPEG", x, y, wV, hI);
    D.rect(x, y, wV, hI + hBande, null, TRAIT, 0.3);
    // titre dans l'image
    D.rect(x, y, wV, 6.5, "#ffffff", null);
    D.police(9, true, BLEU);
    if (v.fin) D.texte("Fin de cycle : ouvrir la pince, retirer le tube", x + 2.5, y + 4.6);
    else {
      D.texte(`Ligne ${String(v.et.numero).padStart(2, "0")}`, x + 2.5, y + 4.6);
      D.police(8.5, false, "#1b2631");
      D.texte(`angle ${f1(v.et.beta)}° · comp. ${f1(v.et.alpha)}° · ${sensRotation(v.et.rotation, prog.machine.sens_B)}`, x + wV - 2.5, y + 4.6, { align: "right" });
    }
    // bande des afficheurs
    const yb = y + hI + 1.75;
    D.rect(x, y + hI, wV, hBande, "#f4f6f9");
    if (!v.fin) {
      const wY = afficheur(D, x + 3, yb, "Y", f1(v.et.Y), JAUNE, { nb: 6 });
      afficheur(D, x + 3 + wY + 4, yb, "B", f1(affichageB(v.et.B)), ROUGE_B, { nb: 4 });
    } else {
      const ex = prog.tube.droites[prog.tube.droites.length - 1].longueur + prog.surlongArriere;
      D.police(8.5, false, GRIS); D.texte(`Reste ${f1(ex, 0)} mm de tube après le dernier pli`, x + 3, yb + 7);
    }
    if (col === 1 || k === vignettes.length - 1) D.y += hV;
  });
  // géométrie de référence sous les images
  const { lignes, fin } = prog.tube.lra();
  if (lignes.length) {
    D.y += 1;
    D.titre2("Géométrie de référence (L / R / A, depuis l'extrémité avant)");
    D.tableau([{ t: "Pli", w: 16 }, { t: "Droite avant (mm)", w: 36 }, { t: "Rotation de plan (°)", w: 38 }, { t: "Angle (°)", w: 28 }, { t: "Rayon (mm)", w: 28 }],
      [...lignes.map((l, i) => [String(i + 1), f1(l.L), f1(l.R), f1(l.A), f1(l.rayon)]), ["fin", f1(fin), "", "", ""]],
      { entete: CLAIR, enteteTexte: BLEU, bordure: GRIS, hl: 5.6, taille: 8.5 });
  }
}

// ----------------------------------------------------------------------
/** progs : programmes calculés (un par repère). Renvoie un Blob PDF. */
export async function dossierPdf(progs, { titreLot = "", progression = null } = {}) {
  const fontes = await polices();
  const D = new Doc(window.jspdf.jsPDF, fontes);
  const multi = progs.length > 1;
  let premier = true;
  if (multi) { pageDebit(D, progs, titreLot); premier = false; }
  for (let k = 0; k < progs.length; k++) {
    if (!premier) D.nouvellePage();
    premier = false;
    ficheTube(D, progs[k], !multi);
    if (progs[k].etapes.length) pageSimulation(D, progs[k]);
    if (progression) await progression(k + 1, progs.length);
  }
  D.pieds();
  return D.d.output("blob");
}

/** Liste de débit CSV (séparateur ;, UTF-8 avec BOM pour Excel). */
export function debitCsv(progs) {
  const q = (v) => { const s = String(v ?? ""); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lignes = [["Repère", "Désignation", "Pièces d'origine", "Quantité", "Diamètre", "Épaisseur", "Matière",
    "Longueur débit (mm)", "Surlongueur avant", "Surlongueur arrière", "Nombre de plis", "Outil", "Erreurs"]];
  for (const p of progs) {
    const t = p.tubeCao;
    lignes.push([rep(t), t.nom, t.sources.join(", "), t.quantite, f1(t.diametre, 2), f1(t.epaisseur, 2), t.matiere,
      f1(p.longueurDebit), f1(p.surlongAvant), f1(p.surlongArriere), p.etapes.length, p.outil ? p.outil.nom : "",
      p.erreurs.map(String).join(" | ")]);
  }
  if (progs.length) {
    const m = progs[0].machine;
    lignes.push([], ["Plan de coupe", `barres ${g(m.barre_longueur)} mm`, `trait ${g(m.trait_scie)} mm`]);
    for (const s of sections(progs)) {
      const { barres, tropLongues } = planDeCoupe(s.pieces, m.barre_longueur, m.trait_scie);
      lignes.push([`Ø${f1(s.D)} × ${f1(s.ep)} ${s.mat}`, `${barres.length} barre(s)`]);
      barres.forEach((b, k) => lignes.push([`Barre ${k + 1}`, b.coupes.map((c) => `${c.repere} ${g(c.longueur)}`).join(" + "), `chute ${f1(b.chute, 0)}`]));
      for (const p of tropLongues) lignes.push([p.repere, `${g(p.longueur)} mm`, "plus long qu'une barre"]);
    }
  }
  return "﻿" + lignes.map((l) => l.map(q).join(";")).join("\r\n");
}
