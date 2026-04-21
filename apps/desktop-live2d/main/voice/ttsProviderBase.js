/**
 * TTS Provider Base — abstract interface for all TTS backends.
 *
 * Every concrete TTS provider (DashScope, OpenAI, ElevenLabs, …) must extend
 * this class and implement at least one synthesis path:
 *
 *   - synthesizeNonStreaming()  → returns an object with an audio reference
 *   - streamSynthesis()         → pushes PCM / audio chunks via onEvent
 *
 * The provider is **NOT** responsible for playback — the caller decides how to
 * consume the result (download + play, stream to WebAudio, pipe to file, …).
 *
 * Usage (implementor):
 *   class MyTtsProvider extends TtsProviderBase {
 *     get providerType() { return 'tts_my_backend'; }
 *     async synthesizeNonStreaming({ text, voice }) { ... }
 *   }
 *   module.exports = { MyTtsProvider };
 *
 * Usage (consumer):
 *   const { TtsProviderFactory } = require('./ttsProviderFactory');
 *   const provider = TtsProviderFactory.create('my_tts_key');
 *   const result  = await provider.synthesizeNonStreaming({ text: 'hello' });
 */

class TtsProviderBase {
  /**
   * @param {object}  [opts]
   * @param {Function} [opts.fetchImpl]  - (optional) fetch implementation for HTTP backends
   * @param {Function} [opts.WebSocketImpl] - (optional) WebSocket constructor for streaming backends
   */
  constructor({ fetchImpl, WebSocketImpl } = {}) {
    this.fetchImpl = fetchImpl || null;
    this.WebSocketImpl = WebSocketImpl || null;
  }

  /* ------------------------------------------------------------------ */
  /*  Metadata that concrete providers MUST override                     */
  /* ------------------------------------------------------------------ */

  /**
   * Provider type identifier used in providers.yaml → provider.type.
   * Examples: 'tts_dashscope', 'tts_openai', 'tts_elevenlabs'
   */
  get providerType() {
    throw new Error('TtsProviderBase subclasses must implement getter: providerType');
  }

  /**
   * Human-readable display name for logging / error messages.
   */
  get displayName() {
    return this.providerType;
  }

  /**
   * Audio format produced by this provider's non-streaming path.
   * One of: 'pcm', 'mp3', 'ogg', 'wav', 'opus', 'flac', or any MIME subtype.
   * Null / undefined means "unknown — inspect mimeType at runtime".
   */
  get defaultAudioFormat() {
    return null;
  }

  /**
   * Sample rate (Hz) for streaming PCM output.
   * Relevant only when supportsStreaming is true.
   * Null means "varies or unknown".
   */
  get defaultSampleRate() {
    return 24000;
  }

  /**
   * Whether this provider supports real-time streaming synthesis.
   */
  get supportsStreaming() {
    return false;
  }

  /**
   * Whether this provider requires an API key in its config.
   * Providers like Windows SAPI or Edge TTS don't need one.
   */
  get requiresApiKey() {
    return true;
  }

  /**
   * Whether this provider supports non-streaming (request → URL / buffer) synthesis.
   */
  get supportsNonStreaming() {
    return true;
  }

  /* ------------------------------------------------------------------ */
  /*  Config helpers (shared across providers)                           */
  /* ------------------------------------------------------------------ */

  /**
   * Resolve an API key from a provider config entry.
   * @param {object} provider - raw provider config from providers.yaml
   * @returns {string}
   */
  resolveApiKey(provider) {
    if (!provider || typeof provider !== 'object') return '';
    if (typeof provider.api_key === 'string' && provider.api_key.trim()) {
      return provider.api_key.trim();
    }
    if (typeof provider.api_key_env === 'string' && provider.api_key_env.trim()) {
      return String(process.env[provider.api_key_env] || '').trim();
    }
    return '';
  }

  /**
   * Normalize a base URL string (strip trailing slash, fallback to provided default).
   * @param {string} baseUrl
   * @param {string} [fallback]
   * @returns {string}
   */
  normalizeBaseUrl(baseUrl, fallback) {
    const raw = String(baseUrl || '').trim() || String(fallback || '');
    return raw.replace(/\/$/, '');
  }

  /**
   * Validate that a loaded provider config matches this backend's expected type.
   * @param {object}  provider
   * @param {string}  providerKey
   * @returns {object} validated provider object
   * @throws {Error} with code 'TTS_CONFIG_MISSING'
   */
  validateProviderConfig(provider, providerKey) {
    if (!provider || typeof provider !== 'object') {
      const err = new Error(`tts provider '${providerKey}' is missing or not an object`);
      err.code = 'TTS_CONFIG_MISSING';
      throw err;
    }
    if (provider.type !== this.providerType) {
      const err = new Error(
        `tts provider '${providerKey}' type mismatch: expected '${this.providerType}', got '${provider.type}'`
      );
      err.code = 'TTS_CONFIG_MISSING';
      throw err;
    }
    const apiKey = this.resolveApiKey(provider);
    if (this.requiresApiKey && !apiKey) {
      const err = new Error(`tts provider '${providerKey}' api key is missing`);
      err.code = 'TTS_CONFIG_MISSING';
      throw err;
    }
    return { ...provider, _resolvedApiKey: apiKey };
  }

  /* ------------------------------------------------------------------ */
  /*  Synthesis API — override at least one in concrete providers         */
  /* ------------------------------------------------------------------ */

  /**
   * Non-streaming synthesis: send text, receive an audio reference.
   *
   * @param {object}  opts
   * @param {string}  opts.text           - the text to synthesize
   * @param {string}  [opts.model]        - override model name
   * @param {string}  [opts.voice]        - override voice / speaker id
   * @param {string}  [opts.languageType] - language hint (provider-specific)
   * @param {number}  [opts.timeoutMs=30000]
   * @returns {Promise<{audioUrl?: string, audioBuffer?: Buffer, mimeType?: string, model: string, voice: string}>}
   * @throws {Error}  with code in TTS_INVALID_PARAMS | TTS_CONFIG_MISSING | TTS_TIMEOUT | TTS_PROVIDER_AUTH_FAILED | TTS_PROVIDER_DOWN
   */
  async synthesizeNonStreaming(_opts) {
    throw new Error(`${this.displayName}: synthesizeNonStreaming() is not implemented`);
  }

  /**
   * Streaming synthesis: send text, receive audio chunks via callbacks.
   *
   * @param {object}   opts
   * @param {string}   opts.text       - text to synthesize
   * @param {string}   [opts.model]    - override model
   * @param {string}   [opts.voice]    - override voice / speaker id
   * @param {number}   [opts.timeoutMs=20000]
   * @param {number}   [opts.maxChunks=256]
   * @param {Function} [opts.onEvent]  - callback({ type, timestamp, ...payload })
   *                                    event types: 'start' | 'chunk' | 'done' | 'error' | 'event'
   * @returns {Promise<{ok: boolean, model: string, voice: string, durationMs: number, chunkCount: number, totalAudioBytes: number, truncated: boolean}>}
   * @throws {Error}  with code in TTS_INVALID_PARAMS | TTS_CONFIG_MISSING | TTS_TIMEOUT | TTS_REALTIME_WS_ERROR | TTS_REALTIME_PROVIDER_ERROR
   */
  async streamSynthesis(_opts) {
    throw new Error(`${this.displayName}: streamSynthesis() is not implemented`);
  }

  /* ------------------------------------------------------------------ */
  /*  Optional helpers                                                   */
  /* ------------------------------------------------------------------ */

  /**
   * Fetch an audio buffer from a URL. Useful when the non-streaming API
   * returns a remote audio URL that must be downloaded.
   *
   * @param {object}  opts
   * @param {string}  opts.audioUrl
   * @param {number}  [opts.timeoutMs=30000]
   * @returns {Promise<Buffer>}
   */
  async fetchAudioBuffer({ audioUrl, timeoutMs = 30000 } = {}) {
    if (!this.fetchImpl) {
      const err = new Error('fetchAudioBuffer requires a fetch implementation');
      err.code = 'TTS_AUDIO_FETCH_FAILED';
      throw err;
    }
    const url = String(audioUrl || '').trim();
    if (!url) {
      const err = new Error('audioUrl is required');
      err.code = 'TTS_AUDIO_FETCH_FAILED';
      throw err;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetchImpl(url, { signal: controller.signal });
      if (!response.ok) {
        const err = new Error(`audio fetch http ${response.status}`);
        err.code = 'TTS_AUDIO_FETCH_FAILED';
        throw err;
      }
      const ab = await response.arrayBuffer();
      return Buffer.from(ab);
    } catch (err) {
      if (err?.name === 'AbortError') {
        const timeoutErr = new Error('audio fetch timeout');
        timeoutErr.code = 'TTS_TIMEOUT';
        throw timeoutErr;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = { TtsProviderBase };
