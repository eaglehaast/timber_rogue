import * as THREE from 'three';
import { tiles, soften } from './surface.js';

const [paving] = tiles(['assets/textures/yard/timber_yard_paving_01.jpg']);

export const pavingTexture = () => paving.clone();

export function pavingMaterial(map = pavingTexture()) {
  return soften(new THREE.MeshLambertMaterial({ map, color: 0xffffff }), {
    contrast: 0.88, saturation: 0.75, scales: [0.15, 0.5],
    low: [0.92, 0.9, 0.86], high: [1.06, 1.05, 1.02], cells: [1, 1],
  });
}
