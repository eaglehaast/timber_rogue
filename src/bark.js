import * as THREE from 'three';
import { tiles, soften } from './surface.js';

// Кора ствола и ветвей. Текстура лежит в мировом масштабе: квадрат BARK_TILE метров.
// Картинка — набор из 20 плиток с общими краями (атлас 5 × 4): каждая клетка коры берёт свою плитку,
// и узор не повторяется. У каждого дерева ещё свой сдвиг и крупность, а поверх — пятна тона (см. surface.js).
export const BARK_TILE = 0.4;
// Плитки нарисованы с почти квадратными пластинками, а у клёна гребни коры вытянуты вдоль ствола.
// Поэтому кладём плитку уже и выше: 0,4 / 1,4 ≈ 29 см поперёк и 0,4 / 0,7 ≈ 57 см вдоль ствола.
const ACROSS = 1.4, ALONG = 0.7;
const [texture] = tiles(['assets/textures/bark.jpg']);

// Кора нового дерева, своя у каждого: откуда начинается узор и насколько он крупный.
// Пятна тона — ячейки около метра и трети метра.
export function dressBark() {
  const map = texture.clone();
  const scale = 0.85 + Math.random() * 0.3;
  map.repeat.set(scale * ACROSS, scale * ALONG);
  map.offset.set(Math.random(), Math.random());
  return soften(new THREE.MeshLambertMaterial({ map }), {
    contrast: 0.6, saturation: 0.8, scales: [0.4, 1.3], low: [0.78, 0.8, 0.76], high: [1.1, 1.05, 1.0], cells: [5, 4],
  });
}
