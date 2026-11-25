import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { normalizeOptions } from '../src/options.js';
import { StateStore } from '../src/state.js';

test('options map to internal config with fajr/friday fallbacks', () => {
  const { config, problems } = normalizeOptions({
    location_id: 11618,
    output_mode: 'media_player',
    media_player_entity: 'media_player.nest_hub',
    volume: 0.5,
    audio_file: 'adhan.mp3',
    imsak: false, sabah: true, ogle: true, ikindi: false, aksam: true, yatsi: true,
    fajr_offset: 40,
    fajr_volume: 0.2,
  });
  assert.deepEqual(problems, []);
  assert.deepEqual(config.prayers, ['fajr', 'dhuhr', 'maghrib', 'isha']);
  assert.equal(config.fajrAudioFile, 'adhan.mp3');
  assert.equal(config.fajrVolume, 0.2);
  assert.equal(config.friday.audioFile, null);
  assert.equal(config.duaAudioFile, null);
});

test('invalid media_player entity and timezone are reported, not fatal', () => {
  const { config, problems } = normalizeOptions({ media_player_entity: 'nest', timezone: 'Mars/Base' });
  assert.equal(problems.length, 2);
  assert.equal(config.timezone, 'Europe/Vienna');
});

test('local mode needs no entity; volume is clamped', () => {
  const { config, problems } = normalizeOptions({ output_mode: 'local', volume: 3 });
  assert.deepEqual(problems, []);
  assert.equal(config.volume, 1);
});

test('state persists mute switches and played events across restarts', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'ezan-')), 'state.json');
  const a = new StateStore(path);
  a.setMuted(true);
  a.setEventMuted('fajr', true);
  a.markPlayed('2026-11-25', 'dhuhr');

  const b = new StateStore(path);
  assert.equal(b.muted, true);
  assert.equal(b.isEventMuted('fajr'), true);
  assert.equal(b.isEventMuted('isha'), false);
  assert.equal(b.wasPlayed('2026-11-25', 'dhuhr'), true);
  assert.equal(b.wasPlayed('2026-11-26', 'dhuhr'), false);

  b.markPlayed('2026-11-26', 'fajr'); // new day resets the list
  assert.equal(b.wasPlayed('2026-11-25', 'dhuhr'), false);
});
