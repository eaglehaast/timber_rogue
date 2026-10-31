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

let shared = generator(1);
export function seed(s) { shared = generator(s); }
export function random() { return shared(); }
