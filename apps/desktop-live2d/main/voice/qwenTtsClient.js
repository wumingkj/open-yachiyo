const { TtsProviderBase } = require('./ttsProviderBase');
const { ProviderConfigStore } = require('../../../runtime/config/providerConfigStore');

const DEFAULT_TTS_PROVIDER_KEY = 'qwen3_tts';
const DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/api/v1';
const DEFAULT_MODEL = 'qwen3-tts-vc-2026-01-22';

class QwenTtsClient extends TtsProviderBase {
  /**
   * @param {object} [opts]
   * @param {Function} [opts.fetchImpl] - fetch implementation
   * @param {string}  [opts.providerKey] - provider key in providers.yaml (default: 'qwen3_tts')
   */
  constructor({ fetchImpl, providerKey } = {}) {
    super({ fetchImpl });
    this.providerStore = new ProviderConfigStore();
    this._providerKey = providerKey || process.env.TTS_PROVIDER_KEY || DEFAULT_TTS_PROVIDER_KEY;
  }

  get providerType() { return 'tts_dashscope'; }
  get displayName() { return 'DashScope TTS (non-streaming)'; }
  get defaultAudioFormat() { return 'ogg'; }
  get supportsNonStreaming() { return true; }
  get supportsStreaming() { return false; }

  loadProviderConfig() {
    const config = this.providerStore.load();
    const provider = config?.providers?.[this._providerKey];
    const validated = this.validateProviderConfig(provider, this._providerKey);

    return {
      apiKey: validated._resolvedApiKey,
      baseUrl: this.normalizeBaseUrl(validated.base_url, DEFAULT_BASE_URL),
      defaultModel: String(validated.tts_model || DEFAULT_MODEL),
      defaultVoice: String(validated.tts_voice || ''),
      provider: validated
    };
  }

  async synthesizeNonStreaming({ text, model, voice, languageType = 'Chinese', timeoutMs = 30000 } = {}) {
    const content = String(text || '').trim();
    if (!content) {
      const err = new Error('text is required');
      err.code = 'TTS_INVALID_PARAMS';
      throw err;
    }

    const cfg = this.loadProviderConfig();
    const finalModel = String(model || cfg.defaultModel);
    const finalVoice = String(voice || cfg.defaultVoice);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const endpoint = `${cfg.baseUrl}/services/aigc/multimodal-generation/generation`;
      const response = await this.fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${cfg.apiKey}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: finalModel,
          input: {
            text: content,
            voice: finalVoice,
            language_type: languageType
          }
        }),
        signal: controller.signal
      });

      const bodyText = await response.text();
      let body = null;
      try {
        body = JSON.parse(bodyText);
      } catch (_) {
        body = null;
      }

      if (!response.ok) {
        const err = new Error(`tts provider http ${response.status}`);
        err.code = response.status === 401 || response.status === 403 ? 'TTS_PROVIDER_AUTH_FAILED' : 'TTS_PROVIDER_DOWN';
        err.meta = { status: response.status, body: body || bodyText };
        throw err;
      }

      const audioUrl = body?.output?.audio?.url || body?.output?.audio_url || '';
      if (!audioUrl) {
        const err = new Error('tts response missing audio url');
        err.code = 'TTS_PROVIDER_DOWN';
        err.meta = { body };
        throw err;
      }

      return {
        audioUrl,
        model: finalModel,
        voice: finalVoice,
        mimeType: inferMimeTypeFromUrl(audioUrl)
      };
    } catch (err) {
      if (err?.name === 'AbortError') {
        const timeoutErr = new Error('tts timeout');
        timeoutErr.code = 'TTS_TIMEOUT';
        throw timeoutErr;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

function inferMimeTypeFromUrl(url) {
  const lower = String(url || '').toLowerCase();
  if (lower.includes('.mp3')) return 'audio/mpeg';
  if (lower.includes('.wav')) return 'audio/wav';
  if (lower.includes('.ogg')) return 'audio/ogg';
  return 'audio/ogg';
}

module.exports = { QwenTtsClient };
