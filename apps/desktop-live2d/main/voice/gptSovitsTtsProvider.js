/**
 * GPT-SoVITS TTS Provider
 *
 * Connects to a self-hosted GPT-SoVITS API server via HTTP.
 * Supports the standard /tts endpoint returning raw audio binary,
 * as well as JSON responses containing base64 audio or audio URLs.
 *
 * providers.yaml example:
 *   gpt_sovits:
 *     type: tts_gpt_sovits
 *     base_url: http://127.0.0.1:9880
 *     tts_voice: default
 *     tts_language: zh
 *     # optional — defaults shown
 *     endpoint: /tts
 *     speed: 1.0
 *     top_k: 5
 *     top_p: 1.0
 *     temperature: 1.0
 *     ref_audio_path: ""
 *     prompt_text: ""
 *     prompt_language: zh
 *     api_key_env: GPT_SOVITS_API_KEY   # optional, not all deployments require auth
 */

const { TtsProviderBase } = require('./ttsProviderBase');
const { ProviderConfigStore } = require('../../../runtime/config/providerConfigStore');

class GptSovitsTtsProvider extends TtsProviderBase {
  constructor({ fetchImpl, providerKey } = {}) {
    super({ fetchImpl });
    this.providerStore = new ProviderConfigStore();
    this._providerKey = providerKey || process.env.TTS_PROVIDER_KEY || 'gpt_sovits';
  }

  get providerType() { return 'tts_gpt_sovits'; }
  get displayName() { return 'GPT-SoVITS'; }
  get defaultAudioFormat() { return 'mp3'; }
  get supportsNonStreaming() { return true; }
  get supportsStreaming() { return false; }
  get requiresApiKey() { return false; }

  loadProviderConfig() {
    const config = this.providerStore.load();
    const provider = config?.providers?.[this._providerKey];
    const validated = this.validateProviderConfig(provider, this._providerKey);
    return {
      apiKey: validated._resolvedApiKey,
      baseUrl: this.normalizeBaseUrl(validated.base_url, 'http://127.0.0.1:9880'),
      defaultModel: String(validated.tts_model || 'GPT-SoVITS'),
      defaultVoice: String(validated.tts_voice || ''),
      defaultLanguage: String(validated.tts_language || 'zh'),
      speed: Number(validated.speed ?? 1.0),
      endpoint: String(validated.endpoint || '/tts'),
      refAudioPath: String(validated.ref_audio_path || ''),
      promptText: String(validated.prompt_text || ''),
      promptLanguage: String(validated.prompt_language || 'zh'),
      topK: Number(validated.top_k ?? 5),
      topP: Number(validated.top_p ?? 1.0),
      temperature: Number(validated.temperature ?? 1.0),
    };
  }

  async synthesizeNonStreaming({ text, model, voice, languageType, timeoutMs = 60000 } = {}) {
    const content = String(text || '').trim();
    if (!content) {
      const err = new Error('text is required');
      err.code = 'TTS_INVALID_PARAMS';
      throw err;
    }

    const cfg = this.loadProviderConfig();
    const finalModel = String(model || cfg.defaultModel);
    const finalVoice = String(voice || cfg.defaultVoice);

    // Map language type to GPT-SoVITS language code
    const langMap = {
      'Chinese': 'zh', 'Japanese': 'ja', 'English': 'en', 'Auto': 'auto',
      'zh': 'zh', 'jp': 'ja', 'en': 'en', 'auto': 'auto',
      'yue': 'yue', 'ko': 'ko'
    };
    const textLang = langMap[languageType] || langMap[cfg.defaultLanguage] || 'zh';

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const endpoint = `${cfg.baseUrl}${cfg.endpoint}`;
      const headers = { 'Content-Type': 'application/json' };
      if (cfg.apiKey) {
        headers['Authorization'] = `Bearer ${cfg.apiKey}`;
      }

      // Build request body — GPT-SoVITS standard API format
      const body = {
        text: content,
        text_lang: textLang,
        speed: cfg.speed,
        top_k: cfg.topK,
        top_p: cfg.topP,
        temperature: cfg.temperature,
        text_split_method: 'cut5',
      };

      // Determine reference audio / speaker source
      const refPath = cfg.refAudioPath;
      const promptText = cfg.promptText;
      const promptLang = cfg.promptLanguage;

      // Normalize prompt_lang to GPT-SoVITS v2 accepted values
      const promptLangMap = { 'zh': 'zh', 'cn': 'zh', 'chinese': 'zh', 'ja': 'ja', 'jp': 'ja', 'japanese': 'ja', 'en': 'en', 'english': 'en', 'auto': 'auto', 'yue': 'yue', 'ko': 'ko' };
      const normalizedPromptLang = promptLangMap[String(promptLang).toLowerCase().trim()] || 'auto';

      // If voice looks like a file path, use it as ref_audio_path
      if (finalVoice && (finalVoice.includes('/') || finalVoice.includes('\\'))) {
        body.ref_audio_path = finalVoice;
        if (promptText) body.prompt_text = promptText;
        body.prompt_lang = normalizedPromptLang;
      } else {
        // voice is a speaker name or ref config comes from yaml
        if (refPath) body.ref_audio_path = refPath;
        if (promptText) body.prompt_text = promptText;
        body.prompt_lang = normalizedPromptLang;
        // GPT-SoVITS v2+ uses 'speaker' field for named speakers
        if (finalVoice) body.speaker = finalVoice;
      }

      console.log('[gpt-sovits] request body:', JSON.stringify(body));

      const response = await this.fetchImpl(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        let detail = '';
        try {
          const ct = response.headers.get('content-type') || '';
          if (ct.includes('application/json')) {
            detail = JSON.stringify(await response.json());
          } else {
            detail = await response.text();
          }
        } catch (_) { /* ignore read error */ }
        console.error(`[gpt-sovits] HTTP ${response.status} response: ${detail}`);
        const err = new Error(`GPT-SoVITS HTTP ${response.status}: ${detail}`);
        err.code = response.status === 401 || response.status === 403
          ? 'TTS_PROVIDER_AUTH_FAILED' : 'TTS_PROVIDER_DOWN';
        err.meta = { status: response.status, detail };
        throw err;
      }

      const contentType = String(response.headers.get('content-type') || '');

      // JSON response — may contain base64 audio or audio URL
      if (contentType.includes('application/json')) {
        const json = await response.json();
        if (json.audio) {
          const audioBuffer = Buffer.from(json.audio, 'base64');
          return { audioBuffer, mimeType: 'audio/mpeg', model: finalModel, voice: finalVoice };
        }
        if (json.audio_url || json.url) {
          const audioUrl = json.audio_url || json.url;
          return { audioUrl, mimeType: 'audio/mpeg', model: finalModel, voice: finalVoice };
        }
        const err = new Error('GPT-SoVITS JSON response missing audio data');
        err.code = 'TTS_PROVIDER_DOWN';
        err.meta = { body: json };
        throw err;
      }

      // Binary response — raw audio bytes
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = Buffer.from(arrayBuffer);

      if (audioBuffer.length === 0) {
        const err = new Error('GPT-SoVITS returned empty audio');
        err.code = 'TTS_PROVIDER_DOWN';
        throw err;
      }

      // Detect MIME from content-type or default to mp3
      let mimeType = 'audio/mpeg';
      if (contentType.includes('wav')) mimeType = 'audio/wav';
      else if (contentType.includes('ogg')) mimeType = 'audio/ogg';
      else if (contentType.includes('flac')) mimeType = 'audio/flac';

      return { audioBuffer, mimeType, model: finalModel, voice: finalVoice };
    } catch (err) {
      if (err?.name === 'AbortError') {
        const timeoutErr = new Error('GPT-SoVITS TTS timeout');
        timeoutErr.code = 'TTS_TIMEOUT';
        throw timeoutErr;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = { GptSovitsTtsProvider };
