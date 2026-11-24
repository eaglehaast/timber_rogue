import * as THREE from 'three';
import { hitLog } from './log-cut.js';

export const WINCH_STEP = 1000;
export const WINCH_MAX = 6000;
const UP = new THREE.Vector3(0, 1, 0);

export function findWinchTarget(trees, eye, look, limit = 2.5) {
  let best = null;
  for (const tree of trees) {
    if (!tree.standing || tree.fall || tree.done || tree.top) continue;
    const voxels = tree.voxels;
    const log = {
      group: voxels.cutHigh >= 0 ? voxels.lift : voxels.group,
      x0: voxels.x0, z0: voxels.z0, n: voxels.n, m: voxels.m, ny: voxels.ny,
      at: voxels.at.bind(voxels),
    };
    const hit = hitLog(log, eye, look, best?.distance ?? limit);
    if (!hit || (voxels.cutHigh >= 0 && hit.row <= voxels.cutHigh)) continue;
    best = { tree, point: eye.clone().addScaledVector(look, hit.t), distance: hit.t };
  }
  return best;
}

export function createWinch(scene) {
  const ropeMaterial = new THREE.MeshStandardMaterial({ color: 0xb99a64, roughness: 0.9 });
  const pegMaterial = new THREE.MeshStandardMaterial({ color: 0x66513a, roughness: 0.95 });
  const winchMaterial = new THREE.MeshStandardMaterial({ color: 0x414941, metalness: 0.55, roughness: 0.48 });
  const rope = new THREE.Group();
  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(0.055, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0xffd26e, depthTest: false }),
  );
  marker.renderOrder = 10;
  marker.visible = false;
  const segments = Array.from({ length: 2 }, () => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1, 6), ropeMaterial);
    mesh.castShadow = true;
    rope.add(mesh);
    return mesh;
  });
  const peg = new THREE.Group();
  const stake = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.8, 8), pegMaterial);
  stake.rotation.z = Math.PI;
  stake.position.y = 0.4;
  stake.castShadow = stake.receiveShadow = true;
  peg.add(stake);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.06, 8), pegMaterial);
  cap.position.y = 0.72;
  cap.castShadow = true;
  peg.add(cap);
  const housing = new THREE.Group();
  peg.add(housing);
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.07, 0.28), winchMaterial);
  plate.position.y = 0.78;
  plate.castShadow = plate.receiveShadow = true;
  housing.add(plate);
  const caseMesh = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.17, 0.22), winchMaterial);
  caseMesh.position.y = 0.88;
  caseMesh.castShadow = caseMesh.receiveShadow = true;
  housing.add(caseMesh);
  const drum = new THREE.Group();
  drum.position.y = 1.04;
  peg.add(drum);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.18, 12), ropeMaterial);
  barrel.rotation.z = Math.PI / 2;
  barrel.castShadow = true;
  drum.add(barrel);
  for (const x of [-0.11, 0.11]) {
    const flange = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.035, 12), winchMaterial);
    flange.rotation.z = Math.PI / 2;
    flange.position.x = x;
    flange.castShadow = true;
    drum.add(flange);
  }
  const crank = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.26, 0.045), winchMaterial);
  crank.position.set(0.15, 0.08, 0);
  crank.castShadow = true;
  drum.add(crank);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.13, 8), pegMaterial);
  handle.position.set(0.15, -0.1, 0);
  handle.castShadow = true;
  drum.add(handle);
  scene.add(rope, peg, marker);
  rope.visible = peg.visible = false;

  let tree = null, anchor = null, pegPosition = null, tension = 0;
  const anchorWorld = new THREE.Vector3();
  const pegEye = new THREE.Vector3();
  const midpoint = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const lever = new THREE.Vector3();
  const force = new THREE.Vector3();

  function updateSegment(mesh, from, to) {
    direction.subVectors(to, from);
    const length = direction.length();
    mesh.position.copy(from).add(to).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(UP, direction.normalize());
    mesh.scale.y = length;
  }

  function getAnchorWorld() {
    if (!tree || !anchor) return null;
    tree.upper.updateWorldMatrix(true, false);
    return tree.upper.localToWorld(anchorWorld.copy(anchor));
  }

  function tie(toTree, worldAnchor) {
    if (tree || !toTree?.upper) return false;
    toTree.upper.updateWorldMatrix(true, false);
    tree = toTree;
    anchor = toTree.upper.worldToLocal(worldAnchor.clone());
    rope.visible = true;
    update();
    return true;
  }

  function plant(position) {
    if (!tree || pegPosition) return false;
    pegPosition = position.clone();
    peg.position.copy(pegPosition);
    peg.visible = true;
    update();
    return true;
  }

  function untie() {
    if (!tree) return false;
    tree = anchor = null;
    tension = 0;
    rope.visible = false;
    drum.rotation.x = 0;
    return true;
  }

  function pickUp() {
    if (!pegPosition) return false;
    pegPosition = null;
    tension = 0;
    peg.visible = false;
    update();
    return true;
  }

  function showTarget(target) {
    marker.visible = Boolean(target);
    if (target) marker.position.copy(target.point);
  }

  function ratchet() {
    if (!pegPosition || tension >= WINCH_MAX) return false;
    tension = Math.min(WINCH_MAX, tension + WINCH_STEP);
    update();
    return true;
  }

  function moment(pivot, axis) {
    if (!tree || !pegPosition || !tension) return 0;
    const point = getAnchorWorld();
    pegEye.copy(pegPosition).y += 1.04;
    force.subVectors(pegEye, point);
    if (force.lengthSq() < 1e-8) return 0;
    force.normalize().multiplyScalar(tension);
    lever.subVectors(point, pivot);
    return lever.cross(force).dot(axis);
  }

  function offset(pivot, weight) {
    if (!tree || !pegPosition || !tension || weight <= 0) return new THREE.Vector3();
    const point = getAnchorWorld();
    pegEye.copy(pegPosition).y += 1.04;
    force.subVectors(pegEye, point);
    if (force.lengthSq() < 1e-8) return new THREE.Vector3();
    force.normalize().multiplyScalar(tension);
    lever.subVectors(point, pivot).cross(force);
    return new THREE.Vector3(-lever.z / weight, 0, lever.x / weight);
  }

  function directionFrom(origin) {
    if (!pegPosition) return null;
    const result = new THREE.Vector3(pegPosition.x - origin.x, 0, pegPosition.z - origin.z);
    return result.lengthSq() > 1e-8 ? result.normalize() : null;
  }

  function update() {
    if (!tree || !anchor) return;
    drum.rotation.x = (tension / WINCH_MAX) * Math.PI * 4;
    const point = getAnchorWorld();
    if (!point) return;
    if (!pegPosition) {
      peg.visible = false;
      pegEye.copy(tree.base);
      pegEye.x = point.x;
      pegEye.z = point.z;
      pegEye.y += 0.1;
      midpoint.copy(point).add(pegEye).multiplyScalar(0.5);
      midpoint.x += 0.08;
      updateSegment(segments[0], point, midpoint);
      updateSegment(segments[1], midpoint, pegEye);
      return;
    }
    peg.position.copy(pegPosition);
    peg.visible = true;
    pegEye.copy(pegPosition).y += 1.04;
    midpoint.copy(point).add(pegEye).multiplyScalar(0.5);
    midpoint.y -= 0.28 * (1 - tension / WINCH_MAX);
    updateSegment(segments[0], point, midpoint);
    updateSegment(segments[1], midpoint, pegEye);
    rope.visible = true;
  }

  function clear() {
    tree = anchor = pegPosition = null;
    tension = 0;
    rope.visible = peg.visible = marker.visible = false;
  }

  return {
    get tree() { return tree; },
    get staked() { return Boolean(pegPosition); },
    get tension() { return tension; },
    get maxTension() { return WINCH_MAX; },
    get position() { return pegPosition; },
    tie,
    plant,
    untie,
    pickUp,
    showTarget,
    ratchet,
    directionFrom,
    moment,
    offset,
    update,
    clear,
  };
}
