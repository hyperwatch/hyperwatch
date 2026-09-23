/**
 * Minimal Cloudflare API client for the zone's WAF custom rules
 * (Rulesets API, http_request_firewall_custom phase).
 */
const API = 'https://api.cloudflare.com/client/v4';

const PHASE = 'http_request_firewall_custom';

class CloudflareError extends Error {
  constructor(message, { status, errors, cause } = {}) {
    super(message, { cause });
    this.name = 'CloudflareError';
    this.status = status;
    this.errors = errors || [];
  }
}

function createClient({
  token = process.env.CLOUDFLARE_API_TOKEN,
  zoneId = process.env.CLOUDFLARE_ZONE_ID,
  fetch = globalThis.fetch,
} = {}) {
  if (!token) {
    throw new Error('Cloudflare: CLOUDFLARE_API_TOKEN is not set');
  }
  if (!zoneId) {
    throw new Error('Cloudflare: CLOUDFLARE_ZONE_ID is not set');
  }

  async function request(method, path, body) {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json;
    try {
      json = await res.json();
    } catch (err) {
      throw new CloudflareError(
        `Cloudflare: ${method} ${path} returned ${res.status} (not JSON)`,
        { status: res.status, cause: err }
      );
    }
    if (!res.ok || !json.success) {
      const errors = json.errors || [];
      const detail = errors.map((e) => `${e.code}: ${e.message}`).join('; ');
      throw new CloudflareError(
        `Cloudflare: ${method} ${path} failed (${res.status})${detail ? ` ${detail}` : ''}`,
        { status: res.status, errors }
      );
    }
    return json.result;
  }

  // The zone's custom rules ruleset: { id, version, rules: [...] }
  const getEntrypoint = () =>
    request('GET', `/zones/${zoneId}/rulesets/phases/${PHASE}/entrypoint`);

  // Update one rule. Every field is sent: omitted fields are reset.
  const patchRule = (rulesetId, ruleId, rule) =>
    request('PATCH', `/zones/${zoneId}/rulesets/${rulesetId}/rules/${ruleId}`, {
      expression: rule.expression,
      action: rule.action,
      description: rule.description,
      enabled: rule.enabled,
    });

  return { getEntrypoint, patchRule };
}

module.exports = { CloudflareError, createClient };
