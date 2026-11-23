import * as THREE from 'three';
import { FENCE_BOARD_MATERIAL } from './fence.js';

export const LADDER_LENGTH = 2.2;
export const LADDER_ANGLE = THREE.MathUtils.degToRad(15);
export const LADDER_ATTACH_HEIGHT = LADDER_LENGTH * Math.cos(LADDER_ANGLE);
export const LADDER_WIDTH = 0.42;
export const LADDER_CLIMB_SPEED = 1.1;
const RAIL = 0.075, RUNG = 0.065, STEP = 0.3;

export function buildLadder() {
  const ladder = new THREE.Group();
  const add = (width, height, depth, x, y, z) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), FENCE_BOARD_MATERIAL);
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    ladder.add(mesh);
  };
  for (const x of [-LADDER_WIDTH / 2 + RAIL / 2, LADDER_WIDTH / 2 - RAIL / 2]) {
    add(RAIL, LADDER_LENGTH, RAIL, x, LADDER_LENGTH / 2, 0);
  }
  for (let y = STEP / 2; y < LADDER_LENGTH - RUNG; y += STEP) {
    add(LADDER_WIDTH - RAIL, RUNG, 0.06, 0, y, 0.005);
  }
  ladder.name = 'player-ladder';
  ladder.visible = false;
  return ladder;
}

export function findLadderPlacement(trees, position, direction, ground) {
  const attachHeight = LADDER_ATTACH_HEIGHT;
  const forward = direction.clone().setY(0).normalize();
  const reach = LADDER_LENGTH * Math.sin(LADDER_ANGLE);
  for (let distance = 0.2; distance <= 3.2; distance += 0.04) {
    const x = position.x + forward.x * distance, z = position.z + forward.z * distance;
    for (const tree of trees) {
      if (!tree.standing || tree.fall || tree.done || tree.top) continue;
      const localX = x - tree.base.x, localZ = z - tree.base.z;
      const localY = attachHeight;
      for (const [i, stem] of tree.voxels.shape.stems.entries()) {
        if ((tree.standing & (1 << i)) === 0) continue;
        if (Number.isFinite(tree.stumps?.[i]) && attachHeight <= tree.stumps[i]) continue;
        if (!stem.contains(localX, localY, localZ)) continue;
        const center = stem.center(localY);
        const dx = localX - center.x, dz = localZ - center.z;
        const angle = Math.atan2(dz, dx), radius = stem.outline(angle, localY);
        const outward = new THREE.Vector3(dx, 0, dz);
        if (outward.lengthSq() < 1e-8) outward.copy(forward).negate();
        else outward.normalize();
        const surface = new THREE.Vector3(
          tree.root.position.x + center.x + outward.x * radius,
          ground(x, z),
          tree.root.position.z + center.z + outward.z * radius,
        );
        const base = surface.clone().addScaledVector(outward, reach + 0.025);
        base.y = ground(base.x, base.z);
        const ladderForward = outward.negate();
        const right = new THREE.Vector3(-ladderForward.z, 0, ladderForward.x);
        const up = new THREE.Vector3().copy(UP).multiplyScalar(Math.cos(LADDER_ANGLE))
          .addScaledVector(ladderForward, Math.sin(LADDER_ANGLE));
        return {
          tree, stem: i, base, forward: ladderForward, right, up,
          maxProgress: LADDER_LENGTH - 0.18,
        };
      }
    }
  }
  return null;
}

const UP = new THREE.Vector3(0, 1, 0);

export function ladderClimbPosition(placement, progress, offset = 0.18) {
  return placement.base.clone()
    .addScaledVector(placement.up, progress)
    .addScaledVector(placement.forward, -offset);
}

export function advanceLadderClimb(placement, progress, direction, dt) {
  const next = progress + direction * LADDER_CLIMB_SPEED * dt;
  return {
    progress: THREE.MathUtils.clamp(next, 0, placement.maxProgress),
    leaveAtBottom: direction < 0 && next <= 0,
  };
}
