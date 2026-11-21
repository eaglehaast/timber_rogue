import * as THREE from 'three';
import { buildEmberBed, coalAtlasUV, coalEmission, isOnEmberBed } from './ember-bed.js';
import { Smoke } from './smoke.js';
import { decal, tiles, soften } from './surface.js';
import { pointAt } from './maple.js';
import { Limb } from './limbs.js';
import { generator } from './random.js';

export const HOLD_DROP_LOW = -0.32, PICK_RANGE = 3.6;
export const PAVING_POS = new THREE.Vector3(-1.6, 0, -2.1), PAVING_HALF = { x: 6.6, z: 2.15 };
export const PILE_POS = new THREE.Vector3(0, 0, -3.2), PILE_SIZE = { w: 2.4, d: 1.15, h: 1.85 };
export const FIRE_POS = new THREE.Vector3(3.2, 0, -2.3), FIRE_SIDE = 2.7;

const [ash, flames, paint, heat, ashCrust, pavingTex, fenceBoardMap] = tiles([
  'assets/textures/yard/campfire-ground-ash.webp',
  'assets/textures/yard/timber_yard_flames.png',
  'assets/textures/yard/coals-paint.webp',
  'assets/textures/yard/coals-heat.png',
  'assets/textures/yard/coals-ash.webp',
  'assets/textures/yard/timber_yard_paving_01.jpg',
  'assets/textures/fence-board-1.jpg',
]);
ash.wrapS = ash.wrapT = flames.wrapS = flames.wrapT = THREE.ClampToEdgeWrapping;
paint.wrapS = paint.wrapT = heat.wrapS = heat.wrapT = ashCrust.wrapS = ashCrust.wrapT = THREE.ClampToEdgeWrapping;
heat.colorSpace = THREE.NoColorSpace;

const FENCE_COLOR = 'vec3(0.12, 0.11, 0.1)', FENCE_PAINT = 'vec3(0.067, 0.24, 0.63)';
function makeFenceBoardMaterial() {
  const mat = new THREE.MeshLambertMaterial({ map: fenceBoardMap });
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      float fenceLuma = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
      diffuseColor.rgb = ${FENCE_COLOR} * fenceLuma / dot(${FENCE_PAINT}, vec3(0.299, 0.587, 0.114));`);
  };
  mat.customProgramCacheKey = () => 'woodpile-fence-board';
  return mat;
}
export const boardMat = makeFenceBoardMaterial();

export function makeBoardBox(sx, sy, sz) {
  const geo = new THREE.BoxGeometry(sx, sy, sz);
  const uv = geo.attributes.uv;
  const span = Math.max(sx, sy, sz);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i), uv.getY(i) * (span / 0.7));
  return geo;
}

export function makeYardPaving() {
  const W = PAVING_HALF.x * 2, D = PAVING_HALF.z * 2;
  const map = pavingTex.clone();
  map.repeat.set(W / 2.0, D / 2.0);
  const mat = soften(new THREE.MeshLambertMaterial({ map, color: 0xffffff }), {
    contrast: 0.88, saturation: 0.75, scales: [0.15, 0.5], low: [0.92, 0.9, 0.86], high: [1.06, 1.05, 1.02], cells: [1, 1],
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(W, D), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(PAVING_POS.x, 0.004, PAVING_POS.z);
  mesh.receiveShadow = true;
  return { mesh, mat };
}

export function buildBackFence() {
  const group = new THREE.Group();
  const z = -4.25, startX = -9.2, endX = 5.2, step = 0.13;
  for (const h of [0.45, 1.35]) {
    const rail = new THREE.Mesh(makeBoardBox(endX - startX, 0.07, 0.04), boardMat);
    rail.position.set((startX + endX) / 2, h, z - 0.035);
    rail.castShadow = true;
    group.add(rail);
  }
  for (let x = startX; x <= endX; x += step) {
    const h = 1.75 + Math.sin(x * 3.7) * 0.04;
    const picket = new THREE.Mesh(makeBoardBox(0.10, h, 0.025), boardMat);
    picket.position.set(x, h / 2, z);
    picket.castShadow = picket.receiveShadow = true;
    group.add(picket);
  }
  return group;
}

export function buildWoodpileFrame(pos = PILE_POS) {
  const group = new THREE.Group();
  const { w: W, d: D, h: H } = PILE_SIZE, T = 0.045;
  const roofPitch = 0.08, roofMidY = H + 0.06;
  const roofYAt = (z) => roofMidY - z * Math.tan(roofPitch);
  const box = (w, h, d, x, y, z, rx = 0) => {
    const m = new THREE.Mesh(makeBoardBox(w, h, d), boardMat);
    m.position.set(x, y, z);
    m.rotation.x = rx;
    m.castShadow = m.receiveShadow = true;
    group.add(m);
  };
  box(W, 0.08, 0.1, 0, 0.04, -D * 0.38);
  box(W, 0.08, 0.1, 0, 0.04, D * 0.38);
  for (let i = -2; i <= 2; i++) box(W - 0.04, T, 0.19, 0, 0.08 + T / 2, i * 0.21);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const zPost = sz * (D / 2 - 0.045), hPost = roofYAt(zPost) - T * 0.5;
      box(0.09, hPost, 0.09, sx * (W / 2 - 0.045), hPost / 2, zPost);
    }
    for (let h = 0.26; h <= H - 0.12; h += 0.26) box(T, 0.16, D - 0.06, sx * (W / 2 - T / 2), h, 0);
    box(0.08, 0.07, D + 0.08, sx * (W / 2 - 0.045), roofMidY - 0.03, 0, roofPitch);
  }
  const zBackPost = -D / 2 + 0.045, hBackPost = roofYAt(zBackPost) - T * 0.5;
  box(0.09, hBackPost, 0.09, 0, hBackPost / 2, zBackPost);
  for (const h of [0.45, 0.95, 1.45, hBackPost - 0.08]) box(W, 0.14, T, 0, h, -D / 2 + T / 2);
  for (let i = -2; i <= 2; i++) {
    const z = i * 0.23;
    box(W + 0.2, T, 0.24, 0, roofYAt(z), z, roofPitch);
  }
  group.position.copy(pos);
  return group;
}

export function buildCampfire(origin, side, rnd) {
  const group = new THREE.Group();
  group.position.copy(origin);
  const ashMaterial = decal(ash);
  ashMaterial.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      float ashEdge = smoothstep(0.52, 1.02, length(vMapUv * 2. - 1.));
      diffuseColor.a *= 1. - 0.72 * ashEdge;`);
  };
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(side * 1.42, side * 1.31), ashMaterial);
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = 0.009;
  apron.receiveShadow = true;
  const coals = buildEmberBed({ paint, heat, ash: ashCrust }, rnd);
  group.add(apron, coals.root);

  const vents = [[-0.52, 0.04], [0.21, -0.35], [0.47, 0.19], [-0.15, 0.33], [-0.29, -0.27], [0,0], [0,0], [0,0]];
  const tongues = vents.map(([x,z], i) => {
    const map = flames.clone();
    map.repeat.set(0.25, 0.5);
    map.offset.set(i % 4 * 0.25, i < 4 ? 0.5 : 0);
    const flame = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false, toneMapped: false }));
    flame.center.set(0.5, 0.09);
    group.add(flame);
    return { flame, x, z, phase: rnd(), speed: 0.31 + rnd() * 0.37, size: 0.19 + rnd() * 0.18 };
  });
  const smoke = new Smoke(new THREE.Vector3(0, 0.39, 0), rnd);
  const light = new THREE.PointLight(0xff823a, 1.1, 4.3);
  light.position.set(0, 0.60, 0);
  group.add(smoke, light);

  // Искры живут одним коротким залпом, только при касании свежей ветки.
  const sparkCount = 9, coords = new Float32Array(sparkCount * 3);
  const geometry = new THREE.BufferGeometry();
  const points = new THREE.BufferAttribute(coords, 3).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', points);
  const sparkMaterial = new THREE.PointsMaterial({ size: 0.015, color: 0xffc476, transparent: true, depthWrite: false });
  const sparks = new THREE.Points(geometry, sparkMaterial);
  sparks.frustumCulled = false;
  sparks.visible = false;
  group.add(sparks);
  const velocities = Array.from({ length: sparkCount }, () => new THREE.Vector3());
  const landing = new THREE.Vector2();
  let boost = 0, sparkAge = 1;

  function ignite(x, z) {
    coals.ignite(x, z);
    landing.set(x, z);
    sparks.position.set(x, coals.heightAt(x, z), z);
    for (const v of velocities) v.set((rnd() - 0.5) * 0.50, 0.40 + rnd() * 0.77, (rnd() - 0.5) * 0.50);
    sparkAge = 0;
  }
  function tick(dt, time, burning) {
    coals.tick(dt, time);
    boost += ((burning ? 1 : 0) - boost) * -Math.expm1(-2.6 * dt);
    smoke.top.set(landing.x * boost, coals.heightAt(landing.x * boost, landing.y * boost) + 0.06, landing.y * boost);
    smoke.tick(dt);
    for (const { sprite } of smoke.puffs) {
      sprite.material.opacity *= 0.12 + boost * 0.67;
      sprite.scale.multiplyScalar(0.49 + boost * 0.33);
      sprite.visible = sprite.material.opacity > 0.012;
    }
    light.intensity = (0.90 + 0.10 * Math.sin(time * 2.8)) * (1 + 0.75 * boost);
    tongues.forEach(({ flame, x, z, phase, speed, size }, i) => {
      const fuel = i >= 5;
      if (fuel) {
        x = landing.x + (i - 6) * 0.12;
        z = landing.y + Math.sin(i * 4) * 0.09;
      }
      const cycle = (time * speed + phase) % 1, envelope = Math.sin(cycle * Math.PI) ** 1.4;
      const opacity = envelope * (fuel ? boost * 0.89 : 0.73);
      flame.visible = opacity > 0.07;
      if (!flame.visible) return;
      const h = size * (0.6 + envelope * 0.66) * (fuel ? 1.85 : 1 + 0.18 * boost);
      flame.position.set(x + 0.018 * Math.sin(time * 3.9 + i), coals.heightAt(x,z) - 0.026, z);
      flame.scale.set(h * (0.57 + 0.13 * Math.sin(time * 2.2 + i)), h, 1);
      flame.material.rotation = 0.09 + 0.12 * Math.sin(time * 2.1 + phase * 13);
      flame.material.opacity = opacity;
    });
    sparkAge += dt;
    sparks.visible = sparkAge < 0.78;
    if (sparks.visible) {
      velocities.forEach((v, i) => points.setXYZ(i, v.x * sparkAge, v.y * sparkAge - 0.42 * sparkAge ** 2, v.z * sparkAge));
      points.needsUpdate = true;
      sparkMaterial.opacity = 1 - sparkAge / 0.78;
    }
  }
  function reset() {
    coals.reset();
    boost = 0;
    sparkAge = 1;
    landing.set(0, 0);
  }
  return { group, heightAt: coals.heightAt, ignite, deposit: coals.deposit, tick, reset };
}

// Материалы на дереве и в поленнице общие. Обгорает только принятая ветка.
export function scorchLimb(limb, reach) {
  if (!limb) return { burn: { value: 0 }, dispose() {} };
  const burn = { value: 0 }, owned = [];
  const variety = Math.floor(17 * limb.weight.mass + limb.parts[0].from * 29);
  function coating(original, part) {
    const mat = original.clone(), leaf = part === 'leaf', end = part === 'end';
    mat.customProgramCacheKey = () => 'campfire-' + original.customProgramCacheKey() + '-' + part;
    mat.onBeforeCompile = (shader, renderer) => {
      original.onBeforeCompile(shader, renderer);
      shader.uniforms.woodBurn = burn;
      shader.uniforms.woodCenter = { value: limb.weight.com };
      shader.uniforms.woodRadius = { value: Math.max(0.01, reach) };
      shader.vertexShader = 'uniform vec3 woodCenter; uniform float woodRadius; varying float woodEdge; varying vec2 woodUV;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        woodEdge = min(1., length(position - woodCenter) / woodRadius);
        woodUV = ${end ? '0.5 + 0.47 * (1. - uv.y) * vec2(cos(uv.x * 6.283185), sin(uv.x * 6.283185))' : 'uv'};`);
      shader.fragmentShader = 'uniform float woodBurn; varying float woodEdge; varying vec2 woodUV;\n' + shader.fragmentShader;
      if (leaf) {
        shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
          float grain = sqrt(dot(diffuseColor.rgb, vec3(0.28, 0.53, 0.19)));
          if (woodBurn > 0.16 + grain * 0.75) discard;
          outgoingLight = mix(outgoingLight, vec3(0.019, 0.012, 0.014), smoothstep(0.03, 0.41, woodBurn));
          #include <opaque_fragment>`);
        return;
      }
      shader.uniforms.coalPaint = { value: paint };
      shader.uniforms.coalHeat = { value: heat };
      shader.uniforms.coalTile = { value: end ? 6 + variety % 4 : variety % 6 };
      shader.fragmentShader = 'uniform sampler2D coalPaint, coalHeat; uniform float coalTile;\n'
        + coalAtlasUV + coalEmission + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
        vec2 st = ${end ? 'woodUV' : '1. - abs(mod(woodUV * vec2(1.25, 1.12), 2.) - 1.)'};
        vec2 at = coalCell(coalTile, st, vec2(4., 3.));
        vec3 chip = texture2D(coalPaint, at).rgb;
        float mask = texture2D(coalHeat, at).r;
        float grain = sqrt(dot(chip, vec3(0.28, 0.53, 0.19)));
        float remaining = 1.12 - 1.32 * smoothstep(0.52, 1., woodBurn);
        if (woodEdge + (0.28 - grain) * 0.25 > remaining) discard;
        float scorch = smoothstep(0.03, 0.59, woodBurn + (0.27 - grain) * 0.60);
        float opening = smoothstep(0.26, 0.77, woodBurn);
        outgoingLight = mix(outgoingLight, chip * 0.78 + opening * incandescence(mask, 0.27 + opening * 0.79), scorch);
        #include <opaque_fragment>`);
    };
    owned.push(mat);
    return mat;
  }
  const [wood, leaves] = limb.meshes;
  wood.material = wood.material.map((m, i) => coating(m, i === 1 ? 'end' : 'grain'));
  leaves.material = coating(leaves.material, 'leaf');
  leaves.castShadow = false;
  return { burn, dispose() { for (const m of owned) m.dispose(); } };
}

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

// Единый контроллер хоздвора (плитняк + поленница + костёр) — работает одинаково на стенде (wood-stand.js) и в игре (main.js).
export function createWoodyard({ scene, origin = new THREE.Vector3(), yaw = 0, withFence = true, rnd = generator(42), onNotice = () => {}, onPileCount = () => {} }) {
  const root = new THREE.Group();
  root.position.copy(origin);
  root.rotation.y = yaw;
  scene.add(root);

  const paving = makeYardPaving();
  root.add(paving.mesh);
  if (withFence) root.add(buildBackFence());

  const campfire = buildCampfire(FIRE_POS, FIRE_SIDE, generator(394));
  root.add(campfire.group);
  const fire = campfire.group.position;
  let pileDirection = 1;

  function placeByGate(origin, side) {
    root.position.copy(origin);
    root.rotation.y = Math.PI;
    pileDirection = side;
    paving.mesh.position.x = PAVING_POS.x * side;
    fire.x = FIRE_POS.x * side;
    root.updateMatrixWorld(true);
  }

  const PILE_COLS = 10, PILE_ROWS = 8, SLOT_R = 0.105;
  const piles = [], flyingLogs = [], burningItems = [], stackedObjects = [];

  function updateCount() {
    const count = piles.reduce((sum, pile) => sum + pile.count, 0);
    onPileCount(count, piles.length);
  }

  function addNewWoodpile() {
    const idx = piles.length, pos = PILE_POS.clone();
    pos.x -= pileDirection * idx * (PILE_SIZE.w + 0.22);
    const frame = buildWoodpileFrame(pos);
    root.add(frame);
    const slots = [], innerLeft = pos.x - PILE_SIZE.w / 2 + 0.15 + SLOT_R;
    const baseY = 0.125 + SLOT_R, rowDy = SLOT_R * 1.74, zCenter = pos.z;
    for (let r = 0; r < PILE_ROWS; r++) {
      const odd = r % 2 === 1, cols = odd ? PILE_COLS - 1 : PILE_COLS, xOff = odd ? SLOT_R : 0;
      for (let c = 0; c < cols; c++) {
        slots.push({ x: innerLeft + xOff + c * (SLOT_R * 2.02), y: baseY + r * rowDy, zCenter });
      }
    }
    const pile = { index: idx + 1, pos, frame, slots, count: 0 };
    piles.push(pile);
    return pile;
  }

  function removeWood(object) {
    object.removeFromParent();
    object.traverse((child) => child.geometry?.dispose());
  }

  function removeFuel(fuel) {
    removeWood(fuel.object);
    fuel.coating?.dispose();
  }

  function reset() {
    while (piles.length) removeWood(piles.pop().frame);
    while (stackedObjects.length) removeWood(stackedObjects.pop());
    while (burningItems.length) removeFuel(burningItems.pop());
    campfire.reset();
    flyingLogs.length = 0;
    addNewWoodpile();
    updateCount();
  }
  reset();

  function dropZoneAt(worldPos) {
    root.updateMatrixWorld();
    const local = root.worldToLocal(worldPos.clone());
    if (isOnEmberBed(local.x - fire.x, local.z - fire.z)) return 'embers';
    if (Math.abs(local.x - paving.mesh.position.x) <= PAVING_HALF.x && Math.abs(local.z - paving.mesh.position.z) <= PAVING_HALF.z) return 'paving';
    return null;
  }

  function canWalk(wx, wz) {
    root.updateMatrixWorld();
    const local = root.worldToLocal(new THREE.Vector3(wx, root.position.y, wz));
    const fireBlock = FIRE_SIDE * 0.46 + 0.35;
    return !(Math.abs(local.x - fire.x) < fireBlock && Math.abs(local.z - fire.z) < fireBlock);
  }

  function clampPlayer(pos) {
    root.updateMatrixWorld();
    const local = root.worldToLocal(pos.clone());
    const fireBlock = FIRE_SIDE * 0.46 + 0.35;
    const fdx = local.x - fire.x, fdz = local.z - fire.z;
    if (Math.abs(fdx) < fireBlock && Math.abs(fdz) < fireBlock) {
      if (fireBlock - Math.abs(fdx) < fireBlock - Math.abs(fdz)) {
        local.x = fire.x + (fdx >= 0 ? fireBlock : -fireBlock);
      } else {
        local.z = fire.z + (fdz >= 0 ? fireBlock : -fireBlock);
      }
      pos.copy(root.localToWorld(local));
    }
  }

  function sendToCampfire(body, customNotice = null) {
    if (!body.wood) classifyLimbBody(body);
    root.updateMatrixWorld();
    root.attach(body.object);
    const startLocalPos = body.object.position.clone();
    const startLocalQuat = body.object.quaternion.clone();

    const local = new THREE.Vector2(startLocalPos.x - fire.x, startLocalPos.z - fire.z);
    if (local.lengthSq() > 1.3 ** 2) local.set((rnd() - 0.5) * 0.87, (rnd() - 0.5) * 0.74);
    local.clampLength(0, 0.68);
    const support = campfire.heightAt(local.x, local.y);
    const targetPos = new THREE.Vector3(fire.x + local.x, support + body.wood.radius, fire.z + local.y);
    const fYaw = rnd() * Math.PI * 2;
    const targetQuat = new THREE.Quaternion().setFromUnitVectors(body.wood.cutDir, new THREE.Vector3(Math.cos(fYaw), 0, Math.sin(fYaw)));

    burningItems.push({
      object: body.object, limb: body.limb, mass: body.wood.mass, local,
      length: body.wood.length, reach: body.reach ?? body.wood.length / 2, yaw: fYaw,
      fromPos: startLocalPos, fromQuat: startLocalQuat, toPos: targetPos, toQuat: targetQuat,
      flyT: 0, flyDuration: 0.48, burnT: 0, burnDuration: body.wood.kind === 'twig' ? 4.2 : 6.8,
      coating: null, deposited: false,
    });
    onNotice(customNotice || `В костёр: ${body.wood.title}`);
  }

  function acceptLogIntoWoodpile(body) {
    if (!body.wood) classifyLimbBody(body);
    root.updateMatrixWorld();
    root.attach(body.object);
    const startLocalPos = body.object.position.clone();
    const startLocalQuat = body.object.quaternion.clone();

    let snippedNote = '';
    if (body.limb) {
      if (body.limb.parts.length > 1) {
        const sideParts = body.limb.parts.slice(1);
        const sideCards = body.limb.cards;
        const twigLimb = new Limb(sideParts, sideCards, {
          skin: body.limb.skin,
          cloud: body.limb.cloud,
          zone: 0,
        }).dress();
        const twigObj = new THREE.Group();
        twigLimb.group.position.copy(twigLimb.weight.com).negate();
        twigLimb.group.quaternion.identity();
        twigObj.add(twigLimb.group);
        twigObj.position.copy(startLocalPos);
        twigObj.quaternion.copy(startLocalQuat);
        root.add(twigObj);
        const twigFakeBody = { object: twigObj, limb: twigLimb, reach: 0.35, invMass: 1 / Math.max(0.5, twigLimb.weight.mass) };
        classifyLimbBody(twigFakeBody);
        sendToCampfire(twigFakeBody);
        snippedNote = ' · мелкие веточки с листвой улетели в костёр';
      }
      // Сбрасываем возможный отщеп/жёлоб (tongue / groove) и закрываем оба торца, чтобы в поленнице лежало цельное круглое полено
      const cleanPart = { ...body.limb.parts[0], tongue: null, groove: null, cutFrom: true, cutTo: true };
      body.limb.parts = [cleanPart];
      body.limb.cards = [];
      body.limb.dress();
      body.limb.group.position.copy(body.limb.weight.com).negate();
      classifyLimbBody(body);
    }

    // Если полено толще ячейки поленницы (например, толстый комель у корня), аккуратно подгоняем его поперечник под соту SLOT_R,
    // чтобы оно не проваливалось сквозь настил и не пересекало соседние брёвна
    if (body.wood.radius > SLOT_R * 1.04) {
      const s = SLOT_R / body.wood.radius;
      const d = body.wood.cutDir;
      body.object.scale.set(
        Math.abs(d.x) > 0.7 ? 1 : s,
        Math.abs(d.y) > 0.7 ? 1 : s,
        Math.abs(d.z) > 0.7 ? 1 : s,
      );
    }

    let pile = piles[piles.length - 1];
    if (pile.count >= pile.slots.length) pile = addNewWoodpile();
    const slot = pile.slots[pile.count++];
    const spawnedNext = pile.count >= pile.slots.length;
    if (spawnedNext) addNewWoodpile();

    const targetPos = new THREE.Vector3(slot.x, slot.y, slot.zCenter);
    const alignToZ = new THREE.Quaternion().setFromUnitVectors(body.wood.cutDir, new THREE.Vector3(0, 0, 1));
    const rollQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), (rnd() - 0.5) * Math.PI * 2);
    const targetQuat = rollQuat.multiply(alignToZ);

    stackedObjects.push(body.object);
    flyingLogs.push({
      object: body.object,
      fromPos: startLocalPos,
      fromQuat: startLocalQuat,
      toPos: targetPos,
      toQuat: targetQuat,
      t: 0,
      duration: 0.42,
    });

    updateCount();
    onNotice(
      spawnedNext
        ? `Поленница #${pile.index} заполнена! Рядом появилась новая поленница #${pile.index + 1}${snippedNote}`
        : `Полено ${body.wood.cm} см уложено в поленницу #${pile.index} срезом к нам${snippedNote}`,
    );
  }

  function acceptDroppedBody(body, zone) {
    if (!body.wood) classifyLimbBody(body);
    if (zone === 'paving' && body.wood.fitsPile) acceptLogIntoWoodpile(body);
    else sendToCampfire(body);
  }

  let elapsed = 0;
  function tick(dt) {
    elapsed += dt;
    for (let i = flyingLogs.length - 1; i >= 0; i--) {
      const f = flyingLogs[i];
      f.t = Math.min(1, f.t + dt / f.duration);
      const ease = 1 - (1 - f.t) ** 3;
      f.object.position.lerpVectors(f.fromPos, f.toPos, ease);
      f.object.position.y += Math.sin(ease * Math.PI) * 0.25;
      f.object.quaternion.slerpQuaternions(f.fromQuat, f.toQuat, ease);
      if (f.t >= 1) flyingLogs.splice(i, 1);
    }

    let lit = false;
    for (let i = burningItems.length - 1; i >= 0; i--) {
      const b = burningItems[i];
      if (b.flyT < 1) {
        b.flyT = Math.min(1, b.flyT + dt / b.flyDuration);
        const ease = 1 - (1 - b.flyT) ** 3;
        b.object.position.lerpVectors(b.fromPos, b.toPos, ease);
        b.object.position.y += Math.sin(ease * Math.PI) * 0.45;
        b.object.quaternion.slerpQuaternions(b.fromQuat, b.toQuat, ease);
      } else {
        b.burnT += dt / b.burnDuration;
        const p = Math.min(1, b.burnT);
        if (!b.coating) {
          b.coating = scorchLimb(b.limb, b.reach);
          campfire.ignite(b.local.x, b.local.y);
        }
        lit = true;
        b.coating.burn.value = p;
        const collapse = THREE.MathUtils.smoothstep(p, 0.47, 1);
        const scale = 1 - 0.22 * collapse;
        b.object.scale.setScalar(scale);
        b.object.position.y = b.toPos.y - collapse * 0.095;
        if (!b.deposited && p >= 0.82) {
          campfire.deposit(b.local.x, b.local.y, b.mass, b.yaw, b.length);
          b.deposited = true;
        }
        if (p >= 1) {
          removeFuel(b);
          onNotice('Древесина прогорела. На месте излома осели свежие угли.', 2700);
          burningItems.splice(i, 1);
        }
      }
    }

    campfire.tick(dt, elapsed, lit);
  }

  return {
    root,
    paving,
    campfire,
    piles,
    placeByGate,
    dropZoneAt,
    canWalk,
    clampPlayer,
    sendToCampfire,
    acceptLogIntoWoodpile,
    acceptDroppedBody,
    tick,
    reset,
  };
}
