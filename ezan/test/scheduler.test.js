import { test } from 'node:test';
import assert from 'node:assert/strict';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import tz from 'dayjs/plugin/timezone.js';
import { PrayerScheduler, computeEventTimes, atTime } from '../src/scheduler.js';

dayjs.extend(utc);
dayjs.extend(tz);

const TZ = 'Europe/Vienna';
const times = { fajr: '05:25', sunrise: '07:09', dhuhr: '11:46', asr: '13:51', maghrib: '16:14', isha: '17:46' };

test('Sabah = sunrise - offset, imsak stays the Diyanet time', () => {
  const e = computeEventTimes(times, 40);
  assert.equal(e.imsak, '05:25');
  assert.equal(e.fajr, '06:29');
  assert.equal(computeEventTimes(times, 0).fajr, '05:25');
});

test('atTime carries the Vienna offset (winter +01:00, summer +02:00)', () => {
  assert.equal(atTime('2026-11-25', '11:46', TZ).format(), '2026-11-25T11:46:00+01:00');
  assert.equal(atTime('2026-07-01', '13:00', TZ).format(), '2026-07-01T13:00:00+02:00');
});

test('restart at 12:00: past prayers are not scheduled, future ones are', () => {
  const s = new PrayerScheduler({ timezone: TZ, prayers: ['imsak', 'fajr', 'dhuhr', 'asr', 'maghrib', 'isha'] });
  const now = dayjs.tz('2026-11-25 12:00:00', TZ);
  const scheduled = s.scheduleTodaysPrayers(times, { now });
  assert.deepEqual(scheduled, ['asr', 'maghrib', 'isha']);
  assert.equal(s.getNextPrayer(now).prayer, 'asr');
  s.stop();
});

test('restart in the same minute as a prayer does not reschedule it', () => {
  const s = new PrayerScheduler({ timezone: TZ, prayers: ['dhuhr', 'asr'] });
  const now = dayjs.tz('2026-11-25 11:46:20', TZ);
  assert.deepEqual(s.scheduleTodaysPrayers(times, { now }), ['asr']);
  s.stop();
});

test('events already played today are skipped even if still in the future', () => {
  const s = new PrayerScheduler({
    timezone: TZ,
    prayers: ['dhuhr', 'asr'],
    skipReason: (p) => (p === 'dhuhr' ? 'bugün zaten çalındı' : null),
  });
  const now = dayjs.tz('2026-11-25 11:45:59', TZ);
  assert.deepEqual(s.scheduleTodaysPrayers(times, { now }), ['asr']);
  s.stop();
});

test('imsak and sabah at the same minute (fajr_offset 0) fire only once', () => {
  const s = new PrayerScheduler({ timezone: TZ, prayers: ['imsak', 'fajr', 'dhuhr'], fajrOffset: 0 });
  assert.deepEqual(s.scheduleTodaysPrayers(times, { now: dayjs.tz('2026-11-25 03:00', TZ) }), ['imsak', 'dhuhr']);
  s.stop();
});

test('a day without data clears yesterday\'s jobs', () => {
  const s = new PrayerScheduler({ timezone: TZ, prayers: ['asr'] });
  s.scheduleTodaysPrayers(times, { now: dayjs.tz('2026-11-25 08:00', TZ) });
  assert.equal(s.scheduledJobs.size, 1);
  s.scheduleTodaysPrayers(null, { now: dayjs.tz('2026-11-26 00:01', TZ) });
  assert.equal(s.scheduledJobs.size, 0);
  assert.equal(s.scheduledDate, '2026-11-26');
});
