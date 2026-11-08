// src/audio.js
// Pure Web Audio API synthesizer for all game SFX and procedural tempo-scaling background music.
// Zero external audio files required; handles browser autoplay and iOS audio unlock cleanly.

// Melody sequence (MIDI note numbers inspired by classic Russian folk / arcade theme)
const ARCADE_MELODY = [
  [76, 2], [71, 1], [72, 1], [74, 2], [72, 1], [71, 1],
  [69, 2], [69, 1], [72, 1], [76, 2], [74, 1], [72, 1],
  [71, 2], [71, 1], [72, 1], [74, 2], [76, 2],
  [72, 2], [69, 2], [69, 4],
  [74, 2], [77, 1], [81, 2], [79, 1], [77, 1],
  [76, 3], [72, 1], [76, 2], [74, 1], [72, 1],
  [71, 2], [71, 1], [72, 1], [74, 2], [76, 2],
  [72, 2], [69, 2], [69, 4],
];

// Calm pentatonic sequence for Zen mode
const ZEN_MELODY = [
  [60, 4], [64, 4], [67, 4], [71, 4],
  [69, 4], [67, 4], [64, 4], [62, 4],
];

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export class AudioEngine {
  constructor(settings = {}) {
    this.ctx = null;
    this.sfxGain = null;
    this.musicGain = null;

    this.sfxVolume = settings.sfxVolume ?? 0.75;
    this.musicVolume = settings.musicVolume ?? 0.45;

    this.unlocked = false;
    this.musicPlaying = false;
    this.musicTimer = null;
    this.noteIndex = 0;
    this.level = 1;
    this.mode = 'marathon';

    this._bindUnlock();
  }

  _bindUnlock() {
    if (typeof window === 'undefined') return;
    const unlock = () => {
      this._ensureContext();
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      this.unlocked = true;
    };

    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('touchstart', unlock, { passive: true });
    window.addEventListener('keydown', unlock, { passive: true });
  }

  _ensureContext() {
    if (this.ctx || typeof window === 'undefined') return this.ctx;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;

    this.ctx = new AudioCtx();
    this.sfxGain = this.ctx.createGain();
    this.musicGain = this.ctx.createGain();

    this.sfxGain.gain.value = this.sfxVolume;
    this.musicGain.gain.value = this.musicVolume * 0.35;

    this.sfxGain.connect(this.ctx.destination);
    this.musicGain.connect(this.ctx.destination);
    return this.ctx;
  }

  updateSettings(partial = {}) {
    if (typeof partial.sfxVolume === 'number') {
      this.sfxVolume = partial.sfxVolume;
      if (this.sfxGain && this.ctx) {
        this.sfxGain.gain.setTargetAtTime(this.sfxVolume, this.ctx.currentTime, 0.02);
      }
    }
    if (typeof partial.musicVolume === 'number') {
      this.musicVolume = partial.musicVolume;
      if (this.musicGain && this.ctx) {
        this.musicGain.gain.setTargetAtTime(this.musicVolume * 0.35, this.ctx.currentTime, 0.02);
      }
    }
  }

  _playTone({
    freq = 440,
    endFreq = null,
    type = 'triangle',
    duration = 0.08,
    delay = 0,
    gain = 0.25,
    target = 'sfx',
  }) {
    const ctx = this._ensureContext();
    if (!ctx) return;
    if (target === 'sfx' && this.sfxVolume <= 0.001) return;
    if (target === 'music' && this.musicVolume <= 0.001) return;

    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const startTime = ctx.currentTime + delay;
    const stopTime = startTime + duration;

    const osc = ctx.createOscillator();
    const env = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, startTime);
    if (endFreq !== null) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), stopTime);
    }

    env.gain.setValueAtTime(0.0001, startTime);
    env.gain.linearRampToValueAtTime(gain, startTime + Math.min(0.012, duration * 0.25));
    env.gain.exponentialRampToValueAtTime(0.0001, stopTime);

    osc.connect(env);
    env.connect(target === 'music' ? this.musicGain : this.sfxGain);

    osc.start(startTime);
    osc.stop(stopTime + 0.01);
  }

  playMove() {
    this._playTone({ freq: 240, endFreq: 290, type: 'triangle', duration: 0.035, gain: 0.18 });
  }

  playRotate() {
    this._playTone({ freq: 390, endFreq: 580, type: 'sine', duration: 0.06, gain: 0.24 });
  }

  playSoftDrop() {
    this._playTone({ freq: 170, endFreq: 140, type: 'sine', duration: 0.025, gain: 0.1 });
  }

  playLock() {
    this._playTone({ freq: 155, endFreq: 75, type: 'triangle', duration: 0.075, gain: 0.32 });
  }

  playHardDrop() {
    this._playTone({ freq: 210, endFreq: 52, type: 'sawtooth', duration: 0.11, gain: 0.35 });
    this._playTone({ freq: 420, endFreq: 120, type: 'triangle', duration: 0.07, gain: 0.22 });
  }

  playHold() {
    this._playTone({ freq: 330, type: 'sine', duration: 0.06, delay: 0, gain: 0.22 });
    this._playTone({ freq: 440, type: 'sine', duration: 0.08, delay: 0.045, gain: 0.22 });
  }

  playLineClear(lines = 1, combo = 0) {
    const comboBoost = Math.min(12, Math.max(0, combo)) * 28;
    const baseNotes = [523.25, 659.25, 783.99, 1046.5];
    const count = Math.min(4, Math.max(1, lines));
    for (let i = 0; i < count + 1; i++) {
      const f = (baseNotes[i % baseNotes.length] || 523.25) + comboBoost;
      this._playTone({
        freq: f,
        endFreq: f * 1.06,
        type: 'triangle',
        duration: 0.11,
        delay: i * 0.055,
        gain: 0.3,
      });
    }
  }

  playTetris() {
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
    notes.forEach((freq, idx) => {
      this._playTone({
        freq,
        type: 'sawtooth',
        duration: 0.14,
        delay: idx * 0.06,
        gain: 0.28,
      });
    });
  }

  playTSpin() {
    const notes = [440, 554.37, 659.25, 880, 1108.73];
    notes.forEach((freq, idx) => {
      this._playTone({
        freq,
        endFreq: freq * 1.03,
        type: 'sine',
        duration: 0.13,
        delay: idx * 0.045,
        gain: 0.3,
      });
    });
  }

  playLevelUp() {
    const notes = [440, 554.37, 659.25, 880];
    notes.forEach((freq, idx) => {
      this._playTone({
        freq,
        type: 'triangle',
        duration: 0.12,
        delay: idx * 0.065,
        gain: 0.32,
      });
    });
  }

  playGameOver() {
    const notes = [440, 415.3, 392.0, 349.23];
    notes.forEach((freq, idx) => {
      this._playTone({
        freq,
        endFreq: freq * 0.94,
        type: 'sawtooth',
        duration: 0.22,
        delay: idx * 0.16,
        gain: 0.25,
      });
    });
  }

  playMenuClick() {
    this._playTone({ freq: 540, endFreq: 680, type: 'sine', duration: 0.04, gain: 0.18 });
  }

  /**
   * Starts procedural looping background music that scales tempo with `level`.
   */
  startMusic(level = 1, mode = 'marathon') {
    this.level = level;
    this.mode = mode;
    if (this.musicPlaying) return;
    this.musicPlaying = true;
    this.noteIndex = 0;
    this._scheduleNextNote();
  }

  setLevel(level) {
    this.level = Math.max(1, level);
  }

  stopMusic() {
    this.musicPlaying = false;
    if (this.musicTimer) {
      clearTimeout(this.musicTimer);
      this.musicTimer = null;
    }
  }

  _scheduleNextNote() {
    if (!this.musicPlaying) return;

    const seq = this.mode === 'zen' ? ZEN_MELODY : ARCADE_MELODY;
    const [midi, beats] = seq[this.noteIndex % seq.length];
    this.noteIndex = (this.noteIndex + 1) % seq.length;

    // Tempo scales with level from 135 BPM at Level 1 up to 220 BPM at high levels
    const bpm =
      this.mode === 'zen'
        ? 92
        : Math.min(220, 132 + (this.level - 1) * 6.5);
    const sixteenthMs = (60_000 / bpm) * 0.5;
    const durationMs = beats * sixteenthMs;

    if (this.musicVolume > 0.005) {
      const freq = midiToFreq(midi);
      this._playTone({
        freq,
        type: this.mode === 'zen' ? 'sine' : 'triangle',
        duration: (durationMs / 1000) * 0.82,
        gain: 0.22,
        target: 'music',
      });
      // Bass accompaniment on downbeats
      if (this.noteIndex % 2 === 1) {
        this._playTone({
          freq: freq * 0.5,
          type: 'sine',
          duration: (durationMs / 1000) * 0.6,
          gain: 0.16,
          target: 'music',
        });
      }
    }

    this.musicTimer = setTimeout(() => this._scheduleNextNote(), durationMs);
  }
}
