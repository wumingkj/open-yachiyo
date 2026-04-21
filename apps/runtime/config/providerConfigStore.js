const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const { getRuntimePaths } = require('../skills/runtimePaths');

const DEFAULT_CONFIG = {
  active_provider: 'openai',
  providers: {
    openai: {
      type: 'openai_compatible',
      display_name: 'OpenAI',
      base_url: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      api_key_env: 'OPENAI_API_KEY',
      timeout_ms: 20000
    }
  }
};

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Core LLM type(s) — validated strictly.
// TTS types prefixed with 'tts_' are allowed dynamically (validation is
// delegated to the TTS provider adapter at runtime).
const CORE_TYPES = ['openai_compatible'];

function isTtsType(type) {
  return typeof type === 'string' && type.startsWith('tts_');
}

function validateConfig(config) {
  if (!isObject(config)) {
    throw new Error('providers.yaml root must be an object');
  }

  const providers = config.providers;
  const activeProvider = config.active_provider;
  const activeTtsProvider = config.active_tts_provider;

  if (!isObject(providers) || Object.keys(providers).length === 0) {
    throw new Error('providers must be a non-empty map');
  }

  if (typeof activeProvider !== 'string' || !activeProvider) {
    throw new Error('active_provider must be a non-empty string');
  }

  if (!providers[activeProvider]) {
    throw new Error(`active_provider not found in providers: ${activeProvider}`);
  }

  // active_tts_provider is optional; if set, validate it exists and is a TTS type
  if (typeof activeTtsProvider === 'string' && activeTtsProvider) {
    if (!providers[activeTtsProvider]) {
      throw new Error(`active_tts_provider not found in providers: ${activeTtsProvider}`);
    }
    if (!isTtsType(providers[activeTtsProvider].type)) {
      throw new Error(`active_tts_provider '${activeTtsProvider}' must reference a tts_* type provider`);
    }
  }

  for (const [name, provider] of Object.entries(providers)) {
    if (!isObject(provider)) {
      throw new Error(`provider ${name} must be an object`);
    }

    const type = provider.type;

    // TTS types are accepted with minimal validation — the concrete adapter
    // (resolved via TtsProviderFactory) handles detailed checks.
    // API key is optional for TTS providers (e.g. Windows SAPI, Edge TTS).
    if (isTtsType(type)) {
      continue;
    }

    if (!CORE_TYPES.includes(type)) {
      throw new Error(`provider ${name} type must be one of: ${CORE_TYPES.join(', ')} or start with 'tts_'`);
    }

    // openai_compatible needs base_url + model
    if (type === 'openai_compatible') {
      if (typeof provider.base_url !== 'string' || !provider.base_url) {
        throw new Error(`provider ${name} must define base_url`);
      }
      if (typeof provider.model !== 'string' || !provider.model) {
        throw new Error(`provider ${name} must define model`);
      }
    }
    const hasInlineKey = typeof provider.api_key === 'string' && provider.api_key.length > 0;
    const hasEnvKey = typeof provider.api_key_env === 'string' && provider.api_key_env.length > 0;
    if (!hasInlineKey && !hasEnvKey) {
      throw new Error(`provider ${name} must define api_key or api_key_env`);
    }
  }
}

class ProviderConfigStore {
  constructor({ configPath } = {}) {
    this.configPath = configPath
      || process.env.PROVIDER_CONFIG_PATH
      || path.join(getRuntimePaths().configDir, 'providers.yaml');
    this.ensureExists();
  }

  ensureExists() {
    if (fs.existsSync(this.configPath)) return;
    fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
    fs.writeFileSync(this.configPath, YAML.stringify(DEFAULT_CONFIG), 'utf8');
  }

  loadRawYaml() {
    this.ensureExists();
    return fs.readFileSync(this.configPath, 'utf8');
  }

  load() {
    const raw = this.loadRawYaml();
    const parsed = YAML.parse(raw);
    validateConfig(parsed);
    return parsed;
  }

  saveRawYaml(rawYaml) {
    const parsed = YAML.parse(rawYaml);
    validateConfig(parsed);
    fs.writeFileSync(this.configPath, YAML.stringify(parsed), 'utf8');
    return parsed;
  }

  save(config) {
    validateConfig(config);
    fs.writeFileSync(this.configPath, YAML.stringify(config), 'utf8');
  }
}

module.exports = { ProviderConfigStore, validateConfig };
