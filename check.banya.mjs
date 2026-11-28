import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';

class ImageMock {
  addEventListener(name, fn) { this[`on${name}`] = fn; }
  removeEventListener() {}
  set src(value) { this._src = value; queueMicrotask(() => this.onload?.()); }
  get src() { return this._src; }
}
globalThis.window = globalThis;
globalThis.document = {
  createElementNS: () => new ImageMock(),
  createElement: (name) => name === 'canvas'
    ? { getContext: () => ({ createRadialGradient: () => ({ addColorStop() {} }), fillRect() {} }) }
    : new ImageMock(),
};
Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node', maxTouchPoints: 0 }, configurable: true });
globalThis.location = { search: '' };
globalThis.matchMedia = () => ({ matches: true });
globalThis.fetch = async (path) => ({ json: async () => JSON.parse(await readFile(path, 'utf8')) });

const { planRiver } = await import('./src/river.js');
const { shapeGround, height, groundAt } = await import('./src/terrain.js');
const { makeGround } = await import('./src/grass.js');
const { planBanya, buildBanya } = await import('./src/banya.js');
const { planHouse, buildHouse, LOG_MATERIAL, END_MATERIAL, R } = await import('./src/house.js');
const { PANE } = await import('./src/window.js');
const { planGas, gasPostMaterial } = await import('./src/gas.js');
const { planPower, powerWireMaterial } = await import('./src/power.js');
const { generator } = await import('./src/random.js');
const { GATES, WICKET } = await import('./src/fence.js');
const { planPaths } = await import('./src/paths.js');
const { yardPavingOutline, yardPavingContains } = await import('./src/campfire.js');
const { buildRailSegments } = await import('./src/porch.js');
const { planPier, buildPier } = await import('./src/pier.js');
const { planOuthouse, buildOuthouse, outhouseBlocks } = await import('./src/outhouse.js');
const { planShed, buildShed, shedBlocks, shedDeck, onShedFloor } = await import('./src/shed.js');

assert.equal(planHouse(73, { doorWall: 'right' }).openings.find(({ kind }) => kind === 'door').wall, 'right');

const testRail = buildRailSegments(1, [{
  from: new THREE.Vector3(0, 2, 0), to: new THREE.Vector3(0, 1, 2),
  normal: new THREE.Vector3(1, 0, 0), postAt: [0, 2],
}]);
const postBounds = new THREE.Box3().setFromObject(testRail.children.at(-1));
assert.ok(Math.abs(postBounds.min.y - 1) < 1e-5 && Math.abs(postBounds.max.y - 3.02) < 1e-5,
  'резные столбы стоят на высоте площадки и нижней ступени, а не на земле');

for (const seed of [1, 2, 7, 42, 100, 1000, 4000, 9000]) {
  const house = planHouse(seed), rnd = generator(seed + 13);
  const door = house.openings.find((opening) => opening.kind === 'door').wall === 'right' ? 1 : -1;
  const side = -door, front = 1.5 + rnd();
  const atHouse = { x: GATES.at - door * (house.w / 2 + 5), z: 12.5 - front - house.d / 2 };
  const river = planRiver({ seed, back: -12.5 });
  const outhouse = planOuthouse({ seed, yardWidth: 40, street: 12.5, river });
  assert.ok(12.5 - (outhouse.z + outhouse.pad.d / 2) >= 10);
  for (const x of [outhouse.x - outhouse.pad.w / 2, outhouse.x, outhouse.x + outhouse.pad.w / 2]) {
    assert.ok(outhouse.z - outhouse.pad.d / 2 - river.shore(x) >= 10);
  }
  assert.ok(outhouse.x + outhouse.pad.w / 2 < 20 && outhouse.x > 15);
  assert.ok(outhouseBlocks(outhouse, outhouse.x, outhouse.z, 0.35));
  assert.ok(!outhouseBlocks(outhouse, outhouse.approach.x - 0.5, outhouse.z, 0.35));
  const site = planBanya(seed, river, side);
  const shed = planShed(40);
  shapeGround(seed, [site.pad, outhouse.pad, shed, { ...atHouse, w: house.w + 1, d: house.d + 1 }], 40, 25, { dug: river.dug, calm: river.calm, rows: river.rows });
  const barn = buildShed(shed, seed);
  const bounds = new THREE.Box3().setFromObject(barn), size = bounds.getSize(new THREE.Vector3());
  assert.ok(size.y < 2.7 && size.z > 2 * size.y && bounds.min.x > -19.5, 'низкий вытянутый сарай не упирается свесом в забор');
  for (const x of [bounds.min.x, bounds.max.x]) assert.ok(bounds.min.z > river.brow(x) + 1);
  const bayZ = shed.z + 1.65;
  for (let x = bounds.max.x + 0.5; x > shed.x; x -= 0.1) assert.ok(!shedBlocks(shed, x, bayZ, 0.35), 'под навес можно войти со двора');
  assert.ok(shedBlocks(shed, shed.x - 0.8, bayZ, 0.35) && shedBlocks(shed, shed.x, shed.z, 0.35),
    'закрытая часть и штабель досок не пропускают игрока');
  const bayRay = new THREE.Raycaster(new THREE.Vector3(shed.x + 0.3, barn.position.y + 1.7, bayZ), new THREE.Vector3(0, -1, 0));
  assert.ok(Math.abs(bayRay.intersectObject(barn)[0].point.y - shedDeck(shed, shed.x + 0.3, bayZ)) < 1e-5,
    'в открытом пролёте игрок стоит на видимой доске');
  const hut = buildOuthouse(outhouse);
  assert.ok(hut.getObjectByName('outhouse-closed-door'));
  assert.ok(hut.getObjectByName('outhouse-transom'));
  const hutDoorBounds = new THREE.Box3().setFromObject(hut.getObjectByName('outhouse-closed-door'));
  assert.ok(hutDoorBounds.max.y - hutDoorBounds.min.y > 1.8);
  assert.ok(hutDoorBounds.max.z - hutDoorBounds.min.z < 0.85);
  hut.updateMatrixWorld(true);
  const frontRay = new THREE.Raycaster(new THREE.Vector3(outhouse.x - 3, height(outhouse.x, outhouse.z) + 1, outhouse.z),
    new THREE.Vector3(1, 0, 0));
  assert.ok(frontRay.intersectObject(hut.getObjectByName('outhouse-closed-door'), true).length,
    'closed door covers the entrance');
  const windowRay = new THREE.Raycaster(new THREE.Vector3(outhouse.x - 3,
    height(outhouse.x, outhouse.z) + 2.18, outhouse.z), new THREE.Vector3(1, 0, 0));
  const glass = hut.getObjectByName('outhouse-window-glass');
  assert.ok(glass.material.transparent && windowRay.intersectObject(glass).length,
    'small glazed window is above the door');
  const sill = hut.getObjectByName('outhouse-threshold');
  const sillRay = new THREE.Raycaster(new THREE.Vector3(outhouse.x - 3,
    height(outhouse.x, outhouse.z) + 0.04, outhouse.z), new THREE.Vector3(1, 0, 0));
  assert.ok(sillRay.intersectObject(sill, true).length, 'threshold closes the gap beneath the door');
  atHouse.y = height(atHouse.x, atHouse.z);
  const gas = planGas(house, atHouse, { fence: 12.5, gate: GATES.at });
  const power = planPower(house, atHouse, gas, { fence: 12.5, keep: [WICKET, GATES] });
  const grassGround = makeGround(280);
  const { position, uv } = grassGround.geometry.attributes;
  assert.ok(grassGround.material.map, 'плоская текстура травы подключена');
  assert.equal(grassGround.material.vertexColors, false);
  assert.equal(grassGround.geometry.attributes.color, undefined);
  assert.equal(uv.count, position.count);
  grassGround.geometry.computeBoundingBox();
  const { min, max } = grassGround.geometry.boundingBox;
  assert.deepEqual([min.x, max.x, min.z, max.z], [-140, 140, -140, 140]);
  const shoreRay = new THREE.Raycaster(new THREE.Vector3(site.x, 10, river.shore(site.x) - 0.15), new THREE.Vector3(0, -1, 0));
  assert.ok(shoreRay.intersectObject(grassGround).length, 'под настилом у уреза есть земля');
  const banya = buildBanya(site, river, power, { plan: house, at: atHouse });
  assert.deepEqual(site.approach, banya.approach, 'planned and built stair approaches agree');
  assert.deepEqual(site.approachGuide, banya.approachGuide, 'planned and built stair guides agree');
  assert.equal(site.approachWidth, banya.approachWidth, 'planned and built stair widths agree');
  const banyaLogs = banya.group.children[0].material;
  assert.ok(banyaLogs[0] !== LOG_MATERIAL && banyaLogs[1] !== END_MATERIAL
    && banyaLogs[0].map === LOG_MATERIAL.map && banyaLogs[1].map === END_MATERIAL.map
    && banyaLogs[0].color.r > LOG_MATERIAL.color.r && banyaLogs[1].color.r > END_MATERIAL.color.r,
  'сруб бани светлее, но использует те же текстуры и не меняет материал дома');
  assert.equal(banyaLogs[0].customProgramCacheKey(), LOG_MATERIAL.customProgramCacheKey(),
    'осветлённые брёвна сохраняют обработку текстуры сруба');
  const home = buildHouse(house);
  assert.equal(home.children[0].material[0], LOG_MATERIAL, 'дом сохраняет прежний материал брёвен');
  const banyaGable = banya.group.children[2].children[0].material[0];
  const homeGable = home.children[2].children[0].material[0];
  assert.ok(banyaGable !== homeGable && banyaGable.map === homeGable.map
    && banyaGable.color.r > homeGable.color.r, 'фронтон бани светлее без изменения фронтонов дома');
  home.traverse((part) => part.geometry?.dispose());
  const bathWindows = banya.plan.openings.filter((opening) => opening.kind === 'window');
  assert.equal(banya.plan.plinth, 'brick', 'баня стоит на кирпичном цоколе без деревянной обшивки');
  assert.equal(banya.plan.curtains, false, 'в банных окнах нет занавесок');
  assert.ok(bathWindows.every((opening) => opening.width < PANE[0] && opening.top - opening.bottom < PANE[1]), 'банные окна меньше окон дома');
  assert.ok(banya.plan.windowBacking !== undefined && banya.plan.backingMargin > 0.24, 'обсада закрывает щели от пропилов по венцам');
  assert.ok(banya.plan.plinthHeight > 0.5 && banya.plan.plinthOut > 0.02 && banya.plan.plinthCap,
    'кирпичный цоколь перекрывает стык со срубом без деревянной прокладки');
  const plinthGeometry = banya.group.children[4].geometry;
  const plinthPositions = plinthGeometry.getAttribute('position'), plinthNormals = plinthGeometry.getAttribute('normal');
  const capVertices = Array.from({ length: plinthPositions.count }, (_, i) => i)
    .filter((i) => plinthNormals.getY(i) > 0.99 && Math.abs(plinthPositions.getY(i) - banya.plan.plinthHeight) < 1e-4);
  assert.equal(capVertices.length, 4, 'кирпичная крышка цоколя закрывает верхний стык');
  const bathDoor = banya.group.getObjectByName('banya-door');
  bathDoor.updateMatrixWorld(true);
  const doorBounds = new THREE.Box3().setFromObject(bathDoor);
  assert.ok(doorBounds.max.y - doorBounds.min.y > 1.7, 'дверное полотно и обсада закрывают проём');
  const dockRails = banya.group.getObjectByName('banya-dock-rails');
  assert.ok(dockRails.children.length >= 3 && dockRails.children.some((part) => part.material?.map),
    'перила используют резные балясины и столбы из набора крыльца');
  assert.deepEqual(dockRails.userData.stairRailSides, ['outer'], 'перила лестницы только с наружной стороны');
  assert.equal(banya.group.getObjectByName('banya-stair-wall'), undefined,
    'вдоль лестницы нет приставной стены, вместо неё видна стена сруба');
  const staircase = banya.group.getObjectByName('banya-stairs'), stairPlan = staircase.userData.plan;
  assert.equal(stairPlan.treads, 3, 'у лестницы ровно три ступени');
  assert.ok(Math.abs(stairPlan.outerX - banya.deckPlan.sideOuter) < 1e-5 && stairPlan.outerX - stairPlan.innerX > 1.4,
    'наружный край ступеней совпадает с краем площадки');
  assert.ok(stairPlan.innerX >= 2 + R && stairPlan.innerX - (2 + R) < 0.03,
    'внутренний край ступеней подходит вплотную к стене сруба');
  assert.ok(staircase.getObjectByName('banya-stair-skirt').children.length > 0,
    'открытый бок лестницы обшит досками');
  const roofExtension = banya.group.getObjectByName('banya-roof-extension');
  const roofRafters = banya.group.getObjectByName('banya-roof-rafters');
  const ridgeBeam = roofRafters.getObjectByName('banya-roof-ridge-beam');
  const roofSupports = banya.group.getObjectByName('banya-roof-supports');
  const veranda = banya.dock, verandaPlan = veranda.userData.plan;
  assert.ok(veranda.getObjectByName('banya-veranda-skirt').children.length > 0,
    'боковая площадка обшита досками со стороны двора');
  const postVertices = dockRails.children.at(-1).geometry.getAttribute('position');
  for (const [z, y] of [[stairPlan.z - 0.055, verandaPlan.top],
    [stairPlan.z + stairPlan.run - 0.055, verandaPlan.top - stairPlan.treads * stairPlan.rise]]) {
    const ys = [];
    for (let i = 0; i < postVertices.count; i++) {
      if (Math.abs(postVertices.getX(i) - (stairPlan.outerX - 0.055)) < 0.056
          && Math.abs(postVertices.getZ(i) - z) < 0.056) ys.push(postVertices.getY(i));
    }
    assert.ok(ys.length && Math.abs(Math.min(...ys) - y) < 1e-4
      && Math.abs(Math.max(...ys) - (y + 1.02)) < 1e-4,
    'резные столбы стоят на площадке и нижней ступени');
  }
  assert.ok(roofExtension.children.length > 0 && roofRafters.children.length > 0, 'общая крыша продолжается над верандой на стропилах');
  assert.ok(ridgeBeam?.children.length > 0, 'у конька есть непрерывная подшивная балка без щели к небу');
  ridgeBeam.updateMatrixWorld(true);
  const ridgeBounds = new THREE.Box3().setFromObject(ridgeBeam);
  assert.ok(ridgeBounds.min.y > roofRafters.userData.roofShape.ridge - 0.2
    && ridgeBounds.max.y < roofRafters.userData.roofShape.ridge,
  `коньковая балка остаётся целиком под скатами: seed ${seed}, bounds ${ridgeBounds.min.y}..${ridgeBounds.max.y}, ridge ${roofRafters.userData.roofShape.ridge}`);
  const roofBeams = roofSupports.children.filter((part) => part.name === 'banya-roof-longitudinal-beam');
  const roofPosts = roofSupports.children.filter((part) => part.name === 'banya-roof-post');
  const roofCrossbeams = roofSupports.children.filter((part) => part.name === 'banya-roof-crossbeam');
  assert.equal(roofBeams.length, 2, 'под обоими скатами есть продольные балки');
  assert.equal(roofPosts.length, 2, 'продольные балки стоят на двух несущих стойках');
  assert.equal(roofCrossbeams.length, 1, 'поперечное бревно связывает стойки на торце веранды');
  assert.ok([...roofBeams, ...roofPosts, ...roofCrossbeams].every((part) =>
    part.material.length === 2 && part.material[0].map === LOG_MATERIAL.map
    && part.material[1].map === END_MATERIAL.map
    && part.material[0].color.r > LOG_MATERIAL.color.r
    && part.geometry.groups.length === 2), 'кровельные балки и стойки используют текстуры боков и торцов брёвен сруба');
  for (const beam of roofBeams) {
    const vertices = beam.geometry.getAttribute('position'), roof = roofSupports.userData.roofShape;
    const beamEnd = beam.userData.logSegment.to[2];
    assert.ok(Math.abs(beamEnd - verandaPlan.riverEnd + 0.19) < 1e-4,
      'остаток продольного бревна выходит за поперечину');
    assert.ok(beamEnd > roofSupports.userData.roofEndZ + 0.1,
      'торец балки утоплен от края кровли, а не выступает из ската');
    assert.ok(Math.abs(Math.abs(beam.userData.logSegment.from[0]) - 2) < 1e-5
      && beam.userData.logSegment.from[2] > -2.3 && beam.userData.logSegment.from[2] < -2,
    'продольное бревно продолжает ось боковой стены и соединяется с её выпуском');
    for (let i = 0; i < vertices.count; i++) {
      const local = new THREE.Vector3().fromBufferAttribute(vertices, i);
      const clearance = (roof.ridge - Math.abs(local.x) * Math.tan(roof.pitch) - local.y) * Math.cos(roof.pitch)
        - 0.022;
      assert.ok(clearance >= roofSupports.userData.roofClearance - 1e-4,
        `весь объём балки под скатом: seed ${seed}, clearance ${clearance}`);
    }
  }
  assert.ok(roofBeams.some((beam) => beam.userData.logSegment.from[0] < 0)
    && roofBeams.some((beam) => beam.userData.logSegment.from[0] > 0),
    'балки стоят под обоими скатами');
  const cross = roofCrossbeams[0].userData.logSegment;
  assert.ok(cross.from[0] < -2 && cross.to[0] > 2 && Math.abs(cross.from[2] - verandaPlan.riverEnd) < 1e-5,
    'поперечное бревно имеет выпуски за стойками');
  assert.ok(cross.from[1] - cross.radius - verandaPlan.top > 1.8, 'поперечное бревно не закрывает проход');
  const crossVertices = roofCrossbeams[0].geometry.getAttribute('position'), roof = roofSupports.userData.roofShape;
  for (let i = 0; i < crossVertices.count; i++) {
    const clearance = (roof.ridge - Math.abs(crossVertices.getX(i)) * Math.tan(roof.pitch) - crossVertices.getY(i))
      * Math.cos(roof.pitch) - 0.022;
    assert.ok(clearance > 0, 'поперечное бревно и его выпуски не пересекают скаты');
  }
  const bottomAt = (mesh, coord, value) => {
    const p = mesh.geometry.getAttribute('position');
    let min = Infinity;
    for (let i = 0; i < p.count; i++) {
      if (Math.abs((coord === 'x' ? p.getX(i) : p.getZ(i)) - value) < 0.014) min = Math.min(min, p.getY(i));
    }
    return min;
  };
  for (const beam of roofBeams) {
    const join = bottomAt(beam, 'z', cross.from[2]), plain = bottomAt(beam, 'z', cross.from[2] + 0.36);
    assert.ok(join > plain + 0.035, 'на продольном бревне вырублена чаша под поперечину');
  }
  for (const at of [-2, 2]) {
    const join = bottomAt(roofCrossbeams[0], 'x', at), plain = bottomAt(roofCrossbeams[0], 'x', at * 0.75);
    assert.ok(join > plain + 0.02, 'под поперечиной вырублено седло на вершине стойки');
  }
  assert.equal(veranda.name, 'banya-veranda-deck');
  assert.ok(veranda.children.length > 0 && veranda.userData.piles.length >= 8, 'настил опирается на отдельный каркас и сваи');
  for (const post of roofPosts) {
    const [postX, , postZ] = post.userData.logSegment.from;
    assert.ok(Math.abs(postZ - cross.from[2]) < 1e-5
      && post.userData.logSegment.to[1] > cross.from[1] - cross.radius,
    'стойка подходит снизу к поперечному бревну');
    assert.ok(veranda.userData.piles.some((pile) => Math.abs(pile.x - postX) < 1e-5
      && Math.abs(pile.z - postZ) < 1e-5), 'стойка крыши передаёт нагрузку на сваю под настилом');
  }
  const railPosts = dockRails.children.at(-1).geometry.getAttribute('position');
  for (const { x, z } of dockRails.userData.structuralPosts) {
    let duplicateVertices = 0;
    for (let i = 0; i < railPosts.count; i++) {
      if (Math.abs(railPosts.getX(i) - x) < 0.16 && Math.abs(railPosts.getZ(i) - z) < 0.16) duplicateVertices++;
    }
    assert.equal(duplicateVertices, 0, 'бревно крыши заменяет декоративную стойку ограждения в той же точке');
  }
  for (const pile of veranda.userData.piles) {
    assert.ok(pile.bottom <= pile.ground - 0.39, `свая заглублена в точке установки: seed ${seed}`);
    assert.ok(pile.top < verandaPlan.beamBottom, 'свая упирается в нижнюю сторону несущей балки');
  }
  const banyaBench = banya.group.getObjectByName('banya-bench');
  banyaBench.updateMatrixWorld(true);
  const benchBounds = new THREE.Box3().setFromObject(banyaBench);
  assert.ok(benchBounds.max.y - benchBounds.min.y > 0.7, 'на веранде есть деревянная лавка со спинкой');
  const c = Math.cos(site.angle), s = Math.sin(site.angle);
  const worldAtLocal = (x, z) => [site.x + c * x + s * z, site.z - s * x + c * z];
  banya.group.updateMatrixWorld(true);
  const railMeshes = dockRails.children.slice(0, -2);
  for (const distance of [-0.2, -0.001, 0.001, 0.2]) {
    const z = stairPlan.z - 0.055 + distance;
    const [wx, wz] = worldAtLocal(verandaPlan.sideOuter + 0.3, z);
    const y = verandaPlan.top + 0.87 - Math.max(0, distance) * stairPlan.treads * stairPlan.rise / stairPlan.run;
    const ray = new THREE.Raycaster(new THREE.Vector3(wx, banya.group.position.y + y, wz), new THREE.Vector3(-c, 0, s), 0, 0.5);
    const hits = railMeshes.flatMap((mesh) => ray.intersectObject(mesh));
    assert.ok(hits.some(({ point }) => Math.abs(c * (point.x - site.x) - s * (point.z - site.z) - (verandaPlan.sideOuter + 0.005)) < 0.002),
      'поручни лестницы и террасы сходятся в одну прямую без уступа');
  }
  const riser = staircase.getObjectByName('banya-bottom-riser');
  for (const x of [stairPlan.innerX + 0.1, stairPlan.x, stairPlan.outerX - 0.1]) {
    const [wx, wz] = worldAtLocal(x, stairPlan.z + stairPlan.run + 0.15);
    const ray = new THREE.Raycaster(new THREE.Vector3(wx, banya.group.position.y + verandaPlan.top - stairPlan.treads * stairPlan.rise - 0.05, wz),
      new THREE.Vector3(-s, 0, -c), 0, 0.3);
    assert.ok(ray.intersectObject(riser, true).length, 'нижний подступёнок закрывает всю ширину лестницы');
  }
  const skirt = veranda.getObjectByName('banya-veranda-skirt');
  veranda.updateMatrixWorld(true);
  const skirtEnd = skirt.userData.landEnd;
  const [shoreX, shoreZ] = worldAtLocal(verandaPlan.sideOuter, skirtEnd);
  assert.ok(Math.abs(shoreZ - river.shore(shoreX)) < 0.01 || Math.abs(skirtEnd - verandaPlan.riverEnd) < 0.01,
    'обшивка доходит до уреза, но не закрывает сваи в воде');
  for (const pile of veranda.userData.piles.filter((p) => p.x > 2 && p.z > skirtEnd + 0.15 && p.z < verandaPlan.sideBack - 0.1)) {
    const [wx, wz] = worldAtLocal(verandaPlan.sideOuter + 0.4, pile.z);
    const y = verandaPlan.beamBottom - 0.03;
    if (y <= pile.ground + 0.03) continue;
    const ray = new THREE.Raycaster(new THREE.Vector3(wx, banya.group.position.y + y, wz), new THREE.Vector3(-c, 0, s), 0, 0.6);
    const hits = ray.intersectObject(veranda, true);
    assert.ok(hits.length && hits[0].object.parent === skirt, 'обшивка закрывает выступающие детали опор');
  }
  for (const x of [stairPlan.innerX + 0.01, stairPlan.outerX - 0.3]) {
    const stairPoint = worldAtLocal(x, stairPlan.z + stairPlan.run / 2);
    assert.ok(Number.isFinite(banya.deck(...stairPoint)) && !banya.blocks(...stairPoint),
      `по ступеням можно пройти у обоих краёв: seed ${seed}, x ${x}`);
  }
  assert.ok(banya.blocks(...worldAtLocal(stairPlan.outerX - 0.055, stairPlan.z + stairPlan.run / 2)),
    'наружные перила лестницы блокируют проход через край');
  const missingLanding = worldAtLocal(2.85, (verandaPlan.front + verandaPlan.sideBack) / 2);
  assert.equal(banya.deck(...missingLanding), banya.deckPlan.top, 'восстановлен настил боковой площадки за торцом основного пола');
  veranda.updateMatrixWorld(true);
  const visibleLandingBoards = [];
  for (let z = verandaPlan.front + 0.2; z < verandaPlan.sideBack - 0.2; z += 0.05) {
    const point = worldAtLocal(2.85, z);
    const ray = new THREE.Raycaster(
      new THREE.Vector3(point[0], banya.deckPlan.top + 1, point[1]),
      new THREE.Vector3(0, -1, 0), 0, 2,
    );
    if (ray.intersectObject(veranda, true).some(({ point: hit }) => Math.abs(hit.y - banya.deckPlan.top) < 0.05)) {
      visibleLandingBoards.push(z);
    }
  }
  assert.ok(visibleLandingBoards.length > 0,
    'на восстановленном участке есть видимые доски пола, а не только коллизия');
  const beyondLanding = worldAtLocal(stairPlan.x, stairPlan.z + 0.02);
  const transitionRay = new THREE.Raycaster(
    new THREE.Vector3(beyondLanding[0], banya.deckPlan.top - 0.01, beyondLanding[1]),
    new THREE.Vector3(0, -1, 0), 0, 0.3,
  );
  const protrusions = transitionRay.intersectObject(veranda, true);
  assert.equal(protrusions.length, 0, 'краевая балка настила не выступает в пространство верхней ступени');
  const { start, along, across, length, top, width } = banya.deckPlan;
  assert.ok(length < 4.5 && site.z - river.brow(site.x) < 3, 'баня придвинута к берегу, настил стал короче');
  const at = (distance, offset = 0) => start.clone().addScaledVector(along, distance).addScaledVector(across, offset);
  const end = at(length - 0.05), middle = at(length / 2);
  assert.ok(end.y < river.shore(end.x), 'настил выходит к воде');
  assert.ok(top > river.level(end.x), 'настил выше воды');
  assert.equal(banya.deck(middle.x, middle.y), top);
  assert.equal(banya.deck(...at(length / 2, -width / 2 - 0.3).toArray()), -Infinity);
  assert.ok(banya.blocks(site.x, site.z));
  assert.ok(!banya.blocks(middle.x, middle.y));
  assert.ok(banya.dock.children.length > 0, 'единый Г-образный настил построен');
  for (let z = verandaPlan.front + 0.3; z < verandaPlan.sideBack - 0.3; z += 0.12) {
    for (let x = 2.5; x <= verandaPlan.sideOuter - 0.25; x += 0.12) {
      const point = worldAtLocal(x, z);
      assert.equal(banya.deck(...point), banya.deckPlan.top, `пол непрерывно закрывает боковую площадку: seed ${seed}, ${x}, ${z}`);
      assert.ok(!banya.blocks(...point), `восстановленный пол остаётся проходимым: seed ${seed}, ${x}, ${z}`);
    }
  }
  for (let x = 1.8; x <= 2.9; x += 0.1) {
    assert.ok(!banya.blocks(...worldAtLocal(x, -2.63)), 'проход с основного настила на боковую площадку открыт');
  }
  for (let z = -2.63; z <= 2.1; z += 0.06) {
    const point = worldAtLocal(stairPlan.x, z), y = banya.deck(...point);
    assert.ok(Number.isFinite(y), 'площадка и лестница соединены');
    assert.ok(!banya.blocks(...point), `проход вдоль бани открыт: seed ${seed}, z ${z}`);
  }
  for (let z = verandaPlan.riverEnd + 0.3; z < verandaPlan.sideBack - 0.2; z += 0.12) {
    for (let x = 2.5; x <= verandaPlan.sideOuter - 0.3; x += 0.12) {
      const point = worldAtLocal(x, z);
      assert.equal(banya.deck(...point), banya.deckPlan.top, `угол настила проходим: seed ${seed}, ${x}, ${z}`);
      assert.ok(!banya.blocks(...point), `угол настила не перекрыт: seed ${seed}, ${x}, ${z}`);
    }
  }
  for (const z of [verandaPlan.riverEnd + 0.2, (verandaPlan.riverEnd + verandaPlan.sideBack) / 2]) {
    const waterEdge = worldAtLocal(verandaPlan.sideOuter, z);
    assert.ok(banya.blocks(...waterEdge), 'новый наружный край защищён перилами');
  }
  const approachDoor = worldAtLocal(0, verandaPlan.front - 0.1);
  assert.ok(Number.isFinite(banya.deck(...approachDoor)) && !banya.blocks(...approachDoor),
    'от Г-образного настила можно подойти к двери');
  for (let t = 0; t <= 1; t += 0.05) {
    const point = worldAtLocal(2.4 + t * 0.75, verandaPlan.riverEnd + 0.3 + t * 1.6);
    assert.ok(Number.isFinite(banya.deck(...point)), `диагональный проход по настилу открыт: seed ${seed}`);
    assert.ok(!banya.blocks(...point), `диагональный проход не заблокирован: seed ${seed}`);
  }
  let previous = top;
  for (let z = stairPlan.z + 0.01; z < stairPlan.z + stairPlan.run - 0.02; z += 0.03) {
    const center = banya.deck(...worldAtLocal(stairPlan.x, z));
    assert.ok(center <= previous + 1e-6 && previous - center < 0.2, 'ступени идут вниз с нормальной высотой подступёнка');
    previous = center;
    for (let x = stairPlan.innerX + 0.01; x <= stairPlan.outerX - 0.01; x += 0.055) {
      const point = worldAtLocal(x, z), y = banya.deck(...point);
      assert.ok(y > groundAt(...point) + 0.035, `ступень над всей поверхностью земли: seed ${seed}, ${x}, ${z}`);
    }
  }
  const approach = worldAtLocal(stairPlan.x, stairPlan.z + stairPlan.run);
  const guide = worldAtLocal(stairPlan.x, stairPlan.z + stairPlan.run + 1.6);
  assert.ok(Math.hypot(banya.approach.x - approach[0], banya.approach.z - approach[1]) < 1e-6);
  assert.ok(Math.hypot(banya.approachGuide.x - guide[0], banya.approachGuide.z - guide[1]) < 1e-6);
  const pavingOrigin = { x: 14.95, z: 4.25 };
  const pier = planPier(river, seed);
  const entry = pier.entry;
  const guidePier = pier.start.clone().addScaledVector(pier.along, -2);
  const pathPlan = planPaths({
    seed, gate: { x: GATES.at, z: 12.32 }, porch: { x: -1.5, z: 7 }, porchApproach: { x: 0.1, z: 7 },
    porchWidth: 1.8, pad: { x: 10.35, z: 4.25 }, padApproach: { x: 9.15, z: 4.25 }, pavingOrigin,
    pavingOutline: yardPavingOutline.map((p) => ({ x: p.x + pavingOrigin.x, z: p.z + pavingOrigin.z })),
    bath: banya.approach, bathApproach: banya.approachGuide, bathWidth: banya.approachWidth,
    ...(site.x < 0 ? {
      pier: { x: entry.x, z: entry.y }, pierApproach: { x: guidePier.x, z: guidePier.y },
      pierWidth: pier.width, pierEntrySurface: pier.entrySurface,
      utilityPierStart: { x: pavingOrigin.x, z: pavingOrigin.z - 5.4 },
    } : {}),
    shed: shed.approach, shedApproach: shed.approachGuide, shedWidth: shed.approachWidth, shedApron: shed.apron,
    house: { ...atHouse, w: house.w + 1, d: house.d + 1 },
  });
  const paths = pathPlan.build();
  const shedRoute = pathPlan.paths.find(({ destination }) => destination === 'shed');
  const bathRoute = pathPlan.paths.find(({ destination }) => destination === 'bath');
  assert.ok(bathRoute.points.some((p) => Math.hypot(p.x - shedRoute.points[0].x, p.z - shedRoute.points[0].z) < 1e-8),
    `тропа к сараю стыкуется с тропой к бане: seed ${seed}`);
  const shedEntry = shedRoute.points.at(-1);
  assert.ok(Math.hypot(shedEntry.x - shed.approach.x, shedEntry.z - shed.approach.z) < 1e-8);
  const shedIntrusions = shedRoute.points.filter((p) => onShedFloor(shed, p.x, p.z));
  assert.ok(!shedIntrusions.length, `тропа не проходит сквозь сарай: seed ${seed}: ${JSON.stringify(shedIntrusions.slice(-5))}`);
  assert.ok(!shedBlocks(shed, shedEntry.x, shedEntry.z, 0.35), `устье тропы у сарая свободно: seed ${seed}`);
  const shedRouteIndex = pathPlan.paths.indexOf(shedRoute);
  const shedVertices = paths.children[shedRouteIndex].geometry.attributes.position;
  const shedEnd = shedVertices.count - 17;
  assert.ok(Math.abs(Math.hypot(shedVertices.getX(shedEnd) - shedVertices.getX(shedEnd + 16),
    shedVertices.getZ(shedEnd) - shedVertices.getZ(shedEnd + 16)) - shed.approachWidth) < 1e-5,
  `тропа расширяется у площадки сарая: seed ${seed}`);
  assert.ok(shed.apron.x1 - shed.wall >= (shed.gate.z1 - shed.gate.z0) / 2, 'створки ворот распахиваются над площадкой');
  const stone = paths.children[0].material, down = new THREE.Vector3(0, -1, 0);
  for (const [opening, { z0, z1 }] of [['ворота', shed.gate], ['открытый пролёт', shed.bay]]) {
    for (let z = z0; z <= z1; z += 0.05) for (const x of [shed.wall + 0.02, shed.wall + 1.1]) {
      const hit = new THREE.Raycaster(new THREE.Vector3(x, 50, z), down).intersectObject(paths, true)[0];
      assert.ok(hit?.object.material === stone, `перед фасадом сарая (${opening}) лежит мощение: seed ${seed}, ${x}, ${z}`);
    }
  }
  const shedPosts = paths.getObjectByName('path-border-sides').geometry.attributes.position;
  for (let i = 0; i < shedPosts.count; i++) {
    assert.ok(!onShedFloor(shed, shedPosts.getX(i), shedPosts.getZ(i)),
      `бордюр не заходит в сарай: seed ${seed}, ${shedPosts.getX(i)}, ${shedPosts.getZ(i)}`);
  }
  assert.ok(pier.start.x > 0 && Math.abs(entry.x) + pier.width / 2 < 20,
    'причал внутри участка у противоположного забора');
  assert.ok(Math.abs(pier.top - groundAt(pier.start.x, pier.start.y)) < 0.2,
    'на причал можно подняться с берега');
  for (let s = 0; s <= 0.1; s += 0.025) for (let c = -0.5; c <= 0.5; c += 0.05) {
    const p = pier.start.clone().addScaledVector(pier.along, s).addScaledVector(pier.across, c);
    assert.ok(pier.top - 0.035 > groundAt(p.x, p.y) + 0.015,
      `первая доска видна над грунтом и мощением по всей ширине: seed ${seed}`);
  }
  const pierMesh = buildPier(pier);
  const ray = new THREE.Raycaster(new THREE.Vector3(entry.x, pier.top + 1, entry.y), new THREE.Vector3(0, -1, 0), 0, 2);
  assert.ok(ray.intersectObject(pierMesh, true).some(({ point }) => Math.abs(point.y - pier.top) < 0.001),
    'первая доска видимо перекрывает конец тропы');
  pierMesh.traverse((part) => part.geometry?.dispose());
  const pierPaths = pathPlan.paths.filter((p) => p.destination.startsWith('pier'));
  assert.equal(pierPaths.length, site.x < 0 ? 2 : 0);
  for (const route of pierPaths) {
    for (const p of route.points) {
      assert.ok(Math.abs(p.x) < 19 && p.z > river.shore(p.x), `новая тропа внутри участка и на суше: seed ${seed}`);
      assert.ok(!banya.blocks(p.x, p.z), `новая тропа не проходит сквозь баню: seed ${seed}`);
    }
  }
  if (pierPaths.length) {
    const pierRoute = pierPaths.find((p) => p.destination === 'pier');
    const linkRoute = pierPaths.find((p) => p.destination === 'pier-link');
    assert.ok(yardPavingContains(pierRoute.points[0].x - pavingOrigin.x, pierRoute.points[0].z - pavingOrigin.z),
      'тропа к причалу начинается внутри хозплощадки');
    assert.ok(Number.isFinite(pier.deck(pierRoute.points.at(-1).x, pierRoute.points.at(-1).z)),
      'тропа доходит до настила причала');
    const endVertices = paths.children[4].geometry.attributes.position;
    for (let i = endVertices.count - 17; i < endVertices.count; i++) {
      assert.ok(Math.abs(endVertices.getY(i) - pier.entrySurface) < 0.01,
        'конец мощения подходит снизу вплотную к первой доске');
    }
    assert.ok(pathPlan.paths.find((p) => p.destination === 'bath').points.some((p) =>
      Math.hypot(p.x - linkRoute.points[0].x, p.z - linkRoute.points[0].z) < 0.13),
    'поперечная тропа соединена с подходом к бане');
  }
  const path = paths.children[3].geometry.attributes.position;
  for (let i = 0; i < path.count; i++) {
    const x = path.getX(i), z = path.getZ(i);
    assert.ok(z > river.brow(x) + 0.15, `тропа остаётся на сухом берегу: seed ${seed}, ${x}, ${z}`);
    if (i % 17 === 8) assert.ok(!banya.blocks(x, z), `тропа к бане не упирается в сруб или перила: seed ${seed}`);
  }
  const tops = paths.getObjectByName('path-border-ends').geometry.attributes.position;
  for (const mesh of pierPaths.length ? paths.children.slice(4, 6) : []) {
    const positions = mesh.geometry.attributes.position;
    for (let i = 0; i < positions.count; i += 17 * 4) {
      const mid = i + 8, x = positions.getX(mid), z = positions.getZ(mid);
      assert.ok(z > river.shore(x), 'новое мощение не уходит в воду');
      for (let j = 0; j < tops.count; j += 9) {
        assert.ok(Math.hypot(x - tops.getX(j), z - tops.getZ(j)) > 0.3,
          'брёвна бордюра не перекрывают центр новой тропы');
      }
    }
  }
  for (const index of [path.count - 17, path.count - 1]) {
    const x = path.getX(index), z = path.getZ(index);
    assert.ok(Array.from({ length: tops.count / 9 }, (_, i) => i * 9)
      .some((i) => Math.hypot(x - tops.getX(i), z - tops.getZ(i)) < 0.08),
    `бордюр доходит до края ступеней: seed ${seed}, ${x}, ${z}`);
  }
  paths.traverse((o) => o.geometry?.dispose());
  assert.ok(banya.blocks(...worldAtLocal(-2, -2 - 0.13 - length / 2)), 'перила боковой стороны блокируют проход насквозь');
  assert.ok(banya.blocks(...worldAtLocal(-1.1, -2 - 0.13 - 0.78)), 'лавка препятствует проходу сквозь основание');
  const posts = banya.powerLine.children.filter((mesh) => mesh.material === gasPostMaterial);
  const wires = banya.powerLine.children.filter((mesh) => mesh.material === powerWireMaterial);
  assert.ok(posts.length > 0);
  assert.equal(wires.length, posts.length + 2);
  for (const post of posts) {
    post.geometry.computeBoundingBox();
    assert.ok(Math.abs(post.geometry.boundingBox.max.y - post.geometry.boundingBox.min.y - 2) < 1e-5);
  }
  for (const wire of wires) {
    const positions = wire.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const clearance = positions.getY(i) - height(positions.getX(i), positions.getZ(i));
      assert.ok(clearance > 1.7, `провод выше головы: ${clearance}`);
      assert.ok(Math.abs(positions.getX(i) - atHouse.x) > house.w / 2 || Math.abs(positions.getZ(i) - atHouse.z) > house.d / 2,
        `провод пересекает сруб: seed ${seed}, точка ${positions.getX(i)}, ${positions.getZ(i)}, дом ${atHouse.x}, ${atHouse.z}`);
    }
  }
  for (const part of [grassGround, banya.group, banya.dock, banya.powerLine]) part.traverse((o) => o.geometry?.dispose());
}
console.log('banya checks ok');
