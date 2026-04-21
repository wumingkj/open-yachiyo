const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG_PATH = path.join(__dirname, '..', '..', '..', 'config', 'idle-chatter.yaml');

function loadIdleChatterConfig(configPath) {
  const resolvedPath = configPath || process.env.IDLE_CHATTER_CONFIG_PATH || DEFAULT_CONFIG_PATH;
  try {
    const raw = fs.readFileSync(resolvedPath, 'utf8');
    return normalizeConfig(YAML.parse(raw) || {});
  } catch (err) {
    if (err.code === 'ENOENT') {
      return normalizeConfig({});
    }
    throw err;
  }
}

function normalizeConfig(raw) {
  const safe = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};

  const toStr = (v, fallback) => (typeof v === 'string' ? v : fallback);
  const toNum = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
  const toBool = (v, fallback) => (v === true || v === 'true');
  const toArray = (v) => (Array.isArray(v) ? v : []);

  // Time greetings normalization
  const greetings = toArray(safe.time_greetings).map((g) => ({
    hour: toNum(g?.hour, 0),
    minute: toNum(g?.minute, 0),
    topic: toStr(g?.topic, ''),
    one_shot: toBool(g?.one_shot, false)
  })).filter((g) => g.topic);

  return {
    enabled: toBool(safe.enabled, false),
    idle_threshold_sec: toNum(safe.idle_threshold_sec, 300),
    cooldown_sec: toNum(safe.cooldown_sec, 600),
    jitter_sec: toNum(safe.jitter_sec, 120),
    max_per_hour: toNum(safe.max_per_hour, 4),
    time_greetings: greetings,
    topics: toArray(safe.topics).filter((t) => typeof t === 'string' && t.trim()),
    system_prompt_prefix: toStr(safe.system_prompt_prefix, ''),
    suppress_during_response: toBool(safe.suppress_during_response, true),
    startup_delay_sec: toNum(safe.startup_delay_sec, 60)
  };
}

// ---------------------------------------------------------------------------
// IdleChatter class
// ---------------------------------------------------------------------------

class IdleChatter {
  /**
   * @param {object} opts
   * @param {object} [opts.config]         - Pre-loaded config object (optional, loads from file if omitted)
   * @param {string} [opts.configPath]     - Path to idle-chatter.yaml
   * @param {Function} opts.runInput       - async ({ input }) => void — same as gatewayRuntimeClient.runInput
   * @param {Function} [opts.appendChatMessage] - ({ role, text, timestamp }, role) => void
   * @param {Function} [opts.showBubble]   - ({ text, durationMs }) => void
   * @param {object} [opts.logger]         - Logger with .info/.warn/.error
   * @param {Function} [opts.setIntervalFn] - setInterval replacement (for testing)
   * @param {Function} [opts.clearIntervalFn] - clearInterval replacement (for testing)
   * @param {Function} [opts.nowFn]        - Date.now replacement (for testing)
   */
  constructor(opts = {}) {
    this._runInput = opts.runInput;
    this._appendChatMessage = opts.appendChatMessage || null;
    this._showBubble = opts.showBubble || null;
    this._logger = opts.logger || console;
    this._setInterval = opts.setIntervalFn || setInterval;
    this._clearInterval = opts.clearIntervalFn || clearInterval;
    this._now = opts.nowFn || (() => Date.now());

    this._config = opts.config || loadIdleChatterConfig(opts.configPath);
    this._configPath = opts.configPath;

    // State
    this._lastUserActivityMs = this._now();
    this._lastIdleChatMs = 0;
    this._triggeredGreetings = new Set(); // "H:M" keys for one_shot greetings
    this._chatCountThisHour = 0;
    this._hourBucket = this._currentHourBucket();
    this._isRunning = false;
    this._isProcessing = false; // true while an idle chat runInput is in-flight
    this._timer = null;
    this._greetingTimer = null;
    this._startedAtMs = 0;
  }

  // ---- Public API ----

  /** Start the idle chatter loop. */
  start() {
    if (this._isRunning) return;
    if (!this._config.enabled) {
      this._logger.info?.('[idle-chatter] disabled by config');
      return;
    }

    this._startedAtMs = this._now();
    this._isRunning = true;
    this._logger.info?.('[idle-chatter] started', {
      idle_threshold_sec: this._config.idle_threshold_sec,
      cooldown_sec: this._config.cooldown_sec,
      max_per_hour: this._config.max_per_hour,
      topic_count: this._config.topics.length
    });

    // Main idle check loop — runs every 15 seconds
    this._timer = this._setInterval(() => this._tick(), 15_000);

    // Greeting check loop — runs every 30 seconds
    if (this._config.time_greetings.length > 0) {
      this._greetingTimer = this._setInterval(() => this._checkTimeGreetings(), 30_000);
    }
  }

  /** Stop the idle chatter loop. */
  stop() {
    this._isRunning = false;
    if (this._timer) {
      this._clearInterval(this._timer);
      this._timer = null;
    }
    if (this._greetingTimer) {
      this._clearInterval(this._greetingTimer);
      this._greetingTimer = null;
    }
    this._logger.info?.('[idle-chatter] stopped');
  }

  /**
   * Notify that the user performed an activity (e.g. sent a chat message).
   * Resets the idle timer.
   */
  notifyUserActivity() {
    this._lastUserActivityMs = this._now();
  }

  /**
   * Notify that an LLM response is currently streaming (or finished).
   * Used to suppress idle chat during active responses.
   * @param {boolean} isStreaming
   */
  setStreamingState(isStreaming) {
    // No-op for now — checked in _tick via a parameterless approach
    // We store the state so _tick can read it
    this._streamingActive = Boolean(isStreaming);
  }

  /** Reload config from disk. */
  reloadConfig() {
    this._config = loadIdleChatterConfig(this._configPath);
    if (!this._config.enabled && this._isRunning) {
      this.stop();
      this._logger.info?.('[idle-chatter] disabled after config reload');
    } else if (this._config.enabled && !this._isRunning) {
      this.start();
      this._logger.info?.('[idle-chatter] enabled after config reload');
    }
  }

  // ---- Internal ----

  _tick() {
    if (!this._isRunning || this._isProcessing) return;

    const now = this._now();

    // Check startup delay
    if (now - this._startedAtMs < this._config.startup_delay_sec * 1000) return;

    // Check suppression during active streaming response
    if (this._config.suppress_during_response && this._streamingActive) return;

    // Check cooldown since last idle chat
    if (now - this._lastIdleChatMs < this._config.cooldown_sec * 1000) return;

    // Check rate limit (per hour)
    this._maybeResetHourBucket(now);
    if (this._chatCountThisHour >= this._config.max_per_hour) return;

    // Check idle threshold (+ jitter)
    const jitterMs = this._config.jitter_sec > 0
      ? Math.floor(Math.random() * this._config.jitter_sec * 1000)
      : 0;
    const thresholdMs = (this._config.idle_threshold_sec * 1000) + jitterMs;
    const idleMs = now - this._lastUserActivityMs;

    if (idleMs >= thresholdMs) {
      void this._triggerIdleChat();
    }
  }

  async _triggerIdleChat() {
    if (this._isProcessing) return;
    this._isProcessing = true;

    try {
      const topic = this._pickTopic();
      const prefix = this._config.system_prompt_prefix.trim();
      const input = prefix
        ? `${prefix}\n\n${topic}`
        : `[idle-trigger] ${topic}`;

      this._logger.info?.('[idle-chatter] triggering idle chat', { topic });
      this._lastIdleChatMs = this._now();
      this._chatCountThisHour++;

      await this._runInput({ input });
    } catch (err) {
      this._logger.warn?.('[idle-chatter] idle chat failed', {
        error: err?.message || String(err)
      });
    } finally {
      this._isProcessing = false;
    }
  }

  _pickTopic() {
    const topics = this._config.topics;
    if (topics.length === 0) return 'start a casual conversation';
    return topics[Math.floor(Math.random() * topics.length)];
  }

  _checkTimeGreetings() {
    const now = new Date();
    const h = now.getHours();
    const m = now.getMinutes();
    const todayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;

    for (const greeting of this._config.time_greetings) {
      if (h === greeting.hour && m === greeting.minute) {
        const shotKey = `${todayKey}:${greeting.hour}:${greeting.minute}`;
        if (greeting.one_shot && this._triggeredGreetings.has(shotKey)) continue;

        this._triggeredGreetings.add(shotKey);
        void this._triggerGreeting(greeting.topic);
      }
    }

    // Cleanup old one_shot keys (keep only today's)
    const prefix = `${todayKey}:`;
    for (const key of this._triggeredGreetings) {
      if (!key.startsWith(prefix)) this._triggeredGreetings.delete(key);
    }
  }

  async _triggerGreeting(topic) {
    if (this._isProcessing) return;
    this._isProcessing = true;

    try {
      this._logger.info?.('[idle-chatter] triggering time greeting', { topic });
      this._lastIdleChatMs = this._now();
      this._chatCountThisHour++;

      await this._runInput({ input: `[time-greeting] ${topic}` });
    } catch (err) {
      this._logger.warn?.('[idle-chatter] time greeting failed', {
        error: err?.message || String(err)
      });
    } finally {
      this._isProcessing = false;
    }
  }

  _currentHourBucket() {
    const now = new Date();
    return `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}`;
  }

  _maybeResetHourBucket(now) {
    const bucket = this._currentHourBucket();
    if (bucket !== this._hourBucket) {
      this._hourBucket = bucket;
      this._chatCountThisHour = 0;
    }
  }
}

module.exports = { IdleChatter, loadIdleChatterConfig, normalizeConfig };
