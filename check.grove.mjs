import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const requested = [];
globalThis.location = { search: '' };
globalThis.matchMedia = () => ({ matches: true });
globalThis.document = { createElementNS: () => ({
  addEventListener() {}, removeEventListener() {},
  set src(url) { requested.push(url); },
}) };
globalThis.fetch = async url => ({ json: async () => JSON.parse(await readFile(url, 'utf8')) });

const { planLand, buildLand } = await import('./src/land.js');
for (const seed of [1, 7, 42]) {
  const belt = buildLand(planLand(seed, () => 21)).getObjectByName('birch-belt');
  assert.ok(belt, 'роща должна присутствовать в игровом дворе');
  belt.traverse(o => assert.ok(!o.isLOD, 'приближение не должно подменять деревья'));
  assert.ok(belt.children.length <= 6, 'две иллюстрации на каждый из трёх планов');
  const depths = [];
  let triangles = 0;
  for (const mesh of belt.children) {
    assert.ok(mesh.material.map && mesh.material.alphaTest > 0);
    const points = mesh.geometry.attributes.position;
    for (let corner = 0; corner < points.count; corner += 4) {
      depths.push((points.getZ(corner) + points.getZ(corner + 2)) / 2);
    }
    triangles += mesh.geometry.index.count / 3;
  }
  depths.sort((a, b) => a - b);
  const rows = depths.filter((z, i) => i === 0 || z - depths[i - 1] > 3);
  assert.equal(rows.length, 3, 'рисованные планы должны находиться в разных местах двора');
  assert.ok(triangles < 120, 'у стоящих берёз нет объёмных крон');
}
assert.equal(requested.filter(url => url.includes('birch-belt-')).length, 2);
assert.ok(requested.every(url => !url.includes('birch-spray')), 'двор не должен загружать листву объёмной берёзы');
console.log('Постоянные планы рощи и загрузка рисунков проверены для трёх дворов');
