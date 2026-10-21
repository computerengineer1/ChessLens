/**
 * Injects NSCameraUsageDescription (and microphone-free media keys) into the
 * generated iOS Info.plist. Runs in CI right after `npx cap add ios`,
 * because the iOS platform folder is generated on the macOS runner.
 * Pure string manipulation - no plist dependency needed.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const plistPath = join(root, 'ios', 'App', 'App', 'Info.plist');

if (!existsSync(plistPath)) {
  console.error('patch-ios-plist: ios/App/App/Info.plist not found (run `npx cap add ios` first)');
  process.exit(1);
}

const KEYS = {
  NSCameraUsageDescription:
    'ChessLens AR uses the camera to see your chessboard and overlay live analysis. All processing stays on this device.',
  NSMicrophoneUsageDescription: 'ChessLens AR does not record audio; this permission is never requested at runtime.'
};

let plist = readFileSync(plistPath, 'utf8');
let added = 0;
for (const [key, value] of Object.entries(KEYS)) {
  if (plist.includes(`<key>${key}</key>`)) continue;
  const insert = `    <key>${key}</key>\n    <string>${value}</string>\n`;
  // Insert before the closing </dict> of the top-level dictionary.
  const idx = plist.lastIndexOf('</dict>');
  plist = plist.slice(0, idx) + insert + plist.slice(idx);
  added++;
}
writeFileSync(plistPath, plist);
console.log(`patch-ios-plist: ${added} key(s) added to Info.plist`);
