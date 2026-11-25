import { writeFileSync, renameSync, existsSync } from 'fs';
import XLSX from 'xlsx';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { PrayerTimesParser } from './csv-parser.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const SITE_BASE = 'https://namazvakitleri.diyanet.gov.tr';
const API_BASE = 'https://prayertimes.api.abdus.dev/api/diyanet';
const DIYANET_EXCEL_URL = `${SITE_BASE}/tr-TR/home/PrayerTimeYearlyExcel`;

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
  'Referer': `${SITE_BASE}/`,
};

const FETCH_TIMEOUT_MS = 30000;

// Keep a week of history in the cache, everything newer is kept as-is
const KEEP_PAST_DAYS = 7;

const TURKISH_MONTHS = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
];

const TIME_RE = /^\d{2}:\d{2}$/;

/** Decode the HTML entities Diyanet uses (&#252; &#214; &amp; ...) */
function decodeEntities(str) {
  return str
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

const cellText = (html) => decodeEntities(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

/**
 * Fetch prayer times from Diyanet and keep them in a local CSV cache.
 *
 * Sources, in order:
 *   1. The location page (namazvakitleri.diyanet.gov.tr/tr-TR/<id>) — contains
 *      a yearly table (Jan 1 - Dec 31) and a 30-day table that runs into the
 *      next year in late December.
 *   2. The yearly Excel endpoint (original source; currently returns HTML).
 *   3. prayertimes.api.abdus.dev (original fallback).
 *
 * New data is merged into the existing cache instead of overwriting it, so a
 * failed or partial fetch never loses days that are already known.
 */
export class DiyanetFetcher {
  constructor(config = {}) {
    this.locationId = config.locationId || 11618; // Default: Vienna
    this.csvPath = config.csvPath;
    this.timezone = config.timezone || 'Europe/Vienna';
    this.locationName = null;
  }

  async request(url, accept) {
    const response = await fetch(url, {
      headers: { ...BROWSER_HEADERS, Accept: accept },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    return response;
  }

  /**
   * Source 1: Diyanet location page (HTML tables)
   */
  async fetchLocationPage() {
    const url = `${SITE_BASE}/tr-TR/${this.locationId}`;
    const response = await this.request(url, 'text/html,application/xhtml+xml');
    const html = await response.text();
    return this.parseLocationPage(html);
  }

  /**
   * Parse the prayer time tables on a Diyanet location page
   * @param {string} html
   * @returns {Array} prayer time objects
   */
  parseLocationPage(html) {
    const title = html.match(/<title>([^<|]+)/);
    if (title) {
      this.locationName = cellText(title[1]).replace(/\s*Namaz Vakitleri\s*$/i, '') || null;
    }

    const tables = html.match(/<table[^>]*vakit-table[^>]*>[\s\S]*?<\/table>/g) || [];
    if (tables.length === 0) {
      throw new Error('Sayfada vakit tablosu bulunamadı (sayfa yapısı değişmiş olabilir)');
    }

    const byDate = new Map();
    for (const table of tables) {
      const rows = (table.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || []).map((tr) =>
        (tr.match(/<t[hd][^>]*>[\s\S]*?<\/t[hd]>/g) || []).map(cellText)
      );
      let data;
      try {
        data = this.rowsToData(rows);
      } catch {
        continue; // not a prayer-time table
      }
      for (const entry of data) byDate.set(entry.date, entry);
    }

    if (byDate.size === 0) {
      throw new Error('Vakit tablolarından veri okunamadı');
    }
    return [...byDate.values()];
  }

  /**
   * Source 2: yearly Excel from Diyanet website
   * @param {number} year - Year to fetch
   */
  async fetchYearlyExcel(year) {
    const url = `${DIYANET_EXCEL_URL}?locationId=${this.locationId}&year=${year}`;
    const response = await this.request(
      url,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel, */*'
    );

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      throw new Error('Excel yerine HTML döndü');
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length < 1000) {
      throw new Error(`Excel yanıtı çok küçük (${buffer.length} bayt)`);
    }
    return this.parseExcelBuffer(buffer);
  }

  /**
   * Parse Excel buffer (from Diyanet yearly export) into prayer time objects
   * @param {Buffer} buffer - Excel file buffer
   */
  parseExcelBuffer(buffer) {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    return this.rowsToData(rows);
  }

  /**
   * Convert a table (array of rows, header row included) in Diyanet's layout
   * into prayer time objects. Shared by the HTML and Excel sources.
   *
   * Diyanet format: Miladi Tarih, Hicri Tarih, İmsak, Güneş, Öğle, İkindi, Akşam, Yatsı
   */
  rowsToData(rows) {
    // Normalize Turkish characters for matching (İ→i, ı→i, ş→s, ö→o, ü→u, ğ→g, ç→c)
    const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ğ/g, 'g').replace(/ç/g, 'c');

    let headerIdx = -1;
    const colMap = {};
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
      const row = rows[i];
      if (!row) continue;
      const cells = row.map((c) => norm(String(c || '').trim()));
      if (cells.findIndex((c) => c.includes('imsak')) !== -1) {
        headerIdx = i;
        cells.forEach((cell, idx) => {
          if (cell.includes('miladi')) colMap.date = idx;
          if (cell.includes('imsak')) colMap.fajr = idx;
          if (cell.includes('gunes')) colMap.sunrise = idx;
          if (cell.includes('ogle')) colMap.dhuhr = idx;
          if (cell.includes('ikindi')) colMap.asr = idx;
          if (cell.includes('aksam')) colMap.maghrib = idx;
          if (cell.includes('yatsi')) colMap.isha = idx;
        });
        break;
      }
    }

    if (headerIdx === -1) {
      throw new Error('Başlık satırı bulunamadı (İmsak sütunu yok)');
    }

    // If no date column found, assume first column
    if (colMap.date === undefined) colMap.date = 0;

    const formatTime = (val) => {
      if (val === undefined || val === null || val === '') return '';
      // Handle Excel time fractions (e.g. 0.25 = 06:00)
      if (typeof val === 'number' && val < 1) {
        const totalMinutes = Math.round(val * 24 * 60);
        return `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`;
      }
      const match = String(val).trim().match(/(\d{1,2}):(\d{2})/);
      if (match) return `${match[1].padStart(2, '0')}:${match[2]}`;
      return String(val).trim();
    };

    const data = [];
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || !row[colMap.date]) continue;

      const dateVal = row[colMap.date];
      const dateObj = typeof dateVal === 'number'
        ? this.excelDateToJS(dateVal)
        : this.parseDateStr(String(dateVal));
      if (!dateObj || isNaN(dateObj.getTime())) continue;

      const entry = {
        date: dateObj.toISOString().slice(0, 10),
        fajr: formatTime(row[colMap.fajr]),
        sun: formatTime(row[colMap.sunrise]),
        dhuhr: formatTime(row[colMap.dhuhr]),
        asr: formatTime(row[colMap.asr]),
        maghrib: formatTime(row[colMap.maghrib]),
        isha: formatTime(row[colMap.isha]),
      };
      if (isCompleteEntry(entry)) data.push(entry);
    }

    if (data.length === 0) {
      throw new Error('Tabloda vakit bulunamadı');
    }
    return data;
  }

  /**
   * Convert Excel serial date number to JS Date (UTC)
   */
  excelDateToJS(serial) {
    // Excel epoch is 1900-01-01; offset 25569 converts to Unix epoch (UTC)
    const utcDays = Math.floor(serial - 25569);
    return new Date(utcDays * 86400 * 1000);
  }

  /**
   * Parse various date string formats (returns UTC date to avoid timezone shifts)
   */
  parseDateStr(str) {
    // DD.MM.YYYY
    let m = str.match(/(\d{1,2})[./](\d{1,2})[./](\d{4})/);
    if (m) return new Date(Date.UTC(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1])));

    // YYYY-MM-DD
    m = str.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return new Date(Date.UTC(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3])));

    // "DD Turkish_Month YYYY" or "DD Turkish_Month YYYY DayName" (e.g. "01 Ocak 2026 Perşembe")
    m = str.match(/(\d{1,2})\s+(\S+)\s+(\d{4})/);
    if (m) {
      const monthName = m[2].toLocaleLowerCase('tr-TR');
      const monthIdx = TURKISH_MONTHS.findIndex((mon) => mon.toLocaleLowerCase('tr-TR') === monthName);
      if (monthIdx !== -1) {
        return new Date(Date.UTC(parseInt(m[3]), monthIdx, parseInt(m[1])));
      }
    }

    return null;
  }

  /**
   * Source 3: prayertimes.api.abdus.dev (~31 days)
   */
  async fetchPrayerTimes() {
    const url = `${API_BASE}/prayertimes?location_id=${this.locationId}`;
    const response = await this.request(url, 'application/json');
    const data = await response.json();

    if (!Array.isArray(data) || data.length === 0) {
      throw new Error('API boş veri döndürdü');
    }

    return data
      .map((entry) => {
        // Take the calendar date as written; don't let a missing timezone shift it
        const m = String(entry.date || '').match(/^(\d{4}-\d{2}-\d{2})/);
        return m ? { ...entry, date: m[1] } : null;
      })
      .filter((entry) => entry && isCompleteEntry(entry));
  }

  /**
   * Try all sources in order and return the first one that works.
   * @returns {{ source: string, data: Array }}
   */
  async fetchFromSources() {
    const errors = [];
    const year = dayjs().tz(this.timezone).year();

    const sources = [
      ['Diyanet sayfası', () => this.fetchLocationPage()],
      [`Diyanet Excel ${year}`, () => this.fetchYearlyExcel(year)],
      ['abdus.dev API', () => this.fetchPrayerTimes()],
    ];

    for (const [name, fn] of sources) {
      try {
        const data = await fn();
        return { source: name, data };
      } catch (error) {
        console.warn(`   ⚠️  ${name}: ${error.message}`);
        errors.push(`${name}: ${error.message}`);
      }
    }
    throw new Error(`Hiçbir kaynaktan vakit alınamadı (${errors.join(' | ')})`);
  }

  /**
   * Fetch prayer times and merge them into the CSV cache.
   * @returns {{ source, fetchedDays, newDays, firstDate, lastDate, totalDays, locationName }}
   */
  async fetchAndSave() {
    console.log(`🌐 Diyanet'ten vakitler çekiliyor (konum ${this.locationId})...`);
    const { source, data } = await this.fetchFromSources();

    const existing = await this.readCache();
    const result = this.mergeAndSave(existing, data);

    console.log(
      `✅ ${source}: ${data.length} gün alındı` +
      (this.locationName ? ` (${this.locationName})` : '') +
      `, ${result.newDays} yeni gün. Önbellek: ${result.firstDate} → ${result.lastDate} (${result.totalDays} gün)`
    );
    return { source, fetchedDays: data.length, locationName: this.locationName, ...result };
  }

  /** Read the cache into entries of the fetcher's shape */
  async readCache() {
    if (!this.csvPath || !existsSync(this.csvPath)) return [];
    const parser = new PrayerTimesParser(this.csvPath, { timezone: this.timezone });
    await parser.load();
    return Object.entries(parser.getAllPrayerTimes()).map(([date, t]) => ({
      date,
      fajr: t.fajr,
      sun: t.sunrise,
      dhuhr: t.dhuhr,
      asr: t.asr,
      maghrib: t.maghrib,
      isha: t.isha,
    }));
  }

  /**
   * Merge new entries over existing ones (new data wins), drop old days and
   * write the CSV atomically.
   */
  mergeAndSave(existing, incoming, today = dayjs().tz(this.timezone).format('YYYY-MM-DD')) {
    const cutoff = dayjs(today).subtract(KEEP_PAST_DAYS, 'day').format('YYYY-MM-DD');
    const map = new Map();
    for (const e of existing) if (isCompleteEntry(e)) map.set(e.date, e);
    let newDays = 0;
    for (const e of incoming) {
      if (!isCompleteEntry(e)) continue;
      if (!map.has(e.date) && e.date >= cutoff) newDays++;
      map.set(e.date, e);
    }
    const merged = [...map.values()]
      .filter((e) => e.date >= cutoff)
      .sort((a, b) => a.date.localeCompare(b.date));

    if (merged.length === 0) {
      throw new Error('Birleştirme sonrası güncel gün kalmadı');
    }

    const tmp = `${this.csvPath}.tmp`;
    writeFileSync(tmp, this.toCsv(merged), 'utf8');
    renameSync(tmp, this.csvPath);

    return {
      newDays,
      totalDays: merged.length,
      firstDate: merged[0].date,
      lastDate: merged[merged.length - 1].date,
    };
  }

  /**
   * Convert entries to Turkish CSV format (read back by csv-parser.js)
   * @param {Array} data - Prayer times
   * @returns {string} CSV content
   */
  toCsv(data) {
    let csv = 'Miladi Tarih,İmsak,Güneş,Öğle,İkindi,Akşam,Yatsı\n';

    for (const entry of data) {
      const [y, m, d] = entry.date.split('-').map(Number);
      const dateStr = `${String(d).padStart(2, '0')} ${TURKISH_MONTHS[m - 1]} ${y}`;
      csv += `${dateStr},${entry.fajr},${entry.sun},${entry.dhuhr},${entry.asr},${entry.maghrib},${entry.isha}\n`;
    }

    return csv;
  }
}

function isCompleteEntry(e) {
  return Boolean(
    e && /^\d{4}-\d{2}-\d{2}$/.test(e.date) &&
    ['fajr', 'sun', 'dhuhr', 'asr', 'maghrib', 'isha'].every((k) => TIME_RE.test(e[k] || ''))
  );
}
