import Client from 'castv2-client';

const { DefaultMediaReceiver } = Client;
const CastClient = Client.Client;

/**
 * Google Cast client for playing audio on Google Nest Hub
 */
export class GoogleCastPlayer {
  constructor(config = {}) {
    this.deviceIp = config.deviceIp;
    this.deviceName = config.deviceName;
    this.volume = config.volume !== undefined ? config.volume : 0.5;
    this.client = null;
    this.player = null;
  }

  /**
   * Connect to the Google Cast device
   */
  async connect() {
    return new Promise((resolve, reject) => {
      this.client = new CastClient();

      this.client.connect(this.deviceIp, () => {
        console.log(`Connected to Google Cast device at ${this.deviceIp}`);
        resolve();
      });

      this.client.on('error', (err) => {
        console.error('Cast client error:', err);
        this.cleanup();
        reject(err);
      });

      // Set a connection timeout
      setTimeout(() => {
        if (!this.client) {
          reject(new Error('Connection timeout'));
        }
      }, 10000);
    });
  }

  /**
   * Launch the media player app
   */
  async launchPlayer() {
    return new Promise((resolve, reject) => {
      if (!this.client) {
        reject(new Error('Not connected to device'));
        return;
      }

      this.client.launch(DefaultMediaReceiver, (err, player) => {
        if (err) {
          reject(err);
          return;
        }

        this.player = player;

        this.player.on('status', (status) => {
          console.log('Player status:', status.playerState);
        });

        resolve(player);
      });
    });
  }

  /**
   * Set the volume
   * @param {number} level - Volume level (0.0 to 1.0)
   */
  async setVolume(level) {
    return new Promise((resolve, reject) => {
      if (!this.client) {
        reject(new Error('Not connected to device'));
        return;
      }

      this.client.setVolume({ level }, (err) => {
        if (err) {
          reject(err);
        } else {
          console.log(`Volume set to ${level * 100}%`);
          resolve();
        }
      });
    });
  }

  /**
   * Play an audio file
   * @param {string} audioUrl - URL of the audio file to play
   * @param {Object} options - Playback options
   */
  async playAudio(audioUrl, options = {}) {
    try {
      // Connect if not already connected
      if (!this.client) {
        await this.connect();
      }

      // Set volume before playing
      if (this.volume !== undefined) {
        await this.setVolume(this.volume);
      }

      // Launch the media player
      await this.launchPlayer();

      // Prepare media object
      const media = {
        contentId: audioUrl,
        contentType: options.contentType || 'audio/mp3',
        streamType: 'BUFFERED',
        metadata: {
          type: 0,
          metadataType: 0,
          title: options.title || 'Adhan',
          subtitle: options.subtitle || 'Prayer Time',
        },
      };

      // Load and play the media
      return new Promise((resolve, reject) => {
        this.player.load(media, { autoplay: true }, (err, status) => {
          if (err) {
            console.error('Error loading media:', err);
            reject(err);
            return;
          }

          console.log(`Playing: ${audioUrl}`);
          console.log('Player status:', status.playerState);

          // Wait for playback to complete
          this.player.on('status', (status) => {
            if (status.playerState === 'IDLE' && status.idleReason === 'FINISHED') {
              console.log('Playback finished');
              this.cleanup();
              resolve();
            }
          });

          // Set a timeout in case status events don't fire properly
          if (options.timeout) {
            setTimeout(() => {
              this.cleanup();
              resolve();
            }, options.timeout);
          }
        });
      });
    } catch (error) {
      console.error('Error playing audio:', error);
      this.cleanup();
      throw error;
    }
  }

  /**
   * Stop playback
   */
  async stop() {
    return new Promise((resolve) => {
      if (this.player) {
        this.player.stop(() => {
          console.log('Playback stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Cleanup and disconnect
   */
  cleanup() {
    if (this.client) {
      this.client.close();
      this.client = null;
      this.player = null;
      console.log('Disconnected from Cast device');
    }
  }

  /**
   * Play Adhan for a specific prayer
   * @param {string} audioUrl - URL of the Adhan audio
   * @param {string} prayerName - Name of the prayer (e.g., 'Fajr')
   */
  async playAdhan(audioUrl, prayerName = 'Prayer') {
    console.log(`\n🕌 Playing Adhan for ${prayerName}`);

    await this.playAudio(audioUrl, {
      title: `Adhan - ${prayerName}`,
      subtitle: `Time for ${prayerName} prayer`,
      contentType: 'audio/mp3',
      timeout: 10 * 60 * 1000, // 10 minutes max
    });
  }
}

/**
 * Discover Google Cast devices on the network using mDNS
 */
export async function discoverDevices(timeout = 5000) {
  return new Promise((resolve) => {
    const mdns = require('mdns-js');
    const devices = [];

    const browser = mdns.createBrowser(mdns.tcp('googlecast'));

    browser.on('ready', () => {
      browser.discover();
    });

    browser.on('update', (data) => {
      if (data.addresses && data.addresses.length > 0) {
        const device = {
          name: data.fullname || data.host,
          ip: data.addresses[0],
          port: data.port,
        };

        // Avoid duplicates
        if (!devices.some((d) => d.ip === device.ip)) {
          devices.push(device);
          console.log(`Found device: ${device.name} at ${device.ip}`);
        }
      }
    });

    setTimeout(() => {
      browser.stop();
      resolve(devices);
    }, timeout);
  });
}
