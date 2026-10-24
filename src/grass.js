import * as THREE from 'three';
import { tiles, soften } from './surface.js';

// Трава на земле — набор из 25 плиток по GRASS_TILE метров с общими краями (сетка 5 × 5 в одной
// картинке): каждая клетка земли берёт свою плитку, и узор не повторяется. Пятна тона крупнее,
// чем у коры: около 15 и 4 метров, тёмные чуть сизые, светлые — выгоревшие, желтоватые.
export const GRASS_TILE = 2;
const [texture] = tiles(['assets/textures/grass.jpg']);

export const grassMaterial = soften(new THREE.MeshLambertMaterial({ map: texture }), {
  contrast: 0.55, saturation: 0.7, scales: [0.13, 0.5], low: [0.72, 0.78, 0.72], high: [1.12, 1.06, 0.86], cells: 5,
});

// Новый раунд — новая раскладка плиток. size — сторона земли в метрах.
export function dressGrass(size) {
  texture.repeat.set(size / GRASS_TILE, size / GRASS_TILE);
  texture.offset.set(Math.floor(Math.random() * 100), Math.floor(Math.random() * 100));
}
