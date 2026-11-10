// Encodeur de QR codes (norme ISO/IEC 18004), mode octets, versions 1 à 10 — sans dépendance.
// Sert aux étiquettes : chaque pièce a son QR code qui ouvre le lot et le repère dans l'application.
// Usage : qrMatrice("https://…", { ecc: "M" }) → tableau de lignes de booléens (true = module noir).

const NIVEAUX = { L: 0, M: 1, Q: 2, H: 3 };
const FORMAT_ECC = [1, 0, 3, 2];   // bits de format pour L, M, Q, H
// octets de correction par bloc et nombre de blocs, par niveau puis par version (index 0 inutilisé)
const ECC_PAR_BLOC = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28],
];
const NB_BLOCS = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8],
];

function modulesDonneesBruts(v) {
  let r = (16 * v + 128) * v + 64;
  if (v >= 2) { const n = Math.floor(v / 7) + 2; r -= (25 * n - 10) * n - 55; if (v >= 7) r -= 36; }
  return r;
}
const octetsDonnees = (v, e) => Math.floor(modulesDonneesBruts(v) / 8) - ECC_PAR_BLOC[e][v] * NB_BLOCS[e][v];

// --- Reed-Solomon sur GF(256), polynôme 0x11D
function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; }
  return z & 0xff;
}
function rsDiviseur(degre) {
  const r = new Array(degre).fill(0); r[degre - 1] = 1;
  let racine = 1;
  for (let i = 0; i < degre; i++) {
    for (let j = 0; j < r.length; j++) { r[j] = gfMul(r[j], racine); if (j + 1 < r.length) r[j] ^= r[j + 1]; }
    racine = gfMul(racine, 0x02);
  }
  return r;
}
function rsReste(donnees, diviseur) {
  const r = diviseur.map(() => 0);
  for (const b of donnees) {
    const f = b ^ r.shift(); r.push(0);
    diviseur.forEach((c, i) => { r[i] ^= gfMul(c, f); });
  }
  return r;
}

const MASQUES = [
  (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x, y) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function positionsAlignement(v, taille) {
  if (v === 1) return [];
  const n = Math.floor(v / 7) + 2, pas = Math.ceil((v * 4 + 4) / (n * 2 - 2)) * 2;
  const r = [6];
  for (let i = 0, p = taille - 7; i < n - 1; i++, p -= pas) r.splice(1, 0, p);
  return r;
}

/** Matrice QR. options : ecc ("L", "M", "Q", "H" ; défaut M), masque (0–7, sinon choisi au mieux), version mini. */
export function qrMatrice(texte, { ecc = "M", masque = null, versionMin = 1 } = {}) {
  const e = NIVEAUX[ecc];
  const octets = [...new TextEncoder().encode(texte)];
  // version : la plus petite qui contient les données (mode octets : 4 bits de mode + compteur 8 ou 16 bits)
  let v = Math.max(1, versionMin);
  const bitsUtiles = (ver) => 4 + (ver <= 9 ? 8 : 16) + octets.length * 8;
  while (v <= 10 && bitsUtiles(v) > octetsDonnees(v, e) * 8) v++;
  if (v > 10) throw new Error("Texte trop long pour le QR code");
  // flux de bits
  const bits = [];
  const ajout = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  ajout(0b0100, 4); ajout(octets.length, v <= 9 ? 8 : 16);
  for (const b of octets) ajout(b, 8);
  const capacite = octetsDonnees(v, e) * 8;
  ajout(0, Math.min(4, capacite - bits.length));
  ajout(0, (8 - (bits.length % 8)) % 8);
  for (let p = 0xec; bits.length < capacite; p ^= 0xec ^ 0x11) ajout(p, 8);
  const donnees = [];
  for (let i = 0; i < bits.length; i += 8) donnees.push(parseInt(bits.slice(i, i + 8).join(""), 2));
  // blocs + correction, entrelacés
  const nb = NB_BLOCS[e][v], lecc = ECC_PAR_BLOC[e][v], brut = Math.floor(modulesDonneesBruts(v) / 8);
  const nCourts = nb - (brut % nb), lCourt = Math.floor(brut / nb), div = rsDiviseur(lecc);
  const blocs = [];
  for (let i = 0, k = 0; i < nb; i++) {
    const dat = donnees.slice(k, k + lCourt - lecc + (i < nCourts ? 0 : 1)); k += dat.length;
    const c = rsReste(dat, div);
    if (i < nCourts) dat.push(0);
    blocs.push(dat.concat(c));
  }
  const flux = [];
  for (let i = 0; i < blocs[0].length; i++) blocs.forEach((b, j) => { if (i !== lCourt - lecc || j >= nCourts) flux.push(b[i]); });

  // matrice et motifs fixes
  const taille = v * 4 + 17;
  const m = Array.from({ length: taille }, () => new Array(taille).fill(false));
  const fixe = Array.from({ length: taille }, () => new Array(taille).fill(false));
  const pose = (x, y, noir) => { m[y][x] = noir; fixe[y][x] = true; };
  for (let i = 0; i < taille; i++) { pose(6, i, i % 2 === 0); pose(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [taille - 4, 3], [3, taille - 4]])
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy, dist = Math.max(Math.abs(dx), Math.abs(dy));
      if (x >= 0 && x < taille && y >= 0 && y < taille) pose(x, y, dist !== 2 && dist !== 4);
    }
  const al = positionsAlignement(v, taille), na = al.length;
  for (let i = 0; i < na; i++) for (let j = 0; j < na; j++) {
    if ((i === 0 && j === 0) || (i === 0 && j === na - 1) || (i === na - 1 && j === 0)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) pose(al[i] + dx, al[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  const format = (mk) => {
    const d = (FORMAT_ECC[e] << 3) | mk;
    let r = d; for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
    const b = ((d << 10) | r) ^ 0x5412, bit = (i) => ((b >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) pose(8, i, bit(i));
    pose(8, 7, bit(6)); pose(8, 8, bit(7)); pose(7, 8, bit(8));
    for (let i = 9; i < 15; i++) pose(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) pose(taille - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) pose(8, taille - 15 + i, bit(i));
    pose(8, taille - 8, true);
  };
  format(0);   // réserve les emplacements (valeurs définitives après choix du masque)
  if (v >= 7) {
    let r = v; for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
    const b = (v << 12) | r;
    for (let i = 0; i < 18; i++) { const bit = ((b >>> i) & 1) === 1, a = taille - 11 + (i % 3), c = Math.floor(i / 3); pose(a, c, bit); pose(c, a, bit); }
  }
  // données en zigzag
  let i = 0;
  for (let droite = taille - 1; droite >= 1; droite -= 2) {
    if (droite === 6) droite = 5;
    for (let vert = 0; vert < taille; vert++) for (let j = 0; j < 2; j++) {
      const x = droite - j, monte = ((droite + 1) & 2) === 0, y = monte ? taille - 1 - vert : vert;
      if (!fixe[y][x] && i < flux.length * 8) { m[y][x] = ((flux[i >>> 3] >>> (7 - (i & 7))) & 1) === 1; i++; }
    }
  }
  const avecMasque = (mk) => {
    const r = m.map((l) => l.slice());
    for (let y = 0; y < taille; y++) for (let x = 0; x < taille; x++) if (!fixe[y][x] && MASQUES[mk](x, y)) r[y][x] = !r[y][x];
    const sauve = m.map((l) => l.slice());
    for (let y = 0; y < taille; y++) m[y] = r[y];
    format(mk);
    const res = m.map((l) => l.slice());
    for (let y = 0; y < taille; y++) m[y] = sauve[y];
    return res;
  };
  if (masque != null) return avecMasque(masque);
  let meilleur = null, pMin = Infinity;
  for (let mk = 0; mk < 8; mk++) { const c = avecMasque(mk), p = penalite(c); if (p < pMin) { pMin = p; meilleur = c; } }
  return meilleur;
}

/** Pénalité de lisibilité (règles de la norme : suites, blocs 2×2, motifs de repère, équilibre noir/blanc). */
function penalite(m) {
  const n = m.length; let p = 0;
  const lignes = (get) => {
    for (let a = 0; a < n; a++) {
      let suite = 1;
      for (let b = 1; b < n; b++) {
        if (get(a, b) === get(a, b - 1)) { suite++; if (suite === 5) p += 3; else if (suite > 5) p++; } else suite = 1;
      }
      for (let b = 0; b + 10 < n; b++) {
        const s = Array.from({ length: 11 }, (_, k) => get(a, b + k));
        const motif = [true, false, true, true, true, false, true];
        const ok1 = motif.every((x, k) => s[k] === x) && s.slice(7).every((x) => !x);
        const ok2 = s.slice(0, 4).every((x) => !x) && motif.every((x, k) => s[k + 4] === x);
        if (ok1 || ok2) p += 40;
      }
    }
  };
  lignes((a, b) => m[a][b]); lignes((a, b) => m[b][a]);
  for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) {
    const c = m[y][x];
    if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) p += 3;
  }
  const noirs = m.reduce((s, l) => s + l.filter(Boolean).length, 0);
  p += Math.floor(Math.abs(noirs * 20 - n * n * 10) / (n * n)) * 10;
  return p;
}
