import * as THREE from 'three';
import { planHouse, buildHouse } from './house.js';
import { generator } from './random.js';
import { height } from './terrain.js';
import { YARD, WICKET, GATES } from './fence.js';

// Соседи — участки по обе стороны нашего двора вдоль улицы, от неё до реки, как в деревне: дом у улицы за палисадником,
// за ним двор и огород до воды. Дома — из того же генератора, что наш (house.js), у каждого своё зерно.
// Участки уже нашего (у нас бывший колхозный простор), идут до REACH от середины: дальше стенд не пускает,
// за ними видны только горы. Деревья соседей не пилим — это декорация, но той же выделки, что берёзы за улицей.
const WIDTH = [24, 34];      // м: ширина участка вдоль улицы
const REACH = 100;           // м: до какого x идут участки
const PALISADE = [1.5, 3];   // м: от забора до фасада
const MARGIN = 1.5;          // м: от дома с крыльцом до бокового забора не меньше
const ASIDE = 5;             // м: от середины ворот до стены дома с крыльцом, как у нас
const ROOM = 1;              // м: от створки ворот до бокового забора не меньше
const WICKET_AT = GATES.at - WICKET.at; // калитка — сбоку от ворот, со стороны дома, как у нас

// План соседей по зерну двора: участки [{ from, to, openings, house, at, pad }]. Дом уже построен (размер площадки
// под ним — по нему самому, с крыльцом и свесами), но ещё не поставлен на землю: высоту даёт buildNeighbors,
// когда рельеф готов (площадки — в shapeGround).
export function planNeighbors(seed) {
  const rnd = generator(seed + 89), lots = [];
  for (const dir of [1, -1]) {
    for (let edge = YARD.w / 2; edge < REACH; ) {
      const width = WIDTH[0] + rnd() * (WIDTH[1] - WIDTH[0]);
      const [from, to] = dir > 0 ? [edge, edge + width] : [-edge - width, -edge];
      edge += width;
      const plan = planHouse(seed * 31 + lots.length * 7 + 101), house = buildHouse(plan);
      // Крыльцо смотрит на ворота: дверь на правом боку — ворота правее дома.
      const door = plan.openings.find((o) => o.kind === 'door').wall === 'right' ? 1 : -1;
      const box = new THREE.Box3().setFromObject(house), size = box.getSize(new THREE.Vector3()), mid = box.getCenter(new THREE.Vector3());
      // Дом с крыльцом от бокового забора, ворота — в ASIDE от стены с крыльцом, створка не ближе ROOM к другому забору.
      const reach = plan.w / 2 + ASIDE + GATES.width / 2 + ROOM;
      const [lo, hi] = door > 0 ? [from + MARGIN + size.x / 2 - mid.x, to - reach] : [from + reach, to - MARGIN - size.x / 2 - mid.x];
      const x = lo + rnd() * Math.max(0, hi - lo), front = PALISADE[0] + rnd() * (PALISADE[1] - PALISADE[0]);
      const at = { x, z: YARD.d / 2 - front - plan.d / 2 }, gate = x + door * (plan.w / 2 + ASIDE);
      lots.push({
        from, to, plan, house, at,
        openings: [{ ...GATES, at: gate }, { ...WICKET, at: gate - door * WICKET_AT }],
        pad: { x: x + mid.x, z: at.z + mid.z, w: size.x, d: size.z },
      });
    }
  }
  return lots;
}

// Соседские дома на земле. Строить после shapeGround с площадками lots[i].pad.
export function buildNeighbors(lots) {
  const root = new THREE.Group();
  for (const { house, at } of lots) {
    house.position.set(at.x, height(at.x, at.z), at.z);
    root.add(house);
  }
  return root;
}

// Соседские дворы обжиты: траву косят и топчут — она низкая, без бурьяна (у нас двор заброшен и зарос). Бурьян
// остаётся только вдоль заборов, куда коса не достаёт, — полосой WILD. 0..1, как trodden у травы.
const MOWN = 0.75, WILD = 0.8;
export const mown = (lots, fence, shore) => (x, z) => {
  const lot = lots.find((l) => x > l.from && x < l.to);
  if (!lot || z > fence || z < shore(x)) return 0;
  const edge = Math.min(x - lot.from, lot.to - x, fence - z);
  return MOWN * THREE.MathUtils.smoothstep(edge, WILD / 2, WILD);
};
