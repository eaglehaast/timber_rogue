import * as THREE from 'three';
import { leafAtlas } from './maple.js';
import { generator } from './random.js';

const COUNT = 42;
const COLORS = [0xb5c58a, 0xf5d894, 0xdebd72, 0xf1e5ad, 0xc6d691];

// Один рисунок из акварельного атласа на всю горсть. Карточки только кувыркаются
// в потоке и садятся на землю. С миром твёрдых тел они никак не взаимодействуют.
export function makeFallLeaves(scene) {
  const shape = new THREE.PlaneGeometry(1, 1);
  const uv = shape.attributes.uv, [cols, rows] = leafAtlas.grid;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (1 + uv.getX(i)) / cols, (rows - 1 + uv.getY(i)) / rows);
  const leaves = new THREE.InstancedMesh(shape, new THREE.MeshBasicMaterial({
    map: leafAtlas.map, side: THREE.DoubleSide, alphaTest: 0.33,
  }), COUNT);
  leaves.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  leaves.frustumCulled = false;
  for (let i = 0; i < COUNT; i++) leaves.setColorAt(i, new THREE.Color(COLORS[i % COLORS.length]));
  const wash = document.createElement('canvas');
  wash.width = wash.height = 64;
  const ink = wash.getContext('2d'), gradient = ink.createRadialGradient(32, 32, 1, 32, 32, 31);
  gradient.addColorStop(0, 'rgba(255,255,255,.72)');
  gradient.addColorStop(0.48, 'rgba(255,255,255,.34)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ink.fillStyle = gradient;
  ink.fillRect(0, 0, 64, 64);
  const dust = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
    map: new THREE.CanvasTexture(wash), color: 0xe3d5a5, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2,
  }), 6);
  dust.frustumCulled = false;
  scene.add(leaves, dust);
  const brush = new THREE.Object3D(), dir = new THREE.Vector3(), side = new THREE.Vector3(), origin = new THREE.Vector3();
  let particles = [], age = 0, ground;
  function clear() {
    particles = [];
    leaves.visible = dust.visible = false;
    age = 0;
  }
  function burst(limbs, point, direction, seed, floor) {
    clear();
    const sources = limbs.filter(l => l.cards.length);
    if (!sources.length) return;
    const rnd = generator(seed ^ 0x456b);
    ground = floor;
    dir.copy(direction);
    side.set(-dir.z, 0, dir.x);
    origin.copy(point);
    for (let i = 0; i < COUNT; i++) {
      const limb = sources[i % sources.length];
      const start = limb.group.localToWorld(limb.cards[Math.floor(rnd() * limb.cards.length)].center.clone());
      start.y = Math.max(start.y, floor(start.x, start.z) + 0.14);
      const sign = i % 2 ? -1 : 1;
      const velocity = side.clone().multiplyScalar(sign * (0.8 + 3.7 * rnd())).addScaledVector(dir, rnd() * 3.1 - 0.5);
      velocity.y = 1.45 + 2.6 * rnd();
      particles.push({ start, velocity, size: 0.24 + rnd() * 0.18, phase: rnd() * 6.28, spin: sign * (2.4 + rnd() * 3.6) });
    }
    leaves.visible = dust.visible = true;
    tick(0);
  }
  function tick(dt) {
    if (!particles.length) return;
    age += dt;
    const spread = -Math.expm1(-1.05 * age) / 1.05;
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      brush.position.copy(p.start).addScaledVector(p.velocity, spread);
      brush.position.addScaledVector(side, 0.14 * (Math.sin(age * 4.2 + p.phase) - Math.sin(p.phase)));
      const floorY = ground(brush.position.x, brush.position.z) + 0.018;
      const y = p.start.y + p.velocity.y * age - 2.45 * age * age;
      brush.position.y = Math.max(floorY, y);
      const flying = THREE.MathUtils.smoothstep(y - floorY, 0, 0.4);
      brush.rotation.set(-Math.PI / 2 + flying * Math.cos(age * p.spin + p.phase), flying * (age * p.spin + p.phase), p.phase + age * 0.65);
      brush.scale.setScalar(p.size * (1 - THREE.MathUtils.smoothstep(age, 2.15, 2.8)));
      brush.updateMatrix();
      leaves.setMatrixAt(i, brush.matrix);
    }
    leaves.instanceMatrix.needsUpdate = true;
    const t = Math.min(age / 0.64, 1);
    dust.visible = t < 1;
    if (dust.visible) {
      dust.material.opacity = 0.12 * Math.sin(Math.PI * Math.sqrt(t));
      for (let i = 0; i < dust.count; i++) {
        const sign = i % 2 ? -1 : 1;
        brush.position.copy(origin).addScaledVector(dir, (i >> 1) * 0.75 - 0.6).addScaledVector(side, sign * (0.24 + 2.8 * t));
        brush.position.y = ground(brush.position.x, brush.position.z) + 0.035;
        brush.rotation.set(-Math.PI / 2, 0, -Math.atan2(dir.z, dir.x) + sign * 0.2);
        brush.scale.set(1.15 + 1.1 * t, 0.5 + 0.8 * t, 1);
        brush.updateMatrix();
        dust.setMatrixAt(i, brush.matrix);
      }
      dust.instanceMatrix.needsUpdate = true;
    }
    if (age >= 2.8) clear();
  }
  clear();
  return { clear, burst, tick, get active() { return leaves.visible; } };
}
