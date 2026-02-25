import express from 'express';
import https from 'https';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'fs';
import { networkInterfaces } from 'os';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * HTTP Server to serve audio files for Google Cast
 * Google Cast devices need to access audio files via HTTP URL
 */
export class AudioServer {
  constructor(config = {}) {
    this.port = config.port || 3000;
    this.sslPort = config.sslPort || 3443;
    this.audioDir = config.audioDir || join(__dirname, '..', 'audio');
    this.certsDir = join(__dirname, '..', 'certs');
    this.app = express();
    this.server = null;
    this.httpsServer = null;
    this.localIp = config.localIp || this.getLocalIp();

    this.setupRoutes();
  }

  /**
   * Get local IP address
   */
  getLocalIp() {
    const nets = networkInterfaces();

    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        // Skip internal and non-IPv4 addresses
        if (net.family === 'IPv4' && !net.internal) {
          return net.address;
        }
      }
    }

    return '127.0.0.1';
  }

  /**
   * Setup Express routes
   */
  setupRoutes() {
    // JSON body parser
    this.app.use(express.json());

    // Serve dashboard static files
    this.app.use(express.static(join(__dirname, '..', 'public')));

    // Serve static audio files
    this.app.use('/audio', express.static(this.audioDir, {
      setHeaders: (res) => {
        res.set('Access-Control-Allow-Origin', '*');
        res.set('Cache-Control', 'public, max-age=3600');
      }
    }));

    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'ok',
        audioDir: this.audioDir,
        serverUrl: this.getServerUrl(),
      });
    });

    // List available audio files
    this.app.get('/audio-list', (req, res) => {
      try {
        const files = readdirSync(this.audioDir).filter(
          (file) => file.endsWith('.mp3') || file.endsWith('.wav') || file.endsWith('.ogg')
        );
        res.json({ files });
      } catch (error) {
        res.status(500).json({ error: 'Failed to list audio files' });
      }
    });

    // Error handling
    this.app.use((err, req, res, next) => {
      console.error('Server error:', err);
      res.status(500).json({ error: 'Internal server error' });
    });
  }

  /**
   * Ensure self-signed SSL certificate exists, generate if missing
   */
  ensureCerts() {
    const keyPath = join(this.certsDir, 'server.key');
    const certPath = join(this.certsDir, 'server.crt');

    if (existsSync(keyPath) && existsSync(certPath)) {
      return { key: readFileSync(keyPath), cert: readFileSync(certPath) };
    }

    console.log('🔐 SSL sertifikasi bulunamadi, olusturuluyor...');
    mkdirSync(this.certsDir, { recursive: true });

    const ip = this.localIp;
    const subject = `/CN=Ezan Vakitleri/O=AdhanPlayer`;
    const san = `subjectAltName=IP:${ip},IP:127.0.0.1,DNS:localhost`;

    try {
      execSync(
        `openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" ` +
        `-days 365 -nodes -subj "${subject}" -addext "${san}"`,
        { stdio: 'pipe' }
      );
      console.log(`✅ SSL sertifikasi olusturuldu (${this.certsDir}/)`);
    } catch (err) {
      console.error('❌ SSL sertifikasi olusturulamadi:', err.message);
      return null;
    }

    return { key: readFileSync(keyPath), cert: readFileSync(certPath) };
  }

  /**
   * Start the HTTP and HTTPS servers
   */
  async start() {
    // Check if audio directory exists
    if (!existsSync(this.audioDir)) {
      console.warn(`Audio directory does not exist: ${this.audioDir}`);
      console.warn('Creating audio directory...');
      mkdirSync(this.audioDir, { recursive: true });
    }

    // Start HTTP server
    await new Promise((resolve, reject) => {
      this.server = this.app.listen(this.port, '0.0.0.0', () => {
        console.log(`🌐 HTTP server: ${this.getServerUrl()}`);
        console.log(`Serving audio files from: ${this.audioDir}`);
        resolve();
      });

      this.server.on('error', (error) => {
        if (error.code === 'EADDRINUSE') {
          reject(new Error(`Port ${this.port} is already in use`));
        } else {
          reject(error);
        }
      });
    });

    // Start HTTPS server
    const certs = this.ensureCerts();
    if (certs) {
      await new Promise((resolve) => {
        this.httpsServer = https.createServer(certs, this.app);
        this.httpsServer.listen(this.sslPort, '0.0.0.0', () => {
          console.log(`🔒 HTTPS server: ${this.getDashboardUrl()}`);
          resolve();
        });
        this.httpsServer.on('error', (error) => {
          console.error(`❌ HTTPS server baslatılamadi: ${error.message}`);
          resolve(); // Don't block startup if HTTPS fails
        });
      });
    }
  }

  /**
   * Stop the HTTP and HTTPS servers
   */
  async stop() {
    const stops = [];
    if (this.server) {
      stops.push(new Promise((resolve) => this.server.close(resolve)));
    }
    if (this.httpsServer) {
      stops.push(new Promise((resolve) => this.httpsServer.close(resolve)));
    }
    await Promise.all(stops);
    console.log('Audio server stopped');
  }

  /**
   * Get the server URL
   */
  getServerUrl() {
    if (this.localIp === '127.0.0.1') {
      const detected = this.getLocalIp();
      if (detected !== '127.0.0.1') {
        this.localIp = detected;
        console.log(`Local IP updated to: ${this.localIp}`);
      }
    }
    return `http://${this.localIp}:${this.port}`;
  }

  /**
   * Get the HTTPS dashboard URL (for PWA install)
   */
  getDashboardUrl() {
    return `https://${this.localIp}:${this.sslPort}`;
  }

  /**
   * Get URL for a specific audio file
   * @param {string} filename - Name of the audio file (e.g., 'adhan.mp3')
   */
  getAudioUrl(filename) {
    return `${this.getServerUrl()}/audio/${filename}`;
  }
}
