// src/storage.js
// LocalStorage manager for user settings, 7-character high score leaderboards per mode,
// and in-progress Marathon game state persistence.

import { sanitizeSettings, DEFAULT_SETTINGS } from './settings.js';

const KEYS = Object.freeze({
  SETTINGS: 'prizma_tetris_settings_v1',
  LEADERBOARD: 'prizma_tetris_records_v1',
  SAVED_GAME: 'prizma_tetris_saved_game_v1',
});

const MAX_RECORDS_PER_MODE = 10;

/**
 * Formats and sanitizes a player's leaderboard name to at most 7 characters.
 * ("rekorlar bölümü ve her bir rekora 7 haneli isim yazdırma olsun")
 */
export function normalizeSevenCharName(rawName = '') {
  const cleaned = String(rawName || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9ÇĞİÖŞÜ_-]/g, '');
  if (!cleaned) return 'OYUNCU1';
  return cleaned.slice(0, 7);
}

const DEFAULT_LEADERBOARDS = Object.freeze({
  marathon: [
    { name: 'USTA001', score: 24500, lines: 42, level: 5, elapsedMs: 165000, pps: 1.35 },
    { name: 'TETRIS7', score: 14200, lines: 28, level: 3, elapsedMs: 118000, pps: 1.12 },
    { name: 'PRIZMA1', score: 6800, lines: 15, level: 2, elapsedMs: 74000, pps: 0.95 },
  ],
  sprint: [
    { name: 'HIZLI40', score: 11200, lines: 40, level: 5, elapsedMs: 78400, pps: 1.65 },
    { name: 'TURBO07', score: 9400, lines: 40, level: 5, elapsedMs: 96200, pps: 1.32 },
  ],
  ultra: [
    { name: 'SKORCU7', score: 18900, lines: 31, level: 4, elapsedMs: 120000, pps: 1.42 },
    { name: 'ULTRA99', score: 11400, lines: 21, level: 3, elapsedMs: 120000, pps: 1.10 },
  ],
  zen: [
    { name: 'RAHAT01', score: 15600, lines: 34, level: 4, elapsedMs: 210000, pps: 0.88 },
  ],
});

export class StorageManager {
  loadSettings() {
    try {
      const raw = localStorage.getItem(KEYS.SETTINGS);
      if (!raw) return sanitizeSettings(DEFAULT_SETTINGS);
      return sanitizeSettings(JSON.parse(raw));
    } catch {
      return sanitizeSettings(DEFAULT_SETTINGS);
    }
  }

  saveSettings(settings) {
    try {
      const clean = sanitizeSettings(settings);
      localStorage.setItem(KEYS.SETTINGS, JSON.stringify(clean));
      return clean;
    } catch {
      return settings;
    }
  }

  loadAllLeaderboards() {
    try {
      const raw = localStorage.getItem(KEYS.LEADERBOARD);
      if (!raw) {
        return structuredClone(DEFAULT_LEADERBOARDS);
      }
      const parsed = JSON.parse(raw);
      return {
        marathon: Array.isArray(parsed.marathon) ? parsed.marathon : [...DEFAULT_LEADERBOARDS.marathon],
        sprint: Array.isArray(parsed.sprint) ? parsed.sprint : [...DEFAULT_LEADERBOARDS.sprint],
        ultra: Array.isArray(parsed.ultra) ? parsed.ultra : [...DEFAULT_LEADERBOARDS.ultra],
        zen: Array.isArray(parsed.zen) ? parsed.zen : [...DEFAULT_LEADERBOARDS.zen],
      };
    } catch {
      return {
        marathon: [...DEFAULT_LEADERBOARDS.marathon],
        sprint: [...DEFAULT_LEADERBOARDS.sprint],
        ultra: [...DEFAULT_LEADERBOARDS.ultra],
        zen: [...DEFAULT_LEADERBOARDS.zen],
      };
    }
  }

  getModeLeaderboard(mode = 'marathon') {
    const all = this.loadAllLeaderboards();
    return all[mode] || [];
  }

  getBestForMode(mode = 'marathon') {
    const list = this.getModeLeaderboard(mode);
    return list.length > 0 ? list[0] : null;
  }

  /**
   * Adds a new record with a 7-character player name to the specified mode's leaderboard.
   * For Sprint (when 40 lines completed), sorts primarily by fastest time (`elapsedMs` ascending),
   * otherwise sorts by `score` descending.
   */
  addRecord(mode, { name, score, lines, level, elapsedMs, pps }) {
    const all = this.loadAllLeaderboards();
    const list = all[mode] ? [...all[mode]] : [];

    const entry = {
      name: normalizeSevenCharName(name),
      score: Math.round(Number(score) || 0),
      lines: Math.round(Number(lines) || 0),
      level: Math.round(Number(level) || 1),
      elapsedMs: Math.round(Number(elapsedMs) || 0),
      pps: Number(Number(pps || 0).toFixed(2)),
      timestamp: Date.now(),
    };

    list.push(entry);

    if (mode === 'sprint') {
      list.sort((a, b) => {
        const aComplete = a.lines >= 40 ? 1 : 0;
        const bComplete = b.lines >= 40 ? 1 : 0;
        if (aComplete !== bComplete) return bComplete - aComplete;
        if (aComplete && bComplete) return a.elapsedMs - b.elapsedMs;
        return b.lines - a.lines || b.score - a.score;
      });
    } else {
      list.sort((a, b) => b.score - a.score || b.lines - a.lines);
    }

    all[mode] = list.slice(0, MAX_RECORDS_PER_MODE);

    try {
      localStorage.setItem(KEYS.LEADERBOARD, JSON.stringify(all));
    } catch {
      // Ignore quota errors
    }

    return {
      entry,
      rank: all[mode].indexOf(entry) + 1,
      leaderboard: all[mode],
    };
  }

  saveGameState(serializedGame) {
    try {
      if (!serializedGame) {
        localStorage.removeItem(KEYS.SAVED_GAME);
        return;
      }
      localStorage.setItem(KEYS.SAVED_GAME, JSON.stringify(serializedGame));
    } catch {
      // Ignore storage errors
    }
  }

  loadSavedGameState() {
    try {
      const raw = localStorage.getItem(KEYS.SAVED_GAME);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  clearSavedGameState() {
    try {
      localStorage.removeItem(KEYS.SAVED_GAME);
    } catch {
      // Ignore
    }
  }
}
