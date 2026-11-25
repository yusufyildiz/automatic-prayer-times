import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MediaPlayerOutput, mediaSourceId } from '../src/outputs.js';

/** Fake HA: records service calls and walks the entity through states */
function fakeHa({ initial = 'idle', volume = 0.8, sequence = ['playing', 'playing', 'idle'], contentId } = {}) {
  const calls = [];
  let i = -1;
  let playing = false;
  return {
    calls,
    async getState() {
      if (!playing) return { state: initial, attributes: { volume_level: volume, media_content_id: 'spotify:x' } };
      i = Math.min(i + 1, sequence.length - 1);
      return { state: sequence[i], attributes: { volume_level: 0.3, media_content_id: contentId } };
    },
    async callService(domain, service, data) {
      calls.push([service, data]);
      if (service === 'play_media') playing = true;
    },
  };
}

const fast = { pollMs: 5, startTimeoutMs: 200, maxDurationMs: 500 };

test('media-source ID encodes the path', () => {
  assert.equal(mediaSourceId('Sabah ezanı.mp3'), 'media-source://media_source/local/ezan/Sabah%20ezan%C4%B1.mp3');
});

test('sets volume, plays media-source file, waits for end, restores volume', async () => {
  const ha = fakeHa({ contentId: 'http://ha:8123/media/local/ezan/adhan.mp3?authSig=x' });
  const out = new MediaPlayerOutput({ entityId: 'media_player.nest', ha, ...fast });
  await out.play({ file: 'adhan.mp3', volume: 0.3 });
  assert.deepEqual(ha.calls.map((c) => c[0]), ['volume_set', 'play_media', 'volume_set']);
  assert.equal(ha.calls[0][1].volume_level, 0.3);
  assert.equal(ha.calls[1][1].media_content_id, 'media-source://media_source/local/ezan/adhan.mp3');
  assert.equal(ha.calls[1][1].media_content_type, 'audio/mpeg');
  assert.equal(ha.calls[2][1].volume_level, 0.8);
});

test('player that was playing other music: unchanged media is not taken as our start', async () => {
  const ha = fakeHa({ initial: 'playing', sequence: ['playing'], contentId: 'spotify:x' });
  const out = new MediaPlayerOutput({ entityId: 'media_player.nest', ha, ...fast });
  await assert.rejects(out.play({ file: 'adhan.mp3', volume: 0.5 }), /çalmaya başlamadı/);
});

test('player that was playing music switches to our file and finishes', async () => {
  const ha = fakeHa({ initial: 'playing', sequence: ['playing', 'playing', 'paused'], contentId: 'http://ha/media/local/ezan/adhan.mp3' });
  const out = new MediaPlayerOutput({ entityId: 'media_player.nest', ha, ...fast });
  await out.play({ file: 'adhan.mp3', volume: 0.5 });
});

test('idle player that reports a different media_content_id still counts as started (no retry loop)', async () => {
  const ha = fakeHa({ sequence: ['playing', 'idle'], contentId: 'x-sonos-http:abc123' });
  const out = new MediaPlayerOutput({ entityId: 'media_player.nest', ha, ...fast });
  await out.play({ file: 'adhan.mp3', volume: 0.5 });
  assert.equal(ha.calls.filter((c) => c[0] === 'play_media').length, 1);
});

test('missing or unavailable entity fails fast', async () => {
  const missing = { async getState() { return null; }, async callService() { throw new Error('no'); } };
  await assert.rejects(new MediaPlayerOutput({ entityId: 'media_player.x', ha: missing, ...fast }).play({ file: 'a.mp3', volume: 1 }), /bulunamadı/);
  const unavailable = { async getState() { return { state: 'unavailable', attributes: {} }; } };
  await assert.rejects(new MediaPlayerOutput({ entityId: 'media_player.x', ha: unavailable, ...fast }).play({ file: 'a.mp3', volume: 1 }), /unavailable/);
});
