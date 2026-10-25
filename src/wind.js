import * as THREE from 'three';

// Ветер двора: один на всех — деревья, траву. Дует в сторону dir, налетает порывами.
// Порыв — сумма несоизмеримых волн, обрезанная снизу, от 0 до 1. Он бежит по двору со скоростью
// SPEED: в точке p ветер такой, какой был на начале координат dot(p, dir) / SPEED секунд назад.
const SPEED = 5; // м/с
const WAVES = [[0.31, 1, 1], [0.87, 2, 0.5], [2.3, 0, 0.3]]; // частота, сколько раз фаза ветра, вес
const SUM = WAVES.reduce((s, [, , w]) => s + w, 0);

export const wind = { dir: new THREE.Vector3(), max: 0, phase: 0, time: 0 };

export function blow(az, max, phase) {
  wind.dir.set(Math.cos(az), 0, -Math.sin(az));
  Object.assign(wind, { max, phase });
}

export function gust(p) {
  const t = wind.time - (p.x * wind.dir.x + p.z * wind.dir.z) / SPEED;
  return Math.max(0, WAVES.reduce((g, [f, k, w]) => g + w * Math.sin(f * t + k * wind.phase), 0)) / SUM;
}

// Тот же порыв для шейдера: uniforms подключить к материалу, GLSL вставить в его код.
export const windUniforms = {
  windDir: { value: new THREE.Vector2() }, windMax: { value: 0 }, windPhase: { value: 0 }, windTime: { value: 0 },
};
export const GUST_GLSL = `
  uniform vec2 windDir;
  uniform float windMax, windPhase, windTime;
  float gust(vec2 p) {
    float t = windTime - dot(p, windDir) / ${SPEED.toFixed(1)};
    return max(0.0, ${WAVES.map(([f, k, w]) => `${w.toFixed(2)} * sin(${f.toFixed(2)} * t + ${k.toFixed(1)} * windPhase)`).join(' + ')}) / ${SUM.toFixed(3)};
  }`;

export function stepWind(dt) {
  wind.time += dt;
  windUniforms.windDir.value.set(wind.dir.x, wind.dir.z);
  windUniforms.windMax.value = wind.max;
  windUniforms.windPhase.value = wind.phase;
  windUniforms.windTime.value = wind.time;
}
