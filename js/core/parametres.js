// Paramètres machine (Ercolina MG030 + banc mandrin 6 m) et étalonnages.
// Même structure JSON que la version Python (parametres_machine.json).

export const VERSION_PARAMS = 4;

export const outilDefaut = () => ({
  nom: "Ø48,3 R145", diametre: 48.3, rayon: 145.0,
  droite_mini: 150.0,      // longueur du mors de serrage
  pre_extraction: 5.0,     // PE (°)
  vitesse: 100.0,          // %
});

export const etalonnageDefaut = (outil = "Ø48,3 R145") => ({
  outil, matiere: "*",
  retour_a: 3.0, retour_b: 0.0,   // compensation α = a + b·β (atelier : 3° constant)
  coef_arc: 1.0, etalonne: false,
});

// Repère : origine au point de tangence sur l'axe du tube, X sens d'avance, Y côté où part le cintre
// (opposé à l'opérateur), Z vers le haut. Axe de la forme en (0, R) avec R = 145.
// Vue de dessus et hauteurs relevées à l'atelier le 09/11/2026.
const R_REF = 145.0, Z_BATI = -100.0, Z_MONTANT = -100.0;
export const obstaclesDefaut = () => [
  { nom: "Bâti machine", xmin: -6500, xmax: 130, ymin: -700, ymax: R_REF + 90, zmin: -1200, zmax: Z_BATI, gravite: "erreur", actif: true },
  { nom: "Montant (réglage galet / mandrin)", xmin: -290, xmax: -190, ymin: R_REF + 90, ymax: R_REF + 250, zmin: -1200, zmax: Z_MONTANT, gravite: "erreur", actif: true },
  { nom: "Zone opérateur (pupitre)", xmin: -1500, xmax: 1500, ymin: -3000, ymax: -800, zmin: -1000, zmax: 1200, gravite: "alerte", actif: true },
];

export function machineDefaut() {
  return {
    nom: "Ercolina MG030 + banc mandrin 6 m",
    version: VERSION_PARAMS,
    longueur_max: 5890.0,          // marque zéro -> chariot reculé
    decalage_zero: 2.2,            // pli d'essai du 09/11/2026 : Y 500, 90°, A = 642,8
    decalage_verifie: true,
    sens_B: -1,                    // -1 : B augmente en tournant HORAIRE vu du chariot vers l'outil
    sens_B_verifie: true,
    droite_arriere_mini: 390.0,    // après le dernier pli, sinon le chariot tape dans l'outil
    droite_arriere_mesuree: true,
    hauteur_axe_sol: 1015.0,
    angle_max: 210.0, retour_max: 20.0, diametre_max: 60.0, rayon_max: 190.0,
    marge_collision: 20.0,
    obstacles_mesures: true,
    surlongueur_auto: true,
    position_soudure: "en haut (12 h), vue depuis le chariot",
    barre_longueur: 6000.0, trait_scie: 3.0, chute_reutilisable: 300.0,
    outils: [outilDefaut()],
    etalonnages: [etalonnageDefaut()],
    obstacles: obstaclesDefaut(),
  };
}

/** Lit un objet de paramètres (y compris d'une ancienne version Python) et complète/migre. */
export function machineDepuis(d) {
  d = JSON.parse(JSON.stringify(d || {}));
  const def = machineDefaut();
  const ver = Number(d.version || 1);
  if (ver < 3) delete d.obstacles;
  if (ver < 4) {
    delete d.obstacles;
    for (const k of ["hauteur_axe_sol", "obstacles_mesures", "version"]) delete d[k];
    if (!d.decalage_verifie) { delete d.decalage_zero; delete d.decalage_verifie; }
  }
  const outils = (d.outils || []).map((o) => ({ ...outilDefaut(), ...o }));
  const etal = (d.etalonnages || []).map((e) => ({ ...etalonnageDefaut(), ...e }));
  if (ver < 2) {
    for (const k of ["sens_B", "sens_B_verifie", "droite_arriere_mini", "droite_arriere_mesuree", "longueur_max"]) delete d[k];
    for (const o of outils) if (o.pre_extraction === 3.0) o.pre_extraction = 5.0;
    for (const e of etal) if (!e.etalonne) { e.retour_a = 3.0; e.retour_b = 0.0; }
  }
  const m = { ...def };
  for (const k of Object.keys(def)) if (k in d && !["outils", "etalonnages", "obstacles"].includes(k)) m[k] = d[k];
  m.version = VERSION_PARAMS;
  m.outils = outils.length ? outils : def.outils;
  m.etalonnages = etal.length ? etal : def.etalonnages;
  m.obstacles = Array.isArray(d.obstacles) ? d.obstacles.map((o) => ({ gravite: "erreur", actif: true, ...o })) : def.obstacles;
  return m;
}

export function outilPour(m, diametre, rayon) {
  const cands = m.outils.filter((o) => Math.abs(o.diametre - diametre) <= 0.6);
  if (rayon == null) return cands[0] || null;
  return cands.find((o) => Math.abs(o.rayon - rayon) <= 1.0) || null;
}

export function etalonnagePour(m, outil, matiere) {
  const mat = (matiere || "").toLowerCase();
  return m.etalonnages.find((e) => e.outil === outil && e.matiere.toLowerCase() === mat)
    || m.etalonnages.find((e) => e.outil === outil && e.matiere === "*")
    || etalonnageDefaut(outil);
}

export const retour = (e, betaDeg) => e.retour_a + e.retour_b * betaDeg;

export function aVerifier(m) {
  const r = [];
  if (!m.decalage_verifie) r.push("Repère zéro de l'outil non vérifié par un pli d'essai (décalage 0 supposé)");
  if (!m.sens_B_verifie) r.push("Sens de l'affichage B non vérifié");
  if (!m.obstacles_mesures) r.push("Dimensions du bâti et du banc estimées (collisions indicatives)");
  if (!m.droite_arriere_mesuree) r.push("Droite mini après le dernier pli non mesurée");
  return r;
}
