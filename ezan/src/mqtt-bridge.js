import mqtt from 'mqtt';
import { ha as defaultHa } from './ha-client.js';
import { EVENTS, LABELS, SLUGS } from './options.js';

const BASE = 'ezan';
const DISCOVERY_PREFIX = 'homeassistant';
const DEVICE_ID = 'ezan_addon';
const AVAILABILITY = `${BASE}/availability`;
const REPO_URL = 'https://github.com/yusufyildiz/automatic-prayer-times';

const ICONS = {
  imsak: 'mdi:weather-night',
  fajr: 'mdi:weather-sunset-up',
  sunrise: 'mdi:weather-sunny',
  dhuhr: 'mdi:white-balance-sunny',
  asr: 'mdi:weather-partly-cloudy',
  maghrib: 'mdi:weather-sunset-down',
  isha: 'mdi:moon-waning-crescent',
};

/** Timestamp sensors: key → { slug, name, icon } */
export const TIME_SENSORS = [
  ['imsak', 'İmsak'],
  ['fajr', 'Sabah ezanı'],
  ['sunrise', 'Güneş'],
  ['dhuhr', 'Öğle'],
  ['asr', 'İkindi'],
  ['maghrib', 'Akşam'],
  ['isha', 'Yatsı'],
].map(([key, name]) => ({ key, slug: SLUGS[key], name, icon: ICONS[key] }));

export const stateTopic = (kind, slug) => `${BASE}/${kind}/${slug}/state`;
export const attrTopic = (kind, slug) => `${BASE}/${kind}/${slug}/attributes`;
export const commandTopic = (kind, slug) => `${BASE}/${kind}/${slug}/set`;

/**
 * Build the device-based discovery payload (one message, all entities).
 * Entity IDs are pinned with default_entity_id, e.g. sensor.ezan_imsak.
 */
export function buildDiscovery(version) {
  const avty = [{ t: AVAILABILITY }];
  const cmps = {};

  const sensor = (slug, extra) => {
    cmps[`ezan_${slug}`] = {
      p: 'sensor',
      uniq_id: `ezan_${slug}`,
      def_ent_id: `sensor.ezan_${slug}`,
      stat_t: stateTopic('sensor', slug),
      avty,
      ...extra,
    };
  };

  for (const s of TIME_SENSORS) {
    sensor(s.slug, { name: s.name, dev_cla: 'timestamp', ic: s.icon });
  }
  sensor('sonraki_vakit', {
    name: 'Sonraki vakit',
    dev_cla: 'timestamp',
    ic: 'mdi:clock-outline',
    json_attr_t: attrTopic('sensor', 'sonraki_vakit'),
  });
  sensor('sonraki_ezan', {
    name: 'Sonraki ezan',
    dev_cla: 'timestamp',
    ic: 'mdi:bullhorn',
    json_attr_t: attrTopic('sensor', 'sonraki_ezan'),
  });
  sensor('son_calan', {
    name: 'Son ezan',
    ic: 'mdi:history',
    json_attr_t: attrTopic('sensor', 'son_calan'),
  });

  const sw = (slug, name, icon) => {
    cmps[`ezan_${slug}`] = {
      p: 'switch',
      uniq_id: `ezan_${slug}`,
      def_ent_id: `switch.ezan_${slug}`,
      name,
      ic: icon,
      cmd_t: commandTopic('switch', slug),
      stat_t: stateTopic('switch', slug),
      pl_on: 'ON',
      pl_off: 'OFF',
      avty,
    };
  };
  sw('sustur', 'Ezan sustur', 'mdi:volume-off');
  for (const e of EVENTS) {
    sw(`sustur_${SLUGS[e]}`, `${LABELS[e]} ezanını sustur`, 'mdi:volume-mute');
  }

  const button = (slug, name, icon) => {
    cmps[`ezan_${slug}`] = {
      p: 'button',
      uniq_id: `ezan_${slug}`,
      def_ent_id: `button.ezan_${slug}`,
      name,
      ic: icon,
      cmd_t: commandTopic('button', slug),
      pl_prs: 'PRESS',
      avty,
    };
  };
  button('test', 'Hoparlör testi', 'mdi:speaker-play');
  button('durdur', 'Ezanı durdur', 'mdi:stop');

  return {
    dev: {
      ids: [DEVICE_ID],
      name: 'Ezan',
      mf: 'automatic-prayer-times',
      mdl: 'Home Assistant add-on',
      sw: version,
    },
    o: { name: 'ezan-addon', sw: version, url: REPO_URL },
    cmps,
  };
}

/**
 * MQTT connection, discovery and command handling.
 *
 * Callbacks:
 *   onMute(event|null, bool) - event null = global "Ezan sustur"
 *   onButton('test'|'durdur')
 *   onHomeAssistantOnline()  - HA restarted; caller republishes states
 */
export class MqttBridge {
  constructor({ version, onMute, onButton, ha = defaultHa }) {
    this.version = version;
    this.onMute = onMute;
    this.onButton = onButton;
    this.ha = ha;
    this.client = null;
    this.connected = false;
    this.retained = new Map(); // topic → payload, replayed after reconnect
  }

  async brokerOptions() {
    if (process.env.EZAN_MQTT_URL) {
      return {
        url: process.env.EZAN_MQTT_URL,
        username: process.env.EZAN_MQTT_USER,
        password: process.env.EZAN_MQTT_PASSWORD,
      };
    }
    const s = await this.ha.getService('mqtt');
    if (!s?.host) throw new Error('Supervisor MQTT bilgisi vermedi (Mosquitto add-on kurulu mu?)');
    return {
      url: `${s.ssl ? 'mqtts' : 'mqtt'}://${s.host}:${s.port}`,
      username: s.username,
      password: s.password,
      protocolVersion: s.protocol === '3.1' ? 3 : 4,
    };
  }

  /** Connect; resolves once the first connection attempt has been made */
  async start() {
    let opts;
    for (let attempt = 1; ; attempt++) {
      try {
        opts = await this.brokerOptions();
        break;
      } catch (error) {
        const wait = Math.min(60, attempt * 10);
        console.error(`❌ MQTT broker bilgisi alınamadı: ${error.message} — ${wait} sn sonra tekrar`);
        await new Promise((r) => setTimeout(r, wait * 1000));
      }
    }

    const { url, ...rest } = opts;
    console.log(`🔌 MQTT: ${url} adresine bağlanılıyor...`);

    this.client = mqtt.connect(url, {
      ...rest,
      clientId: `ezan-addon-${Math.random().toString(16).slice(2, 8)}`,
      reconnectPeriod: 5000,
      will: { topic: AVAILABILITY, payload: 'offline', retain: true, qos: 1 },
    });

    this.client.on('connect', () => {
      this.connected = true;
      console.log('✅ MQTT bağlandı, entity\'ler yayınlanıyor');
      this.client.subscribe([`${BASE}/+/+/set`, `${DISCOVERY_PREFIX}/status`], { qos: 1 });
      this.publishDiscovery();
      this.client.publish(AVAILABILITY, 'online', { retain: true, qos: 1 });
      for (const [topic, payload] of this.retained) {
        this.client.publish(topic, payload, { retain: true, qos: 1 });
      }
    });
    this.client.on('close', () => {
      if (this.connected) console.warn('⚠️  MQTT bağlantısı koptu, yeniden denenecek');
      this.connected = false;
    });
    this.client.on('error', (error) => {
      console.error(`❌ MQTT hatası: ${error.message}`);
    });
    this.client.on('message', (topic, message) => this.handleMessage(topic, message.toString()));
  }

  publishDiscovery() {
    this.client.publish(
      `${DISCOVERY_PREFIX}/device/${DEVICE_ID}/config`,
      JSON.stringify(buildDiscovery(this.version)),
      { retain: true, qos: 1 }
    );
  }

  handleMessage(topic, payload) {
    if (topic === `${DISCOVERY_PREFIX}/status`) {
      if (payload === 'online') {
        console.log('ℹ️  Home Assistant yeniden başladı, entity\'ler tekrar yayınlanıyor');
        this.publishDiscovery();
        this.client.publish(AVAILABILITY, 'online', { retain: true, qos: 1 });
        for (const [t, p] of this.retained) this.client.publish(t, p, { retain: true, qos: 1 });
      }
      return;
    }

    const m = topic.match(new RegExp(`^${BASE}/(switch|button)/([a-z_]+)/set$`));
    if (!m) return;
    const [, kind, slug] = m;

    if (kind === 'button') {
      if (payload === 'PRESS') this.onButton?.(slug);
      return;
    }

    if (payload !== 'ON' && payload !== 'OFF') return;
    const on = payload === 'ON';
    if (slug === 'sustur') {
      this.onMute?.(null, on);
      return;
    }
    const event = EVENTS.find((e) => `sustur_${SLUGS[e]}` === slug);
    if (event) this.onMute?.(event, on);
  }

  publish(topic, payload) {
    const value = typeof payload === 'string' ? payload : JSON.stringify(payload);
    this.retained.set(topic, value);
    if (this.client && this.connected) {
      this.client.publish(topic, value, { retain: true, qos: 1 });
    }
  }

  /** Timestamp sensor value: dayjs | null */
  publishTimestamp(slug, at, attributes) {
    this.publish(stateTopic('sensor', slug), at ? at.format() : 'None');
    if (attributes) this.publish(attrTopic('sensor', slug), attributes);
  }

  publishSensor(slug, value, attributes) {
    this.publish(stateTopic('sensor', slug), value === null || value === undefined ? 'None' : String(value));
    if (attributes) this.publish(attrTopic('sensor', slug), attributes);
  }

  publishSwitch(slug, on) {
    this.publish(stateTopic('switch', slug), on ? 'ON' : 'OFF');
  }

  async stop() {
    if (!this.client) return;
    await new Promise((resolve) => {
      if (!this.connected) return resolve();
      this.client.publish(AVAILABILITY, 'offline', { retain: true, qos: 1 }, () => resolve());
      setTimeout(resolve, 1000);
    });
    await this.client.endAsync().catch(() => {});
  }
}
