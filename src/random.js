// Случайность дерева — от числа-зерна: по нему из отчёта сторожа можно вырастить то же самое дерево.
// Mulberry32: маленький генератор с хорошим разбросом, одно 32-битное состояние.
export function generator(s) {
  let state = s >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Плавный шум 0..1 с ячейкой 1 по обеим осям; rnd задаёт, какой именно (своё зерно — свой узор).
export function smoothNoise(rnd) {
  const salt = rnd() * 1000;
  const hash = (i, j) => { const h = Math.sin(i * 127.1 + j * 311.7 + salt) * 43758.5453; return h - Math.floor(h); };
  return (x, z) => {
    const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j;
    const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
    const a = hash(i, j) + (hash(i + 1, j) - hash(i, j)) * sx, b = hash(i, j + 1) + (hash(i + 1, j + 1) - hash(i, j + 1)) * sx;
    return a + (b - a) * sz;
  };
}

let shared = generator(1);
export function seed(s) { shared = generator(s); }
export function random() { return shared(); }
