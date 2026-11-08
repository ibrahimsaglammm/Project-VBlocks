// src/input/keyboard.js
// Desktop keyboard input controller with configurable DAS (Delayed Auto Shift),
// ARR (Auto Repeat Rate), and customizable key bindings.

export const DEFAULT_KEY_BINDINGS = Object.freeze({
  moveLeft: 'ArrowLeft',
  moveRight: 'ArrowRight',
  softDrop: 'ArrowDown',
  hardDrop: 'Space',
  rotateCW: 'ArrowUp',
  rotateCCW: 'KeyZ',
  rotate180: 'KeyA',
  hold: 'KeyC',
  pause: 'Escape',
  restart: 'KeyR',
});

// Secondary convenience aliases that always work alongside primary bindings
const SECONDARY_ALIASES = Object.freeze({
  moveLeft: ['KeyJ'],
  moveRight: ['KeyL'],
  softDrop: ['KeyK'],
  rotateCW: ['KeyX'],
  rotateCCW: ['ControlLeft', 'ControlRight'],
  hold: ['ShiftLeft', 'ShiftRight'],
  pause: ['KeyP'],
});

export class KeyboardInput {
  constructor({ onAction, settings = {} }) {
    this.onAction = onAction;
    this.das = settings.das ?? 167;
    this.arr = settings.arr ?? 33;
    this.bindings = { ...DEFAULT_KEY_BINDINGS, ...(settings.keyBindings || {}) };

    this.enabled = true;
    this.isRebinding = false;
    this.onRebindCapture = null;

    // Horizontal movement state for DAS/ARR
    this.leftHeld = false;
    this.rightHeld = false;
    this.activeDir = 0; // -1 left, 1 right, 0 none
    this.dasTimerMs = 0;
    this.arrTimerMs = 0;

    // Soft drop state
    this.softDropHeld = false;

    this._handleKeyDown = this._handleKeyDown.bind(this);
    this._handleKeyUp = this._handleKeyUp.bind(this);
    this._handleBlur = this._handleBlur.bind(this);

    window.addEventListener('keydown', this._handleKeyDown);
    window.addEventListener('keyup', this._handleKeyUp);
    window.addEventListener('blur', this._handleBlur);
  }

  updateSettings(partial = {}) {
    if (typeof partial.das === 'number') this.das = partial.das;
    if (typeof partial.arr === 'number') this.arr = partial.arr;
    if (partial.keyBindings) {
      this.bindings = { ...DEFAULT_KEY_BINDINGS, ...partial.keyBindings };
    }
  }

  startRebind(callback) {
    this.isRebinding = true;
    this.onRebindCapture = callback;
  }

  cancelRebind() {
    this.isRebinding = false;
    this.onRebindCapture = null;
  }

  _matchesAction(code, action) {
    if (this.bindings[action] === code) return true;
    const aliases = SECONDARY_ALIASES[action];
    if (aliases && aliases.includes(code)) {
      // Only use alias if it isn't explicitly bound to another primary action
      const boundElsewhere = Object.entries(this.bindings).some(
        ([k, v]) => k !== action && v === code
      );
      return !boundElsewhere;
    }
    return false;
  }

  _isTypingInInput(event) {
    const tag = event.target && event.target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }

  _handleKeyDown(event) {
    if (this._isTypingInInput(event)) return;

    if (this.isRebinding && this.onRebindCapture) {
      event.preventDefault();
      const code = event.code;
      const cb = this.onRebindCapture;
      this.isRebinding = false;
      this.onRebindCapture = null;
      cb(code);
      return;
    }

    if (!this.enabled) return;

    const code = event.code;

    // Prevent browser scrolling on game keys
    if (
      ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(code)
    ) {
      event.preventDefault();
    }

    if (event.repeat) return;

    if (this._matchesAction(code, 'moveLeft')) {
      this.leftHeld = true;
      this.activeDir = -1;
      this.dasTimerMs = 0;
      this.arrTimerMs = 0;
      this.onAction('moveLeft');
    } else if (this._matchesAction(code, 'moveRight')) {
      this.rightHeld = true;
      this.activeDir = 1;
      this.dasTimerMs = 0;
      this.arrTimerMs = 0;
      this.onAction('moveRight');
    } else if (this._matchesAction(code, 'softDrop')) {
      this.softDropHeld = true;
    } else if (this._matchesAction(code, 'hardDrop')) {
      this.onAction('hardDrop');
    } else if (this._matchesAction(code, 'rotateCW')) {
      this.onAction('rotateCW');
    } else if (this._matchesAction(code, 'rotateCCW')) {
      this.onAction('rotateCCW');
    } else if (this._matchesAction(code, 'rotate180')) {
      this.onAction('rotate180');
    } else if (this._matchesAction(code, 'hold')) {
      this.onAction('hold');
    } else if (this._matchesAction(code, 'pause')) {
      this.onAction('pause');
    } else if (this._matchesAction(code, 'restart')) {
      this.onAction('restart');
    }
  }

  _handleKeyUp(event) {
    const code = event.code;
    if (this._matchesAction(code, 'moveLeft')) {
      this.leftHeld = false;
      if (this.rightHeld) {
        this.activeDir = 1;
        this.dasTimerMs = 0;
        this.arrTimerMs = 0;
      } else if (this.activeDir === -1) {
        this.activeDir = 0;
      }
    } else if (this._matchesAction(code, 'moveRight')) {
      this.rightHeld = false;
      if (this.leftHeld) {
        this.activeDir = -1;
        this.dasTimerMs = 0;
        this.arrTimerMs = 0;
      } else if (this.activeDir === 1) {
        this.activeDir = 0;
      }
    } else if (this._matchesAction(code, 'softDrop')) {
      this.softDropHeld = false;
    }
  }

  _handleBlur() {
    this.resetState();
  }

  resetState() {
    this.leftHeld = false;
    this.rightHeld = false;
    this.activeDir = 0;
    this.dasTimerMs = 0;
    this.arrTimerMs = 0;
    this.softDropHeld = false;
  }

  /**
   * Called once per simulation tick with `dtMs`.
   */
  update(dtMs) {
    if (!this.enabled || this.activeDir === 0) return;

    this.dasTimerMs += dtMs;
    if (this.dasTimerMs < this.das) return;

    const action = this.activeDir === -1 ? 'moveLeft' : 'moveRight';

    if (this.arr <= 0) {
      // Instant ARR (0 ms): shift all the way to the wall
      for (let i = 0; i < 10; i++) {
        this.onAction(action);
      }
      return;
    }

    this.arrTimerMs += dtMs;
    while (this.arrTimerMs >= this.arr) {
      this.arrTimerMs -= this.arr;
      this.onAction(action);
    }
  }

  destroy() {
    window.removeEventListener('keydown', this._handleKeyDown);
    window.removeEventListener('keyup', this._handleKeyUp);
    window.removeEventListener('blur', this._handleBlur);
  }
}
