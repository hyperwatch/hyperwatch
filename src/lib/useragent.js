/**
 * This is where all the magic comes from, specially crafted for `useragent`.
 */
const regexes = require('../data/regexes');

/**
 * Reduce references by storing the lookups.
 */
// OperatingSystem parsers:
const osparsers = regexes.os,
  osparserslength = osparsers.length;

// UserAgent parsers:
const agentparsers = regexes.browser,
  agentparserslength = agentparsers.length;

// Device parsers:
const deviceparsers = regexes.device,
  deviceparserslength = deviceparsers.length;

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
  this.family = family || 'Other';
  this.major = major || '0';
  this.minor = minor || '0';
  this.patch = patch || '0';
  this.patch_minor = patch_minor || '0';
  this.source = source || '';
}

/**
 * OnDemand parsing of the Operating System.
 *
 * @type {OperatingSystem}
 * @api public
 */
Object.defineProperty(Agent.prototype, 'os', {
  get: function lazyparse() {
    const userAgent = this.source,
      length = osparserslength,
      parsers = osparsers;
    let i = 0,
      parser,
      res;

    for (; i < length; i++) {
      if ((res = parsers[i][0].exec(userAgent))) {
        parser = parsers[i];

        if (parser[1]) {
          res[1] = parser[1].replace('$1', res[1]);
        }
        break;
      }
    }

    return Object.defineProperty(this, 'os', {
      value:
        !parser || !res
          ? new OperatingSystem()
          : new OperatingSystem(
              res[1],
              parser[2] || res[2],
              parser[3] || res[3],
              parser[4] || res[4],
              parser[5] || res[5]
            ),
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
    const userAgent = this.source,
      length = deviceparserslength,
      parsers = deviceparsers;
    let i = 0,
      parser,
      res;

    for (; i < length; i++) {
      if ((res = parsers[i][0].exec(userAgent))) {
        parser = parsers[i];

        if (parser[1]) {
          res[1] = parser[1].replace('$1', res[1]);
        }
        break;
      }
    }

    return Object.defineProperty(this, 'device', {
      value:
        !parser || !res
          ? new Device()
          : new Device(
              res[1],
              parser[2] || res[2],
              parser[3] || res[3],
              parser[4] || res[4]
            ),
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
  const agent = this.toAgent(),
    os = this.os !== 'Other' ? this.os : false;

  return agent + (os ? ` / ${os}` : '');
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
  return {
    family: this.family,
    major: this.major,
    minor: this.minor,
    patch: this.patch,
    patch_minor: this.patch_minor,
    device: this.device,
    os: this.os,
  };
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
  this.family = family || 'Other';
  this.major = major || '0';
  this.minor = minor || '0';
  this.patch = patch || '0';
  this.patch_minor = patch_minor || '0';
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
 * are not outputed in the stringify.
 *
 * @returns {String}
 * @api public
 */
OperatingSystem.prototype.toJSON = function toJSON() {
  return {
    family: this.family,
    major: this.major || undefined,
    minor: this.minor || undefined,
    patch: this.patch || undefined,
    patch_minor: this.patch_minor || undefined,
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
function Device(family, major, minor, patch) {
  this.family = family || 'Other';
  this.major = major || '0';
  this.minor = minor || '0';
  this.patch = patch || '0';
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
 * are not outputed in the stringify.
 *
 * @returns {String}
 * @api public
 */
Device.prototype.toJSON = function toJSON() {
  return {
    family: this.family,
    major: this.major || undefined,
    minor: this.minor || undefined,
    patch: this.patch || undefined,
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
exports.parse = function parse(userAgent) {
  if (userAgent && userAgent.length > 1000) {
    userAgent = userAgent.substring(0, 1000);
  }

  if (!userAgent || !isSafe(userAgent)) {
    return new Agent();
  }

  const length = agentparserslength,
    parsers = agentparsers;

  let i = 0,
    parser,
    res;

  for (; i < length; i++) {
    if ((res = parsers[i][0].exec(userAgent))) {
      parser = parsers[i];

      if (parser[1]) {
        res[1] = parser[1]
          .replace('$1', res[1])
          .replace('$2', res[2])
          .replace('$3', res[3])
          .replace('$4', res[4]);
      }
      return new Agent(
        res[1],
        parser[2] || res[2],
        parser[3] || res[3],
        parser[4] || res[4],
        parser[5] || res[5],
        userAgent
      );
    }
  }

  // Return early if we didn't find an match, but might still be able to parse
  // the os and device, so make sure we supply it with the source
  if (!parser || !res) {
    return new Agent('', '', '', '', '', userAgent);
  }
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
    ),
    os = details.os;

  // The device family was added in v2.0
  if ('device' in details) {
    agent.device = new Device(details.device.family);
  } else {
    agent.device = new Device();
  }

  if ('os' in details && os) {
    // In v1.1.0 we only parsed out the Operating System name, not the full
    // version which we added in v2.0. To provide backwards compatible we should
    // we should set the details.os as family
    if (typeof os === 'string') {
      agent.os = new OperatingSystem(os);
    } else {
      agent.os = new OperatingSystem(
        os.family,
        os.major,
        os.minor,
        os.patch,
        os.patch_minor
      );
    }
  }

  return agent;
};
