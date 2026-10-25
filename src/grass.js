import * as THREE from 'three';
import { tiles, soften } from './surface.js';
import { windUniforms, GUST_GLSL } from './wind.js';

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

// Пучки — карточки из атласа (собирает tools/tufts.py), каждая из двух плоскостей крест-накрест.
// Сетку атласа и диапазон высот каждого пучка в метрах берём из json рядом с картинкой.
// Все пучки атласа в одной геометрии, чтобы рисовались за один раз. Нормали смотрят вверх: пучок
// освещён как земля под ним, а не как плоскость, повёрнутая к солнцу то лицом, то ребром.
// Изнанка — отдельные треугольники с той же нормалью (у DoubleSide нормаль изнанки смотрела бы вниз).
// Ветер клонит пучок вокруг основания: сдвиг вершины по ветру растёт с её высотой. Клонится сильнее,
// чем дерево, и подрагивает сам по себе — у каждого пучка своя фаза дрожи по его месту.
function sway(shader) {
  Object.assign(shader.uniforms, windUniforms);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>
      ${GUST_GLSL}`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      float lean = windMax * (0.5 + 2.5 * gust(transformed.xz)) + 0.03 * sin(5.0 * windTime + dot(transformed.xz, vec2(3.1, 4.7)));
      transformed.xz += windDir * lean * transformed.y;`);
}

// rank — насколько пучок высокий среди всех в атласе: 0 — самый низкий класс, 1 — самый высокий.
async function atlas(name) {
  const [map] = tiles([`assets/textures/${name}.png`]);
  const material = new THREE.MeshLambertMaterial({ map, alphaTest: 0.5 });
  material.onBeforeCompile = sway;
  const { grid: [cols, rows], aspect, heights } = await (await fetch(`assets/textures/${name}.json`)).json();
  const tallest = Math.max(...heights.map(([, h]) => h)), lowest = Math.min(...heights.map(([, h]) => h));
  const rank = heights.map(([, h]) => (h - lowest) / (tallest - lowest));
  return { material, cols, rows, aspect, heights, rank };
}
// Злаки (ежа, мятлик, овсяница…) и сорняки (полынь) — два атласа: вместе не влезли бы в одну текстуру.
export const grassTufts = await atlas('grass-tufts');
export const weedTufts = await atlas('weed-tufts');

// Плавный шум 0..1 с ячейкой в метр: по нему трава то выше и гуще, то ниже и реже.
const salt = Math.random() * 1000;
const hash = (i, j) => { const h = Math.sin(i * 127.1 + j * 311.7 + salt) * 43758.5453; return h - Math.floor(h); };
export function noise(x, z) {
  const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = hash(i, j) + (hash(i + 1, j) - hash(i, j)) * sx, b = hash(i, j + 1) + (hash(i + 1, j + 1) - hash(i, j + 1)) * sx;
  return a + (b - a) * sz;
}

// Трава сплошным покровом: на каждый квадратный метр около density(x, z) × count / size² попыток.
// Куртины: где шум «дикий», берём в основном высокие пучки и сажаем гуще, между ними — низкая трава.
export function makeTufts({ material, cols, rows, aspect, heights, rank }, count, size, clear, density) {
  const pos = [], uv = [], index = [];
  for (let n = 0; n < count; n++) {
    const x = (Math.random() - 0.5) * size, z = (Math.random() - 0.5) * size;
    if (clear.some((c) => Math.hypot(x - c.x, z - c.z) < c.r)) continue;
    const wild = THREE.MathUtils.smoothstep(noise(x / 5, z / 5), 0.3, 0.7);
    if (Math.random() > density(x, z) * (0.5 + 0.5 * wild)) continue;
    const weights = rank.map((t) => t * wild + (1 - t) * (1 - wild) + 0.05);
    let pick = Math.random() * weights.reduce((a, b) => a + b), cell = 0;
    while ((pick -= weights[cell]) > 0) cell++;
    const [low, high] = heights[cell];
    const u0 = (cell % cols) / cols, v0 = 1 - (Math.floor(cell / cols) + 1) / rows, u1 = u0 + 1 / cols, v1 = v0 + 1 / rows;
    const h = low + Math.random() * (high - low), w = h * aspect, turn = Math.random() * Math.PI;
    for (const a of [turn, turn + Math.PI / 2]) {
      const dx = Math.cos(a) * w / 2, dz = Math.sin(a) * w / 2, k = pos.length / 3;
      pos.push(x - dx, 0, z - dz, x + dx, 0, z + dz, x + dx, h, z + dz, x - dx, h, z - dz);
      uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
      index.push(k, k + 1, k + 2, k, k + 2, k + 3, k, k + 2, k + 1, k, k + 3, k + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(index);
  const tufts = new THREE.Mesh(geometry, material);
  tufts.receiveShadow = true;
  return tufts;
}
