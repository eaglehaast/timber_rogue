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
const { planHouse, LOG_MATERIAL } = await import('./src/house.js');
const { PANE } = await import('./src/window.js');
const { planGas, gasPostMaterial } = await import('./src/gas.js');
const { planPower, powerWireMaterial } = await import('./src/power.js');
const { generator } = await import('./src/random.js');
const { GATES, WICKET } = await import('./src/fence.js');
const { planPaths } = await import('./src/paths.js');
const { yardPavingOutline } = await import('./src/campfire.js');

assert.equal(planHouse(73, { doorWall: 'right' }).openings.find(({ kind }) => kind === 'door').wall, 'right');

for (const seed of [1, 2, 7, 42, 100, 1000, 4000, 9000]) {
  const house = planHouse(seed), rnd = generator(seed + 13);
  const door = house.openings.find((opening) => opening.kind === 'door').wall === 'right' ? 1 : -1;
  const side = -door, front = 1.5 + rnd();
  const atHouse = { x: GATES.at - door * (house.w / 2 + 5), z: 12.5 - front - house.d / 2 };
  const river = planRiver({ seed, back: -12.5 });
  const site = planBanya(seed, river, side);
  shapeGround(seed, [site.pad, { ...atHouse, w: house.w + 1, d: house.d + 1 }], 40, 25, { dug: river.dug, calm: river.calm, rows: river.rows });
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
  const roofExtension = banya.group.getObjectByName('banya-roof-extension');
  const roofRafters = banya.group.getObjectByName('banya-roof-rafters');
  const roofSupports = banya.group.getObjectByName('banya-roof-supports');
  assert.ok(roofExtension.children.length > 0 && roofRafters.children.length > 0, 'общая крыша продолжается над верандой на стропилах');
  assert.ok(roofSupports.children.length >= 4 && roofSupports.children.every((post) => post.material === LOG_MATERIAL
    && post.geometry.type === 'CylinderGeometry'), 'навес поддерживают круглые бревна в цвет сруба');
  const banyaBench = banya.group.getObjectByName('banya-bench');
  banyaBench.updateMatrixWorld(true);
  const benchBounds = new THREE.Box3().setFromObject(banyaBench);
  assert.ok(benchBounds.max.y - benchBounds.min.y > 0.7, 'на веранде есть деревянная лавка со спинкой');
  const c = Math.cos(site.angle), s = Math.sin(site.angle);
  const worldAtLocal = (x, z) => [site.x + c * x + s * z, site.z - s * x + c * z];
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
  assert.ok(banya.group.getObjectByName('banya-side-landing').children.length > 0, 'боковая площадка построена');
  for (let x = 1.8; x <= 2.9; x += 0.1) {
    assert.ok(!banya.blocks(...worldAtLocal(x, -2.63)), 'проход с основного настила на боковую площадку открыт');
  }
  for (let z = -2.63; z <= 2.1; z += 0.06) {
    const point = worldAtLocal(2.93, z), y = banya.deck(...point);
    assert.ok(Number.isFinite(y), 'площадка и лестница соединены');
    assert.ok(!banya.blocks(...point), `проход вдоль бани открыт: seed ${seed}, z ${z}`);
  }
  let previous = top;
  for (let z = 0.91; z < 2.1; z += 0.03) {
    const center = banya.deck(...worldAtLocal(2.93, z));
    assert.ok(center <= previous + 1e-6 && previous - center < 0.2, 'ступени идут вниз с нормальной высотой подступёнка');
    previous = center;
    for (let x = 2.385; x <= 3.475; x += 0.055) {
      const point = worldAtLocal(x, z), y = banya.deck(...point);
      assert.ok(y > groundAt(...point) + 0.035, `ступень над всей поверхностью земли: seed ${seed}, ${x}, ${z}`);
    }
  }
  const approach = worldAtLocal(2.93, 2.1), guide = worldAtLocal(2.93, 3.7);
  assert.ok(Math.hypot(banya.approach.x - approach[0], banya.approach.z - approach[1]) < 1e-6);
  assert.ok(Math.hypot(banya.approachGuide.x - guide[0], banya.approachGuide.z - guide[1]) < 1e-6);
  const pavingOrigin = { x: 14.95, z: 4.25 };
  const paths = planPaths({
    seed, gate: { x: GATES.at, z: 12.32 }, porch: { x: -1.5, z: 7 }, porchApproach: { x: 0.1, z: 7 },
    porchWidth: 1.8, pad: { x: 10.35, z: 4.25 }, padApproach: { x: 9.15, z: 4.25 }, pavingOrigin,
    pavingOutline: yardPavingOutline.map((p) => ({ x: p.x + pavingOrigin.x, z: p.z + pavingOrigin.z })),
    bath: banya.approach, bathApproach: banya.approachGuide, bathWidth: banya.approachWidth,
    house: { ...atHouse, w: house.w + 1, d: house.d + 1 },
  }).build();
  const path = paths.children[3].geometry.attributes.position;
  for (let i = 0; i < path.count; i++) {
    const x = path.getX(i), z = path.getZ(i);
    assert.ok(z > river.brow(x) + 0.15, `тропа остаётся на сухом берегу: seed ${seed}, ${x}, ${z}`);
    if (i % 17 === 8) assert.ok(!banya.blocks(x, z), `тропа к бане не упирается в сруб или перила: seed ${seed}`);
  }
  const tops = paths.getObjectByName('path-border-ends').geometry.attributes.position;
  for (const index of [path.count - 17, path.count - 1]) {
    const x = path.getX(index), z = path.getZ(index);
    assert.ok(Array.from({ length: tops.count / 9 }, (_, i) => i * 9)
      .some((i) => Math.hypot(x - tops.getX(i), z - tops.getZ(i)) < 0.08),
    `бордюр доходит до края ступеней: seed ${seed}`);
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
