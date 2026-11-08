// src/main.js
// Application bootstrap, fixed-timestep 60 FPS loop, event wiring,
// adaptive FPS quality monitor, visibilitychange auto-pause, and PWA registration.

import { TetrisGame, GAME_STATES } from './game.js';
import { EffectsManager } from './effects.js';
import { Renderer } from './renderer.js';
import { AudioEngine } from './audio.js';
import { KeyboardInput } from './input/keyboard.js';
import { TouchInput } from './input/touch.js';
import { GamepadInput } from './input/gamepad.js';
import { StorageManager } from './storage.js';
import { UIController } from './ui.js';

const FIXED_STEP_MS = 1000 / 60; // 16.6667 ms (60 Hz deterministic simulation step)
const MAX_FRAME_DELTA_MS = 100;

function initApp() {
  const storage = new StorageManager();
  let settings = storage.loadSettings();

  const effects = new EffectsManager(settings);
  const audio = new AudioEngine(settings);

  const boardCanvas = document.getElementById('board-canvas');
  const holdCanvas = document.getElementById('hold-canvas');
  const nextCanvas = document.getElementById('next-canvas');
  const bgCanvas = document.getElementById('bg-canvas');
  const boardStage = document.getElementById('board-stage');
  const holdBox = document.getElementById('hold-box');
  const touchButtons = document.getElementById('touch-controls');

  const renderer = new Renderer({
    boardCanvas,
    holdCanvas,
    nextCanvas,
    bgCanvas,
    effects,
    settings,
  });

  let ui = null;

  const game = new TetrisGame({
    settings,
    onEvent: (type, payload) => handleGameEvent(type, payload),
  });

  function handleAction(action) {
    if (action === 'pause') {
      togglePause();
      return;
    }
    if (action === 'restart') {
      if (game.state === GAME_STATES.PLAYING || game.state === GAME_STATES.PAUSED) {
        startNewGame(game.mode);
      }
      return;
    }

    if (game.state !== GAME_STATES.PLAYING) return;

    switch (action) {
      case 'moveLeft':
        game.moveLeft();
        break;
      case 'moveRight':
        game.moveRight();
        break;
      case 'softDropStep':
        game.softDropStep();
        break;
      case 'hardDrop':
        game.hardDrop();
        break;
      case 'rotateCW':
        game.rotate(1);
        break;
      case 'rotateCCW':
        game.rotate(-1);
        break;
      case 'rotate180':
        game.rotate(2);
        break;
      case 'hold':
        game.hold();
        break;
      default:
        break;
    }
  }

  const keyboard = new KeyboardInput({ onAction: handleAction, settings });
  const touch = new TouchInput({
    boardElement: boardCanvas,
    holdElement: holdBox,
    buttonsContainer: touchButtons,
    onAction: handleAction,
    settings,
  });
  const gamepad = new GamepadInput({ onAction: handleAction, settings });

  ui = new UIController({
    storage,
    settings,
    keyboard,
    audio,
    callbacks: {
      onStartMode: (mode) => startNewGame(mode),
      onContinueSaved: () => restoreSavedGame(),
      onTogglePause: () => togglePause(),
      onResumeWithCountdown: () => resumeWithCountdown(),
      onRestart: () => startNewGame(game.mode),
      onReturnToMenu: () => returnToMainMenu(),
      onSettingsChanged: (newSettings) => {
        settings = newSettings;
        game.updateSettings(newSettings);
        effects.updateSettings(newSettings);
        renderer.updateSettings(newSettings);
        audio.updateSettings(newSettings);
        keyboard.updateSettings(newSettings);
        touch.updateSettings(newSettings);
        gamepad.updateSettings(newSettings);
      },
    },
  });

  function handleGameEvent(type, payload) {
    switch (type) {
      case 'gameStart':
        effects.clear();
        if (ui) {
          ui.updateColorSwatches(payload.colorMap);
          ui.updateHUD(game);
        }
        audio.startMusic(payload.level, payload.mode);
        break;

      case 'paletteChanged':
        if (ui) {
          ui.updateColorSwatches(payload.colorMap);
        }
        break;

      case 'move':
        audio.playMove();
        break;

      case 'rotate':
        audio.playRotate();
        break;

      case 'softDropStep':
        audio.playSoftDrop();
        break;

      case 'hardDrop':
        audio.playHardDrop();
        effects.spawnHardDropTrail(
          payload.piece,
          payload.startY,
          payload.endY,
          renderer.cellSize
        );
        if (payload.cellsDropped >= 3) {
          effects.triggerShake(4.5, 130);
        }
        break;

      case 'hold':
        audio.playHold();
        break;

      case 'pieceLocked': {
        effects.spawnLockFlash(payload.lockedCells);
        if (payload.linesCleared > 0) {
          // Colorful explosion particles from every destroyed block!
          effects.spawnRowFlashes(payload.clearedRows);
          effects.spawnLineExplosion(payload.destroyedCells, renderer.cellSize);
          touch.vibrate(payload.linesCleared >= 4 ? [30, 40, 60] : 25);

          if (payload.tSpin !== 'none') {
            audio.playTSpin();
            effects.triggerShake(8, 260);
          } else if (payload.linesCleared >= 4) {
            audio.playTetris();
            effects.triggerShake(9, 280);
          } else {
            audio.playLineClear(payload.linesCleared, payload.combo);
            effects.triggerShake(3 + payload.linesCleared * 1.5, 180);
          }
        } else {
          audio.playLock();
          if (payload.tSpin !== 'none') {
            audio.playTSpin();
          }
        }

        // Display floating text callouts ("TETRIS", "T-SPIN DOUBLE", "B2B", "COMBO x3", "PERFECT CLEAR")
        if (Array.isArray(payload.callouts)) {
          payload.callouts.forEach((text) => {
            const color = text.includes('TETRIS')
              ? '#00e5ff'
              : text.includes('T-SPIN')
                ? '#ff2a5f'
                : text.includes('PERFECT')
                  ? '#ffd600'
                  : '#00e676';
            effects.addCallout(text, color);
          });
        }

        // Save in-progress Marathon game periodically on piece lock
        if (game.mode === 'marathon' && game.state === GAME_STATES.PLAYING) {
          storage.saveGameState(game.serialize());
        }
        break;
      }

      case 'levelUp':
        audio.playLevelUp();
        audio.setLevel(payload.level);
        effects.triggerLevelUpPulse();
        if (ui) {
          ui.updateColorSwatches(payload.colorMap);
          effects.addCallout(ui.t('levelUpCallout'), '#ffd600');
        }
        break;

      case 'zenClear':
        effects.spawnLineExplosion(payload.destroyedCells, renderer.cellSize);
        audio.playLineClear(4, 1);
        break;

      case 'gameOver':
        audio.stopMusic();
        audio.playGameOver();
        storage.clearSavedGameState();
        if (ui) {
          ui.refreshMenuBests();
          ui.showGameOver(payload);
        }
        break;

      default:
        break;
    }
  }

  function startNewGame(mode = 'marathon') {
    keyboard.resetState();
    touch.resetState();
    game.start(mode, Date.now());
    ui.updateHUD(game);
    ui.updateColorSwatches(game.colorMap);
  }

  function restoreSavedGame() {
    const saved = storage.loadSavedGameState();
    if (!saved) {
      startNewGame('marathon');
      return;
    }
    const ok = game.restore(saved);
    if (ok) {
      ui.updateHUD(game);
      ui.updateColorSwatches(game.colorMap);
      resumeWithCountdown();
    } else {
      startNewGame('marathon');
    }
  }

  function togglePause() {
    if (game.state === GAME_STATES.PLAYING) {
      game.pause();
      audio.stopMusic();
      keyboard.resetState();
      touch.resetState();
      if (game.mode === 'marathon') {
        storage.saveGameState(game.serialize());
      }
      ui.showOverlay('pauseOverlay');
    } else if (game.state === GAME_STATES.PAUSED) {
      resumeWithCountdown();
    }
  }

  function resumeWithCountdown() {
    game.state = GAME_STATES.COUNTDOWN;
    ui.runResumeCountdown(() => {
      game.resume();
      audio.startMusic(game.level, game.mode);
    });
  }

  function returnToMainMenu() {
    if (game.mode === 'marathon' && (game.state === GAME_STATES.PLAYING || game.state === GAME_STATES.PAUSED)) {
      storage.saveGameState(game.serialize());
    }
    game.state = GAME_STATES.IDLE;
    audio.stopMusic();
    ui.hideAllOverlays();
    ui.refreshMenuBests();
    ui.showOverlay('menuOverlay');
  }

  // Handle responsive layout resize cleanly without losing game state
  function handleResize() {
    if (!boardStage) return;
    const gridEl = boardStage.parentElement;
    const gridRect = gridEl ? gridEl.getBoundingClientRect() : boardStage.getBoundingClientRect();
    const w = Math.max(160, gridRect.width - 8);
    const h = Math.max(260, gridRect.height - 8);
    renderer.resize(w, h);
    renderer.render(game, 0);
  }

  window.addEventListener('resize', handleResize);
  window.addEventListener('orientationchange', () => setTimeout(handleResize, 100));

  // Auto-pause when tab or app is hidden
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && game.state === GAME_STATES.PLAYING) {
      togglePause();
    }
  });
  window.addEventListener('blur', () => {
    if (game.state === GAME_STATES.PLAYING) {
      togglePause();
    }
  });

  // Initial sizing and color swatches
  requestAnimationFrame(() => {
    handleResize();
    ui.updateColorSwatches(game.colorMap);
    ui.updateHUD(game);
  });

  // Fixed-timestep 60 FPS loop with adaptive quality fallback
  let lastFrameTime = performance.now();
  let accumulatorMs = 0;
  let slowFrameCount = 0;

  function loop(now) {
    const rawDelta = Math.max(0, now - lastFrameTime);
    lastFrameTime = now;

    // Adaptive quality check if frame rate drops below ~42 FPS consistently
    if (rawDelta > 26 && rawDelta < 120) {
      slowFrameCount = Math.min(30, slowFrameCount + 1);
      if (slowFrameCount > 18) {
        effects.setQualityScale(0.45);
      }
    } else if (rawDelta < 18 && slowFrameCount > 0) {
      slowFrameCount--;
      if (slowFrameCount === 0) {
        effects.setQualityScale(1.0);
      }
    }

    const frameDelta = Math.min(MAX_FRAME_DELTA_MS, rawDelta);
    accumulatorMs += frameDelta;

    while (accumulatorMs >= FIXED_STEP_MS) {
      accumulatorMs -= FIXED_STEP_MS;
      keyboard.update(FIXED_STEP_MS);
      touch.update(FIXED_STEP_MS);
      gamepad.update(FIXED_STEP_MS);

      const isSoftDropping =
        keyboard.softDropHeld || touch.softDropHeld || gamepad.softDropHeld;
      game.update(FIXED_STEP_MS, isSoftDropping);
      effects.update(FIXED_STEP_MS);
    }

    if (game.state === GAME_STATES.PLAYING) {
      ui.updateHUD(game);
    }

    renderer.renderBackground(frameDelta, game.level);
    renderer.render(game, frameDelta);

    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);

  // Register Service Worker for offline PWA support (only over http/https; not available on file://)
  const isWebOrigin = location.protocol === 'http:' || location.protocol === 'https:';
  if (isWebOrigin && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.warn('Service worker registration failed:', err && err.message);
    });
  }
}

// The script may run before or after DOMContentLoaded (classic bundle vs. module), so handle both.
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
