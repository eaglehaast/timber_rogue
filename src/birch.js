import * as THREE from 'three';
import { section } from './axis.js';
import { random, seed } from './random.js';
import { tiles } from './surface.js';
import { swaying, dense, depth, barkGeometry, sprayGeometry, plant } from './foliage.js';
import { KINDS, skeleton, birchBarkMaterial } from './birch-wood.js';
export { KINDS, plantFallen, makeLogs } from './birch-wood.js';

// Объёмная берёза с ветвями и качающейся листвой для сцен, где нужно отдельное живое дерево.
const UP = new THREE.Vector3(0, 1, 0);
const rand = (a, b) => a + random() * (b - a);
// Пряди — атлас вертикальных картинок (tools/birch.py): aspect — ширина к высоте клетки, length — длина клетки
// в метрах, kind — вид: 0 длинная прядь, 1 короткий пучок (обе свисают, крепятся сверху), 2 побег вверх (снизу).
const SPRAY = await (await fetch('assets/textures/birch-spray.json')).json();
const BY_KIND = [0, 1, 2].map((kind) => SPRAY.kind.flatMap((k, cell) => (k === kind ? [cell] : [])));
const [sprayMap] = tiles(['assets/textures/birch-spray.webp']);
const bark = swaying(birchBarkMaterial());
const spray = dense(swaying(new THREE.MeshLambertMaterial({ map: sprayMap, alphaTest: 0.5 })));
const [barkDepth, sprayDepth] = [depth(null), dense(depth(sprayMap))];

// Пряди на ветвях и веточках: где крепится (at), куда смотрит плоскость (across), куда идёт прядь (down), длина l.
// Вдоль ветвей свисают длинные пряди и короткие пучки; макушку и концы верхних ветвей венчают побеги вверх.
const LONG = 0.7; // доля длинных прядей среди свисающих
function sprays(axes, trunk, height) {
  const list = [], scale = THREE.MathUtils.clamp(height / 16, 0.35, 1);
  const add = (a, s, kind) => {
    const at = section(a, s).center, up = kind === 2, cells = BY_KIND[kind], cell = cells[Math.floor(random() * cells.length)];
    const outward = at.clone().sub(section(trunk, Math.min(trunk.len, at.y)).center).setY(0).normalize();
    const down = (up ? UP.clone() : UP.clone().negate()).addScaledVector(outward, up ? 0.4 : 0.25).normalize();
    const az = rand(0, 2 * Math.PI), across = new THREE.Vector3(Math.cos(az), 0, -Math.sin(az));
    across.addScaledVector(down, -across.dot(down)).normalize();
    list.push({ at, across, down, up, cell, l: SPRAY.length[cell] * scale * rand(0.8, 1.2), seed: rand(0, 2 * Math.PI) });
  };
  for (const a of axes) {
    if (a.level) for (let s = 0.2 * a.len; s <= a.len; s += rand(0.08, 0.16)) add(a, s, random() < LONG ? 0 : 1);
    if (!a.level || (a.level === 1 && a.attach > 0.75 * trunk.len)) add(a, a.len, 2);
  }
  return list;
}

// Берёза вида k: кора и пряди.
function grow(height, k) {
  seed(7919 * (k + 1));
  const { axes, trunk } = skeleton(height);
  return { bark: barkGeometry(axes.filter((a) => a.level < 2), height), spray: sprayGeometry(sprays(axes, trunk, height), height, SPRAY) };
}

// Берёзы trees = [{ x, y, z, kind, turn, scale }] — копии своего вида (plant в foliage.js).
let kinds = null;
const grown = () => (kinds ??= KINDS.map(grow));
export const plantBirches = (trees) => plant(grown(), trees, [['bark', bark, barkDepth, true], ['spray', spray, sprayDepth, false]]);
