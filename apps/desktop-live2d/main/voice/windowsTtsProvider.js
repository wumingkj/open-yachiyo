/**
 * Windows SAPI (Speech API) TTS Provider
 *
 * Uses the built-in Windows text-to-speech engine via PowerShell.
 * No API key or network connection required — works completely offline.
 *
 * providers.yaml example:
 *   windows_tts:
 *     type: tts_windows
 *     tts_voice: Microsoft Huihui Desktop
 *     # optional — defaults shown
 *     rate: 0        # -10 to 10
 *     volume: 100    # 0 to 100
 *
 * Use listVoices() to discover available voice names on your system.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { TtsProviderBase } = require('./ttsProviderBase');
const { ProviderConfigStore } = require('../../../runtime/config/providerConfigStore');

class WindowsTtsProvider extends TtsProviderBase {
  constructor({ providerKey } = {}) {
    super();
    this.providerStore = new ProviderConfigStore();
    this._providerKey = providerKey || process.env.TTS_PROVIDER_KEY || 'windows_tts';
  }

  get providerType() { return 'tts_windows'; }
  get displayName() { return 'Windows SAPI'; }
  get defaultAudioFormat() { return 'wav'; }
  get requiresApiKey() { return false; }
  get supportsNonStreaming() { return true; }
  get supportsStreaming() { return false; }

  loadProviderConfig() {
    const config = this.providerStore.load();
    const provider = config?.providers?.[this._providerKey];
    const validated = this.validateProviderConfig(provider, this._providerKey);
    return {
      defaultModel: String(validated.tts_model || 'Windows SAPI'),
      defaultVoice: String(validated.tts_voice || ''),
      rate: clamp(Number(validated.rate ?? 0), 0, -10, 10),
      volume: clamp(Number(validated.volume ?? 100), 100, 0, 100),
    };
  }

  async synthesizeNonStreaming({ text, model, voice, timeoutMs = 30000 } = {}) {
    const content = String(text || '').trim();
    if (!content) {
      const err = new Error('text is required');
      err.code = 'TTS_INVALID_PARAMS';
      throw err;
    }

    const cfg = this.loadProviderConfig();
    const finalModel = String(model || cfg.defaultModel);
    const finalVoice = String(voice || cfg.defaultVoice);

    // Create temp output file
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-win-'));
    const outputPath = path.join(tmpDir, `tts_${Date.now()}.wav`);

    // Build PowerShell script
    const voiceSelect = finalVoice
      ? `$synth.SelectVoice('${escapePs(finalVoice)}')`
      : '';
    const psScript = [
      'Add-Type -AssemblyName System.Speech',
      '$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer',
      `$synth.Rate = ${cfg.rate}`,
      `$synth.Volume = ${cfg.volume}`,
      voiceSelect,
      `$synth.SetOutputToWaveFile('${escapePs(outputPath)}')`,
      'try {',
      `  $synth.Speak('${escapePs(content)}')`,
      '} finally {',
      '  $synth.Dispose()',
      '}'
    ].filter(Boolean).join('\n');

    const timeoutSec = Math.max(1, Math.ceil(timeoutMs / 1000));

    try {
      const { stdout, stderr } = await execPowerShell(psScript, timeoutSec);

      // PowerShell might write warnings to stderr even on success
      if (!fs.existsSync(outputPath)) {
        const errMsg = (stderr || stdout || '').trim();
        const err = new Error(`Windows TTS failed to produce audio${errMsg ? ': ' + errMsg : ''}`);
        err.code = 'TTS_PROVIDER_DOWN';
        throw err;
      }

      const audioBuffer = fs.readFileSync(outputPath);
      if (audioBuffer.length === 0) {
        const err = new Error('Windows TTS returned empty audio');
        err.code = 'TTS_PROVIDER_DOWN';
        throw err;
      }

      return { audioBuffer, mimeType: 'audio/wav', model: finalModel, voice: finalVoice };
    } finally {
      // Cleanup temp files
      try { fs.unlinkSync(outputPath); } catch { /* noop */ }
      try { fs.rmdirSync(tmpDir, { recursive: true }); } catch { /* noop */ }
    }
  }

  /**
   * List all installed SAPI voices on this Windows system.
   * Useful for discovering valid tts_voice values for providers.yaml.
   *
   * @returns {Promise<{name: string, culture: string, gender: string, age: string}[]>}
   */
  static async listVoices() {
    const psScript = [
      'Add-Type -AssemblyName System.Speech',
      '(New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices()',
      '| ForEach-Object {',
      '  $v = $_.VoiceInfo',
      '  "$($v.Name)|$($v.Culture.Name)|$($v.Gender)|$($v.Age)"',
      '}'
    ].join('\n');

    const { stdout } = await execPowerShell(psScript, 15);
    return String(stdout || '')
      .trim()
      .split('\n')
      .map(line => {
        const parts = line.trim().split('|');
        const name = parts[0];
        return name ? {
          name,
          culture: parts[1] || '',
          gender: parts[2] || 'Unknown',
          age: parts[3] || 'Unknown'
        } : null;
      })
      .filter(Boolean);
  }
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function execPowerShell(script, timeoutSec) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: timeoutSec * 1000, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          const message = stderr || stdout || err.message || String(err);
          const wrapped = new Error(String(message || '').trim());
          wrapped.raw = err;
          reject(wrapped);
          return;
        }
        resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
      }
    );
  });
}

function clamp(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

/** Escape single quotes for PowerShell single-quoted strings. */
function escapePs(str) {
  return String(str || '').replace(/'/g, "''");
}

module.exports = { WindowsTtsProvider };
