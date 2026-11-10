// Application TubeCintrage (navigateur).
import { chargerFichier, lotVersTexte, chargerLot } from "./core/importation.js";
import { regrouper, numeroter } from "./core/debit.js";
import { calculerAuto, Simulation } from "./core/simulation.js";
import { ERREUR, ALERTE, affichageB, sensRotation } from "./core/sequence.js";
import { aVerifier } from "./core/parametres.js";
import { Vue3D } from "./vue3d.js";
import * as St from "./stockage.js";
import * as Dl from "./dialogues.js";
import * as At from "./atelier.js";

const $ = (s) => document.querySelector(s);
const f1 = (v, n = 1) => (v == null ? "—" : (Math.abs(v) < 0.5 * 10 ** -n ? 0 : Number(v)).toFixed(n).replace(".", ","));
const g = (x) => String(+Number(x).toPrecision(6)).replace(".", ",");
const pause = () => new Promise((r) => setTimeout(r, 0));

const ICONES = {
  ouvrir: "M3 7h6l2 2h10v10H3z", ajouter: "M12 5v14M5 12h14", lots: "M4 5h16v4H4zM4 11h16v4H4zM4 17h16v3H4z",
  enregistrer: "M5 4h11l3 3v13H5zM8 4v5h8V4M8 20v-6h8v6", publier: "M12 16V4M7 9l5-5 5 5M5 20h14", points: "M4 20 12 4l8 16M8 13h8",
  pdfTous: "M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h7", pdfTube: "M6 3h9l4 4v14H6zM14 3v5h5", csv: "M4 4h16v16H4zM4 10h16M4 15h16M10 4v16", etiquettes: "M3 12V4h8l10 10-8 8zM7.5 8.5h.01",
  parametres: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1",
  etalonnage: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 11v2",
};
document.querySelectorAll(".actions button").forEach((b) => {
  const p = ICONES[b.dataset.action];
  if (p) b.querySelector("i").innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${p}"/></svg>`;
});

// ----------------------------------------------------------------------
// Afficheur 7 segments en SVG (comme la commande)
const SEG = { "0": "abcdef", "1": "bc", "2": "abged", "3": "abgcd", "4": "fgbc", "5": "afgcd", "6": "afgedc", "7": "abc", "8": "abcdefg", "9": "abcdfg", "-": "g", " ": "" };
const ESP = 12;   // espace (unités du dessin) entre partie entière et décimale : virgule plus visible
function sept(svg, texte, nb) {
  const h = 40, w = 21, pas = 29, inc = 4, e = 4.6;
  const s = texte.replace(",", ".");
  const [ent, dec = ""] = s.split(".");
  const chiffres = (ent + dec).padStart(nb, " ").slice(-nb), point = nb - dec.length - 1;
  const P = (x0, u, v) => [x0 + u * w + (1 - v) * inc, 2 + v * h];
  let out = "";
  for (let k = 0; k < nb; k++) {
    const x0 = 4 + k * pas + (dec && k > point ? ESP : 0), on = SEG[chiffres[k]] ?? "";   // espace après la virgule
    const seg = { a: [[0.14, 0], [0.86, 0]], b: [[1, 0.08], [1, 0.44]], c: [[1, 0.56], [1, 0.92]], d: [[0.14, 1], [0.86, 1]],
      e: [[0, 0.56], [0, 0.92]], f: [[0, 0.08], [0, 0.44]], g: [[0.14, 0.5], [0.86, 0.5]] };
    for (const [n, [[u0, v0], [u1, v1]]] of Object.entries(seg)) {
      const [x1, y1] = P(x0, u0, v0), [x2, y2] = P(x0, u1, v1);
      out += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${on.includes(n) ? "#ff2a1a" : "#2a0805"}" stroke-width="${e}" stroke-linecap="round"/>`;
    }
    if (dec && k === point) out += `<circle cx="${x0 + w + (pas - w + ESP) / 2}" cy="${2 + h}" r="3.6" fill="#ff2a1a"/>`;
  }
  const larg = 8 + nb * pas + (dec ? ESP : 0);
  svg.setAttribute("viewBox", `0 0 ${larg} ${h + 5}`);
  svg.style.aspectRatio = `${larg} / ${h + 5}`;
  svg.innerHTML = out;
}

// ----------------------------------------------------------------------
const etat = {
  machine: null, tubes: [], courant: -1, coches: new Set(), nomLot: "",
  progs: new Map(),          // id tube -> {cle, prog}
  prog: null, sim: null, images: [], image: 0, mode: "piece", lecture: null, versionParams: 0,
};
let idSuivant = 1;
const vue = new Vue3D($("#vue3d"));

function toast(t, ms = 2600) {
  const el = $("#toast"); el.textContent = t; el.classList.add("visible");
  clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.remove("visible"), ms);
}

// ----------------------------------------------------------------------
// Calcul (avec cache)
function cleCalcul(t) { return JSON.stringify([etat.versionParams, t.diametre, t.epaisseur, t.matiere, t.reglages.sens || 0, t.reglages.psi ?? null]); }
function programme(t) {
  const c = etat.progs.get(t.id), cle = cleCalcul(t);
  if (c && c.cle === cle) return c.prog;
  const sens = t.reglages.sens || 0;
  const p = calculerAuto(t, etat.machine, sens === 0 ? null : sens === 2, t.reglages.psi ?? null);
  etat.progs.set(t.id, { cle, prog: p });
  return p;
}
// une surlongueur n'est pas un défaut : simple matière à recouper (rose, « + »), pas un avertissement (jaune, « ⚠ »)
const estSurlong = (x) => x.niveau === ALERTE && /surlongueur/i.test(x.texte);
const etatTube = (t) => {
  const c = etat.progs.get(t.id);
  if (!c || c.cle !== cleCalcul(t)) return null;
  const p = c.prog;
  if (p.erreurs.length) return "erreur";
  if (p.messages.some((x) => x.niveau === ALERTE && !estSurlong(x))) return "alerte";
  return p.surlongAvant > 0 || p.surlongArriere > 0 ? "surlong" : "ok";
};
async function calculerTous() {
  for (const t of etat.tubes) {
    if (etatTube(t) == null) { try { programme(t); } catch (e) { console.error(e); } await pause(); afficherListe(); }
  }
  afficherListe();
}

// ----------------------------------------------------------------------
// Lot
function chargerTubes(tubes, { garderSelection = true } = {}) {
  const ancien = garderSelection ? etat.tubes[etat.courant] : null;
  etat.tubes = numeroter(regrouper(tubes));
  for (const t of etat.tubes) if (!t.id) t.id = idSuivant++;
  etat.coches.clear();
  let k = 0;
  if (ancien) {
    const j = etat.tubes.findIndex((t) => t.sources.some((s) => ancien.sources.includes(s)) || t.nom === ancien.nom);
    if (j >= 0) k = j;
  }
  etat.courant = etat.tubes.length ? k : -1;
  afficherListe();
  selectionner(etat.courant);
  calculerTous();
}

async function lireFichiers(fichiers, remplacer) {
  const nouveaux = [], rapport = [], erreurs = [];
  const prog = fichiers.length > 2 || fichiers.some((f) => /\.(step|stp)$/i.test(f.name)) ? Dl.progression("Lecture des fichiers") : null;
  let lotNom = null;
  for (let k = 0; k < fichiers.length; k++) {
    const f = fichiers[k];
    prog?.maj(`Lecture de ${f.name}…`, k / fichiers.length);
    await pause();
    try {
      const estStep = /\.(step|stp)$/i.test(f.name);
      const contenu = estStep ? await f.arrayBuffer() : await f.text();
      // STEP d'assemblage : seuls les solides au diamètre d'un outil déclaré sont gardés (renforts écartés)
      const r = await chargerFichier(f.name, contenu, { diametresOutils: (etat.machine?.outils || []).map((o) => o.diametre) });
      if (/\.tclot$/i.test(f.name)) lotNom = r.nom || f.name.replace(/\.tclot$/i, "");
      else for (const t of r.tubes) if (!t.sources.length) t.sources = [t.nom];
      nouveaux.push(...r.tubes); rapport.push(...r.rapport);
      if (!r.tubes.length) erreurs.push(`${f.name} : aucun tube trouvé`);
    } catch (e) { console.error(e); erreurs.push(`${f.name} : ${e.message}`); }
  }
  prog?.fermer();
  if (remplacer) etat.nomLot = fichiers.length === 1 && lotNom ? lotNom : "";
  else if (!etat.tubes.length && lotNom) etat.nomLot = lotNom;
  chargerTubes([...(remplacer ? [] : etat.tubes), ...nouveaux], { garderSelection: !remplacer });
  let txt = "";
  if (erreurs.length) txt += "Fichiers non lus :\n" + erreurs.join("\n") + "\n\n";
  if (rapport.length) txt += "Remarques à l'import :\n" + rapport.join("\n");
  if (txt) Dl.message("Import", txt.trim());
  else if (nouveaux.length) toast(`${nouveaux.length} tube(s) ajouté(s)`);
}

function afficherListe() {
  const ul = $("#liste");
  ul.innerHTML = "";
  etat.tubes.forEach((t, k) => {
    const e = etatTube(t), li = document.createElement("li");
    li.className = [e || "", k === etat.courant ? "choisi" : "", etat.coches.has(k) ? "coche" : ""].join(" ");
    const nb = t.cintres.length;
    li.innerHTML = `<span class="etat ${e || ""}">${{ erreur: "✖", alerte: "⚠", surlong: "+", ok: "✔" }[e] || "…"}</span><span class="rep">${Dl.echapper(t.repere)}</span>
      <span class="nom">${Dl.echapper(t.nom)}<small>${nb} pli${nb > 1 ? "s" : ""} · ${Math.round(t.longueur)} mm · Ø${g(t.diametre)}×${g(t.epaisseur)}${t.sources.length > 1 ? " · " + t.sources.length + " pièces regroupées" : ""}</small></span>
      <span class="qte">×${t.quantite}</span>`;
    if (t.sources.length > 1) li.title = "Pièces : " + t.sources.join(", ");
    li.onclick = (ev) => {
      if (ev.ctrlKey || ev.metaKey || ev.shiftKey) { etat.coches.has(k) ? etat.coches.delete(k) : etat.coches.add(k); afficherListe(); return; }
      etat.coches.clear(); selectionner(k);
    };
    ul.appendChild(li);
  });
  $("#videLot").classList.toggle("cache", etat.tubes.length > 0);
  const n = etat.tubes.reduce((s, t) => s + t.quantite, 0);
  const nE = (x) => etat.tubes.filter((t) => etatTube(t) === x).length, ne = nE("erreur"), na = nE("alerte"), ns = nE("surlong");
  $("#totalLot").textContent = etat.tubes.length ? `${etat.tubes.length} repère(s), ${n} pièce(s)` + (ne ? ` · ✖ ${ne}` : "") + (na ? ` · ⚠ ${na}` : "") + (ns ? ` · + ${ns}` : "") : "";
  $("#titreLot").textContent = etat.nomLot ? "— " + etat.nomLot : "";
  document.title = "TubeCintrage" + (etat.nomLot ? " — " + etat.nomLot : "");
}

function selectionner(k) {
  etat.courant = k;
  arreterLecture();
  const t = etat.tubes[k];
  afficherListe();
  const champs = ["#qte", "#diam", "#ep", "#mat", "#sens", "#soudAuto", "#soudAngle"];
  champs.forEach((s) => ($(s).disabled = !t));
  if (!t) {
    etat.prog = null; vue.effacer(); $("#attente3d").classList.remove("cache");
    $("#tableProg tbody").innerHTML = ""; $("#messages").innerHTML = "";
    $("#resume").innerHTML = "Ouvrez ou glissez des fichiers (macro SolidWorks, STEP, points, lot).";
    $("#afficheur").classList.add("cache"); $("#lecteur").classList.add("cache");
    return;
  }
  $("#qte").value = t.quantite; $("#diam").value = t.diametre; $("#ep").value = t.epaisseur; $("#mat").value = t.matiere;
  $("#sens").value = String(t.reglages.sens || 0);
  const auto = t.reglages.psi == null;
  $("#soudAuto").checked = auto; $("#soudAngle").disabled = auto;
  if (!auto) $("#soudAngle").value = Math.round(t.reglages.psi) % 360;
  recalculer();
}

function recalculer() {
  const t = etat.tubes[etat.courant];
  if (!t) return;
  $("#attente3d").classList.add("cache");
  let p;
  try { p = programme(t); } catch (e) { console.error(e); Dl.message("Calcul", "Erreur de calcul : " + e.message); return; }
  etat.prog = p;
  if ($("#soudAuto").checked) $("#soudAngle").value = Math.round(p.psi) % 360;
  $("#soudVal").textContent = `${Math.round(p.psi)}°`;
  etat.sim = new Simulation(p);
  // pas deux fois plus fins que les valeurs par défaut (5° / 15° / 250 mm) : animation plus fluide
  etat.images = p.etapes.length ? etat.sim.images({ pasAngle: 2.5, pasRotation: 7.5, pasAvance: 125 }) : [];
  afficherResultats();
  afficherListe();
  if (etat.mode === "simulation" && etat.images.length) modeSimulation(); else modePiece();
}

function afficherResultats() {
  const p = etat.prog, m = etat.machine;
  const sl = p.surlongAvant || p.surlongArriere ? `<br><span class="surlong"><b>Surlongueurs à recouper :</b> avant ${g(p.surlongAvant)} mm, arrière ${g(p.surlongArriere)} mm</span>` : "";
  $("#resume").classList.remove("discret");
  $("#resume").innerHTML = `<span class="debit">Débit ${f1(p.longueurDebit)} mm</span> · ${p.outil ? Dl.echapper(p.outil.nom) : "pas d'outil"} · ${p.etapes.length} pli(s)
    <br>Entre en premier dans la matrice : <b>${p.inverse ? "fin" : "début"} de l'esquisse</b> · soudure ${Math.round(p.psi)}° (qualité ${f1(p.scoreSoudure, 2)})${sl}`;
  const tb = $("#tableProg tbody");
  tb.innerHTML = p.etapes.map((e, k) => `<tr data-pli="${k + 1}"><td>${String(e.numero).padStart(2, "0")}</td><td class="fort">${f1(e.Y)}</td>
    <td class="fort">${f1(affichageB(e.B))}°</td><td class="sens">${sensRotation(e.rotation, m.sens_B)}</td><td class="fort">${f1(e.beta)}°</td>
    <td class="fort">${f1(e.alpha)}°</td><td>${f1(e.droiteAvant)}</td></tr>`).join("") || `<tr><td colspan="7" class="discret">Tube droit : pas de cintrage</td></tr>`;
  tb.querySelectorAll("tr[data-pli]").forEach((tr) => (tr.onclick = () => allerPli(Number(tr.dataset.pli))));
  const ul = $("#messages");
  const items = p.messages.map((x) => `<li class="${x.niveau === ERREUR ? "erreur" : estSurlong(x) ? "surlong" : x.niveau === ALERTE ? "alerte" : "info"}">${Dl.echapper(String(x))}</li>`);
  for (const a of aVerifier(m)) items.push(`<li class="info">Paramètre machine : ${Dl.echapper(a)}</li>`);
  if (!p.messages.length) items.unshift(`<li class="ok">Aucun problème détecté</li>`);
  ul.innerHTML = items.join("");
}

// ----------------------------------------------------------------------
// 3D
function modePiece() {
  etat.mode = "piece"; arreterLecture();
  $("#btPiece").classList.add("actif"); $("#btSim").classList.remove("actif");
  $("#afficheur").classList.add("cache"); $("#lecteur").classList.add("cache"); $("#btZoom").classList.add("cache");
  if (etat.prog) vue.piece(etat.prog);
}
function modeSimulation() {
  if (!etat.prog || !etat.images.length) { if (etat.prog) toast("Tube droit : rien à simuler"); return; }
  const memeTube = vue.mode === "simulation" && vue.prog === etat.prog;
  etat.mode = "simulation";
  $("#btSim").classList.add("actif"); $("#btPiece").classList.remove("actif");
  $("#afficheur").classList.remove("cache"); $("#lecteur").classList.remove("cache"); $("#btZoom").classList.remove("cache");
  if (!memeTube || modeSimulation._zones !== $("#zones").checked) {
    vue.preparerSimulation(etat.prog, $("#zones").checked);
    modeSimulation._zones = $("#zones").checked;
  }
  const c = $("#curseur"); c.max = etat.images.length - 1;
  afficherImage(memeTube ? Math.min(etat.image, etat.images.length - 1) : 0);
}
function afficherImage(k) {
  if (!etat.images.length) return;
  k = Math.max(0, Math.min(k, etat.images.length - 1));
  etat.image = k;
  const im = etat.images[k];
  vue.image(im, etat.sim.collisions(im.etat));
  $("#curseur").value = k;
  $("#affTitre").textContent = im.titre;
  sept($("#affY"), f1(im.Y), 6);
  sept($("#affB"), f1(affichageB(im.B)), 4);
  $("#affAngle").textContent = im.beta != null ? `${f1(im.beta)}°` : "—";
  $("#affComp").textContent = im.alpha != null ? `${f1(im.alpha)}°` : "—";
  document.querySelectorAll("#tableProg tbody tr").forEach((tr) => tr.classList.toggle("choisi", Number(tr.dataset.pli) === im.pli));
}
function sautPli(d) {
  const rep = etat.images.map((im, j) => (["chargement", "pret", "fin"].includes(im.phase) ? j : -1)).filter((j) => j >= 0);
  const k = etat.image;
  if (d > 0) { const s = rep.find((j) => j > k); afficherImage(s ?? etat.images.length - 1); }
  else { const s = rep.filter((j) => j < k); afficherImage(s.length ? s[s.length - 1] : 0); }
}
function allerPli(n) {
  if (etat.mode !== "simulation") modeSimulation();
  const j = etat.images.findIndex((im) => im.pli === n && im.phase === "pret");
  if (j >= 0) afficherImage(j);
}
function arreterLecture() { if (etat.lecture) { clearInterval(etat.lecture); etat.lecture = null; } $("#btLecture").textContent = "▶"; }
function lecture() {
  if (etat.lecture) return arreterLecture();
  if (etat.image >= etat.images.length - 1) afficherImage(0);
  const v = Number($("#vitesse").value);
  // 90 ms par image à ×1 avec des pas deux fois plus fins : même durée qu'avant, deux fois plus d'images
  etat.lecture = setInterval(() => { if (etat.image >= etat.images.length - 1) arreterLecture(); else afficherImage(etat.image + 1); }, 90 / v);
  $("#btLecture").textContent = "⏸";
}

// ----------------------------------------------------------------------
// Événements des réglages
$("#qte").addEventListener("change", () => {
  const t = etat.tubes[etat.courant]; if (!t) return;
  t.quantite = Math.max(0, Math.round(Dl.nombre($("#qte").value, t.quantite))); $("#qte").value = t.quantite; afficherListe();
});
for (const id of ["#diam", "#ep"]) $(id).addEventListener("change", () => {
  const t = etat.tubes[etat.courant]; if (!t) return;
  const v = Dl.nombre($(id).value); if (v == null || v <= 0) return;
  if (id === "#diam") t.diametre = v; else t.epaisseur = v;
  recalculer();
});
$("#mat").addEventListener("change", () => { const t = etat.tubes[etat.courant]; if (!t) return; t.matiere = $("#mat").value.trim() || "Acier"; recalculer(); });
$("#sens").addEventListener("change", () => { const t = etat.tubes[etat.courant]; if (!t) return; t.reglages.sens = Number($("#sens").value); recalculer(); });
$("#soudAuto").addEventListener("change", () => {
  const t = etat.tubes[etat.courant]; if (!t) return;
  $("#soudAngle").disabled = $("#soudAuto").checked;
  t.reglages.psi = $("#soudAuto").checked ? null : Number($("#soudAngle").value);
  recalculer();
});
$("#soudAngle").addEventListener("input", () => ($("#soudVal").textContent = `${$("#soudAngle").value}°`));
$("#soudAngle").addEventListener("change", () => { const t = etat.tubes[etat.courant]; if (!t) return; t.reglages.psi = Number($("#soudAngle").value); recalculer(); });
$("#btPiece").onclick = modePiece;
$("#btSim").onclick = modeSimulation;
$("#zones").onchange = () => { if (etat.mode === "simulation") modeSimulation(); };
$("#btRecentrer").onclick = () => vue.recentrer();
$("#btZoom").onclick = () => { if (vue.mode === "simulation") vue.vueZoom(); };
$("#curseur").addEventListener("input", () => { arreterLecture(); afficherImage(Number($("#curseur").value)); });
$("#vitesse").onchange = () => { if (etat.lecture) { arreterLecture(); lecture(); } };
document.querySelectorAll("[data-sim]").forEach((b) => (b.onclick = () => {
  const a = b.dataset.sim;
  if (a !== "lecture") arreterLecture();
  ({ pliPrec: () => sautPli(-1), prec: () => afficherImage(etat.image - 1), lecture, suiv: () => afficherImage(etat.image + 1), pliSuiv: () => sautPli(1) })[a]();
}));

// ----------------------------------------------------------------------
// Actions de la barre
const champFichiers = $("#fichiers");
let modeOuverture = "ajouter";
champFichiers.onchange = async () => {
  const fs = [...champFichiers.files]; champFichiers.value = "";
  if (fs.length) await lireFichiers(fs, modeOuverture === "ouvrir");
};

const actions = {
  async ouvrir() {
    if (etat.tubes.length && !(await Dl.confirmer("Ouvrir", "Remplacer les tubes actuels par les fichiers ouverts ?\n(Utilisez « Ajouter » pour les compléter.)", "Remplacer"))) return;
    modeOuverture = "ouvrir"; champFichiers.click();
  },
  ajouter() { modeOuverture = "ajouter"; champFichiers.click(); },
  async lots() { await dialogueLots(); },
  async enregistrer() {
    if (!etat.tubes.length) return toast("Le lot est vide");
    const serveur = await St.serveurDisponible();
    const nom = await Dl.demanderTexte("Enregistrer le lot", serveur ? "Nom du lot (partagé sur le serveur) :" : "Nom du lot (enregistré dans ce navigateur) :", etat.nomLot || "Lot");
    if (!nom) return;
    try {
      const existants = await St.listerLots();
      if (existants.some((l) => l.nom === nom) && nom !== etat.nomLot && !(await Dl.confirmer("Enregistrer", `Le lot « ${nom} » existe déjà. Le remplacer ?`, "Remplacer"))) return;
      etat.nomLot = await St.ecrireLot(nom, lotVersTexte(etat.tubes, nom));
      afficherListe(); toast(`Lot « ${etat.nomLot} » enregistré` + (serveur ? " sur le serveur" : ""));
    } catch (e) { Dl.message("Enregistrer", e.message + "\n\nVous pouvez aussi utiliser « Télécharger » dans la fenêtre Lots."); }
  },
  async publier() {
    if (!etat.tubes.length) return toast("Le lot est vide");
    if (!At.peutPublier()) {
      return Dl.message("Publier pour l'atelier", "La publication n'est pas encore configurée sur ce poste.\n\nOuvrez Paramètres > onglet Partage : indiquez le dépôt GitHub, collez le jeton et choisissez le mot de passe atelier.");
    }
    let mdp = At.motDePasse();
    if (!mdp) {
      mdp = await Dl.demanderTexte("Mot de passe atelier", "Mot de passe qui chiffre les lots (le même sur toutes les tablettes) :", "", true);
      if (!mdp) return;
    }
    const fen = Dl.progression("Publication pour l'atelier");
    try {
      fen.maj("Vérification du mot de passe…", 0.1);
      const { nouveau } = await At.verifierMotDePasseDepot(mdp);
      fen.fermer();
      if (nouveau && !(await Dl.confirmer("Publier", `Premier lot publié : « ${"•".repeat(mdp.length)} » devient le mot de passe de l'atelier.\nIl faudra le saisir une fois sur chaque tablette.`, "Continuer"))) return;
      At.enregistrerMotDePasse(mdp);
      const nom = await Dl.demanderTexte("Publier pour l'atelier", "Nom du lot (un lot publié du même nom est remplacé) :", etat.nomLot || "Lot");
      if (!nom) return;
      const f2 = Dl.progression("Publication pour l'atelier");
      f2.maj("Chiffrement et envoi…", 0.5);
      try {
        await At.publierLot(nom, lotVersTexte(etat.tubes, nom), mdp, { tubes: etat.tubes.length, pieces: etat.tubes.reduce((a, t) => a + t.quantite, 0) });
      } finally { f2.fermer(); }
      etat.nomLot = nom; afficherListe();
      Dl.message("Publier pour l'atelier", `Lot « ${nom} » publié.\nIl apparaîtra dans « Lots » sur les tablettes d'ici 1 à 2 minutes (mise à jour du site GitHub).`);
    } catch (e) { fen.fermer(); console.error(e); Dl.message("Publier pour l'atelier", e.message); }
  },
  async points() { const t = await Dl.dialoguePoints(etat.machine); if (t) chargerTubes([...etat.tubes, t]); },
  async pdfTous() {
    if (!etat.tubes.length) return toast("Le lot est vide");
    const tubes = etat.tubes.filter((t) => t.quantite > 0);
    await exporterPdf(tubes.length ? tubes : etat.tubes, (etat.nomLot || "Dossier_cintrage") + ".pdf", etat.nomLot);
  },
  async pdfTube() {
    const t = etat.tubes[etat.courant]; if (!t) return toast("Aucun tube sélectionné");
    await exporterPdf([t], `${t.repere ? t.repere + " " : ""}${t.nom}`.replace(/[\\/:*?"<>|]+/g, "_") + ".pdf", "");
  },
  async etiquettes() {
    const tubes = etat.tubes.filter((t) => t.quantite > 0);
    if (!tubes.length) return toast("Le lot est vide");
    // id du lot publié (même nom) : le QR code ouvrira directement le tube ; sinon seulement l'application
    let idLot = null;
    try {
      const mdp = At.motDePasse();
      if (mdp && etat.nomLot) idLot = (await At.listerPublies(mdp)).find((l) => l.nom === etat.nomLot)?.id || null;
    } catch { /* hors ligne ou pas de lot publié */ }
    if (!idLot && !(await Dl.confirmer("Étiquettes",
      `Le lot « ${etat.nomLot || "sans nom"} » n'est pas publié pour l'atelier : les QR codes ouvriront seulement l'application.\n\nPour qu'ils ouvrent directement le tube, publiez d'abord le lot (bouton Publier), puis refaites les étiquettes.`,
      "Continuer quand même"))) return;
    const nb = tubes.reduce((s, t) => s + t.quantite, 0);
    const r = await Dl.demanderTexte("Étiquettes",
      `${nb} étiquette(s) 63,5 × 33,9 mm, planche A4 de 24 (3 × 8).\nCommencer à l'étiquette n° (1 à 24, de gauche à droite puis de haut en bas) :`, "1");
    if (r == null) return;
    const debut = Math.min(24, Math.max(1, Math.round(Dl.nombre(r, 1))));
    try {
      const { etiquettesPdf } = await import("./pdf.js");
      const base = location.origin + location.pathname.replace(/index\.html$/, "");
      const pieces = [];
      tubes.forEach((t, k) => {
        const p = programme(t);
        for (let i = 1; i <= t.quantite; i++)
          pieces.push({ repere: t.repere, nom: t.nom, longueur: p.longueurDebit, teinte: k, i, n: t.quantite,
            url: base + (idLot ? `?l=${encodeURIComponent(idLot)}&r=${encodeURIComponent(t.repere)}` : "") });
      });
      const blob = await etiquettesPdf(pieces, { lot: etat.nomLot || "", debut });
      St.telecharger(`Etiquettes ${etat.nomLot || "lot"}.pdf`.replace(/[\\/:*?"<>|]+/g, "_"), blob, "application/pdf");
      toast(`${pieces.length} étiquette(s) créée(s)`, 3000);
    } catch (e) { console.error(e); Dl.message("Étiquettes", "Échec : " + e.message); }
  },
  async csv() {
    if (!etat.tubes.length) return toast("Le lot est vide");
    const { debitCsv } = await import("./pdf.js");
    St.telecharger((etat.nomLot || "Debit") + ".csv", debitCsv(etat.tubes.map(programme)), "text/csv;charset=utf-8");
  },
  async parametres() {
    const m = await Dl.dialogueParametres(etat.machine);
    if (m) await appliquerParametres(m);
  },
  async etalonnage() {
    const m = await Dl.dialogueEtalonnage(etat.machine, etat.prog);
    if (m) await appliquerParametres(m);
  },
  retirer() {
    const ks = etat.coches.size ? [...etat.coches] : etat.courant >= 0 ? [etat.courant] : [];
    if (!ks.length) return;
    const garde = etat.tubes.filter((_, k) => !ks.includes(k));
    etat.courant = Math.min(etat.courant, garde.length - 1);
    chargerTubes(garde, { garderSelection: false });
  },
  async vider() {
    if (etat.tubes.length && (await Dl.confirmer("Vider", "Retirer tous les tubes du lot ?", "Vider"))) { etat.nomLot = ""; chargerTubes([]); }
  },
};
document.querySelectorAll("[data-action]").forEach((b) => (b.onclick = () => actions[b.dataset.action]()));

// Menu de la barre bleue plié / déplié : plus de place pour la vue 3D sur tablette.
// Par défaut plié sur écran tactile ; le choix est retenu par appareil.
const CLE_MENU = "tubecintrage.menuPlie";
let menuPlie = null;
try { menuPlie = JSON.parse(localStorage.getItem(CLE_MENU)); } catch { /* stockage indisponible */ }
if (typeof menuPlie !== "boolean") menuPlie = matchMedia("(pointer: coarse)").matches;
const appliquerMenu = () => {
  document.body.classList.toggle("menu-plie", menuPlie);
  $("#btMenu").setAttribute("aria-expanded", String(!menuPlie));
};
appliquerMenu();
$("#btMenu").onclick = () => {
  menuPlie = !menuPlie; appliquerMenu();
  try { localStorage.setItem(CLE_MENU, JSON.stringify(menuPlie)); } catch { /* stockage indisponible */ }
};

async function appliquerParametres(m) {
  if (m._publier) {
    try { await At.publierParametres(m); toast("Paramètres publiés pour tout l'atelier (actifs d'ici 1 à 2 minutes)", 4000); }
    catch (e) { Dl.message("Publier les paramètres", e.message); }
  }
  try {
    const ou = await St.enregistrerParametres(m);
    toast(ou === "serveur" ? "Paramètres enregistrés sur le serveur (tous les postes)" : "Paramètres enregistrés dans ce navigateur");
  } catch (e) { Dl.message("Paramètres", e.message); }
  etat.machine = m; etat.versionParams++;
  majStatut();
  if (etat.courant >= 0) recalculer();
  calculerTous();
}

async function exporterPdf(tubes, nomFichier, titreLot) {
  const progs = [];
  const fen = Dl.progression("Création du dossier PDF");
  try {
    for (let k = 0; k < tubes.length; k++) { fen.maj(`Calcul ${k + 1} / ${tubes.length}`, k / tubes.length * 0.2); await pause(); progs.push(programme(tubes[k])); }
    afficherListe();
    const nerr = progs.filter((p) => p.erreurs.length).length;
    if (nerr) {
      fen.fermer();
      if (!(await Dl.confirmer("Dossier PDF", `${nerr} tube(s) ont des erreurs (✖). Les inclure quand même ?\nLeurs fiches afficheront les erreurs.`, "Inclure"))) return;
      return exporterPdfSuite(progs, nomFichier, titreLot, Dl.progression("Création du dossier PDF"));
    }
    return exporterPdfSuite(progs, nomFichier, titreLot, fen);
  } catch (e) { fen.fermer(); console.error(e); Dl.message("Dossier PDF", "Échec : " + e.message); }
}
async function exporterPdfSuite(progs, nomFichier, titreLot, fen) {
  try {
    const { dossierPdf } = await import("./pdf.js");
    if (!window.jspdf) throw new Error("Module PDF non chargé (vendor/jspdf.umd.min.js)");
    fen.maj("Mise en page…", 0.2); await pause();
    const blob = await dossierPdf(progs, { titreLot, progression: async (i, n) => { fen.maj(`Fiche ${i} / ${n}`, 0.2 + 0.8 * i / n); await pause(); } });
    fen.fermer();
    St.telecharger(nomFichier, blob, "application/pdf");
    toast("Dossier PDF créé : " + nomFichier, 4000);
  } catch (e) { fen.fermer(); console.error(e); Dl.message("Dossier PDF", "Échec : " + e.message); }
}

/** Ouvre un lot publié et sélectionne un repère (lien d'un QR code d'étiquette). */
async function ouvrirLien(id, rep) {
  let mdp = At.motDePasse();
  for (let essai = 0; essai < 3; essai++) {
    if (!mdp) {
      mdp = await Dl.demanderTexte("Mot de passe atelier", "Mot de passe des lots (à saisir une seule fois sur cet appareil) :", "", true);
      if (!mdp) return;
    }
    try {
      const texte = await At.lirePublie(id, mdp);
      At.enregistrerMotDePasse(mdp);
      ouvrirLotTexte(texte, "", true);
      const k = etat.tubes.findIndex((t) => t.repere === rep);
      if (k >= 0) selectionner(k); else if (rep) toast(`Repère ${rep} introuvable dans ce lot`, 4000);
      history.replaceState(null, "", location.pathname);   // un rechargement ne rouvre pas le lien
      return;
    } catch (e) {
      if (/Mot de passe/.test(e.message)) { At.enregistrerMotDePasse(""); mdp = ""; toast("Mot de passe atelier incorrect", 3000); continue; }
      return Dl.message("Lot", e.message);
    }
  }
}

function ouvrirLotTexte(texte, nomDefaut, remplacer) {
  const r = chargerLot(texte);
  if (remplacer) etat.nomLot = r.nom || nomDefaut;
  chargerTubes([...(remplacer ? [] : etat.tubes), ...r.tubes], { garderSelection: !remplacer });
  if (r.rapport.length) Dl.message("Lot", r.rapport.join("\n"));
}

const dateFr = (d) => (d ? new Date(d).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "");

/** Section « Lots de l'atelier » (lots publiés sur le site, chiffrés). */
async function sectionPublies(conteneur, fermer) {
  const mdp = At.motDePasse();
  conteneur.innerHTML = `<h2>Lots de l'atelier</h2>`;
  const corps = document.createElement("div"); conteneur.appendChild(corps);
  const demander = (erreur = "") => {
    corps.innerHTML = `${erreur ? `<p class="resultat">${Dl.echapper(erreur)}</p>` : ""}
      <div class="champs"><label for="mdpA">Mot de passe atelier</label><div class="ligne"><input type="password" id="mdpA" autocomplete="off"><button type="button" class="petit primaire" id="mdpOk">Valider</button></div></div>
      <p class="discret" style="font-size:13px">À saisir une seule fois sur cette tablette ou ce poste.</p>`;
    const valider = () => { At.enregistrerMotDePasse(corps.querySelector("#mdpA").value); sectionPublies(conteneur, fermer); };
    corps.querySelector("#mdpOk").onclick = valider;
    corps.querySelector("#mdpA").addEventListener("keydown", (e) => { if (e.key === "Enter") valider(); });
  };
  if (!mdp) return demander();
  corps.innerHTML = `<p class="discret">Chargement…</p>`;
  let lots;
  try { lots = await At.listerPublies(mdp); }
  catch (e) {
    if (/Mot de passe/.test(e.message)) { At.enregistrerMotDePasse(""); return demander(e.message); }
    corps.innerHTML = `<p class="resultat">${Dl.echapper(e.message)}</p>`; return;
  }
  const publier = At.peutPublier();
  corps.innerHTML = lots.length ? `<ul class="lots-liste">${lots.map((l) => `<li data-id="${Dl.echapper(l.id)}"><span class="n">${Dl.echapper(l.nom)}<br>
      <small>${dateFr(l.modifie)}${l.tubes ? ` · ${l.tubes} repère(s), ${l.pieces} pièce(s)` : ""}</small></span>
      <button type="button" class="petit primaire" data-a="ouvrir">Ouvrir</button><button type="button" class="petit" data-a="ajouter">Ajouter</button>
      ${publier ? `<button type="button" class="petit" data-a="retirer" title="Retirer de l'atelier">🗑</button>` : ""}</li>`).join("")}</ul>`
    : `<p>Aucun lot publié pour l'instant.</p>`;
  corps.querySelectorAll("li[data-id]").forEach((li) => {
    const l = lots.find((x) => x.id === li.dataset.id);
    const ouvrirLot = async (remplacer) => {
      try { const t = await At.lirePublie(l.id, mdp); fermer(); ouvrirLotTexte(t, l.nom, remplacer); }
      catch (e) { Dl.message("Lot", e.message); }
    };
    li.querySelector(".n").onclick = () => ouvrirLot(true);
    li.querySelector('[data-a="ouvrir"]').onclick = () => ouvrirLot(true);
    li.querySelector('[data-a="ajouter"]').onclick = () => ouvrirLot(false);
    li.querySelector('[data-a="retirer"]')?.addEventListener("click", async () => {
      if (!(await Dl.confirmer("Retirer", `Retirer le lot « ${l.nom} » de l'atelier ?\n(Il reste dans l'historique du dépôt GitHub.)`, "Retirer"))) return;
      try { await At.supprimerPublie(l.id, mdp); toast("Lot retiré (le site se met à jour en 1 à 2 minutes)"); li.remove(); }
      catch (e) { Dl.message("Retirer", e.message); }
    });
  });
}

/** Section des lots enregistrés sur le serveur ou dans ce navigateur. */
async function sectionLocaux(conteneur, serveur, fermer) {
  let lots = [];
  try { lots = await St.listerLots(); } catch (e) { conteneur.innerHTML = `<p class="resultat">${Dl.echapper(e.message)}</p>`; return; }
  conteneur.innerHTML = `<h2>${serveur ? "Lots du serveur" : "Lots enregistrés dans ce navigateur"}</h2>
    ${lots.length ? `<ul class="lots-liste">${lots.map((l) => `<li data-nom="${Dl.echapper(l.nom)}"><span class="n">${Dl.echapper(l.nom)}<br><small>${dateFr(l.modifie)}</small></span>
      <button type="button" class="petit primaire" data-a="ouvrir">Ouvrir</button><button type="button" class="petit" data-a="ajouter">Ajouter</button>
      <button type="button" class="petit" data-a="telecharger" title="Télécharger le fichier .tclot">⬇</button><button type="button" class="petit" data-a="supprimer" title="Supprimer">🗑</button></li>`).join("")}</ul>`
    : `<p class="discret">Aucun.</p>`}
    <div class="ligne-boutons" style="justify-content:flex-start"><button type="button" class="petit" id="lotTel" ${etat.tubes.length ? "" : "disabled"}>Télécharger le lot courant (.tclot)</button></div>`;
  conteneur.querySelector("#lotTel").onclick = () => St.telecharger((etat.nomLot || "Lot") + ".tclot", lotVersTexte(etat.tubes, etat.nomLot), "application/json");
  conteneur.querySelectorAll("li[data-nom]").forEach((li) => {
    const nom = li.dataset.nom;
    const ouvrirLot = async (remplacer) => {
      try { const t = await St.lireLot(nom); fermer(); ouvrirLotTexte(t, nom, remplacer); } catch (e) { Dl.message("Lot", e.message); }
    };
    li.querySelector(".n").onclick = () => ouvrirLot(true);
    li.querySelector('[data-a="ouvrir"]').onclick = () => ouvrirLot(true);
    li.querySelector('[data-a="ajouter"]').onclick = () => ouvrirLot(false);
    li.querySelector('[data-a="telecharger"]').onclick = async () => St.telecharger(nom + ".tclot", await St.lireLot(nom), "application/json");
    li.querySelector('[data-a="supprimer"]').onclick = async () => {
      if (await Dl.confirmer("Supprimer", `Supprimer définitivement le lot « ${nom} » ?`, "Supprimer")) { await St.supprimerLot(nom); sectionLocaux(conteneur, serveur, fermer); }
    };
  });
}

async function dialogueLots() {
  const serveur = await St.serveurDisponible();
  const corps = document.createElement("div");
  const pub = document.createElement("section"), loc = document.createElement("section");
  loc.style.marginTop = "18px";
  if (!serveur) corps.appendChild(pub);
  corps.appendChild(loc);
  const fermer = () => corps.closest("dialog")?.close();
  const attente = Dl.ouvrir({ titre: "Lots", corps });
  if (!serveur) sectionPublies(pub, fermer);
  sectionLocaux(loc, serveur, fermer);
  await attente;
}

// ----------------------------------------------------------------------
// Glisser-déposer et clavier
let profondeur = 0;
window.addEventListener("dragenter", (e) => { if ([...e.dataTransfer.types].includes("Files")) { profondeur++; $("#depot").classList.add("visible"); e.preventDefault(); } });
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("dragleave", () => { if (--profondeur <= 0) { profondeur = 0; $("#depot").classList.remove("visible"); } });
window.addEventListener("drop", async (e) => {
  e.preventDefault(); profondeur = 0; $("#depot").classList.remove("visible");
  const fs = [...e.dataTransfer.files].filter((f) => /\.(json|step|stp|csv|txt|tclot)$/i.test(f.name));
  if (fs.length) await lireFichiers(fs, false); else toast("Aucun fichier reconnu (.json, .step, .stp, .csv, .txt, .tclot)");
});
window.addEventListener("keydown", (e) => {
  if (document.querySelector("dialog[open]")) return;
  const champ = /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName);
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o") { e.preventDefault(); e.shiftKey ? actions.ajouter() : actions.ouvrir(); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); actions.enregistrer(); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p") { e.preventDefault(); e.shiftKey ? actions.pdfTous() : actions.pdfTube(); }
  else if (champ) return;
  else if (e.key === "ArrowDown" && etat.courant < etat.tubes.length - 1) { e.preventDefault(); selectionner(etat.courant + 1); }
  else if (e.key === "ArrowUp" && etat.courant > 0) { e.preventDefault(); selectionner(etat.courant - 1); }
  else if (e.key === "Delete") actions.retirer();
  else if (etat.mode === "simulation" && e.key === "ArrowRight") afficherImage(etat.image + 1);
  else if (etat.mode === "simulation" && e.key === "ArrowLeft") afficherImage(etat.image - 1);
  else if (etat.mode === "simulation" && e.key === " ") { e.preventDefault(); lecture(); }
});

async function majStatut() {
  const av = aVerifier(etat.machine), serveur = await St.serveurDisponible();
  $("#statut").innerHTML = `<b>${Dl.echapper(etat.machine.nom)}</b> · ${serveur ? "serveur de l'atelier : lots et paramètres partagés" : "lots et réglages modifiés gardés dans ce navigateur (lots partagés : fichiers .tclot)"}`
    + (av.length ? ` · à vérifier : ${Dl.echapper(av.join(" · "))}` : " · paramètres vérifiés");
}

// ----------------------------------------------------------------------
(async function demarrer() {
  etat.machine = await St.chargerParametres();
  majStatut();
  selectionner(-1);
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost") && !globalThis.TC_EMBARQUE)
    navigator.serviceWorker.register("sw.js").catch(() => {});
  // lien d'étiquette (QR code) : ?l=<id du lot publié>&r=<repère> ouvre directement ce lot sur ce tube
  const lien = new URLSearchParams(location.search);
  if (lien.get("l")) await ouvrirLien(lien.get("l"), lien.get("r"));
  else if (!(await St.serveurDisponible()) && At.depotDuSite() && !etat.tubes.length) dialogueLots();
  window.tubecintrage = { etat, lireFichiers, actions, programme };   // pour les tests et le dépannage
})();
