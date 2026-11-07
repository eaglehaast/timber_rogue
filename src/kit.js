import * as THREE from 'three';
import { tiles } from './surface.js';

// Картинки Никиты для дома, собранные tools/house_kit.py в атласы: house-<имя>.jpg/.webp — клетки сеткой
// grid, по клетке на картинку; house-kit.json — сетка, число картинок и средний линейный цвет каждого набора.
export const KIT = await (await fetch('assets/textures/house-kit.json')).json();
const FILES = { soot: 'webp', door: 'webp', frieze: 'webp', prichelina: 'webp', attic: 'webp', baluster: 'webp' };
const cache = {};
export const atlas = (name) => (cache[name] ??= tiles([`assets/textures/house-${name}.${FILES[name] ?? 'jpg'}`])[0]);

// Клетка i набора name в координатах текстуры: [u0, v0, u1, v1], v вверх (верх картинки — v1).
export function cell(name, i) {
  const [cols, rows] = KIT[name].grid, c = i % cols, r = Math.floor(i / cols);
  return [c / cols, 1 - (r + 1) / rows, (c + 1) / cols, 1 - r / rows];
}

// Цвет, которым умножить картинку набора, чтобы её средний цвет стал paint (белое и серое → краска).
export const repaint = (name, paint) => new THREE.Color(...paint.map((v, k) => v / KIT[name].mean[k]));

// Лента из клетки rect вдоль отрезка длиной length: картинка повторяется через каждые tile метров, последний
// кусок обрезан. at(t, h) — точка ленты: t — от начала вдоль, h — 0 у низа картинки, 1 у верха.
export function strip(faces, rect, length, tile, at, normal) {
  const [u0, v0, u1, v1] = rect;
  for (let t = 0; t < length - 1e-3; t += tile) {
    const t1 = Math.min(length, t + tile), ue = u0 + ((t1 - t) / tile) * (u1 - u0);
    faces.face([at(t, 0), at(t1, 0), at(t1, 1), at(t, 1)], normal, [[u0, v0], [ue, v0], [ue, v1], [u0, v1]]);
  }
}
