import { mode, PHONE } from './device.js';
import { addBenchArt } from './hud-bench-art.js';
import { performanceMonitor as perf, showPerformancePanel } from './performance.js';

if (PHONE && mode !== 'game') {
  location.replace('./#stands');
} else {
  document.body.dataset.mode = mode;
  document.body.classList.toggle('touch', PHONE);
  document.querySelector('#orientation').hidden = !PHONE;
  const loading = document.querySelector('#loading');
  const performancePanel = mode === 'game' || mode === 'fly' ? showPerformancePanel() : null;
  try {
    const hud = await perf.measureAsync('hud', async () => {
      const { setupHud } = await import('./hud-layout.js');
      return setupHud();
    });
    addBenchArt(hud.base);
    if (mode === 'hud') {
      document.title = 'Редактор HUD · Timber Rogue';
      const { startEditor } = await import('./hud-editor.js');
      await startEditor(hud);
    } else if (mode === 'fall') {
      document.title = 'Падение клёна · Timber Rogue';
      loading.firstElementChild.textContent = 'Выращиваем клён…';
      for (const id of Object.keys(hud.base.elements)) hud.apply(hud.base, id);
      const { startFallStand } = await import('./fall-stand.js');
      await startFallStand();
    } else if (mode === 'wood') {
      document.title = 'Костёр и поленница · Timber Rogue';
      for (const id of ['back', 'help', 'stick', 'touch-saw']) hud.apply(hud.base, id);
      const { startWoodStand } = await import('./wood-stand.js');
      await startWoodStand();
    } else {
      for (const id of Object.keys(hud.base.elements)) hud.apply(hud.base, id);
      if (mode === 'fly') {
        document.title = 'Летающая камера · Timber Rogue';
        Object.assign(document.querySelector('#back'), { href: './#stands', textContent: '← Стенды' });
        document.querySelector('#scene').setAttribute('aria-label', 'Облёт двора');
      }
      loading.firstElementChild.textContent = 'Загружаем двор…';
      // Модели двора начинают читать рисунки уже при импорте. Последняя группа загрузок
      // может закончиться как до постройки участка, так и после неё.
      const { DefaultLoadingManager: images } = await import('three');
      let loaded = Promise.resolve(), failed;
      images.onStart = () => { loaded = new Promise(resolve => { images.onLoad = resolve; }); };
      images.onError = url => { failed = url; };
      images.onProgress = (_, done, total) => {
        loading.firstElementChild.textContent = `Загружаем двор · ${done} / ${total}`;
        if (done === total) images.onLoad?.();
      };
      const { startYard } = await perf.measureAsync('modules', () => import('./house-view.js'));
      perf.textureWaitTimedOut = await perf.measureAsync('textures', () => new Promise(resolve => {
        const timer = setTimeout(() => resolve(true), 5000);
        loaded.then(() => { clearTimeout(timer); resolve(false); });
      }));
      images.onStart = images.onLoad = images.onError = images.onProgress = undefined;
      if (failed) throw new Error(`Не загрузился рисунок ${failed}`);
      await perf.measureAsync('images', () => Promise.all([...document.querySelectorAll('.hud-art img')].map(img => img.decode())));
      loading.firstElementChild.textContent = 'Готовим первый кадр…';
      await startYard();
      performancePanel.ready();
    }
    loading.hidden = true;
  } catch (error) {
    loading.firstElementChild.textContent = 'Не удалось открыть сцену. ' + error.message;
    throw error;
  }
}
