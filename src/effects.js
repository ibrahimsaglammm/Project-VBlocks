// src/effects.js
// High-performance visual effects system with object-pooled particles (zero GC churn in hot loop),
// colorful per-block explosions on line clears, hard-drop trails, lock squash/flash,
// screen shake, level-up pulse, and floating action callouts.

import { HIDDEN_ROWS } from './board.js';
import { SHAPES } from './pieces.js';

const MAX_PARTICLES = 400;

export class EffectsManager {
  constructor(settings = {}) {
    this.settings = {
      particles: true,
      screenShake: true,
      reducedMotion: false,
      ...settings,
    };

    // Pre-allocated particle pool to avoid per-frame allocations
    this.pool = Array.from({ length: MAX_PARTICLES }, () => ({
      active: false,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      size: 4,
      color: '#ffffff',
      alpha: 1,
      life: 0,
      maxLife: 500,
      rotation: 0,
      vRot: 0,
      shape: 'shard', // 'shard' | 'spark' | 'ring'
    }));
    this.activeCount = 0;
    this.qualityScale = 1.0; // Adaptive quality multiplier (0.35 .. 1.0)

    // Hard-drop vertical light beams
    this.trails = [];

    // Recently locked cell flashes / squash
    this.lockFlashes = [];

    // Row clear flash bars
    this.rowFlashes = [];

    // Floating callout banners ("TETRIS", "T-SPIN DOUBLE", "COMBO x3", etc.)
    this.callouts = [];

    // Screen shake state
    this.shakeTimeMs = 0;
    this.shakeDurationMs = 0;
    this.shakeIntensity = 0;
    this.shakeOffsetX = 0;
    this.shakeOffsetY = 0;

    // Level-up border pulse
    this.levelPulse = 0;
  }

  updateSettings(partial = {}) {
    this.settings = { ...this.settings, ...partial };
  }

  setQualityScale(scale) {
    this.qualityScale = Math.max(0.3, Math.min(1.0, scale));
  }

  _acquireParticle() {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (!this.pool[i].active) {
        this.pool[i].active = true;
        return this.pool[i];
      }
    }
    return null;
  }

  /**
   * Spawns colorful particle explosions for each destroyed cell when lines are cleared.
   * Each cell explodes in its own color plus bright core sparks.
   */
  spawnLineExplosion(destroyedCells, cellSize) {
    if (!this.settings.particles || this.settings.reducedMotion) return;

    const countPerCell = Math.max(
      4,
      Math.round((destroyedCells.length >= 30 ? 9 : 12) * this.qualityScale)
    );

    for (let i = 0; i < destroyedCells.length; i++) {
      const cell = destroyedCells[i];
      const visRow = cell.y - HIDDEN_ROWS;
      if (visRow < 0) continue;

      const cx = (cell.x + 0.5) * cellSize;
      const cy = (visRow + 0.5) * cellSize;

      // Expanding shockwave ring per cell
      const ring = this._acquireParticle();
      if (ring) {
        ring.x = cx;
        ring.y = cy;
        ring.vx = 0;
        ring.vy = 0;
        ring.size = cellSize * 0.25;
        ring.color = cell.color;
        ring.alpha = 0.9;
        ring.life = 0;
        ring.maxLife = 360;
        ring.shape = 'ring';
      }

      // Colorful shards & glowing sparks
      for (let p = 0; p < countPerCell; p++) {
        const pt = this._acquireParticle();
        if (!pt) break;

        const angle = Math.random() * Math.PI * 2;
        const speed = (1.5 + Math.random() * 6.5) * (cellSize / 28);
        pt.x = cx + (Math.random() - 0.5) * cellSize * 0.6;
        pt.y = cy + (Math.random() - 0.5) * cellSize * 0.6;
        pt.vx = Math.cos(angle) * speed;
        pt.vy = Math.sin(angle) * speed - (1.2 + Math.random() * 2.0);
        pt.size = (2.5 + Math.random() * 5.5) * (cellSize / 28);
        // Mix cell's primary color with occasional white-hot spark
        pt.color = p % 5 === 0 ? '#ffffff' : cell.color;
        pt.alpha = 1;
        pt.life = 0;
        pt.maxLife = 420 + Math.random() * 420;
        pt.rotation = Math.random() * Math.PI * 2;
        pt.vRot = (Math.random() - 0.5) * 0.22;
        pt.shape = p % 3 === 0 ? 'spark' : 'shard';
      }
    }
  }

  /**
   * Spawns horizontal flash bars across cleared rows.
   */
  spawnRowFlashes(clearedRows) {
    for (let i = 0; i < clearedRows.length; i++) {
      const visRow = clearedRows[i] - HIDDEN_ROWS;
      if (visRow >= 0) {
        this.rowFlashes.push({
          row: visRow,
          life: 0,
          maxLife: 240,
        });
      }
    }
  }

  /**
   * Spawns a vertical light trail when a piece hard drops.
   */
  spawnHardDropTrail(piece, startY, endY, cellSize) {
    if (this.settings.reducedMotion || endY <= startY) return;
    const matrix = SHAPES[piece.type][piece.rotation];
    let minCol = 4;
    let maxCol = 0;
    for (let r = 0; r < matrix.length; r++) {
      for (let c = 0; c < matrix[r].length; c++) {
        if (matrix[r][c]) {
          if (c < minCol) minCol = c;
          if (c > maxCol) maxCol = c;
        }
      }
    }

    this.trails.push({
      x: piece.x + minCol,
      widthCols: maxCol - minCol + 1,
      startY: Math.max(0, startY - HIDDEN_ROWS),
      endY: Math.max(0, endY - HIDDEN_ROWS + 1),
      color: piece.color,
      life: 0,
      maxLife: 200,
    });

    // Small dust sparks on hard drop impact
    if (this.settings.particles) {
      const impactX = (piece.x + (minCol + maxCol + 1) * 0.5) * cellSize;
      const impactY = Math.max(0, endY - HIDDEN_ROWS + 1.5) * cellSize;
      for (let i = 0; i < 6; i++) {
        const pt = this._acquireParticle();
        if (!pt) break;
        pt.x = impactX + (Math.random() - 0.5) * cellSize * 1.5;
        pt.y = impactY;
        pt.vx = (Math.random() - 0.5) * 3.5;
        pt.vy = -(0.8 + Math.random() * 2.5);
        pt.size = 3;
        pt.color = piece.color;
        pt.alpha = 0.85;
        pt.life = 0;
        pt.maxLife = 260;
        pt.rotation = 0;
        pt.vRot = 0.1;
        pt.shape = 'spark';
      }
    }
  }

  /**
   * Spawns a brief squash/glow animation on newly locked cells.
   */
  spawnLockFlash(lockedCells) {
    for (let i = 0; i < lockedCells.length; i++) {
      const cell = lockedCells[i];
      const visRow = cell.y - HIDDEN_ROWS;
      if (visRow >= 0) {
        this.lockFlashes.push({
          x: cell.x,
          y: visRow,
          color: cell.color,
          life: 0,
          maxLife: 180,
        });
      }
    }
  }

  /**
   * Triggers camera shake (respects screenShake and reducedMotion settings).
   */
  triggerShake(intensity = 6, durationMs = 200) {
    if (!this.settings.screenShake || this.settings.reducedMotion) return;
    this.shakeIntensity = Math.max(this.shakeIntensity, intensity);
    this.shakeDurationMs = Math.max(this.shakeDurationMs, durationMs);
    this.shakeTimeMs = 0;
  }

  triggerLevelUpPulse() {
    if (this.settings.reducedMotion) return;
    this.levelPulse = 1.0;
  }

  /**
   * Adds a floating text callout on the playfield ("TETRIS", "T-SPIN DOUBLE", "B2B", etc.).
   */
  addCallout(text, color = '#00e5ff') {
    const verticalOffset = this.callouts.length * 28;
    this.callouts.push({
      text,
      color,
      offsetY: verticalOffset,
      life: 0,
      maxLife: 1150,
    });
  }

  update(dtMs) {
    // Update screen shake
    if (this.shakeTimeMs < this.shakeDurationMs) {
      this.shakeTimeMs += dtMs;
      const progress = 1 - Math.min(1, this.shakeTimeMs / this.shakeDurationMs);
      const mag = this.shakeIntensity * progress;
      this.shakeOffsetX = (Math.random() * 2 - 1) * mag;
      this.shakeOffsetY = (Math.random() * 2 - 1) * mag;
    } else {
      this.shakeOffsetX = 0;
      this.shakeOffsetY = 0;
      this.shakeIntensity = 0;
      this.shakeDurationMs = 0;
    }

    // Update level pulse
    if (this.levelPulse > 0) {
      this.levelPulse = Math.max(0, this.levelPulse - dtMs / 900);
    }

    // Update particles
    const dtFactor = dtMs / 16.667;
    let active = 0;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this.pool[i];
      if (!p.active) continue;
      p.life += dtMs;
      if (p.life >= p.maxLife) {
        p.active = false;
        continue;
      }
      active++;
      const t = p.life / p.maxLife;
      p.alpha = 1 - t * t;
      if (p.shape === 'ring') {
        p.size += 1.8 * dtFactor;
      } else {
        p.x += p.vx * dtFactor;
        p.y += p.vy * dtFactor;
        p.vy += 0.22 * dtFactor; // gravity
        p.vx *= 0.985;
        p.rotation += p.vRot * dtFactor;
      }
    }
    this.activeCount = active;

    // Update trails
    for (let i = this.trails.length - 1; i >= 0; i--) {
      this.trails[i].life += dtMs;
      if (this.trails[i].life >= this.trails[i].maxLife) {
        this.trails.splice(i, 1);
      }
    }

    // Update lock flashes
    for (let i = this.lockFlashes.length - 1; i >= 0; i--) {
      this.lockFlashes[i].life += dtMs;
      if (this.lockFlashes[i].life >= this.lockFlashes[i].maxLife) {
        this.lockFlashes.splice(i, 1);
      }
    }

    // Update row flashes
    for (let i = this.rowFlashes.length - 1; i >= 0; i--) {
      this.rowFlashes[i].life += dtMs;
      if (this.rowFlashes[i].life >= this.rowFlashes[i].maxLife) {
        this.rowFlashes.splice(i, 1);
      }
    }

    // Update floating callouts
    for (let i = this.callouts.length - 1; i >= 0; i--) {
      this.callouts[i].life += dtMs;
      if (this.callouts[i].life >= this.callouts[i].maxLife) {
        this.callouts.splice(i, 1);
      }
    }
  }

  /**
   * Renders background trails & row flashes before or after board blocks.
   */
  renderUnderlay(ctx, cellSize, boardWidthPx) {
    // Hard drop light trails
    for (let i = 0; i < this.trails.length; i++) {
      const tr = this.trails[i];
      const alpha = (1 - tr.life / tr.maxLife) * 0.38;
      const x = tr.x * cellSize;
      const y = tr.startY * cellSize;
      const w = tr.widthCols * cellSize;
      const h = Math.max(cellSize, (tr.endY - tr.startY) * cellSize);

      const grad = ctx.createLinearGradient(0, y, 0, y + h);
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(1, tr.color);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = grad;
      ctx.fillRect(x, y, w, h);
      ctx.restore();
    }

    // Row clear flash bars
    for (let i = 0; i < this.rowFlashes.length; i++) {
      const rf = this.rowFlashes[i];
      const t = rf.life / rf.maxLife;
      const alpha = (1 - t) * 0.85;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, rf.row * cellSize, boardWidthPx, cellSize);
      ctx.restore();
    }
  }

  /**
   * Renders lock flashes, particles, level-up pulse, and floating callout text on top of the board.
   */
  renderOverlay(ctx, cellSize, boardWidthPx, boardHeightPx) {
    // Lock cell squash/flash
    for (let i = 0; i < this.lockFlashes.length; i++) {
      const lf = this.lockFlashes[i];
      const t = lf.life / lf.maxLife;
      const alpha = (1 - t) * 0.65;
      const squash = Math.sin(t * Math.PI) * 2.5;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(
        lf.x * cellSize - squash * 0.5,
        lf.y * cellSize + squash * 0.5,
        cellSize + squash,
        cellSize - squash
      );
      ctx.restore();
    }

    // Level-up golden/cyan border pulse
    if (this.levelPulse > 0) {
      ctx.save();
      ctx.strokeStyle = `rgba(0, 229, 255, ${this.levelPulse * 0.85})`;
      ctx.lineWidth = 4 + this.levelPulse * 6;
      ctx.strokeRect(2, 2, boardWidthPx - 4, boardHeightPx - 4);
      ctx.restore();
    }

    // Particle pool
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this.pool[i];
      if (!p.active) continue;

      ctx.save();
      ctx.globalAlpha = Math.max(0, p.alpha);

      if (p.shape === 'ring') {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.stroke();
      } else if (p.shape === 'spark') {
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 0.65, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.fillStyle = p.color;
        const s = p.size;
        ctx.fillRect(-s * 0.5, -s * 0.5, s, s);
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.fillRect(-s * 0.3, -s * 0.3, s * 0.35, s * 0.35);
      }

      ctx.restore();
    }

    // Floating callouts ("TETRIS", "T-SPIN DOUBLE", "B2B", "COMBO x3", etc.)
    for (let i = 0; i < this.callouts.length; i++) {
      const c = this.callouts[i];
      const t = c.life / c.maxLife;
      const alpha = t < 0.15 ? t / 0.15 : 1 - Math.pow((t - 0.15) / 0.85, 2);
      const y = boardHeightPx * 0.36 - t * 48 + c.offsetY;
      const scale = t < 0.12 ? 0.75 + (t / 0.12) * 0.35 : 1.0;

      ctx.save();
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.translate(boardWidthPx * 0.5, y);
      ctx.scale(scale, scale);
      ctx.font = `900 ${Math.max(15, Math.round(cellSize * 0.72))}px system-ui, -apple-system, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(8, 10, 22, 0.92)';
      ctx.strokeText(c.text, 0, 0);
      ctx.fillStyle = c.color;
      ctx.fillText(c.text, 0, 0);
      ctx.restore();
    }
  }

  clear() {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.pool[i].active = false;
    }
    this.trails.length = 0;
    this.lockFlashes.length = 0;
    this.rowFlashes.length = 0;
    this.callouts.length = 0;
    this.shakeTimeMs = 0;
    this.shakeDurationMs = 0;
    this.shakeOffsetX = 0;
    this.shakeOffsetY = 0;
  }
}
