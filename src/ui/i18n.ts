/**
 * Minimal i18n: English + Arabic with full RTL support.
 * The terminal log panel stays LTR by design (see logpanel.ts).
 */

export type Lang = 'en' | 'ar';

type Dict = Record<string, string>;

const en: Dict = {
  'app.name': 'ChessLens AR',
  'app.tagline': 'Point your camera at a real chessboard. Get live on-device analysis.',

  // Fair play
  'fairplay.title': 'Fair play notice',
  'fairplay.body':
    'ChessLens is for analysis, training, and casual games with your opponent\u2019s consent. Do not use it in rated, online, or tournament games.',
  'fairplay.accept': 'I understand',

  // Nav / common
  'nav.live': 'Live camera',
  'nav.video': 'Video file',
  'nav.analysis': 'Analysis only',
  'nav.calibrate': 'Calibrate',
  'nav.settings': 'Settings',
  'nav.debug': 'Debug',
  'common.back': 'Back',
  'common.close': 'Close',
  'common.cancel': 'Cancel',
  'common.confirm': 'Confirm',
  'common.save': 'Save',
  'common.retry': 'Retry',
  'common.ok': 'OK',
  'common.loading': 'Loading\u2026',
  'common.error': 'Error',

  // Live screen
  'live.start': 'Start camera',
  'live.stop': 'Stop camera',
  'live.pickDevice': 'Camera device',
  'live.pickVideo': 'Load video file\u2026',
  'live.calibrate': 'Calibrate board',
  'live.recalibrate': 'Recalibrate',
  'live.resync': 'Resync',
  'live.waiting': 'waiting for game',
  'live.tracking': 'tracking',
  'live.scanStart': 'Scan start position',
  'live.scanning': 'Scanning board\u2026',
  'live.modelReady': 'Vision model ready',
  'live.engineStarting': 'Starting engine\u2026',
  'live.engineReady': 'Engine ready ({backend})',
  'live.engineAsmFallback': 'WASM engine unavailable, using asm.js fallback (slower).',
  'live.engineFailed': 'Engine failed to start. Analysis is disabled; tracking still works.',
  'live.yourMove': 'Your move',
  'live.opponentMove': 'Opponent move',
  'live.suggestion': 'Suggested',
  'live.eval': 'Eval',
  'live.depth': 'Depth',
  'live.thinking': 'thinking\u2026',
  'live.confirmTitle': 'Confirm move',
  'live.confirmBody': 'The board is ambiguous between these moves:',
  'live.promotionTitle': 'Promotion',
  'live.promotionBody': 'Auto-queen applied. Tap another piece to change.',
  'live.queen': 'Queen',
  'live.rook': 'Rook',
  'live.bishop': 'Bishop',
  'live.knight': 'Knight',
  'live.recovered': 'Recovered {n} missed move(s) from the camera.',
  'live.stability': 'Stabilizing\u2026 hold still',
  'live.handDetected': 'Hand detected \u2014 waiting',
  'log.expanded': 'Log',
  'log.collapse': 'Collapse',

  // Calibration
  'cal.title': 'Calibrate the board',
  'cal.instructions':
    'Drag the 4 handles onto the OUTER corners of the 8\u00d78 playing grid (not the wooden frame).',
  'cal.orientation': 'My side is nearest the camera',
  'cal.sideWhite': 'I play White',
  'cal.sideBlack': 'I play Black',
  'cal.rotateLeft': 'Rotate 90\u00b0 left',
  'cal.rotateRight': 'Rotate 90\u00b0 right',
  'cal.flip': 'Flip sides',
  'cal.magnifier': 'Loupe',
  'cal.done': 'Use this calibration',
  'cal.quality': 'Warp quality',
  'cal.preview': 'Top-down preview (should be a square grid, White at bottom)',
  'cal.saved': 'Calibration saved for this camera.',

  // Resync
  'resync.title': 'Resync position',
  'resync.body': 'The camera lost track of the game. Fix the position manually:',
  'resync.tapBoard': 'Tap-to-move',
  'resync.undo': 'Undo last move',
  'resync.pasteFen': 'Paste FEN',
  'resync.pastePgn': 'Paste PGN',
  'resync.editor': 'Set up position',
  'resync.apply': 'Apply',
  'resync.applied': 'Position updated.',
  'resync.mismatch': 'Warning: the camera still disagrees with this position.',
  'resync.invalid': 'Could not read that FEN/PGN.',
  'resync.cameraCheck': 'Checking against camera\u2026',
  'editor.white': 'White',
  'editor.black': 'Black',
  'editor.empty': 'Erase',
  'editor.turn': 'Side to move',
  'editor.castling': 'Castling rights',
  'editor.done': 'Use position',

  // Settings
  'set.title': 'Settings',
  'set.language': 'Language',
  'set.assist': 'Assist side',
  'set.assistWhite': 'White',
  'set.assistBlack': 'Black',
  'set.assistBoth': 'Both (analysis mode)',
  'set.skill': 'Engine skill (0\u201320)',
  'set.multipv': 'Alternative lines (MultiPV)',
  'set.movetime': 'Think time per move (ms, 0 = auto)',
  'set.depth': 'Depth cap',
  'set.forceAsm': 'Force asm.js engine (compatibility)',
  'set.keepAwake': 'Keep screen awake',
  'set.debug': 'Show debug panel',
  'set.vision': 'Vision thresholds',
  'set.reset': 'Reset all data',
  'set.resetDone': 'All stored data cleared.',
  'set.about': 'About',
  'set.aboutBody':
    'ChessLens AR runs 100% on-device: chess.js for rules, Stockfish 19 (lite, single-threaded WASM) for analysis. No network, no accounts, no tracking. Licensed GPL-3.0.',

  // Debug
  'dbg.title': 'Debug',
  'dbg.warped': 'Warped board + classification',
  'dbg.fps': 'FPS',
  'dbg.visionHz': 'Vision Hz',
  'dbg.visionMs': 'Vision ms',
  'dbg.overlayMs': 'Overlay ms',
  'dbg.engineMs': 'Engine ms',
  'dbg.square': 'Square',
  'dbg.state': 'State',
  'dbg.conf': 'Confidence',
  'dbg.features': 'Features',
  'dbg.budgets': 'Performance budgets',
  'dbg.thresholds': 'Thresholds (live)',
  'dbg.empty': 'empty',
  'dbg.white': 'white piece',
  'dbg.black': 'black piece',

  // Errors
  'err.cameraDenied': 'Camera permission denied.',
  'err.cameraDeniedFix': 'Allow camera access for this site/app in your browser or system settings, then tap Retry.',
  'err.cameraMissing': 'No camera found.',
  'err.cameraMissingFix': 'Connect a camera, or use Video file / Analysis mode instead.',
  'err.cameraGeneric': 'Camera failed to start.',
  'err.cameraGenericFix': 'Close other apps using the camera, then tap Retry.',
  'err.boardNotFound': 'Board not found in frame.',
  'err.boardNotFoundFix': 'Calibrate again: keep the whole 8\u00d78 grid visible and well lit.',
  'err.wakeLock': 'Screen wake lock unavailable on this platform.',

  // Analysis mode
  'ana.title': 'Analysis mode',
  'ana.flip': 'Flip board',
  'ana.newGame': 'New game',
  'ana.engineLine': 'Engine line',
  'ana.moves': 'Moves',
  'ana.fen': 'FEN',

  // Misc
  'mode.live': 'Live camera',
  'mode.video': 'Video file',
  'mode.analysis': 'Analysis only',
  'mode.demo': 'Demo playback',
  'demo.active': 'Demo mode: playing a synthetic game.',
  'piece.pawn': 'PAWN',
  'piece.knight': 'KNIGHT',
  'piece.bishop': 'BISHOP',
  'piece.rook': 'ROOK',
  'piece.queen': 'QUEEN',
  'piece.king': 'KING',
  'flag.check': 'check',
  'flag.checkmate': 'checkmate',
  'flag.stalemate': 'stalemate',
  'flag.takes': 'takes {piece}',
  'flag.castles': 'castles'
};

const ar: Dict = {
  'app.name': '\u062a\u0634\u0637\u0631\u0646\u062c \u0644\u0646\u0632 \u0644\u0644\u0648\u0627\u0642\u0639 \u0627\u0644\u0645\u0639\u0632\u0632',
  'app.tagline': '\u0648\u062c\u0651\u0647 \u0627\u0644\u0643\u0627\u0645\u064a\u0631\u0627 \u0625\u0644\u0649 \u0631\u0642\u0639\u0629 \u0634\u0637\u0631\u0646\u062c \u062d\u0642\u064a\u0642\u064a\u0629 \u0648\u0627\u062d\u0635\u0644 \u0639\u0644\u0649 \u062a\u062d\u0644\u064a\u0644 \u0641\u0648\u0631\u064a \u0639\u0644\u0649 \u062c\u0647\u0627\u0632\u0643.',

  'fairplay.title': '\u062a\u0646\u0628\u064a\u0647 \u0627\u0644\u0644\u0639\u0628 \u0627\u0644\u0646\u0632\u064a\u0647',
  'fairplay.body':
    '\u062a\u0637\u0628\u064a\u0642 \u062a\u0634\u0637\u0631\u0646\u062c \u0644\u0646\u0632 \u0645\u062e\u0635\u0635 \u0644\u0644\u062a\u062d\u0644\u064a\u0644 \u0648\u0627\u0644\u062a\u062f\u0631\u064a\u0628 \u0648\u0627\u0644\u0645\u0628\u0627\u0631\u064a\u0627\u062a \u0627\u0644\u0648\u062f\u064a\u0629 \u0628\u0645\u0648\u0627\u0641\u0642\u0629 \u062e\u0635\u0645\u0643. \u0644\u0627 \u062a\u0633\u062a\u062e\u062f\u0645\u0647 \u0641\u064a \u0627\u0644\u0645\u0628\u0627\u0631\u064a\u0627\u062a \u0627\u0644\u0645\u0635\u0646\u0651\u0641\u0629 \u0623\u0648 \u0639\u0628\u0631 \u0627\u0644\u0625\u0646\u062a\u0631\u0646\u062a \u0623\u0648 \u0627\u0644\u0628\u0637\u0648\u0644\u0627\u062a.',
  'fairplay.accept': '\u0641\u0647\u0645\u062a',

  'nav.live': '\u0627\u0644\u0643\u0627\u0645\u064a\u0631\u0627 \u0627\u0644\u0645\u0628\u0627\u0634\u0631\u0629',
  'nav.video': '\u0645\u0644\u0641 \u0641\u064a\u062f\u064a\u0648',
  'nav.analysis': '\u062a\u062d\u0644\u064a\u0644 \u0641\u0642\u0637',
  'nav.calibrate': '\u0645\u0639\u0627\u064a\u0631\u0629',
  'nav.settings': '\u0627\u0644\u0625\u0639\u062f\u0627\u062f\u0627\u062a',
  'nav.debug': '\u062a\u0634\u062e\u064a\u0635',
  'common.back': '\u0631\u062c\u0648\u0639',
  'common.close': '\u0625\u063a\u0644\u0627\u0642',
  'common.cancel': '\u0625\u0644\u063a\u0627\u0621',
  'common.confirm': '\u062a\u0623\u0643\u064a\u062f',
  'common.save': '\u062d\u0641\u0638',
  'common.retry': '\u0625\u0639\u0627\u062f\u0629 \u0627\u0644\u0645\u062d\u0627\u0648\u0644\u0629',
  'common.ok': '\u0645\u0648\u0627\u0641\u0642',
  'common.loading': '\u062c\u0627\u0631\u064d \u0627\u0644\u062a\u062d\u0645\u064a\u0644\u2026',
  'common.error': '\u062e\u0637\u0623',

  'live.start': '\u062a\u0634\u063a\u064a\u0644 \u0627\u0644\u0643\u0627\u0645\u064a\u0631\u0627',
  'live.stop': '\u0625\u064a\u0642\u0627\u0641 \u0627\u0644\u0643\u0627\u0645\u064a\u0631\u0627',
  'live.pickDevice': '\u062c\u0647\u0627\u0632 \u0627\u0644\u0643\u0627\u0645\u064a\u0631\u0627',
  'live.pickVideo': '\u062a\u062d\u0645\u064a\u0644 \u0645\u0644\u0641 \u0641\u064a\u062f\u064a\u0648\u2026',
  'live.calibrate': '\u0645\u0639\u0627\u064a\u0631\u0629 \u0627\u0644\u0631\u0642\u0639\u0629',
  'live.recalibrate': '\u0625\u0639\u0627\u062f\u0629 \u0627\u0644\u0645\u0639\u0627\u064a\u0631\u0629',
  'live.resync': '\u0625\u0639\u0627\u062f\u0629 \u0627\u0644\u0645\u0632\u0627\u0645\u0646\u0629',
  'live.waiting': '\u0628\u0627\u0646\u062a\u0638\u0627\u0631 \u0628\u062f\u0621 \u0627\u0644\u0644\u0639\u0628\u0629',
  'live.tracking': '\u062a\u062a\u0628\u0639',
  'live.scanStart': '\u0645\u0633\u062d \u0648\u0636\u0639 \u0627\u0644\u0628\u062f\u0627\u064a\u0629',
  'live.scanning': '\u062c\u0627\u0631\u064d \u0645\u0633\u062d \u0627\u0644\u0631\u0642\u0639\u0629\u2026',
  'live.modelReady': '\u0646\u0645\u0648\u0630\u062c \u0627\u0644\u0631\u0624\u064a\u0629 \u062c\u0627\u0647\u0632',
  'live.engineStarting': '\u062c\u0627\u0631\u064d \u062a\u0634\u063a\u064a\u0644 \u0627\u0644\u0645\u062d\u0631\u0643\u2026',
  'live.engineReady': '\u0627\u0644\u0645\u062d\u0631\u0643 \u062c\u0627\u0647\u0632 ({backend})',
  'live.engineAsmFallback': '\u0645\u062d\u0631\u0643 WASM \u063a\u064a\u0631 \u0645\u062a\u0627\u062d\u060c \u062a\u0645 \u0627\u0644\u062a\u062d\u0648\u064a\u0644 \u0625\u0644\u0649 asm.js (\u0623\u0628\u0637\u0623).',
  'live.engineFailed': '\u0641\u0634\u0644 \u062a\u0634\u063a\u064a\u0644 \u0627\u0644\u0645\u062d\u0631\u0643. \u0627\u0644\u062a\u062d\u0644\u064a\u0644 \u0645\u0639\u0637\u0644\u061b \u0627\u0644\u062a\u062a\u0628\u0639 \u064a\u0633\u062a\u0645\u0631.',
  'live.yourMove': '\u0646\u0642\u0644\u062a\u0643',
  'live.opponentMove': '\u0646\u0642\u0644\u0629 \u0627\u0644\u062e\u0635\u0645',
  'live.suggestion': '\u0627\u0644\u0627\u0642\u062a\u0631\u0627\u062d',
  'live.eval': '\u0627\u0644\u062a\u0642\u064a\u064a\u0645',
  'live.depth': '\u0627\u0644\u0639\u0645\u0642',
  'live.thinking': '\u064a\u0641\u0643\u0631\u2026',
  'live.confirmTitle': '\u062a\u0623\u0643\u064a\u062f \u0627\u0644\u0646\u0642\u0644\u0629',
  'live.confirmBody': '\u0627\u0644\u0631\u0642\u0639\u0629 \u063a\u064a\u0631 \u0645\u062d\u0633\u0648\u0645\u0629 \u0628\u064a\u0646 \u0647\u0627\u062a\u064a\u0646 \u0627\u0644\u0646\u0642\u0644\u062a\u064a\u0646:',
  'live.promotionTitle': '\u062a\u0631\u0642\u064a\u0629',
  'live.promotionBody': '\u062a\u0645 \u0627\u062e\u062a\u064a\u0627\u0631 \u0627\u0644\u0645\u0644\u0643\u0629 \u062a\u0644\u0642\u0627\u0626\u064a\u064b\u0627. \u0627\u0644\u0645\u0633 \u0642\u0637\u0639\u0629 \u0623\u062e\u0631\u0649 \u0644\u0644\u062a\u063a\u064a\u064a\u0631.',
  'live.queen': '\u0645\u0644\u0643\u0629',
  'live.rook': '\u0637\u0627\u0628\u064a\u0629',
  'live.bishop': '\u0641\u064a\u0644',
  'live.knight': '\u062d\u0635\u0627\u0646',
  'live.recovered': '\u062a\u0645 \u0627\u0633\u062a\u0631\u062c\u0627\u0639 {n} \u0646\u0642\u0644\u0629 \u0641\u0627\u0626\u062a\u0629 \u0645\u0646 \u0627\u0644\u0643\u0627\u0645\u064a\u0631\u0627.',
  'live.stability': '\u062c\u0627\u0631\u064d \u0627\u0644\u062a\u062b\u0628\u064a\u062a\u2026 \u0627\u0628\u0642\u064e \u062b\u0627\u0628\u062a\u064b\u0627',
  'live.handDetected': '\u062a\u0645 \u0631\u0635\u062f \u064a\u062f \u2014 \u0628\u0627\u0646\u062a\u0638\u0627\u0631',
  'log.expanded': '\u0627\u0644\u0633\u062c\u0644',
  'log.collapse': '\u0637\u064a\u0651',

  'cal.title': '\u0645\u0639\u0627\u064a\u0631\u0629 \u0627\u0644\u0631\u0642\u0639\u0629',
  'cal.instructions':
    '\u0627\u0633\u062d\u0628 \u0627\u0644\u0645\u0642\u0627\u0628\u0636 \u0627\u0644\u0623\u0631\u0628\u0639\u0629 \u0625\u0644\u0649 \u0627\u0644\u0632\u0648\u0627\u064a\u0627 \u0627\u0644\u062e\u0627\u0631\u062c\u064a\u0629 \u0644\u0634\u0628\u0643\u0629 \u0627\u0644\u0644\u0639\u0628 8\u00d78 (\u0648\u0644\u064a\u0633 \u0627\u0644\u0625\u0637\u0627\u0631 \u0627\u0644\u062e\u0634\u0628\u064a).',
  'cal.orientation': '\u062c\u0647\u062a\u064a \u0647\u064a \u0627\u0644\u0623\u0642\u0631\u0628 \u0644\u0644\u0643\u0627\u0645\u064a\u0631\u0627',
  'cal.sideWhite': '\u0623\u0644\u0639\u0628 \u0628\u0627\u0644\u0623\u0628\u064a\u0636',
  'cal.sideBlack': '\u0623\u0644\u0639\u0628 \u0628\u0627\u0644\u0623\u0633\u0648\u062f',
  'cal.rotateLeft': '\u062a\u062f\u0648\u064a\u0631 90\u00b0 \u0644\u0644\u064a\u0633\u0627\u0631',
  'cal.rotateRight': '\u062a\u062f\u0648\u064a\u0631 90\u00b0 \u0644\u0644\u064a\u0645\u064a\u0646',
  'cal.flip': '\u062a\u0628\u062f\u064a\u0644 \u0627\u0644\u062c\u0647\u062a\u064a\u0646',
  'cal.magnifier': '\u0639\u062f\u0633\u0629 \u0645\u0643\u0628\u0631\u0629',
  'cal.done': '\u0627\u0633\u062a\u062e\u062f\u0645 \u0647\u0630\u0647 \u0627\u0644\u0645\u0639\u0627\u064a\u0631\u0629',
  'cal.quality': '\u062c\u0648\u062f\u0629 \u0627\u0644\u062a\u0635\u062d\u064a\u062d',
  'cal.preview': '\u0645\u0639\u0627\u064a\u0646\u0629 \u0645\u0646 \u0627\u0644\u0623\u0639\u0644\u0649 (\u064a\u062c\u0628 \u0623\u0646 \u062a\u0643\u0648\u0646 \u0634\u0628\u0643\u0629 \u0645\u0631\u0628\u0639\u0629 \u0648\u0627\u0644\u0623\u0628\u064a\u0636 \u0623\u0633\u0641\u0644)',
  'cal.saved': '\u062a\u0645 \u062d\u0641\u0638 \u0627\u0644\u0645\u0639\u0627\u064a\u0631\u0629 \u0644\u0647\u0630\u0647 \u0627\u0644\u0643\u0627\u0645\u064a\u0631\u0627.',

  'resync.title': '\u0625\u0639\u0627\u062f\u0629 \u0645\u0632\u0627\u0645\u0646\u0629 \u0627\u0644\u0648\u0636\u0639',
  'resync.body': '\u0641\u0642\u062f\u062a \u0627\u0644\u0643\u0627\u0645\u064a\u0631\u0627 \u062a\u062a\u0628\u0639 \u0627\u0644\u0644\u0639\u0628\u0629. \u0635\u062d\u062d \u0627\u0644\u0648\u0636\u0639 \u064a\u062f\u0648\u064a\u064b\u0627:',
  'resync.tapBoard': '\u0646\u0642\u0644 \u0628\u0627\u0644\u0644\u0645\u0633',
  'resync.undo': '\u062a\u0631\u0627\u062c\u0639 \u0639\u0646 \u0622\u062e\u0631 \u0646\u0642\u0644\u0629',
  'resync.pasteFen': '\u0644\u0635\u0642 FEN',
  'resync.pastePgn': '\u0644\u0635\u0642 PGN',
  'resync.editor': '\u0625\u0639\u062f\u0627\u062f \u0627\u0644\u0648\u0636\u0639',
  'resync.apply': '\u062a\u0637\u0628\u064a\u0642',
  'resync.applied': '\u062a\u0645 \u062a\u062d\u062f\u064a\u062b \u0627\u0644\u0648\u0636\u0639.',
  'resync.mismatch': '\u062a\u062d\u0630\u064a\u0631: \u0627\u0644\u0643\u0627\u0645\u064a\u0631\u0627 \u0644\u0627 \u062a\u0632\u0627\u0644 \u062a\u062e\u0627\u0644\u0641 \u0647\u0630\u0627 \u0627\u0644\u0648\u0636\u0639.',
  'resync.invalid': '\u062a\u0639\u0630\u0631 \u0642\u0631\u0627\u0621\u0629 FEN/PGN.',
  'resync.cameraCheck': '\u062c\u0627\u0631\u064d \u0627\u0644\u0645\u0642\u0627\u0631\u0646\u0629 \u0645\u0639 \u0627\u0644\u0643\u0627\u0645\u064a\u0631\u0627\u2026',
  'editor.white': '\u0623\u0628\u064a\u0636',
  'editor.black': '\u0623\u0633\u0648\u062f',
  'editor.empty': '\u0645\u062d\u0648',
  'editor.turn': '\u0627\u0644\u062f\u0648\u0631 \u0644\u0640',
  'editor.castling': '\u062d\u0642\u0648\u0642 \u0627\u0644\u062a\u0628\u064a\u064a\u062a',
  'editor.done': '\u0627\u0633\u062a\u062e\u062f\u0645 \u0627\u0644\u0648\u0636\u0639',

  'set.title': '\u0627\u0644\u0625\u0639\u062f\u0627\u062f\u0627\u062a',
  'set.language': '\u0627\u0644\u0644\u063a\u0629',
  'set.assist': '\u0627\u0644\u062c\u0647\u0629 \u0627\u0644\u0645\u0633\u0627\u0639\u062f\u0629',
  'set.assistWhite': '\u0623\u0628\u064a\u0636',
  'set.assistBlack': '\u0623\u0633\u0648\u062f',
  'set.assistBoth': '\u0627\u0644\u0627\u062b\u0646\u0627\u0646 (\u0648\u0636\u0639 \u0627\u0644\u062a\u062d\u0644\u064a\u0644)',
  'set.skill': '\u0645\u0647\u0627\u0631\u0629 \u0627\u0644\u0645\u062d\u0631\u0643 (0\u201320)',
  'set.multipv': '\u0627\u0644\u062e\u0637\u0648\u0637 \u0627\u0644\u0628\u062f\u064a\u0644\u0629 (MultiPV)',
  'set.movetime': '\u0648\u0642\u062a \u0627\u0644\u062a\u0641\u0643\u064a\u0631 \u0644\u0643\u0644 \u0646\u0642\u0644\u0629 (\u0645\u0644\u0644\u064a \u062b\u0627\u0646\u064a\u0629\u060c 0 = \u062a\u0644\u0642\u0627\u0626\u064a)',
  'set.depth': '\u0627\u0644\u062d\u062f \u0627\u0644\u0623\u0642\u0635\u0649 \u0644\u0644\u0639\u0645\u0642',
  'set.forceAsm': '\u0641\u0631\u0636 \u0645\u062d\u0631\u0643 asm.js (\u0644\u0644\u062a\u0648\u0627\u0641\u0642)',
  'set.keepAwake': '\u0625\u0628\u0642\u0627\u0621 \u0627\u0644\u0634\u0627\u0634\u0629 \u0645\u0634\u0639\u0644\u0629',
  'set.debug': '\u0625\u0638\u0647\u0627\u0631 \u0644\u0648\u062d\u0629 \u0627\u0644\u062a\u0634\u062e\u064a\u0635',
  'set.vision': '\u0639\u062a\u0628\u0627\u062a \u0627\u0644\u0631\u0624\u064a\u0629',
  'set.reset': '\u0625\u0639\u0627\u062f\u0629 \u062a\u0639\u064a\u064a\u0646 \u0643\u0644 \u0627\u0644\u0628\u064a\u0627\u0646\u0627\u062a',
  'set.resetDone': '\u062a\u0645 \u0645\u0633\u062d \u0643\u0644 \u0627\u0644\u0628\u064a\u0627\u0646\u0627\u062a \u0627\u0644\u0645\u062e\u0632\u0646\u0629.',
  'set.about': '\u062d\u0648\u0644',
  'set.aboutBody':
    '\u062a\u0634\u0637\u0631\u0646\u062c \u0644\u0646\u0632 \u064a\u0639\u0645\u0644 \u0628\u0627\u0644\u0643\u0627\u0645\u0644 \u0639\u0644\u0649 \u0627\u0644\u062c\u0647\u0627\u0632: chess.js \u0644\u0644\u0642\u0648\u0627\u0639\u062f\u060c \u0648Stockfish 19 (\u0625\u0635\u062f\u0627\u0631 lite \u0628\u062a\u0642\u0646\u064a\u0629 WASM \u0623\u062d\u0627\u062f\u064a \u0627\u0644\u062e\u064a\u0648\u0637) \u0644\u0644\u062a\u062d\u0644\u064a\u0644. \u0628\u062f\u0648\u0646 \u0625\u0646\u062a\u0631\u0646\u062a \u0623\u0648 \u062d\u0633\u0627\u0628\u0627\u062a \u0623\u0648 \u062a\u062a\u0628\u0639. \u0631\u062e\u0635\u0629 GPL-3.0.',

  'dbg.title': '\u062a\u0634\u062e\u064a\u0635',
  'dbg.warped': '\u0627\u0644\u0631\u0642\u0639\u0629 \u0627\u0644\u0645\u0635\u062d\u062d\u0629 + \u0627\u0644\u062a\u0635\u0646\u064a\u0641',
  'dbg.fps': '\u0625\u0637\u0627\u0631/\u062b',
  'dbg.visionHz': '\u0627\u0644\u0631\u0624\u064a\u0629 \u0647\u064a\u0631\u062a\u0632',
  'dbg.visionMs': '\u0627\u0644\u0631\u0624\u064a\u0629 \u0645\u0644\u0644\u064a \u062b\u0627\u0646\u064a\u0629',
  'dbg.overlayMs': '\u0627\u0644\u0637\u0628\u0642\u0629 \u0645\u0644\u0644\u064a \u062b\u0627\u0646\u064a\u0629',
  'dbg.engineMs': '\u0627\u0644\u0645\u062d\u0631\u0643 \u0645\u0644\u0644\u064a \u062b\u0627\u0646\u064a\u0629',
  'dbg.square': '\u0645\u0631\u0628\u0639',
  'dbg.state': '\u0627\u0644\u062d\u0627\u0644\u0629',
  'dbg.conf': '\u0627\u0644\u062b\u0642\u0629',
  'dbg.features': '\u0627\u0644\u062e\u0635\u0627\u0626\u0635',
  'dbg.budgets': '\u0645\u064a\u0632\u0627\u0646\u064a\u0627\u062a \u0627\u0644\u0623\u062f\u0627\u0621',
  'dbg.thresholds': '\u0627\u0644\u0639\u062a\u0628\u0627\u062a (\u0645\u0628\u0627\u0634\u0631)',
  'dbg.empty': '\u0641\u0627\u0631\u063a',
  'dbg.white': '\u0642\u0637\u0639\u0629 \u0628\u064a\u0636\u0627\u0621',
  'dbg.black': '\u0642\u0637\u0639\u0629 \u0633\u0648\u062f\u0627\u0621',

  'err.cameraDenied': '\u062a\u0645 \u0631\u0641\u0636 \u0625\u0630\u0646 \u0627\u0644\u0643\u0627\u0645\u064a\u0631\u0627.',
  'err.cameraDeniedFix':
    '\u0627\u0633\u0645\u062d \u0628\u0627\u0644\u0648\u0635\u0648\u0644 \u0625\u0644\u0649 \u0627\u0644\u0643\u0627\u0645\u064a\u0631\u0627 \u0644\u0647\u0630\u0627 \u0627\u0644\u0645\u0648\u0642\u0639/\u0627\u0644\u062a\u0637\u0628\u064a\u0642 \u0645\u0646 \u0627\u0644\u0645\u062a\u0635\u0641\u062d \u0623\u0648 \u0625\u0639\u062f\u0627\u062f\u0627\u062a \u0627\u0644\u0646\u0638\u0627\u0645\u060c \u062b\u0645 \u0627\u0636\u063a\u0637 \u0625\u0639\u0627\u062f\u0629 \u0627\u0644\u0645\u062d\u0627\u0648\u0644\u0629.',
  'err.cameraMissing': '\u0644\u0645 \u064a\u062a\u0645 \u0627\u0644\u0639\u062b\u0648\u0631 \u0639\u0644\u0649 \u0643\u0627\u0645\u064a\u0631\u0627.',
  'err.cameraMissingFix':
    '\u0648\u0635\u0651\u0644 \u0643\u0627\u0645\u064a\u0631\u0627\u060c \u0623\u0648 \u0627\u0633\u062a\u062e\u062f\u0645 \u0648\u0636\u0639 \u0645\u0644\u0641 \u0627\u0644\u0641\u064a\u062f\u064a\u0648 \u0623\u0648 \u0627\u0644\u062a\u062d\u0644\u064a\u0644 \u0628\u062f\u0644\u0627\u064b \u0645\u0646 \u0630\u0644\u0643.',
  'err.cameraGeneric': '\u0641\u0634\u0644 \u062a\u0634\u063a\u064a\u0644 \u0627\u0644\u0643\u0627\u0645\u064a\u0631\u0627.',
  'err.cameraGenericFix':
    '\u0623\u063a\u0644\u0642 \u0627\u0644\u062a\u0637\u0628\u064a\u0642\u0627\u062a \u0627\u0644\u0623\u062e\u0631\u0649 \u0627\u0644\u062a\u064a \u062a\u0633\u062a\u062e\u062f\u0645 \u0627\u0644\u0643\u0627\u0645\u064a\u0631\u0627\u060c \u062b\u0645 \u0627\u0636\u063a\u0637 \u0625\u0639\u0627\u062f\u0629 \u0627\u0644\u0645\u062d\u0627\u0648\u0644\u0629.',
  'err.boardNotFound': '\u0644\u0645 \u064a\u062a\u0645 \u0627\u0644\u0639\u062b\u0648\u0631 \u0639\u0644\u0649 \u0627\u0644\u0631\u0642\u0639\u0629 \u0641\u064a \u0627\u0644\u0625\u0637\u0627\u0631.',
  'err.boardNotFoundFix':
    '\u0623\u0639\u062f \u0627\u0644\u0645\u0639\u0627\u064a\u0631\u0629: \u062a\u0623\u0643\u062f \u0645\u0646 \u0638\u0647\u0648\u0631 \u0643\u0627\u0645\u0644 \u0627\u0644\u0634\u0628\u0643\u0629 8\u00d78 \u0648\u0625\u0636\u0627\u0621\u062a\u0647\u0627 \u062c\u064a\u062f\u064b\u0627.',
  'err.wakeLock': '\u0645\u0646\u0639 \u0625\u0637\u0641\u0627\u0621 \u0627\u0644\u0634\u0627\u0634\u0629 \u063a\u064a\u0631 \u0645\u062a\u0627\u062d \u0639\u0644\u0649 \u0647\u0630\u0627 \u0627\u0644\u0646\u0638\u0627\u0645.',

  'ana.title': '\u0648\u0636\u0639 \u0627\u0644\u062a\u062d\u0644\u064a\u0644',
  'ana.flip': '\u0642\u0644\u0628 \u0627\u0644\u0631\u0642\u0639\u0629',
  'ana.newGame': '\u0644\u0639\u0628\u0629 \u062c\u062f\u064a\u062f\u0629',
  'ana.engineLine': '\u062e\u0637 \u0627\u0644\u0645\u062d\u0631\u0643',
  'ana.moves': '\u0627\u0644\u0646\u0642\u0644\u0627\u062a',
  'ana.fen': 'FEN',

  'mode.live': '\u0627\u0644\u0643\u0627\u0645\u064a\u0631\u0627 \u0627\u0644\u0645\u0628\u0627\u0634\u0631\u0629',
  'mode.video': '\u0645\u0644\u0641 \u0641\u064a\u062f\u064a\u0648',
  'mode.analysis': '\u062a\u062d\u0644\u064a\u0644 \u0641\u0642\u0637',
  'mode.demo': '\u0639\u0631\u0636 \u062a\u062c\u0631\u064a\u0628\u064a',
  'demo.active': '\u0627\u0644\u0648\u0636\u0639 \u0627\u0644\u062a\u062c\u0631\u064a\u0628\u064a: \u062a\u0634\u063a\u064a\u0644 \u0644\u0639\u0628\u0629 \u0627\u0635\u0637\u0646\u0627\u0639\u064a\u0629.',
  'piece.pawn': '\u0628\u064a\u062f\u0642',
  'piece.knight': '\u062d\u0635\u0627\u0646',
  'piece.bishop': '\u0641\u064a\u0644',
  'piece.rook': '\u0637\u0627\u0628\u064a\u0629',
  'piece.queen': '\u0645\u0644\u0643\u0629',
  'piece.king': '\u0645\u0644\u0643',
  'flag.check': '\u0643\u0634',
  'flag.checkmate': '\u0643\u0634 \u0645\u0627\u062a',
  'flag.stalemate': '\u062a\u0639\u0627\u062f\u0644',
  'flag.takes': '\u064a\u0623\u062e\u0630 {piece}',
  'flag.castles': '\u062a\u0628\u064a\u064a\u062a'
};

const DICTS: Record<Lang, Dict> = { en, ar };

let current: Lang = 'en';
const listeners = new Set<() => void>();

export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang): void {
  current = lang;
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lang;
    // The log panel explicitly re-opts into LTR via its own CSS.
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  }
  for (const l of listeners) l();
}

export function onLangChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Translate a key, interpolating {var} placeholders. Falls back to English then the key. */
export function t(key: string, vars?: Record<string, string | number>): string {
  let s = DICTS[current][key] ?? DICTS.en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  }
  return s;
}

/** True if the key exists in the active dictionary (used by tests). */
export function hasKey(key: string, lang: Lang = current): boolean {
  return key in DICTS[lang];
}

export function allKeys(): string[] {
  return Object.keys(en);
}

export function detectInitialLang(): Lang {
  if (typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('ar')) return 'ar';
  return 'en';
}
