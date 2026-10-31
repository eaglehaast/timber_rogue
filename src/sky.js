import * as THREE from 'three';
import { tiles } from './surface.js';
import { generator } from './random.js';

// Небо — акварельная растяжка на сфере изнутри: нижний край картинки на горизонте, верхний в зените,
// по кругу она повторяется дважды (сама бесшовная). Ниже горизонта — её нижний край.
// На нём солнце, дневная луна и облака — картинки лицом к игроку. Облака ближе солнца и луны
// и дальше колец панорамы: низкие уходят за горы. Краски неба — как нарисованы: тональная кривая
// сцены их не трогает.
const RADIUS = 150, DISCS = 149, CLOUDS = 146;
const CLOUD_COUNT = 20;
const deg = THREE.MathUtils.degToRad;

// Картинка на небе — плоскость лицом к середине двора. Не спрайт: спрайт развёрнут вдоль экрана, и край
// большого облака сбоку экрана подходил бы ближе колец панорамы и вылезал перед горами.
function picture(map, direction, distance, width, aspect = 1) {
  const material = new THREE.MeshBasicMaterial({ map, transparent: true, toneMapped: false, depthWrite: false });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(distance * width, (distance * width) / aspect), material);
  plane.position.copy(direction).multiplyScalar(distance);
  plane.lookAt(0, 0, 0);
  return plane;
}

export async function makeSky(sun) {
  const sky = new THREE.Group();
  const geometry = new THREE.SphereGeometry(RADIUS, 64, 32);
  const p = geometry.attributes.position, uv = geometry.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setY(i, Math.max(0, Math.asin(p.getY(i) / RADIUS) / (Math.PI / 2)));
  const [map, sunMap, moonMap] = tiles(['sky.jpg', 'sun.png', 'moon.png'].map((n) => `assets/textures/${n}`));
  map.repeat.x = 2;
  map.wrapT = THREE.ClampToEdgeWrapping;
  // Сфера — фон: рисуется первой и глубину не пишет, иначе срезала бы края облаков, что выходят за неё.
  const dome = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map, side: THREE.BackSide, toneMapped: false, depthWrite: false }));
  dome.renderOrder = -1;
  sky.add(dome);

  // Луна в первой четверти: стоит на 90° восточнее солнца, левее его, и освещённым правым боком смотрит на него.
  const moon = sun.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2).setY(0.4).normalize();
  sky.add(picture(sunMap, sun, DISCS, deg(5)), picture(moonMap, moon, DISCS, deg(4)));

  // Облака вразброс по кругу, у горизонта гуще и мельче — там они дальше. Солнце и луну не закрывают:
  // тень от солнца лежит на дворе всегда. Порядок облаков и картинок у неба свой, как у забора.
  const aspects = await (await fetch('assets/textures/clouds.json')).json();
  const maps = tiles(aspects.map((_, i) => `assets/textures/cloud-${i + 1}.webp`));
  maps.forEach((m) => { m.wrapS = m.wrapT = THREE.ClampToEdgeWrapping; });
  const rnd = generator(11);
  const order = maps.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  for (let i = 0; i < CLOUD_COUNT; i++) {
    const height = deg(4 + 30 * rnd() ** 1.6);
    const around = ((i + 0.7 * rnd()) / CLOUD_COUNT) * 2 * Math.PI;
    const direction = new THREE.Vector3().setFromSphericalCoords(1, Math.PI / 2 - height, around);
    const width = deg(THREE.MathUtils.lerp(16, 40, height / deg(34)) * (0.8 + 0.4 * rnd()));
    if (direction.angleTo(sun) < width * 0.6 + deg(6) || direction.angleTo(moon) < width * 0.6 + deg(4)) continue;
    const n = order[i % order.length];
    sky.add(picture(maps[n], direction, CLOUDS, width, aspects[n]));
  }
  return sky;
}
