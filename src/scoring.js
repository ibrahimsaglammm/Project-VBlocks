// src/scoring.js
// Guideline gravity formula, speed telemetry, and scoring engine
// (Single/Double/Triple/Tetris, T-Spin Full & Mini, Back-to-Back x1.5, Combo, Perfect Clear, Drop points).

/**
 * Guideline gravity formula: seconds per row at a given `level` (1-indexed).
 * Formula: (0.8 - ((level - 1) * 0.007)) ^ (level - 1)
 */
export function getGravitySecondsPerRow(level = 1) {
  const clampedLevel = Math.max(1, Math.min(30, level));
  const base = Math.max(0.001, 0.8 - (clampedLevel - 1) * 0.007);
  return Math.pow(base, clampedLevel - 1);
}

/**
 * Returns gravity interval in milliseconds per row.
 */
export function getGravityMs(level = 1) {
  return getGravitySecondsPerRow(level) * 1000;
}

/**
 * Returns formatted speed telemetry for the HUD ("oyunun hızı, level hakkında bilgiler").
 * Includes speed multiplier relative to Level 1, rows per second, and G value.
 */
export function getSpeedInfo(level = 1, mode = 'marathon') {
  if (mode === 'zen') {
    return {
      level,
      secondsPerRow: Infinity,
      rowsPerSecond: 0,
      multiplier: 'ZEN (0.0x)',
      gValue: '0.00G',
      label: 'Rahat / Yerçekimsiz',
    };
  }
  const sec = getGravitySecondsPerRow(level);
  const rowsPerSec = 1 / sec;
  const mult = 1 / sec; // Level 1 = 1.00x (1 row/sec)
  const gVal = rowsPerSec / 60; // cells per 60Hz frame
  return {
    level,
    secondsPerRow: sec,
    rowsPerSecond: Number(rowsPerSec.toFixed(2)),
    multiplier: `${mult < 10 ? mult.toFixed(2) : Math.round(mult)}x`,
    gValue: `${gVal < 1 ? gVal.toFixed(2) : Math.min(20, gVal).toFixed(1)}G`,
    label: `${rowsPerSec.toFixed(1)} satır/sn`,
  };
}

/**
 * Evaluates a piece lock & line clear action according to the modern Tetris Guideline.
 *
 * @param {object} params
 * @param {number} params.linesCleared - 0..4
 * @param {'none'|'mini'|'full'} params.tSpin - T-Spin detection result
 * @param {number} params.level - Current level (>= 1)
 * @param {number} params.combo - Current combo counter (-1 before first clear, 0 on first clear, 1 on second...)
 * @param {boolean} params.b2bActive - Whether previous line-clearing action was a difficult clear (Tetris or T-Spin line clear)
 * @param {boolean} params.isPerfectClear - Whether the board is completely empty after the clear
 * @returns {{
 *   points: number,
 *   combo: number,
 *   b2bActive: boolean,
 *   b2bTriggered: boolean,
 *   isDifficult: boolean,
 *   callouts: string[],
 *   actionName: string
 * }}
 */
export function evaluateTurnScore({
  linesCleared = 0,
  tSpin = 'none',
  level = 1,
  combo = -1,
  b2bActive = false,
  isPerfectClear = false,
}) {
  let basePoints = 0;
  let isDifficult = false;
  let actionName = '';
  const callouts = [];

  if (tSpin === 'full') {
    if (linesCleared === 0) {
      basePoints = 400;
      actionName = 'T-SPIN';
      callouts.push('T-SPIN');
    } else if (linesCleared === 1) {
      basePoints = 800;
      isDifficult = true;
      actionName = 'T-SPIN SINGLE';
      callouts.push('T-SPIN SINGLE');
    } else if (linesCleared === 2) {
      basePoints = 1200;
      isDifficult = true;
      actionName = 'T-SPIN DOUBLE';
      callouts.push('T-SPIN DOUBLE');
    } else if (linesCleared >= 3) {
      basePoints = 1600;
      isDifficult = true;
      actionName = 'T-SPIN TRIPLE';
      callouts.push('T-SPIN TRIPLE');
    }
  } else if (tSpin === 'mini') {
    if (linesCleared === 0) {
      basePoints = 100;
      actionName = 'T-SPIN MINI';
      callouts.push('T-SPIN MINI');
    } else if (linesCleared === 1) {
      basePoints = 200;
      isDifficult = true;
      actionName = 'T-SPIN MINI SINGLE';
      callouts.push('T-SPIN MINI');
    } else if (linesCleared >= 2) {
      basePoints = 400;
      isDifficult = true;
      actionName = 'T-SPIN MINI DOUBLE';
      callouts.push('T-SPIN MINI DOUBLE');
    }
  } else {
    // Standard line clears
    if (linesCleared === 1) {
      basePoints = 100;
      actionName = 'SINGLE';
    } else if (linesCleared === 2) {
      basePoints = 300;
      actionName = 'DOUBLE';
      callouts.push('DOUBLE');
    } else if (linesCleared === 3) {
      basePoints = 500;
      actionName = 'TRIPLE';
      callouts.push('TRIPLE');
    } else if (linesCleared >= 4) {
      basePoints = 800;
      isDifficult = true;
      actionName = 'TETRIS';
      callouts.push('TETRIS');
    }
  }

  let b2bTriggered = false;
  let nextB2B = b2bActive;

  if (linesCleared > 0) {
    if (isDifficult) {
      if (b2bActive) {
        basePoints = Math.floor(basePoints * 1.5);
        b2bTriggered = true;
        callouts.push('B2B');
      }
      nextB2B = true;
    } else {
      // Non-difficult line clear (Single/Double/Triple without T-Spin) breaks B2B
      nextB2B = false;
    }
  }

  let totalPoints = basePoints * level;

  // Combo update & bonus
  let nextCombo = combo;
  if (linesCleared > 0) {
    nextCombo = combo + 1;
    if (nextCombo >= 1) {
      totalPoints += 50 * nextCombo * level;
      callouts.push(`COMBO x${nextCombo}`);
    }
  } else {
    nextCombo = -1;
  }

  // Perfect Clear bonus
  if (isPerfectClear && linesCleared > 0) {
    const pcTable = [0, 800, 1200, 1800, b2bTriggered ? 3200 : 2000];
    const pcBonus = (pcTable[Math.min(4, linesCleared)] || 2000) * level;
    totalPoints += pcBonus;
    callouts.push('PERFECT CLEAR');
  }

  return {
    points: totalPoints,
    combo: nextCombo,
    b2bActive: nextB2B,
    b2bTriggered,
    isDifficult,
    callouts,
    actionName,
  };
}

/**
 * Calculates drop points:
 * - Soft drop: 1 point per cell
 * - Hard drop: 2 points per cell
 */
export function calculateDropScore(cellsDropped, type = 'soft') {
  if (cellsDropped <= 0) return 0;
  return type === 'hard' ? cellsDropped * 2 : cellsDropped * 1;
}
