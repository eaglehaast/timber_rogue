import * as THREE from 'three';
import { generator } from './random.js';
import { tiles, soften } from './surface.js';
import { height } from './terrain.js';
import { atlas, makeTufts } from './grass.js';

// Пшеничное поле за рекой (Никита, 2026-11-14: холм убрать, за рекой поле; с другой стороны двора берёзовая
// лесополоса, по бокам соседи). От реки до поля — пойменный луг; кромка поля прямая, как прошла сеялка, чуть
// наискось к реке; поле тянется до кольца панорамы.
// Поле — сплошная масса стеблей. Её верх лежит на высоте TOP, под колосьями, и покрыт плитками ChatGPT — спелое
// поле сверху. У кромки масса обрывается стенкой до земли, книзу стенка темнеет: в гуще стеблей сумрак.
// Из массы торчат колосья пучков: у кромки пучки стоят густо — сбоку видно стебли, — вглубь их почти нет:
// издали колосья сливаются с плитками.
// Поле пересекают технологические колеи — следы колёс трактора, что опрыскивает посев: пары борозд через
// TRAM.gap м от кромки вглубь. В бороздах пшеница примята: масса ниже и темнее, пучков нет.
// Всё в метрах двора, речка — к −z.
const EDGE = { z: [-50, -44], tilt: 0.06 };    // м: кромка у x = 0 по зерну; наклон кромки на метр по x
const REACH = 140;                              // м: поле в стороны и вглубь — до кольца панорамы
const TOP = 0.7, INSET = 1, STEP = 2;           // м: верх массы; на сколько стенка глубже кромки; шаг сетки
// В гуще стеблей сумрак: у земли пучки и стенка темнее — [яркость у земли, с какой высоты, м, освещены целиком].
const DUSK = [0.6, 0.5];
// Колеи: шаг пар, колея трактора (между бороздами), полуширина борозды; на сколько масса в борозде ниже и темнее.
const TRAM = { gap: 18, gauge: 1.8, half: 0.25, sink: 0.35, shade: 0.6 };
// Плитки поля сверху по 4 × 4 м с общими краями (tools/field.py), каждая клетка берёт свою.
const FIELD_TILE = 4;
const [map] = tiles(['assets/textures/wheat-field.jpg']);
const material = soften(new THREE.MeshLambertMaterial({ map, vertexColors: true }), {
  contrast: 0.9, saturation: 1, scales: [0.04, 0.2], low: [0.76, 0.68, 0.58], high: [1.04, 0.94, 0.84], cells: [4, 1],
});
// Пучки с колосьями (tools/tufts.py): попыток на 1000 м² — в полосе BAND м у кромки и глубже; от DEEP[0] до DEEP[1]
// м вглубь густота сходит до доли FAR.
const WHEAT = await atlas('wheat-tufts', { dusk: DUSK });
const BAND = 3, DEEP = [6, 16], PER = { band: 16000, deep: 3000 }, FAR = 0.03;

export function planField(seed) {
  const rnd = generator(seed + 61);
  const at = EDGE.z[0] + rnd() * (EDGE.z[1] - EDGE.z[0]), tilt = (2 * rnd() - 1) * EDGE.tilt, phase = rnd() * TRAM.gap;
  const edge = (x) => at + tilt * x;
  // Сколько метров от кромки вглубь поля; на лугу — меньше нуля.
  const into = (x, z) => edge(x) - z;
  // Середины борозд колей.
  const tracks = [];
  for (let c = phase - REACH; c < REACH; c += TRAM.gap) tracks.push(c - TRAM.gauge / 2, c + TRAM.gauge / 2);
  return { edge, into, tracks, cover: (x, z) => THREE.MathUtils.smoothstep(into(x, z), -0.5, 0.5) };
}

// Строить после shapeGround: масса и пучки встают по рельефу.
export function buildField(field) {
  const s = THREE.MathUtils.smoothstep, size = 2 * REACH;
  const free = (x) => field.tracks.every((c) => Math.abs(x - c) > TRAM.half);
  const tufts = (per, density) => makeTufts(WHEAT, Math.round((per * size * size) / 1000), size, (x, z) => (free(x) ? density(field.into(x, z)) : 0));
  return new THREE.Group().add(mass(field),
    tufts(PER.band, (d) => (d > -0.2 && d < BAND ? 1 : 0)),
    tufts(PER.deep, (d) => (d < BAND ? 0 : 1 - (1 - FAR) * s(d, DEEP[0], DEEP[1]))));
}

// Верх массы — сетка рядами от дальнего края к стенке, стенка — два ряда: верх и низ у земли. Плитка по x и z,
// на стенке — по x и высоте, продолжая верх через перегиб. Столбцы сетки — через STEP и гуще у каждой борозды:
// по краям борозды масса на своей высоте, внутри просела (dip — 0 вне борозды, 1 в ней).
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
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
}
