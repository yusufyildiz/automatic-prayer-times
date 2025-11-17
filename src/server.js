import express from 'express';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * HTTP Server to serve audio files for Google Cast
 * Google Cast devices need to access audio files via HTTP URL
 */
export class AudioServer {
  constructor(config = {}) {
    this.port = config.port || 3000;
    this.audioDir = config.audioDir || join(__dirname, '..', 'audio');
    this.app = express();
    this.server = null;
    this.localIp = config.localIp || this.getLocalIp();

    this.setupRoutes();
  }

  /**
   * Get local IP address
   */
  getLocalIp() {
    const { networkInterfaces } = require('os');
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
      const { readdirSync } = require('fs');
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
   * Start the HTTP server
   */
  async start() {
    return new Promise((resolve, reject) => {
      // Check if audio directory exists
      if (!existsSync(this.audioDir)) {
        console.warn(`Audio directory does not exist: ${this.audioDir}`);
        console.warn('Creating audio directory...');
        const { mkdirSync } = require('fs');
        mkdirSync(this.audioDir, { recursive: true });
      }

      this.server = this.app.listen(this.port, '0.0.0.0', () => {
        console.log(`Audio server running at ${this.getServerUrl()}`);
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
  }

  /**
   * Stop the HTTP server
   */
  async stop() {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log('Audio server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Get the server URL
   */
  getServerUrl() {
    return `http://${this.localIp}:${this.port}`;
  }

  /**
   * Get URL for a specific audio file
   * @param {string} filename - Name of the audio file (e.g., 'adhan.mp3')
   */
  getAudioUrl(filename) {
    return `${this.getServerUrl()}/audio/${filename}`;
  }
}
