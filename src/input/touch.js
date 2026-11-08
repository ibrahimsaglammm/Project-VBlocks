// src/input/touch.js
// Mobile-first touch input controller supporting:
// 1. Direct board gestures (Tap = CW, 2-finger tap = CCW, Horizontal drag = proportional column shift,
//    Slow downward drag = soft drop, Fast downward flick = hard drop, Swipe up = hold)
// 2. Ergonomic on-screen thumb buttons with DAS/ARR repeat, button size, and left-handed layout
// 3. Haptic feedback via navigator.vibrate

export class TouchInput {
  constructor({ boardElement, holdElement, buttonsContainer, onAction, settings = {} }) {
    this.boardElement = boardElement;
    this.holdElement = holdElement;
    this.buttonsContainer = buttonsContainer;
    this.onAction = onAction;

    this.settings = {
      touchScheme: 'both', // 'gestures' | 'buttons' | 'both'
      touchSensitivity: 1.0, // 0.5 .. 1.8 multiplier
      buttonSize: 'medium', // 'small' | 'medium' | 'large'
      leftHanded: false,
      haptics: true,
      das: 167,
      arr: 33,
      ...settings,
    };

    this.enabled = true;
    this.softDropHeld = false;

    // Active gesture tracking state
    this.primaryTouchId = null;
    this.startX = 0;
    this.startY = 0;
    this.lastX = 0;
    this.lastY = 0;
    this.accumulatedX = 0;
    this.accumulatedY = 0;
    this.startTime = 0;
    this.lastMoveTime = 0;
    this.velocityY = 0;
    this.movedHorizontally = false;
    this.movedVertically = false;
    this.gestureConsumed = false;
    this.maxConcurrentTouches = 0;

    // On-screen button repeat state
    this.heldButtonDir = 0; // -1 left, 1 right
    this.dasTimerMs = 0;
    this.arrTimerMs = 0;

    this._bindEvents();
    this._applyLayoutSettings();
  }

  updateSettings(partial = {}) {
    this.settings = { ...this.settings, ...partial };
    this._applyLayoutSettings();
  }

  _applyLayoutSettings() {
    if (!this.buttonsContainer) return;
    const scheme = this.settings.touchScheme || 'both';
    this.buttonsContainer.dataset.scheme = scheme;
    this.buttonsContainer.dataset.size = this.settings.buttonSize || 'medium';
    this.buttonsContainer.dataset.handed = this.settings.leftHanded ? 'left' : 'right';
  }

  vibrate(pattern = 10) {
    if (!this.settings.haptics) return;
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(pattern);
      }
    } catch {
      // Ignore vibration errors on unsupported browsers
    }
  }

  _bindEvents() {
    if (this.boardElement) {
      this.boardElement.addEventListener('touchstart', (e) => this._onTouchStart(e), {
        passive: false,
      });
      this.boardElement.addEventListener('touchmove', (e) => this._onTouchMove(e), {
        passive: false,
      });
      this.boardElement.addEventListener('touchend', (e) => this._onTouchEnd(e), {
        passive: false,
      });
      this.boardElement.addEventListener('touchcancel', () => this.resetState(), {
        passive: false,
      });
    }

    // Tap on Hold box triggers hold
    if (this.holdElement) {
      this.holdElement.addEventListener('pointerdown', (e) => {
        if (!this.enabled) return;
        e.preventDefault();
        this.vibrate(14);
        this.onAction('hold');
      });
    }

    // Bind virtual thumb buttons using Pointer Events for zero-delay multi-touch safety
    if (this.buttonsContainer) {
      const buttons = this.buttonsContainer.querySelectorAll('[data-touch-action]');
      buttons.forEach((btn) => {
        const action = btn.getAttribute('data-touch-action');

        btn.addEventListener('pointerdown', (e) => {
          if (!this.enabled) return;
          e.preventDefault();
          btn.classList.add('is-active');
          try {
            btn.setPointerCapture(e.pointerId);
          } catch {
            // ignore
          }
          this._onVirtualButtonDown(action);
        });

        const release = (e) => {
          e.preventDefault();
          btn.classList.remove('is-active');
          this._onVirtualButtonUp(action);
        };

        btn.addEventListener('pointerup', release);
        btn.addEventListener('pointercancel', release);
        btn.addEventListener('lostpointercapture', release);
      });
    }

    window.addEventListener('blur', () => this.resetState());
  }

  _onVirtualButtonDown(action) {
    if (action === 'moveLeft') {
      this.heldButtonDir = -1;
      this.dasTimerMs = 0;
      this.arrTimerMs = 0;
      this.vibrate(8);
      this.onAction('moveLeft');
    } else if (action === 'moveRight') {
      this.heldButtonDir = 1;
      this.dasTimerMs = 0;
      this.arrTimerMs = 0;
      this.vibrate(8);
      this.onAction('moveRight');
    } else if (action === 'softDrop') {
      this.softDropHeld = true;
      this.vibrate(8);
      this.onAction('softDropStep');
    } else if (action === 'hardDrop') {
      this.vibrate([18, 25, 18]);
      this.onAction('hardDrop');
    } else if (action === 'rotateCW') {
      this.vibrate(10);
      this.onAction('rotateCW');
    } else if (action === 'rotateCCW') {
      this.vibrate(10);
      this.onAction('rotateCCW');
    } else if (action === 'hold') {
      this.vibrate(14);
      this.onAction('hold');
    }
  }

  _onVirtualButtonUp(action) {
    if (action === 'moveLeft' && this.heldButtonDir === -1) {
      this.heldButtonDir = 0;
    } else if (action === 'moveRight' && this.heldButtonDir === 1) {
      this.heldButtonDir = 0;
    } else if (action === 'softDrop') {
      this.softDropHeld = false;
    }
  }

  _getStepPx() {
    const rect = this.boardElement.getBoundingClientRect();
    const baseColWidth = Math.max(20, rect.width / 10);
    const sens = Math.max(0.4, Math.min(2.0, Number(this.settings.touchSensitivity) || 1.0));
    return baseColWidth / sens;
  }

  _onTouchStart(e) {
    if (!this.enabled || this.settings.touchScheme === 'buttons') return;
    e.preventDefault();

    this.maxConcurrentTouches = Math.max(this.maxConcurrentTouches, e.touches.length);

    if (e.touches.length === 2) {
      // Two-finger tap on the board rotates counter-clockwise immediately
      this.gestureConsumed = true;
      this.vibrate(12);
      this.onAction('rotateCCW');
      return;
    }

    if (this.primaryTouchId === null && e.changedTouches.length > 0) {
      const t = e.changedTouches[0];
      this.primaryTouchId = t.identifier;
      this.startX = t.clientX;
      this.startY = t.clientY;
      this.lastX = t.clientX;
      this.lastY = t.clientY;
      this.accumulatedX = 0;
      this.accumulatedY = 0;
      this.startTime = performance.now();
      this.lastMoveTime = this.startTime;
      this.velocityY = 0;
      this.movedHorizontally = false;
      this.movedVertically = false;
      this.gestureConsumed = false;
      this.maxConcurrentTouches = 1;
    }
  }

  _onTouchMove(e) {
    if (
      !this.enabled ||
      this.settings.touchScheme === 'buttons' ||
      this.primaryTouchId === null ||
      this.gestureConsumed
    ) {
      return;
    }
    e.preventDefault();

    let touch = null;
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === this.primaryTouchId) {
        touch = e.changedTouches[i];
        break;
      }
    }
    if (!touch) return;

    const now = performance.now();
    const dt = Math.max(1, now - this.lastMoveTime);
    const dx = touch.clientX - this.lastX;
    const dy = touch.clientY - this.lastY;

    this.velocityY = dy / dt; // px per ms
    this.lastX = touch.clientX;
    this.lastY = touch.clientY;
    this.lastMoveTime = now;

    const totalDx = touch.clientX - this.startX;
    const totalDy = touch.clientY - this.startY;
    const stepPx = this._getStepPx();

    // Check upward swipe for Hold piece
    if (
      !this.movedHorizontally &&
      !this.movedVertically &&
      totalDy < -stepPx * 1.65 &&
      Math.abs(totalDy) > Math.abs(totalDx) * 1.5
    ) {
      this.gestureConsumed = true;
      this.vibrate(14);
      this.onAction('hold');
      return;
    }

    // Horizontal proportional column dragging (suppress during steep vertical flick)
    const isSteepVertical = Math.abs(dy) > Math.abs(dx) * 2.2 && this.velocityY > 0.9;
    if (!isSteepVertical) {
      this.accumulatedX += dx;
      while (Math.abs(this.accumulatedX) >= stepPx) {
        if (this.accumulatedX > 0) {
          this.accumulatedX -= stepPx;
          this.movedHorizontally = true;
          this.vibrate(6);
          this.onAction('moveRight');
        } else {
          this.accumulatedX += stepPx;
          this.movedHorizontally = true;
          this.vibrate(6);
          this.onAction('moveLeft');
        }
      }
    }

    // Slow downward drag -> soft drop steps
    if (dy > 0 && this.velocityY < 1.15) {
      this.accumulatedY += dy;
      const dropStepPx = stepPx * 0.85;
      while (this.accumulatedY >= dropStepPx) {
        this.accumulatedY -= dropStepPx;
        this.movedVertically = true;
        this.onAction('softDropStep');
      }
    }
  }

  _onTouchEnd(e) {
    if (!this.enabled || this.settings.touchScheme === 'buttons') return;
    e.preventDefault();

    let endedPrimary = null;
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === this.primaryTouchId) {
        endedPrimary = e.changedTouches[i];
        break;
      }
    }
    if (!endedPrimary) return;

    const now = performance.now();
    const duration = Math.max(1, now - this.startTime);
    const totalDx = endedPrimary.clientX - this.startX;
    const totalDy = endedPrimary.clientY - this.startY;
    const overallVy = totalDy / duration;

    if (!this.gestureConsumed && this.maxConcurrentTouches === 1) {
      // Check fast downward flick -> Hard Drop
      if (
        totalDy > 38 &&
        Math.abs(totalDy) > Math.abs(totalDx) * 1.35 &&
        (overallVy > 0.65 || this.velocityY > 0.95)
      ) {
        this.vibrate([18, 25, 18]);
        this.onAction('hardDrop');
      } else if (
        // Tap on board -> Rotate Clockwise
        !this.movedHorizontally &&
        !this.movedVertically &&
        Math.hypot(totalDx, totalDy) < 18 &&
        duration < 280
      ) {
        this.vibrate(10);
        this.onAction('rotateCW');
      }
    }

    this.primaryTouchId = null;
    if (e.touches.length === 0) {
      this.maxConcurrentTouches = 0;
    }
  }

  resetState() {
    this.primaryTouchId = null;
    this.heldButtonDir = 0;
    this.softDropHeld = false;
    this.dasTimerMs = 0;
    this.arrTimerMs = 0;
    this.gestureConsumed = false;
  }

  update(dtMs) {
    if (!this.enabled || this.heldButtonDir === 0) return;

    this.dasTimerMs += dtMs;
    if (this.dasTimerMs < this.settings.das) return;

    const action = this.heldButtonDir === -1 ? 'moveLeft' : 'moveRight';
    const arr = Math.max(16, this.settings.arr);
    this.arrTimerMs += dtMs;
    while (this.arrTimerMs >= arr) {
      this.arrTimerMs -= arr;
      this.vibrate(5);
      this.onAction(action);
    }
  }
}
