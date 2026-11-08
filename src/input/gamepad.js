// src/input/gamepad.js
// Standard Gamepad API polling controller with DAS/ARR support.

export class GamepadInput {
  constructor({ onAction, settings = {} }) {
    this.onAction = onAction;
    this.das = settings.das ?? 167;
    this.arr = settings.arr ?? 33;
    this.enabled = true;

    this.prevButtons = new Map();
    this.activeDir = 0;
    this.dasTimerMs = 0;
    this.arrTimerMs = 0;
    this.softDropHeld = false;
  }

  updateSettings(partial = {}) {
    if (typeof partial.das === 'number') this.das = partial.das;
    if (typeof partial.arr === 'number') this.arr = partial.arr;
  }

  update(dtMs) {
    if (!this.enabled || typeof navigator.getGamepads !== 'function') return;

    const pads = navigator.getGamepads();
    let pad = null;
    for (let i = 0; i < pads.length; i++) {
      if (pads[i] && pads[i].connected) {
        pad = pads[i];
        break;
      }
    }
    if (!pad) {
      this.softDropHeld = false;
      this.activeDir = 0;
      return;
    }

    const isPressed = (idx) => Boolean(pad.buttons[idx] && pad.buttons[idx].pressed);
    const justPressed = (idx) => isPressed(idx) && !this.prevButtons.get(idx);

    // Standard Gamepad mapping:
    // 0 (A/Cross): Rotate CW
    // 1 (B/Circle): Rotate CCW
    // 2 (X/Square): Rotate 180
    // 3 (Y/Triangle) or 4 (LB) or 5 (RB): Hold
    // 12 (D-Up): Hard Drop
    // 13 (D-Down): Soft Drop
    // 14 (D-Left): Move Left
    // 15 (D-Right): Move Right
    // 9 (Start): Pause
    // 8 (Select/Back): Restart

    if (justPressed(0)) this.onAction('rotateCW');
    if (justPressed(1)) this.onAction('rotateCCW');
    if (justPressed(2)) this.onAction('rotate180');
    if (justPressed(3) || justPressed(4) || justPressed(5)) this.onAction('hold');
    if (justPressed(12)) this.onAction('hardDrop');
    if (justPressed(9)) this.onAction('pause');
    if (justPressed(8)) this.onAction('restart');

    const axisX = pad.axes[0] || 0;
    const axisY = pad.axes[1] || 0;

    const leftDown = isPressed(14) || axisX < -0.45;
    const rightDown = isPressed(15) || axisX > 0.45;
    this.softDropHeld = isPressed(13) || axisY > 0.5;

    const newDir = leftDown ? -1 : rightDown ? 1 : 0;
    if (newDir !== this.activeDir) {
      this.activeDir = newDir;
      this.dasTimerMs = 0;
      this.arrTimerMs = 0;
      if (newDir === -1) this.onAction('moveLeft');
      else if (newDir === 1) this.onAction('moveRight');
    } else if (this.activeDir !== 0) {
      this.dasTimerMs += dtMs;
      if (this.dasTimerMs >= this.das) {
        this.arrTimerMs += dtMs;
        const stepArr = Math.max(16, this.arr);
        while (this.arrTimerMs >= stepArr) {
          this.arrTimerMs -= stepArr;
          this.onAction(this.activeDir === -1 ? 'moveLeft' : 'moveRight');
        }
      }
    }

    // Store button states for edge detection
    for (let i = 0; i < pad.buttons.length; i++) {
      this.prevButtons.set(i, isPressed(i));
    }
  }
}
