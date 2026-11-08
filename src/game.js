// src/game.js
// Pure, frame-rate independent Tetris game state machine.
// Completely decoupled from DOM, Canvas, and Web Audio so it can be unit-tested in Node.

import { Board, HIDDEN_ROWS } from './board.js';
import { BagRandomizer } from './randomizer.js';
import { createPiece, generateLevelColorMap } from './pieces.js';
import {
  getGravityMs,
  getSpeedInfo,
  evaluateTurnScore,
  calculateDropScore,
} from './scoring.js';

export const GAME_STATES = Object.freeze({
  IDLE: 'IDLE',
  PLAYING: 'PLAYING',
  PAUSED: 'PAUSED',
  COUNTDOWN: 'COUNTDOWN',
  GAME_OVER: 'GAME_OVER',
  VICTORY: 'VICTORY',
});

export const LOCK_DELAY_MS = 500;
export const MAX_LOCK_RESETS = 15;
export const SPRINT_TARGET_LINES = 40;
export const ULTRA_DURATION_MS = 120_000; // 2 minutes

export class TetrisGame {
  constructor(options = {}) {
    this.seed = options.seed ?? Date.now();
    this.onEvent = options.onEvent || (() => {});

    this.settings = {
      theme: 'neon',
      colorblind: false,
      randomLevelColors: true,
      ghost: true,
      allow180: true,
      infinityLock: false,
      sdf: 20, // Soft drop factor multiplier
      ...options.settings,
    };

    this.board = new Board();
    this.randomizer = new BagRandomizer(this.seed);
    this.mode = 'marathon';
    this.state = GAME_STATES.IDLE;

    this._initSessionState();
  }

  _initSessionState() {
    this.score = 0;
    this.lines = 0;
    this.level = 1;
    this.combo = -1;
    this.b2bActive = false;
    this.elapsedMs = 0;

    // Detailed telemetry & stats
    this.stats = {
      piecesPlaced: 0,
      tetrisCount: 0,
      tSpinCount: 0,
      maxCombo: 0,
      perfectClears: 0,
      singleCount: 0,
      doubleCount: 0,
      tripleCount: 0,
    };

    this.colorMap = generateLevelColorMap({
      level: 1,
      theme: this.settings.theme,
      colorblind: this.settings.colorblind,
      randomLevelColors: this.settings.randomLevelColors,
      seed: this.seed,
    });

    this.activePiece = null;
    this.holdPieceType = null;
    this.canHold = true;

    // Gravity & lock delay timers
    this.gravityAccumulatorMs = 0;
    this.lockTimerMs = 0;
    this.lockResetCount = 0;
    this.lowestY = 0;

    // T-spin tracking for current piece
    this.lastActionWasRotation = false;
    this.lastKickIndex = 0;
  }

  /**
   * Starts a new game in the specified mode ('marathon' | 'sprint' | 'ultra' | 'zen').
   */
  start(mode = 'marathon', seed = Date.now()) {
    this.mode = mode;
    this.seed = seed;
    this.board.reset();
    this.randomizer.reset(seed);
    this._initSessionState();
    this.state = GAME_STATES.PLAYING;
    this._spawnNextPiece();
    this._emit('gameStart', {
      mode: this.mode,
      level: this.level,
      colorMap: { ...this.colorMap },
      speedInfo: this.getSpeedTelemetry(),
    });
  }

  updateSettings(partialSettings = {}) {
    const prevTheme = this.settings.theme;
    const prevCB = this.settings.colorblind;
    const prevRandom = this.settings.randomLevelColors;

    this.settings = { ...this.settings, ...partialSettings };

    if (
      prevTheme !== this.settings.theme ||
      prevCB !== this.settings.colorblind ||
      prevRandom !== this.settings.randomLevelColors
    ) {
      this.colorMap = generateLevelColorMap({
        level: this.level,
        theme: this.settings.theme,
        colorblind: this.settings.colorblind,
        randomLevelColors: this.settings.randomLevelColors,
        seed: this.seed,
      });
      if (this.activePiece) {
        this.activePiece.color = this.colorMap[this.activePiece.type];
      }
      this.board.applyColorMap(this.colorMap);
      this._emit('paletteChanged', { colorMap: { ...this.colorMap }, level: this.level });
    }
  }

  pause() {
    if (this.state === GAME_STATES.PLAYING) {
      this.state = GAME_STATES.PAUSED;
      this._emit('pause', {});
    }
  }

  resume() {
    if (this.state === GAME_STATES.PAUSED || this.state === GAME_STATES.COUNTDOWN) {
      this.state = GAME_STATES.PLAYING;
      this._emit('resume', {});
    }
  }

  /**
   * Advances simulation by `dtMs` milliseconds.
   */
  update(dtMs, isSoftDropping = false) {
    if (this.state !== GAME_STATES.PLAYING || !this.activePiece) return;

    this.elapsedMs += dtMs;

    // Check Ultra mode time limit (2 minutes)
    if (this.mode === 'ultra' && this.elapsedMs >= ULTRA_DURATION_MS) {
      this.elapsedMs = ULTRA_DURATION_MS;
      this.state = GAME_STATES.VICTORY;
      this._emit('gameOver', {
        reason: 'timeUp',
        victory: true,
        stats: this.getSummaryStats(),
      });
      return;
    }

    // Gravity calculation
    const baseGravityMs = this.mode === 'zen' ? Infinity : getGravityMs(this.level);
    const sdf = Math.max(1, Number(this.settings.sdf) || 20);
    const effectiveGravityMs = isSoftDropping
      ? Math.min(baseGravityMs, Math.max(8, (this.mode === 'zen' ? 500 : baseGravityMs) / sdf))
      : baseGravityMs;

    if (Number.isFinite(effectiveGravityMs)) {
      this.gravityAccumulatorMs += dtMs;
      while (this.gravityAccumulatorMs >= effectiveGravityMs) {
        this.gravityAccumulatorMs -= effectiveGravityMs;
        if (this._canMoveDown()) {
          this.activePiece.y += 1;
          this.lastActionWasRotation = false;
          if (isSoftDropping) {
            const pts = calculateDropScore(1, 'soft');
            this.score += pts;
            this._emit('softDropStep', { points: pts });
          }
          this._updateLowestY();
        } else {
          this.gravityAccumulatorMs = 0;
          break;
        }
      }
    }

    // Lock delay processing when resting on a surface
    if (!this._canMoveDown()) {
      this.lockTimerMs += dtMs;
      if (this.lockTimerMs >= LOCK_DELAY_MS) {
        this._lockActivePiece();
      }
    } else {
      this.lockTimerMs = 0;
    }
  }

  _canMoveDown() {
    if (!this.activePiece) return false;
    return this.board.isValidPosition(this.activePiece, 0, 1, this.activePiece.rotation);
  }

  _updateLowestY() {
    if (!this.activePiece) return;
    if (this.activePiece.y > this.lowestY) {
      this.lowestY = this.activePiece.y;
      this.lockResetCount = 0;
      this.lockTimerMs = 0;
    }
  }

  /**
   * Resets lock timer on valid move/rotation if allowed by the 15-reset rule (or infinity setting).
   */
  _registerMoveOrRotateReset() {
    const maxResets = this.settings.infinityLock ? Infinity : MAX_LOCK_RESETS;
    if (this.lockResetCount < maxResets) {
      this.lockTimerMs = 0;
      if (!this._canMoveDown()) {
        this.lockResetCount += 1;
      }
    }
  }

  moveLeft() {
    if (this.state !== GAME_STATES.PLAYING || !this.activePiece) return false;
    if (this.board.isValidPosition(this.activePiece, -1, 0)) {
      this.activePiece.x -= 1;
      this.lastActionWasRotation = false;
      this._registerMoveOrRotateReset();
      this._emit('move', { dir: -1, x: this.activePiece.x, y: this.activePiece.y });
      return true;
    }
    return false;
  }

  moveRight() {
    if (this.state !== GAME_STATES.PLAYING || !this.activePiece) return false;
    if (this.board.isValidPosition(this.activePiece, 1, 0)) {
      this.activePiece.x += 1;
      this.lastActionWasRotation = false;
      this._registerMoveOrRotateReset();
      this._emit('move', { dir: 1, x: this.activePiece.x, y: this.activePiece.y });
      return true;
    }
    return false;
  }

  softDropStep() {
    if (this.state !== GAME_STATES.PLAYING || !this.activePiece) return false;
    if (this._canMoveDown()) {
      this.activePiece.y += 1;
      this.lastActionWasRotation = false;
      const pts = calculateDropScore(1, 'soft');
      this.score += pts;
      this._updateLowestY();
      this._emit('softDropStep', { points: pts, y: this.activePiece.y });
      return true;
    }
    return false;
  }

  hardDrop() {
    if (this.state !== GAME_STATES.PLAYING || !this.activePiece) return 0;
    const startY = this.activePiece.y;
    const targetY = this.board.getGhostY(this.activePiece);
    const cellsDropped = Math.max(0, targetY - startY);

    if (cellsDropped > 0) {
      this.activePiece.y = targetY;
      this.lastActionWasRotation = false;
      this.score += calculateDropScore(cellsDropped, 'hard');
    }

    this._emit('hardDrop', {
      piece: { ...this.activePiece },
      startY,
      endY: targetY,
      cellsDropped,
    });

    this._lockActivePiece();
    return cellsDropped;
  }

  /**
   * Rotate active piece: dir = 1 (CW), -1 (CCW), 2 (180°).
   */
  rotate(dir = 1) {
    if (this.state !== GAME_STATES.PLAYING || !this.activePiece) return false;
    if (dir === 2 && !this.settings.allow180) return false;

    const result = this.board.tryRotate(this.activePiece, dir);
    if (result.success) {
      this.activePiece.x = result.x;
      this.activePiece.y = result.y;
      this.activePiece.rotation = result.rotation;
      this.lastActionWasRotation = true;
      this.lastKickIndex = result.kickIndex;
      this._updateLowestY();
      this._registerMoveOrRotateReset();
      this._emit('rotate', {
        dir,
        rotation: result.rotation,
        kickIndex: result.kickIndex,
        kickOffset: result.kickOffset,
      });
      return true;
    }
    return false;
  }

  /**
   * Swaps the active piece with the Hold slot (max once per drop).
   */
  hold() {
    if (this.state !== GAME_STATES.PLAYING || !this.activePiece || !this.canHold) {
      return false;
    }

    const currentType = this.activePiece.type;
    const previousHold = this.holdPieceType;
    this.holdPieceType = currentType;
    this.canHold = false;

    if (previousHold) {
      this._spawnSpecificPiece(previousHold);
    } else {
      this._spawnNextPiece(false);
    }

    this._emit('hold', { holdPieceType: this.holdPieceType });
    return true;
  }

  _spawnNextPiece(resetHoldFlag = true) {
    const nextType = this.randomizer.next();
    if (resetHoldFlag) {
      this.canHold = true;
    }
    this._spawnSpecificPiece(nextType);
  }

  _spawnSpecificPiece(type) {
    const piece = createPiece(type, this.colorMap);
    this.activePiece = piece;
    this.gravityAccumulatorMs = 0;
    this.lockTimerMs = 0;
    this.lockResetCount = 0;
    this.lowestY = piece.y;
    this.lastActionWasRotation = false;
    this.lastKickIndex = 0;

    // Check Guideline Block Out condition
    if (!this.board.isValidPosition(piece, 0, 0)) {
      if (this.board.isValidPosition(piece, 0, -1)) {
        piece.y -= 1;
      } else if (this.mode === 'zen') {
        this._zenReliefClear();
      } else {
        this.state = GAME_STATES.GAME_OVER;
        this._emit('gameOver', {
          reason: 'blockOut',
          victory: false,
          stats: this.getSummaryStats(),
        });
      }
    }
  }

  _zenReliefClear() {
    // In Zen mode, clear the upper half of the board with colorful particles instead of ending the game
    const destroyedCells = [];
    for (let y = 0; y < 12; y++) {
      for (let x = 0; x < this.board.width; x++) {
        if (this.board.grid[y][x]) {
          destroyedCells.push({
            x,
            y,
            ...this.board.grid[y][x],
          });
          this.board.grid[y][x] = null;
        }
      }
    }
    this._emit('zenClear', { destroyedCells });
  }

  _lockActivePiece() {
    if (!this.activePiece) return;

    const piece = this.activePiece;
    const { lockedCells, lockOut } = this.board.lockPiece(piece);
    this.stats.piecesPlaced += 1;

    // Detect T-Spin BEFORE clearing lines (3-corner rule requires surrounding blocks intact)
    const tSpin = this.board.detectTSpin(piece, this.lastActionWasRotation, this.lastKickIndex);
    if (tSpin !== 'none') {
      this.stats.tSpinCount += 1;
    }

    // Clear full rows
    const { linesCleared, clearedRows, destroyedCells, isPerfectClear } = this.board.clearLines();

    if (linesCleared === 1) this.stats.singleCount += 1;
    else if (linesCleared === 2) this.stats.doubleCount += 1;
    else if (linesCleared === 3) this.stats.tripleCount += 1;
    else if (linesCleared >= 4) this.stats.tetrisCount += 1;

    if (isPerfectClear) {
      this.stats.perfectClears += 1;
    }

    // Evaluate Guideline score
    const scoreResult = evaluateTurnScore({
      linesCleared,
      tSpin,
      level: this.level,
      combo: this.combo,
      b2bActive: this.b2bActive,
      isPerfectClear,
    });

    this.score += scoreResult.points;
    this.combo = scoreResult.combo;
    this.b2bActive = scoreResult.b2bActive;
    if (this.combo > this.stats.maxCombo) {
      this.stats.maxCombo = this.combo;
    }

    const prevLevel = this.level;
    this.lines += linesCleared;

    // Level progression every 10 lines
    const computedLevel = Math.floor(this.lines / 10) + 1;
    const leveledUp = computedLevel > prevLevel;
    if (leveledUp) {
      this.level = computedLevel;
      // Randomize piece colors on every new level as requested ("her yeni bölümde random olarak değişsin")
      this.colorMap = generateLevelColorMap({
        level: this.level,
        theme: this.settings.theme,
        colorblind: this.settings.colorblind,
        randomLevelColors: this.settings.randomLevelColors,
        previousMap: this.colorMap,
        seed: this.seed,
      });
    }

    this._emit('pieceLocked', {
      piece,
      lockedCells,
      linesCleared,
      clearedRows,
      destroyedCells,
      tSpin,
      isPerfectClear,
      scoreAdded: scoreResult.points,
      combo: this.combo,
      b2bTriggered: scoreResult.b2bTriggered,
      callouts: scoreResult.callouts,
      leveledUp,
      level: this.level,
      colorMap: { ...this.colorMap },
    });

    if (leveledUp) {
      this._emit('levelUp', {
        level: this.level,
        colorMap: { ...this.colorMap },
        speedInfo: this.getSpeedTelemetry(),
      });
    }

    // Check Lock Out condition (all cells locked in hidden rows)
    if (lockOut && linesCleared === 0) {
      if (this.mode === 'zen') {
        this._zenReliefClear();
      } else {
        this.state = GAME_STATES.GAME_OVER;
        this._emit('gameOver', {
          reason: 'lockOut',
          victory: false,
          stats: this.getSummaryStats(),
        });
        return;
      }
    }

    // Check Sprint mode victory (40 lines cleared)
    if (this.mode === 'sprint' && this.lines >= SPRINT_TARGET_LINES) {
      this.state = GAME_STATES.VICTORY;
      this._emit('gameOver', {
        reason: 'sprintComplete',
        victory: true,
        stats: this.getSummaryStats(),
      });
      return;
    }

    // Spawn next piece
    this._spawnNextPiece(true);
  }

  getNextQueue(count = 5) {
    return this.randomizer.peek(count);
  }

  getGhostY() {
    if (!this.activePiece) return 0;
    return this.board.getGhostY(this.activePiece);
  }

  getSpeedTelemetry() {
    return getSpeedInfo(this.level, this.mode);
  }

  getSummaryStats() {
    const seconds = Math.max(0.001, this.elapsedMs / 1000);
    const pps = Number((this.stats.piecesPlaced / seconds).toFixed(2));
    return {
      mode: this.mode,
      score: this.score,
      lines: this.lines,
      level: this.level,
      elapsedMs: Math.round(this.elapsedMs),
      pps,
      pieces: this.stats.piecesPlaced,
      tetrisCount: this.stats.tetrisCount,
      tSpinCount: this.stats.tSpinCount,
      maxCombo: Math.max(0, this.stats.maxCombo),
      perfectClears: this.stats.perfectClears,
      speedInfo: this.getSpeedTelemetry(),
    };
  }

  /**
   * Serializes the entire game state so an in-progress game can be saved & restored.
   */
  serialize() {
    return {
      mode: this.mode,
      state: this.state,
      seed: this.seed,
      score: this.score,
      lines: this.lines,
      level: this.level,
      combo: this.combo,
      b2bActive: this.b2bActive,
      elapsedMs: this.elapsedMs,
      stats: { ...this.stats },
      colorMap: { ...this.colorMap },
      activePiece: this.activePiece ? { ...this.activePiece } : null,
      holdPieceType: this.holdPieceType,
      canHold: this.canHold,
      board: this.board.serialize(),
      randomizer: this.randomizer.serialize(),
    };
  }

  restore(snapshot) {
    if (!snapshot || !snapshot.board) return false;
    this.mode = snapshot.mode || 'marathon';
    this.seed = snapshot.seed || Date.now();
    this.score = snapshot.score || 0;
    this.lines = snapshot.lines || 0;
    this.level = snapshot.level || 1;
    this.combo = snapshot.combo ?? -1;
    this.b2bActive = Boolean(snapshot.b2bActive);
    this.elapsedMs = snapshot.elapsedMs || 0;
    this.stats = { ...this.stats, ...(snapshot.stats || {}) };
    this.colorMap = snapshot.colorMap || this.colorMap;
    this.activePiece = snapshot.activePiece ? { ...snapshot.activePiece } : null;
    this.holdPieceType = snapshot.holdPieceType || null;
    this.canHold = snapshot.canHold !== false;
    this.board.restore(snapshot.board);
    this.randomizer.restore(snapshot.randomizer);
    this.state = GAME_STATES.PAUSED;
    return true;
  }

  _emit(type, payload) {
    if (typeof this.onEvent === 'function') {
      this.onEvent(type, payload);
    }
  }
}
