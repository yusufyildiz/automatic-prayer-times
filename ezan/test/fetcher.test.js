import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { DiyanetFetcher } from '../src/diyanet-fetcher.js';
import { PrayerTimesParser } from '../src/csv-parser.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(join(here, 'fixtures', 'diyanet-page.html'), 'utf-8');

test('parses the Diyanet location page (entities, Turkish dates, location name)', () => {
  const f = new DiyanetFetcher({ locationId: 11618 });
  const data = f.parseLocationPage(fixture);
  assert.equal(data.length, 3);
  assert.deepEqual(data[0], {
    date: '2026-11-25',
    fajr: '05:25',
    sun: '07:09',
    dhuhr: '11:46',
    asr: '13:51',
    maghrib: '16:14',
    isha: '17:46',
  });
  assert.equal(f.locationName, 'Vıyana');
});

test('page without vakit tables is rejected', () => {
  const f = new DiyanetFetcher({});
  assert.throws(() => f.parseLocationPage('<html><title>x</title><table class="table"></table></html>'));
});

test('merge keeps cached days, new data wins, old days are pruned, CSV round-trips', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ezan-'));
  const csvPath = join(dir, 'pt.csv');
  const f = new DiyanetFetcher({ csvPath });
  const row = (date, fajr = '05:00') => ({ date, fajr, sun: '07:00', dhuhr: '12:00', asr: '14:00', maghrib: '16:00', isha: '18:00' });

  f.mergeAndSave([], [row('2026-12-30'), row('2026-12-31')], '2026-12-30');
  // Next fetch only has January (e.g. 30-day table) and a correction for Dec 31
  const r = f.mergeAndSave(await f.readCache(), [row('2026-12-31', '05:55'), row('2027-01-01'), row('2026-01-01')], '2026-12-30');

  assert.equal(r.firstDate, '2026-12-30');
  assert.equal(r.lastDate, '2027-01-01');
  assert.equal(r.totalDays, 3); // 2026-01-01 pruned (older than a week)
  assert.equal(r.newDays, 1);

  const p = new PrayerTimesParser(csvPath);
  await p.load();
  assert.equal(p.getPrayerTimes('2026-12-31').fajr, '05:55');
  assert.equal(p.getPrayerTimes('2027-01-01').isha, '18:00');
});

test('incomplete rows are ignored and a broken cache entry does not break merge', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ezan-'));
  const csvPath = join(dir, 'pt.csv');
  writeFileSync(csvPath, 'Miladi Tarih,İmsak,Güneş,Öğle,İkindi,Akşam,Yatsı\n25 Kasım 2026,05:25,07:09,11:46,13:51,16:14,\n');
  const f = new DiyanetFetcher({ csvPath });
  const r = f.mergeAndSave(await f.readCache(), [
    { date: '2026-11-26', fajr: '05:26', sun: '07:10', dhuhr: '11:47', asr: '13:51', maghrib: '16:13', isha: '17:45' },
  ], '2026-11-25');
  assert.equal(r.totalDays, 1);
});

test('Turkish month names parse in every case form', () => {
  const f = new DiyanetFetcher({});
  for (const [s, iso] of [
    ['01 Ocak 2027 Cuma', '2027-01-01'],
    ['14 Şubat 2027', '2027-02-14'],
    ['19 Mayıs 2027 Çarşamba', '2027-05-19'],
    ['30 Ağustos 2027', '2027-08-30'],
    ['31 Aralık 2026 Perşembe', '2026-12-31'],
    ['01.02.2027', '2027-02-01'],
  ]) {
    assert.equal(f.parseDateStr(s).toISOString().slice(0, 10), iso, s);
  }
});
