// Runs INSIDE the built add-on image (CI): checks runtime pieces that can't
// be verified on a dev machine — Node version, timezone data, audio tools.
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import assert from 'assert/strict';

process.env.TZ = 'Europe/Vienna';
const { DiyanetFetcher } = await import('/app/src/diyanet-fetcher.js');
const { atTime } = await import('/app/src/scheduler.js');

const major = Number(process.versions.node.split('.')[0]);
assert.ok(major >= 20, `node ${process.versions.node}`);
console.log(`node ${process.versions.node} (${process.arch})`);

// ICU / tz data: Vienna offsets in winter and summer
assert.equal(atTime('2026-11-25', '11:46', 'Europe/Vienna').format(), '2026-11-25T11:46:00+01:00');
assert.equal(atTime('2026-07-01', '13:00', 'Europe/Vienna').format(), '2026-07-01T13:00:00+02:00');
assert.equal(new Date('2026-07-01T11:00:00Z').getHours(), 13, 'process TZ');
console.log('timezone ok');

// Turkish HTML parsing incl. locale-aware lowercase
const html = readFileSync('/test/fixtures/diyanet-page.html', 'utf-8');
const data = new DiyanetFetcher({}).parseLocationPage(html);
assert.equal(data[0].date, '2026-11-25');
assert.equal(new DiyanetFetcher({}).parseDateStr('19 Mayıs 2027').toISOString().slice(0, 10), '2027-05-19');
console.log('parser ok');

// Audio tools for output_mode: local (mpg123 decodes → pacat/paplay → PulseAudio)
for (const [cmd, arg] of [['mpg123', '--version'], ['pacat', '--version'], ['paplay', '--version']]) {
  execFileSync(cmd, [arg], { stdio: 'pipe' });
}
console.log('mpg123 + pacat + paplay ok');

// The local pipeline must fail cleanly (no hang) when there is no sound server
const { LocalOutput } = await import('/app/src/outputs.js');
const out = new LocalOutput({ mediaDir: '/tmp' });
const t0 = Date.now();
await assert.rejects(
  Promise.race([
    out.play({ file: 'missing.mp3', volume: 0.5 }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT')), 20000)),
  ]),
  (e) => e.message !== 'TIMEOUT'
);
console.log(`local pipeline error handling ok (${Date.now() - t0} ms)`);

console.log('SMOKE OK');
