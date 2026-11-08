// tests/bundle.test.js
// Guards the file:// compatible classic bundle: it must be valid, up to date with /src,
// and contain no leftover ES module syntax.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { buildBundle } from '../scripts/build.mjs';

const BUNDLE_PATH = new URL('../dist/tetris.bundle.js', import.meta.url);

describe('Classic bundle (dist/tetris.bundle.js)', () => {
  it('is up to date with the /src modules (run `node scripts/build.mjs` if this fails)', () => {
    const onDisk = fs.readFileSync(BUNDLE_PATH, 'utf8').replace(/\r\n/g, '\n');
    assert.equal(onDisk, buildBundle().replace(/\r\n/g, '\n'));
  });

  it('contains no import/export statements and parses as a classic script', () => {
    const code = fs.readFileSync(BUNDLE_PATH, 'utf8');
    assert.doesNotMatch(code, /^\s*(import|export)\s/m);
    assert.doesNotThrow(() => new vm.Script(code, { filename: 'tetris.bundle.js' }));
  });
});
