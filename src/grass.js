import * as THREE from 'three';
import { tiles, soften } from './surface.js';
import { windUniforms, GUST_GLSL } from './wind.js';
import { smoothNoise } from './random.js';
import { groundGeometry, height } from './terrain.js';

// Трава на земле — набор из 20 акварельных плиток по GRASS_TILE метров с общими краями (сетка 5 × 4
// в одной картинке): каждая клетка земли берёт свою плитку, и узор не повторяется.
// Тон приглушён под пучки: земля темнее и спокойнее их, чтобы пучки на ней читались.
// Пятна тона около 15 и 4 метров.
const GRASS_TILE = 2;
// Под соснами земля усыпана хвоей: набор из 5 плиток по LITTER_TILE метров с общими краями (tools/pine.py).
const LITTER_TILE = 1.2, SHADE = 0.45;
const LUSH = 'vec3(0.72, 1.25, 0.22)'; // сочная зелень: во сколько раз каждый цвет против яркости пучка
const [texture, litter] = tiles(['assets/textures/grass-clover.jpg', 'assets/textures/pine-litter.jpg']);
const material = soften(new THREE.MeshLambertMaterial({ map: texture, vertexColors: true }), {
  contrast: 0.85, saturation: 0.65, scales: [0.13, 0.5], low: [0.8, 0.84, 0.82], high: [0.98, 0.98, 0.95], cells: [5, 4],
  blend: { map: litter, cells: [5, 1], groups: [5], scale: [GRASS_TILE / LITTER_TILE, GRASS_TILE / LITTER_TILE] },
});

// Земля — квадрат травы со стороной size метров, выгнутый по рельефу (terrain.js). Раскладка плиток
// своя у каждого запуска игры и не меняется, пока на делянке растят новые деревья.
// litter(x, z) — сколько на земле опавшей хвои, 0..1: там вместо травы подстилка, и она в тени сомкнутых крон
// (тени солнца от карты теней туда не достают): земля темнее на SHADE.
export function makeGround(size, litter = () => 0) {
  texture.repeat.set(size / GRASS_TILE, size / GRASS_TILE);
  texture.offset.set(Math.floor(Math.random() * 100), Math.floor(Math.random() * 100));
  const geometry = groundGeometry(size), pos = geometry.attributes.position;
  const under = Array.from({ length: pos.count }, (_, i) => litter(pos.getX(i), pos.getZ(i)));
  geometry.setAttribute('blend', new THREE.Float32BufferAttribute(under.map((k) => 1 - k), 1));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(under.flatMap((k) => Array(3).fill(1 - SHADE * k)), 3));
  const ground = new THREE.Mesh(geometry, material);
  ground.receiveShadow = true;
  return ground;
}

// Пучки — карточки из атласа (собирает tools/tufts.py), каждая из двух плоскостей крест-накрест.
// Сетку атласа и диапазон высот каждого пучка в метрах берём из json рядом с картинкой.
// Все пучки атласа в одной геометрии, чтобы рисовались за один раз. Нормали смотрят вверх: пучок
// освещён как земля под ним, а не как плоскость, повёрнутая к солнцу то лицом, то ребром.
// Изнанка — отдельные треугольники с той же нормалью (у DoubleSide нормаль изнанки смотрела бы вниз).
// Высота вершины в геометрии — над основанием пучка, а на землю его поднимает lift: так ветер клонит
// пучок по его собственной высоте, где бы на рельефе он ни стоял.
// Ветер клонит пучок вокруг основания: сдвиг вершины по ветру растёт с её высотой. Клонится сильнее,
// чем дерево, и подрагивает сам по себе — у каждого пучка своя фаза дрожи по его месту.
// Где трава сочная (lush, 0..1 — в тени лесополосы), пучок зеленее и ярче: тот же рисунок, тон к молодой зелени.
function sway(shader) {
  Object.assign(shader.uniforms, windUniforms);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>
      attribute float lift, lush;
      varying float vLush;
      ${GUST_GLSL}`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      float lean = windMax * (0.5 + 2.5 * gust(transformed.xz)) + 0.03 * sin(5.0 * windTime + dot(transformed.xz, vec2(3.1, 4.7)));
      transformed.xz += windDir * lean * transformed.y;
      transformed.y += lift;
      vLush = lush;`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
      varying float vLush;`)
    .replace('#include <map_fragment>', `#include <map_fragment>
      float tuftLuma = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
      diffuseColor.rgb = mix(diffuseColor.rgb, tuftLuma * ${LUSH}, vLush);`);
}

// Широколистные низкие растения (одуванчик) крест из двух карточек выдаёт: сверху видно, что их две.
// Им одна карточка, которая поворачивается вокруг своей оси к камере. Вершины лежат на оси пучка,
// а side — сдвиг вершины вбок от неё в метрах; в шейдере сдвиг идёт поперёк взгляда.
function face(shader) {
  sway(shader);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>
      attribute float side;`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      vec2 look = normalize(cameraPosition.xz - transformed.xz);
      transformed.xz += vec2(-look.y, look.x) * side;`);
}

// rank — насколько пучок высокий среди всех в атласе: 0 — самый низкий класс, 1 — самый высокий.
// turning — карточка поворачивается к камере (face), а не стоит крестом.
export async function atlas(name, turning = false) {
  const [map] = tiles([`assets/textures/${name}.webp`]);
  const material = new THREE.MeshLambertMaterial({ map, alphaTest: 0.5 });
  material.onBeforeCompile = turning ? face : sway;
  const { grid: [cols, rows], aspect, heights } = await (await fetch(`assets/textures/${name}.json`)).json();
  const tallest = Math.max(...heights.map(([, h]) => h)), lowest = Math.min(...heights.map(([, h]) => h));
  const rank = heights.map(([, h]) => (h - lowest) / (tallest - lowest));
  return { material, cols, rows, aspect, heights, rank, turning };
}
// Злаки (ежа, мятлик, овсяница…) — один атлас, у каждого сорняка свой: вместе не влезли бы в одну текстуру.
export const grassTufts = await atlas('grass-tufts');
export const mugwortTufts = await atlas('mugwort-tufts');
export const nettleTufts = await atlas('nettle-tufts');
export const tansyTufts = await atlas('tansy-tufts');
export const dandelionTufts = await atlas('dandelion-tufts', true);
export const cloverTufts = await atlas('clover-tufts', true);
export const yarrowTufts = await atlas('yarrow-tufts', true);

// Плавный шум 0..1 с ячейкой в метр: по нему трава то выше и гуще, то ниже и реже.
export const noise = smoothNoise(Math.random);

// Трава сплошным покровом: на каждый квадратный метр около density(x, z) × count / size² попыток.
// Где травы нет (дорога, дом, у ствола) — там density равна нулю.
// Куртины: где шум «дикий», берём в основном высокие пучки и сажаем гуще, между ними — низкая трава.
// Где траву топчут (между колеями), trodden близко к 1: куртин высокой там нет, растёт низкая.
// Где трава сочная (lush близко к 1), она сплошная и ровная: куртин почти нет, пучок зеленее.
export function makeTufts({ material, cols, rows, aspect, heights, rank, turning }, count, size, density, { trodden = () => 0, lush = () => 0 } = {}) {
  const pos = [], uv = [], index = [], side = [], lift = [], green = [];
  for (let n = 0; n < count; n++) {
    const x = (Math.random() - 0.5) * size, z = (Math.random() - 0.5) * size;
    const wild = THREE.MathUtils.smoothstep(noise(x / 5, z / 5), 0.3, 0.7) * (1 - trodden(x, z)) * (1 - 0.7 * lush(x, z));
    if (Math.random() > density(x, z) * (0.5 + 0.5 * wild)) continue;
    const weights = rank.map((t) => t * wild + (1 - t) * (1 - wild) + 0.05);
    let pick = Math.random() * weights.reduce((a, b) => a + b), cell = 0;
    while ((pick -= weights[cell]) > 0) cell++;
    const [low, high] = heights[cell];
    const u0 = (cell % cols) / cols, v0 = 1 - (Math.floor(cell / cols) + 1) / rows, u1 = u0 + 1 / cols, v1 = v0 + 1 / rows;
    // Где топчут, пучок примят: ниже до трети роста.
    const h = (low + Math.random() * (high - low)) * (1 - 0.65 * trodden(x, z)), w = h * aspect, turn = Math.random() * Math.PI, y = height(x, z), g = lush(x, z);
    const cards = turning ? [[0, 0]] : [turn, turn + Math.PI / 2].map((a) => [Math.cos(a) * w / 2, Math.sin(a) * w / 2]);
    for (const [dx, dz] of cards) {
      const k = pos.length / 3;
      pos.push(x - dx, 0, z - dz, x + dx, 0, z + dz, x + dx, h, z + dz, x - dx, h, z - dz);
      if (turning) side.push(-w / 2, w / 2, w / 2, -w / 2);
      uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
      lift.push(y, y, y, y);
      green.push(g, g, g, g);
      index.push(k, k + 1, k + 2, k, k + 2, k + 3, k, k + 2, k + 1, k, k + 3, k + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute('lift', new THREE.Float32BufferAttribute(lift, 1));
  geometry.setAttribute('lush', new THREE.Float32BufferAttribute(green, 1));
  if (turning) geometry.setAttribute('side', new THREE.Float32BufferAttribute(side, 1));
  geometry.setIndex(index);
  const tufts = new THREE.Mesh(geometry, material);
  tufts.receiveShadow = true;
  return tufts;
}
