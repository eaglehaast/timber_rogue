const LABELS = {
  world: 'Небо и панорама', house: 'Постройка дома', terrain: 'Рельеф и план участка',
  banya: 'Баня и тропы', meadow: 'Земля и трава', yard: 'Остальной двор',
  fence: 'Забор', utilities: 'Газ и электросеть', road: 'Дорога', land: 'Окрестности',
  river: 'Река и мостки', field: 'Поле', paths: 'Постройка троп',
  trees: 'Создание деревьев', compile: 'Подготовка шейдеров', first: 'Первый кадр',
  hud: 'Интерфейс', modules: 'Загрузка модулей и сборка двора',
  textures: 'Ожидание текстур', images: 'Декодирование интерфейса',
};

export class PerformanceMonitor {
  constructor(now = () => performance.now()) {
    this.now = now;
    this.stages = new Map();
    this.lastFrame = null;
    this.samples = [];
    this.lastSpike = null;
    this.previousParts = null;
    this.readyAt = null;
    this.textureWaitTimedOut = false;
  }

  measure(name, fn) {
    const start = this.now();
    try { return fn(); } finally { this.stages.set(name, this.now() - start); }
  }

  async measureAsync(name, fn) {
    const start = this.now();
    try { return await fn(); } finally { this.stages.set(name, this.now() - start); }
  }

  frame(now, parts, stats, visible = true) {
    const interval = this.lastFrame === null ? 0 : now - this.lastFrame;
    this.lastFrame = visible ? now : null;
    const previousParts = this.previousParts;
    this.previousParts = visible ? parts : null;
    while (this.samples[0]?.now < now - 10000) this.samples.shift();
    if (!visible || interval <= 0 || interval > 5000) return;
    const sample = { now, interval, parts, stats };
    this.samples.push(sample);
    while (this.samples.length > 600 || this.samples[0]?.now < now - 10000) this.samples.shift();
    if (interval >= 100 && previousParts) this.lastSpike = { interval, parts: previousParts };
  }

  snapshot() {
    const samples = this.samples;
    const total = samples.reduce((sum, sample) => sum + sample.interval, 0);
    return {
      fps: total ? 1000 * samples.length / total : null,
      worst: samples.length ? Math.max(...samples.map((sample) => sample.interval)) : null,
      freezes: samples.filter((sample) => sample.interval >= 100).length,
      latest: samples.at(-1) ?? null,
      lastSpike: this.lastSpike,
    };
  }
}

export const performanceMonitor = new PerformanceMonitor();

export function showPerformancePanel(monitor = performanceMonitor) {
  const panel = document.querySelector('#performance');
  const summary = panel.querySelector('summary'), content = panel.querySelector('pre');
  panel.hidden = false;
  let slowResources = [];
  function update() {
    const { fps, worst, freezes, latest, lastSpike } = monitor.snapshot();
    const stages = [...monitor.stages.entries()].sort((a, b) => b[1] - a[1]);
    const names = { game: 'игра', world: 'мир', render: 'сцена', rays: 'лучи' };
    const busiest = latest && Object.entries(latest.parts).sort((a, b) => b[1] - a[1])[0];
    summary.textContent = monitor.readyAt === null
      ? `Диагностика · ${stages.length ? `${LABELS[stages[0][0]] ?? stages[0][0]} ${(stages[0][1] / 1000).toFixed(1)} с` : 'загрузка'}`
      : fps === null ? 'Диагностика · ожидание кадров'
        : `${Math.round(fps)} FPS · макс. ${Math.round(worst)} мс · CPU: ${names[busiest[0]]}`;
    const lines = [
      monitor.readyAt === null ? 'Загрузка ещё идёт' : `До отправки первого кадра: ${(monitor.readyAt / 1000).toFixed(1)} с`,
      ...stages.map(([name, ms]) => `${LABELS[name] ?? name}: ${(ms / 1000).toFixed(2)} с`),
      'Модули включают сборку двора; этапы нельзя складывать.',
    ];
    if (monitor.textureWaitTimedOut) lines.push('Ожидание текстур прервано через 5 с: часть могла догружаться после старта.');
    if (monitor.readyAt !== null) {
      lines.push('', `Последние 10 с: ${fps === null ? 'нет кадров' : `${Math.round(fps)} FPS · максимум ${Math.round(worst)} мс · пауз ≥100 мс: ${freezes}`}`);
      if (latest) {
        const { parts, stats } = latest;
        lines.push(`CPU: игра ${parts.game.toFixed(1)} · мир ${parts.world.toFixed(1)} · сцена ${parts.render.toFixed(1)} · лучи ${parts.rays.toFixed(1)} мс`,
          `Вызовы рисования: ${stats.calls} · треугольники: ${stats.triangles.toLocaleString('ru-RU')}`,
          `Геометрии: ${stats.geometries} · текстуры: ${stats.textures}`);
      }
      if (lastSpike) {
        const parts = Object.entries(lastSpike.parts).sort((a, b) => b[1] - a[1]);
        lines.push(`Последняя пауза: ${Math.round(lastSpike.interval)} мс; до неё CPU: ${names[parts[0][0]]} ${parts[0][1].toFixed(1)} мс`);
      }
      lines.push('CPU — время вызовов, не время GPU. Пауза может быть вне игрового кода.');
      if (slowResources.length) lines.push('', 'Долгие запросы (включая ожидание сети):', ...slowResources);
    }
    content.textContent = lines.join('\n');
  }
  document.addEventListener('visibilitychange', () => {
    monitor.lastFrame = null;
    monitor.previousParts = null;
  });
  const timer = setInterval(update, 1000);
  addEventListener('pagehide', () => clearInterval(timer), { once: true });
  update();
  return {
    ready() {
      monitor.readyAt = monitor.now();
      slowResources = performance.getEntriesByType('resource')
        .filter((entry) => entry.duration > 100)
        .sort((a, b) => b.duration - a.duration).slice(0, 3)
        .map((entry) => `${new URL(entry.name).pathname.split('/').pop()}: ${(entry.duration / 1000).toFixed(2)} с`);
      update();
    },
  };
}
