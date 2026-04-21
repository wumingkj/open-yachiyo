/**
 * Edge TTS Provider
 *
 * Uses Microsoft Edge's online text-to-speech service via WebSocket.
 * No API key required — it's a free service using the same backend as
 * Edge browser's "Read Aloud" feature.
 *
 * providers.yaml example:
 *   edge_tts:
 *     type: tts_edge
 *     tts_voice: zh-CN-XiaoxiaoNeural
 *     # optional — defaults shown
 *     rate: "+0%"
 *     pitch: "+0Hz"
 *     volume: "+0%"
 *     output_format: audio-24khz-48kbitrate-mono-mp3
 *
 * Popular voices (partial list):
 *   zh-CN-XiaoxiaoNeural, zh-CN-YunxiNeural, zh-CN-YunjianNeural
 *   zh-TW-HsiaoChenNeural, zh-HK-HiuGaaiNeural
 *   ja-JP-NanamiNeural, en-US-JennyNeural, en-GB-SoniaNeural
 *   ko-YR-SunHiNeural, fr-FR-DeniseNeural, de-DE-KatjaNeural
 */

const { randomUUID } = require('node:crypto');
const { TtsProviderBase } = require('./ttsProviderBase');
const { ProviderConfigStore } = require('../../../runtime/config/providerConfigStore');
const WebSocket = require('ws');

const EDGE_TRUSTED_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const EDGE_WSS_ORIGIN = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';

class EdgeTtsProvider extends TtsProviderBase {
  constructor({ fetchImpl, WebSocketImpl, providerKey } = {}) {
    super({ fetchImpl, WebSocketImpl: WebSocketImpl || WebSocket });
    this.providerStore = new ProviderConfigStore();
    this._providerKey = providerKey || process.env.TTS_PROVIDER_KEY || 'edge_tts';
  }

  get providerType() { return 'tts_edge'; }
  get displayName() { return 'Edge TTS'; }
  get defaultAudioFormat() { return 'mp3'; }
  get requiresApiKey() { return false; }
  get supportsNonStreaming() { return true; }
  get supportsStreaming() { return false; }

  loadProviderConfig() {
    const config = this.providerStore.load();
    const provider = config?.providers?.[this._providerKey];
    const validated = this.validateProviderConfig(provider, this._providerKey);
    return {
      defaultModel: String(validated.tts_model || 'edge-tts'),
      defaultVoice: String(validated.tts_voice || 'zh-CN-XiaoxiaoNeural'),
      rate: String(validated.rate || '+0%'),
      pitch: String(validated.pitch || '+0Hz'),
      volume: String(validated.volume || '+0%'),
      outputFormat: String(validated.output_format || 'audio-24khz-48kbitrate-mono-mp3'),
    };
  }

  async synthesizeNonStreaming({ text, model, voice, languageType, timeoutMs = 30000 } = {}) {
    const content = String(text || '').trim();
    if (!content) {
      const err = new Error('text is required');
      err.code = 'TTS_INVALID_PARAMS';
      throw err;
    }

    const cfg = this.loadProviderConfig();
    const finalModel = String(model || cfg.defaultModel);
    const finalVoice = String(voice || cfg.defaultVoice);

    const requestId = randomUUID();
    const connectionId = randomUUID();
    const wsUrl = `${EDGE_WSS_ORIGIN}?TrustedClientToken=${EDGE_TRUSTED_TOKEN}&ConnectionId=${connectionId}`;

    // Infer xml:lang from voice name (e.g. "zh-CN-XiaoxiaoNeural" → "zh-CN")
    const voiceLang = finalVoice.split('-').slice(0, 2).join('-');

    const ssml = [
      `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${voiceLang}'>`,
      `<voice name='${escapeXmlAttribute(finalVoice)}'>`,
      `<prosody pitch='${escapeXmlAttribute(cfg.pitch)}' rate='${escapeXmlAttribute(cfg.rate)}' volume='${escapeXmlAttribute(cfg.volume)}'>`,
      escapeXml(content),
      `</prosody></voice></speak>`
    ].join('');

    const configMsg = [
      'Content-Type:application/json; charset=utf-8',
      'Path:speech.config',
      '',
      JSON.stringify({
        context: {
          synthesis: {
            audio: {
              metadataoptions: {
                sentenceBoundaryEnabled: 'false',
                wordBoundaryEnabled: 'true'
              },
              outputFormat: cfg.outputFormat
            }
          }
        }
      })
    ].join('\r\n');

    const ssmlMsg = [
      `X-RequestId:${requestId}`,
      'Content-Type:application/ssml+xml',
      'Path:ssml',
      '',
      ssml
    ].join('\r\n');

    return new Promise((resolve, reject) => {
      let settled = false;
      const audioChunks = [];
      const startedAt = Date.now();

      const timer = setTimeout(() => {
        const err = new Error(`Edge TTS timeout after ${timeoutMs}ms`);
        err.code = 'TTS_TIMEOUT';
        finish(err);
      }, Math.max(1, Number(timeoutMs) || 30000));

      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { socket.close(); } catch { /* noop */ }
        if (error) { reject(error); return; }
        resolve(result);
      };

      let socket;
      try {
        socket = new this.WebSocketImpl(wsUrl, {
          headers: {
            'Pragma': 'no-cache',
            'Cache-Control': 'no-cache',
            'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
              + ' (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0'
          }
        });
      } catch (err) {
        clearTimeout(timer);
        reject(err);
        return;
      }

      socket.on('open', () => {
        socket.send(configMsg);
        socket.send(ssmlMsg);
      });

      socket.on('message', (data, isBinary) => {
        if (settled) return;

        if (isBinary) {
          const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
          if (buf.length < 2) return;

          const headerLength = buf.readUInt16LE(0);
          if (headerLength <= 0 || 2 + headerLength > buf.length) return;

          const headerText = buf.slice(2, 2 + headerLength).toString('utf8');
          const audioPayload = buf.slice(2 + headerLength);

          if (headerText.includes('Path:turn.end')) {
            finish(null, buildResult(audioChunks, finalModel, finalVoice, cfg.outputFormat, startedAt));
            return;
          }
          if (headerText.includes('Path:audio') && audioPayload.length > 0) {
            audioChunks.push(audioPayload);
          }
        } else {
          // Text message — check for turn.end
          const txt = String(data || '');
          if (txt.includes('Path:turn.end')) {
            finish(null, buildResult(audioChunks, finalModel, finalVoice, cfg.outputFormat, startedAt));
          }
        }
      });

      socket.on('error', (rawErr) => {
        const err = new Error(rawErr?.message || 'Edge TTS WebSocket error');
        err.code = err.code || 'TTS_REALTIME_WS_ERROR';
        finish(err);
      });

      socket.on('close', (code) => {
        if (settled) return;
        const totalBytes = audioChunks.reduce((sum, c) => sum + c.length, 0);
        if (totalBytes > 0) {
          finish(null, buildResult(audioChunks, finalModel, finalVoice, cfg.outputFormat, startedAt));
          return;
        }
        const err = new Error(`Edge TTS WebSocket closed unexpectedly (code=${code})`);
        err.code = 'TTS_REALTIME_CLOSED';
        finish(err);
      });
    });
  }
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function buildResult(audioChunks, model, voice, outputFormat, startedAt) {
  const totalBytes = audioChunks.reduce((sum, c) => sum + c.length, 0);
  if (totalBytes === 0) {
    const err = new Error('Edge TTS returned no audio data');
    err.code = 'TTS_PROVIDER_DOWN';
    throw err;
  }
  return {
    audioBuffer: Buffer.concat(audioChunks),
    mimeType: outputFormat.includes('ogg') ? 'audio/ogg' : 'audio/mpeg',
    model,
    voice,
    durationMs: Date.now() - startedAt,
    totalAudioBytes: totalBytes
  };
}

function escapeXml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeXmlAttribute(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

module.exports = { EdgeTtsProvider };
