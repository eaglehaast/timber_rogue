import * as THREE from 'three';
import { tiles, soften } from './surface.js';
import { generator } from './random.js';
import { height } from './terrain.js';
import { YARD } from './fence.js';
import { makeTufts, wheatTufts } from './grass.js';

// Местность вокруг двора по плану Никиты (2026-11-08), вся объёмом. Двор — в середине, улица — к +z, всё в метрах двора.
// Сделано: спереди за улицей берёзовая лесополоса, за ней пшеничное поле. Дальше по плану: сзади луг вниз к речке
// в ивняке и бор за ней, по бокам соседские дворы.
// Траву растит world.js по grass(x, z). Деревья — картинки ChatGPT крестом из двух плоскостей, как пучки травы
// (tools/trees.py); поле — пучки пшеницы у края (tools/tufts.py) и плитки поля вдаль (tools/field.py). Пока заглушки.
export const MAP = 200;                     // м: сторона карты, где растёт трава
const REACH = 140;                          // м: досюда тянутся посадка и поле — до кольца гор
const BELT = { from: 32, to: 48, step: 3.5, jitter: 1, gaps: 0.12 }; // лесополоса: от и до по z, шаг посадки, сбой, пропуски
// Поле: от края по z; пучки пшеницы — в полосе deep от края, по density на м²; плитка поля — tile метров.
const FIELD = { from: 52, deep: 20, density: 5, tile: 4 };
const GRASS = { yard: 1, meadow: 0.6, belt: 0.35, sides: 0.8 };

const [birch] = await Promise.all(['birch'].map(async (kind) => {
  const [map] = tiles([`assets/textures/${kind}-trees.webp`]);
  const info = await (await fetch(`assets/textures/${kind}-trees.json`)).json();
  return { material: new THREE.MeshLambertMaterial({ map, alphaTest: 0.5 }), ...info };
}));
const [fieldMap] = tiles(['assets/textures/wheat-field.jpg']);
const fieldGround = soften(new THREE.MeshLambertMaterial({ map: fieldMap }), {
  contrast: 0.9, saturation: 0.85, scales: [0.13, 0.5], low: [0.9, 0.9, 0.88], high: [1.02, 1.02, 1], cells: [2, 2],
});

export function planLand(seed) {
  const rnd = generator(seed + 53);
  const s = THREE.MathUtils.smoothstep;
  // Сколько травы: густо во дворе и у соседей, на лугу поменьше, под берёзами редко, в поле — пшеница.
  const grass = (x, z) => {
    if (Math.abs(x) < YARD.w / 2 && Math.abs(z) < YARD.d / 2) return GRASS.yard;
    const sides = s(Math.abs(x), YARD.w / 2, YARD.w / 2 + 2) * (1 - s(z, YARD.d / 2, YARD.d / 2 + 2)) * s(z, -YARD.d / 2 - 2, -YARD.d / 2);
    let g = THREE.MathUtils.lerp(GRASS.meadow, GRASS.sides, sides);
    g *= THREE.MathUtils.lerp(1, GRASS.belt / GRASS.meadow, s(z, BELT.from - 1, BELT.from + 1) * (1 - s(z, BELT.to - 1, BELT.to + 1)));
    return g * (1 - s(z, FIELD.from - 2, FIELD.from));
  };
  // Лесополоса: ряды через step, в ряду — через step со сбоем, кое-где пропуск. Взрослых больше.
  // Берёза — { x, z, cell } (какая из атласа) и рост в её диапазоне.
  const birches = [], cells = [0, 0, 1, 1, 2, 2, 3, 4, 5, 6, 7];
  for (let z = BELT.from + 1; z <= BELT.to - 1; z += BELT.step) {
    for (let x = -REACH; x <= REACH; x += BELT.step) {
      if (rnd() < BELT.gaps) continue;
      const cell = cells[Math.floor(rnd() * cells.length)], [lo, hi] = birch.heights[cell];
      birches.push({ x: x + (rnd() - 0.5) * 2 * BELT.jitter, z: z + (rnd() - 0.5) * 2 * BELT.jitter, cell, h: lo + rnd() * (hi - lo) });
    }
  }
  return { seed, grass, birches };
}

// Деревья: каждое — две плоскости крестом, нормали вверх (освещены как земля, как пучки травы),
// изнанка — своими треугольниками. Комель чуть в земле, чтобы не висел на склоне.
function grove({ material, grid: [cols], aspect }, spots, rnd) {
  const pos = [], uv = [], index = [];
  for (const { x, z, cell, h } of spots) {
    const y = height(x, z) - 0.15, w = h * aspect, turn = rnd() * Math.PI;
    const u0 = cell / cols, u1 = (cell + 1) / cols;
    for (const a of [turn, turn + Math.PI / 2]) {
      const dx = (Math.cos(a) * w) / 2, dz = (Math.sin(a) * w) / 2, k = pos.length / 3;
      pos.push(x - dx, y, z - dz, x + dx, y, z + dz, x + dx, y + h, z + dz, x - dx, y + h, z - dz);
      uv.push(u0, 0, u1, 0, u1, 1, u0, 1);
      index.push(k, k + 1, k + 2, k, k + 2, k + 3, k, k + 2, k + 1, k, k + 3, k + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(index);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
}

// Поле — сетка по земле чуть над травой, от края до REACH; плитки поля по клеткам вперемешку.
// Ближний край прячется в пучках пшеницы.
function field() {
  const xs = 2 * REACH, zs = REACH - FIELD.from;
  const geometry = new THREE.PlaneGeometry(xs, zs, xs / 2, zs / 2).rotateX(-Math.PI / 2).translate(0, 0, FIELD.from + zs / 2);
  const pos = geometry.attributes.position, uv = geometry.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, height(pos.getX(i), pos.getZ(i)) + 0.02);
    uv.setXY(i, pos.getX(i) / FIELD.tile, pos.getZ(i) / FIELD.tile);
  }
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, fieldGround);
  mesh.receiveShadow = true;
  return mesh;
}

// Строить после shapeGround: деревья, поле и пшеница встают по земле.
export function buildLand({ seed, birches }) {
  const rnd = generator(seed + 59);
  // Пшеница — в квадрате карты, но только в полосе у края поля; гуще всего у самого края.
  const band = (x, z) => (z > FIELD.from && z < FIELD.from + FIELD.deep ? 1 : 0);
  const size = 2 * (FIELD.from + FIELD.deep);
  const wheat = makeTufts(wheatTufts, Math.round(FIELD.density * size * size), size, band);
  return new THREE.Group().add(grove(birch, birches, rnd), field(), wheat);
}
