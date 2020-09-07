const debug = require('debug');

const regexes = require('../data/regexes');
const parser = require('../lib/parser');

const debugUseragent = debug('hyperwatch:useragent');

function replaceMatches(string, res) {
  return string
    .replace('$1', res[1])
    .replace('$2', res[2])
    .replace('$3', res[3])
    .replace('$4', res[4]);
}

/**
 * The representation of a parsed user agent.
 *
 * @constructor
 * @param {String} family The name of the browser
 * @param {String} major Major version of the browser
 * @param {String} minor Minor version of the browser
 * @param {String} patch Patch version of the browser
 * @param {String} source The actual user agent string
 * @api public
 */
function Agent(family, major, minor, patch, patch_minor, source) {
  this.family = family || null;
  this.major = major || null;
  this.minor = minor || null;
  this.patch = patch || null;
  this.patch_minor = patch_minor || null;
  this.source = source || '';
}

/**
 * OnDemand parsing of the type
 *
 * @type {String}
 * @api public
 */
Object.defineProperty(Agent.prototype, 'type', {
  get: function lazyparse() {
    const device = this.device;

    if (device && device.family === 'Spider') {
      return Object.defineProperty(this, 'type', {
        value: 'robot',
      }).type;
    }

    return Object.defineProperty(this, 'type', {
      value: null,
    }).type;
  },

  /**
   * Bypass the OnDemand parsing and set a type
   *
   * @param {String} type
   * @api public
   */
  set: function set(type) {
    Object.defineProperty(this, 'type', {
      value: type,
    });
  },
});

/**
 * OnDemand parsing of the Operating System.
 *
 * @type {OperatingSystem}
 * @api public
 */
Object.defineProperty(Agent.prototype, 'os', {
  get: function lazyparse() {
    const userAgent = this.source;

    for (const osRegex of regexes.os) {
      const res = osRegex.regex.exec(userAgent);
      if (res) {
        const family = osRegex.os_replacement
          ? replaceMatches(osRegex.os_replacement, res)
          : res[1];
        const major = osRegex.os_v1_replacement
          ? replaceMatches(osRegex.os_v1_replacement, res)
          : res[2];
        const minor = osRegex.os_v2_replacement
          ? replaceMatches(osRegex.os_v2_replacement, res)
          : res[3];
        const patch = osRegex.os_v3_replacement
          ? replaceMatches(osRegex.os_v3_replacement, res)
          : res[4];
        const patch_minor = osRegex.os_v4_replacement
          ? replaceMatches(osRegex.os_v4_replacement, res)
          : res[5];

        return Object.defineProperty(this, 'os', {
          value: new OperatingSystem(family, major, minor, patch, patch_minor),
        }).os;
      }
    }

    return Object.defineProperty(this, 'os', {
      value: null,
    }).os;
  },

  /**
   * Bypass the OnDemand parsing and set an OperatingSystem instance.
   *
   * @param {OperatingSystem} os
   * @api public
   */
  set: function set(os) {
    if (os instanceof OperatingSystem) {
      Object.defineProperty(this, 'os', {
        value: os,
      });
    }
  },
});

/**
 * OnDemand parsing of the Device type.
 *
 * @type {Device}
 * @api public
 */
Object.defineProperty(Agent.prototype, 'device', {
  get: function lazyparse() {
    const userAgent = this.source;

    for (const deviceRegex of regexes.device) {
      const res = deviceRegex.regex.exec(userAgent);
      if (res) {
        const family = deviceRegex.device_replacement
          ? replaceMatches(deviceRegex.device_replacement, res)
          : res[1];
        const brand = deviceRegex.brand_replacement
          ? replaceMatches(deviceRegex.brand_replacement, res)
          : res[2];
        const model = deviceRegex.model_replacement
          ? replaceMatches(deviceRegex.model_replacement, res)
          : res[3];

        return Object.defineProperty(this, 'device', {
          value: new Device(family, brand, model),
        }).device;
      }
    }

    return Object.defineProperty(this, 'device', {
      value: null,
    }).device;
  },

  /**
   * Bypass the OnDemand parsing and set an Device instance.
   *
   * @param {Device} device
   * @api public
   */
  set: function set(device) {
    if (device instanceof Device) {
      Object.defineProperty(this, 'device', {
        value: device,
      });
    }
  },
});
/** * Generates a string output of the parsed user agent.
 *
 * @returns {String}
 * @api public
 */
Agent.prototype.toAgent = function toAgent() {
  let output = this.family;
  const version = this.toVersion();

  if (version) {
    output += ` ${version}`;
  }
  return output;
};

/**
 * Generates a string output of the parser user agent and operating system.
 *
 * @returns {String}  "UserAgent 0.0.0 / OS"
 * @api public
 */
Agent.prototype.toString = function toString() {
  const agent = this.toAgent();

  return agent + (this.os ? ` / ${this.os}` : '');
};

/**
 * Outputs a compiled veersion number of the user agent.
 *
 * @returns {String}
 * @api public
 */
Agent.prototype.toVersion = function toVersion() {
  let version = '';

  if (this.major) {
    version += this.major;

    if (this.minor) {
      version += `.${this.minor}`;

      // Special case here, the patch can also be Alpha, Beta etc so we need
      // to check if it's a string or not.
      if (this.patch) {
        version += (isNaN(+this.patch) ? ' ' : '.') + this.patch;

        if (this.patch_minor) {
          version += `.${this.patch_minor}`;
        }
      }
    }
  }

  return version;
};

/**
 * Outputs a JSON string of the Agent.
 *
 * @returns {String}
 * @api public
 */
Agent.prototype.toJSON = function toJSON() {
  const object = {
    family: this.family,
    major: this.major,
    minor: this.minor,
    patch: this.patch,
    patch_minor: this.patch_minor,
  };
  if (this.type) {
    object.type = this.type;
  }
  if (this.os) {
    object.os = this.os.toJSON();
  }
  if (this.device) {
    object.device = this.device.toJSON();
  }
  return object;
};

/**
 * The representation of a parsed Operating System.
 *
 * @constructor
 * @param {String} family The name of the os
 * @param {String} major Major version of the os
 * @param {String} minor Minor version of the os
 * @param {String} patch Patch version of the os
 * @api public
 */
function OperatingSystem(family, major, minor, patch, patch_minor) {
  this.family = family || null;
  this.major = major || null;
  this.minor = minor || null;
  this.patch = patch || null;
  this.patch_minor = patch_minor || null;
}

/**
 * Generates a stringified version of the Operating System.
 *
 * @returns {String} "Operating System 0.0.0"
 * @api public
 */
OperatingSystem.prototype.toString = function toString() {
  let output = this.family;
  const version = this.toVersion();

  if (version) {
    output += ` ${version}`;
  }
  return output;
};

/**
 * Generates the version of the Operating System.
 *
 * @returns {String}
 * @api public
 */
OperatingSystem.prototype.toVersion = function toVersion() {
  let version = '';

  if (this.major) {
    version += this.major;

    if (this.minor) {
      version += `.${this.minor}`;

      // Special case here, the patch can also be Alpha, Beta etc so we need
      // to check if it's a string or not.
      if (this.patch) {
        version += (isNaN(+this.patch) ? ' ' : '.') + this.patch;
      }
    }
  }

  return version;
};

/**
 * Outputs a JSON string of the OS, values are defaulted to undefined so they
 * are not outputted in the stringify.
 *
 * @returns {String}
 * @api public
 */
OperatingSystem.prototype.toJSON = function toJSON() {
  return {
    family: this.family,
    major: this.major || null,
    minor: this.minor || null,
    patch: this.patch || null,
    patch_minor: this.patch_minor || null,
  };
};

/**
 * The representation of a parsed Device.
 *
 * @constructor
 * @param {String} family The name of the device
 * @param {String} major Major version of the device
 * @param {String} minor Minor version of the device
 * @param {String} patch Patch version of the device
 * @api public
 */
function Device(family, brand, model) {
  this.family = family || null;
  this.brand = brand || null;
  this.model = model || null;
}

/**
 * Generates a stringified version of the Device.
 *
 * @returns {String} "Device 0.0.0"
 * @api public
 */
Device.prototype.toString = function toString() {
  let output = this.family;
  const version = this.toVersion();

  if (version) {
    output += ` ${version}`;
  }
  return output;
};

/**
 * Generates the version of the Device.
 *
 * @returns {String}
 * @api public
 */
Device.prototype.toVersion = function toVersion() {
  let version = '';

  if (this.major) {
    version += this.major;

    if (this.minor) {
      version += `.${this.minor}`;

      // Special case here, the patch can also be Alpha, Beta etc so we need
      // to check if it's a string or not.
      if (this.patch) {
        version += (isNaN(+this.patch) ? ' ' : '.') + this.patch;
      }
    }
  }

  return version;
};

/**
 * Outputs a JSON string of the Device, values are defaulted to undefined so they
 * are not outputted in the stringify.
 *
 * @returns {String}
 * @api public
 */
Device.prototype.toJSON = function toJSON() {
  return {
    family: this.family,
    brand: this.brand || null,
    model: this.model || null,
  };
};

/**
 * Nao that we have setup all the different classes and configured it we can
 * actually start assembling and exposing everything.
 */
exports.Device = Device;
exports.OperatingSystem = OperatingSystem;
exports.Agent = Agent;

/**
 * Check if the userAgent is something we want to parse with regexp's.
 *
 * @param {String} userAgent The userAgent.
 * @returns {Boolean}
 */
function isSafe(userAgent) {
  let consecutive = 0,
    code = 0;

  if (userAgent.length > 1000) {
    return false;
  }

  for (let i = 0; i < userAgent.length; i++) {
    code = userAgent.charCodeAt(i);
    if (
      (code >= 48 && code <= 57) || // numbers
      (code >= 65 && code <= 90) || // letters A-Z
      (code >= 97 && code <= 122) || // letters a-z
      code <= 32 // spaces and control
    ) {
      consecutive++;
    } else {
      consecutive = 0;
    }

    if (consecutive >= 100) {
      return false;
    }
  }

  return true;
}

/**
 * Parses the user agent string with the generated parsers from the
 * ua-parser project on google code.
 *
 * @param {String} userAgent The user agent string
 * @param {String} [jsAgent] Optional UA from js to detect chrome frame
 * @returns {Agent}
 * @api public
 */
exports.parse = function parse(
  userAgent,
  enableCore = true,
  enableExtra = true,
  enableUapCore = true
) {
  debugUseragent(userAgent);

  if (userAgent && userAgent.length > 1000) {
    userAgent = userAgent.substring(0, 1000);
  }

  // Remove known artefacts
  userAgent = userAgent.replace(',gzip(gfe)', '');

  if (!userAgent || !isSafe(userAgent)) {
    return new Agent();
  }

  const regexSets = {};

  if (enableCore) {
    regexSets['hyperwatch-first'] = regexes.first;
    const result = parser.parse(userAgent);
    if (result.meta) {
      debugUseragent(result.meta);
    }
    if (result.regexes) {
      regexSets['hyperwatch-core'] = result.regexes;
    }
  }
  if (enableExtra) {
    regexSets['hyperwatch-extra'] = regexes.extra;
  }
  if (enableUapCore) {
    regexSets['uap-core'] = regexes.agent;
  }

  for (const [setName, regexSet] of Object.entries(regexSets)) {
    for (const entry of regexSet) {
      const {
        regex,
        family_replacement,
        v1_replacement,
        v2_replacement,
        v3_replacement,
        v4_replacement,
        type_replacement,
      } = entry;

      const res = regex.exec(userAgent);
      if (res) {
        debugUseragent(regex);
        const family = parser.processFamily(
          family_replacement ? replaceMatches(family_replacement, res) : res[1]
        );

        // Optimization: no need to replaceMatches in replacements
        const major = v1_replacement || res[2] || null;
        const minor = v2_replacement || res[3] || null;
        const patch = v3_replacement || res[4] || null;
        const minor_patch = v4_replacement || res[5] || null;

        const type = type_replacement || null;

        debugUseragent(`Result (${setName})`, {
          family,
          major,
          minor,
          patch,
          minor_patch,
        });

        const agent = new Agent(
          family,
          major,
          minor,
          patch,
          minor_patch,
          userAgent
        );

        if (type) {
          Object.defineProperty(agent, 'type', { value: type });
        }

        return agent;
      }
    }
  }

  debugUseragent('No result');

  // We might still be able to parse the os and device,
  // so make sure we supply it with the source
  return new Agent(null, null, null, null, null, null, userAgent);
};

/**
 * Transform a JSON object back to a valid userAgent string
 *
 * @param {Object} details
 * @returns {Agent}
 */
exports.fromJSON = function fromJSON(details) {
  if (typeof details === 'string') {
    details = JSON.parse(details);
  }

  const agent = new Agent(
    details.family,
    details.major,
    details.minor,
    details.patch,
    details.patch_minor
  );

  if (details.type) {
    agent.type = details.type;
  }

  if (details.os) {
    agent.os = new OperatingSystem(
      details.os.family,
      details.os.major,
      details.os.minor,
      details.os.patch,
      details.os.patch_minor
    );
  }

  if (details.device) {
    agent.device = new Device(
      details.device.family,
      details.device.brand,
      details.device.model,
      details.device.patch,
      details.device.patch_minor
    );
  }

  return agent;
};

/**
 * Add an extra Regex for agent detection
 *
 * @param {String} type (agent, os, device, robot)
 * @param {Object} regex object
 * @returns {Agent}
 */
exports.addRegex = function addRegex(type, object) {
  object.regex = new RegExp(object.regex, object.regex_flag || '');
  regexes[type].unshift(object);
};
