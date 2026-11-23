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
const { shapeGround, height } = await import('./src/terrain.js');
const { makeGround } = await import('./src/grass.js');
const { planBanya, buildBanya } = await import('./src/banya.js');
const { planHouse, LOG_MATERIAL } = await import('./src/house.js');
const { PANE } = await import('./src/window.js');
const { planGas, gasPostMaterial } = await import('./src/gas.js');
const { planPower, powerWireMaterial } = await import('./src/power.js');
const { generator } = await import('./src/random.js');
const { GATES, WICKET } = await import('./src/fence.js');

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
  const stairZ = -2 - 0.13 - 0.8;
  const stairPoint = (x) => [site.x + c * x + s * stairZ, site.z - s * x + c * stairZ];
  const stairs = [2.05, 2.25, 2.45, 2.65, 2.85, 3.05].map((x) => banya.deck(...stairPoint(x)));
  assert.ok(stairs.every(Number.isFinite));
  assert.ok(stairs.every((y, i) => i === 0 || y <= stairs[i - 1]));
  assert.ok(!banya.blocks(...stairPoint(2.6)), 'перила не перекрывают проход по лестнице');
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
