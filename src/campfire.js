import * as THREE from 'three';
import { buildEmberBed, coalAtlasUV, coalEmission } from './ember-bed.js';
import { Smoke } from './smoke.js';
import { decal, tiles } from './surface.js';

const [ash, flames] = tiles([
  'assets/textures/yard/campfire-ground-ash.webp',
  'assets/textures/yard/timber_yard_flames.png',
]);
ash.wrapS = ash.wrapT = flames.wrapS = flames.wrapT = THREE.ClampToEdgeWrapping;

const loader = new THREE.TextureLoader();
const [paint, heat, ashCrust] = await Promise.all(['coals-paint.webp', 'coals-heat.png', 'coals-ash.webp'].map(async name => {
  const map = await loader.loadAsync('assets/textures/yard/' + name);
  map.anisotropy = 4;
  return map;
}));
paint.colorSpace = ashCrust.colorSpace = THREE.SRGBColorSpace;
heat.colorSpace = THREE.NoColorSpace;

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
