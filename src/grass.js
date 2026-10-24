import * as THREE from 'three';
import { tiles, soften } from './surface.js';

// Трава на земле — бесшовная фотография плиткой GRASS_TILE метров. Пятна тона крупнее, чем у коры:
// ячейки около 15 и 4 метров, тёмные чуть сизые, светлые — выгоревшие, желтоватые. По ним глаз
// видит, как ты идёшь и поворачиваешь, и повтор плитки за ними не виден.
export const GRASS_TILE = 2;
const textures = tiles([1, 2, 3, 4].map((i) => `assets/textures/grass-${i}.jpg`));

export const grassMaterial = soften(new THREE.MeshLambertMaterial(), {
  contrast: 0.55, saturation: 0.7, scales: [0.13, 0.5], low: [0.72, 0.78, 0.72], high: [1.12, 1.06, 0.86],
});

// Новый раунд — новая трава: какая из картинок и откуда начинается узор. size — сторона земли в метрах.
export function dressGrass(size) {
  const map = textures[Math.floor(Math.random() * textures.length)];
  map.repeat.set(size / GRASS_TILE, size / GRASS_TILE);
  map.offset.set(Math.random(), Math.random());
  grassMaterial.map = map;
  grassMaterial.needsUpdate = true;
}
