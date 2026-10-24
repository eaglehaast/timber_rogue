import * as THREE from 'three';
import { tiles, soften } from './surface.js';

// Кора ствола и ветвей. Текстура лежит в мировом масштабе: квадрат BARK_TILE метров.
// Чтобы плитка не бросалась в глаза, у каждого дерева своя картинка из нескольких, свой сдвиг
// и крупность, а поверх — пятна тона (см. surface.js).
export const BARK_TILE = 0.4;
const textures = tiles([1, 2, 3, 4, 5].map((i) => `assets/textures/bark-${i}.jpg`));

// Кора нового дерева, своя у каждого: какая из картинок, откуда начинается узор и насколько он крупный.
// Пятна тона — ячейки около метра и трети метра.
export function dressBark() {
  const map = textures[Math.floor(Math.random() * textures.length)].clone();
  const scale = 0.85 + Math.random() * 0.3;
  map.repeat.set(scale, scale);
  map.offset.set(Math.random(), Math.random());
  return soften(new THREE.MeshLambertMaterial({ map }), {
    contrast: 0.6, saturation: 0.8, scales: [0.4, 1.3], low: [0.78, 0.8, 0.76], high: [1.1, 1.05, 1.0],
  });
}
