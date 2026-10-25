import * as THREE from 'three';
import { tiles, soften } from './surface.js';

// Трава на земле — набор из 20 акварельных плиток по GRASS_TILE метров с общими краями (сетка 5 × 4
// в одной картинке): каждая клетка земли берёт свою плитку, и узор не повторяется.
// Тон приглушён под пучки: земля темнее и спокойнее их, чтобы пучки на ней читались.
// Пятна тона около 15 и 4 метров.
const GRASS_TILE = 2;
const [texture] = tiles(['assets/textures/grass-clover.jpg']);
const material = soften(new THREE.MeshLambertMaterial({ map: texture }), {
  contrast: 0.85, saturation: 0.65, scales: [0.13, 0.5], low: [0.8, 0.84, 0.82], high: [0.98, 0.98, 0.95], cells: [5, 4],
});

// Земля — квадрат травы со стороной size метров. Раскладка плиток своя у каждого запуска игры
// и не меняется, пока на делянке растят новые деревья.
export function makeGround(size) {
  texture.repeat.set(size / GRASS_TILE, size / GRASS_TILE);
  texture.offset.set(Math.floor(Math.random() * 100), Math.floor(Math.random() * 100));
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(size, size), material);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  return ground;
}

// Пучки травы — карточки из атласа 4 × 2 (grass-tufts.png), каждая из двух плоскостей крест-накрест.
// Все пучки в одной геометрии, чтобы рисовались за один раз. Нормали смотрят вверх: пучок
// освещён как земля под ним, а не как плоскость, повёрнутая к солнцу то лицом, то ребром.
// Изнанка — отдельные треугольники с той же нормалью (у DoubleSide нормаль изнанки смотрела бы вниз).
const [tuftTexture] = tiles(['assets/textures/grass-tufts.png']);
const tuftMaterial = new THREE.MeshLambertMaterial({ map: tuftTexture, alphaTest: 0.5 });

export function makeTufts(count, size, clear) {
  const pos = [], uv = [], index = [];
  for (let n = 0; n < count; n++) {
    const x = (Math.random() - 0.5) * size, z = (Math.random() - 0.5) * size;
    if (clear.some((c) => Math.hypot(x - c.x, z - c.z) < c.r)) continue;
    const cell = Math.floor(Math.random() * 8), u0 = (cell % 4) / 4, v0 = cell < 4 ? 0.5 : 0;
    const h = 0.5 + Math.random() * 0.4, w = h * 0.8, turn = Math.random() * Math.PI;
    for (const a of [turn, turn + Math.PI / 2]) {
      const dx = Math.cos(a) * w / 2, dz = Math.sin(a) * w / 2, k = pos.length / 3;
      pos.push(x - dx, 0, z - dz, x + dx, 0, z + dz, x + dx, h, z + dz, x - dx, h, z - dz);
      uv.push(u0, v0, u0 + 0.25, v0, u0 + 0.25, v0 + 0.5, u0, v0 + 0.5);
      index.push(k, k + 1, k + 2, k, k + 2, k + 3, k, k + 2, k + 1, k, k + 3, k + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(index);
  const tufts = new THREE.Mesh(geometry, tuftMaterial);
  tufts.receiveShadow = true;
  return tufts;
}
