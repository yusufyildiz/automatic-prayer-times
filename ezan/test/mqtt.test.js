import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'net';
import Aedes from 'aedes';
import mqtt from 'mqtt';
import { MqttBridge, buildDiscovery } from '../src/mqtt-bridge.js';

test('discovery pins the requested entity IDs', () => {
  const d = buildDiscovery('2.0.0');
  const ids = Object.values(d.cmps).map((c) => c.def_ent_id).sort();
  for (const id of [
    'sensor.ezan_imsak', 'sensor.ezan_gunes', 'sensor.ezan_ogle', 'sensor.ezan_ikindi',
    'sensor.ezan_aksam', 'sensor.ezan_yatsi', 'sensor.ezan_sonraki_vakit', 'sensor.ezan_sabah',
    'switch.ezan_sustur', 'switch.ezan_sustur_sabah', 'switch.ezan_sustur_imsak', 'button.ezan_test',
  ]) {
    assert.ok(ids.includes(id), id);
  }
  assert.equal(d.cmps.ezan_sonraki_vakit.dev_cla, 'timestamp');
  for (const c of Object.values(d.cmps)) {
    assert.equal(c.uniq_id, c.def_ent_id.split('.')[1]);
    assert.ok(c.p && c.avty);
  }
  assert.ok(d.dev.ids.length && d.o.name);
});

test('bridge publishes discovery/availability/state and handles commands', async (t) => {
  const broker = await Aedes.createBroker?.() ?? Aedes();
  const server = net.createServer(broker.handle);
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  process.env.EZAN_MQTT_URL = `mqtt://127.0.0.1:${port}`;

  const events = [];
  const bridge = new MqttBridge({
    version: 'test',
    onMute: (e, on) => events.push(['mute', e, on]),
    onButton: (b) => events.push(['button', b]),
  });
  bridge.publishSwitch('sustur', true); // queued before connect
  await bridge.start();

  const seen = new Map();
  const probe = mqtt.connect(`mqtt://127.0.0.1:${port}`);
  probe.on('message', (topic, msg) => seen.set(topic, msg.toString()));
  await new Promise((r) => probe.on('connect', r));
  await probe.subscribeAsync(['homeassistant/#', 'ezan/#']);

  const waitFor = async (fn) => {
    for (let i = 0; i < 100 && !fn(); i++) await new Promise((r) => setTimeout(r, 20));
    assert.ok(fn());
  };

  await waitFor(() => seen.has('homeassistant/device/ezan_addon/config'));
  assert.equal(seen.get('ezan/availability'), 'online');
  assert.equal(seen.get('ezan/switch/sustur/state'), 'ON');

  probe.publish('ezan/switch/sustur_sabah/set', 'ON');
  probe.publish('ezan/switch/sustur/set', 'OFF');
  probe.publish('ezan/button/test/set', 'PRESS');
  probe.publish('ezan/switch/bogus/set', 'ON');
  await waitFor(() => events.length >= 3);
  assert.deepEqual(events, [['mute', 'fajr', true], ['mute', null, false], ['button', 'test']]);

  await bridge.stop();
  await waitFor(() => seen.get('ezan/availability') === 'offline');

  t.after(async () => {
    await probe.endAsync();
    await new Promise((r) => broker.close(r));
    server.close();
    delete process.env.EZAN_MQTT_URL;
  });
});
