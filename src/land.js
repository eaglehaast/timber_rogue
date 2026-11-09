import * as THREE from 'three';
import { generator, smoothNoise } from './random.js';
import { tiles } from './surface.js';
import { height } from './terrain.js';

// Местность вокруг двора по плану Никиты (2026-11-08), вся объёмом. Двор — в середине, улица — к +z, всё в метрах двора.
// Сделано: берёзовая лесополоса за улицей (по фото Никиты из такой полосы). Полоса посажена на пологом валу;
// берёзы — рядами на гребнях старой вспашки, тесно, между гребнями борозды; посередине широкая просека; весь вал
// в кочках; у поля — канава. Дальше по плану: поле за канавой, сзади луг к речке и бор, по бокам соседи.
// Рельеф отдаёт dug(x, z) — на сколько вдавлено (минус — поднято), как улица в road.js; terrain.js складывает.
const BELT = { from: 32, to: 48, rise: 0.45, slope: 3 };    // м: полоса по z, высота вала, на сколько метров он сходит
// Ряды деревьев по z — по два с каждой стороны просеки; гребень под рядом и борозда между гребнями: высота и полуширина;
// как ряд виляет вдоль полосы (вспахано не по линейке).
export const ROWS = [33.5, 37, 42.5, 46];
const PLOW = { ridge: 0.09, furrow: 0.07, half: 1.1, wander: 0.35 };
const TUSSOCK = { size: 1.3, height: 0.07 };                // кочки от обочины до канавы: размер и высота
const DITCH = { z: 50.5, half: 1.3, depth: 0.3 };           // канава у поля: середина, полуширина, глубина

// Берёзы — картинки ChatGPT (tools/trees.py → birch-trees.webp и .json): 01–03 взрослые, 04–06 средние, 07 молодая,
// 08 сухая. В ряду — через step метров, чуть вбок от ряда (jitter), кое-где пропуск; cells — какие картинки и как часто.
const GROVE = { step: [1.8, 3.4], jitter: 0.35, gaps: 0.08, reach: 140, cells: [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7] };
const BIRCH = await (await fetch('assets/textures/birch-trees.json')).json();
const birchMap = tiles(['assets/textures/birch-trees.webp'])[0];

const bump = (t) => (Math.abs(t) < 1 ? (1 - t * t) ** 2 : 0);

export function planLand(seed) {
  const rnd = generator(seed + 53);
  const smooth = smoothNoise(rnd), noise = (x, z) => 2 * smooth(x, z) - 1;
  const s = THREE.MathUtils.smoothstep;
  // Вал: поднимается за slope метров до полосы и опускается за ней к канаве.
  const bank = (z) => s(z, BELT.from - BELT.slope, BELT.from) * (1 - s(z, BELT.to, BELT.to + BELT.slope));
  // Середина k-го ряда (гребня) у x.
  const rowAt = (k, x) => ROWS[k] + PLOW.wander * noise(x / 13, 7 * k);
  // Гребни под рядами; между рядами одной пары и снаружи — борозды. Где пахали глубже, где мельче.
  const plow = (x, z) => {
    let h = 0;
    ROWS.forEach((row, k) => {
      const at = rowAt(k, x);
      h += PLOW.ridge * bump((z - at) / PLOW.half);
      for (const side of [-1, 1]) h -= PLOW.furrow * bump((z - at - side * 1.75) / (PLOW.half * 0.8));
    });
    return h * (0.7 + 0.3 * noise(x / 20, 3));
  };
  const dug = (x, z) => {
    const raised = BELT.rise * bank(z) * (0.85 + 0.15 * noise(x / 30, 11)) + bank(z) * plow(x, z);
    const tussocks = TUSSOCK.height * s(noise(x / TUSSOCK.size, z / TUSSOCK.size + 40), 0.1, 0.9) * s(z, BELT.from - 6, BELT.from - 2) * (1 - s(z, DITCH.z - 1, DITCH.z));
    return DITCH.depth * bump((z - DITCH.z) / DITCH.half) - raised - tussocks;
  };
  // Трава сочная от обочины через всю полосу до канавы: в тени берёз земля не пересыхает.
  const lush = (x, z) => s(z, BELT.from - 5, BELT.from - 1) * (1 - s(z, DITCH.z, DITCH.z + 1));
  // Берёзы по рядам: { x, z, cell, h } — место, картинка и рост в её диапазоне.
  const birches = [];
  ROWS.forEach((_, k) => {
    for (let x = -GROVE.reach; x < GROVE.reach; x += GROVE.step[0] + rnd() * (GROVE.step[1] - GROVE.step[0])) {
      if (rnd() < GROVE.gaps) continue;
      const cell = GROVE.cells[Math.floor(rnd() * GROVE.cells.length)], [lo, hi] = BIRCH.heights[cell];
      birches.push({ x, z: rowAt(k, x) + (rnd() - 0.5) * 2 * GROVE.jitter, cell, h: lo + rnd() * (hi - lo) });
    }
  });
  return { seed, dug, lush, birches };
}

// Картинка дерева всегда повёрнута к камере вокруг своего ствола: вершины лежат на оси, side — сдвиг вбок в метрах,
// в шейдере сдвиг идёт поперёк взгляда. Крест из двух картинок дал бы два ствола, если смотреть наискось.
// Тень рисуется тем же способом, и картинка в ней повёрнута к солнцу: тень — силуэт всей берёзы.
function facing(shader) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>
      attribute float side;`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      vec2 look = normalize(cameraPosition.xz - transformed.xz);
      transformed.xz += vec2(-look.y, look.x) * side;`);
}
const birchMaterial = new THREE.MeshLambertMaterial({ map: birchMap, alphaTest: 0.5, shadowSide: THREE.DoubleSide });
const birchDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: birchMap, alphaTest: 0.5 });
for (const material of [birchMaterial, birchDepth]) {
  material.onBeforeCompile = facing;
  material.customProgramCacheKey = () => 'facing';
}

// Строить после shapeGround: берёзы встают по земле, комель чуть в ней. Нормали вверх — дерево освещено как земля
// под ним, как пучки травы.
export function buildLand({ birches }) {
  const [cols] = BIRCH.grid, pos = [], uv = [], side = [], index = [];
  for (const { x, z, cell, h } of birches) {
    const y = height(x, z) - 0.1, w = h * BIRCH.aspect, k = pos.length / 3, u0 = cell / cols, u1 = (cell + 1) / cols;
    pos.push(x, y, z, x, y, z, x, y + h, z, x, y + h, z);
    side.push(w / 2, -w / 2, -w / 2, w / 2); // так лицом к камере
    uv.push(u0, 0, u1, 0, u1, 1, u0, 1);
    index.push(k, k + 1, k + 2, k, k + 2, k + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute('side', new THREE.Float32BufferAttribute(side, 1));
  geometry.setIndex(index);
  const grove = new THREE.Mesh(geometry, birchMaterial);
  grove.customDepthMaterial = birchDepth;
  grove.castShadow = grove.receiveShadow = true;
  grove.frustumCulled = false; // вершины на осях: рамка геометрии без ширины картинок
  return grove;
}
