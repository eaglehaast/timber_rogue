import * as THREE from 'three';
import { pointAt } from './maple.js';

export const HOLD_DROP_LOW = -0.32, PICK_RANGE = 3.6;

export function haulSpeed(wood) {
  return wood?.canDrag ? THREE.MathUtils.clamp(1 / (1 + wood.mass / 70), 0.3, 0.85) : 1;
}

// Ветка волочится по рельефу. Высоту задаёт нижняя точка её сучьев, даже если игрок смотрит вверх.
export function dragBranch(body, world, feet, forward, dt) {
  const blend = -Math.expm1(-8 * dt);
  const offset = world.root.position;
  const target = feet.clone().addScaledVector(forward, body.wood.holdDist).sub(offset);
  body.position.x = THREE.MathUtils.lerp(body.position.x, target.x, blend);
  body.position.z = THREE.MathUtils.lerp(body.position.z, target.z, blend);
  const axis = body.wood.cutDir.clone().applyQuaternion(body.quaternion);
  const heading = forward.clone().multiplyScalar(axis.dot(forward) < 0 ? -1 : 1);
  const turn = new THREE.Quaternion().setFromUnitVectors(axis, heading).multiply(body.quaternion);
  body.quaternion.slerp(turn, blend);
  const point = new THREE.Vector3();
  let support = -Infinity;
  for (const capsule of body.capsules) {
    for (const end of [capsule.a, capsule.b]) {
      point.copy(end).applyQuaternion(body.quaternion);
      const floor = world.height(offset.x + body.position.x + point.x, offset.z + body.position.z + point.z);
      support = Math.max(support, floor - offset.y - point.y + capsule.r);
    }
  }
  body.position.y = support;
  body.place();
}

// Анализирует любое игровое тело отпила (и ветки/верхушки с body.limb, и воксельные чурбаки/клинья из dropPiece в main.js).
export function classifyLimbBody(body) {
  if (body.limbs) {
    const mass = Math.round((1 / body.invMass) * 10) / 10;
    body.wood = {
      kind: 'tree', length: 3, cm: 300, radius: 0.2, mass, cutDir: new THREE.Vector3(0, 0, 1),
      twigs: 0, fitsPile: false, tooHeavy: true, holdDist: 1.8,
      title: `Поваленное дерево (${mass} кг)`,
      verdict: 'Бревно тяжёлое — распили на части!',
    };
    return body;
  }
  if (body.limb) {
    const { limb } = body;
    const mainPart = limb.parts[0];
    const p0 = pointAt(mainPart.axis, mainPart.from), p1 = pointAt(mainPart.axis, mainPart.to);
    const cutVec = p1.p.clone().sub(p0.p);
    const length = mainPart.to - mainPart.from;
    const cutDir = cutVec.lengthSq() > 1e-6 ? cutVec.normalize() : new THREE.Vector3(0, 0, 1);
    const radius = (p0.r + p1.r) / 2;
    const mass = Math.round(limb.weight.mass * 10) / 10;
    const cm = Math.round(length * 100);

    const sideParts = limb.parts.slice(1);
    const hasMajorFork = sideParts.some((p) => p.axis.joint === 'codominant' || (p.to - p.from) > 0.45 || pointAt(p.axis, p.from).r > 0.028);
    const isThickStem = radius >= 0.055;
    const isLog = isThickStem && !hasMajorFork;
    const minorTwigs = isLog ? sideParts.length : 0;

    // У ветви длина и вес влияют на способ переноски. Толстую заготовку из ствола сначала разделывают.
    const needsBranchTrim = isThickStem && hasMajorFork;
    const fromBranch = mainPart.axis.level > 0 && mainPart.axis.stem === undefined;
    const canRoll = isLog && cm <= 100 && mass > 30;
    const tooHeavy = !fromBranch && isThickStem && (cm > 100 || hasMajorFork && mass > 28);
    const canDrag = !tooHeavy && !canRoll && (cm > 100 || mass > 30);
    const fitsPile = isLog && cm >= 50 && cm <= 100;
    const kind = !isLog || canDrag ? (cm <= 40 && mass < 2.5 ? 'twig' : 'branch') : 'log';

    const title = tooHeavy
      ? (needsBranchTrim ? `Сдвоенное бревно / с сучьями (${cm} см, ${mass} кг)` : `Длинное бревно (${cm} см, ${mass} кг)`)
      : canRoll
        ? `Тяжёлое бревно (${cm} см, ${mass} кг)`
        : kind === 'twig'
          ? `Откушенная мелкая ветка с листвой (${cm} см)`
          : kind === 'branch'
            ? (needsBranchTrim ? `Ветвь с развилкой (${cm} см, ${mass} кг)` : `Ветвь клёна с листвой (~${cm} см, ${mass} кг)`)
            : minorTwigs > 0
              ? `Бревно с веточками (${cm} см, ${mass} кг)`
              : `Бревно (${cm} см, ${mass} кг)`;

    const verdict = canDrag ? 'Можно тащить по земле прямо к костру' : tooHeavy
      ? (needsBranchTrim ? 'Сначала отпили крупные боковые ветки / развилку!' : 'Бревно длиннее метра — распили на части!')
      : fitsPile
        ? (canRoll
          ? 'В поленницу (50–100 см) · тяжёлое — катим по земле как колесо'
          : minorTwigs > 0 ? 'В поленницу (50–100 см) · мелкие веточки с листвой откусятся для костра' : 'Подходит в поленницу (50–100 см)')
        : needsBranchTrim
          ? 'С развилкой в поленницу не ляжет — отпили сук или брось в костёр'
          : kind === 'twig'
            ? 'Мелкая ветка от полена → в костёр'
            : kind === 'branch'
              ? `Крупная ветка (${mass} кг) → в костёр (горит с дымом)`
              : `Короткий чурбак (${cm} см < 50 см) → пойдёт в костёр`;

    body.wood = {
      kind, length, cm, radius, mass, cutDir,
      twigs: minorTwigs, fitsPile, tooHeavy, canRoll, canDrag, needsBranchTrim,
      holdDist: kind === 'branch' ? THREE.MathUtils.clamp(1.6 + body.reach * 0.45, 1.7, 2.45) : 1.65,
      title, verdict,
    };
    return body;
  }

  // Воксельный кусок низа ствола (клин из подпила или отпиленный чурбак комля из dropPiece в main.js)
  body.object.updateMatrixWorld(true);
  const localBox = new THREE.Box3();
  body.object.traverse((child) => {
    if (!child.isMesh || !child.geometry) return;
    child.geometry.computeBoundingBox();
    if (child.geometry.boundingBox) {
      const b = child.geometry.boundingBox.clone();
      b.min.add(child.position);
      b.max.add(child.position);
      localBox.union(b);
    }
  });
  const size = localBox.isEmpty() ? new THREE.Vector3(0.3, 0.5, 0.3) : localBox.getSize(new THREE.Vector3());
  // На стоящем комле волокна идут вдоль Y, а ширина и глубина сечения — X и Z
  const length = size.y;
  const maxCross = Math.max(size.x, size.z), minCross = Math.max(0.04, Math.min(size.x, size.z));
  const isTwinBase = maxCross > minCross * 1.45 && maxCross > 0.42;
  const radius = Math.max(0.05, (size.x + size.z) / 4);
  const cutDir = new THREE.Vector3(0, 1, 0);
  const mass = Math.round((1 / body.invMass) * 10) / 10;
  const cm = Math.round(length * 100);
  const tooHeavy = isTwinBase || cm > 100;
  const canRoll = !tooHeavy && cm <= 100 && mass > 30;
  const fitsPile = !tooHeavy && cm >= 50 && cm <= 100 && radius >= 0.055;
  const kind = fitsPile ? 'log' : 'chunk';
  const title = isTwinBase
    ? `Сдвоенный комель (${cm} см, ${mass} кг)`
    : tooHeavy
      ? `Длинный комель (${cm} см, ${mass} кг)`
      : canRoll
        ? `Тяжёлый комель (${cm} см, ${mass} кг)`
        : fitsPile
          ? `Бревно комля (${cm} см, ${mass} кг)`
          : `Обрезок ствола (${cm} см, ${mass} кг)`;
  const verdict = isTwinBase
    ? 'Сдвоенное бревно — сначала раздели стволы пилой!'
    : tooHeavy
      ? 'Бревно длиннее метра — распили на части!'
      : fitsPile
        ? (canRoll ? 'В поленницу (50–100 см) · тяжёлое — катим как колесо' : 'Подходит в поленницу (50–100 см)')
        : `Короткий кусок (${cm} см < 50 см) → пойдёт в костёр`;

  body.wood = {
    kind, length, cm, radius, mass, cutDir,
    twigs: 0, fitsPile, tooHeavy, canRoll,
    holdDist: 1.65,
    title, verdict,
  };
  return body;
}
