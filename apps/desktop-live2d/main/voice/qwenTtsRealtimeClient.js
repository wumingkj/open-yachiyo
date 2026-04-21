const { randomUUID } = require('node:crypto');
const { TtsProviderBase } = require('./ttsProviderBase');
const { ProviderConfigStore } = require('../../../runtime/config/providerConfigStore');

const DEFAULT_TTS_PROVIDER_KEY = 'qwen3_tts';
const DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/api/v1';
const DEFAULT_REALTIME_MODEL = 'qwen-tts-realtime';
const WebSocket = require('ws');

class QwenTtsRealtimeClient extends TtsProviderBase {
  /**
   * @param {object} [opts]
   * @param {Function} [opts.WebSocketImpl] - WebSocket constructor (default: 'ws')
   * @param {string}  [opts.providerKey]    - provider key in providers.yaml
   */
  constructor({ WebSocketImpl, providerKey } = {}) {
    super({ WebSocketImpl: WebSocketImpl || WebSocket });
    this.providerStore = new ProviderConfigStore();
    this._providerKey = providerKey || process.env.TTS_PROVIDER_KEY || DEFAULT_TTS_PROVIDER_KEY;
  }

  get providerType() { return 'tts_dashscope'; }
  get displayName() { return 'DashScope TTS (realtime streaming)'; }
  get defaultAudioFormat() { return 'pcm'; }
  get defaultSampleRate() { return 24000; }
  get supportsNonStreaming() { return false; }
  get supportsStreaming() { return true; }

  loadProviderConfig() {
    const config = this.providerStore.load();
    const provider = config?.providers?.[this._providerKey];
    const validated = this.validateProviderConfig(provider, this._providerKey);

    const wsBaseUrl = String(
      validated.realtime_ws_url
      || process.env.DASHSCOPE_REALTIME_WS_URL
      || deriveRealtimeWsBaseUrl(validated.base_url)
    ).trim();

    const defaultRealtimeModel = String(
      validated.tts_realtime_model || validated.realtime_model || DEFAULT_REALTIME_MODEL
    );
    const defaultVoice = String(
      validated.tts_realtime_voice || validated.realtime_voice || validated.tts_voice || ''
    );

    return {
      apiKey: validated._resolvedApiKey,
      wsBaseUrl,
      defaultRealtimeModel,
      defaultVoice
    };
  }

  async streamSynthesis({
    text,
    model,
    voice,
    timeoutMs = 20000,
    maxChunks = 256,
    onEvent = null
  } = {}) {
    const content = String(text || '').trim();
    if (!content) {
      const err = new Error('text is required');
      err.code = 'TTS_INVALID_PARAMS';
      throw err;
    }

    const cfg = this.loadProviderConfig();
    const finalModel = String(model || cfg.defaultRealtimeModel);
    const finalVoice = String(voice || cfg.defaultVoice);
    if (!finalVoice) {
      const err = new Error('realtime tts voice is required');
      err.code = 'TTS_CONFIG_MISSING';
      throw err;
    }
    const wsUrl = buildRealtimeWsUrl({
      wsBaseUrl: cfg.wsBaseUrl,
      model: finalModel
    });

    const emitEvent = (type, payload = {}) => {
      if (typeof onEvent !== 'function') return;
      try {
        onEvent({
          type,
          timestamp: Date.now(),
          ...payload
        });
      } catch {
        // ignore onEvent callback failures
      }
    };

    return new Promise((resolve, reject) => {
      let settled = false;
      let completed = false;
      let chunkCount = 0;
      let totalAudioBytes = 0;
      const startedAt = Date.now();

      const socket = new this.WebSocketImpl(wsUrl, {
        headers: {
          Authorization: `Bearer ${cfg.apiKey}`
        }
      });

      const timer = setTimeout(() => {
        const err = new Error(`realtime tts timeout after ${timeoutMs}ms`);
        err.code = 'TTS_TIMEOUT';
        finish(err);
      }, Math.max(1, Number(timeoutMs) || 20000));

      const finish = (error, result = null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          socket.close();
        } catch {
          // ignore close errors
        }
        if (error) {
          reject(error);
          return;
        }
        resolve(result);
      };

      socket.on('open', () => {
        emitEvent('start', {
          model: finalModel,
          voice: finalVoice
        });

        const sessionUpdateMessage = {
          event_id: `event_${randomUUID()}`,
          type: 'session.update',
          session: {
            voice: finalVoice,
            format: 'pcm',
            sample_rate: 24000
          }
        };
        const appendTextMessage = {
          event_id: `event_${randomUUID()}`,
          type: 'input_text_buffer.append',
          text: content
        };
        const commitTextMessage = {
          event_id: `event_${randomUUID()}`,
          type: 'input_text_buffer.commit'
        };

        socket.send(JSON.stringify(sessionUpdateMessage));
        socket.send(JSON.stringify(appendTextMessage));
        socket.send(JSON.stringify(commitTextMessage));
      });

      socket.on('message', (raw) => {
        if (settled) return;
        const payload = parseWsMessage(raw);
        if (!payload) {
          emitEvent('event.invalid_json', {});
          return;
        }

        const type = String(payload.type || '').trim();
        if (type === 'error') {
          const err = new Error(payload?.error?.message || payload?.message || 'realtime tts provider error');
          err.code = 'TTS_REALTIME_PROVIDER_ERROR';
          emitEvent('error', {
            code: err.code,
            error: err.message
          });
          finish(err);
          return;
        }

        if (type === 'response.audio.delta') {
          const audioBase64 = String(payload.delta || payload.audio?.delta || '');
          const bytes = estimateBase64Bytes(audioBase64);
          totalAudioBytes += bytes;
          chunkCount += 1;
          emitEvent('chunk', {
            chunk_index: chunkCount,
            audio_bytes: bytes,
            total_audio_bytes: totalAudioBytes,
            audio_base64: audioBase64
          });
          if (chunkCount >= maxChunks) {
            const result = {
              ok: true,
              model: finalModel,
              voice: finalVoice,
              durationMs: Date.now() - startedAt,
              chunkCount,
              totalAudioBytes,
              truncated: true
            };
            emitEvent('done', result);
            finish(null, result);
          }
          return;
        }

        if (type === 'response.audio.done' || type === 'response.done' || type === 'response.completed' || type === 'session.finished') {
          if (completed) {
            return;
          }
          completed = true;
          const result = {
            ok: true,
            model: finalModel,
            voice: finalVoice,
            durationMs: Date.now() - startedAt,
            chunkCount,
            totalAudioBytes,
            truncated: false
          };
          emitEvent('done', result);
          finish(null, result);
          return;
        }

        emitEvent('event', {
          event_type: type || 'unknown'
        });
      });

      socket.on('error', (rawErr) => {
        const err = new Error(rawErr?.message || String(rawErr || 'realtime tts ws error'));
        err.code = err.code || 'TTS_REALTIME_WS_ERROR';
        emitEvent('error', {
          code: err.code,
          error: err.message
        });
        finish(err);
      });

      socket.on('close', (code, reason) => {
        if (settled) return;
        const hasData = chunkCount > 0 || totalAudioBytes > 0;
        if (hasData) {
          const result = {
            ok: true,
            model: finalModel,
            voice: finalVoice,
            durationMs: Date.now() - startedAt,
            chunkCount,
            totalAudioBytes,
            truncated: false,
            closed: true
          };
          emitEvent('done', result);
          finish(null, result);
          return;
        }
        const err = new Error(`realtime tts ws closed before completion (code=${code}, reason=${String(reason || '')})`);
        err.code = 'TTS_REALTIME_CLOSED';
        emitEvent('error', {
          code: err.code,
          error: err.message
        });
        finish(err);
      });
    });
  }
}

/* ------------------------------------------------------------------ */
/*  DashScope-specific helpers (kept private)                          */
/* ------------------------------------------------------------------ */

function deriveRealtimeWsBaseUrl(httpBaseUrl) {
  const base = String(httpBaseUrl || '').trim().replace(/\/$/, '') || DEFAULT_BASE_URL;
  try {
    const parsed = new URL(base);
    const host = parsed.hostname;
    if (host === 'dashscope.aliyuncs.com') {
      return 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime';
    }
    if (host === 'dashscope-intl.aliyuncs.com') {
      return 'wss://dashscope-intl.aliyuncs.com/api-ws/v1/realtime';
    }
    parsed.protocol = parsed.protocol === 'http:' ? 'ws:' : 'wss:';
    parsed.pathname = '/api-ws/v1/realtime';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  } catch (_) {
    return 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime';
  }
}

function buildRealtimeWsUrl({ wsBaseUrl, model }) {
  const base = String(wsBaseUrl || '').trim();
  const finalModel = String(model || '').trim() || DEFAULT_REALTIME_MODEL;
  const parsed = new URL(base);
  parsed.searchParams.set('model', finalModel);
  return parsed.toString();
}

function parseWsMessage(raw) {
  try {
    return JSON.parse(String(raw || ''));
  } catch {
    return null;
  }
}

function estimateBase64Bytes(data) {
  const payload = String(data || '').trim();
  if (!payload) return 0;
  try {
    return Buffer.from(payload, 'base64').byteLength;
  } catch {
    return 0;
  }
}

module.exports = {
  QwenTtsRealtimeClient,
  __internal: {
    deriveRealtimeWsBaseUrl,
    buildRealtimeWsUrl,
    estimateBase64Bytes
  }
};
