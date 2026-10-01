/**
 * Minimal Cloudflare API client for the zone's WAF custom rules
 * (Rulesets API, http_request_firewall_custom phase).
 */
const API = 'https://api.cloudflare.com/client/v4';

const PHASE = 'http_request_firewall_custom';

// Milliseconds before a request is abandoned, so a stalled API can't hold a
// sync (and the firewall edits queued behind it) forever
const REQUEST_TIMEOUT = 30000;

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

  async function request(method, path, body, signal) {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT)])
        : AbortSignal.timeout(REQUEST_TIMEOUT),
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
  const getEntrypoint = ({ signal } = {}) =>
    request(
      'GET',
      `/zones/${zoneId}/rulesets/phases/${PHASE}/entrypoint`,
      undefined,
      signal
    );

  // Update one rule. Every field is sent: omitted fields are reset, so the
  // plan carries the rule's other settings (action_parameters, logging)
  const patchRule = (rulesetId, ruleId, rule, { signal } = {}) =>
    request(
      'PATCH',
      `/zones/${zoneId}/rulesets/${rulesetId}/rules/${ruleId}`,
      {
        expression: rule.expression,
        action: rule.action,
        description: rule.description,
        enabled: rule.enabled,
        action_parameters: rule.action_parameters,
        logging: rule.logging,
        ref: rule.ref,
      },
      signal
    );

  return { getEntrypoint, patchRule };
}

module.exports = { CloudflareError, createClient };
