// Случайность дерева — от числа-зерна: по нему из отчёта сторожа можно вырастить то же самое дерево.
// Mulberry32: маленький генератор с хорошим разбросом, одно 32-битное состояние.
let state = 1;

export function seed(s) { state = s >>> 0; }

export function random() {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
