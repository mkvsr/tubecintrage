// Enregistrement des paramètres machine et des lots.
// Avec TubeCintrage-serveur : partagés par tous les postes (dossier « donnees » du serveur).
// Sans serveur (page ouverte autrement) : conservés dans le navigateur uniquement.
import { machineDefaut, machineDepuis } from "./core/parametres.js";

const CLE_PARAMS = "tubecintrage.parametres";
const CLE_LOTS = "tubecintrage.lots";

let _serveur = null;
export async function serveurDisponible() {
  if (_serveur !== null) return _serveur;
  try {
    const r = await fetch("api/info", { cache: "no-store" });
    _serveur = r.ok && (await r.json()).serveur === true;
  } catch { _serveur = false; }
  return _serveur;
}

const lireLocal = (cle, defaut) => { try { const v = localStorage.getItem(cle); return v ? JSON.parse(v) : defaut; } catch { return defaut; } };
const ecrireLocal = (cle, v) => { try { localStorage.setItem(cle, JSON.stringify(v)); return true; } catch { return false; } };

/** D'où viennent les paramètres chargés : "serveur", "site", "local" ou "defaut". */
export let sourceParametres = "defaut";
const CLE_PARAMS_DATE = "tubecintrage.parametres.date";

export async function chargerParametres() {
  if (await serveurDisponible()) {
    try {
      const r = await fetch("api/parametres", { cache: "no-store" });
      if (r.ok) { sourceParametres = "serveur"; return machineDepuis(await r.json()); }
    } catch { /* on passe au local */ }
    return machineDefaut();
  }
  // paramètres de référence publiés avec le site (parametres_machine.json à côté de index.html)
  let site = null;
  try {
    const r = await fetch(`parametres_machine.json?v=${Date.now()}`, { cache: "no-store" });
    if (r.ok) site = await r.json();
  } catch { /* hors connexion ou fichier local */ }
  const local = lireLocal(CLE_PARAMS, null), dateLocale = lireLocal(CLE_PARAMS_DATE, "");
  // une publication plus récente que la modification locale l'emporte
  if (local && (!site || !site.publie || dateLocale > site.publie)) { sourceParametres = "local"; return machineDepuis(local); }
  if (site) { sourceParametres = "site"; return machineDepuis(site); }
  return machineDefaut();
}

/** Revient aux paramètres de référence (site) en oubliant les modifications de ce navigateur. */
export function oublierParametresLocaux() { try { localStorage.removeItem(CLE_PARAMS); localStorage.removeItem(CLE_PARAMS_DATE); } catch { /* rien */ } }

export async function enregistrerParametres(m) {
  if (await serveurDisponible()) {
    const r = await fetch("api/parametres", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(m, null, 1) });
    if (!r.ok) throw new Error("Le serveur a refusé l'enregistrement des paramètres (" + r.status + ")");
    return "serveur";
  }
  if (!ecrireLocal(CLE_PARAMS, m)) throw new Error("Impossible d'enregistrer dans ce navigateur");
  ecrireLocal(CLE_PARAMS_DATE, new Date().toISOString());
  sourceParametres = "local";
  return "local";
}

// ----------------------------------------------------------------------
const nomValide = (n) => n.replace(/[\\/:*?"<>|]+/g, "-").trim().slice(0, 120) || "lot";

export async function listerLots() {
  if (await serveurDisponible()) {
    const r = await fetch("api/lots", { cache: "no-store" });
    if (!r.ok) throw new Error("Liste des lots indisponible");
    return r.json();          // [{nom, modifie, taille}]
  }
  const lots = lireLocal(CLE_LOTS, {});
  return Object.entries(lots).map(([nom, v]) => ({ nom, modifie: v.modifie, taille: v.texte.length }))
    .sort((a, b) => (b.modifie || "").localeCompare(a.modifie || ""));
}

export async function lireLot(nom) {
  if (await serveurDisponible()) {
    const r = await fetch("api/lots/" + encodeURIComponent(nom), { cache: "no-store" });
    if (!r.ok) throw new Error("Lot introuvable : " + nom);
    return r.text();
  }
  const v = lireLocal(CLE_LOTS, {})[nom];
  if (!v) throw new Error("Lot introuvable : " + nom);
  return v.texte;
}

export async function ecrireLot(nom, texte) {
  nom = nomValide(nom);
  if (await serveurDisponible()) {
    const r = await fetch("api/lots/" + encodeURIComponent(nom), { method: "PUT", body: texte });
    if (!r.ok) throw new Error("Le serveur a refusé l'enregistrement du lot (" + r.status + ")");
    return nom;
  }
  const lots = lireLocal(CLE_LOTS, {});
  lots[nom] = { texte, modifie: new Date().toISOString() };
  if (!ecrireLocal(CLE_LOTS, lots)) throw new Error("Mémoire du navigateur pleine ou indisponible : utilisez « Télécharger le lot »");
  return nom;
}

export async function supprimerLot(nom) {
  if (await serveurDisponible()) {
    const r = await fetch("api/lots/" + encodeURIComponent(nom), { method: "DELETE" });
    if (!r.ok) throw new Error("Suppression refusée");
    return;
  }
  const lots = lireLocal(CLE_LOTS, {});
  delete lots[nom]; ecrireLocal(CLE_LOTS, lots);
}

/** Téléchargement d'un fichier généré dans la page. */
export function telecharger(nom, contenu, type = "application/octet-stream") {
  const blob = contenu instanceof Blob ? contenu : new Blob([contenu], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = nom; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
