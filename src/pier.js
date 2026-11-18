import * as THREE from 'three';
import { generator } from './random.js';
import { height } from './terrain.js';
import { Planks, boardMaterials, TONES } from './attic.js';

// Рыбацкие мостки с нашего берега (Никита, 2026-11-10): из тех же досок, что забор (attic.js: Planks), без краски.
// Стоят там, где наш берег — подмытый откос: у него сразу глубоко. Сваи-бруски вбиты в дно парами, на них
// две лаги вдоль мостков, поперёк лаг — настил, доски чуть разной длины, с неровными щелями. Начинается настил
// на верху откоса, лежит на земле, и уходит над водой на один пролёт: две пары свай, у уреза и под краем
// (Никита, 2026-11-11: длиннее — уже не мостки, а сломанный мост через полреки).
const WIDTH = 1, LAND = 0.6, OVER = 1.2;      // м: ширина настила; сколько его на берегу и над водой от уреза
const DECK = 0.035, BEAM = 0.1;               // м: толщина доски настила; сторона бруса лаг и свай
const GAP = [0.008, 0.025], SPAN = 1.2, DRIVEN = 0.4; // м: щели настила; шаг свай не больше; на сколько сваи в дне
const SEARCH = [18, 27];                      // м: где по |x| искать место — у боковых заборов, где наш берег внешний

// Где стоят мостки. deck(x, z) — высота верха настила над точкой, или −∞, если она не на мостках: по нему на мостки
// заходят. Строить после shapeGround: настил ложится на землю у откоса, сваи — на дно.
export function planPier(river, seed) {
  // Наш берег (к +z) тем круче, чем сильнее русло изгибается к двору (bend меньше нуля).
  let x = SEARCH[0];
  for (let a = SEARCH[0]; a <= SEARCH[1]; a += 0.5) {
    for (const v of [a, -a]) if (river.section(v).bend < river.section(x).bend) x = v;
  }
  const sec = river.section(x), { shore, run } = river.side(sec.w, sec);
  // Поперёк русла от нашего берега к воде — along, вдоль течения — across.
  const along = new THREE.Vector2(river.slope(x), -1).normalize(), across = new THREE.Vector2(-along.y, along.x);
  const at = (u) => new THREE.Vector2(x, river.center(x)).addScaledVector(along, -u);   // точка на u метров от оси к нам
  const start = at(shore + run + LAND), top = height(...at(shore + run).toArray()) + DECK, length = LAND + run + OVER;
  const deck = (px, pz) => {
    const d = new THREE.Vector2(px, pz).sub(start), s = d.dot(along), c = d.dot(across);
    return s >= 0 && s <= length && Math.abs(c) <= WIDTH / 2 ? top : -Infinity;
  };
  return { seed, start, along, across, top, length, land: LAND + run, deck };
}

export function buildPier({ seed, start, along, across, top, length, land }) {
  const rnd = generator(seed + 97), jitter = (k) => (rnd() - 0.5) * 2 * k;
  const floor = new Planks(boardMaterials(TONES.roof), DECK), frame = new Planks(boardMaterials(TONES.gable), BEAM);
  const up = new THREE.Vector3(0, 1, 0), o = (y) => new THREE.Vector3(start.x, y, start.y);
  const A = new THREE.Vector3(along.x, 0, along.y), C = new THREE.Vector3(across.x, 0, across.y);
  // Настил: доски поперёк мостков, от берега к краю; концы гуляют на пару сантиметров.
  for (let s = 0; s + 0.1 <= length; s += 0.1 + GAP[0] + rnd() * (GAP[1] - GAP[0])) {
    const a = -WIDTH / 2 + jitter(0.03), b = WIDTH / 2 + jitter(0.03);
    floor.add([[s, a], [s + 0.1, a], [s + 0.1, b], [s, b]], { o: o(top - DECK), X: A, Y: C }, up, [0, 1], 0.1, rnd);
  }
  // Лаги под краями настила — во всю длину. Сваи под лагами: первая пара — у уреза, последняя — под краем, между ними поровну.
  const sides = [-1, 1].map((k) => k * (WIDTH / 2 - BEAM));
  for (const c of sides) frame.add([[0, c - BEAM / 2], [length, c - BEAM / 2], [length, c + BEAM / 2], [0, c + BEAM / 2]], { o: o(top - DECK - BEAM), X: A, Y: C }, up, [1, 0], BEAM, rnd);
  const n = Math.ceil(OVER / SPAN);
  for (let i = 0; i <= n; i++) {
    const s = land + (i / n) * (length - land - BEAM / 2);
    for (const c of sides) {
      const foot = start.clone().addScaledVector(along, s).addScaledVector(across, c), bottom = height(foot.x, foot.y) - DRIVEN;
      frame.add([[s - BEAM / 2, bottom], [s + BEAM / 2, bottom], [s + BEAM / 2, top - DECK - BEAM], [s - BEAM / 2, top - DECK - BEAM]],
        { o: o(0).addScaledVector(C, c - BEAM / 2), X: A, Y: up }, C, [0, 1], BEAM, rnd);
    }
  }
  return new THREE.Group().add(...floor.meshes(), ...frame.meshes());
}
