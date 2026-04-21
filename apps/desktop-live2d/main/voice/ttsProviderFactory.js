/**
 * TtsProviderFactory — creates the correct TTS provider instances based on
 * providers.yaml configuration.
 *
 * Built-in providers are registered automatically; third-party providers
 * can register themselves via `TtsProviderFactory.register()`.
 *
 * Usage:
 *   const { TtsProviderFactory } = require('./ttsProviderFactory');
 *
 *   // Create providers from config
 *   const client    = TtsProviderFactory.createNonStreaming({ providerKey: 'my_tts' });
 *   const realtime  = TtsProviderFactory.createStreaming({ providerKey: 'my_tts' });
 *
 *   // Register a custom provider
 *   const { MyTtsProvider } = require('./myTtsProvider');
 *   TtsProviderFactory.register('tts_my_backend', {
 *     nonStreaming: (opts) => new MyTtsProvider(opts),
 *     streaming:    (opts) => new MyTtsProvider(opts)  // same class handles both
 *   });
 */

const { QwenTtsClient } = require('./qwenTtsClient');
const { QwenTtsRealtimeClient } = require('./qwenTtsRealtimeClient');
const { GptSovitsTtsProvider } = require('./gptSovitsTtsProvider');
const { EdgeTtsProvider } = require('./edgeTtsProvider');
const { WindowsTtsProvider } = require('./windowsTtsProvider');

/**
 * Registry: providerType → { nonStreaming?, streaming? }
 * Each value is a factory function: (opts) => TtsProviderBase instance
 * @type {Map<string, { nonStreaming?: Function, streaming?: Function }>}
 */
const _registry = new Map();

// ---------------------------------------------------------------------------
//  Built-in registrations
// ---------------------------------------------------------------------------

_registry.set('tts_dashscope', {
  nonStreaming: (opts = {}) => new QwenTtsClient(opts),
  streaming: (opts = {}) => new QwenTtsRealtimeClient(opts)
});

_registry.set('tts_gpt_sovits', {
  nonStreaming: (opts = {}) => new GptSovitsTtsProvider(opts)
});

_registry.set('tts_edge', {
  nonStreaming: (opts = {}) => new EdgeTtsProvider(opts)
});

_registry.set('tts_windows', {
  nonStreaming: (opts = {}) => new WindowsTtsProvider(opts)
});

// ---------------------------------------------------------------------------
//  Public API
// ---------------------------------------------------------------------------

class TtsProviderFactory {
  /**
   * Register a provider type.
   *
   * @param {string} providerType  - must match provider.type in providers.yaml
   * @param {{ nonStreaming?: Function, streaming?: Function }} factories
   *   Each factory receives { fetchImpl?, WebSocketImpl?, providerKey? }.
   */
  static register(providerType, factories) {
    if (typeof providerType !== 'string' || !providerType.trim()) {
      throw new Error('providerType must be a non-empty string');
    }
    const entry = _registry.get(providerType) || {};
    if (factories.nonStreaming) entry.nonStreaming = factories.nonStreaming;
    if (factories.streaming) entry.streaming = factories.streaming;
    _registry.set(providerType, entry);
  }

  /**
   * Unregister a provider type.
   */
  static unregister(providerType) {
    _registry.delete(providerType);
  }

  /**
   * List all registered provider types.
   * @returns {string[]}
   */
  static getRegisteredTypes() {
    return [..._registry.keys()];
  }

  /**
   * Check if a provider type is registered.
   * @param {string} providerType
   * @returns {boolean}
   */
  static isRegistered(providerType) {
    return _registry.has(providerType);
  }

  /**
   * Resolve provider type from providers.yaml by provider key.
   *
   * @param {object}  opts
   * @param {string}  [opts.providerKey] - key in providers map (default: TTS_PROVIDER_KEY env or 'qwen3_tts')
   * @param {string}  [opts.configPath]  - optional override for providers.yaml path
   * @returns {{ type: string, provider: object, providerKey: string }}
   */
  static resolveProviderConfig({ providerKey, configPath } = {}) {
    const { ProviderConfigStore } = require('../../../runtime/config/providerConfigStore');
    const store = new ProviderConfigStore({ configPath });
    const config = store.load();
    // Priority: explicit providerKey > config.active_tts_provider > TTS_PROVIDER_KEY env > 'qwen3_tts'
    const key = providerKey || config.active_tts_provider || process.env.TTS_PROVIDER_KEY || 'qwen3_tts';
    const provider = config?.providers?.[key];

    if (!provider || typeof provider !== 'object') {
      const err = new Error(`tts provider '${key}' not found in providers.yaml`);
      err.code = 'TTS_CONFIG_MISSING';
      throw err;
    }

    return { type: provider.type, provider, providerKey: key };
  }

  /**
   * Create a non-streaming TTS provider for the given config key.
   *
   * @param {object}  opts
   * @param {string}  [opts.providerKey]   - key in providers.yaml
   * @param {Function} [opts.fetchImpl]    - fetch implementation (Electron / Node)
   * @param {string}  [opts.configPath]    - optional providers.yaml path override
   * @returns {import('./ttsProviderBase').TtsProviderBase}
   */
  static createNonStreaming({ providerKey, fetchImpl, configPath } = {}) {
    const { type, provider, providerKey: key } = TtsProviderFactory.resolveProviderConfig({
      providerKey, configPath
    });
    const entry = _registry.get(type);
    if (!entry || !entry.nonStreaming) {
      const supported = TtsProviderFactory.getRegisteredTypes().join(', ');
      const err = new Error(
        `no non-streaming TTS provider registered for type '${type}' (registered: ${supported})`
      );
      err.code = 'TTS_CONFIG_MISSING';
      throw err;
    }
    return entry.nonStreaming({ fetchImpl, providerKey: key });
  }

  /**
   * Create a streaming TTS provider for the given config key.
   *
   * @param {object}  opts
   * @param {string}  [opts.providerKey]     - key in providers.yaml
   * @param {Function} [opts.WebSocketImpl]  - WebSocket constructor (Electron / Node)
   * @param {string}  [opts.configPath]      - optional providers.yaml path override
   * @returns {import('./ttsProviderBase').TtsProviderBase}
   */
  static createStreaming({ providerKey, WebSocketImpl, configPath } = {}) {
    const { type, provider, providerKey: key } = TtsProviderFactory.resolveProviderConfig({
      providerKey, configPath
    });
    const entry = _registry.get(type);
    if (!entry || !entry.streaming) {
      const supported = TtsProviderFactory.getRegisteredTypes().join(', ');
      const err = new Error(
        `no streaming TTS provider registered for type '${type}' (registered: ${supported})`
      );
      err.code = 'TTS_CONFIG_MISSING';
      throw err;
    }
    return entry.streaming({ WebSocketImpl, providerKey: key });
  }
}

module.exports = { TtsProviderFactory };
