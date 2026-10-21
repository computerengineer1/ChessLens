/**
 * CI syntax + logic checker: parses every workflow YAML and asserts the
 * structural invariants the project relies on (jobs, runners, key steps).
 * Runs in web.yml and locally via `npm run check:workflows`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, '.github', 'workflows');

const EXPECT = {
  'web.yml': {
    jobs: ['build', 'deploy'],
    stepsContain: ['npm install', 'npm test', 'npm run build', 'actions/deploy-pages']
  },
  'android.yml': {
    jobs: ['apk'],
    stepsContain: ['setup-java', 'cap sync android', 'gradlew assembleDebug', 'upload-artifact']
  },
  'ios.yml': {
    jobs: ['ipa'],
    stepsContain: ['cap add ios', 'cap sync ios', 'patch-ios-plist', 'xcodebuild archive', 'CODE_SIGNING_ALLOWED=NO', 'zip -qr ChessLens-unsigned.ipa']
  },
  'windows.yml': {
    jobs: ['exe'],
    stepsContain: ['electron-builder --win', 'upload-artifact']
  },
  'release.yml': {
    jobs: ['android', 'ios', 'windows', 'publish'],
    stepsContain: ['softprops/action-gh-release']
  }
};

let failures = 0;
for (const file of readdirSync(dir).filter((f) => f.endsWith('.yml'))) {
  const text = readFileSync(join(dir, file), 'utf8');
  let doc;
  try {
    doc = YAML.parse(text);
  } catch (err) {
    console.error(`FAIL ${file}: YAML parse error: ${err.message}`);
    failures++;
    continue;
  }
  const spec = EXPECT[file];
  if (!spec) {
    console.error(`FAIL ${file}: no expectations defined`);
    failures++;
    continue;
  }
  const jobs = Object.keys(doc.jobs ?? {});
  for (const j of spec.jobs) {
    if (!jobs.includes(j)) {
      console.error(`FAIL ${file}: missing job ${j}`);
      failures++;
    }
  }
  const blob = text;
  for (const needle of spec.stepsContain) {
    if (!blob.includes(needle)) {
      console.error(`FAIL ${file}: missing step fragment "${needle}"`);
      failures++;
    }
  }
  // Reusable workflows invoked by release.yml must accept workflow_call.
  if (file !== 'release.yml' && file !== 'web.yml') {
    const on = doc.on ?? doc[true];
    if (!on || !('workflow_call' in on)) {
      console.error(`FAIL ${file}: must declare workflow_call (used by release.yml)`);
      failures++;
    }
  }
  if (failures === 0) console.log(`ok   ${file}: jobs [${jobs.join(', ')}]`);
}

if (failures > 0) {
  console.error(`${failures} workflow problem(s)`);
  process.exit(1);
}
console.log('all workflows parse and satisfy structural expectations');
