import cron from 'node-cron';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone.js';
import utc from 'dayjs/plugin/utc.js';

dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * Prayer times scheduler
 * Schedules Adhan playback at configured prayer times
 */
export class PrayerScheduler {
  constructor(config = {}) {
    this.timezone = config.timezone || 'Europe/Vienna';
    this.prayers = config.prayers || ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
    this.onPrayerTime = config.onPrayerTime || (() => {});
    this.scheduledJobs = new Map();
    this.midnightJob = null;
  }

  /**
   * Schedule prayers for today
   * @param {Object} prayerTimes - Object containing prayer times
   */
  scheduleTodaysPrayers(prayerTimes) {
    if (!prayerTimes) {
      console.error('No prayer times provided');
      return;
    }

    // Clear existing scheduled jobs
    this.clearScheduledJobs();

    const now = dayjs().tz(this.timezone);
    console.log(`\nScheduling prayers for ${now.format('YYYY-MM-DD')}`);
    console.log(`Current time: ${now.format('HH:mm:ss')} (${this.timezone})`);

    for (const prayer of this.prayers) {
      const timeStr = prayerTimes[prayer];

      if (!timeStr) {
        console.warn(`No time found for ${prayer}`);
        continue;
      }

      // Parse the time string (HH:MM format)
      const [hours, minutes] = timeStr.split(':').map(Number);

      // Create a datetime for today at the prayer time
      const prayerDateTime = now.clone().hour(hours).minute(minutes).second(0);

      // Check if the prayer time has already passed today
      if (prayerDateTime.isBefore(now)) {
        console.log(`  ${prayer}: ${timeStr} (already passed)`);
        continue;
      }

      // Create cron expression: minute hour * * *
      const cronExpression = `${minutes} ${hours} * * *`;

      // Schedule the job
      const job = cron.schedule(
        cronExpression,
        () => {
          console.log(`\n⏰ Prayer time triggered: ${prayer} at ${timeStr}`);
          this.onPrayerTime(prayer, timeStr);
        },
        {
          scheduled: true,
          timezone: this.timezone,
        }
      );

      this.scheduledJobs.set(prayer, {
        job,
        time: timeStr,
        cronExpression,
      });

      const timeUntil = prayerDateTime.diff(now, 'minute');
      console.log(`  ${prayer}: ${timeStr} (in ${timeUntil} minutes)`);
    }

    console.log(`\nScheduled ${this.scheduledJobs.size} prayers for today`);
  }

  /**
   * Schedule midnight refresh to reload tomorrow's times
   * @param {Function} refreshCallback - Callback to refresh prayer times
   */
  scheduleMidnightRefresh(refreshCallback) {
    // Schedule at 00:01 to avoid exact midnight timing issues
    this.midnightJob = cron.schedule(
      '1 0 * * *',
      () => {
        console.log('\n🌙 Midnight refresh - loading new prayer times');
        refreshCallback();
      },
      {
        scheduled: true,
        timezone: this.timezone,
      }
    );

    console.log('Scheduled midnight refresh at 00:01');
  }

  /**
   * Clear all scheduled jobs
   */
  clearScheduledJobs() {
    for (const [prayer, { job }] of this.scheduledJobs) {
      job.stop();
    }
    this.scheduledJobs.clear();
  }

  /**
   * Stop all scheduling
   */
  stop() {
    this.clearScheduledJobs();

    if (this.midnightJob) {
      this.midnightJob.stop();
      this.midnightJob = null;
    }

    console.log('All scheduled jobs stopped');
  }

  /**
   * Get status of scheduled prayers
   */
  getStatus() {
    const status = {
      timezone: this.timezone,
      prayers: {},
    };

    for (const [prayer, { time, cronExpression }] of this.scheduledJobs) {
      status.prayers[prayer] = {
        time,
        cronExpression,
        scheduled: true,
      };
    }

    return status;
  }

  /**
   * Get the next scheduled prayer
   */
  getNextPrayer() {
    const now = dayjs().tz(this.timezone);
    let nextPrayer = null;
    let nextTime = null;
    let minDiff = Infinity;

    for (const [prayer, { time }] of this.scheduledJobs) {
      const [hours, minutes] = time.split(':').map(Number);
      const prayerDateTime = now.clone().hour(hours).minute(minutes).second(0);

      const diff = prayerDateTime.diff(now, 'minute');

      if (diff > 0 && diff < minDiff) {
        minDiff = diff;
        nextPrayer = prayer;
        nextTime = time;
      }
    }

    if (nextPrayer) {
      return {
        prayer: nextPrayer,
        time: nextTime,
        minutesUntil: minDiff,
      };
    }

    return null;
  }
}
