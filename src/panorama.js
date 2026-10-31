import * as THREE from 'three';
import { tiles } from './surface.js';

// Окружение локации — акварельная панорама на 360° по внутренней стороне цилиндра вокруг двора
// (собирает tools/panorama.py, небо на ней прозрачное). Высота цилиндра — из пропорций картинки,
// чтобы она не растянулась, а горизонт картинки встаёт на уровень глаз. Низ кольца уходит под землю:
// видно ровно то, что на картинке дальше места, где кольцо стоит.
// Картинка шире, чем берёт видеокарта, поэтому кольцо из кусков: каждый — свой сектор и своя текстура.
// Освещена она как земля двора (нормали вверх, как у пучков): иначе светилась бы сама и выбивалась из луга.
export async function makePanorama(name, { radius, eye }) {
  const { horizon, aspect, tiles: widths } = await (await fetch(`assets/textures/${name}.json`)).json();
  const height = (2 * Math.PI * radius) / aspect;
  const total = widths.reduce((a, b) => a + b);
  const ring = new THREE.Group();
  const maps = tiles(widths.map((_, i) => `assets/textures/${name}-${i}.webp`));
  let start = 0;
  widths.forEach((width, i) => {
    const map = maps[i];
    map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
    const material = new THREE.MeshLambertMaterial({ map, alphaTest: 0.5 });
    const sector = Math.ceil((128 * width) / total);
    const geometry = new THREE.CylinderGeometry(radius, radius, height, sector, 1, true,
      (2 * Math.PI * start) / total, (2 * Math.PI * width) / total).scale(-1, 1, 1);
    const up = geometry.attributes.normal;
    for (let j = 0; j < up.count; j++) up.setXYZ(j, 0, 1, 0);
    ring.add(new THREE.Mesh(geometry, material));
    start += width;
  });
  ring.position.y = eye + height * (horizon - 0.5); // horizon — доля высоты от верха картинки
  return ring;
}
