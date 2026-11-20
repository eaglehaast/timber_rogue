import * as THREE from 'three';
import { buildEmberBed } from './ember-bed.js';
import { Smoke } from './smoke.js';
import { tiles } from './surface.js';

const [ash, char, bed, flames] = tiles([
  'assets/textures/yard/timber_yard_ash_decal.png',
  'assets/textures/yard/timber_yard_charred_bark.jpg',
  'assets/textures/yard/timber_yard_ember_bed.webp',
  'assets/textures/yard/timber_yard_flames.png',
]);
ash.wrapS = ash.wrapT = flames.wrapS = flames.wrapT = THREE.ClampToEdgeWrapping;

export function buildCampfire(origin, side, rnd) {
  const group = new THREE.Group();
  group.position.copy(origin);
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(side, side), new THREE.MeshLambertMaterial({
    map: ash, color: 0xbdb4b7, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1,
  }));
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = 0.009;
  apron.receiveShadow = true;
  const coals = buildEmberBed({ bed, char, ash }, rnd);
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
  function coating(original, leaf) {
    const mat = original.clone();
    mat.customProgramCacheKey = () => 'campfire-' + original.customProgramCacheKey() + (leaf ? '-leaf' : '-wood');
    mat.onBeforeCompile = (shader, renderer) => {
      original.onBeforeCompile(shader, renderer);
      shader.uniforms.woodBurn = burn;
      shader.uniforms.woodCenter = { value: limb.weight.com };
      shader.uniforms.woodRadius = { value: Math.max(0.01, reach) };
      shader.vertexShader = 'uniform vec3 woodCenter; uniform float woodRadius; varying float woodEdge;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        woodEdge = min(1., length(position - woodCenter) / woodRadius);`);
      shader.uniforms.coalBark = { value: char };
      shader.fragmentShader = 'uniform float woodBurn; uniform sampler2D coalBark; varying float woodEdge;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
        float grain = sqrt(texture2D(coalBark, vMapUv * vec2(0.74, 0.37)).r);
        float scorch = smoothstep(0.02, 0.53, woodBurn + (0.24 - grain) * 0.85);
        outgoingLight = mix(outgoingLight, vec3(0.011, 0.008, 0.012) + grain * grain * 0.28, scorch);
        ${leaf ? 'if (woodBurn > 0.16 + grain * 0.75) discard;' : `
          float remaining = 1.10 - 1.27 * smoothstep(0.52, 1., woodBurn);
          if (woodEdge + (0.28 - grain) * 0.25 > remaining) discard;
          float crack = (1. - smoothstep(0.12, 0.31, grain)) * smoothstep(0.27, 0.70, woodBurn);
          outgoingLight = mix(outgoingLight, vec3(0.82, 0.075, 0.009), crack);
        `}
        #include <opaque_fragment>`);
    };
    owned.push(mat);
    return mat;
  }
  const [wood, leaves] = limb.meshes;
  wood.material = wood.material.map(m => coating(m, false));
  leaves.material = coating(leaves.material, true);
  leaves.castShadow = false;
  return { burn, dispose() { for (const m of owned) m.dispose(); } };
}
