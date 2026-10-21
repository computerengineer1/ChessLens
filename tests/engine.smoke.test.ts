import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Chess } from 'chess.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// The EXACT artifact shipped to browsers (copied by scripts/copy-engine.mjs).
// The loader is CommonJS; this repo is "type": "module", so Node would treat
// public/engine/*.js as ESM. Run the identical bytes from a package.json-free
// temp dir where Node defaults to CommonJS. Browsers load it as a CLASSIC
// worker script, where the module type of this repo is irrelevant.
const stage = join(tmpdir(), 'chesslens-engine-smoke');
const ENGINE = join(stage, 'stockfish-19-lite-single.js');
mkdirSync(stage, { recursive: true });
cpSync(join(root, 'public', 'engine', 'stockfish-19-lite-single.js'), ENGINE);
cpSync(
  join(root, 'public', 'engine', 'stockfish-19-lite-single.wasm'),
  join(stage, 'stockfish-19-lite-single.wasm')
);

function runUci(lines: string[], waitFor: string, timeoutMs = 40000): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!existsSync(ENGINE)) {
      reject(new Error('engine files missing - run `npm run copy:engine` first'));
      return;
    }
    const child = spawn(process.execPath, [ENGINE]);
    let out = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`timeout waiting for ${waitFor}`));
    }, timeoutMs);
    child.stdout.on('data', (d: Buffer) => {
      out += d.toString();
      if (out.includes(waitFor)) {
        clearTimeout(timer);
        child.kill();
        resolve(out);
      }
    });
    child.stderr.on('data', (d: Buffer) => {
      out += d.toString();
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    for (const l of lines) child.stdin.write(l + '\n');
  });
}

describe('stockfish lite wasm engine smoke test', () => {
  it('answers the UCI handshake', async () => {
    const out = await runUci(['uci'], 'uciok');
    expect(out).toContain('id name');
    expect(out).toContain('uciok');
  });

  it('returns a legal best move for a given FEN', async () => {
    const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 0 1';
    const out = await runUci(['uci', 'isready', `position fen ${fen}`, 'go movetime 500'], 'bestmove');
    const match = /bestmove ([a-h][1-8][a-h][1-8][qrbn]?)/.exec(out);
    expect(match).not.toBeNull();
    const uci = match![1] as string;
    const chess = new Chess(fen);
    const legal = chess.moves({ verbose: true }).some((m) => m.from + m.to + (m.promotion ?? '') === uci);
    expect(legal).toBe(true);
    expect(out).toMatch(/info depth/);
  });

  it('finds mate-in-one', async () => {
    const fen = '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1';
    const out = await runUci(['uci', 'isready', `position fen ${fen}`, 'go movetime 700'], 'bestmove');
    expect(out).toContain('bestmove a1a8');
  });
});
