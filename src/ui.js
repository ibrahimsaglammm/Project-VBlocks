// src/ui.js
// UI and DOM controller managing:
// - Main menu, Mode cards with personal bests, Continue saved game
// - Live HUD: Score, Level, Speed (multiplier + rows/sec), Lines, Timer, and Per-Level Piece Color Swatches
// - 7-Character High Score Name entry & Rekorlar (Leaderboard) tabs
// - Pause menu, 3-2-1 Countdown overlay, Game Over / Victory stats screen
// - Settings modal with live controls & key rebinding
// - How to Play interactive guide & i18n (Turkish default + English toggle)

import { I18N, DEFAULT_SETTINGS } from './settings.js';
import { PIECE_TYPES } from './randomizer.js';
import { normalizeSevenCharName } from './storage.js';
import { ULTRA_DURATION_MS, SPRINT_TARGET_LINES } from './game.js';

export function formatTimeMs(ms = 0) {
  const clamped = Math.max(0, Math.round(ms));
  const totalSeconds = Math.floor(clamped / 1000);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  const tenths = Math.floor((clamped % 1000) / 100);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${tenths}`;
}

export class UIController {
  constructor({ storage, settings, keyboard, audio, callbacks }) {
    this.storage = storage;
    this.settings = settings;
    this.keyboard = keyboard;
    this.audio = audio;
    this.callbacks = callbacks;

    this.activeLeaderboardMode = 'marathon';
    this.lastGameStats = null;
    this.recordSubmitted = false;
    this.countdownTimer = null;

    this._cacheElements();
    this._bindEvents();
    this.applyTheme(this.settings.theme, this.settings.colorblind);
    this.applyLanguage(this.settings.language);
    this.syncSettingsForm();
    this.refreshMenuBests();
    this.renderLeaderboardTable('marathon');
  }

  _cacheElements() {
    this.els = {
      app: document.getElementById('app'),
      // Screens / Modals
      menuOverlay: document.getElementById('menu-overlay'),
      pauseOverlay: document.getElementById('pause-overlay'),
      gameoverOverlay: document.getElementById('gameover-overlay'),
      leaderboardOverlay: document.getElementById('leaderboard-overlay'),
      settingsOverlay: document.getElementById('settings-overlay'),
      howtoOverlay: document.getElementById('howto-overlay'),
      countdownOverlay: document.getElementById('countdown-overlay'),
      countdownNumber: document.getElementById('countdown-number'),

      // HUD telemetry
      hudScore: document.getElementById('hud-score'),
      hudLevel: document.getElementById('hud-level'),
      hudSpeed: document.getElementById('hud-speed'),
      hudSpeedSub: document.getElementById('hud-speed-sub'),
      hudLines: document.getElementById('hud-lines'),
      hudTime: document.getElementById('hud-time'),
      hudModeBadge: document.getElementById('hud-mode-badge'),
      colorSwatches: document.getElementById('level-color-swatches'),

      // Continue saved game button
      btnContinueSaved: document.getElementById('btn-continue-saved'),

      // Game Over & 7-character record form
      gameoverTitle: document.getElementById('gameover-title'),
      statScore: document.getElementById('stat-score'),
      statLines: document.getElementById('stat-lines'),
      statLevel: document.getElementById('stat-level'),
      statSpeed: document.getElementById('stat-speed'),
      statTime: document.getElementById('stat-time'),
      statPPS: document.getElementById('stat-pps'),
      statPieces: document.getElementById('stat-pieces'),
      statTetris: document.getElementById('stat-tetris'),
      statTSpin: document.getElementById('stat-tspin'),
      statCombo: document.getElementById('stat-combo'),
      recordForm: document.getElementById('record-entry-form'),
      recordNameInput: document.getElementById('record-name-input'),
      recordCharSlots: document.getElementById('record-char-slots'),
      recordSaveBtn: document.getElementById('btn-save-record'),
      recordSavedMsg: document.getElementById('record-saved-msg'),

      // Leaderboard modal
      leaderboardBody: document.getElementById('leaderboard-tbody'),
      leaderboardTabs: document.querySelectorAll('[data-lb-mode]'),

      // Settings controls
      settingLanguage: document.getElementById('setting-language'),
      settingTheme: document.getElementById('setting-theme'),
      settingColorblind: document.getElementById('setting-colorblind'),
      settingRandomColors: document.getElementById('setting-random-colors'),
      settingGhost: document.getElementById('setting-ghost'),
      settingGrid: document.getElementById('setting-grid'),
      settingParticles: document.getElementById('setting-particles'),
      settingShake: document.getElementById('setting-shake'),
      settingReducedMotion: document.getElementById('setting-reduced-motion'),
      settingAllow180: document.getElementById('setting-allow180'),
      settingInfinityLock: document.getElementById('setting-infinity-lock'),
      settingTouchScheme: document.getElementById('setting-touch-scheme'),
      settingTouchSens: document.getElementById('setting-touch-sens'),
      settingTouchSensVal: document.getElementById('setting-touch-sens-val'),
      settingButtonSize: document.getElementById('setting-button-size'),
      settingLeftHanded: document.getElementById('setting-left-handed'),
      settingHaptics: document.getElementById('setting-haptics'),
      settingDas: document.getElementById('setting-das'),
      settingDasVal: document.getElementById('setting-das-val'),
      settingArr: document.getElementById('setting-arr'),
      settingArrVal: document.getElementById('setting-arr-val'),
      settingSdf: document.getElementById('setting-sdf'),
      settingSdfVal: document.getElementById('setting-sdf-val'),
      settingMusicVol: document.getElementById('setting-music-vol'),
      settingMusicVolVal: document.getElementById('setting-music-vol-val'),
      settingSfxVol: document.getElementById('setting-sfx-vol'),
      settingSfxVolVal: document.getElementById('setting-sfx-vol-val'),
      rebindContainer: document.getElementById('key-rebind-list'),
    };
  }

  t(key) {
    const lang = this.settings.language || 'tr';
    return (I18N[lang] && I18N[lang][key]) || I18N.tr[key] || key;
  }

  _bindEvents() {
    // Mode start buttons
    document.querySelectorAll('[data-start-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.audio.playMenuClick();
        const mode = btn.getAttribute('data-start-mode');
        this.hideAllOverlays();
        this.callbacks.onStartMode(mode);
      });
    });

    // Continue saved Marathon game
    if (this.els.btnContinueSaved) {
      this.els.btnContinueSaved.addEventListener('click', () => {
        this.audio.playMenuClick();
        this.hideAllOverlays();
        this.callbacks.onContinueSaved();
      });
    }

    // HUD Pause & Quick Restart buttons
    const btnHudPause = document.getElementById('btn-hud-pause');
    if (btnHudPause) {
      btnHudPause.addEventListener('click', () => {
        this.audio.playMenuClick();
        this.callbacks.onTogglePause();
      });
    }

    // Pause overlay buttons
    document.getElementById('btn-resume')?.addEventListener('click', () => {
      this.audio.playMenuClick();
      this.callbacks.onResumeWithCountdown();
    });
    document.getElementById('btn-pause-restart')?.addEventListener('click', () => {
      this.audio.playMenuClick();
      this.hideAllOverlays();
      this.callbacks.onRestart();
    });
    document.getElementById('btn-pause-settings')?.addEventListener('click', () => {
      this.audio.playMenuClick();
      this.showOverlay('settingsOverlay');
    });
    document.getElementById('btn-pause-menu')?.addEventListener('click', () => {
      this.audio.playMenuClick();
      this.callbacks.onReturnToMenu();
    });

    // Game Over overlay buttons
    document.getElementById('btn-gameover-restart')?.addEventListener('click', () => {
      this.audio.playMenuClick();
      this.hideAllOverlays();
      this.callbacks.onRestart();
    });
    document.getElementById('btn-gameover-leaderboard')?.addEventListener('click', () => {
      this.audio.playMenuClick();
      const mode = (this.lastGameStats && this.lastGameStats.mode) || 'marathon';
      this.renderLeaderboardTable(mode);
      this.showOverlay('leaderboardOverlay');
    });
    document.getElementById('btn-gameover-menu')?.addEventListener('click', () => {
      this.audio.playMenuClick();
      this.callbacks.onReturnToMenu();
    });

    // 7-Character High Score Name input & submission
    if (this.els.recordNameInput) {
      this.els.recordNameInput.addEventListener('input', () => {
        const clean = this.els.recordNameInput.value
          .toUpperCase()
          .replace(/[^A-Z0-9ÇĞİÖŞÜ_-]/g, '')
          .slice(0, 7);
        this.els.recordNameInput.value = clean;
        this._renderSevenCharSlots(clean);
      });
    }

    if (this.els.recordForm) {
      this.els.recordForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this._submitSevenCharRecord();
      });
    }

    // Main Menu navigation buttons (Leaderboard, Settings, How to Play)
    document.getElementById('btn-open-leaderboard')?.addEventListener('click', () => {
      this.audio.playMenuClick();
      this.renderLeaderboardTable(this.activeLeaderboardMode);
      this.showOverlay('leaderboardOverlay');
    });
    document.getElementById('btn-open-settings')?.addEventListener('click', () => {
      this.audio.playMenuClick();
      this.syncSettingsForm();
      this.showOverlay('settingsOverlay');
    });
    document.getElementById('btn-open-howto')?.addEventListener('click', () => {
      this.audio.playMenuClick();
      this.showOverlay('howtoOverlay');
    });

    // Close modal buttons
    document.querySelectorAll('[data-close-modal]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.audio.playMenuClick();
        const target = btn.getAttribute('data-close-modal');
        this.els[target]?.classList.add('is-hidden');
        this.keyboard.cancelRebind();
      });
    });

    // Leaderboard mode tabs
    this.els.leaderboardTabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        this.audio.playMenuClick();
        const mode = tab.getAttribute('data-lb-mode');
        this.renderLeaderboardTable(mode);
      });
    });

    // Settings inputs
    this._bindSettingsControls();
  }

  _bindSettingsControls() {
    const update = (patch) => {
      this.settings = { ...this.settings, ...patch };
      this.storage.saveSettings(this.settings);
      this.applyTheme(this.settings.theme, this.settings.colorblind);
      if (patch.language) {
        this.applyLanguage(patch.language);
      }
      this.callbacks.onSettingsChanged(this.settings);
    };

    this.els.settingLanguage?.addEventListener('change', (e) =>
      update({ language: e.target.value })
    );
    this.els.settingTheme?.addEventListener('change', (e) =>
      update({ theme: e.target.value })
    );
    this.els.settingColorblind?.addEventListener('change', (e) =>
      update({ colorblind: e.target.checked })
    );
    this.els.settingRandomColors?.addEventListener('change', (e) =>
      update({ randomLevelColors: e.target.checked })
    );
    this.els.settingGhost?.addEventListener('change', (e) =>
      update({ ghost: e.target.checked })
    );
    this.els.settingGrid?.addEventListener('change', (e) =>
      update({ grid: e.target.checked })
    );
    this.els.settingParticles?.addEventListener('change', (e) =>
      update({ particles: e.target.checked })
    );
    this.els.settingShake?.addEventListener('change', (e) =>
      update({ screenShake: e.target.checked })
    );
    this.els.settingReducedMotion?.addEventListener('change', (e) =>
      update({ reducedMotion: e.target.checked })
    );
    this.els.settingAllow180?.addEventListener('change', (e) =>
      update({ allow180: e.target.checked })
    );
    this.els.settingInfinityLock?.addEventListener('change', (e) =>
      update({ infinityLock: e.target.checked })
    );
    this.els.settingTouchScheme?.addEventListener('change', (e) =>
      update({ touchScheme: e.target.value })
    );
    this.els.settingTouchSens?.addEventListener('input', (e) => {
      const val = Number(e.target.value);
      if (this.els.settingTouchSensVal) this.els.settingTouchSensVal.textContent = `${val.toFixed(1)}x`;
      update({ touchSensitivity: val });
    });
    this.els.settingButtonSize?.addEventListener('change', (e) =>
      update({ buttonSize: e.target.value })
    );
    this.els.settingLeftHanded?.addEventListener('change', (e) =>
      update({ leftHanded: e.target.checked })
    );
    this.els.settingHaptics?.addEventListener('change', (e) =>
      update({ haptics: e.target.checked })
    );
    this.els.settingDas?.addEventListener('input', (e) => {
      const val = Number(e.target.value);
      if (this.els.settingDasVal) this.els.settingDasVal.textContent = `${val} ms`;
      update({ das: val });
    });
    this.els.settingArr?.addEventListener('input', (e) => {
      const val = Number(e.target.value);
      if (this.els.settingArrVal) this.els.settingArrVal.textContent = `${val} ms`;
      update({ arr: val });
    });
    this.els.settingSdf?.addEventListener('input', (e) => {
      const val = Number(e.target.value);
      if (this.els.settingSdfVal) this.els.settingSdfVal.textContent = `${val}x`;
      update({ sdf: val });
    });
    this.els.settingMusicVol?.addEventListener('input', (e) => {
      const val = Number(e.target.value);
      if (this.els.settingMusicVolVal) {
        this.els.settingMusicVolVal.textContent = `${Math.round(val * 100)}%`;
      }
      update({ musicVolume: val });
    });
    this.els.settingSfxVol?.addEventListener('input', (e) => {
      const val = Number(e.target.value);
      if (this.els.settingSfxVolVal) {
        this.els.settingSfxVolVal.textContent = `${Math.round(val * 100)}%`;
      }
      update({ sfxVolume: val });
    });

    document.getElementById('btn-reset-settings')?.addEventListener('click', () => {
      this.audio.playMenuClick();
      this.settings = {
        ...DEFAULT_SETTINGS,
        keyBindings: { ...DEFAULT_SETTINGS.keyBindings },
      };
      this.storage.saveSettings(this.settings);
      this.syncSettingsForm();
      this.applyTheme(this.settings.theme, this.settings.colorblind);
      this.applyLanguage(this.settings.language);
      this.callbacks.onSettingsChanged(this.settings);
    });
  }

  syncSettingsForm() {
    const s = this.settings;
    if (this.els.settingLanguage) this.els.settingLanguage.value = s.language;
    if (this.els.settingTheme) this.els.settingTheme.value = s.theme;
    if (this.els.settingColorblind) this.els.settingColorblind.checked = s.colorblind;
    if (this.els.settingRandomColors) this.els.settingRandomColors.checked = s.randomLevelColors;
    if (this.els.settingGhost) this.els.settingGhost.checked = s.ghost;
    if (this.els.settingGrid) this.els.settingGrid.checked = s.grid;
    if (this.els.settingParticles) this.els.settingParticles.checked = s.particles;
    if (this.els.settingShake) this.els.settingShake.checked = s.screenShake;
    if (this.els.settingReducedMotion) this.els.settingReducedMotion.checked = s.reducedMotion;
    if (this.els.settingAllow180) this.els.settingAllow180.checked = s.allow180;
    if (this.els.settingInfinityLock) this.els.settingInfinityLock.checked = s.infinityLock;
    if (this.els.settingTouchScheme) this.els.settingTouchScheme.value = s.touchScheme;
    if (this.els.settingTouchSens) {
      this.els.settingTouchSens.value = s.touchSensitivity;
      if (this.els.settingTouchSensVal) {
        this.els.settingTouchSensVal.textContent = `${Number(s.touchSensitivity).toFixed(1)}x`;
      }
    }
    if (this.els.settingButtonSize) this.els.settingButtonSize.value = s.buttonSize;
    if (this.els.settingLeftHanded) this.els.settingLeftHanded.checked = s.leftHanded;
    if (this.els.settingHaptics) this.els.settingHaptics.checked = s.haptics;
    if (this.els.settingDas) {
      this.els.settingDas.value = s.das;
      if (this.els.settingDasVal) this.els.settingDasVal.textContent = `${s.das} ms`;
    }
    if (this.els.settingArr) {
      this.els.settingArr.value = s.arr;
      if (this.els.settingArrVal) this.els.settingArrVal.textContent = `${s.arr} ms`;
    }
    if (this.els.settingSdf) {
      this.els.settingSdf.value = s.sdf;
      if (this.els.settingSdfVal) this.els.settingSdfVal.textContent = `${s.sdf}x`;
    }
    if (this.els.settingMusicVol) {
      this.els.settingMusicVol.value = s.musicVolume;
      if (this.els.settingMusicVolVal) {
        this.els.settingMusicVolVal.textContent = `${Math.round(s.musicVolume * 100)}%`;
      }
    }
    if (this.els.settingSfxVol) {
      this.els.settingSfxVol.value = s.sfxVolume;
      if (this.els.settingSfxVolVal) {
        this.els.settingSfxVolVal.textContent = `${Math.round(s.sfxVolume * 100)}%`;
      }
    }

    this._renderKeyRebindButtons();
  }

  _renderKeyRebindButtons() {
    if (!this.els.rebindContainer) return;
    const actionLabels = {
      moveLeft: 'Sol (Move Left)',
      moveRight: 'Sağ (Move Right)',
      softDrop: 'Yumuşak İndir (Soft Drop)',
      hardDrop: 'Anında İndir (Hard Drop)',
      rotateCW: 'Saat Yönü Döndür (CW)',
      rotateCCW: 'Ters Yön Döndür (CCW)',
      rotate180: '180° Döndür',
      hold: 'Parça Tut (Hold)',
      pause: 'Duraklat (Pause)',
      restart: 'Hızlı Yeniden Başlat',
    };

    this.els.rebindContainer.innerHTML = '';
    Object.entries(actionLabels).forEach(([action, label]) => {
      const row = document.createElement('div');
      row.className = 'rebind-row';

      const span = document.createElement('span');
      span.className = 'rebind-label';
      span.textContent = label;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn-rebind';
      btn.textContent = this.settings.keyBindings[action] || '---';

      btn.addEventListener('click', () => {
        btn.textContent = this.t('pressAnyKey');
        btn.classList.add('is-listening');
        this.keyboard.startRebind((newCode) => {
          btn.classList.remove('is-listening');
          const nextBindings = {
            ...this.settings.keyBindings,
            [action]: newCode,
          };
          this.settings = { ...this.settings, keyBindings: nextBindings };
          this.storage.saveSettings(this.settings);
          btn.textContent = newCode;
          this.callbacks.onSettingsChanged(this.settings);
        });
      });

      row.append(span, btn);
      this.els.rebindContainer.appendChild(row);
    });
  }

  applyTheme(theme = 'neon', colorblind = false) {
    document.body.dataset.theme = theme;
    document.body.dataset.colorblind = colorblind ? 'true' : 'false';
  }

  applyLanguage(lang = 'tr') {
    const dict = I18N[lang] || I18N.tr;
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (dict[key]) {
        el.textContent = dict[key];
      }
    });
  }

  /**
   * Updates the live HUD telemetry (Score, Level, Speed, Lines, Timer)
   */
  updateHUD(game) {
    if (this.els.hudScore) {
      this.els.hudScore.textContent = game.score.toLocaleString('tr-TR');
    }
    if (this.els.hudLevel) {
      this.els.hudLevel.textContent = String(game.level);
    }

    const speedInfo = game.getSpeedTelemetry();
    if (this.els.hudSpeed) {
      this.els.hudSpeed.textContent = speedInfo.multiplier;
    }
    if (this.els.hudSpeedSub) {
      this.els.hudSpeedSub.textContent = speedInfo.label;
    }

    if (this.els.hudLines) {
      if (game.mode === 'sprint') {
        this.els.hudLines.textContent = `${game.lines} / ${SPRINT_TARGET_LINES}`;
      } else {
        this.els.hudLines.textContent = String(game.lines);
      }
    }

    if (this.els.hudTime) {
      if (game.mode === 'ultra') {
        const remaining = Math.max(0, ULTRA_DURATION_MS - game.elapsedMs);
        this.els.hudTime.textContent = formatTimeMs(remaining);
      } else {
        this.els.hudTime.textContent = formatTimeMs(game.elapsedMs);
      }
    }

    if (this.els.hudModeBadge) {
      const modeNames = {
        marathon: 'MARATON',
        sprint: 'SPRINT 40L',
        ultra: 'ULTRA 2DK',
        zen: 'ZEN RAHAT',
      };
      this.els.hudModeBadge.textContent = modeNames[game.mode] || 'MARATON';
    }
  }

  /**
   * Renders the 7 tetromino color badges showing the current level's piece-color mapping.
   */
  updateColorSwatches(colorMap) {
    if (!this.els.colorSwatches || !colorMap) return;
    this.els.colorSwatches.innerHTML = '';
    PIECE_TYPES.forEach((type) => {
      const pill = document.createElement('span');
      pill.className = 'color-swatch-pill';
      pill.style.setProperty('--swatch-color', colorMap[type]);
      pill.textContent = type;
      pill.title = `${type} Bloğu: ${colorMap[type]}`;
      this.els.colorSwatches.appendChild(pill);
    });
  }

  refreshMenuBests() {
    ['marathon', 'sprint', 'ultra', 'zen'].forEach((mode) => {
      const best = this.storage.getBestForMode(mode);
      const badgeEl = document.getElementById(`best-${mode}`);
      if (!badgeEl) return;
      if (!best) {
        badgeEl.textContent = '---';
        return;
      }
      if (mode === 'sprint' && best.lines >= 40) {
        badgeEl.textContent = `${best.name} • ${formatTimeMs(best.elapsedMs)}`;
      } else {
        badgeEl.textContent = `${best.name} • ${best.score.toLocaleString('tr-TR')}`;
      }
    });

    // Show/hide "Continue Saved Game" button
    const saved = this.storage.loadSavedGameState();
    if (this.els.btnContinueSaved) {
      if (saved && saved.state !== 'GAME_OVER' && saved.state !== 'VICTORY') {
        this.els.btnContinueSaved.classList.remove('is-hidden');
      } else {
        this.els.btnContinueSaved.classList.add('is-hidden');
      }
    }
  }

  showOverlay(name) {
    const el = this.els[name];
    if (el) {
      el.classList.remove('is-hidden');
    }
  }

  hideOverlay(name) {
    const el = this.els[name];
    if (el) {
      el.classList.add('is-hidden');
    }
  }

  hideAllOverlays() {
    [
      'menuOverlay',
      'pauseOverlay',
      'gameoverOverlay',
      'leaderboardOverlay',
      'settingsOverlay',
      'howtoOverlay',
      'countdownOverlay',
    ].forEach((k) => this.hideOverlay(k));
  }

  /**
   * Runs a 3-2-1 countdown overlay before resuming gameplay.
   */
  runResumeCountdown(onDone) {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
    this.hideOverlay('pauseOverlay');
    this.showOverlay('countdownOverlay');

    let count = 3;
    if (this.els.countdownNumber) {
      this.els.countdownNumber.textContent = String(count);
    }
    this.audio.playMenuClick();

    this.countdownTimer = setInterval(() => {
      count -= 1;
      if (count > 0) {
        if (this.els.countdownNumber) {
          this.els.countdownNumber.textContent = String(count);
        }
        this.audio.playMenuClick();
      } else {
        clearInterval(this.countdownTimer);
        this.countdownTimer = null;
        this.hideOverlay('countdownOverlay');
        onDone();
      }
    }, 650);
  }

  /**
   * Displays the Game Over / Victory modal with full stats and 7-character name input.
   */
  showGameOver( { reason, victory, stats }) {
    this.lastGameStats = stats;
    this.recordSubmitted = false;

    if (this.els.gameoverTitle) {
      if (victory && reason === 'sprintComplete') {
        this.els.gameoverTitle.textContent = this.t('victorySprint');
      } else if (victory && reason === 'timeUp') {
        this.els.gameoverTitle.textContent = this.t('victoryUltra');
      } else {
        this.els.gameoverTitle.textContent = this.t('gameOver');
      }
    }

    if (this.els.statScore) this.els.statScore.textContent = stats.score.toLocaleString('tr-TR');
    if (this.els.statLines) this.els.statLines.textContent = String(stats.lines);
    if (this.els.statLevel) this.els.statLevel.textContent = String(stats.level);
    if (this.els.statSpeed) {
      this.els.statSpeed.textContent = `${stats.speedInfo.multiplier} (${stats.speedInfo.label})`;
    }
    if (this.els.statTime) this.els.statTime.textContent = formatTimeMs(stats.elapsedMs);
    if (this.els.statPPS) this.els.statPPS.textContent = String(stats.pps);
    if (this.els.statPieces) this.els.statPieces.textContent = String(stats.pieces);
    if (this.els.statTetris) this.els.statTetris.textContent = String(stats.tetrisCount);
    if (this.els.statTSpin) this.els.statTSpin.textContent = String(stats.tSpinCount);
    if (this.els.statCombo) this.els.statCombo.textContent = `${stats.maxCombo}x`;

    // Reset 7-character name input
    if (this.els.recordSaveBtn) this.els.recordSaveBtn.disabled = false;
    if (this.els.recordSavedMsg) this.els.recordSavedMsg.classList.add('is-hidden');
    const currentVal = (this.els.recordNameInput?.value || 'OYUNCU1').slice(0, 7);
    if (this.els.recordNameInput) {
      this.els.recordNameInput.value = currentVal;
    }
    this._renderSevenCharSlots(currentVal);

    this.showOverlay('gameoverOverlay');
    setTimeout(() => {
      this.els.recordNameInput?.focus();
      this.els.recordNameInput?.select();
    }, 80);
  }

  /**
   * Renders the 7 visual arcade character boxes beneath/above the 7-digit name input.
   */
  _renderSevenCharSlots(val = '') {
    if (!this.els.recordCharSlots) return;
    this.els.recordCharSlots.innerHTML = '';
    const chars = String(val || '').toUpperCase().slice(0, 7);
    for (let i = 0; i < 7; i++) {
      const slot = document.createElement('span');
      slot.className = 'char-slot' + (i < chars.length ? ' is-filled' : '');
      slot.textContent = chars[i] || '_';
      this.els.recordCharSlots.appendChild(slot);
    }
  }

  _submitSevenCharRecord() {
    if (this.recordSubmitted || !this.lastGameStats) return;
    const rawName = this.els.recordNameInput ? this.els.recordNameInput.value : 'OYUNCU1';
    const name = normalizeSevenCharName(rawName);

    if (this.els.recordNameInput) {
      this.els.recordNameInput.value = name;
    }
    this._renderSevenCharSlots(name);

    this.storage.addRecord(this.lastGameStats.mode, {
      name,
      score: this.lastGameStats.score,
      lines: this.lastGameStats.lines,
      level: this.lastGameStats.level,
      elapsedMs: this.lastGameStats.elapsedMs,
      pps: this.lastGameStats.pps,
    });

    this.recordSubmitted = true;
    this.audio.playLevelUp();
    if (this.els.recordSaveBtn) this.els.recordSaveBtn.disabled = true;
    if (this.els.recordSavedMsg) this.els.recordSavedMsg.classList.remove('is-hidden');

    this.refreshMenuBests();
    this.renderLeaderboardTable(this.lastGameStats.mode);
  }

  /**
   * Populates the Rekorlar (High Score Leaderboard) table for the selected mode.
   */
  renderLeaderboardTable(mode = 'marathon') {
    this.activeLeaderboardMode = mode;
    this.els.leaderboardTabs.forEach((tab) => {
      tab.classList.toggle('is-active', tab.getAttribute('data-lb-mode') === mode);
    });

    if (!this.els.leaderboardBody) return;
    const list = this.storage.getModeLeaderboard(mode);
    this.els.leaderboardBody.innerHTML = '';

    if (list.length === 0) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 5;
      td.textContent = this.t('leaderboardEmpty');
      tr.appendChild(td);
      this.els.leaderboardBody.appendChild(tr);
      return;
    }

    list.forEach((entry, idx) => {
      const tr = document.createElement('tr');
      const rankTd = document.createElement('td');
      rankTd.textContent = `${idx + 1}`;

      const nameTd = document.createElement('td');
      const nameBadge = document.createElement('span');
      nameBadge.className = 'lb-name-badge';
      nameBadge.textContent = normalizeSevenCharName(entry.name).padEnd(7, ' ');
      nameTd.appendChild(nameBadge);

      const scoreTd = document.createElement('td');
      if (mode === 'sprint') {
        scoreTd.textContent = `${formatTimeMs(entry.elapsedMs)} (${entry.lines}S)`;
      } else {
        scoreTd.textContent = entry.score.toLocaleString('tr-TR');
      }

      const levelTd = document.createElement('td');
      levelTd.textContent = `Sv. ${entry.level}`;

      const ppsTd = document.createElement('td');
      ppsTd.textContent = `${entry.pps || 0} PPS`;

      tr.append(rankTd, nameTd, scoreTd, levelTd, ppsTd);
      this.els.leaderboardBody.appendChild(tr);
    });
  }
}
