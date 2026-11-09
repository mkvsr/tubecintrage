// Petite bibliothèque de vecteurs 3D (tableaux [x, y, z]) et matrices 3x3 (tableaux de lignes).

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const neg = (a) => [-a[0], -a[1], -a[2]];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const norm = (a) => Math.hypot(a[0], a[1], a[2]);
export const dist = (a, b) => norm(sub(a, b));
export const copy = (a) => [a[0], a[1], a[2]];

export function unit(v) {
  const n = norm(v);
  if (n < 1e-12) throw new Error("vecteur nul");
  return [v[0] / n, v[1] / n, v[2] / n];
}

export const DEG = 180 / Math.PI;
export const RAD = Math.PI / 180;

/** Matrice de rotation (main droite) autour de `axe`. */
export function rot(axe, angle) {
  const [x, y, z] = unit(axe);
  const c = Math.cos(angle), s = Math.sin(angle), C = 1 - c;
  return [
    [c + x * x * C, x * y * C - z * s, x * z * C + y * s],
    [y * x * C + z * s, c + y * y * C, y * z * C - x * s],
    [z * x * C - y * s, z * y * C + x * s, c + z * z * C],
  ];
}

/** M @ v */
export const mv = (M, v) => [dot(M[0], v), dot(M[1], v), dot(M[2], v)];
/** Mᵀ @ v  (équivaut à v @ M) */
export const mtv = (M, v) => [
  M[0][0] * v[0] + M[1][0] * v[1] + M[2][0] * v[2],
  M[0][1] * v[0] + M[1][1] * v[1] + M[2][1] * v[2],
  M[0][2] * v[0] + M[1][2] * v[1] + M[2][2] * v[2],
];

export function perpendiculaire(v) {
  v = unit(v);
  const a = Math.abs(v[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  return unit(cross(v, a));
}

export function angleEntre(u, v) {
  return Math.acos(Math.max(-1, Math.min(1, dot(unit(u), unit(v)))));
}

/** Arrondi « à la Python » (round half to even) pour garder les mêmes signatures. */
export function roundPy(x) {
  const r = Math.round(x);
  if (Math.abs(x % 1) === 0.5) return 2 * Math.round(x / 2);
  return r;
}
