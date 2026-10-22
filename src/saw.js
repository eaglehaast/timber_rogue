import * as THREE from 'three';

// Бензопила — модель-заглушка из коробок. Будущая красивая модель заменит makeSaw и должна
// держаться тех же осей: x — вдоль шины (мотор на +x), y — куда шина идёт в древесину,
// z — перпендикуляр к полотну (при горизонтальном резе — вверх). Начало координат — середина шины.
export const BAR_L = 0.7;  // длина шины: столько она перекрывает поперёк пропила
export const BAR_W = 0.05; // ширина шины: столько её позади режущей кромки сидит в щели

const box = (w, h, d, material, x, y = 0, z = 0) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  return mesh;
};

export function makeSaw() {
  const steel = new THREE.MeshLambertMaterial({ color: 0x9a9aa0 });
  const orange = new THREE.MeshLambertMaterial({ color: 0xeb7a22 });
  const black = new THREE.MeshLambertMaterial({ color: 0x222222 });
  const skin = new THREE.MeshLambertMaterial({ color: 0xe0ad84 });
  const motor = BAR_L / 2 + 0.12;
  const saw = new THREE.Group();
  saw.add(
    box(BAR_L, BAR_W, 0.012, steel, 0),
    box(0.24, 0.16, 0.18, orange, motor, -0.02, 0.03),
    // Задняя рукоять — за мотором, передняя — дугой над ним.
    box(0.16, 0.03, 0.03, black, motor + 0.2, -0.02, 0.06),
    box(0.03, 0.03, 0.1, black, motor - 0.05, 0.02, 0.17),
    box(0.03, 0.14, 0.03, black, motor - 0.05, -0.04, 0.22),
  );
  // Руки — пока шары на рукоятях.
  for (const [x, y, z] of [[motor + 0.22, -0.02, 0.06], [motor - 0.05, -0.04, 0.22]]) {
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), skin);
    hand.position.set(x, y, z);
    hand.name = 'hand';
    saw.add(hand);
  }
  return saw;
}
