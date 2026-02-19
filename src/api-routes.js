import multer from 'multer';
import { join } from 'path';
import { readdirSync, unlinkSync, existsSync, readFileSync, statSync, mkdirSync } from 'fs';
import { GoogleCastPlayer } from './cast.js';
import dayjs from 'dayjs';

/**
 * Register all API routes for the web dashboard
 */
export function registerApiRoutes(app, adhanPlayer) {
  const rootDir = adhanPlayer.rootDir;
  const audioDir = join(rootDir, 'audio');
  const dataDir = join(rootDir, 'data');
  const configPath = join(rootDir, 'config', 'config.json');

  // Test prayer playback state
  let activeTestPlayer = null;
  let activeTestPrayer = null;

  // Ensure directories exist
  [audioDir, dataDir].forEach(dir => {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  });

  // Multer config for audio uploads
  const audioUpload = multer({
    storage: multer.diskStorage({
      destination: audioDir,
      filename: (req, file, cb) => {
        // Sanitize filename
        const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
        cb(null, safeName);
      },
    }),
    fileFilter: (req, file, cb) => {
      const allowed = ['.mp3', '.wav', '.ogg'];
      const ext = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf('.'));
      cb(null, allowed.includes(ext));
    },
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  });

  // Multer config for CSV uploads
  const csvUpload = multer({
    storage: multer.diskStorage({
      destination: dataDir,
      filename: (req, file, cb) => {
        const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
        cb(null, safeName);
      },
    }),
    fileFilter: (req, file, cb) => {
      const ext = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf('.'));
      cb(null, ext === '.csv');
    },
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  });

  // ===== STATUS =====
  app.get('/api/status', (req, res) => {
    try {
      const status = adhanPlayer.getStatus();
      res.json(status);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // ===== PRAYER TIMES =====
  app.get('/api/prayer-times/today', (req, res) => {
    try {
      const times = adhanPlayer.parser.getTodaysPrayerTimes();
      res.json({ date: dayjs().format('YYYY-MM-DD'), prayerTimes: times });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/prayer-times/:date', (req, res) => {
    try {
      const times = adhanPlayer.parser.getPrayerTimes(req.params.date);
      if (!times) {
        return res.status(404).json({ error: 'No prayer times found for this date' });
      }
      res.json({ date: req.params.date, prayerTimes: times });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // ===== CONFIG =====
  app.get('/api/config', (req, res) => {
    try {
      res.json(adhanPlayer.config);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put('/api/config', async (req, res) => {
    try {
      const newConfig = req.body;

      // Validate required fields
      if (!newConfig.deviceIp || typeof newConfig.deviceIp !== 'string') {
        return res.status(400).json({ error: 'deviceIp is required' });
      }
      if (typeof newConfig.volume !== 'number' || newConfig.volume < 0 || newConfig.volume > 1) {
        return res.status(400).json({ error: 'volume must be a number between 0 and 1' });
      }
      if (!newConfig.timezone || typeof newConfig.timezone !== 'string') {
        return res.status(400).json({ error: 'timezone is required' });
      }
      if (!Array.isArray(newConfig.prayers) || newConfig.prayers.length === 0) {
        return res.status(400).json({ error: 'prayers must be a non-empty array' });
      }
      if (newConfig.volumes && typeof newConfig.volumes === 'object') {
        for (const [p, v] of Object.entries(newConfig.volumes)) {
          if (typeof v !== 'number' || v < 0 || v > 1) {
            return res.status(400).json({ error: `volumes.${p} must be a number between 0 and 1` });
          }
        }
      }
      if (newConfig.friday && typeof newConfig.friday === 'object') {
        if (newConfig.friday.volume !== undefined) {
          if (typeof newConfig.friday.volume !== 'number' || newConfig.friday.volume < 0 || newConfig.friday.volume > 1) {
            return res.status(400).json({ error: 'friday.volume must be a number between 0 and 1' });
          }
        }
      }
      if (newConfig.ramadan && typeof newConfig.ramadan === 'object') {
        if (newConfig.ramadan.iftarAlertMinutesBefore !== undefined) {
          const v = newConfig.ramadan.iftarAlertMinutesBefore;
          if (typeof v !== 'number' || v < 1 || v > 60) {
            return res.status(400).json({ error: 'ramadan.iftarAlertMinutesBefore must be 1-60' });
          }
        }
        if (newConfig.ramadan.sahurAlertMinutesBefore !== undefined) {
          const v = newConfig.ramadan.sahurAlertMinutesBefore;
          if (typeof v !== 'number' || v < 1 || v > 60) {
            return res.status(400).json({ error: 'ramadan.sahurAlertMinutesBefore must be 1-60' });
          }
        }
      }

      await adhanPlayer.reloadConfig(newConfig);
      res.json({ success: true, config: adhanPlayer.config });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // ===== AUDIO FILES =====
  app.get('/api/audio-files', (req, res) => {
    try {
      const files = readdirSync(audioDir)
        .filter(f => /\.(mp3|wav|ogg)$/i.test(f))
        .map(f => {
          const stat = statSync(join(audioDir, f));
          return {
            name: f,
            size: stat.size,
            modified: stat.mtime.toISOString(),
          };
        });
      res.json({ files });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/audio-files/upload', audioUpload.single('file'), (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No valid audio file provided. Allowed: .mp3, .wav, .ogg' });
    }
    res.json({ success: true, filename: req.file.filename, size: req.file.size });
  });

  app.delete('/api/audio-files/:filename', (req, res) => {
    try {
      const filename = req.params.filename;
      // Prevent path traversal
      if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
        return res.status(400).json({ error: 'Invalid filename' });
      }
      const filePath = join(audioDir, filename);
      if (!existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found' });
      }
      unlinkSync(filePath);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // ===== CSV FILES =====
  app.get('/api/csv-files', (req, res) => {
    try {
      const files = readdirSync(dataDir)
        .filter(f => f.endsWith('.csv'))
        .map(f => {
          const stat = statSync(join(dataDir, f));
          const isActive = adhanPlayer.config.csvFile === f;
          return {
            name: f,
            size: stat.size,
            modified: stat.mtime.toISOString(),
            active: isActive,
          };
        });
      res.json({ files });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/csv-files/upload', csvUpload.single('file'), (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No valid CSV file provided' });
    }
    res.json({ success: true, filename: req.file.filename, size: req.file.size });
  });

  app.delete('/api/csv-files/:filename', (req, res) => {
    try {
      const filename = req.params.filename;
      if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
        return res.status(400).json({ error: 'Invalid filename' });
      }
      // Don't allow deleting the active CSV file
      if (adhanPlayer.config.csvFile === filename) {
        return res.status(400).json({ error: 'Cannot delete the active CSV file' });
      }
      const filePath = join(dataDir, filename);
      if (!existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found' });
      }
      unlinkSync(filePath);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/csv-files/activate/:filename', async (req, res) => {
    try {
      const filename = req.params.filename;
      if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
        return res.status(400).json({ error: 'Invalid filename' });
      }
      const filePath = join(dataDir, filename);
      if (!existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found' });
      }

      // Update config with new CSV file
      const updatedConfig = { ...adhanPlayer.config, csvFile: filename };
      await adhanPlayer.reloadConfig(updatedConfig);

      res.json({ success: true, activeCsvFile: filename });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // ===== LOGS =====
  app.get('/api/logs', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 200, 200);
    const logs = adhanPlayer.logBuffer.slice(-limit);
    res.json({ logs });
  });

  // ===== HISTORY =====
  app.get('/api/history/stats', (req, res) => {
    try {
      if (!adhanPlayer.prayerHistory) {
        return res.json({ stats: { total: 0, played: 0, failed: 0, skipped: 0, successRate: 0, daily: [] } });
      }
      const stats = adhanPlayer.prayerHistory.getWeeklyStats();
      res.json({ stats });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/history', (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit) || 50, 200);
      const history = adhanPlayer.prayerHistory ? adhanPlayer.prayerHistory.getHistory(limit) : [];
      res.json({ history });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // ===== ACTIONS =====
  app.post('/api/actions/reschedule', (req, res) => {
    try {
      adhanPlayer.scheduleTodaysPrayers();
      const nextPrayer = adhanPlayer.scheduler.getNextPrayer();
      res.json({ success: true, nextPrayer });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/actions/test-cast', async (req, res) => {
    let player = null;
    try {
      player = new GoogleCastPlayer({
        deviceIp: adhanPlayer.config.deviceIp,
        volume: 0.3,
      });

      const beepUrl = adhanPlayer.server.getAudioUrl('beep.wav');
      await player.playAudio(beepUrl, {
        title: 'Test Beep',
        subtitle: 'Device Test',
        contentType: 'audio/wav',
        timeout: 5000,
      });

      res.json({ success: true, message: 'Test sesi basariyla calindi (volume %30)' });
    } catch (error) {
      res.json({ success: false, message: `Test basarisiz: ${error.message}` });
    } finally {
      if (player) player.cleanup();
    }
  });

  // ===== FETCH PRAYER TIMES FROM API =====
  app.post('/api/actions/fetch-times', async (req, res) => {
    try {
      await adhanPlayer.fetcher.fetchAndSave();
      await adhanPlayer.parser.reload();
      adhanPlayer.scheduleTodaysPrayers();
      res.json({ success: true, message: 'Vakit verileri basariyla guncellendi' });
    } catch (error) {
      res.json({ success: false, message: `Veri cekme basarisiz: ${error.message}` });
    }
  });

  // ===== TEST PRAYER =====
  app.post('/api/actions/test-prayer', async (req, res) => {
    const { action, prayer, volume } = req.body;

    if (action === 'stop') {
      if (activeTestPlayer) {
        try { await activeTestPlayer.stop(); } catch (e) { /* ignore */ }
        activeTestPlayer.cleanup();
        activeTestPlayer = null;
        activeTestPrayer = null;
      }
      return res.json({ success: true, playing: false });
    }

    if (action === 'start') {
      if (!prayer || volume === undefined) {
        return res.status(400).json({ error: 'prayer and volume are required' });
      }

      // Stop any previous test
      if (activeTestPlayer) {
        try { await activeTestPlayer.stop(); } catch (e) { /* ignore */ }
        activeTestPlayer.cleanup();
        activeTestPlayer = null;
        activeTestPrayer = null;
      }

      try {
        const audioFile = adhanPlayer.getAudioFileForPrayer(prayer);
        const audioUrl = adhanPlayer.server.getAudioUrl(audioFile);

        activeTestPlayer = new GoogleCastPlayer({
          deviceIp: adhanPlayer.config.deviceIp,
          volume: volume,
        });
        activeTestPrayer = prayer;

        // Fire-and-forget — don't await, ezan is long
        activeTestPlayer.playAudio(audioUrl, {
          title: `Test - ${prayer}`,
          subtitle: 'Ses Testi',
          contentType: 'audio/mp3',
          timeout: 10 * 60 * 1000,
        }).then(() => {
          // Playback finished naturally
          if (activeTestPrayer === prayer) {
            activeTestPlayer = null;
            activeTestPrayer = null;
          }
        }).catch(() => {
          if (activeTestPrayer === prayer) {
            activeTestPlayer = null;
            activeTestPrayer = null;
          }
        });

        return res.json({ success: true, playing: true, prayer });
      } catch (error) {
        activeTestPlayer = null;
        activeTestPrayer = null;
        return res.json({ success: false, message: error.message });
      }
    }

    res.status(400).json({ error: 'Invalid action. Use "start" or "stop".' });
  });

  app.get('/api/actions/test-prayer/status', (req, res) => {
    res.json({ playing: !!activeTestPrayer, prayer: activeTestPrayer });
  });

  // ===== SILENT MODE =====
  app.post('/api/actions/silent-mode', (req, res) => {
    try {
      const { enabled, duration } = req.body;
      if (enabled) {
        adhanPlayer.enableSilentMode(duration || null);
      } else {
        adhanPlayer.disableSilentMode();
      }
      res.json({
        success: true,
        silentMode: adhanPlayer.silentMode,
        silentModeExpiry: adhanPlayer.silentModeExpiry,
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // ===== SYSTEM TOGGLE =====
  app.post('/api/actions/toggle-system', (req, res) => {
    try {
      const { enabled } = req.body;
      if (enabled) {
        adhanPlayer.scheduleTodaysPrayers();
        adhanPlayer.isRunning = true;
        console.log('System enabled via dashboard');
      } else {
        if (adhanPlayer.scheduler) {
          adhanPlayer.scheduler.clearScheduledJobs();
        }
        adhanPlayer.isRunning = false;
        console.log('System disabled via dashboard');
      }
      res.json({ success: true, isRunning: adhanPlayer.isRunning });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  console.log('API routes registered for web dashboard');
}
