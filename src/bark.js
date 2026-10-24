import * as THREE from 'three';
import { tiles, soften } from './surface.js';

// Кора — общий материал ствола и ветвей. Текстура лежит в мировом масштабе: квадрат BARK_TILE метров.
// Чтобы плитка не бросалась в глаза, у каждого дерева своя картинка из нескольких, свой сдвиг
// и крупность, а поверх — пятна тона (см. surface.js).
export const BARK_TILE = 0.4;
const textures = tiles([1, 2, 3, 4, 5].map((i) => `assets/textures/bark-${i}.jpg`));

// Пятна тона — ячейки около метра и трети метра.
export const barkMaterial = soften(new THREE.MeshLambertMaterial(), {
  contrast: 0.6, saturation: 0.8, scales: [0.4, 1.3], low: [0.78, 0.8, 0.76], high: [1.1, 1.05, 1.0],
});

// Новое дерево — новая кора: какая из картинок, откуда начинается узор и насколько он крупный.
export function dressBark() {
  const map = textures[Math.floor(Math.random() * textures.length)];
  const scale = 0.85 + Math.random() * 0.3;
  map.repeat.set(scale, scale);
  map.offset.set(Math.random(), Math.random());
  barkMaterial.map = map;
  barkMaterial.needsUpdate = true;
}
