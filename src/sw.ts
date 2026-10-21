/// <reference lib="webworker" />
/**
 * Service worker (vite-plugin-pwa injectManifest strategy).
 * Precaches the app shell AND the Stockfish binaries so the app is 100%
 * functional offline after first load.
 */
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';

declare let self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') void self.skipWaiting();
});

// Never block on network for navigations: the precached shell handles them.
self.addEventListener('install', () => {
  void self.skipWaiting();
});
