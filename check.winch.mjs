import assert from 'node:assert/strict';
import * as THREE from 'three';

class ImageMock {
  addEventListener(name, fn) { this[`on${name}`] = fn; }
  removeEventListener() {}
  set src(value) { this._src = value; queueMicrotask(() => this.onload?.()); }
  get src() { return this._src; }
}
globalThis.window = globalThis;
globalThis.document = { createElementNS: () => new ImageMock(), createElement: () => new ImageMock() };
globalThis.location = { search: '' };
globalThis.matchMedia = () => ({ matches: true });
Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node', maxTouchPoints: 0 }, configurable: true });
const { createWinch, findWinchTarget, WINCH_MAX, WINCH_STEP } = await import('./src/winch.js');
const { leaning } = await import('./src/physics.js');
const { VOXEL } = await import('./src/trunk.js');

const scene = new THREE.Scene();
const root = new THREE.Group();
scene.add(root);
const upper = new THREE.Group();
root.add(upper);
const tree = { root, upper, base: root.position };
const winch = createWinch(scene);
const pegGroup = scene.children.find((item) => item !== root && item.children.length === 4);
assert.equal(winch.tie(tree, new THREE.Vector3(0, 2, 0)), true, 'трос привязывается к верхней части дерева');
assert.equal(winch.tie(tree, new THREE.Vector3(0, 2, 0)), false, 'повторная привязка не создаёт вторую лебёдку');
assert.equal(winch.ratchet(), false, 'натяжение недоступно до установки кола');
assert.equal(winch.plant(new THREE.Vector3(5, 0, 0)), true, 'кол устанавливается отдельно от пиления');
assert.equal(winch.directionFrom(root.position).x, 1, 'дерево тянется в направлении наземного кола');

const pivot = new THREE.Vector3(0, 0.5, 0);
const axis = new THREE.Vector3(0, 0, -1);
assert.equal(winch.moment(pivot, axis), 0, 'без натяжения трос не создаёт момента');
for (let i = 0; i < WINCH_MAX / WINCH_STEP; i++) assert.equal(winch.ratchet(), true);
assert.equal(winch.tension, WINCH_MAX, 'нажатия постепенно наращивают и сохраняют усилие');
assert.equal(winch.ratchet(), false, 'усилие ограничено безопасным пределом');
assert.ok(winch.moment(pivot, axis) > 0, 'натянутый трос добавляет момент в сторону кола');
const offset = winch.offset(pivot, 10000);
assert.ok(offset.x > 0, 'усилие сдвигает расчётный момент к колу');
assert.ok(Math.abs(offset.x * 10000 - winch.moment(pivot, axis)) < 1e-6, 'смещение соответствует моменту троса');
// Недопил посередине, дерево клонится от кола (вес в −x). Натянутая лебёдка уводит направление падения к колу.
const fibre = (x, z, gap = 0) => ({ x, z, gap });
const sec = { all: [fibre(-0.02, 0), fibre(0.02, 0), fibre(-0.06, 0, 1), fibre(0.06, 0, 1)] };
sec.intact = sec.all.filter((f) => !f.gap);
const original = leaning(sec, new THREE.Vector3(-0.1, 0, 0), 0.1);
const pulled = leaning(sec, new THREE.Vector3(-0.1, 0, 0).add(offset), 0.1);
assert.ok(original.u.x < 0, 'без лебёдки дерево падает туда, куда клонится');
assert.ok(pulled.u.x > 0, 'лебёдка уводит направление падения к колу');
assert.equal(pegGroup.visible, true, 'после установки кола появляется видимый корпус лебёдки');
assert.ok(pegGroup.children[3].rotation.x > 0, 'ручной барабан поворачивается при натяжении');

const rope = scene.children.find((item) => item !== root && item.type === 'Group');
const ropeStartY = rope.children[0].position.y;
upper.position.y = 1;
winch.update();
assert.ok(scene.children.some((item) => item !== root && item.visible), 'трос и кол видимы в сцене');
assert.ok(rope.children[0].position.y > ropeStartY, 'трос следует за движущейся точкой привязки');

winch.clear();
assert.equal(winch.tree, null);
assert.equal(winch.tension, 0);

assert.ok(winch.tie(tree, new THREE.Vector3(0, 2, 0)));
assert.ok(winch.plant(new THREE.Vector3(5, 0, 0)));
assert.ok(winch.ratchet());
assert.ok(winch.untie(), 'трос можно отвязать, не забирая установленную лебёдку');
assert.equal(winch.tree, null);
assert.equal(winch.staked, true);
assert.equal(winch.tension, 0);
assert.ok(winch.tie(tree, new THREE.Vector3(0, 1, 0)), 'трос можно привязать заново при установленной лебёдке');
assert.ok(winch.pickUp(), 'установленную лебёдку можно забрать, оставив трос привязанным');
assert.equal(winch.staked, false);
assert.equal(winch.tree, tree);
assert.equal(winch.tension, 0);
assert.ok(winch.plant(new THREE.Vector3(-5, 0, 0)), 'после возврата лебёдку можно поставить в другом направлении');
assert.equal(winch.directionFrom(root.position).x, -1);

const group = new THREE.Group();
scene.add(group);
const voxels = {
  group, lift: group, x0: -0.05, z0: -0.05, n: 0.1 / VOXEL, m: 0.1 / VOXEL, ny: 3 / VOXEL, cutHigh: -1,
  at: () => 1,
};
const standing = { standing: 1, voxels };
const look = new THREE.Vector3(0, 0, -1);
const eye = new THREE.Vector3(0, 1.7, 1);
const target = findWinchTarget([standing], eye, look);
assert.ok(target, 'можно прицелиться в ствол с земли');
assert.ok(Math.abs(target.point.y - 1.7) < 1e-6);
assert.ok(Math.abs(target.point.z - 0.05) < 1e-6, 'точка крепления лежит на пересечении луча со стволом');
assert.equal(findWinchTarget([standing], eye, new THREE.Vector3(1, 0, 0)), null, 'мимо ствола привязать нельзя');
assert.equal(findWinchTarget([{ ...standing, standing: 0 }], eye, look), null, 'к спиленному дереву привязать нельзя');
voxels.cutHigh = 1.8 / VOXEL;
assert.equal(findWinchTarget([standing], eye, look), null, 'ниже пропила трос не привязывается к падающей части');
assert.ok(findWinchTarget([standing], new THREE.Vector3(0, 2, 1), look), 'с лестницы можно выбрать точку выше пропила');
console.log('winch checks ok');
