// tests/tetris.test.js
// Comprehensive unit tests for core Tetris logic using plain Node (`node --test`).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { BagRandomizer, PIECE_TYPES } from '../src/randomizer.js';
import {
  SHAPES,
  generateLevelColorMap,
  createPiece,
} from '../src/pieces.js';
import { Board, BOARD_WIDTH, TOTAL_ROWS } from '../src/board.js';
import {
  getGravitySecondsPerRow,
  evaluateTurnScore,
  calculateDropScore,
} from '../src/scoring.js';
import { TetrisGame, LOCK_DELAY_MS, MAX_LOCK_RESETS } from '../src/game.js';
import { normalizeSevenCharName } from '../src/storage.js';

describe('7-Bag Randomizer Fairness & Determinism', () => {
  it('deals all 7 unique tetrominoes in every 7-piece bag', () => {
    const bag = new BagRandomizer(12345);
    for (let batch = 0; batch < 25; batch++) {
      const seen = new Set();
      for (let i = 0; i < 7; i++) {
        const piece = bag.next();
        assert.ok(PIECE_TYPES.includes(piece), `Invalid piece type: ${piece}`);
        seen.add(piece);
      }
      assert.equal(seen.size, 7, `Bag #${batch} did not contain all 7 distinct pieces`);
    }
  });

  it('produces identical sequences for the same seed and supports serialize/restore', () => {
    const a = new BagRandomizer(42);
    const b = new BagRandomizer(42);
    for (let i = 0; i < 14; i++) {
      assert.equal(a.next(), b.next());
    }

    const snap = a.serialize();
    const c = new BagRandomizer(999);
    c.restore(snap);
    for (let i = 0; i < 14; i++) {
      assert.equal(a.next(), c.next());
    }
  });
});

describe('Per-Level Randomized Distinct Piece Colors', () => {
  it('assigns 7 distinct colors on Level 1 with T=Red and L=Blue', () => {
    const map1 = generateLevelColorMap({ level: 1, theme: 'neon', randomLevelColors: true, seed: 100 });
    const values = Object.values(map1);
    assert.equal(new Set(values).size, 7, 'Each piece must have a unique color');
    assert.equal(map1.T, '#ff2a5f', 'Level 1 T piece should be neon crimson red');
    assert.equal(map1.L, '#2979ff', 'Level 1 L piece should be neon electric blue');
  });

  it('randomizes and changes the color assignment on each new level while keeping all 7 distinct', () => {
    let prev = generateLevelColorMap({ level: 1, theme: 'neon', randomLevelColors: true, seed: 777 });
    for (let lvl = 2; lvl <= 10; lvl++) {
      const next = generateLevelColorMap({
        level: lvl,
        theme: 'neon',
        randomLevelColors: true,
        previousMap: prev,
        seed: 777,
      });
      assert.equal(new Set(Object.values(next)).size, 7, `Level ${lvl} must have 7 distinct colors`);
      const anyChanged = PIECE_TYPES.some((t) => next[t] !== prev[t]);
      assert.ok(anyChanged, `Level ${lvl} palette should differ from level ${lvl - 1}`);
      prev = next;
    }
  });
});

describe('Super Rotation System (SRS) Rotations & Wall Kicks', () => {
  it('rotates pieces CW, CCW, and 180 in open space', () => {
    const board = new Board();
    const piece = createPiece('T');
    piece.x = 4;
    piece.y = 5;

    const cw = board.tryRotate(piece, 1);
    assert.equal(cw.success, true);
    assert.equal(cw.rotation, 1);
    assert.equal(cw.kickIndex, 0);

    piece.rotation = cw.rotation;
    const ccw = board.tryRotate(piece, -1);
    assert.equal(ccw.success, true);
    assert.equal(ccw.rotation, 0);

    piece.rotation = ccw.rotation;
    const rot180 = board.tryRotate(piece, 2);
    assert.equal(rot180.success, true);
    assert.equal(rot180.rotation, 2);
  });

  it('kicks I-piece off the left and right walls', () => {
    const board = new Board();
    const iPiece = createPiece('I');
    // Rotate to vertical state 3 (occupies column x+1)
    iPiece.rotation = 3;
    iPiece.x = -1; // flush against left wall (col 0)
    iPiece.y = 10;
    assert.equal(board.isValidPosition(iPiece), true);

    // Rotate CW (3 -> 0) should kick right into valid board coordinates
    const res = board.tryRotate(iPiece, 1);
    assert.equal(res.success, true);
    assert.ok(res.x >= 0, 'I-piece should kick right off the left wall');
  });

  it('executes the famous T-Spin Triple (TST) 5th wall kick (kickIndex === 4, dx=±1, dy=+2)', () => {
    const board = new Board();
    // Construct a classic right-side TST tower/notch at the bottom of the board (rows 17..21)
    // We want a T piece at rotation 0 (North) at (x=1, y=17) rotating CCW (0 -> 3)
    // Using kick 0->3 index 4: [1, 2] -> lands at (x=2, y=19) in rotation 3 (West)!
    // Fill everything around (x=2, y=19) except the exact T-shape in state 3 at (x=2, y=19):
    // State 3 at (x=2, y=19) occupies: (3,19), (2,20), (3,20), (3,21).
    for (let y = 17; y < TOTAL_ROWS; y++) {
      for (let x = 0; x < BOARD_WIDTH; x++) {
        board.grid[y][x] = { type: 'I', color: '#fff' };
      }
    }

    // Carve space for initial T piece at rotation 0 at (x=1, y=17):
    // State 0 occupies (2,17), (1,18), (2,18), (3,18)
    board.grid[17][2] = null;
    board.grid[18][1] = null;
    board.grid[18][2] = null;
    board.grid[18][3] = null;

    // Carve target TST pocket for state 3 at (x=2, y=19):
    // State 3 occupies (3,19), (2,20), (3,20), (3,21)
    board.grid[19][3] = null;
    board.grid[20][2] = null;
    board.grid[20][3] = null;
    board.grid[21][3] = null;

    const tPiece = { type: 'T', rotation: 0, x: 1, y: 17, color: '#ff2a5f' };
    assert.equal(board.isValidPosition(tPiece), true, 'Initial T position before TST kick must be valid');

    // Rotate CCW (0 -> 3): tests 0..3 are blocked by surrounding blocks, test 4 ([+1, +2]) succeeds!
    const kickResult = board.tryRotate(tPiece, -1);
    assert.equal(kickResult.success, true, 'TST wall kick 0->3 must succeed');
    assert.equal(kickResult.kickIndex, 4, 'Must use the 5th SRS kick test (index 4)');
    assert.equal(kickResult.x, 2);
    assert.equal(kickResult.y, 19);
    assert.equal(kickResult.rotation, 3);

    // Lock the kicked T piece and verify 3-corner T-Spin Full detection & Triple line clear
    tPiece.x = kickResult.x;
    tPiece.y = kickResult.y;
    tPiece.rotation = kickResult.rotation;
    board.lockPiece(tPiece);

    const tSpinType = board.detectTSpin(tPiece, true, kickResult.kickIndex);
    assert.equal(tSpinType, 'full', 'TST kick must be detected as a full T-Spin');

    const clearResult = board.clearLines();
    assert.equal(clearResult.linesCleared, 3, 'TST must clear 3 full lines');
  });
});

describe('Line Clear & Perfect Clear Logic', () => {
  it('clears completed rows, captures destroyed cell colors, and detects Perfect Clear', () => {
    const board = new Board();
    // Fill bottom 2 rows completely
    for (let y = TOTAL_ROWS - 2; y < TOTAL_ROWS; y++) {
      for (let x = 0; x < BOARD_WIDTH; x++) {
        board.grid[y][x] = { type: 'T', color: '#ff2a5f' };
      }
    }

    const res = board.clearLines();
    assert.equal(res.linesCleared, 2);
    assert.equal(res.destroyedCells.length, 20);
    assert.equal(res.isPerfectClear, true);
    assert.equal(board.isEmpty(), true);
  });
});

describe('Scoring Engine (B2B, Combo, T-Spin, Perfect Clear, Drops)', () => {
  it('scores Single, Double, Triple, and Tetris with level multiplier', () => {
    assert.equal(evaluateTurnScore({ linesCleared: 1, level: 2 }).points, 200);
    assert.equal(evaluateTurnScore({ linesCleared: 2, level: 2 }).points, 600);
    assert.equal(evaluateTurnScore({ linesCleared: 3, level: 2 }).points, 1000);
    assert.equal(evaluateTurnScore({ linesCleared: 4, level: 2 }).points, 1600);
  });

  it('applies Back-to-Back (1.5x) on consecutive Tetrises and T-Spin line clears', () => {
    const first = evaluateTurnScore({ linesCleared: 4, level: 1, b2bActive: false });
    assert.equal(first.points, 800);
    assert.equal(first.b2bActive, true);
    assert.equal(first.b2bTriggered, false);

    // Consecutive T-Spin Double with B2B active: 1200 * 1.5 = 1800 (+50 combo 1 = 1850)
    const second = evaluateTurnScore({
      linesCleared: 2,
      tSpin: 'full',
      level: 1,
      combo: first.combo,
      b2bActive: first.b2bActive,
    });
    assert.equal(second.b2bTriggered, true);
    assert.equal(second.points, 1800 + 50);

    // Normal Single breaks B2B
    const third = evaluateTurnScore({
      linesCleared: 1,
      tSpin: 'none',
      level: 1,
      combo: second.combo,
      b2bActive: second.b2bActive,
    });
    assert.equal(third.b2bActive, false);
  });

  it('awards Perfect Clear bonus and drop points properly', () => {
    const pc = evaluateTurnScore({
      linesCleared: 4,
      level: 1,
      isPerfectClear: true,
    });
    // 800 (Tetris) + 2000 (Tetris PC) = 2800
    assert.equal(pc.points, 2800);
    assert.ok(pc.callouts.includes('PERFECT CLEAR'));

    assert.equal(calculateDropScore(10, 'soft'), 10);
    assert.equal(calculateDropScore(10, 'hard'), 20);
  });
});

describe('Lock Delay Reset Rules, Hold Rules & Gravity Table', () => {
  it('follows the Guideline gravity curve monotonically across levels', () => {
    const lvl1 = getGravitySecondsPerRow(1);
    const lvl5 = getGravitySecondsPerRow(5);
    const lvl10 = getGravitySecondsPerRow(10);
    const lvl15 = getGravitySecondsPerRow(15);

    assert.equal(lvl1, 1.0);
    assert.ok(lvl5 < lvl1 && lvl10 < lvl5 && lvl15 < lvl10);
    // Formula check for level 5: (0.8 - 4*0.007)^4 = (0.772)^4
    assert.ok(Math.abs(lvl5 - Math.pow(0.772, 4)) < 1e-9);
  });

  it('enforces one hold per piece drop and unlocks hold after piece locks', () => {
    const game = new TetrisGame({ seed: 99 });
    game.start('marathon', 99);

    const firstType = game.activePiece.type;
    assert.equal(game.hold(), true, 'First hold should succeed');
    assert.equal(game.holdPieceType, firstType);
    assert.equal(game.canHold, false);
    assert.equal(game.hold(), false, 'Second hold before locking should be rejected');

    game.hardDrop();
    assert.equal(game.canHold, true, 'Hold should re-enable after hard drop locks the piece');
    assert.equal(game.hold(), true, 'Hold on next piece should succeed');
  });

  it('resets lock delay up to 15 times on ground moves and locks after 15 resets', () => {
    const game = new TetrisGame({ seed: 101 });
    game.start('marathon', 101);

    // Move piece to the floor without locking
    while (game.softDropStep()) {
      // drop until resting on bottom row
    }

    const initialPiecesPlaced = game.stats.piecesPlaced;

    // Advance 400ms (< 500ms lock delay), then move left/right 15 times
    for (let i = 0; i < MAX_LOCK_RESETS; i++) {
      game.update(400);
      assert.equal(game.stats.piecesPlaced, initialPiecesPlaced, `Should not lock before 500ms (reset #${i})`);
      const moved = game.moveLeft() || game.moveRight();
      assert.equal(moved, true);
    }

    assert.equal(game.lockResetCount, MAX_LOCK_RESETS);

    // 16th move should NOT reset lockTimerMs once accumulated
    game.update(400);
    game.moveLeft() || game.moveRight();
    game.update(150); // 400 + 150 = 550ms >= 500ms -> piece must lock!
    assert.equal(game.stats.piecesPlaced, initialPiecesPlaced + 1, 'Piece must lock once 15 resets are exhausted');
  });

  it('normalizes leaderboard player names to 7 characters max', () => {
    assert.equal(normalizeSevenCharName('ibrahim123'), 'IBRAHIM');
    assert.equal(normalizeSevenCharName('  tet_7 '), 'TET_7');
    assert.equal(normalizeSevenCharName(''), 'OYUNCU1');
  });
});
