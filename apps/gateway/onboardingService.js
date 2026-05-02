const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const YAML = require('yaml');
const {
  parseJsonWithComments,
  serializeDesktopLive2dUiConfig
} = require('../desktop-live2d/main/config');

const { getRuntimePaths } = require('../runtime/skills/runtimePaths');
const { OnboardingError } = require('./voiceCloneService');

const ONBOARDING_STATE_VERSION = 1;
const DEFAULT_LLM_PROVIDER_TYPE = 'openai_compatible';
const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_LLM_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const DEFAULT_TTS_BASE_URL = 'https://dashscope.aliyuncs.com/api/v1';
const DEFAULT_NORMAL_MODEL = 'qwen3-tts-vc-2026-01-22';
const DEFAULT_REALTIME_MODEL = 'qwen3-tts-vc-realtime-2026-01-15';

/* TTS provider default voice_output_language mapping */
const TTS_DEFAULT_VOICE_LANG = {
  tts_dashscope: 'jp',
  tts_gpt_sovits: 'jp',
  tts_edge: 'jp',
  tts_windows: 'zh'
};

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (value === undefined || value === null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') return false;
  return fallback;
}

function parsePositiveNumber(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function getOnboardingStatePath() {
  return path.join(getRuntimePaths().dataDir, 'onboarding-state.json');
}

async function readOnboardingState() {
  const statePath = getOnboardingStatePath();
  if (!fs.existsSync(statePath)) {
    return {
      done: false,
      skipped: false,
      version: ONBOARDING_STATE_VERSION,
      completed_at: null,
      last_step: 'provider'
    };
  }
  try {
    const raw = await fsp.readFile(statePath, 'utf8');
    const parsed = JSON.parse(raw || '{}');
    return {
      done: Boolean(parsed.done),
      skipped: Boolean(parsed.skipped),
      version: Number(parsed.version) || ONBOARDING_STATE_VERSION,
      completed_at: parsed.completed_at || null,
      last_step: String(parsed.last_step || 'provider')
    };
  } catch {
    return {
      done: false,
      skipped: false,
      version: ONBOARDING_STATE_VERSION,
      completed_at: null,
      last_step: 'provider'
    };
  }
}

async function writeOnboardingState(nextState) {
  const statePath = getOnboardingStatePath();
  await fsp.mkdir(path.dirname(statePath), { recursive: true });
  await fsp.writeFile(statePath, JSON.stringify(nextState, null, 2), 'utf8');
  return nextState;
}

async function markOnboardingStep(step) {
  const prev = await readOnboardingState();
  const next = {
    ...prev,
    version: ONBOARDING_STATE_VERSION,
    done: false,
    skipped: false,
    completed_at: null,
    last_step: String(step || prev.last_step || 'provider')
  };
  return writeOnboardingState(next);
}

async function markOnboardingCompleted(options = {}) {
  const skipped = parseBoolean(options.skipped, false);
  const prev = await readOnboardingState();
  const next = {
    ...prev,
    version: ONBOARDING_STATE_VERSION,
    done: true,
    skipped,
    completed_at: new Date().toISOString(),
    last_step: 'complete'
  };
  return writeOnboardingState(next);
}

/* ================================================================== */
/*  LLM Provider                                                      */
/* ================================================================== */

function buildLlmProviderPayload(providerInput = {}, providerType) {
  const type = String(providerType || DEFAULT_LLM_PROVIDER_TYPE).trim();
  const key = String(providerInput.key || providerInput.provider_key || 'qwen35_plus').trim();
  if (!key) {
    throw new OnboardingError('ONBOARDING_CONFIG_SAVE_FAILED', 'provider key is required');
  }

  // Ollama / qwen35 type — no API key required, but use openai_compatible type
  // since Ollama exposes an OpenAI-compatible HTTP API
  if (type === 'qwen35') {
    return {
      key,
      config: {
        type: 'openai_compatible',
        display_name: String(providerInput.display_name || key).trim() || key,
        base_url: String(providerInput.base_url || 'http://localhost:11434/v1').trim(),
        model: String(providerInput.model || 'qwen2.5:7b').trim(),
        timeout_ms: Math.round(parsePositiveNumber(providerInput.timeout_ms, DEFAULT_TIMEOUT_MS)),
        api_key_env: String(providerInput.api_key_env || 'ollama').trim()
      }
    };
  }

  // OpenAI compatible
  const apiKey = String(providerInput.api_key || '').trim();
  const apiKeyEnv = String(providerInput.api_key_env || '').trim();
  if (!apiKey && !apiKeyEnv) {
    throw new OnboardingError('ONBOARDING_CONFIG_SAVE_FAILED', 'api_key or api_key_env is required');
  }
  return {
    key,
    config: {
      type: 'openai_compatible',
      display_name: String(providerInput.display_name || key).trim() || key,
      base_url: String(providerInput.base_url || DEFAULT_LLM_BASE_URL).trim() || DEFAULT_LLM_BASE_URL,
      model: String(providerInput.model || 'qwen3.5-plus').trim() || 'qwen3.5-plus',
      timeout_ms: Math.round(parsePositiveNumber(providerInput.timeout_ms, DEFAULT_TIMEOUT_MS)),
      ...(apiKey ? { api_key: apiKey } : {}),
      ...(apiKeyEnv ? { api_key_env: apiKeyEnv } : {})
    }
  };
}

function saveLlmProvider({ providerStore, providerInput, activeProvider, providerType }) {
  const payload = buildLlmProviderPayload(providerInput, providerType);
  const current = providerStore.load();
  const next = {
    ...current,
    providers: {
      ...(current.providers || {}),
      [payload.key]: payload.config
    },
    active_provider: String(activeProvider || payload.key).trim() || payload.key
  };
  providerStore.save(next);
  return providerStore.load();
}

/* ================================================================== */
/*  TTS Provider — generic save                                       */
/* ================================================================== */

/**
 * Save any TTS provider config to providers.yaml and set active_tts_provider.
 *
 * @param {object} opts
 * @param {object} opts.providerStore
 * @param {string} opts.ttsType — tts_dashscope | tts_gpt_sovits | tts_edge | tts_windows
 * @param {string} opts.providerKey — key in providers map
 * @param {object} opts.input — provider-specific fields (see switch below)
 * @returns {object} the updated providers config
 */
function saveTtsProvider({ providerStore, ttsType, providerKey, input = {} }) {
  if (!providerKey) {
    throw new OnboardingError('ONBOARDING_CONFIG_SAVE_FAILED', 'provider_key is required');
  }

  const current = providerStore.load();
  const providers = { ...(current.providers || {}) };
  const voiceLang = TTS_DEFAULT_VOICE_LANG[ttsType] || 'zh';

  switch (ttsType) {
    case 'tts_dashscope': {
      const existing = isPlainObject(providers[providerKey]) ? providers[providerKey] : {};
      const apiKey = String(input.api_key || '').trim();
      const apiKeyEnv = String(input.api_key_env || '').trim();
      if (!apiKey && !apiKeyEnv) {
        throw new OnboardingError('ONBOARDING_CONFIG_SAVE_FAILED', 'api_key or api_key_env is required');
      }

      const targetMode = String(input.target_mode || 'normal').trim().toLowerCase();
      const voiceId = String(input.voice_id || '').trim();

      const config = {
        type: 'tts_dashscope',
        display_name: String(existing.display_name || 'Qwen3 TTS VC'),
        base_url: String(input.base_url || existing.base_url || DEFAULT_TTS_BASE_URL).trim(),
        timeout_ms: Math.round(parsePositiveNumber(existing.timeout_ms, 60000)),
        tts_model: targetMode === 'realtime' ? DEFAULT_REALTIME_MODEL : DEFAULT_NORMAL_MODEL,
        tts_voice: voiceId || String(existing.tts_voice || '').trim(),
        voice_output_language: voiceLang
      };

      if (targetMode === 'realtime') {
        config.tts_realtime_model = DEFAULT_REALTIME_MODEL;
        config.tts_realtime_voice = voiceId || String(existing.tts_realtime_voice || '').trim();
      }

      if (apiKey) { config.api_key = apiKey; delete config.api_key_env; }
      else { config.api_key_env = apiKeyEnv; delete config.api_key; }

      if (!config.tts_voice) {
        throw new OnboardingError('ONBOARDING_CONFIG_SAVE_FAILED', 'tts_voice (voice_id) is required');
      }

      providers[providerKey] = config;
      break;
    }

    case 'tts_gpt_sovits': {
      providers[providerKey] = {
        type: 'tts_gpt_sovits',
        base_url: String(input.base_url || 'http://127.0.0.1:9880').trim(),
        tts_voice: String(input.tts_voice || 'default').trim(),
        tts_language: 'auto',
        voice_output_language: voiceLang,
        timeout_sec: Math.round(parsePositiveNumber(input.timeout_sec, 120)),
        ...(input.ref_audio_path ? { ref_audio_path: String(input.ref_audio_path).trim() } : {})
      };
      break;
    }

    case 'tts_edge': {
      providers[providerKey] = {
        type: 'tts_edge',
        tts_voice: String(input.tts_voice || 'zh-CN-XiaoxiaoNeural').trim(),
        voice_output_language: voiceLang,
        rate: String(input.rate || '+0%').trim(),
        pitch: String(input.pitch || '+0Hz').trim(),
        volume: String(input.volume || '+0%').trim(),
        output_format: 'audio-24khz-48kbitrate-mono-mp3'
      };
      break;
    }

    case 'tts_windows': {
      providers[providerKey] = {
        type: 'tts_windows',
        tts_voice: String(input.tts_voice || '').trim(),
        voice_output_language: voiceLang,
        rate: Math.max(-10, Math.min(10, Math.round(Number(input.rate || 0)))),
        volume: Math.max(0, Math.min(100, Math.round(Number(input.volume || 100))))
      };
      break;
    }

    default:
      throw new OnboardingError('ONBOARDING_CONFIG_SAVE_FAILED', `unsupported tts_type: ${ttsType}`);
  }

  providerStore.save({
    ...current,
    providers,
    active_tts_provider: providerKey
  });

  return providerStore.load();
}

/* ================================================================== */
/*  Legacy DashScope voice-clone path (still used by /voice/clone)    */
/* ================================================================== */

function saveTtsProviderFromVoiceClone({
  providerStore,
  apiKey,
  apiKeyEnv,
  ttsBaseUrl = DEFAULT_TTS_BASE_URL,
  targetMode = 'normal',
  voiceId
}) {
  const current = providerStore.load();
  const providers = { ...(current.providers || {}) };
  const existing = isPlainObject(providers.qwen3_tts) ? providers.qwen3_tts : {};

  const nextTts = {
    ...existing,
    type: 'tts_dashscope',
    display_name: String(existing.display_name || 'Qwen3 TTS VC'),
    base_url: String(ttsBaseUrl || existing.base_url || DEFAULT_TTS_BASE_URL),
    timeout_ms: Math.round(parsePositiveNumber(existing.timeout_ms, 60000)),
    tts_model: String(existing.tts_model || DEFAULT_NORMAL_MODEL),
    tts_voice: String(existing.tts_voice || voiceId || '').trim(),
    voice_output_language: TTS_DEFAULT_VOICE_LANG.tts_dashscope
  };

  if (!nextTts.tts_voice) {
    throw new OnboardingError('ONBOARDING_CONFIG_SAVE_FAILED', 'tts_voice is required for tts provider');
  }

  if (targetMode === 'realtime') {
    nextTts.tts_realtime_model = DEFAULT_REALTIME_MODEL;
    nextTts.tts_realtime_voice = String(voiceId || '').trim() || String(nextTts.tts_realtime_voice || '').trim();
  } else {
    nextTts.tts_model = DEFAULT_NORMAL_MODEL;
    nextTts.tts_voice = String(voiceId || '').trim();
  }

  if (apiKey) {
    nextTts.api_key = String(apiKey).trim();
    delete nextTts.api_key_env;
  } else if (apiKeyEnv) {
    nextTts.api_key_env = String(apiKeyEnv).trim();
    delete nextTts.api_key;
  } else if (!nextTts.api_key && !nextTts.api_key_env) {
    throw new OnboardingError('ONBOARDING_CONFIG_SAVE_FAILED', 'api_key or api_key_env is required for tts provider');
  }

  providers.qwen3_tts = nextTts;
  providerStore.save({
    ...current,
    providers,
    active_tts_provider: 'qwen3_tts'
  });

  return providerStore.load();
}

/* ================================================================== */
/*  Preferences                                                       */
/* ================================================================== */

function mergeVoicePolicyRaw(rawYaml, voicePolicyInput = {}) {
  const parsed = YAML.parse(String(rawYaml || '')) || {};
  const root = isPlainObject(parsed) ? parsed : {};
  const policy = isPlainObject(root.voice_policy) ? root.voice_policy : {};
  const autoReply = isPlainObject(policy.auto_reply) ? policy.auto_reply : {};
  const limits = isPlainObject(policy.limits) ? policy.limits : {};

  const next = {
    ...root,
    voice_policy: {
      ...policy,
      auto_reply: {
        ...autoReply,
        enabled: parseBoolean(voicePolicyInput.auto_reply_enabled, autoReply.enabled !== false)
      },
      limits: {
        ...limits,
        max_chars: Math.round(parsePositiveNumber(voicePolicyInput.max_chars, limits.max_chars || 220)),
        max_duration_sec: Math.round(parsePositiveNumber(voicePolicyInput.max_duration_sec, limits.max_duration_sec || 45)),
        cooldown_sec_per_session: Math.round(parsePositiveNumber(
          voicePolicyInput.cooldown_sec_per_session,
          limits.cooldown_sec_per_session || 2
        )),
        max_tts_calls_per_minute: Math.round(parsePositiveNumber(
          voicePolicyInput.max_tts_calls_per_minute,
          limits.max_tts_calls_per_minute || 3
        ))
      }
    }
  };
  return YAML.stringify(next);
}

function mergePersonaRaw(rawYaml, personaInput = {}) {
  const parsed = YAML.parse(String(rawYaml || '')) || {};
  if (!isPlainObject(parsed)) {
    throw new OnboardingError('ONBOARDING_CONFIG_SAVE_FAILED', 'persona.yaml root must be object');
  }
  const defaults = isPlainObject(parsed.defaults) ? parsed.defaults : {};
  const next = {
    ...parsed,
    defaults: {
      ...defaults,
      ...(personaInput.mode ? { mode: String(personaInput.mode).trim() } : {}),
      ...(personaInput.inject_enabled !== undefined ? { injectEnabled: parseBoolean(personaInput.inject_enabled, true) } : {}),
      ...(personaInput.max_context_chars !== undefined
        ? { maxContextChars: Math.round(parsePositiveNumber(personaInput.max_context_chars, defaults.maxContextChars || 1500)) }
        : {}),
      ...(personaInput.shared_across_sessions !== undefined
        ? { sharedAcrossSessions: parseBoolean(personaInput.shared_across_sessions, true) }
        : {})
    }
  };
  return YAML.stringify(next);
}

function mergeDesktopLive2dRaw(rawJson, desktopLive2dInput = {}) {
  const parsed = parseJsonWithComments(String(rawJson || '')) || {};
  if (!isPlainObject(parsed)) {
    throw new OnboardingError('ONBOARDING_CONFIG_SAVE_FAILED', 'desktop-live2d.json root must be object');
  }
  const voice = isPlainObject(parsed.voice) ? parsed.voice : {};
  const next = {
    ...parsed,
    voice: { ...voice }
  };

  if (desktopLive2dInput.voice_transport !== undefined) {
    const transport = String(desktopLive2dInput.voice_transport || '').trim().toLowerCase();
    if (!['realtime', 'non_streaming'].includes(transport)) {
      throw new OnboardingError(
        'ONBOARDING_CONFIG_SAVE_FAILED',
        "desktop_live2d.voice_transport must be 'realtime' or 'non_streaming'"
      );
    }
    next.voice.transport = transport;
  }

  return serializeDesktopLive2dUiConfig(next);
}

function saveOnboardingPreferences({
  voicePolicyPath,
  personaConfigStore,
  skillConfigStore,
  desktopLive2dConfigPath,
  input = {}
}) {
  if (isPlainObject(input.voice_policy)) {
    const rawVoicePolicy = fs.existsSync(voicePolicyPath)
      ? fs.readFileSync(voicePolicyPath, 'utf8')
      : '';
    const nextVoicePolicy = mergeVoicePolicyRaw(rawVoicePolicy, input.voice_policy);
    fs.writeFileSync(voicePolicyPath, nextVoicePolicy, 'utf8');
  }

  if (isPlainObject(input.persona_defaults)) {
    const rawPersona = personaConfigStore.loadRawYaml();
    const nextPersona = mergePersonaRaw(rawPersona, input.persona_defaults);
    personaConfigStore.saveRawYaml(nextPersona);
  }

  if (isPlainObject(input.skills)) {
    const rawSkills = skillConfigStore.loadRawYaml();
    const nextSkills = mergeSkillsRaw(rawSkills, input.skills);
    skillConfigStore.saveRawYaml(nextSkills);
  }

  if (desktopLive2dConfigPath && isPlainObject(input.desktop_live2d)) {
    const rawDesktopLive2d = fs.existsSync(desktopLive2dConfigPath)
      ? fs.readFileSync(desktopLive2dConfigPath, 'utf8')
      : '{}';
    const nextDesktopLive2d = mergeDesktopLive2dRaw(rawDesktopLive2d, input.desktop_live2d);
    fs.writeFileSync(desktopLive2dConfigPath, nextDesktopLive2d, 'utf8');
  }
}

function mergeSkillsRaw(rawYaml, skillsInput = {}) {
  const parsed = YAML.parse(String(rawYaml || '')) || {};
  if (!isPlainObject(parsed)) {
    throw new OnboardingError('ONBOARDING_CONFIG_SAVE_FAILED', 'skills.yaml root must be object');
  }
  const load = isPlainObject(parsed.load) ? parsed.load : {};
  const trigger = isPlainObject(parsed.trigger) ? parsed.trigger : {};
  const next = {
    ...parsed,
    load: {
      ...load,
      ...(skillsInput.workspace !== undefined ? { workspace: parseBoolean(skillsInput.workspace, true) } : {}),
      ...(skillsInput.global !== undefined ? { global: parseBoolean(skillsInput.global, true) } : {})
    },
    trigger: {
      ...trigger,
      ...(skillsInput.max_selected_per_turn !== undefined
        ? { maxSelectedPerTurn: Math.round(parsePositiveNumber(skillsInput.max_selected_per_turn, trigger.maxSelectedPerTurn || 2)) }
        : {})
    }
  };
  return YAML.stringify(next);
}

module.exports = {
  DEFAULT_LLM_BASE_URL,
  DEFAULT_TTS_BASE_URL,
  DEFAULT_NORMAL_MODEL,
  DEFAULT_REALTIME_MODEL,
  TTS_DEFAULT_VOICE_LANG,
  readOnboardingState,
  markOnboardingStep,
  markOnboardingCompleted,
  saveLlmProvider,
  saveTtsProvider,
  saveTtsProviderFromVoiceClone,
  saveOnboardingPreferences
};
