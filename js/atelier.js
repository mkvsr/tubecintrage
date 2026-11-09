// Publication pour l'atelier via GitHub (site GitHub Pages).
//
// Dans le dépôt :
//   lots/index.tcx          liste des lots publiés (chiffrée)
//   lots/<id>.tcx           un lot (chiffré)
//   parametres_machine.json paramètres de référence (non chiffrés : rien de confidentiel)
//
// Les lots sont chiffrés (AES-GCM 256, clé dérivée du mot de passe atelier par PBKDF2-SHA256) :
// le site GitHub Pages est public, les fichiers sont illisibles sans le mot de passe.
// Les tablettes lisent les fichiers sur le site ; seul le poste qui publie a besoin d'un jeton GitHub.

const CLE_CONFIG = "tubecintrage.github";
const CLE_MDP = "tubecintrage.motDePasseAtelier";
const FORMAT = "tubecintrage-chiffre/1";
const ITERATIONS = 250000;

export class ErreurAtelier extends Error {}

// ----------------------------------------------------------------------
// Petits outils
const lire = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const ecrire = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch { /* navigateur privé */ } };

function versB64(octets) {
  let s = "";
  for (let i = 0; i < octets.length; i += 0x8000) s += String.fromCharCode.apply(null, octets.subarray(i, i + 0x8000));
  return btoa(s);
}
const depuisB64 = (b) => Uint8Array.from(atob(b.replace(/\s+/g, "")), (c) => c.charCodeAt(0));
const texteVersB64 = (t) => versB64(new TextEncoder().encode(t));
const b64VersTexte = (b) => new TextDecoder().decode(depuisB64(b));

// ----------------------------------------------------------------------
// Chiffrement
export function chiffrementDisponible() { return !!(globalThis.crypto && crypto.subtle); }

async function cle(mdp, sel) {
  if (!chiffrementDisponible()) throw new ErreurAtelier("Chiffrement indisponible : ouvrez l'application par son adresse https://");
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(mdp), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt: sel, iterations: ITERATIONS, hash: "SHA-256" }, base,
    { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function chiffrer(texte, mdp) {
  const sel = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const c = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await cle(mdp, sel), new TextEncoder().encode(texte));
  return JSON.stringify({ format: FORMAT, sel: versB64(sel), iv: versB64(iv), donnees: versB64(new Uint8Array(c)) });
}

export async function dechiffrer(contenu, mdp) {
  let d;
  try { d = JSON.parse(contenu); } catch { throw new ErreurAtelier("Fichier publié illisible"); }
  if (d.format !== FORMAT) throw new ErreurAtelier("Format de fichier publié inconnu");
  try {
    const t = await crypto.subtle.decrypt({ name: "AES-GCM", iv: depuisB64(d.iv) }, await cle(mdp, depuisB64(d.sel)), depuisB64(d.donnees));
    return new TextDecoder().decode(t);
  } catch (e) {
    if (e instanceof ErreurAtelier) throw e;
    throw new ErreurAtelier("Mot de passe atelier incorrect");
  }
}

// ----------------------------------------------------------------------
// Réglages de ce navigateur
export const motDePasse = () => lire(CLE_MDP, "");
export const enregistrerMotDePasse = (m) => ecrire(CLE_MDP, m || null);

/** Dépôt déduit de l'adresse du site (https://<compte>.github.io/<depot>/). */
export function depotDuSite() {
  const h = location.hostname;
  if (!h.endsWith(".github.io")) return null;
  const compte = h.slice(0, -".github.io".length);
  const premier = location.pathname.split("/").filter(Boolean)[0];
  const depot = premier && !premier.includes(".") ? premier : `${compte}.github.io`;
  return `${compte}/${depot}`;
}

export function config() {
  const c = lire(CLE_CONFIG, {});
  return { depot: c.depot || depotDuSite() || "", branche: c.branche || "main", jeton: c.jeton || "" };
}
export const enregistrerConfig = (c) => ecrire(CLE_CONFIG, { depot: (c.depot || "").trim(), branche: (c.branche || "main").trim(), jeton: (c.jeton || "").trim() });
export const peutPublier = () => { const c = config(); return !!(c.depot && c.jeton); };

// ----------------------------------------------------------------------
// API GitHub (poste qui publie)
async function api(chemin, options = {}) {
  const c = config();
  if (!c.depot || !c.jeton) throw new ErreurAtelier("Publication non configurée (Paramètres > Publication)");
  const r = await fetch(`https://api.github.com/repos/${c.depot}/${chemin}`, {
    ...options,
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${c.jeton}`, "X-GitHub-Api-Version": "2022-11-28", ...(options.headers || {}) },
    cache: "no-store",
  });
  if (r.status === 401) throw new ErreurAtelier("Jeton GitHub refusé (expiré ou mal copié)");
  if (r.status === 403) throw new ErreurAtelier("Jeton GitHub sans le droit d'écrire dans ce dépôt (droit « Contents : Read and write » nécessaire)");
  return r;
}

/** {texte, sha} ou null si absent. */
async function lireFichierDepot(chemin) {
  const c = config();
  const r = await api(`contents/${chemin}?ref=${encodeURIComponent(c.branche)}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new ErreurAtelier(`Lecture de ${chemin} impossible (${r.status})`);
  const d = await r.json();
  if (d.encoding === "base64" && d.content) return { texte: b64VersTexte(d.content), sha: d.sha };
  // fichier de plus de 1 Mo : contenu brut
  const r2 = await api(`contents/${chemin}?ref=${encodeURIComponent(c.branche)}`, { headers: { Accept: "application/vnd.github.raw" } });
  return { texte: await r2.text(), sha: d.sha };
}

async function ecrireFichierDepot(chemin, texte, message, sha = undefined) {
  const c = config();
  const r = await api(`contents/${chemin}`, { method: "PUT", body: JSON.stringify({ message, content: texteVersB64(texte), branch: c.branche, ...(sha ? { sha } : {}) }) });
  if (r.status === 404) throw new ErreurAtelier(`Dépôt « ${c.depot} » ou branche « ${c.branche} » introuvable`);
  if (r.status === 409 || r.status === 422) throw new ErreurAtelier("Le fichier a été modifié entre-temps : réessayez");
  if (!r.ok) throw new ErreurAtelier(`Écriture de ${chemin} refusée (${r.status})`);
}

async function supprimerFichierDepot(chemin, sha, message) {
  const c = config();
  const r = await api(`contents/${chemin}`, { method: "DELETE", body: JSON.stringify({ message, sha, branch: c.branche }) });
  if (!r.ok && r.status !== 404) throw new ErreurAtelier(`Suppression de ${chemin} refusée (${r.status})`);
}

/** Vérifie le jeton et le dépôt. Renvoie un texte de diagnostic. */
export async function tester() {
  const r = await api("");
  if (r.status === 404) throw new ErreurAtelier(`Dépôt « ${config().depot} » introuvable ou non accessible avec ce jeton`);
  if (!r.ok) throw new ErreurAtelier(`GitHub répond ${r.status}`);
  const d = await r.json();
  if (d.permissions && !d.permissions.push) throw new ErreurAtelier("Ce jeton peut lire le dépôt mais pas y écrire");
  return `Dépôt ${d.full_name} accessible en écriture${d.private ? " (privé)" : ""}.`;
}

// ----------------------------------------------------------------------
// Lots publiés
const nouvelId = () => Date.now().toString(36) + "-" + versB64(crypto.getRandomValues(new Uint8Array(6))).replace(/[+/=]/g, "x");

/** Index lu sur le site (tablettes). Le paramètre v contourne le cache de GitHub Pages (10 min). */
export async function listerPublies(mdp) {
  let r;
  try { r = await fetch(`lots/index.tcx?v=${Date.now()}`, { cache: "no-store" }); }
  catch { throw new ErreurAtelier("Pas de connexion au site"); }
  if (r.status === 404) return [];
  if (!r.ok) throw new ErreurAtelier(`Liste des lots indisponible (${r.status})`);
  const idx = JSON.parse(await dechiffrer(await r.text(), mdp));
  return idx.lots.sort((a, b) => (b.modifie || "").localeCompare(a.modifie || ""));
}

export async function lirePublie(id, mdp) {
  const r = await fetch(`lots/${encodeURIComponent(id)}.tcx?v=${Date.now()}`, { cache: "no-store" });
  if (!r.ok) throw new ErreurAtelier(r.status === 404 ? "Lot pas encore en ligne (le site se met à jour en 1 à 2 minutes après une publication)" : `Lot indisponible (${r.status})`);
  return dechiffrer(await r.text(), mdp);
}

async function lireIndexDepot(mdp) {
  const f = await lireFichierDepot("lots/index.tcx");
  if (!f) return { index: { lots: [] }, sha: undefined, nouveau: true };
  return { index: JSON.parse(await dechiffrer(f.texte, mdp)), sha: f.sha, nouveau: false };
}

/** Publie (ou remplace, s'il porte le même nom) un lot. `resume` : {tubes, pieces}. */
export async function publierLot(nom, texteLot, mdp, resume = {}) {
  const { index, sha } = await lireIndexDepot(mdp);
  let e = index.lots.find((l) => l.nom === nom);
  let shaLot;
  if (e) { const f = await lireFichierDepot(`lots/${e.id}.tcx`); shaLot = f?.sha; }
  else { e = { id: nouvelId(), nom }; index.lots.push(e); }
  Object.assign(e, resume, { modifie: new Date().toISOString() });
  await ecrireFichierDepot(`lots/${e.id}.tcx`, await chiffrer(texteLot, mdp), `Lot « ${nom} »`, shaLot);
  await ecrireFichierDepot("lots/index.tcx", await chiffrer(JSON.stringify(index), mdp), `Liste des lots (${nom})`, sha);
  return e;
}

export async function supprimerPublie(id, mdp) {
  const { index, sha } = await lireIndexDepot(mdp);
  const e = index.lots.find((l) => l.id === id);
  index.lots = index.lots.filter((l) => l.id !== id);
  await ecrireFichierDepot("lots/index.tcx", await chiffrer(JSON.stringify(index), mdp), `Retrait du lot « ${e ? e.nom : id} »`, sha);
  const f = await lireFichierDepot(`lots/${id}.tcx`);
  if (f) await supprimerFichierDepot(`lots/${id}.tcx`, f.sha, `Retrait du lot « ${e ? e.nom : id} »`);
}

/** Le mot de passe ouvre-t-il l'index déjà publié ? (true aussi s'il n'y a encore rien) */
export async function verifierMotDePasseDepot(mdp) {
  const { nouveau } = await lireIndexDepot(mdp);
  return { nouveau };
}

/** Publie les paramètres machine de référence (lus par tous les postes au démarrage). */
export async function publierParametres(machine) {
  const f = await lireFichierDepot("parametres_machine.json");
  const d = { ...machine, publie: new Date().toISOString() };
  await ecrireFichierDepot("parametres_machine.json", JSON.stringify(d, null, 1), "Paramètres machine", f?.sha);
  return d.publie;
}
