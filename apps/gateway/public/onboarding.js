const THEME_KEY = 'yachiyo_theme_v1';

/* ------------------------------------------------------------------ */
/*  Element references                                                */
/* ------------------------------------------------------------------ */

const el = {
  step1: document.getElementById('step1'),
  step2: document.getElementById('step2'),
  step3: document.getElementById('step3'),
  stepMark1: document.getElementById('stepMark1'),
  stepMark2: document.getElementById('stepMark2'),
  stepMark3: document.getElementById('stepMark3'),
  statusText: document.getElementById('statusText'),

  // Step 1 — LLM
  llmOpenaiFields: document.getElementById('llmOpenaiFields'),
  llmOllamaFields: document.getElementById('llmOllamaFields'),
  llmKey: document.getElementById('llmKey'),
  llmDisplayName: document.getElementById('llmDisplayName'),
  llmBaseUrl: document.getElementById('llmBaseUrl'),
  llmModel: document.getElementById('llmModel'),
  llmApiKey: document.getElementById('llmApiKey'),
  llmApiKeyEnv: document.getElementById('llmApiKeyEnv'),
  llmTimeoutMs: document.getElementById('llmTimeoutMs'),
  ollamaKey: document.getElementById('ollamaKey'),
  ollamaDisplayName: document.getElementById('ollamaDisplayName'),
  ollamaBaseUrl: document.getElementById('ollamaBaseUrl'),
  ollamaModel: document.getElementById('ollamaModel'),
  ollamaApiKey: document.getElementById('ollamaApiKey'),
  ollamaTimeoutMs: document.getElementById('ollamaTimeoutMs'),
  saveProviderBtn: document.getElementById('saveProviderBtn'),

  // Step 2 — TTS type toggle
  ttsDashscopeFields: document.getElementById('ttsDashscopeFields'),
  ttsGptSovitsFields: document.getElementById('ttsGptSovitsFields'),
  ttsEdgeFields: document.getElementById('ttsEdgeFields'),
  ttsWindowsFields: document.getElementById('ttsWindowsFields'),

  // DashScope
  ttsDashscopeKey: document.getElementById('ttsDashscopeKey'),
  ttsDashscopeApiKey: document.getElementById('ttsDashscopeApiKey'),
  ttsDashscopeApiKeyEnv: document.getElementById('ttsDashscopeApiKeyEnv'),
  ttsDashscopeBaseUrl: document.getElementById('ttsDashscopeBaseUrl'),
  voicePreferredName: document.getElementById('voicePreferredName'),
  voiceManualId: document.getElementById('voiceManualId'),
  voiceAudioFile: document.getElementById('voiceAudioFile'),
  referenceAudioFileList: document.getElementById('referenceAudioFileList'),
  referenceAudioDir: document.getElementById('referenceAudioDir'),
  openReferenceAudioDirBtn: document.getElementById('openReferenceAudioDirBtn'),
  dashscopeCloneBtn: document.getElementById('dashscopeCloneBtn'),
  dashscopeSaveManualBtn: document.getElementById('dashscopeSaveManualBtn'),

  // GPT-SoVITS
  ttsGptSovitsKey: document.getElementById('ttsGptSovitsKey'),
  ttsGptSovitsBaseUrl: document.getElementById('ttsGptSovitsBaseUrl'),
  ttsGptSovitsVoice: document.getElementById('ttsGptSovitsVoice'),
  ttsGptSovitsRefAudio: document.getElementById('ttsGptSovitsRefAudio'),
  ttsGptSovitsTimeout: document.getElementById('ttsGptSovitsTimeout'),
  gptSovitsSaveBtn: document.getElementById('gptSovitsSaveBtn'),

  // Edge TTS
  ttsEdgeKey: document.getElementById('ttsEdgeKey'),
  ttsEdgeVoice: document.getElementById('ttsEdgeVoice'),
  ttsEdgeRate: document.getElementById('ttsEdgeRate'),
  ttsEdgePitch: document.getElementById('ttsEdgePitch'),
  ttsEdgeVolume: document.getElementById('ttsEdgeVolume'),
  edgeSaveBtn: document.getElementById('edgeSaveBtn'),

  // Windows SAPI
  ttsWindowsKey: document.getElementById('ttsWindowsKey'),
  ttsWindowsVoice: document.getElementById('ttsWindowsVoice'),
  ttsWindowsRate: document.getElementById('ttsWindowsRate'),
  ttsWindowsVolume: document.getElementById('ttsWindowsVolume'),
  windowsSaveBtn: document.getElementById('windowsSaveBtn'),

  backToStep1Btn: document.getElementById('backToStep1Btn'),

  // Step 3 — Preferences
  prefAutoReplyEnabled: document.getElementById('prefAutoReplyEnabled'),
  prefMaxChars: document.getElementById('prefMaxChars'),
  prefCooldownSec: document.getElementById('prefCooldownSec'),
  prefMaxTtsPerMinute: document.getElementById('prefMaxTtsPerMinute'),
  prefPersonaMode: document.getElementById('prefPersonaMode'),
  prefMaxContextChars: document.getElementById('prefMaxContextChars'),
  prefDesktopVoiceTransport: document.getElementById('prefDesktopVoiceTransport'),
  savePrefsBtn: document.getElementById('savePrefsBtn'),
  backToStep2Btn: document.getElementById('backToStep2Btn'),
  completeBtn: document.getElementById('completeBtn'),
  skipBtn: document.getElementById('skipBtn')
};

/* ------------------------------------------------------------------ */
/*  State                                                             */
/* ------------------------------------------------------------------ */

const state = {
  referenceAudioUserDir: '',
  forceOpen: new URLSearchParams(window.location.search).get('force') === '1'
};

/* ------------------------------------------------------------------ */
/*  Theme                                                             */
/* ------------------------------------------------------------------ */

function applyTheme(pref) {
  const resolved = pref === 'auto'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : pref;
  document.documentElement.setAttribute('data-theme', resolved);
}

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  applyTheme(saved || 'auto');
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if ((localStorage.getItem(THEME_KEY) || 'auto') === 'auto') applyTheme('auto');
  });
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function setStatus(text, isError = false) {
  el.statusText.textContent = text;
  el.statusText.style.color = isError ? '#ff7a9f' : 'var(--muted)';
}

function switchStep(step) {
  const s1 = step === 1, s2 = step === 2, s3 = step === 3;
  el.step1.classList.toggle('hidden', !s1);
  el.step2.classList.toggle('hidden', !s2);
  el.step3.classList.toggle('hidden', !s3);
  el.stepMark1.classList.toggle('active', s1);
  el.stepMark2.classList.toggle('active', s2);
  el.stepMark3.classList.toggle('active', s3);
}

function switchLlmType() {
  const isOllama = getLlmType() === 'ollama';
  el.llmOpenaiFields.classList.toggle('hidden', isOllama);
  el.llmOllamaFields.classList.toggle('hidden', !isOllama);
}

function getLlmType() {
  const checked = document.querySelector('input[name="llmType"]:checked');
  return checked ? checked.value : 'openai_compatible';
}

function switchTtsType() {
  const type = getTtsType();
  el.ttsDashscopeFields.classList.toggle('hidden', type !== 'tts_dashscope');
  el.ttsGptSovitsFields.classList.toggle('hidden', type !== 'tts_gpt_sovits');
  el.ttsEdgeFields.classList.toggle('hidden', type !== 'tts_edge');
  el.ttsWindowsFields.classList.toggle('hidden', type !== 'tts_windows');
}

function getTtsType() {
  const checked = document.querySelector('input[name="ttsType"]:checked');
  return checked ? checked.value : 'tts_dashscope';
}

function getDashscopeMode() {
  const checked = document.querySelector('input[name="dashscopeMode"]:checked');
  return checked ? checked.value : 'normal';
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const data = await res.json();
  if (!data.ok) {
    const error = new Error(data.error || `HTTP ${res.status}`);
    error.code = data.code || 'UNKNOWN';
    throw error;
  }
  return data;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('读取音频文件失败'));
    reader.readAsDataURL(file);
  });
}

/* ------------------------------------------------------------------ */
/*  Step 1: Save LLM Provider                                        */
/* ------------------------------------------------------------------ */

async function saveProvider() {
  setStatus('正在保存 LLM provider...');
  try {
    const isOllama = getLlmType() === 'ollama';
    const body = {
      provider_type: isOllama ? 'qwen35' : 'openai_compatible',
      active_provider: isOllama ? el.ollamaKey.value.trim() : el.llmKey.value.trim(),
      provider: isOllama
        ? {
            key: el.ollamaKey.value.trim(),
            display_name: el.ollamaDisplayName.value.trim(),
            base_url: el.ollamaBaseUrl.value.trim(),
            model: el.ollamaModel.value.trim(),
            api_key: el.ollamaApiKey.value.trim() || 'ollama',
            timeout_ms: Number(el.ollamaTimeoutMs.value) || 60000
          }
        : {
            key: el.llmKey.value.trim(),
            display_name: el.llmDisplayName.value.trim(),
            base_url: el.llmBaseUrl.value.trim(),
            model: el.llmModel.value.trim(),
            api_key: el.llmApiKey.value.trim() || undefined,
            api_key_env: el.llmApiKeyEnv.value.trim() || undefined,
            timeout_ms: Number(el.llmTimeoutMs.value) || 60000
          }
    };
    await fetchJson('/api/onboarding/provider/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    setStatus('LLM provider 已保存');
    switchStep(2);
  } catch (err) {
    setStatus(`[${err.code || 'ERROR'}] ${err.message}`, true);
  }
}

/* ------------------------------------------------------------------ */
/*  Step 2: Save TTS Provider                                        */
/* ------------------------------------------------------------------ */

async function saveDashscopeClone() {
  const file = el.voiceAudioFile.files?.[0];
  if (!file) {
    setStatus('请先选择音频文件', true);
    return;
  }
  setStatus('正在克隆声线...');
  try {
    const audioDataUrl = await fileToDataUrl(file);
    await fetchJson('/api/onboarding/tts/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tts_type: 'tts_dashscope',
        provider_key: el.ttsDashscopeKey.value.trim(),
        api_key: el.ttsDashscopeApiKey.value.trim() || undefined,
        api_key_env: el.ttsDashscopeApiKeyEnv.value.trim() || undefined,
        base_url: el.ttsDashscopeBaseUrl.value.trim(),
        target_mode: getDashscopeMode(),
        preferred_name: el.voicePreferredName.value.trim(),
        audio_data_url: audioDataUrl
      })
    });
    setStatus('声线克隆成功，已写入配置');
    switchStep(3);
  } catch (err) {
    setStatus(`[${err.code || 'ERROR'}] ${err.message}`, true);
  }
}

async function saveDashscopeManual() {
  const voiceId = el.voiceManualId.value.trim();
  if (!voiceId) {
    setStatus('请填写 Voice ID', true);
    return;
  }
  setStatus('正在保存手动 Voice ID...');
  try {
    await fetchJson('/api/onboarding/tts/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tts_type: 'tts_dashscope',
        provider_key: el.ttsDashscopeKey.value.trim(),
        api_key: el.ttsDashscopeApiKey.value.trim() || undefined,
        api_key_env: el.ttsDashscopeApiKeyEnv.value.trim() || undefined,
        base_url: el.ttsDashscopeBaseUrl.value.trim(),
        target_mode: getDashscopeMode(),
        voice_id: voiceId
      })
    });
    setStatus('Voice ID 已保存');
    switchStep(3);
  } catch (err) {
    setStatus(`[${err.code || 'ERROR'}] ${err.message}`, true);
  }
}

async function saveGptSovits() {
  setStatus('正在保存 GPT-SoVITS 配置...');
  try {
    await fetchJson('/api/onboarding/tts/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tts_type: 'tts_gpt_sovits',
        provider_key: el.ttsGptSovitsKey.value.trim(),
        base_url: el.ttsGptSovitsBaseUrl.value.trim(),
        tts_voice: el.ttsGptSovitsVoice.value.trim(),
        ref_audio_path: el.ttsGptSovitsRefAudio.value.trim() || undefined,
        timeout_sec: Number(el.ttsGptSovitsTimeout.value) || 120
      })
    });
    setStatus('GPT-SoVITS 配置已保存');
    switchStep(3);
  } catch (err) {
    setStatus(`[${err.code || 'ERROR'}] ${err.message}`, true);
  }
}

async function saveEdgeTts() {
  setStatus('正在保存 Edge TTS 配置...');
  try {
    await fetchJson('/api/onboarding/tts/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tts_type: 'tts_edge',
        provider_key: el.ttsEdgeKey.value.trim(),
        tts_voice: el.ttsEdgeVoice.value.trim(),
        rate: el.ttsEdgeRate.value.trim(),
        pitch: el.ttsEdgePitch.value.trim(),
        volume: el.ttsEdgeVolume.value.trim()
      })
    });
    setStatus('Edge TTS 配置已保存');
    switchStep(3);
  } catch (err) {
    setStatus(`[${err.code || 'ERROR'}] ${err.message}`, true);
  }
}

async function saveWindowsTts() {
  setStatus('正在保存 Windows SAPI 配置...');
  try {
    await fetchJson('/api/onboarding/tts/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tts_type: 'tts_windows',
        provider_key: el.ttsWindowsKey.value.trim(),
        tts_voice: el.ttsWindowsVoice.value.trim() || undefined,
        rate: Number(el.ttsWindowsRate.value) || 0,
        volume: Number(el.ttsWindowsVolume.value) || 100
      })
    });
    setStatus('Windows SAPI 配置已保存');
    switchStep(3);
  } catch (err) {
    setStatus(`[${err.code || 'ERROR'}] ${err.message}`, true);
  }
}

/* ------------------------------------------------------------------ */
/*  Step 3: Preferences                                               */
/* ------------------------------------------------------------------ */

async function savePreferences() {
  setStatus('正在保存偏好...');
  try {
    await fetchJson('/api/onboarding/preferences/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        voice_policy: {
          auto_reply_enabled: el.prefAutoReplyEnabled.checked,
          max_chars: Number(el.prefMaxChars.value) || 220,
          cooldown_sec_per_session: Number(el.prefCooldownSec.value) || 2,
          max_tts_calls_per_minute: Number(el.prefMaxTtsPerMinute.value) || 3
        },
        persona_defaults: {
          mode: el.prefPersonaMode.value,
          max_context_chars: Number(el.prefMaxContextChars.value) || 1500
        },
        desktop_live2d: {
          voice_transport: el.prefDesktopVoiceTransport.value
        }
      })
    });
    setStatus('偏好已保存');
  } catch (err) {
    setStatus(`[${err.code || 'ERROR'}] ${err.message}`, true);
  }
}

async function completeOnboarding() {
  setStatus('正在完成 onboarding...');
  try {
    await fetchJson('/api/onboarding/complete', { method: 'POST' });
    setStatus('配置完成，正在进入主界面...');
    setTimeout(() => { window.location.href = '/'; }, 500);
  } catch (err) {
    setStatus(`[${err.code || 'ERROR'}] ${err.message}`, true);
  }
}

async function skipOnboarding() {
  setStatus('正在跳过配置...');
  try {
    await fetchJson('/api/onboarding/skip', { method: 'POST' });
    setStatus('已跳过 onboarding，稍后可重新打开。');
    setTimeout(() => { window.location.href = '/'; }, 500);
  } catch (err) {
    setStatus(`[${err.code || 'ERROR'}] ${err.message}`, true);
  }
}

/* ------------------------------------------------------------------ */
/*  Reference audio helpers (DashScope only)                          */
/* ------------------------------------------------------------------ */

async function initReferenceAudioInfo() {
  try {
    const response = await fetchJson('/api/onboarding/reference-audio');
    const data = response?.data || {};
    state.referenceAudioUserDir = String(data.user_dir || '');
    el.referenceAudioDir.textContent = state.referenceAudioUserDir || '未找到';

    // Render file list
    const files = Array.isArray(data.files) ? data.files : [];
    if (files.length === 0) {
      el.referenceAudioFileList.innerHTML = '<span class="hint">未找到参考音频文件</span>';
      return;
    }
    el.referenceAudioFileList.innerHTML = files.map(f => `
      <div class="ref-audio-row">
        <span class="ref-audio-name">${escapeHtml(f.name)}</span>
        <span class="ref-audio-path" title="${escapeHtml(f.path)}">${escapeHtml(f.path)}</span>
        <button class="btn ref-audio-copy" data-path="${escapeHtml(f.path)}">复制路径</button>
      </div>
    `).join('');

    // Bind copy buttons
    el.referenceAudioFileList.querySelectorAll('.ref-audio-copy').forEach(btn => {
      btn.addEventListener('click', () => copyToClipboard(btn.dataset.path));
    });
  } catch (err) {
    el.referenceAudioFileList.innerHTML = `<span class="hint">获取失败: ${escapeHtml(err.message || String(err))}</span>`;
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str || '');
  return div.innerHTML;
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    setStatus('路径已复制: ' + text);
  } catch {
    setStatus('复制失败', true);
  }
}

async function openReferenceAudioDir() {
  const target = state.referenceAudioUserDir;
  if (!target) { setStatus('参考音频目录不可用', true); return; }
  const openPath = window.desktopRuntime?.openPath || null;
  if (!openPath) { setStatus(`请手动打开目录: ${target}`, true); return; }
  const result = await openPath(target);
  if (!result?.ok) { setStatus(`打开目录失败: ${result?.error || 'unknown error'}`, true); return; }
  setStatus('已打开参考音频目录');
}

/* ------------------------------------------------------------------ */
/*  Init                                                              */
/* ------------------------------------------------------------------ */

async function init() {
  initTheme();
  await initReferenceAudioInfo();

  // LLM type toggle
  document.querySelectorAll('input[name="llmType"]').forEach(radio => {
    radio.addEventListener('change', switchLlmType);
  });

  // TTS type toggle
  document.querySelectorAll('input[name="ttsType"]').forEach(radio => {
    radio.addEventListener('change', switchTtsType);
  });

  // Step 1
  el.saveProviderBtn.addEventListener('click', saveProvider);

  // Step 2 — DashScope
  el.dashscopeCloneBtn.addEventListener('click', saveDashscopeClone);
  el.dashscopeSaveManualBtn.addEventListener('click', saveDashscopeManual);
  el.openReferenceAudioDirBtn.addEventListener('click', openReferenceAudioDir);

  // Step 2 — other TTS providers
  el.gptSovitsSaveBtn.addEventListener('click', saveGptSovits);
  el.edgeSaveBtn.addEventListener('click', saveEdgeTts);
  el.windowsSaveBtn.addEventListener('click', saveWindowsTts);

  el.backToStep1Btn.addEventListener('click', () => switchStep(1));

  // Step 3
  el.savePrefsBtn.addEventListener('click', savePreferences);
  el.backToStep2Btn.addEventListener('click', () => switchStep(2));
  el.completeBtn.addEventListener('click', completeOnboarding);
  el.skipBtn.addEventListener('click', skipOnboarding);

  // Check onboarding state
  try {
    const stateResp = await fetchJson('/api/onboarding/state');
    if (stateResp?.data?.done && !state.forceOpen) {
      window.location.href = '/';
      return;
    }
    if (stateResp?.data?.done && state.forceOpen) {
      setStatus(stateResp?.data?.skipped
        ? '当前 onboarding 已跳过，可在此重新补充配置。'
        : '当前 onboarding 已完成，可在此重新修改配置。');
    }
    const lastStep = String(stateResp?.data?.last_step || 'provider');
    if (lastStep === 'voice') switchStep(2);
    if (lastStep === 'preferences' || lastStep === 'complete') switchStep(3);
  } catch {
    // keep default step
  }
}

void init();
