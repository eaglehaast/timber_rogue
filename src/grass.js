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
const LUSH = 'vec3(0.72, 1.25, 0.22)'; // сочная зелень: во сколько раз каждый цвет против яркости пучка
const [texture] = tiles(['assets/textures/grass-clover.jpg']);
const material = soften(new THREE.MeshLambertMaterial({ map: texture }), {
  contrast: 0.85, saturation: 0.65, scales: [0.13, 0.5], low: [0.8, 0.84, 0.82], high: [0.98, 0.98, 0.95], cells: [5, 4],
});

// Земля — квадрат травы со стороной size метров, выгнутый по рельефу (terrain.js). Раскладка плиток
// своя у каждого запуска игры и не меняется, пока на делянке растят новые деревья.
export function makeGround(size) {
  texture.repeat.set(size / GRASS_TILE, size / GRASS_TILE);
  texture.offset.set(Math.floor(Math.random() * 100), Math.floor(Math.random() * 100));
  const ground = new THREE.Mesh(groundGeometry(size), material);
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
// Вдали картинка пучка берётся с мелкого мип-уровня, где тонкий стебель усреднён с пустотой вокруг: прозрачность
// падает ниже alphaTest, и стебли пропадают (пшеница за 20 м исчезала целиком). Поэтому на каждом мип-уровне
// прозрачность умножаем на 1 + KEEP за уровень — покрытие пучка вдали остаётся, как вблизи.
// dusk — [яркость у основания, высота в м, с которой пучок освещён целиком]: в густом посеве (пшеница) низ стеблей
// в тени соседей. У травы луга низ не темнее верха.
const KEEP = '0.25';
const sway = (dusk) => (shader) => {
  Object.assign(shader.uniforms, windUniforms);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>
      attribute float lift, lush;
      varying float vLush, vRise;
      ${GUST_GLSL}`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      vRise = transformed.y;
      float lean = windMax * (0.5 + 2.5 * gust(transformed.xz)) + 0.03 * sin(5.0 * windTime + dot(transformed.xz, vec2(3.1, 4.7)));
      transformed.xz += windDir * lean * transformed.y;
      transformed.y += lift;
      vLush = lush;`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
      varying float vLush, vRise;`)
    .replace('#include <map_fragment>', `#include <map_fragment>
      vec2 tuftTexel = vMapUv * vec2(textureSize(map, 0));
      float tuftMip = 0.5 * log2(max(dot(dFdx(tuftTexel), dFdx(tuftTexel)), dot(dFdy(tuftTexel), dFdy(tuftTexel))));
      diffuseColor.a *= 1.0 + ${KEEP} * max(0.0, tuftMip);
      float tuftLuma = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
      diffuseColor.rgb = mix(diffuseColor.rgb, tuftLuma * ${LUSH}, vLush);
      ${dusk ? `diffuseColor.rgb *= mix(${dusk[0].toFixed(2)}, 1.0, smoothstep(0.0, ${dusk[1].toFixed(2)}, vRise));` : ''}`);
};

// Широколистные низкие растения (одуванчик) крест из двух карточек выдаёт: сверху видно, что их две.
// Им одна карточка, которая поворачивается вокруг своей оси к камере. Вершины лежат на оси пучка,
// а side — сдвиг вершины вбок от неё в метрах; в шейдере сдвиг идёт поперёк взгляда.
const face = (dusk) => (shader) => {
  sway(dusk)(shader);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>
      attribute float side;`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      vec2 look = normalize(cameraPosition.xz - transformed.xz);
      transformed.xz += vec2(-look.y, look.x) * side;`);
};

// rank — насколько пучок высокий среди всех в атласе: 0 — самый низкий класс, 1 — самый высокий.
// turning — карточка поворачивается к камере (face), а не стоит крестом; dusk — тень у основания (sway).
export async function atlas(name, { turning = false, dusk } = {}) {
  const [map] = tiles([`assets/textures/${name}.webp`]);
  const material = new THREE.MeshLambertMaterial({ map, alphaTest: 0.5 });
  material.onBeforeCompile = (turning ? face : sway)(dusk);
  // Текст onBeforeCompile у всех атласов один: свой ключ, иначе Three.js отдал бы всем одну программу.
  material.customProgramCacheKey = () => JSON.stringify([turning, dusk]);
  const { grid: [cols, rows], aspect, heights } = await (await fetch(`assets/textures/${name}.json`)).json();
  const tallest = Math.max(...heights.map(([, h]) => h)), lowest = Math.min(...heights.map(([, h]) => h));
  // У атласа одного роста все пучки в ранге 0 и выбираются поровну (без || 1 вышло бы 0 / 0 — всегда первый пучок).
  const rank = heights.map(([, h]) => (h - lowest) / (tallest - lowest || 1));
  return { material, cols, rows, aspect, heights, rank, turning };
}
// Злаки (ежа, мятлик, овсяница…) — один атлас, у каждого сорняка свой: вместе не влезли бы в одну текстуру.
export const grassTufts = await atlas('grass-tufts');
export const mugwortTufts = await atlas('mugwort-tufts');
export const nettleTufts = await atlas('nettle-tufts');
export const tansyTufts = await atlas('tansy-tufts');
export const dandelionTufts = await atlas('dandelion-tufts', { turning: true });
export const cloverTufts = await atlas('clover-tufts', { turning: true });
export const yarrowTufts = await atlas('yarrow-tufts', { turning: true });

// Плавный шум 0..1 с ячейкой в метр: по нему трава то выше и гуще, то ниже и реже.
export const noise = smoothNoise(Math.random);

// Трава сплошным покровом: на каждый квадратный метр около density(x, z) × count / size² попыток.
// Где травы нет (дорога, дом, у ствола) — там density равна нулю.
// Куртины: где шум «дикий», берём в основном высокие пучки и сажаем гуще, между ними — низкая трава.
// Где траву топчут (между колеями), trodden близко к 1: куртин высокой там нет, растёт низкая.
// Где трава сочная (lush близко к 1), она сплошная и ровная: куртин почти нет, пучок зеленее.
// top — какую долю роста пучка оставить сверху: верхушки торчат из сплошной массы (колосья над полем), низ не рисуем.
export function makeTufts({ material, cols, rows, aspect, heights, rank, turning }, count, size, density, { trodden = () => 0, lush = () => 0, top = 1 } = {}) {
  const pos = [], uv = [], index = [], side = [], lift = [], green = [];
  for (let n = 0; n < count; n++) {
    const x = (Math.random() - 0.5) * size, z = (Math.random() - 0.5) * size;
    const wild = THREE.MathUtils.smoothstep(noise(x / 5, z / 5), 0.3, 0.7) * (1 - trodden(x, z)) * (1 - 0.7 * lush(x, z));
    if (Math.random() > density(x, z) * (0.5 + 0.5 * wild)) continue;
    const weights = rank.map((t) => t * wild + (1 - t) * (1 - wild) + 0.05);
    let pick = Math.random() * weights.reduce((a, b) => a + b), cell = 0;
    while ((pick -= weights[cell]) > 0) cell++;
    const [low, high] = heights[cell];
    const u0 = (cell % cols) / cols, v1 = 1 - Math.floor(cell / cols) / rows, u1 = u0 + 1 / cols, v0 = v1 - top / rows;
    // Где топчут, пучок примят: ниже до трети роста.
    const h = (low + Math.random() * (high - low)) * (1 - 0.65 * trodden(x, z)), w = h * aspect, turn = Math.random() * Math.PI, y = height(x, z), g = lush(x, z);
    const cards = turning ? [[0, 0]] : [turn, turn + Math.PI / 2].map((a) => [Math.cos(a) * w / 2, Math.sin(a) * w / 2]);
    for (const [dx, dz] of cards) {
      const k = pos.length / 3;
      pos.push(x - dx, h * (1 - top), z - dz, x + dx, h * (1 - top), z + dz, x + dx, h, z + dz, x - dx, h, z - dz);
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
