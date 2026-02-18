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

  console.log('API routes registered for web dashboard');
}
