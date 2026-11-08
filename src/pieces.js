// src/pieces.js
// Tetromino definitions, Super Rotation System (SRS) wall-kick tables,
// themes, and per-level randomized piece color assignments.

import { PIECE_TYPES, createRNG, shuffleArray } from './randomizer.js';

/**
 * 4 rotation states (0: North/Spawn, 1: East/CW, 2: South/180, 3: West/CCW)
 * for each of the 7 Guideline tetrominoes.
 */
export const SHAPES = Object.freeze({
  I: [
    [
      [0, 0, 0, 0],
      [1, 1, 1, 1],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
    [
      [0, 0, 1, 0],
      [0, 0, 1, 0],
      [0, 0, 1, 0],
      [0, 0, 1, 0],
    ],
    [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [1, 1, 1, 1],
      [0, 0, 0, 0],
    ],
    [
      [0, 1, 0, 0],
      [0, 1, 0, 0],
      [0, 1, 0, 0],
      [0, 1, 0, 0],
    ],
  ],
  O: [
    [
      [0, 1, 1, 0],
      [0, 1, 1, 0],
      [0, 0, 0, 0],
    ],
    [
      [0, 1, 1, 0],
      [0, 1, 1, 0],
      [0, 0, 0, 0],
    ],
    [
      [0, 1, 1, 0],
      [0, 1, 1, 0],
      [0, 0, 0, 0],
    ],
    [
      [0, 1, 1, 0],
      [0, 1, 1, 0],
      [0, 0, 0, 0],
    ],
  ],
  T: [
    [
      [0, 1, 0],
      [1, 1, 1],
      [0, 0, 0],
    ],
    [
      [0, 1, 0],
      [0, 1, 1],
      [0, 1, 0],
    ],
    [
      [0, 0, 0],
      [1, 1, 1],
      [0, 1, 0],
    ],
    [
      [0, 1, 0],
      [1, 1, 0],
      [0, 1, 0],
    ],
  ],
  S: [
    [
      [0, 1, 1],
      [1, 1, 0],
      [0, 0, 0],
    ],
    [
      [0, 1, 0],
      [0, 1, 1],
      [0, 0, 1],
    ],
    [
      [0, 0, 0],
      [0, 1, 1],
      [1, 1, 0],
    ],
    [
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
    ],
  ],
  Z: [
    [
      [1, 1, 0],
      [0, 1, 1],
      [0, 0, 0],
    ],
    [
      [0, 0, 1],
      [0, 1, 1],
      [0, 1, 0],
    ],
    [
      [0, 0, 0],
      [1, 1, 0],
      [0, 1, 1],
    ],
    [
      [0, 1, 0],
      [1, 1, 0],
      [1, 0, 0],
    ],
  ],
  J: [
    [
      [1, 0, 0],
      [1, 1, 1],
      [0, 0, 0],
    ],
    [
      [0, 1, 1],
      [0, 1, 0],
      [0, 1, 0],
    ],
    [
      [0, 0, 0],
      [1, 1, 1],
      [0, 0, 1],
    ],
    [
      [0, 1, 0],
      [0, 1, 0],
      [1, 1, 0],
    ],
  ],
  L: [
    [
      [0, 0, 1],
      [1, 1, 1],
      [0, 0, 0],
    ],
    [
      [0, 1, 0],
      [0, 1, 0],
      [0, 1, 1],
    ],
    [
      [0, 0, 0],
      [1, 1, 1],
      [1, 0, 0],
    ],
    [
      [1, 1, 0],
      [0, 1, 0],
      [0, 1, 0],
    ],
  ],
});

/**
 * SRS Wall Kick Tables in Board Coordinates: [dx, dy]
 * where +dx is RIGHT and +dy is DOWN (inverted from standard Cartesian SRS +y UP).
 *
 * Notice that test index 4 (5th test) on 0->1 and 0->3 for T has dy = +2, dx = ±1,
 * enabling the signature T-Spin Triple (TST) wall kick.
 */
export const JLSTZ_KICKS = Object.freeze({
  '0->1': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '1->0': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  '1->2': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  '2->1': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '2->3': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '3->2': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '3->0': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '0->3': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  // 180-degree rotation kicks
  '0->2': [[0, 0], [0, -1], [1, -1], [-1, -1], [1, 0], [-1, 0]],
  '2->0': [[0, 0], [0, 1], [-1, 1], [1, 1], [-1, 0], [1, 0]],
  '1->3': [[0, 0], [1, 0], [1, -2], [1, -1], [0, -2], [0, -1]],
  '3->1': [[0, 0], [-1, 0], [-1, -2], [-1, -1], [0, -2], [0, -1]],
});

export const I_KICKS = Object.freeze({
  '0->1': [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],
  '1->0': [[0, 0], [2, 0], [-1, 0], [2, -1], [-1, 2]],
  '1->2': [[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]],
  '2->1': [[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]],
  '2->3': [[0, 0], [2, 0], [-1, 0], [2, -1], [-1, 2]],
  '3->2': [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],
  '3->0': [[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]],
  '0->3': [[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]],
  // 180-degree rotation kicks
  '0->2': [[0, 0], [0, -1], [0, 1], [-1, 0], [1, 0]],
  '2->0': [[0, 0], [0, 1], [0, -1], [1, 0], [-1, 0]],
  '1->3': [[0, 0], [1, 0], [-1, 0], [0, -1], [0, 1]],
  '3->1': [[0, 0], [-1, 0], [1, 0], [0, 1], [0, -1]],
});

export const O_KICKS = Object.freeze({
  '0->1': [[0, 0]],
  '1->0': [[0, 0]],
  '1->2': [[0, 0]],
  '2->1': [[0, 0]],
  '2->3': [[0, 0]],
  '3->2': [[0, 0]],
  '3->0': [[0, 0]],
  '0->3': [[0, 0]],
  '0->2': [[0, 0]],
  '2->0': [[0, 0]],
  '1->3': [[0, 0]],
  '3->1': [[0, 0]],
});

/**
 * Returns the kick offset array [[dx, dy], ...] for a given piece type and rotation transition.
 */
export function getKickOffsets(type, fromRot, toRot) {
  const key = `${fromRot}->${toRot}`;
  if (type === 'I') return I_KICKS[key] || [[0, 0]];
  if (type === 'O') return O_KICKS[key] || [[0, 0]];
  return JLSTZ_KICKS[key] || [[0, 0]];
}

/**
 * Theme color palettes.
 * Each palette defines 7 distinct slot colors.
 * On Level 1 (or when custom initial mapping is used):
 * T is Red (#ff2a5f), L is Blue (#2979ff), I is Cyan, O is Yellow, S is Green, Z is Purple/Magenta, J is Orange,
 * fulfilling "T kırmızı, L mavi olabilir ayrıca bu her yeni bölümde random olarak değişsin".
 */
export const THEME_PALETTES = Object.freeze({
  neon: [
    '#ff2a5f', // Crimson Neon Red
    '#2979ff', // Electric Blue
    '#00e5ff', // Cyber Cyan
    '#ffd600', // Solar Yellow
    '#00e676', // Emerald Green
    '#d500f9', // Hyper Violet
    '#ff6d00', // Blaze Orange
  ],
  classic: [
    '#e53935', // Classic Red
    '#1e88e5', // Classic Blue
    '#00acc1', // Classic Cyan
    '#fdd835', // Classic Yellow
    '#43a047', // Classic Green
    '#8e24aa', // Classic Purple
    '#fb8c00', // Classic Orange
  ],
  minimal: [
    '#ef4444', // Minimal Rose Red
    '#3b82f6', // Minimal Royal Blue
    '#06b6d4', // Minimal Teal
    '#eab308', // Minimal Amber
    '#10b981', // Minimal Mint
    '#8b5cf6', // Minimal Indigo
    '#f97316', // Minimal Coral
  ],
  colorblind: [
    '#d55e00', // Vermilion (Red-Orange)
    '#0072b2', // Strong Blue
    '#56b4e9', // Sky Blue
    '#f0e442', // Bright Yellow
    '#009e73', // Bluish Green
    '#cc79a7', // Reddish Purple
    '#e69f00', // Orange
  ],
});

/**
 * Default Level 1 order maps:
 * T -> slot 0 (Red), L -> slot 1 (Blue), I -> slot 2 (Cyan),
 * O -> slot 3 (Yellow), S -> slot 4 (Green), Z -> slot 5 (Purple), J -> slot 6 (Orange)
 */
const LEVEL_1_ORDER = Object.freeze(['T', 'L', 'I', 'O', 'S', 'Z', 'J']);

/**
 * Standard Guideline mapping (when user disables per-level color randomization)
 */
const GUIDELINE_ORDER = Object.freeze(['Z', 'J', 'I', 'O', 'S', 'T', 'L']);

/**
 * Generates a map of { I, O, T, S, Z, J, L } -> hex color for a given level.
 * - Each of the 7 pieces ALWAYS receives a unique color from the 7-color palette.
 * - Level 1 assigns T=Red (slot 0) and L=Blue (slot 1).
 * - Each subsequent level (level >= 2) randomly shuffles the assignment so every new level
 *   has a fresh random color arrangement, guaranteed to differ from the previous level map.
 */
export function generateLevelColorMap({
  level = 1,
  theme = 'neon',
  colorblind = false,
  randomLevelColors = true,
  previousMap = null,
  seed = null,
} = {}) {
  const paletteKey = colorblind ? 'colorblind' : (THEME_PALETTES[theme] ? theme : 'neon');
  const palette = THEME_PALETTES[paletteKey];

  if (!randomLevelColors) {
    const map = {};
    GUIDELINE_ORDER.forEach((type, idx) => {
      map[type] = palette[idx];
    });
    return map;
  }

  if (level <= 1 && !previousMap) {
    const map = {};
    LEVEL_1_ORDER.forEach((type, idx) => {
      map[type] = palette[idx];
    });
    return map;
  }

  // Deterministic or random shuffle for level >= 2
  const rng = seed !== null ? createRNG(seed + level * 7919) : Math.random;
  const indices = [0, 1, 2, 3, 4, 5, 6];
  shuffleArray(indices, rng);

  // Ensure at least T and L (and overall mapping) changed compared to previousMap
  if (previousMap) {
    let allSame = LEVEL_1_ORDER.every((type, i) => previousMap[type] === palette[indices[i]]);
    if (allSame || previousMap.T === palette[indices[0]]) {
      // Rotate indices by 1..6 to guarantee a visibly different assignment
      const shift = 1 + (Math.floor(rng() * 5));
      const rotated = indices.map((_, idx) => indices[(idx + shift) % 7]);
      for (let i = 0; i < 7; i++) indices[i] = rotated[i];
    }
  }

  const map = {};
  LEVEL_1_ORDER.forEach((type, idx) => {
    map[type] = palette[indices[idx]];
  });
  return map;
}

/**
 * Creates a fresh active piece state at the Guideline spawn position.
 * Board is 10 columns wide (0..9) and 22 rows tall (0..1 hidden, 2..21 visible).
 */
export function createPiece(type, colorMap = null) {
  const matrix = SHAPES[type][0];
  const width = matrix[0].length;
  const x = Math.floor((10 - width) / 2);
  // Spawn at row 0 (top hidden buffer row so rows 0..1 hold the piece and it drops into row 2)
  const y = 0;
  return {
    type,
    rotation: 0,
    x,
    y,
    color: colorMap ? colorMap[type] : THEME_PALETTES.neon[0],
  };
}
