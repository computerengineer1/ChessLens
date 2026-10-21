/**
 * Bootstrap: settings, i18n, service worker, App creation.
 */

import './styles.css';
import { App, APP_VERSION } from './app.js';
import { el } from './ui/dom.js';

async function registerSW(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  // Only register on http(s) - not inside file:// (Electron loads dist via
  // a custom protocol/file, where SWs are not available) and not in dev.
  if (!location.protocol.startsWith('http')) return;
  if (import.meta.env.DEV) return;
  const isNative = !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();
  if (isNative) return; // native shells ship everything locally already
  try {
    const { registerSW } = await import('virtual:pwa-register');
    registerSW({ immediate: true });
  } catch {
    // vite-plugin-pwa registration unavailable (e.g. plain static preview)
  }
}

function main(): void {
  const host = document.getElementById('app');
  if (!host) {
    document.body.append(el('div', { class: 'fatal', text: 'Missing #app root' }));
    return;
  }
  const params = new URLSearchParams(location.search);
  const demo = params.get('demo') === '1';
  const app = new App(host, { demo });
  app.start();
  window.addEventListener('focus', () => app.onResume());

  // Debug handle + startup budget print.
  const w = window as unknown as Record<string, unknown>;
  w.chesslens = { app, version: APP_VERSION, perf: app.perf };
  window.addEventListener('load', () => {
    const ms = performance.now();
    console.info(`[chesslens] window load at ${ms.toFixed(0)} ms`);
    app.perf.reset();
  });
}

void registerSW();
main();
