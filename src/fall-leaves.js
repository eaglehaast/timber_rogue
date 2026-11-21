import * as THREE from 'three';
import { leafAtlas } from './maple.js';
import { generator } from './random.js';

const FIRST_LEAVES = 8, IMPACT_LEAVES = 42;
const COLORS = [0xb5c58a, 0xf5d894, 0xdebd72, 0xf1e5ad, 0xc6d691];

export function makeFallLeaves(scene) {
  const shape = new THREE.PlaneGeometry(1, 1);
  const uv = shape.attributes.uv, [cols, rows] = leafAtlas.grid;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (1 + uv.getX(i)) / cols, (rows - 1 + uv.getY(i)) / rows);
  const paint = new THREE.MeshBasicMaterial({ map: leafAtlas.map, side: THREE.DoubleSide, alphaTest: 0.33 });
  const wash = document.createElement('canvas');
  wash.width = wash.height = 64;
  const ink = wash.getContext('2d'), gradient = ink.createRadialGradient(32, 32, 1, 32, 32, 31);
  gradient.addColorStop(0, 'rgba(255,255,255,.72)');
  gradient.addColorStop(0.48, 'rgba(255,255,255,.34)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ink.fillStyle = gradient;
  ink.fillRect(0, 0, 64, 64);
  const dustShape = new THREE.PlaneGeometry(1, 1), washMap = new THREE.CanvasTexture(wash);
  const brush = new THREE.Object3D();
  const batches = [];

  // Своя горсть на каждый хруст или удар. Падающие одновременно клёны делят
  // рисунки и геометрию, а освободившиеся горсти можно запускать заново.
  function makeBatch(impact) {
    const count = impact ? IMPACT_LEAVES : FIRST_LEAVES;
    const leaves = new THREE.InstancedMesh(shape, paint, count);
    leaves.name = impact ? 'maple-impact-leaves' : 'maple-first-leaves';
    leaves.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    leaves.frustumCulled = false;
    leaves.visible = false;
    for (let i = 0; i < count; i++) leaves.setColorAt(i, new THREE.Color(COLORS[i % COLORS.length]));
    scene.add(leaves);
    let dust = null;
    if (impact) {
      dust = new THREE.InstancedMesh(dustShape, new THREE.MeshBasicMaterial({
        map: washMap, color: 0xe3d5a5, transparent: true, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -2,
      }), 6);
      dust.name = 'maple-impact-air';
      dust.frustumCulled = false;
      dust.visible = false;
      scene.add(dust);
    }
    const batch = { leaves, dust, particles: [], dir: new THREE.Vector3(), side: new THREE.Vector3(), origin: new THREE.Vector3() };
    batches.push(batch);
    return batch;
  }

  function begin(impact, floor) {
    const batch = batches.find(b => !b.leaves.visible && Boolean(b.dust) === impact) ?? makeBatch(impact);
    batch.age = 0;
    batch.duration = 0;
    batch.floor = floor;
    batch.leaves.visible = true;
    return batch;
  }

  function finish(batch) {
    batch.leaves.visible = false;
    if (batch.dust) batch.dust.visible = false;
    batch.particles.length = 0;
  }

  function shed(limbs, base, seed, floor) {
    const sources = limbs.filter(l => l.cards.length);
    if (!sources.length) return;
    const batch = begin(false, floor), rnd = generator(seed ^ 0x9e37);
    for (let i = 0; i < FIRST_LEAVES; i++) {
      const limb = sources[i % sources.length], cards = limb.cards;
      // С внешних нижних веточек осыпание читается и из-под дерева, и в общем виде.
      const a = cards[Math.floor(rnd() * cards.length)], b = cards[Math.floor(rnd() * cards.length)];
      const start = limb.group.localToWorld((a.center.y < b.center.y ? a : b).center.clone());
      const outward = start.clone().sub(base).setY(0).normalize().applyAxisAngle(THREE.Object3D.DEFAULT_UP, rnd() - 0.5);
      const side = new THREE.Vector3(-outward.z, 0, outward.x);
      const velocity = outward.multiplyScalar(0.68 + 0.65 * rnd()).setY(-0.21 - 0.26 * rnd());
      const delay = i / FIRST_LEAVES * 0.34;
      const height = Math.max(0, start.y - floor(start.x, start.z));
      const life = 1.6 + height / (1.7 - velocity.y);
      batch.particles.push({ start, velocity, side, delay, life, size: 0.22 + 0.12 * rnd(), phase: rnd() * 6.28, spin: (i % 2 ? -1 : 1) * (2 + 2.6 * rnd()) });
      batch.duration = Math.max(batch.duration, delay + life);
    }
    draw(batch);
  }

  function burst(limbs, point, direction, seed, floor) {
    const sources = limbs.filter(l => l.cards.length);
    if (!sources.length) return;
    const batch = begin(true, floor), rnd = generator(seed ^ 0x456b);
    batch.duration = 2.8;
    batch.dir.copy(direction);
    batch.side.set(-direction.z, 0, direction.x);
    batch.origin.copy(point);
    for (let i = 0; i < IMPACT_LEAVES; i++) {
      const limb = sources[i % sources.length];
      const start = limb.group.localToWorld(limb.cards[Math.floor(rnd() * limb.cards.length)].center.clone());
      start.y = Math.max(start.y, floor(start.x, start.z) + 0.14);
      const sign = i % 2 ? -1 : 1;
      const velocity = batch.side.clone().multiplyScalar(sign * (0.8 + 3.7 * rnd())).addScaledVector(direction, rnd() * 3.1 - 0.5);
      velocity.y = 1.45 + 2.6 * rnd();
      batch.particles.push({ start, velocity, side: batch.side, delay: 0, life: batch.duration, size: 0.24 + rnd() * 0.18, phase: rnd() * 6.28, spin: sign * (2.4 + rnd() * 3.6) });
    }
    draw(batch);
  }

  function draw(batch) {
    const { leaves, particles, dust, age, floor } = batch;
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i], t = Math.max(0, age - p.delay);
      const drag = dust ? 1.05 : 0.48;
      const spread = -Math.expm1(-drag * t) / drag;
      brush.position.copy(p.start).addScaledVector(p.velocity, spread);
      brush.position.addScaledVector(p.side, 0.14 * (Math.sin(t * 4.2 + p.phase) - Math.sin(p.phase)));
      const floorY = floor(brush.position.x, brush.position.z) + 0.018;
      const drop = dust ? 2.45 * t * t : 1.7 * (t + Math.expm1(-1.4 * t) / 1.4);
      const y = p.start.y + p.velocity.y * t - drop;
      brush.position.y = Math.max(floorY, y);
      const flying = THREE.MathUtils.smoothstep(y - floorY, 0, 0.4);
      brush.rotation.set(-Math.PI / 2 + flying * Math.cos(t * p.spin + p.phase), flying * (t * p.spin + p.phase), p.phase + t * 0.65);
      brush.scale.setScalar(age < p.delay ? 0 : p.size * (1 - THREE.MathUtils.smoothstep(t, p.life - 0.65, p.life)));
      brush.updateMatrix();
      leaves.setMatrixAt(i, brush.matrix);
    }
    leaves.instanceMatrix.needsUpdate = true;
    if (!dust) return;
    const t = Math.min(age / 0.64, 1);
    dust.visible = t < 1;
    if (!dust.visible) return;
    dust.material.opacity = 0.12 * Math.sin(Math.PI * Math.sqrt(t));
    for (let i = 0; i < dust.count; i++) {
      const sign = i % 2 ? -1 : 1;
      brush.position.copy(batch.origin).addScaledVector(batch.dir, (i >> 1) * 0.75 - 0.6).addScaledVector(batch.side, sign * (0.24 + 2.8 * t));
      brush.position.y = floor(brush.position.x, brush.position.z) + 0.035;
      brush.rotation.set(-Math.PI / 2, 0, -Math.atan2(batch.dir.z, batch.dir.x) + sign * 0.2);
      brush.scale.set(1.15 + 1.1 * t, 0.5 + 0.8 * t, 1);
      brush.updateMatrix();
      dust.setMatrixAt(i, brush.matrix);
    }
    dust.instanceMatrix.needsUpdate = true;
  }

  makeBatch(false);
  makeBatch(true);
  return {
    shed, burst,
    clear() { batches.forEach(finish); },
    tick(dt) {
      for (const batch of batches) {
        if (!batch.leaves.visible) continue;
        batch.age += dt;
        if (batch.age >= batch.duration) finish(batch);
        else draw(batch);
      }
    },
  };
}
