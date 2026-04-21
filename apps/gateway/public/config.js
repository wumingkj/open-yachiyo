const THEME_STORAGE_KEY = 'yachiyo_theme_v1';
const THEME_PREFERENCES = ['auto', 'light', 'dark'];
const DEFAULT_THEME_PREFERENCE = 'auto';

// Known TTS provider types for the Add dropdown
const TTS_PROVIDER_TYPES = [
  { value: 'tts_dashscope', label: 'DashScope (阿里百炼)' },
  { value: 'tts_gpt_sovits', label: 'GPT-SoVITS (自部署)' },
  { value: 'tts_edge', label: 'Edge TTS (微软, 免费)' },
  { value: 'tts_windows', label: 'Windows SAPI (离线)' }
];

const elements = {
  activeProviderSelect: document.getElementById('activeProviderSelect'),
  providerCards: document.getElementById('providerCards'),
  statusText: document.getElementById('statusText'),
  addProviderBtn: document.getElementById('addProviderBtn'),
  activeTtsProviderSelect: document.getElementById('activeTtsProviderSelect'),
  ttsProviderCards: document.getElementById('ttsProviderCards'),
  ttsStatusText: document.getElementById('ttsStatusText'),
  addTtsProviderBtn: document.getElementById('addTtsProviderBtn'),
  reloadBtn: document.getElementById('reloadBtn'),
  saveBtn: document.getElementById('saveBtn'),
  loadYamlBtn: document.getElementById('loadYamlBtn'),
  saveYamlBtn: document.getElementById('saveYamlBtn'),
  rawYaml: document.getElementById('rawYaml'),
  themeSelect: document.getElementById('themeSelect')
};

const state = {
  activeProvider: '',
  providers: [],         // LLM providers (type = openai_compatible)
  activeTtsProvider: '',
  ttsProviders: [],      // TTS providers (type starts with tts_)
  themePreference: DEFAULT_THEME_PREFERENCE
};

function normalizeThemePreference(value) {
  if (typeof value === 'string' && THEME_PREFERENCES.includes(value)) return value;
  return DEFAULT_THEME_PREFERENCE;
}

function resolveTheme(preference) {
  if (preference === 'auto') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return preference;
}

function applyTheme(preference) {
  const normalizedPreference = normalizeThemePreference(preference);
  const resolvedTheme = resolveTheme(normalizedPreference);
  document.documentElement.setAttribute('data-theme', resolvedTheme);
  state.themePreference = normalizedPreference;
  elements.themeSelect.value = normalizedPreference;
}

function persistThemePreference(preference) {
  localStorage.setItem(THEME_STORAGE_KEY, normalizeThemePreference(preference));
}

function loadThemePreference() {
  const raw = localStorage.getItem(THEME_STORAGE_KEY);
  applyTheme(raw);
}

function setStatus(text, isError = false) {
  elements.statusText.textContent = text;
  elements.statusText.className = `status ${isError ? 'err' : 'ok'}`;
}

function setTtsStatus(text, isError = false) {
  elements.ttsStatusText.textContent = text;
  elements.ttsStatusText.className = `status ${isError ? 'err' : 'ok'}`;
}

// ── LLM Provider ──────────────────────────────────────────────────

function cloneLlmProvider(provider = {}) {
  return {
    key: provider.key || '',
    type: provider.type || 'openai_compatible',
    display_name: provider.display_name || '',
    base_url: provider.base_url || '',
    model: provider.model || '',
    api_key_env: provider.api_key_env || '',
    api_key: provider.api_key || '',
    timeout_ms: Number(provider.timeout_ms) || 20000
  };
}

// ── TTS Provider ──────────────────────────────────────────────────

function cloneTtsProvider(provider = {}) {
  return {
    key: provider.key || '',
    type: provider.type || 'tts_dashscope',
    display_name: provider.display_name || '',
    base_url: provider.base_url || '',
    api_key_env: provider.api_key_env || '',
    api_key: provider.api_key || '',
    // DashScope specific
    tts_model: provider.tts_model || '',
    tts_voice: provider.tts_voice || '',
    tts_realtime_model: provider.tts_realtime_model || '',
    tts_realtime_voice: provider.tts_realtime_voice || '',
    // GPT-SoVITS specific
    endpoint: provider.endpoint || '',
    tts_language: provider.tts_language || 'zh',
    speed: provider.speed ?? 1.0,
    top_k: provider.top_k ?? 5,
    top_p: provider.top_p ?? 1.0,
    temperature: provider.temperature ?? 1.0,
    ref_audio_path: provider.ref_audio_path || '',
    prompt_text: provider.prompt_text || '',
    prompt_language: provider.prompt_language || 'zh',
    // Edge TTS specific
    rate: provider.rate || '+0%',
    pitch: provider.pitch || '+0Hz',
    volume: provider.volume || '+0%',
    output_format: provider.output_format || '',
    // Windows SAPI specific
    sapi_rate: provider.sapi_rate ?? 0,
    sapi_volume: provider.sapi_volume ?? 100
  };
}

// ── Normalize config from server ──────────────────────────────────

function normalizeConfig(config) {
  const allProviders = Object.entries(config.providers || {});

  const providers = [];
  const ttsProviders = [];

  for (const [key, value] of allProviders) {
    if (typeof value.type === 'string' && value.type.startsWith('tts_')) {
      ttsProviders.push(cloneTtsProvider({ key, ...value }));
    } else {
      providers.push(cloneLlmProvider({ key, ...value }));
    }
  }

  const activeProvider = config.active_provider || providers[0]?.key || '';
  const activeTtsProvider = config.active_tts_provider || ttsProviders[0]?.key || '';

  return { activeProvider, providers, activeTtsProvider, ttsProviders };
}

// ── Build full config from state ──────────────────────────────────

function buildConfigFromState() {
  const providersMap = {};

  // LLM providers
  for (const provider of state.providers) {
    const key = provider.key.trim();
    if (!key) throw new Error('Provider key 不能为空');
    if (providersMap[key]) throw new Error(`Provider key 重复: ${key}`);
    if (!provider.base_url.trim()) throw new Error(`Provider ${key} 缺少 base_url`);
    if (!provider.model.trim()) throw new Error(`Provider ${key} 缺少 model`);

    const hasKey = provider.api_key.trim().length > 0;
    const hasEnv = provider.api_key_env.trim().length > 0;
    if (!hasKey && !hasEnv) {
      throw new Error(`Provider ${key} 需要填写 api_key 或 api_key_env`);
    }

    providersMap[key] = {
      type: 'openai_compatible',
      display_name: provider.display_name.trim() || key,
      base_url: provider.base_url.trim(),
      model: provider.model.trim(),
      timeout_ms: Number(provider.timeout_ms) || 20000,
      api_key_env: provider.api_key_env.trim() || undefined,
      api_key: provider.api_key.trim() || undefined
    };

    if (!providersMap[key].api_key_env) delete providersMap[key].api_key_env;
    if (!providersMap[key].api_key) delete providersMap[key].api_key;
  }

  // TTS providers
  for (const provider of state.ttsProviders) {
    const key = provider.key.trim();
    if (!key) throw new Error('TTS Provider key 不能为空');
    if (providersMap[key]) throw new Error(`Provider key 重复: ${key}`);

    const type = provider.type || 'tts_dashscope';
    const entry = {
      type,
      display_name: provider.display_name.trim() || key
    };

    // Common optional fields
    if (provider.base_url.trim()) entry.base_url = provider.base_url.trim();
    if (provider.api_key_env.trim()) entry.api_key_env = provider.api_key_env.trim();
    if (provider.api_key.trim()) entry.api_key = provider.api_key.trim();

    // Type-specific fields — only include non-empty values
    switch (type) {
      case 'tts_dashscope':
        if (provider.tts_model.trim()) entry.tts_model = provider.tts_model.trim();
        if (provider.tts_voice.trim()) entry.tts_voice = provider.tts_voice.trim();
        if (provider.tts_realtime_model.trim()) entry.tts_realtime_model = provider.tts_realtime_model.trim();
        if (provider.tts_realtime_voice.trim()) entry.tts_realtime_voice = provider.tts_realtime_voice.trim();
        break;
      case 'tts_gpt_sovits':
        if (provider.tts_voice.trim()) entry.tts_voice = provider.tts_voice.trim();
        if (provider.tts_language.trim()) entry.tts_language = provider.tts_language.trim();
        if (provider.endpoint.trim()) entry.endpoint = provider.endpoint.trim();
        if (provider.speed != null && provider.speed !== '') entry.speed = Number(provider.speed) || 1.0;
        if (provider.top_k != null && provider.top_k !== '') entry.top_k = Number(provider.top_k) || 5;
        if (provider.top_p != null && provider.top_p !== '') entry.top_p = Number(provider.top_p) || 1.0;
        if (provider.temperature != null && provider.temperature !== '') entry.temperature = Number(provider.temperature) || 1.0;
        if (provider.ref_audio_path.trim()) entry.ref_audio_path = provider.ref_audio_path.trim();
        if (provider.prompt_text.trim()) entry.prompt_text = provider.prompt_text.trim();
        if (provider.prompt_language.trim()) entry.prompt_language = provider.prompt_language.trim();
        break;
      case 'tts_edge':
        if (provider.tts_voice.trim()) entry.tts_voice = provider.tts_voice.trim();
        if (provider.rate.trim()) entry.rate = provider.rate.trim();
        if (provider.pitch.trim()) entry.pitch = provider.pitch.trim();
        if (provider.volume.trim()) entry.volume = provider.volume.trim();
        if (provider.output_format.trim()) entry.output_format = provider.output_format.trim();
        break;
      case 'tts_windows':
        if (provider.tts_voice.trim()) entry.tts_voice = provider.tts_voice.trim();
        if (provider.sapi_rate != null && provider.sapi_rate !== '') entry.rate = Number(provider.sapi_rate) || 0;
        if (provider.sapi_volume != null && provider.sapi_volume !== '') entry.volume = Number(provider.sapi_volume) || 100;
        break;
    }

    providersMap[key] = entry;
  }

  if (!state.activeProvider || !providersMap[state.activeProvider]) {
    throw new Error('active provider 未设置或不存在');
  }

  const config = {
    active_provider: state.activeProvider,
    providers: providersMap
  };

  // Only set active_tts_provider if there are TTS providers
  if (state.ttsProviders.length > 0) {
    if (state.activeTtsProvider && providersMap[state.activeTtsProvider]) {
      config.active_tts_provider = state.activeTtsProvider;
    } else {
      config.active_tts_provider = state.ttsProviders[0].key;
    }
  }

  return config;
}

// ── API helpers ───────────────────────────────────────────────────

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!data.ok) {
    throw new Error(data.error || `Request failed: ${response.status}`);
  }
  return data;
}

async function loadGraphConfig() {
  setStatus('Loading...');
  const { data } = await fetchJson('/api/config/providers/config');
  const next = normalizeConfig(data);
  state.activeProvider = next.activeProvider;
  state.providers = next.providers;
  state.activeTtsProvider = next.activeTtsProvider;
  state.ttsProviders = next.ttsProviders;
  render();
  setStatus('Loaded');
}

async function saveGraphConfig() {
  const config = buildConfigFromState();
  setStatus('Saving...');
  await fetchJson('/api/config/providers/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config })
  });
  await loadRawYaml();
  setStatus('Saved');
}

async function loadRawYaml() {
  const { yaml } = await fetchJson('/api/config/providers/raw');
  elements.rawYaml.value = yaml || '';
}

async function saveRawYaml() {
  setStatus('Saving YAML...');
  await fetchJson('/api/config/providers/raw', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ yaml: elements.rawYaml.value })
  });
  await loadGraphConfig();
  setStatus('YAML saved');
}

// ── LLM Provider CRUD ────────────────────────────────────────────

function onActiveProviderChange() {
  state.activeProvider = elements.activeProviderSelect.value;
}

function addProvider() {
  const baseName = 'provider';
  let index = 1;
  const used = new Set(state.providers.map((p) => p.key));
  while (used.has(`${baseName}_${index}`)) {
    index += 1;
  }
  const key = `${baseName}_${index}`;
  state.providers.push(cloneLlmProvider({ key, display_name: key, type: 'openai_compatible' }));
  state.activeProvider = key;
  render();
}

function removeProvider(index) {
  if (state.providers.length <= 1) {
    setStatus('至少保留一个 provider', true);
    return;
  }
  const [removed] = state.providers.splice(index, 1);
  if (state.activeProvider === removed.key) {
    state.activeProvider = state.providers[0].key;
  }
  render();
}

// ── TTS Provider CRUD ────────────────────────────────────────────

function onActiveTtsProviderChange() {
  state.activeTtsProvider = elements.activeTtsProviderSelect.value;
}

function addTtsProvider() {
  // Prompt type via a simple inline select
  const type = window.prompt(
    '选择 TTS Provider 类型:\n\n' +
    TTS_PROVIDER_TYPES.map((t, i) => `${i + 1}. ${t.label} (${t.value})`).join('\n') +
    '\n\n请输入序号 (1-4):'
  );
  if (type === null) return;

  const idx = Number(type) - 1;
  const selected = TTS_PROVIDER_TYPES[idx];
  if (!selected) {
    setTtsStatus('无效的选择', true);
    return;
  }

  const keyPrefix = selected.value.replace('tts_', '');
  let index = 1;
  const used = new Set(state.ttsProviders.map((p) => p.key));
  let key = `${keyPrefix}_${index}`;
  while (used.has(key)) {
    index += 1;
    key = `${keyPrefix}_${index}`;
  }

  state.ttsProviders.push(cloneTtsProvider({
    key,
    type: selected.value,
    display_name: selected.label,
    ...getDefaultTtsFields(selected.value)
  }));
  state.activeTtsProvider = key;
  render();
}

function getDefaultTtsFields(type) {
  switch (type) {
    case 'tts_dashscope':
      return {
        base_url: 'https://dashscope.aliyuncs.com/api/v1',
        api_key_env: 'DASHSCOPE_API_KEY',
        tts_model: 'qwen3-tts-vc-2026-01-22',
        tts_realtime_model: 'qwen3-tts-vc-realtime-2026-01-15',
        tts_realtime_voice: 'Cherry'
      };
    case 'tts_gpt_sovits':
      return {
        base_url: 'http://127.0.0.1:9880',
        tts_voice: 'default',
        tts_language: 'zh',
        endpoint: '/tts',
        speed: 1.0,
        top_k: 5,
        top_p: 1.0,
        temperature: 1.0,
        prompt_language: 'zh'
      };
    case 'tts_edge':
      return {
        tts_voice: 'zh-CN-XiaoxiaoNeural',
        rate: '+0%',
        pitch: '+0Hz',
        volume: '+0%',
        output_format: 'audio-24khz-48kbitrate-mono-mp3'
      };
    case 'tts_windows':
      return {
        tts_voice: 'Microsoft Huihui Desktop',
        sapi_rate: 0,
        sapi_volume: 100
      };
    default:
      return {};
  }
}

function removeTtsProvider(index) {
  const [removed] = state.ttsProviders.splice(index, 1);
  if (state.activeTtsProvider === removed.key) {
    state.activeTtsProvider = state.ttsProviders[0]?.key || '';
  }
  render();
}

// ── UI field helper ───────────────────────────────────────────────

function createField(labelText, value, onInput, type = 'text') {
  const wrap = document.createElement('label');
  wrap.className = 'field';
  const title = document.createElement('div');
  title.textContent = labelText;
  title.style.color = 'var(--muted)';
  title.style.fontSize = '12px';
  title.style.marginBottom = '5px';

  const input = document.createElement('input');
  input.type = type;
  input.value = value ?? '';
  input.oninput = () => onInput(input.value);

  wrap.appendChild(title);
  wrap.appendChild(input);
  return wrap;
}

// ── Render LLM ────────────────────────────────────────────────────

function renderActiveProviderSelect() {
  const select = elements.activeProviderSelect;
  select.innerHTML = '';
  state.providers.forEach((provider) => {
    const option = document.createElement('option');
    option.value = provider.key;
    option.textContent = `${provider.display_name || provider.key} (${provider.key})`;
    select.appendChild(option);
  });
  select.value = state.activeProvider;
}

function renderProviderCards() {
  elements.providerCards.innerHTML = '';
  state.providers.forEach((provider, index) => {
    const card = document.createElement('div');
    card.className = 'provider-card';

    const head = document.createElement('div');
    head.className = 'provider-card-head';
    const title = document.createElement('strong');
    title.textContent = provider.display_name || provider.key;
    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn';
    removeBtn.textContent = 'Remove';
    removeBtn.onclick = () => removeProvider(index);
    head.appendChild(title);
    head.appendChild(removeBtn);

    const grid = document.createElement('div');
    grid.className = 'provider-grid';

    grid.appendChild(createField('Provider Key', provider.key, (v) => {
      const prev = provider.key;
      provider.key = v.trim();
      if (state.activeProvider === prev) state.activeProvider = provider.key;
      renderActiveProviderSelect();
    }));
    grid.appendChild(createField('Display Name', provider.display_name, (v) => {
      provider.display_name = v;
      title.textContent = v || provider.key;
      renderActiveProviderSelect();
    }));
    grid.appendChild(createField('Base URL', provider.base_url, (v) => { provider.base_url = v; }));
    grid.appendChild(createField('Model', provider.model, (v) => { provider.model = v; }));
    grid.appendChild(createField('API Key Env', provider.api_key_env, (v) => { provider.api_key_env = v; }));
    grid.appendChild(createField('Inline API Key', provider.api_key, (v) => { provider.api_key = v; }));
    grid.appendChild(createField('Timeout (ms)', String(provider.timeout_ms), (v) => {
      provider.timeout_ms = Number(v) || 20000;
    }, 'number'));

    card.appendChild(head);
    card.appendChild(grid);
    elements.providerCards.appendChild(card);
  });
}

// ── Render TTS ────────────────────────────────────────────────────

function renderActiveTtsProviderSelect() {
  const select = elements.activeTtsProviderSelect;
  select.innerHTML = '';
  state.ttsProviders.forEach((provider) => {
    const option = document.createElement('option');
    option.value = provider.key;
    option.textContent = `${provider.display_name || provider.key} (${provider.key})`;
    select.appendChild(option);
  });
  select.value = state.activeTtsProvider;
}

function renderTtsProviderCards() {
  elements.ttsProviderCards.innerHTML = '';
  state.ttsProviders.forEach((provider, index) => {
    const card = document.createElement('div');
    card.className = 'provider-card';

    const head = document.createElement('div');
    head.className = 'provider-card-head';
    const title = document.createElement('strong');
    title.textContent = provider.display_name || provider.key;
    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn';
    removeBtn.textContent = 'Remove';
    removeBtn.onclick = () => removeTtsProvider(index);
    head.appendChild(title);
    head.appendChild(removeBtn);

    const grid = document.createElement('div');
    grid.className = 'provider-grid';

    // Common fields
    grid.appendChild(createField('Provider Key', provider.key, (v) => {
      const prev = provider.key;
      provider.key = v.trim();
      if (state.activeTtsProvider === prev) state.activeTtsProvider = provider.key;
      renderActiveTtsProviderSelect();
    }));
    grid.appendChild(createField('Display Name', provider.display_name, (v) => {
      provider.display_name = v;
      title.textContent = v || provider.key;
      renderActiveTtsProviderSelect();
    }));

    // Type selector (dropdown)
    const typeWrap = document.createElement('div');
    typeWrap.className = 'field';
    const typeLabel = document.createElement('div');
    typeLabel.textContent = 'Provider Type';
    typeLabel.style.color = 'var(--muted)';
    typeLabel.style.fontSize = '12px';
    typeLabel.style.marginBottom = '5px';
    const typeSelect = document.createElement('select');
    TTS_PROVIDER_TYPES.forEach((t) => {
      const opt = document.createElement('option');
      opt.value = t.value;
      opt.textContent = t.label;
      typeSelect.appendChild(opt);
    });
    typeSelect.value = provider.type;
    typeSelect.onchange = () => {
      provider.type = typeSelect.value;
      const typeInfo = TTS_PROVIDER_TYPES.find((t) => t.value === typeSelect.value);
      if (typeInfo) provider.display_name = provider.display_name || typeInfo.label;
      renderTtsProviderCards();
    };
    typeWrap.appendChild(typeLabel);
    typeWrap.appendChild(typeSelect);
    grid.appendChild(typeWrap);

    // Base URL
    grid.appendChild(createField('Base URL', provider.base_url, (v) => { provider.base_url = v; }));
    // API Key Env
    grid.appendChild(createField('API Key Env', provider.api_key_env, (v) => { provider.api_key_env = v; }));
    // API Key
    grid.appendChild(createField('Inline API Key', provider.api_key, (v) => { provider.api_key = v; }));

    // Type-specific fields
    switch (provider.type) {
      case 'tts_dashscope':
        grid.appendChild(createField('TTS Model', provider.tts_model, (v) => { provider.tts_model = v; }));
        grid.appendChild(createField('TTS Voice ID', provider.tts_voice, (v) => { provider.tts_voice = v; }));
        grid.appendChild(createField('Realtime Model', provider.tts_realtime_model, (v) => { provider.tts_realtime_model = v; }));
        grid.appendChild(createField('Realtime Voice', provider.tts_realtime_voice, (v) => { provider.tts_realtime_voice = v; }));
        break;
      case 'tts_gpt_sovits':
        grid.appendChild(createField('Voice Speaker', provider.tts_voice, (v) => { provider.tts_voice = v; }));
        grid.appendChild(createField('Language', provider.tts_language, (v) => { provider.tts_language = v; }));
        grid.appendChild(createField('Endpoint', provider.endpoint, (v) => { provider.endpoint = v; }));
        grid.appendChild(createField('Speed', String(provider.speed), (v) => { provider.speed = Number(v) || 1.0; }, 'number'));
        grid.appendChild(createField('Top K', String(provider.top_k), (v) => { provider.top_k = Number(v) || 5; }, 'number'));
        grid.appendChild(createField('Top P', String(provider.top_p), (v) => { provider.top_p = Number(v) || 1.0; }, 'number'));
        grid.appendChild(createField('Temperature', String(provider.temperature), (v) => { provider.temperature = Number(v) || 1.0; }, 'number'));
        grid.appendChild(createField('Ref Audio Path', provider.ref_audio_path, (v) => { provider.ref_audio_path = v; }));
        grid.appendChild(createField('Prompt Text', provider.prompt_text, (v) => { provider.prompt_text = v; }));
        grid.appendChild(createField('Prompt Language', provider.prompt_language, (v) => { provider.prompt_language = v; }));
        break;
      case 'tts_edge':
        grid.appendChild(createField('Voice', provider.tts_voice, (v) => { provider.tts_voice = v; }));
        grid.appendChild(createField('Rate', provider.rate, (v) => { provider.rate = v; }));
        grid.appendChild(createField('Pitch', provider.pitch, (v) => { provider.pitch = v; }));
        grid.appendChild(createField('Volume', provider.volume, (v) => { provider.volume = v; }));
        grid.appendChild(createField('Output Format', provider.output_format, (v) => { provider.output_format = v; }));
        break;
      case 'tts_windows':
        grid.appendChild(createField('Voice', provider.tts_voice, (v) => { provider.tts_voice = v; }));
        grid.appendChild(createField('Rate (-10~10)', String(provider.sapi_rate), (v) => { provider.sapi_rate = Number(v) || 0; }, 'number'));
        grid.appendChild(createField('Volume (0~100)', String(provider.sapi_volume), (v) => { provider.sapi_volume = Number(v) || 100; }, 'number'));
        break;
    }

    card.appendChild(head);
    card.appendChild(grid);
    elements.ttsProviderCards.appendChild(card);
  });
}

// ── Master render ─────────────────────────────────────────────────

function render() {
  renderActiveProviderSelect();
  renderProviderCards();
  renderActiveTtsProviderSelect();
  renderTtsProviderCards();
}

// ── Events ────────────────────────────────────────────────────────

function bindEvents() {
  elements.themeSelect.onchange = () => {
    const nextPreference = normalizeThemePreference(elements.themeSelect.value);
    persistThemePreference(nextPreference);
    applyTheme(nextPreference);
  };

  const themeMedia = window.matchMedia('(prefers-color-scheme: dark)');
  const handleThemeMediaChange = () => {
    if (state.themePreference !== 'auto') return;
    applyTheme('auto');
  };
  if (typeof themeMedia.addEventListener === 'function') {
    themeMedia.addEventListener('change', handleThemeMediaChange);
  } else if (typeof themeMedia.addListener === 'function') {
    themeMedia.addListener(handleThemeMediaChange);
  }

  elements.activeProviderSelect.onchange = onActiveProviderChange;
  elements.activeTtsProviderSelect.onchange = onActiveTtsProviderChange;
  elements.addProviderBtn.onclick = addProvider;
  elements.addTtsProviderBtn.onclick = addTtsProvider;
  elements.reloadBtn.onclick = async () => {
    try {
      await loadGraphConfig();
      await loadRawYaml();
    } catch (err) {
      setStatus(err.message || String(err), true);
    }
  };

  elements.saveBtn.onclick = async () => {
    try {
      await saveGraphConfig();
    } catch (err) {
      setStatus(err.message || String(err), true);
    }
  };

  elements.loadYamlBtn.onclick = async () => {
    try {
      await loadRawYaml();
      setStatus('YAML loaded');
    } catch (err) {
      setStatus(err.message || String(err), true);
    }
  };

  elements.saveYamlBtn.onclick = async () => {
    try {
      await saveRawYaml();
    } catch (err) {
      setStatus(err.message || String(err), true);
    }
  };
}

async function bootstrap() {
  loadThemePreference();
  bindEvents();

  try {
    await loadGraphConfig();
    await loadRawYaml();
  } catch (err) {
    setStatus(err.message || String(err), true);
  }
}

bootstrap();
