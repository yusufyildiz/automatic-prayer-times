import cron from 'node-cron';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone.js';
import utc from 'dayjs/plugin/utc.js';
import { LABELS } from './options.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const pad = (n) => String(n).padStart(2, '0');
const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
const fromMinutes = (total) => `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;

/**
 * Compute the HH:MM time of every event for one day.
 *
 * - imsak: Diyanet imsak time as published
 * - fajr ("Sabah"): sunrise - fajrOffset minutes. With fajrOffset 0 (or no
 *   sunrise) it falls back to the imsak time — same rule as the original app.
 *
 * @param {Object} prayerTimes - { fajr (=imsak), sunrise, dhuhr, asr, maghrib, isha }
 * @param {number} fajrOffset
 */
export function computeEventTimes(prayerTimes, fajrOffset = 40) {
  if (!prayerTimes) return null;
  let sabah = prayerTimes.fajr;
  if (prayerTimes.sunrise && fajrOffset > 0) {
    sabah = fromMinutes(toMinutes(prayerTimes.sunrise) - fajrOffset);
  }
  return {
    imsak: prayerTimes.fajr,
    fajr: sabah,
    sunrise: prayerTimes.sunrise,
    dhuhr: prayerTimes.dhuhr,
    asr: prayerTimes.asr,
    maghrib: prayerTimes.maghrib,
    isha: prayerTimes.isha,
  };
}

/** Build a timezone-aware dayjs for date (YYYY-MM-DD) + time (HH:MM) */
export function atTime(dateStr, hhmm, tz) {
  return dayjs.tz(`${dateStr} ${hhmm}`, 'YYYY-MM-DD HH:mm', tz);
}

/**
 * Prayer times scheduler
 * Schedules Adhan playback at configured prayer times
 */
export class PrayerScheduler {
  constructor(config = {}) {
    this.timezone = config.timezone || 'Europe/Vienna';
    this.prayers = config.prayers || ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
    this.fajrOffset = config.fajrOffset ?? 40;
    this.onPrayerTime = config.onPrayerTime || (() => {});
    // (event, dateStr) => reason string if this event must not be scheduled
    this.skipReason = config.skipReason || (() => null);
    this.scheduledJobs = new Map();
    this.scheduledDate = null;
  }

  /**
   * Schedule prayers for one day (normally today).
   * Existing jobs are always cleared first, so a day without data never
   * keeps firing yesterday's times.
   *
   * @param {Object|null} prayerTimes - Row from the CSV cache
   * @param {Object} [opts]
   * @param {dayjs.Dayjs} [opts.now] - Injected clock (tests)
   */
  scheduleTodaysPrayers(prayerTimes, { now = dayjs().tz(this.timezone) } = {}) {
    this.clearScheduledJobs();

    const dateStr = now.format('YYYY-MM-DD');
    this.scheduledDate = dateStr;

    if (!prayerTimes) {
      console.error(`❌ ${dateStr} için vakit verisi yok, bugün ezan zamanlanmadı.`);
      return [];
    }

    const times = computeEventTimes(prayerTimes, this.fajrOffset);
    console.log(`📅 ${dateStr} zamanlaması (şu an ${now.format('HH:mm:ss')}, ${this.timezone}):`);

    for (const prayer of this.prayers) {
      const effectiveTime = times[prayer];
      const label = LABELS[prayer] || prayer;

      if (!effectiveTime || !/^\d{2}:\d{2}$/.test(effectiveTime)) {
        console.warn(`   ${label.padEnd(7)} vakit bilgisi yok, atlandı`);
        continue;
      }

      const note = prayer === 'fajr' && effectiveTime !== times.imsak
        ? ` (güneş ${times.sunrise} - ${this.fajrOffset} dk)`
        : '';

      const prayerDateTime = atTime(dateStr, effectiveTime, this.timezone);
      if (!prayerDateTime.isAfter(now)) {
        console.log(`   ${label.padEnd(7)} ${effectiveTime}${note} — geçti`);
        continue;
      }

      const reason = this.skipReason(prayer, dateStr);
      if (reason) {
        console.log(`   ${label.padEnd(7)} ${effectiveTime}${note} — ${reason}`);
        continue;
      }

      const [hours, minutes] = effectiveTime.split(':').map(Number);
      const cronExpression = `${minutes} ${hours} * * *`;

      const job = cron.schedule(
        cronExpression,
        () => {
          // Cron jobs repeat daily; only fire for the day they were made for.
          const today = dayjs().tz(this.timezone).format('YYYY-MM-DD');
          if (today !== dateStr) return;
          this.onPrayerTime(prayer, effectiveTime, dateStr);
        },
        { scheduled: true, timezone: this.timezone }
      );

      this.scheduledJobs.set(prayer, { job, time: effectiveTime, at: prayerDateTime, cronExpression });

      const mins = prayerDateTime.diff(now, 'minute', true);
      console.log(`   ${label.padEnd(7)} ${effectiveTime}${note} — zamanlandı (${formatDuration(mins)} sonra)`);
    }

    console.log(`   Toplam ${this.scheduledJobs.size} ezan zamanlandı.`);
    return [...this.scheduledJobs.keys()];
  }

  /**
   * Clear all scheduled jobs
   */
  clearScheduledJobs() {
    for (const { job } of this.scheduledJobs.values()) {
      job.stop();
    }
    this.scheduledJobs.clear();
  }

  /**
   * Stop all scheduling
   */
  stop() {
    this.clearScheduledJobs();
  }

  /**
   * Get the next scheduled prayer (today only)
   */
  getNextPrayer(now = dayjs().tz(this.timezone)) {
    let next = null;
    for (const [prayer, { time, at }] of this.scheduledJobs) {
      if (at.isAfter(now) && (!next || at.isBefore(next.at))) {
        next = { prayer, time, at };
      }
    }
    return next;
  }
}

export function formatDuration(totalMinutes) {
  const m = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r} dk`;
  return `${h} sa ${r} dk`;
}
