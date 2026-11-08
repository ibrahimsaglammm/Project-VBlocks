// src/board.js
// Pure 10x22 Tetris board representation (20 visible rows + 2 hidden spawn rows),
// collision detection, SRS rotation with wall kicks, 3-corner T-Spin detection, and line clearing.

import { SHAPES, getKickOffsets } from './pieces.js';

export const BOARD_WIDTH = 10;
export const VISIBLE_ROWS = 20;
export const HIDDEN_ROWS = 2;
export const TOTAL_ROWS = VISIBLE_ROWS + HIDDEN_ROWS; // 22

export class Board {
  constructor(width = BOARD_WIDTH, height = TOTAL_ROWS) {
    this.width = width;
    this.height = height;
    this.grid = this._createEmptyGrid();
  }

  _createEmptyGrid() {
    return Array.from({ length: this.height }, () => Array(this.width).fill(null));
  }

  reset() {
    this.grid = this._createEmptyGrid();
  }

  /**
   * Checks whether `piece` at `(piece.x + dx, piece.y + dy)` with `rotation`
   * fits without colliding with walls, floor, or existing locked cells.
   */
  isValidPosition(piece, dx = 0, dy = 0, rotation = piece.rotation) {
    const matrix = SHAPES[piece.type][rotation];
    const targetX = piece.x + dx;
    const targetY = piece.y + dy;

    for (let r = 0; r < matrix.length; r++) {
      const row = matrix[r];
      for (let c = 0; c < row.length; c++) {
        if (!row[c]) continue;
        const x = targetX + c;
        const y = targetY + r;

        if (x < 0 || x >= this.width || y >= this.height) {
          return false;
        }
        // Allow cells temporarily at y < 0 during high kicks, otherwise check grid occupancy
        if (y >= 0 && this.grid[y][x] !== null) {
          return false;
        }
      }
    }
    return true;
  }

  /**
   * Attempts to rotate `piece` using SRS wall-kick tables.
   * @param {object} piece - Current piece { type, rotation, x, y, color }
   * @param {number} dir - 1 for CW, -1 for CCW, 2 for 180°
   * @returns {{ success: boolean, x?: number, y?: number, rotation?: number, kickIndex?: number, kickOffset?: [number, number] }}
   */
  tryRotate(piece, dir) {
    const fromRot = piece.rotation;
    const toRot = ((fromRot + dir) % 4 + 4) % 4;
    const kicks = getKickOffsets(piece.type, fromRot, toRot);

    for (let i = 0; i < kicks.length; i++) {
      const [dx, dy] = kicks[i];
      if (this.isValidPosition(piece, dx, dy, toRot)) {
        return {
          success: true,
          x: piece.x + dx,
          y: piece.y + dy,
          rotation: toRot,
          kickIndex: i,
          kickOffset: [dx, dy],
        };
      }
    }

    return { success: false };
  }

  /**
   * Computes the Y position of the ghost piece (hard-drop landing row).
   */
  getGhostY(piece) {
    let dy = 0;
    while (this.isValidPosition(piece, 0, dy + 1, piece.rotation)) {
      dy++;
    }
    return piece.y + dy;
  }

  /**
   * Locks a piece into the board grid.
   * Returns metadata including locked cell coordinates and Guideline lock-out check.
   */
  lockPiece(piece) {
    const matrix = SHAPES[piece.type][piece.rotation];
    const lockedCells = [];

    for (let r = 0; r < matrix.length; r++) {
      for (let c = 0; c < matrix[r].length; c++) {
        if (!matrix[r][c]) continue;
        const x = piece.x + c;
        const y = piece.y + r;
        if (y >= 0 && y < this.height && x >= 0 && x < this.width) {
          this.grid[y][x] = {
            type: piece.type,
            color: piece.color,
          };
          lockedCells.push({ x, y, type: piece.type, color: piece.color });
        }
      }
    }

    // Guideline Lock Out: game over if the entire piece locked above the visible skyline (y < HIDDEN_ROWS)
    const lockOut = lockedCells.length > 0 && lockedCells.every((cell) => cell.y < HIDDEN_ROWS);

    return { lockedCells, lockOut };
  }

  /**
   * Detects T-Spin according to the Guideline 3-Corner Rule.
   * Must be called BEFORE clearing lines while the T piece (or surrounding blocks) are in place.
   * @param {object} piece - The T piece at its final locked position
   * @param {boolean} lastActionWasRotation - Whether the last successful action was a rotation
   * @param {number} lastKickIndex - Index of the SRS kick used (0..4); index 4 upgrades Mini to Full
   * @returns {'none' | 'mini' | 'full'}
   */
  detectTSpin(piece, lastActionWasRotation, lastKickIndex = 0) {
    if (!piece || piece.type !== 'T' || !lastActionWasRotation) {
      return 'none';
    }

    const cx = piece.x + 1;
    const cy = piece.y + 1;

    // 4 corners in clockwise order starting from Top-Left: TL, TR, BR, BL
    const corners = [
      [cx - 1, cy - 1], // 0: TL
      [cx + 1, cy - 1], // 1: TR
      [cx + 1, cy + 1], // 2: BR
      [cx - 1, cy + 1], // 3: BL
    ];

    const isOccupied = ([x, y]) => {
      if (x < 0 || x >= this.width || y >= this.height) return true; // wall/floor counts as occupied
      if (y < 0) return false;
      return this.grid[y][x] !== null;
    };

    const occupiedFlags = corners.map(isOccupied);
    const occupiedCount = occupiedFlags.filter(Boolean).length;

    if (occupiedCount < 3) {
      return 'none';
    }

    // Front corners by rotation:
    // 0 (North): TL(0), TR(1)
    // 1 (East):  TR(1), BR(2)
    // 2 (South): BR(2), BL(3)
    // 3 (West):  BL(3), TL(0)
    const frontCornerA = occupiedFlags[piece.rotation];
    const frontCornerB = occupiedFlags[(piece.rotation + 1) % 4];

    // Guideline rule: Full T-Spin if both front corners are filled OR the 5th kick (index 4, TST kick) was used
    if ((frontCornerA && frontCornerB) || lastKickIndex === 4) {
      return 'full';
    }

    return 'mini';
  }

  /**
   * Finds and removes completed horizontal lines.
   * Returns cleared row indices, destroyed cell details (for colorful particle explosions),
   * and whether the board is now completely empty (Perfect Clear).
   */
  clearLines() {
    const clearedRows = [];
    const destroyedCells = [];
    const remainingGrid = [];

    for (let y = 0; y < this.height; y++) {
      const row = this.grid[y];
      const isFull = row.every((cell) => cell !== null);
      if (isFull) {
        clearedRows.push(y);
        for (let x = 0; x < this.width; x++) {
          destroyedCells.push({
            x,
            y,
            type: row[x].type,
            color: row[x].color,
          });
        }
      } else {
        remainingGrid.push(row);
      }
    }

    if (clearedRows.length > 0) {
      while (remainingGrid.length < this.height) {
        remainingGrid.unshift(Array(this.width).fill(null));
      }
      this.grid = remainingGrid;
    }

    const isPerfectClear =
      clearedRows.length > 0 &&
      this.grid.every((row) => row.every((cell) => cell === null));

    return {
      linesCleared: clearedRows.length,
      clearedRows,
      destroyedCells,
      isPerfectClear,
    };
  }

  isEmpty() {
    return this.grid.every((row) => row.every((cell) => cell === null));
  }

  /**
   * Recolors existing locked cells when the theme or level color map changes (optional or for theme switch).
   */
  applyColorMap(colorMap) {
    if (!colorMap) return;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const cell = this.grid[y][x];
        if (cell && colorMap[cell.type]) {
          cell.color = colorMap[cell.type];
        }
      }
    }
  }

  serialize() {
    return this.grid.map((row) => row.map((cell) => (cell ? { ...cell } : null)));
  }

  restore(serializedGrid) {
    if (!Array.isArray(serializedGrid) || serializedGrid.length !== this.height) return;
    this.grid = serializedGrid.map((row) =>
      row.map((cell) => (cell ? { type: cell.type, color: cell.color } : null))
    );
  }
}
