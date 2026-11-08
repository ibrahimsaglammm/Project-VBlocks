// src/randomizer.js
// Deterministic seedable 7-bag randomizer (Mulberry32 PRNG + Fisher-Yates shuffle)

export const PIECE_TYPES = Object.freeze(['I', 'O', 'T', 'S', 'Z', 'J', 'L']);

/**
 * Creates a seeded PRNG using Mulberry32 algorithm.
 * Returns a function that produces floats in [0, 1) and exposes getState/setState.
 */
export function createRNG(seed = Date.now()) {
  let state = (typeof seed === 'number' ? seed : hashString(String(seed))) >>> 0;
  if (state === 0) state = 0x6d2b79f5;

  function nextFloat() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  nextFloat.getState = () => state;
  nextFloat.setState = (newState) => {
    state = (Number(newState) >>> 0) || 0x6d2b79f5;
  };

  return nextFloat;
}

function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * In-place Fisher-Yates shuffle using provided RNG function.
 */
export function shuffleArray(arr, rng = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

/**
 * 7-Bag Randomizer class following the Tetris Guideline.
 */
export class BagRandomizer {
  constructor(seed = Date.now()) {
    this.seed = seed;
    this.rng = createRNG(seed);
    this.queue = [];
    this._refill();
    this._refill();
  }

  _refill() {
    const bag = [...PIECE_TYPES];
    shuffleArray(bag, this.rng);
    this.queue.push(...bag);
  }

  /**
   * Pops and returns the next piece type, keeping at least 7 pieces queued.
   */
  next() {
    if (this.queue.length <= 7) {
      this._refill();
    }
    return this.queue.shift();
  }

  /**
   * Returns an array of the next `count` upcoming pieces without removing them.
   */
  peek(count = 5) {
    while (this.queue.length < count + 2) {
      this._refill();
    }
    return this.queue.slice(0, count);
  }

  reset(seed = Date.now()) {
    this.seed = seed;
    this.rng = createRNG(seed);
    this.queue = [];
    this._refill();
    this._refill();
  }

  serialize() {
    return {
      seed: this.seed,
      rngState: this.rng.getState(),
      queue: [...this.queue],
    };
  }

  restore(data) {
    if (!data) return;
    this.seed = data.seed ?? this.seed;
    if (typeof data.rngState === 'number') {
      this.rng.setState(data.rngState);
    }
    if (Array.isArray(data.queue) && data.queue.length > 0) {
      this.queue = [...data.queue];
    }
  }
}
