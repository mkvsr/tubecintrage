// Boîtes de dialogue : paramètres machine, étalonnage, saisie par points, lots, progression.
import { machineDefaut, machineDepuis, outilDefaut, etalonnageDefaut } from "./core/parametres.js";
import { tubeDepuisPoints } from "./core/geometrie.js";
import { telecharger, oublierParametresLocaux } from "./stockage.js";

// Chaque boîte de dialogue est un élément <dialog> créé à la demande (elles peuvent s'empiler).
function nouveauDialogue() {
  const d = document.createElement("dialog");
  document.body.appendChild(d);
  d.addEventListener("close", () => setTimeout(() => d.remove(), 0));
  return d;
}
export const echapper = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const nombre = (v, defaut = null) => {
  const x = Number(String(v ?? "").trim().replace(",", "."));
  return String(v ?? "").trim() === "" || !Number.isFinite(x) ? defaut : x;
};
const fmt = (v) => (v == null ? "" : String(+Number(v).toPrecision(8)));

/** Ouvre la boîte de dialogue. `boutons` : [{texte, valeur, primaire}]. Résout avec la valeur du bouton (null si fermée). */
export function ouvrir({ titre, corps, boutons = [{ texte: "Fermer", valeur: null }], avantFermer = null, large = false }) {
  const d = nouveauDialogue();
  d.style.width = large ? "min(1100px, 97vw)" : "";
  const racine = document.createElement("div"); racine.className = "dlg";
  racine.innerHTML = `<div class="dlg-tete"><span>${echapper(titre)}</span><button type="button" aria-label="Fermer">×</button></div>`;
  const c = document.createElement("div"); c.className = "dlg-corps";
  if (typeof corps === "string") c.innerHTML = corps; else c.appendChild(corps);
  racine.appendChild(c);
  const pied = document.createElement("div"); pied.className = "dlg-pied";
  racine.appendChild(pied);
  d.appendChild(racine);
  return new Promise((ok) => {
    let valeur = null;
    d.addEventListener("close", () => ok(valeur));
    const fermer = async (v) => {
      if (avantFermer && v !== null) { const r = await avantFermer(v); if (r === false) return; }
      valeur = v; d.close();
    };
    racine.querySelector(".dlg-tete button").onclick = () => fermer(null);
    d.oncancel = (e) => { e.preventDefault(); fermer(null); };
    for (const b of boutons) {
      const el = document.createElement("button"); el.type = "button"; el.textContent = b.texte;
      if (b.primaire) el.className = "primaire";
      el.onclick = () => fermer(b.valeur);
      pied.appendChild(el);
    }
    d.showModal();
  });
}

export function message(titre, texte, boutons) {
  const p = document.createElement("div");
  p.style.whiteSpace = "pre-wrap"; p.style.lineHeight = "1.45"; p.textContent = texte;
  return ouvrir({ titre, corps: p, boutons: boutons || [{ texte: "OK", valeur: true, primaire: true }] });
}

export const confirmer = (titre, texte, oui = "Oui", non = "Annuler") =>
  message(titre, texte, [{ texte: non, valeur: false }, { texte: oui, valeur: true, primaire: true }]).then((v) => v === true);

export async function demanderTexte(titre, libelle, defaut = "", secret = false) {
  const p = document.createElement("div");
  p.innerHTML = `<label style="display:flex;flex-direction:column;gap:6px">${echapper(libelle)}<input type="${secret ? "password" : "text"}" value="${echapper(defaut)}" autocomplete="off"></label>`;
  const inp = p.querySelector("input");
  setTimeout(() => { inp.focus(); inp.select(); }, 30);
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") p.closest("dialog").querySelector(".dlg-pied .primaire").click(); });
  const v = await ouvrir({ titre, corps: p, boutons: [{ texte: "Annuler", valeur: null }, { texte: "OK", valeur: "ok", primaire: true }] });
  return v ? inp.value.trim() : null;
}

/** Fenêtre de progression non bloquante. */
export function progression(titre) {
  const d = nouveauDialogue();
  d.innerHTML = `<div class="dlg"><div class="dlg-tete"><span>${echapper(titre)}</span></div>
    <div class="dlg-corps"><div class="etape">Préparation…</div><div class="progression"><div></div></div></div></div>`;
  d.oncancel = (e) => e.preventDefault();
  d.showModal();
  return {
    maj(texte, fraction) { d.querySelector(".etape").textContent = texte; d.querySelector(".progression div").style.width = `${Math.round(fraction * 100)}%`; },
    fermer() { d.close(); },
  };
}

// ----------------------------------------------------------------------
function onglets(defs) {
  const w = document.createElement("div");
  const barre = document.createElement("div"); barre.className = "onglets";
  w.appendChild(barre);
  const pages = defs.map(([nom, el], k) => {
    const b = document.createElement("button"); b.type = "button"; b.textContent = nom; barre.appendChild(b);
    const p = document.createElement("div"); p.appendChild(el); if (k) p.hidden = true; w.appendChild(p);
    b.onclick = () => { pages.forEach(([bb, pp]) => { bb.classList.remove("actif"); pp.hidden = true; }); b.classList.add("actif"); p.hidden = false; };
    if (!k) b.classList.add("actif");
    return [b, p];
  });
  return w;
}

function html(s) { const d = document.createElement("div"); d.innerHTML = s; return d; }

/** Tableau éditable : colonnes [{t, cle, type: "texte"|"nombre"|"case"|["a","b"]}]. */
function tableEditable(colonnes, lignes, nouvelle) {
  const w = document.createElement("div");
  w.innerHTML = `<div class="table-defile"><table class="edition"><thead><tr>${colonnes.map((c) => `<th>${echapper(c.t)}</th>`).join("")}<th></th></tr></thead><tbody></tbody></table></div>
    <div class="ligne-boutons" style="justify-content:flex-start"><button type="button" class="petit">Ajouter une ligne</button></div>`;
  const tb = w.querySelector("tbody");
  const ajouter = (l) => {
    const tr = document.createElement("tr");
    tr.innerHTML = colonnes.map((c) => {
      const v = l[c.cle];
      if (c.type === "case") return `<td style="text-align:center"><input type="checkbox" ${v ? "checked" : ""}></td>`;
      if (Array.isArray(c.type)) return `<td><select>${c.type.map((o) => `<option ${o === v ? "selected" : ""}>${echapper(o)}</option>`).join("")}</select></td>`;
      return `<td><input type="text" ${c.type === "nombre" ? 'inputmode="decimal"' : ""} value="${echapper(c.type === "nombre" ? fmt(v) : v)}"></td>`;
    }).join("") + `<td><button type="button" title="Supprimer la ligne">×</button></td>`;
    tr.querySelector("td:last-child button").onclick = () => tr.remove();
    tb.appendChild(tr);
  };
  lignes.forEach(ajouter);
  w.querySelector(".ligne-boutons button").onclick = () => ajouter(nouvelle());
  w.valeurs = () => [...tb.querySelectorAll("tr")].map((tr) => {
    const o = {};
    [...tr.querySelectorAll("td")].slice(0, colonnes.length).forEach((td, k) => {
      const c = colonnes[k], el = td.querySelector("input,select");
      o[c.cle] = c.type === "case" ? el.checked : c.type === "nombre" ? nombre(el.value) : el.value.trim();
    });
    return o;
  });
  return w;
}

// ----------------------------------------------------------------------
export async function dialogueParametres(machine) {
  const m = JSON.parse(JSON.stringify(machine));
  const ch = (id, lib, val, extra = "") => `<label for="${id}">${lib}</label><div class="ligne"><input type="number" id="${id}" step="any" value="${fmt(val)}">${extra}</div>`;
  const ok = (id, v, t) => `<label class="case"><input type="checkbox" id="${id}" ${v ? "checked" : ""}> ${t}</label>`;
  const pMachine = html(`<div class="champs">
    <label for="p_nom">Nom</label><input type="text" id="p_nom" value="${echapper(m.nom)}">
    ${ch("p_lmax", "Longueur maxi (marque zéro → chariot reculé), mm", m.longueur_max)}
    ${ch("p_dec", "Décalage du repère zéro, mm", m.decalage_zero, ok("p_decok", m.decalage_verifie, "vérifié"))}
    <label for="p_sensB">Sens de l'afficheur B</label><div class="ligne"><select id="p_sensB">
      <option value="1" ${m.sens_B === 1 ? "selected" : ""}>B augmente en tournant ANTIHORAIRE vu du chariot</option>
      <option value="-1" ${m.sens_B === -1 ? "selected" : ""}>B augmente en tournant HORAIRE vu du chariot (vers l'outil)</option></select>${ok("p_sensBok", m.sens_B_verifie, "vérifié")}</div>
    ${ch("p_dar", "Droite mini après le dernier pli, mm", m.droite_arriere_mini, ok("p_darok", m.droite_arriere_mesuree, "mesurée"))}
    ${ch("p_H", "Hauteur axe / sol, mm", m.hauteur_axe_sol)}
    ${ch("p_amax", "Angle maxi β + α, °", m.angle_max)}
    ${ch("p_rmax", "Retour élastique maxi, °", m.retour_max)}
    ${ch("p_dmax", "Ø maxi avec mandrin, mm", m.diametre_max)}
    ${ch("p_Rmax", "Rayon maxi, mm", m.rayon_max)}
    ${ch("p_marge", "Marge de collision, mm", m.marge_collision)}
    <span></span>${ok("p_surl", m.surlongueur_auto, "Ajouter automatiquement les surlongueurs (à recouper)")}
    <span></span>${ok("p_obs", m.obstacles_mesures, "Dimensions des obstacles mesurées sur la machine")}
    <label for="p_soud">Position de la soudure au chargement</label><input type="text" id="p_soud" value="${echapper(m.position_soudure)}">
  </div>`);
  const pDebit = html(`<div class="champs">
    ${ch("p_barre", "Longueur des barres, mm", m.barre_longueur)}
    ${ch("p_trait", "Trait de scie, mm", m.trait_scie)}
    ${ch("p_chute", "Chute réutilisable à partir de, mm", m.chute_reutilisable)}</div>`);
  const tOut = tableEditable([{ t: "Nom", cle: "nom" }, { t: "Ø (mm)", cle: "diametre", type: "nombre" }, { t: "Rayon (mm)", cle: "rayon", type: "nombre" },
    { t: "Droite mini / mors (mm)", cle: "droite_mini", type: "nombre" }, { t: "Pré-extraction (°)", cle: "pre_extraction", type: "nombre" },
    { t: "Vitesse (%)", cle: "vitesse", type: "nombre" }], m.outils, () => ({ ...outilDefaut(), nom: "Nouvel outil" }));
  const tEta = tableEditable([{ t: "Outil", cle: "outil" }, { t: "Matière (* = toutes)", cle: "matiere" }, { t: "Compensation (°)", cle: "retour_a", type: "nombre" },
    { t: "+ par degré de pli", cle: "retour_b", type: "nombre" }, { t: "Coef. arc", cle: "coef_arc", type: "nombre" }, { t: "Étalonné", cle: "etalonne", type: "case" }],
    m.etalonnages, () => etalonnageDefaut(m.outils[0] ? m.outils[0].nom : ""));
  const tObs = tableEditable([{ t: "Nom", cle: "nom" }, ...["xmin", "xmax", "ymin", "ymax", "zmin", "zmax"].map((k) => ({ t: k.replace("min", " min").replace("max", " max").toUpperCase(), cle: k, type: "nombre" })),
    { t: "Gravité", cle: "gravite", type: ["erreur", "alerte"] }, { t: "Actif", cle: "actif", type: "case" }], m.obstacles,
    () => ({ nom: "Obstacle", xmin: -500, xmax: 500, ymin: -500, ymax: 500, zmin: -1000, zmax: 0, gravite: "erreur", actif: true }));
  const pObs = document.createElement("div");
  pObs.appendChild(html(`<div class="aide">Boîtes dans le repère machine (mm) : origine sur l'axe du tube au point de tangence, X sens d'avance du tube, Y à l'opposé de l'opérateur, Z vers le haut. Gravité « erreur » = collision, « alerte » = zone à surveiller.</div>`));
  pObs.appendChild(tObs);
  const At = await import("./atelier.js");
  const cfg = At.config();
  const pFich = html(`<div class="aide">Ce qui est publié est lu par tous les postes et les tablettes à leur ouverture. Ce qui est seulement enregistré reste dans ce navigateur.</div>
    <div class="champs">
      <span></span><label class="case"><input type="checkbox" id="p_pub" ${At.peutPublier() ? "checked" : "disabled"}> Publier ces paramètres pour tout l'atelier en enregistrant</label>
    </div>
    <h2 style="margin-top:18px">Publication sur GitHub (poste qui prépare les lots)</h2>
    <div class="champs">
      <label for="g_depot">Dépôt (compte/nom)</label><input type="text" id="g_depot" value="${echapper(cfg.depot)}" placeholder="moncompte/tubecintrage">
      <label for="g_branche">Branche</label><input type="text" id="g_branche" value="${echapper(cfg.branche)}">
      <label for="g_jeton">Jeton GitHub</label><input type="password" id="g_jeton" value="${echapper(cfg.jeton)}" placeholder="github_pat_…" autocomplete="off">
      <span></span><div class="ligne"><button type="button" class="petit" id="g_test">Tester la connexion</button><span id="g_res" class="discret"></span></div>
    </div>
    <p class="discret" style="font-size:13px">Jeton à créer sur github.com > Settings > Developer settings > Fine-grained tokens : accès à ce seul dépôt, droit « Contents : Read and write ». Il reste dans ce navigateur ; les tablettes n'en ont pas besoin.</p>
    <h2 style="margin-top:18px">Mot de passe atelier</h2>
    <div class="champs"><label for="g_mdp">Mot de passe des lots</label><input type="password" id="g_mdp" value="${echapper(At.motDePasse())}" autocomplete="off"></div>
    <p class="discret" style="font-size:13px">Les lots publiés sont chiffrés avec ce mot de passe : sans lui, les fichiers sur GitHub sont illisibles. Le même mot de passe doit être saisi une fois sur chaque tablette.</p>
    <h2 style="margin-top:18px">Fichier</h2>
    <div class="aide">Pour reprendre les réglages de la version Python, importez le fichier <b>parametres_machine.json</b> du dossier <b>TubeCintrage</b> de votre profil utilisateur.</div>
    <div class="ligne-boutons" style="justify-content:flex-start"><button type="button" class="petit" id="p_imp">Importer un fichier…</button>
    <button type="button" class="petit" id="p_exp">Exporter</button><button type="button" class="petit" id="p_site">Revenir aux réglages publiés</button>
    <button type="button" class="petit" id="p_def">Valeurs par défaut</button></div>
    <input type="file" id="p_fic" accept=".json" hidden>`);
  let remplace = null;
  const sauverCfg = () => {
    At.enregistrerConfig({ depot: pFich.querySelector("#g_depot").value, branche: pFich.querySelector("#g_branche").value, jeton: pFich.querySelector("#g_jeton").value });
    At.enregistrerMotDePasse(pFich.querySelector("#g_mdp").value);
    const ok = At.peutPublier(), c = pFich.querySelector("#p_pub");
    c.disabled = !ok; if (!ok) c.checked = false;
  };
  pFich.querySelectorAll("#g_depot,#g_branche,#g_jeton,#g_mdp").forEach((e) => e.addEventListener("change", sauverCfg));
  pFich.querySelector("#g_test").onclick = async () => {
    sauverCfg();
    const r = pFich.querySelector("#g_res"); r.textContent = "…";
    try { r.textContent = "✔ " + (await At.tester()); r.style.color = "var(--ok)"; }
    catch (e) { r.textContent = "✖ " + e.message; r.style.color = "var(--erreur)"; }
  };
  pFich.querySelector("#p_exp").onclick = () => telecharger("parametres_machine.json", JSON.stringify(m, null, 1), "application/json");
  pFich.querySelector("#p_site").onclick = () => { oublierParametresLocaux(); location.reload(); };
  pFich.querySelector("#p_imp").onclick = () => pFich.querySelector("#p_fic").click();
  pFich.querySelector("#p_fic").onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { remplace = machineDepuis(JSON.parse(await f.text())); pFich.closest("dialog").close(); }
    catch (err) { await message("Paramètres", "Fichier illisible : " + err.message); }
  };
  pFich.querySelector("#p_def").onclick = () => { remplace = machineDefaut(); pFich.closest("dialog").close(); };
  const corps = onglets([["Machine", pMachine], ["Débit", pDebit], ["Outillages", tOut], ["Compensation / allongement", tEta], ["Obstacles", pObs], ["Partage", pFich]]);
  const q = (id) => corps.querySelector("#" + id);
  let erreur = null;
  const v = await ouvrir({
    titre: "Paramètres machine", corps, large: true,
    boutons: [{ texte: "Annuler", valeur: null }, { texte: "Enregistrer", valeur: "ok", primaire: true }],
    avantFermer: async () => {
      erreur = null;
      const n = (id, def) => nombre(q(id).value, def);
      m.nom = q("p_nom").value.trim() || m.nom;
      m.longueur_max = n("p_lmax", m.longueur_max); m.decalage_zero = n("p_dec", 0); m.decalage_verifie = q("p_decok").checked;
      m.sens_B = Number(q("p_sensB").value); m.sens_B_verifie = q("p_sensBok").checked;
      m.droite_arriere_mini = n("p_dar", m.droite_arriere_mini); m.droite_arriere_mesuree = q("p_darok").checked;
      m.hauteur_axe_sol = n("p_H", m.hauteur_axe_sol); m.angle_max = n("p_amax", m.angle_max); m.retour_max = n("p_rmax", m.retour_max);
      m.diametre_max = n("p_dmax", m.diametre_max); m.rayon_max = n("p_Rmax", m.rayon_max); m.marge_collision = n("p_marge", m.marge_collision);
      m.surlongueur_auto = q("p_surl").checked; m.obstacles_mesures = q("p_obs").checked; m.position_soudure = q("p_soud").value.trim();
      m.barre_longueur = n("p_barre", m.barre_longueur); m.trait_scie = n("p_trait", m.trait_scie); m.chute_reutilisable = n("p_chute", m.chute_reutilisable);
      m.outils = tOut.valeurs().filter((o) => o.nom).map((o) => ({ ...outilDefaut(), ...o, droite_mini: o.droite_mini ?? 150, pre_extraction: o.pre_extraction ?? 0,
        vitesse: Math.min(100, Math.max(10, o.vitesse ?? 100)) }));
      m.etalonnages = tEta.valeurs().filter((e) => e.outil).map((e) => ({ ...etalonnageDefaut(e.outil), ...e, matiere: e.matiere || "*",
        retour_a: e.retour_a ?? 0, retour_b: e.retour_b ?? 0, coef_arc: e.coef_arc ?? 1 }));
      m.obstacles = tObs.valeurs().filter((o) => o.nom);
      for (const o of m.outils) if (o.diametre == null || o.rayon == null) erreur = `Outil « ${o.nom} » : diamètre ou rayon invalide`;
      for (const o of m.obstacles) if (["xmin", "xmax", "ymin", "ymax", "zmin", "zmax"].some((k) => o[k] == null)) erreur = `Obstacle « ${o.nom} » : coordonnée invalide`;
      if (erreur) { await message("Paramètres", erreur); return false; }
      return true;
    },
  });
  sauverCfg();
  if (remplace) return remplace;
  if (v) Object.defineProperty(m, "_publier", { value: q("p_pub").checked, enumerable: false });
  return v ? m : null;
}

// ----------------------------------------------------------------------
export async function dialogueEtalonnage(machine, prog) {
  const m = JSON.parse(JSON.stringify(machine));
  let modifie = false;
  const opts = m.outils.map((o, k) => `<option value="${k}">${echapper(o.nom)}</option>`).join("");
  const pZero = html(`<div class="aide">Vérifie que la marque zéro de l'outil correspond bien au début du pli.<ol>
      <li>Extrémité AVANT d'un tube d'essai sur la marque zéro de l'outil, bouton jaune (zéro Y).</li>
      <li>Avancer jusqu'à une valeur Y connue (par exemple 500), cintrer à 90°.</li>
      <li>Mesurer l'angle obtenu et la cote A (schéma ci-dessous).</li></ol></div>
    <div style="text-align:center"><img src="${globalThis.TC_EMBARQUE?.schema || "img/schema_zero.svg"}" alt="Schéma de la mesure de la cote A" style="max-width:100%;height:auto;border:1px solid var(--trait);border-radius:6px"></div>
    <p class="discret" style="font-size:13px">A = de l'extrémité avant jusqu'à l'axe de l'autre branche. En pratique : équerre contre le dessous de cette branche, cote lue − Ø/2. Attendu : A = 500 + rayon (645 mm pour R145).</p>
    <div class="champs"><label>Outil</label><select id="z_out">${opts}</select>
      <label>Y utilisé pour le pli (mm)</label><input type="number" id="z_y" value="500" step="any">
      <label>Angle obtenu (°)</label><input type="number" id="z_ang" value="90" step="any">
      <label>Cote A mesurée (mm)</label><input type="number" id="z_a" value="645" step="any"></div>
    <p class="resultat" id="z_res">—</p>
    <div class="ligne-boutons" style="justify-content:flex-start"><button type="button" class="primaire petit" id="z_ok">Enregistrer le décalage</button></div>`);
  let dec = null;
  const calcZero = () => {
    const o = m.outils[Number(pZero.querySelector("#z_out").value)];
    if (!o) { pZero.querySelector("#z_res").textContent = "Aucun outil défini"; return; }
    const ang = nombre(pZero.querySelector("#z_ang").value, 90), y = nombre(pZero.querySelector("#z_y").value, 0), a = nombre(pZero.querySelector("#z_a").value, 0);
    const T = o.rayon * Math.tan((ang * Math.PI) / 360), debut = a - T;
    dec = Math.round((y - debut) * 10) / 10;
    pZero.querySelector("#z_res").textContent = `Début réel du pli à ${debut.toFixed(1).replace(".", ",")} mm de l'extrémité → décalage ${dec >= 0 ? "+" : ""}${String(dec).replace(".", ",")} mm (actuel ${m.decalage_zero >= 0 ? "+" : ""}${String(m.decalage_zero).replace(".", ",")})`
      + (Math.abs(dec) > 30 ? " — écart important, vérifier les mesures" : "");
  };
  pZero.querySelectorAll("input,select").forEach((e) => e.addEventListener("input", calcZero));
  calcZero();
  pZero.querySelector("#z_ok").onclick = () => { if (dec == null) return; m.decalage_zero = dec; m.decalage_verifie = true; modifie = true; calcZero(); flash(pZero.querySelector("#z_ok"), "Enregistré ✔"); };

  const pB = html(`<div class="aide"><ol><li>Appuyer sur le bouton rouge (zéro B).</li><li>Se placer derrière le chariot en regardant vers la matrice.</li>
    <li>Tourner le tube d'un quart de tour dans le sens des aiguilles d'une montre.</li><li>Noter la valeur affichée.</li></ol></div>
    <div class="champs"><label>Valeur affichée</label><select id="b_val"><option value="1" ${m.sens_B === 1 ? "selected" : ""}>L'afficheur indique environ −90 (ou 270)</option>
    <option value="-1" ${m.sens_B === -1 ? "selected" : ""}>L'afficheur indique environ +90</option></select></div>
    <div class="ligne-boutons" style="justify-content:flex-start"><button type="button" class="primaire petit" id="b_ok">Enregistrer le sens de B</button></div>`);
  pB.querySelector("#b_ok").onclick = () => { m.sens_B = Number(pB.querySelector("#b_val").value); m.sens_B_verifie = true; modifie = true; flash(pB.querySelector("#b_ok"), "Enregistré ✔"); };

  const pE = html(`<div class="aide">Pli d'essai de début de série : un tube de longueur connue L0, un seul pli (par exemple 90°), avec la compensation habituelle (souvent 3°).
    Mesurez ensuite l'angle obtenu et, si vous voulez aussi l'allongement, les deux branches A et B jusqu'au sommet (intersection des axes : cote à l'intersection des génératrices extérieures − Ø/2).</div>
    <div class="champs"><label>Outil</label><select id="e_out">${opts}</select>
      <label>Matière (* = toutes)</label><input type="text" id="e_mat" value="${echapper(prog ? prog.tube.matiere : "*")}">
      <label>Angle saisi (°)</label><input type="number" id="e_beta" value="90" step="any">
      <label>Compensation saisie (°)</label><input type="number" id="e_alpha" value="3" step="any">
      <label>Angle mesuré (°)</label><input type="number" id="e_mes" value="90" step="any">
      <label>Longueur du tube d'essai L0 (mm)</label><input type="number" id="e_L0" value="1000" step="any">
      <label>Branche A au sommet (mm)</label><input type="number" id="e_A" value="0" step="any">
      <label>Branche B au sommet (mm)</label><input type="number" id="e_B" value="0" step="any"></div>
    <p class="resultat" id="e_res" style="white-space:pre-line">—</p>
    <div class="ligne-boutons" style="justify-content:flex-start"><button type="button" class="primaire petit" id="e_ok">Enregistrer l'étalonnage</button></div>`);
  let res = null;
  const v = (id) => nombre(pE.querySelector("#" + id).value, 0);
  const calcEta = () => {
    const o = m.outils[Number(pE.querySelector("#e_out").value)];
    if (!o) { pE.querySelector("#e_res").textContent = "Aucun outil défini"; return; }
    const req = v("e_alpha") + (v("e_beta") - v("e_mes"));
    let txt = `Compensation à saisir : ${req.toFixed(1).replace(".", ",")}°  (= ${v("e_alpha")} + ${v("e_beta")} − ${v("e_mes")})`;
    let k = null;
    if (v("e_A") > 0 && v("e_B") > 0 && v("e_L0") > 0) {
      const th = (v("e_mes") * Math.PI) / 180, T = o.rayon * Math.tan(th / 2);
      const consomme = v("e_L0") - (v("e_A") - T) - (v("e_B") - T);
      k = consomme / (o.rayon * th);
      txt += `\nLongueur consommée par le pli : ${consomme.toFixed(1).replace(".", ",")} mm → coefficient d'arc ${k.toFixed(4).replace(".", ",")}`;
      if (!(k > 0.85 && k < 1.1)) txt += "  (valeur inhabituelle, vérifier les mesures)";
    }
    pE.querySelector("#e_res").textContent = txt;
    res = { b: req, k, o };
  };
  pE.querySelectorAll("input,select").forEach((e) => e.addEventListener("input", calcEta));
  calcEta();
  pE.querySelector("#e_ok").onclick = () => {
    if (!res) return;
    const mat = pE.querySelector("#e_mat").value.trim() || "*";
    let e = m.etalonnages.find((x) => x.outil === res.o.nom && x.matiere.toLowerCase() === mat.toLowerCase());
    if (!e) { e = { ...etalonnageDefaut(res.o.nom), matiere: mat }; m.etalonnages.push(e); }
    e.retour_a = Math.round(res.b * 10) / 10; e.retour_b = 0;
    if (res.k != null) e.coef_arc = Math.round(res.k * 1e4) / 1e4;
    e.etalonne = true; modifie = true;
    flash(pE.querySelector("#e_ok"), `Enregistré ✔ (${res.o.nom} / ${mat})`);
  };
  await ouvrir({ titre: "Étalonnage", corps: onglets([["Repère zéro", pZero], ["Sens de B", pB], ["Compensation et allongement", pE]]),
    boutons: [{ texte: "Fermer", valeur: "ok", primaire: true }] });
  return modifie ? m : null;
}

function flash(bouton, texte) {
  const t = bouton.textContent; bouton.textContent = texte; bouton.disabled = true;
  setTimeout(() => { bouton.textContent = t; bouton.disabled = false; }, 1600);
}

// ----------------------------------------------------------------------
export async function dialoguePoints(machine) {
  const o = machine.outils[0] || outilDefaut();
  const corps = document.createElement("div");
  corps.appendChild(html(`<p class="discret" style="margin-top:0">Points d'intersection des axes (extrémités et sommets des plis), en mm. Le rayon s'applique au sommet de la ligne.</p>
    <div class="champs"><label>Nom</label><input type="text" id="s_nom" value="Tube manuel">
      <label>Diamètre (mm)</label><input type="number" id="s_D" value="${o.diametre}" step="any">
      <label>Épaisseur (mm)</label><input type="number" id="s_ep" value="2" step="any">
      <label>Matière</label><input type="text" id="s_mat" value="Acier"></div><br>`));
  const t = tableEditable([{ t: "X", cle: "x", type: "nombre" }, { t: "Y", cle: "y", type: "nombre" }, { t: "Z", cle: "z", type: "nombre" }, { t: "Rayon", cle: "r", type: "nombre" }],
    [{ x: 0, y: 0, z: 0, r: null }, { x: 445, y: 0, z: 0, r: o.rayon }, { x: 445, y: 790, z: 0, r: o.rayon }, { x: 445, y: 790, z: 545, r: null }],
    () => ({ x: 0, y: 0, z: 0, r: o.rayon }));
  corps.appendChild(t);
  let tube = null;
  const v = await ouvrir({ titre: "Nouveau tube par points d'intersection", corps, boutons: [{ texte: "Annuler", valeur: null }, { texte: "Créer le tube", valeur: "ok", primaire: true }],
    avantFermer: async () => {
      const pts = [], ray = [];
      for (const l of t.valeurs()) { if (l.x == null || l.y == null || l.z == null) continue; pts.push([l.x, l.y, l.z]); ray.push(l.r ?? o.rayon); }
      try {
        const q = (id) => corps.querySelector("#" + id).value;
        tube = tubeDepuisPoints(q("s_nom") || "Tube manuel", pts, ray, nombre(q("s_D"), o.diametre), nombre(q("s_ep"), 2), q("s_mat") || "Acier");
        tube.sources = [tube.nom];
        return true;
      } catch (e) { await message("Saisie", e.message); return false; }
    } });
  return v ? tube : null;
}
