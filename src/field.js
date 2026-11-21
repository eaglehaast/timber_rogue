import * as THREE from 'three';
import { generator } from './random.js';
import { tiles, soften } from './surface.js';
import { groundPatch, height } from './terrain.js';
import { atlas, makeTufts, noise } from './grass.js';
import { windUniforms, GUST_GLSL } from './wind.js';
import { NO_GRASS } from './device.js';

// Пшеничное поле за рекой (Никита, 2026-11-14: холм убрать, за рекой поле; с другой стороны двора берёзовая
// лесополоса, по бокам соседи). Река широкая, и пшеница растёт с самой бровки дальнего берега, до голой глины откоса.
// Кроме неё за рекой ничего нет, и земля под ней жёлтая — плитки того же поля (Никита 2026-11-17: пустая пойма
// с клочками травы — «ни о чём»; 2026-11-18: зелёные травы и подложка за рекой — мешанина). Поле тянется до кольца панорамы.
// Поле — сплошная масса стеблей. Её верх лежит на высоте TOP, под слоем колосьев, и покрыт плитками ChatGPT —
// спелое поле сверху, потемнее (DEPTH): это уже глубина между колосьями.
// Масса начинается в GAP метрах от бровки и обрывается к реке стенкой до земли, книзу стенка темнеет: в гуще стеблей
// сумрак. Перед стенкой стоят пучки пшеницы — стебли с колосьями, к бровке реже, куртинами: у воды трактор
// сеет с опаской. По всей массе торчат колосья: верхушки тех же пучков.
// Колосья качаются на ветру, а верх массы под порывом сдвигается с ними и светлеет — по полю бегут волны
// (Никита 2026-11-17: живой был только первый ряд, за ним мёртвая картинка). Вдали колосьев реже: там их
// не разглядеть, а рисовать их дорого.
// Поле пересекают технологические колеи — следы колёс трактора, что опрыскивает посев: пары борозд через
// TRAM.gap м. В бороздах пшеница примята: масса ниже и темнее, колосьев нет.
// Всё в метрах двора, речка — к −z.
const GAP = 1.5;                                // м от бровки дальнего берега до кромки массы
const REACH = 80;                               // м: поле в стороны и вглубь — достаточно до видимого горизонта
const TOP = 0.62, INSET = 1.5, STEP = 2;        // м: верх массы; на сколько стенка глубже кромки; шаг сетки
const DEPTH = 0.8, SOIL = 0.7;                  // яркость верха массы и земли поля против колосьев над ними
// Пшеница выше травы класса tall у tools/tufts.py (0,7–0,9 м): Никита 2026-11-17 — «чуть более высокой».
const HEIGHT = [0.85, 1.05];
// В гуще стеблей сумрак: у земли пучки и стенка темнее — [яркость у земли, с какой высоты, м, освещены целиком].
const DUSK = [0.6, 0.55];
// Колеи: шаг пар, колея трактора (между бороздами), полуширина борозды; на сколько масса в борозде ниже и темнее.
const TRAM = { gap: 18, gauge: 1.8, half: 0.25, sink: 0.35, shade: 0.6 };
// Плитки поля сверху по 4 × 4 м с общими краями (tools/field.py), каждая клетка берёт свою.
const FIELD_TILE = 4;
// Волны по полю: на сколько верх массы светлее под самым сильным порывом; с какой силы ветра (wind.max) волны полные.
const WAVE = 0.3, CALM = 0.15;
const [map] = tiles(['assets/textures/wheat-field.jpg']);
const look = { contrast: 0.9, saturation: 1, scales: [0.04, 0.2], low: [0.76, 0.68, 0.58], high: [1.04, 0.94, 0.84], cells: [4, 1] };
const material = soften(new THREE.MeshLambertMaterial({ map, vertexColors: true, color: new THREE.Color().setScalar(DEPTH) }), look);
// Земля поля лежит на сетке земли вершина в вершину и сдвинута к камере, как дно реки (river.js), — не мерцает с травой.
const soil = soften(new THREE.MeshLambertMaterial({ map, color: new THREE.Color().setScalar(SOIL), polygonOffset: true, polygonOffsetFactor: -1 }), look);
// Порыв клонит колос на windMax · (0,5 + 2,5 · gust) на метр высоты (sway в grass.js) — на столько же сдвигаем
// плитки верха, а светлеет он по самому порыву.
const soft = material.onBeforeCompile, key = material.customProgramCacheKey();
material.onBeforeCompile = (shader) => {
  soft(shader);
  Object.assign(shader.uniforms, windUniforms);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>
      ${GUST_GLSL}
      varying float vGust;`)
    .replace('#include <uv_vertex>', `#include <uv_vertex>
      vGust = gust(position.xz);
      vMapUv -= vec2(windDir.x, -windDir.y) * windMax * (0.5 + 2.5 * vGust) * ${(TOP / FIELD_TILE).toFixed(3)};`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
      uniform float windMax;
      varying float vGust;`)
    .replace('#include <color_fragment>', `#include <color_fragment>
      diffuseColor.rgb *= 1.0 + ${WAVE.toFixed(2)} * (vGust - 0.3) * min(1.0, windMax / ${CALM.toFixed(2)});`);
};
material.customProgramCacheKey = () => `${key} wind`;
// Пучки с колосьями (tools/tufts.py), попыток на 1000 м²: у кромки — целиком, до BAND м вглубь (дальше их низ
// всё равно в массе); по всему полю — только верхушки, EAR доли роста. Густота сходит с расстоянием от двора r:
// (NEAR / r)², у кромки — медленнее (FRONT): её видно вдоль, издали пучки сливаются.
// Между бровкой и кромкой массы пшеница обтрёпана: у кромки сплошная, к бровке редеет куртинами в пару метров.
const WHEAT = { ...(await atlas('wheat-tufts', { dusk: DUSK })), heights: Array(8).fill(HEIGHT) };
const BAND = 2.5, EAR = 0.45, PER = { band: 12000, ears: 3500 }, NEAR = 55, FRONT = 80;

// river — русло (river.js): кромка поля идёт вдоль бровки дальнего берега.
export function planField(seed, river) {
  const rnd = generator(seed + 61), phase = rnd() * TRAM.gap;
  const edge = (x) => river.brow(x, -1) - GAP;
  // Сколько метров от кромки массы вглубь поля; к воде — меньше нуля.
  const into = (x, z) => edge(x) - z;
  // Середины борозд колей.
  const tracks = [];
  for (let c = phase - REACH; c < REACH; c += TRAM.gap) tracks.push(c - TRAM.gauge / 2, c + TRAM.gauge / 2);
  // Всё за урезом дальнего берега — поле: трава луга там не растёт (cover = 1). Пшеница растёт, где на берегу
  // выросла бы трава (grows): не на голой глине откоса.
  return { edge, into, tracks, grows: river.grass, cover: (x, z) => (z < river.shore(x, -1) ? 1 : 0) };
}

// Строить после makeMeadow: земля поля — кусок её сетки, масса и пучки встают по рельефу.
export function buildField(field) {
  if (NO_GRASS) return new THREE.Group().add(floor(field), mass(field));
  const s = THREE.MathUtils.smoothstep, size = 2 * REACH;
  const free = (x) => field.tracks.every((c) => Math.abs(x - c) > TRAM.half);
  const far = (x, z, near) => Math.min(1, (near / Math.hypot(x, z)) ** 2);
  const tufts = (per, density, top) => makeTufts(WHEAT, Math.round((per * size * size) / 1000), size,
    (x, z) => (free(x) ? density(field.into(x, z), x, z) : 0), { top });
  const fray = (d, x, z) => field.cover(x, z) * field.grows(x, z) * THREE.MathUtils.lerp(0.3 + 0.7 * s(noise(x / 2 + 70, z / 2), 0.35, 0.65), 1, s(d, -GAP, 0));
  return new THREE.Group().add(floor(field), mass(field),
    tufts(PER.band, (d, x, z) => (d < BAND ? fray(d, x, z) * far(x, z, FRONT) : 0)),
    tufts(PER.ears, (d, x, z) => (d > INSET - 0.3 ? far(x, z, NEAR) : 0), EAR));
}

// Земля поля — кусок сетки земли от уреза до стенки массы (под массой землю не видно); голую глину откоса кладёт
// поверх русло (river.js). Плитка — как у верха массы.
function floor({ cover, into }) {
  const geometry = groundPatch((x, z) => cover(x, z) > 0 && into(x, z) < INSET), pos = geometry.attributes.position;
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(Array.from({ length: pos.count }, (_, i) => [pos.getX(i) / FIELD_TILE, -pos.getZ(i) / FIELD_TILE]).flat(), 2));
  const mesh = new THREE.Mesh(geometry, soil);
  mesh.receiveShadow = true;
  return mesh;
}

// Верх массы — сетка рядами от дальнего края к стенке, стенка — два ряда: верх и низ у земли. Плитка по x и z,
// на стенке — по x и высоте, продолжая верх через перегиб. Столбцы сетки — через STEP и гуще у каждой борозды:
// по краям борозды масса на своей высоте, внутри просела (dip — 0 вне борозды, 1 в ней).
// Нормали смотрят вверх, как у пучков (grass.js): масса освещена как колосья над ней, а стенка не чернеет,
// когда солнце светит вдоль неё.
function mass({ edge, tracks }) {
  const pos = [], uv = [], color = [], index = [];
  const columns = [];
  for (let x = -REACH; x <= REACH; x += STEP) if (tracks.every((c) => Math.abs(x - c) > 1.5 * TRAM.half)) columns.push([x, 0]);
  for (const c of tracks) columns.push([c - 1.4 * TRAM.half, 0], [c - 0.8 * TRAM.half, 1], [c + 0.8 * TRAM.half, 1], [c + 1.4 * TRAM.half, 0]);
  columns.sort((a, b) => a[0] - b[0]);
  const n = columns.length, rows = Math.ceil((REACH + edge(0)) / STEP);
  // Ряды вершин подряд; соседние ряды — полоса треугольников лицом вверх (верх) или к двору (стенка).
  const grid = (lines) => {
    const first = pos.length / 3;
    lines.forEach((line, j) => columns.forEach(([x, dip], i) => {
      const [y, z, v, c] = line(x);
      pos.push(x, y - TRAM.sink * dip, z);
      uv.push(x / FIELD_TILE, v / FIELD_TILE);
      color.push(...Array(3).fill(c * (1 - (1 - TRAM.shade) * dip)));
      if (j && i < n - 1) {
        const a = first + (j - 1) * n + i, b = a + 1, c1 = a + n, d = c1 + 1;
        index.push(a, c1, b, b, c1, d);
      }
    }));
  };
  const near = (x) => edge(x) - INSET;
  grid(Array.from({ length: rows + 1 }, (_, j) => (x) => {
    const z = THREE.MathUtils.lerp(-REACH, near(x), j / rows);
    return [height(x, z) + TOP, z, -z, 1];
  }));
  grid([0, 1].map((j) => (x) => {
    const z = near(x), drop = j * (TOP + 0.1);
    return [height(x, z) + TOP - drop, z, drop - z, j ? DUSK[0] : 1];
  }));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
  geometry.setIndex(index);
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
}
