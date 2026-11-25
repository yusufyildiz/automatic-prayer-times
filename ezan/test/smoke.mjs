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

// Audio tools for output_mode: local
const modules = execFileSync('mpg123', ['--list-modules'], { encoding: 'utf-8' });
assert.match(modules, /pulse/, 'mpg123 pulse output module');
execFileSync('paplay', ['--version']);
console.log('mpg123 (pulse) + paplay ok');

console.log('SMOKE OK');
