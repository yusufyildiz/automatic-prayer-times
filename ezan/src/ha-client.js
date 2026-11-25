/**
 * Minimal Home Assistant client for add-ons.
 *
 * Core REST API is reached through the Supervisor proxy
 * (http://supervisor/core/api, needs `homeassistant_api: true`) and
 * Supervisor service discovery through http://supervisor/services/<name>.
 * Both authenticate with the SUPERVISOR_TOKEN the add-on receives.
 */
const SUPERVISOR_URL = process.env.EZAN_SUPERVISOR_URL || 'http://supervisor';
const CORE_API_URL = process.env.EZAN_HA_URL || `${SUPERVISOR_URL}/core/api`;
const TIMEOUT_MS = 15000;

function token() {
  const t = process.env.SUPERVISOR_TOKEN || process.env.EZAN_HA_TOKEN;
  if (!t) throw new Error('SUPERVISOR_TOKEN yok (add-on dışında mı çalışıyor?)');
  return t;
}

async function request(url, { method = 'GET', body } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token()}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!response.ok) {
    const detail = json?.message || text.slice(0, 200) || response.statusText;
    const error = new Error(`HA API ${method} ${url.replace(CORE_API_URL, '')}: ${response.status} ${detail}`);
    error.status = response.status;
    throw error;
  }
  return json;
}

export const ha = {
  /** @returns {Promise<Object|null>} entity state or null if it doesn't exist */
  async getState(entityId) {
    try {
      return await request(`${CORE_API_URL}/states/${entityId}`);
    } catch (error) {
      if (error.status === 404) return null;
      throw error;
    }
  },

  async callService(domain, service, data) {
    return request(`${CORE_API_URL}/services/${domain}/${service}`, { method: 'POST', body: data });
  },

  /** Supervisor service discovery, e.g. getService('mqtt') */
  async getService(name) {
    const json = await request(`${SUPERVISOR_URL}/services/${name}`);
    return json?.data ?? json;
  },
};
