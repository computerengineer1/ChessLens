/**
 * Sandboxed preload: exposes a tiny, read-only desktop bridge.
 * Compiled to CJS (sandboxed preloads cannot use ESM).
 */
import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('chesslensDesktop', {
  platform: process.platform,
  versions: {
    electron: process.versions.electron ?? '',
    chrome: process.versions.chrome ?? '',
    node: process.versions.node ?? ''
  },
  isDesktop: true
});
