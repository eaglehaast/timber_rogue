import * as THREE from 'three';
import { barkMaterial, BARK_TILE } from './bark.js';

// Клён ясенелистный (американский) — сорняк: растёт быстро и как попало. От развилки ветви
// разбегаются в стороны, крона широкая и кособокая. Пока ствол прямой, с развилкой наверху,
// а листва — шапками на ветвях.
const leafMat = new THREE.MeshLambertMaterial({ color: 0x7fae47, flatShading: true });
const UP = new THREE.Vector3(0, 1, 0);

// Ветвь — сужающийся цилиндр от точки from до точки to. Кора на ней в том же масштабе, что на стволе.
function limb(from, to, r0, r1) {
  const dir = to.clone().sub(from);
  const geometry = new THREE.CylinderGeometry(r1, r0, dir.length(), 10);
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (uv.getX(i) * Math.PI * (r0 + r1)) / BARK_TILE, (uv.getY(i) * dir.length()) / BARK_TILE);
  }
  const mesh = new THREE.Mesh(geometry, barkMaterial);
  mesh.position.copy(from).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(UP, dir.normalize());
  return mesh;
}

const rand = (a, b) => a + Math.random() * (b - a);

// length — высота от низа до вершины, r — радиус ствола внизу, side — куда сдвинута крона
// (вектор вдоль земли). Возвращает модель и центр листвы — по нему считается вес кроны.
export function growMaple(length, r, side) {
  const tree = new THREE.Group();
  const forkY = length * rand(0.15, 0.3);
  const fork = new THREE.Vector3(0, forkY, 0);
  const forkR = r * 0.75;
  tree.add(limb(new THREE.Vector3(), fork, r, forkR));
  const crown = new THREE.Vector3();
  let leaves = 0;
  const count = 4 + Math.floor(Math.random() * 3);
  for (let i = 0; i < count; i++) {
    const az = ((i + rand(-0.3, 0.3)) / count) * Math.PI * 2;
    const out = new THREE.Vector3(Math.cos(az), 0, -Math.sin(az)).multiplyScalar(rand(1.8, 3)).add(side);
    const tip = out.setY(rand(0.7, 1) * length);
    // Ветвь изогнута: середина сбита в сторону.
    const mid = fork.clone().lerp(tip, 0.5).add(new THREE.Vector3(rand(-0.4, 0.4), rand(-0.3, 0.3), rand(-0.4, 0.4)));
    const midR = forkR * 0.35;
    tree.add(limb(fork, mid, forkR * 0.55, midR), limb(mid, tip, midR, 0.03));
    // Листва — шапками вдоль внешней половины ветви, к концу крупнее.
    for (const t of [0, 0.5, 1]) {
      const at = mid.clone().lerp(tip, t);
      const size = rand(0.7, 1) + 0.3 * t;
      const clump = new THREE.Mesh(new THREE.IcosahedronGeometry(size, 1), leafMat);
      clump.position.copy(at);
      clump.scale.y = 0.7;
      clump.rotation.set(rand(0, 3), rand(0, 3), 0);
      tree.add(clump);
      crown.addScaledVector(at, size ** 3);
      leaves += size ** 3;
    }
  }
  return { tree, crown: crown.divideScalar(leaves) };
}
