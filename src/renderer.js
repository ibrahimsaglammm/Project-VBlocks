// src/renderer.js
// HiDPI-aware 2D Canvas renderer with offscreen block sprite caching,
// animated starfield background, ghost piece, lock-delay visual cue,
// Next-5 queue, Hold slot, and game-over cascade animation.

import { BOARD_WIDTH, VISIBLE_ROWS, HIDDEN_ROWS, TOTAL_ROWS } from './board.js';
import { SHAPES } from './pieces.js';
import { LOCK_DELAY_MS } from './game.js';

export class Renderer {
  constructor({ boardCanvas, holdCanvas, nextCanvas, bgCanvas, effects, settings = {} }) {
    this.boardCanvas = boardCanvas;
    this.boardCtx = boardCanvas.getContext('2d', { alpha: false });

    this.holdCanvas = holdCanvas;
    this.holdCtx = holdCanvas ? holdCanvas.getContext('2d') : null;

    this.nextCanvas = nextCanvas;
    this.nextCtx = nextCanvas ? nextCanvas.getContext('2d') : null;

    this.bgCanvas = bgCanvas;
    this.bgCtx = bgCanvas ? bgCanvas.getContext('2d') : null;

    this.effects = effects;
    this.settings = {
      theme: 'neon',
      grid: true,
      ghost: true,
      colorblind: false,
      reducedMotion: false,
      ...settings,
    };

    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.cellSize = 28;
    this.boardWidthPx = BOARD_WIDTH * this.cellSize;
    this.boardHeightPx = VISIBLE_ROWS * this.cellSize;

    // Offscreen sprite cache: key = `${color}_${size}_${theme}`
    this.spriteCache = new Map();

    // Animated starfield particles for background canvas
    this.stars = Array.from({ length: 55 }, () => ({
      x: Math.random(),
      y: Math.random(),
      size: 0.8 + Math.random() * 1.8,
      speed: 0.008 + Math.random() * 0.025,
      phase: Math.random() * Math.PI * 2,
    }));

    // Game-over collapse progress (0 .. 1)
    this.gameOverAnim = 0;
  }

  updateSettings(partial = {}) {
    const themeChanged = partial.theme && partial.theme !== this.settings.theme;
    this.settings = { ...this.settings, ...partial };
    if (themeChanged) {
      this.spriteCache.clear();
    }
  }

  /**
   * Resizes canvases to fit their CSS container cleanly with HiDPI crispness.
   */
  resize(containerWidth, containerHeight) {
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    const vw = window.innerWidth || containerWidth;
    const isCompactMobile = vw < 600;

    // Side mini canvases scale first so we know exact width available for the main board
    const miniCell = isCompactMobile
      ? Math.max(9, Math.min(12, Math.floor(vw / 34)))
      : Math.max(13, Math.min(20, Math.floor(containerHeight / 28)));
    this.miniCellSize = miniCell;

    const holdW = Math.round(miniCell * 4.2);
    const holdH = Math.round(miniCell * 3.0);
    const nextW = Math.round(miniCell * 4.2);
    const nextH = Math.round(miniCell * 14.2);

    if (this.holdCanvas && this.holdCtx) {
      this._setupHiDPICanvas(this.holdCanvas, this.holdCtx, holdW, holdH);
    }

    if (this.nextCanvas && this.nextCtx) {
      this._setupHiDPICanvas(this.nextCanvas, this.nextCtx, nextW, nextH);
    }

    // Reserve space for left (Hold) + right (Next) panels + gaps
    const sidePanelsWidth = holdW + nextW + (isCompactMobile ? 34 : 56);
    const usableBoardWidth = Math.max(140, Math.min(containerWidth, vw - sidePanelsWidth));
    const usableBoardHeight = Math.max(240, containerHeight - 8);

    // Compute largest integer cellSize that fits 10x20 inside usable area
    const maxCellW = Math.floor(usableBoardWidth / BOARD_WIDTH);
    const maxCellH = Math.floor(usableBoardHeight / VISIBLE_ROWS);
    const newCellSize = Math.max(13, Math.min(maxCellW, maxCellH));

    if (newCellSize !== this.cellSize) {
      this.cellSize = newCellSize;
      this.spriteCache.clear();
    }

    this.boardWidthPx = BOARD_WIDTH * this.cellSize;
    this.boardHeightPx = VISIBLE_ROWS * this.cellSize;

    this._setupHiDPICanvas(this.boardCanvas, this.boardCtx, this.boardWidthPx, this.boardHeightPx);

    if (this.bgCanvas && this.bgCtx) {
      this._setupHiDPICanvas(
        this.bgCanvas,
        this.bgCtx,
        window.innerWidth,
        window.innerHeight
      );
    }
  }

  _setupHiDPICanvas(canvas, ctx, cssWidth, cssHeight) {
    const w = Math.round(cssWidth);
    const h = Math.round(cssHeight);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    canvas.width = Math.round(w * this.dpr);
    canvas.height = Math.round(h * this.dpr);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  /**
   * Returns a cached offscreen canvas containing a glossy/bevelled block sprite.
   */
  _getBlockSprite(color, size) {
    const key = `${color}_${size}_${this.settings.theme}_${this.dpr}`;
    const cached = this.spriteCache.get(key);
    if (cached) return cached;

    const offscreen = document.createElement('canvas');
    offscreen.width = Math.ceil(size * this.dpr);
    offscreen.height = Math.ceil(size * this.dpr);
    const ctx = offscreen.getContext('2d');
    ctx.scale(this.dpr, this.dpr);

    const pad = 1;
    const inner = size - pad * 2;
    const r = Math.max(2, size * 0.14);

    // Base fill
    ctx.fillStyle = color;
    this._roundRect(ctx, pad, pad, inner, inner, r);
    ctx.fill();

    if (this.settings.theme !== 'minimal') {
      // Top-left glossy highlight bevel
      const grad = ctx.createLinearGradient(pad, pad, pad, pad + inner);
      grad.addColorStop(0, 'rgba(255, 255, 255, 0.42)');
      grad.addColorStop(0.45, 'rgba(255, 255, 255, 0.06)');
      grad.addColorStop(1, 'rgba(0, 0, 0, 0.34)');
      ctx.fillStyle = grad;
      this._roundRect(ctx, pad, pad, inner, inner, r);
      ctx.fill();

      // Inner jewel specularity
      const inset = Math.max(3, size * 0.2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
      this._roundRect(
        ctx,
        inset,
        inset,
        size - inset * 2,
        (size - inset * 2) * 0.5,
        Math.max(1, r * 0.5)
      );
      ctx.fill();

      // Crisp border
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
      ctx.lineWidth = 1;
      this._roundRect(ctx, pad + 0.5, pad + 0.5, inner - 1, inner - 1, r);
      ctx.stroke();
    } else {
      // Minimal flat style with subtle inner border
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
      ctx.lineWidth = 1.2;
      this._roundRect(ctx, pad + 0.5, pad + 0.5, inner - 1, inner - 1, r);
      ctx.stroke();
    }

    this.spriteCache.set(key, offscreen);
    return offscreen;
  }

  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /**
   * Draws a single cell at board coordinates (col, visibleRow).
   */
  _drawCell(ctx, col, visRow, color, size, alpha = 1, pieceType = null) {
    if (visRow < 0 || visRow >= VISIBLE_ROWS) return;
    const sprite = this._getBlockSprite(color, size);
    const px = col * size;
    const py = visRow * size;

    ctx.save();
    if (alpha < 1) ctx.globalAlpha = alpha;
    ctx.drawImage(sprite, px, py, size, size);

    // Optional colorblind symbol overlay so pieces are distinguishable even without color
    if (this.settings.colorblind && pieceType) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.font = `bold ${Math.max(9, Math.round(size * 0.42))}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(pieceType, px + size * 0.5, py + size * 0.52);
    }
    ctx.restore();
  }

  /**
   * Renders the subtle animated background starfield.
   */
  renderBackground(dtMs, level = 1) {
    if (!this.bgCtx || !this.bgCanvas) return;
    const ctx = this.bgCtx;
    const w = this.bgCanvas.width / this.dpr;
    const h = this.bgCanvas.height / this.dpr;

    ctx.clearRect(0, 0, w, h);

    if (this.settings.reducedMotion) return;

    const speedFactor = (1 + (level - 1) * 0.18) * (dtMs / 16.67);
    ctx.fillStyle = this.settings.theme === 'minimal'
      ? 'rgba(100, 116, 139, 0.25)'
      : 'rgba(148, 210, 255, 0.45)';

    for (let i = 0; i < this.stars.length; i++) {
      const s = this.stars[i];
      s.y += s.speed * 0.015 * speedFactor;
      s.phase += 0.03 * speedFactor;
      if (s.y > 1) {
        s.y = 0;
        s.x = Math.random();
      }
      const alpha = 0.25 + 0.45 * Math.sin(s.phase);
      ctx.globalAlpha = Math.max(0.1, alpha);
      ctx.beginPath();
      ctx.arc(s.x * w, s.y * h, s.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /**
   * Main render method called each animation frame.
   */
  render(game, dtMs) {
    const ctx = this.boardCtx;
    const cs = this.cellSize;
    const w = this.boardWidthPx;
    const h = this.boardHeightPx;

    ctx.save();

    // Board background fill
    ctx.fillStyle = this.settings.theme === 'minimal' ? '#f8fafc' : '#080b16';
    ctx.fillRect(0, 0, w, h);

    // Apply screen shake offset
    if (this.effects && (this.effects.shakeOffsetX !== 0 || this.effects.shakeOffsetY !== 0)) {
      ctx.translate(this.effects.shakeOffsetX, this.effects.shakeOffsetY);
    }

    // Subtle grid lines
    if (this.settings.grid) {
      ctx.strokeStyle =
        this.settings.theme === 'minimal'
          ? 'rgba(15, 23, 42, 0.07)'
          : 'rgba(148, 163, 184, 0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 1; x < BOARD_WIDTH; x++) {
        ctx.moveTo(x * cs + 0.5, 0);
        ctx.lineTo(x * cs + 0.5, h);
      }
      for (let y = 1; y < VISIBLE_ROWS; y++) {
        ctx.moveTo(0, y * cs + 0.5);
        ctx.lineTo(w, y * cs + 0.5);
      }
      ctx.stroke();
    }

    // Underlay effects (hard drop light beams, row flashes)
    if (this.effects) {
      this.effects.renderUnderlay(ctx, cs, w);
    }

    // Locked board cells
    const isGameOver = game.state === 'GAME_OVER';
    if (isGameOver) {
      this.gameOverAnim = Math.min(1, this.gameOverAnim + dtMs / 900);
    } else {
      this.gameOverAnim = 0;
    }

    const collapseRowCutoff = isGameOver
      ? Math.floor((1 - this.gameOverAnim) * VISIBLE_ROWS)
      : VISIBLE_ROWS;

    for (let y = HIDDEN_ROWS; y < TOTAL_ROWS; y++) {
      const visRow = y - HIDDEN_ROWS;
      for (let x = 0; x < BOARD_WIDTH; x++) {
        const cell = game.board.grid[y][x];
        if (!cell) continue;
        const color = isGameOver && visRow >= collapseRowCutoff ? '#475569' : cell.color;
        this._drawCell(ctx, x, visRow, color, cs, 1, cell.type);
      }
    }

    // Ghost piece & Active piece
    const active = game.activePiece;
    if (active && game.state !== 'GAME_OVER') {
      const matrix = SHAPES[active.type][active.rotation];

      // Ghost piece
      if (this.settings.ghost) {
        const ghostY = game.getGhostY();
        if (ghostY > active.y) {
          ctx.save();
          for (let r = 0; r < matrix.length; r++) {
            for (let c = 0; c < matrix[r].length; c++) {
              if (!matrix[r][c]) continue;
              const gx = active.x + c;
              const gy = ghostY + r - HIDDEN_ROWS;
              if (gy < 0 || gy >= VISIBLE_ROWS) continue;

              const px = gx * cs + 2;
              const py = gy * cs + 2;
              const inner = cs - 4;
              ctx.fillStyle = active.color;
              ctx.globalAlpha = 0.16;
              this._roundRect(ctx, px, py, inner, inner, 3);
              ctx.fill();

              ctx.globalAlpha = 0.58;
              ctx.strokeStyle = active.color;
              ctx.lineWidth = 1.5;
              ctx.stroke();
            }
          }
          ctx.restore();
        }
      }

      // Active piece with lock-delay pulse feedback
      let lockAlpha = 1;
      if (game.lockTimerMs > 0) {
        const lockProgress = Math.min(1, game.lockTimerMs / LOCK_DELAY_MS);
        lockAlpha = 1 - lockProgress * 0.32;
      }

      for (let r = 0; r < matrix.length; r++) {
        for (let c = 0; c < matrix[r].length; c++) {
          if (!matrix[r][c]) continue;
          const px = active.x + c;
          const py = active.y + r - HIDDEN_ROWS;
          this._drawCell(ctx, px, py, active.color, cs, lockAlpha, active.type);
        }
      }
    }

    // Overlay effects (particles, lock flashes, callouts, level pulse)
    if (this.effects) {
      this.effects.renderOverlay(ctx, cs, w, h);
    }

    ctx.restore();

    // Render Hold & Next-5 mini canvases
    this._renderHold(game);
    this._renderNextQueue(game);
  }

  _renderHold(game) {
    if (!this.holdCtx || !this.holdCanvas) return;
    const ctx = this.holdCtx;
    const w = this.holdCanvas.width / this.dpr;
    const h = this.holdCanvas.height / this.dpr;
    ctx.clearRect(0, 0, w, h);

    if (!game.holdPieceType) return;

    const color = game.canHold
      ? game.colorMap[game.holdPieceType]
      : '#64748b';
    this._drawMiniPiece(ctx, game.holdPieceType, color, w * 0.5, h * 0.5, this.miniCellSize);
  }

  _renderNextQueue(game) {
    if (!this.nextCtx || !this.nextCanvas) return;
    const ctx = this.nextCtx;
    const w = this.nextCanvas.width / this.dpr;
    const h = this.nextCanvas.height / this.dpr;
    ctx.clearRect(0, 0, w, h);

    const queue = game.getNextQueue(5);
    const slotHeight = h / 5;

    for (let i = 0; i < queue.length; i++) {
      const type = queue[i];
      const color = game.colorMap[type] || '#00e5ff';
      const scale = i === 0 ? 1.0 : 0.88;
      this._drawMiniPiece(
        ctx,
        type,
        color,
        w * 0.5,
        slotHeight * (i + 0.5),
        Math.round(this.miniCellSize * scale)
      );
    }
  }

  _drawMiniPiece(ctx, type, color, centerX, centerY, cellSize) {
    const matrix = SHAPES[type][0];
    let minR = 4, maxR = -1, minC = 4, maxC = -1;
    for (let r = 0; r < matrix.length; r++) {
      for (let c = 0; c < matrix[r].length; c++) {
        if (matrix[r][c]) {
          if (r < minR) minR = r;
          if (r > maxR) maxR = r;
          if (c < minC) minC = c;
          if (c > maxC) maxC = c;
        }
      }
    }

    const pieceW = (maxC - minC + 1) * cellSize;
    const pieceH = (maxR - minR + 1) * cellSize;
    const startX = centerX - pieceW * 0.5;
    const startY = centerY - pieceH * 0.5;

    const sprite = this._getBlockSprite(color, cellSize);
    for (let r = minR; r <= maxR; r++) {
      for (let c = minC; c <= maxC; c++) {
        if (!matrix[r][c]) continue;
        const x = startX + (c - minC) * cellSize;
        const y = startY + (r - minR) * cellSize;
        ctx.drawImage(sprite, x, y, cellSize, cellSize);
      }
    }
  }
}
