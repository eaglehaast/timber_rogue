import * as THREE from 'three';
import { tiles } from './surface.js';

// Дальний план локации — акварельная панорама на 360° по внутренней стороне цилиндра вокруг двора
// (собирает tools/panorama.py, небо на ней прозрачное). Высота цилиндра — из пропорций картинки,
// чтобы она не растянулась, а горизонт картинки встаёт на уровень глаз.
// Туман сцены съел бы её целиком, поэтому он её не касается: воздух уже нарисован в самой картинке.
export async function makePanorama(name, { radius, eye }) {
  const [map] = tiles([`assets/textures/${name}.webp`]);
  map.wrapT = THREE.ClampToEdgeWrapping;
  const { horizon, aspect } = await (await fetch(`assets/textures/${name}.json`)).json();
  const height = (2 * Math.PI * radius) / aspect;
  const material = new THREE.MeshBasicMaterial({ map, alphaTest: 0.5, fog: false });
  const geometry = new THREE.CylinderGeometry(radius, radius, height, 128, 1, true).scale(-1, 1, 1);
  const ring = new THREE.Mesh(geometry, material);
  ring.position.y = eye + height * (horizon - 0.5); // horizon — доля высоты от верха картинки
  return ring;
}
