import { describe, expect, it } from 'vitest';
import type { Move } from 'chess.js';
import { replayGame } from './helpers/harness.js';

/** The Opera Game - castling (O-O-O), sacrifices and mate. */
const OPERA_GAME = [
  '1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6',
  '7. Qb3 Qe7 8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7',
  '12. O-O-O Rd8 13. Rxd7 Rxd7 14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8',
  '17. Rd8#'
].join(' ');

/** En passant exercise (exd6 e.p. plus a second ep capture). */
const EP_GAME = '1. e4 Nf6 2. e5 d5 3. exd6 exd6 4. d4 d5 5. c4 c5 6. dxc5 b6 7. cxb6 axb6';

/** Double promotion (both sides queen a pawn) plus rook lifts. */
const PROMO_GAME = [
  '1. a4 b5 2. axb5 a6 3. bxa6 Bb7 4. axb7 Na6 5. bxa8=Q Qxa8',
  '6. Rxa6 Qb8 7. Ra8 Qxa8 8. e4 Qxe4+ 9. Qe2 Qxe2+ 10. Kxe2'
].join(' ');

function expectReplay(pgn: string, seed: number): void {
  const result = replayGame(pgn, { seed, noise: 3, blur: 0.6, gradient: 0.18, framesPerPly: 12, handFrames: 4 });
  const sans = result.tracker.history.map((m: Move) => m.san);
  expect(sans.join(' ')).toEqual(
    pgn
      .replace(/\d+\. /g, '')
      .split(/\s+/)
      .filter(Boolean)
      .join(' ')
  );
  // Classification stayed accurate while tracking.
  expect(result.classificationErrors / Math.max(1, result.classificationTotal)).toBeLessThan(0.02);
}

describe('PGN replay through the synthetic camera + tracker', () => {
  it('Opera Game (incl. O-O-O and mate) is reproduced move by move', () => {
    expectReplay(OPERA_GAME, 1001);
  }, 300000);

  it('en passant game is reproduced move by move', () => {
    expectReplay(EP_GAME, 2002);
  }, 300000);

  it('promotion game (both sides auto-queen) is reproduced move by move', () => {
    expectReplay(PROMO_GAME, 3003);
  }, 300000);

  it('emits move events with correct SAN order and no spurious events', () => {
    const result = replayGame(OPERA_GAME, { seed: 4004 });
    const moves = result.confirmed.map((e) => e.move.san);
    expect(moves[0]).toBe('e4');
    expect(moves[moves.length - 1]).toBe('Rd8#');
    expect(result.confirmed[result.confirmed.length - 1]?.checkmate).toBe(true);
    const ambiguous = result.events.filter((e) => e.type === 'ambiguous');
    expect(ambiguous.length).toBe(0);
  }, 300000);
});
