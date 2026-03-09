const el = {
  step1: document.getElementById('step1'),
  step2: document.getElementById('step2'),
  step3: document.getElementById('step3'),
  stepMark1: document.getElementById('stepMark1'),
  stepMark2: document.getElementById('stepMark2'),
  stepMark3: document.getElementById('stepMark3'),
  statusText: document.getElementById('statusText'),
  llmKey: document.getElementById('llmKey'),
  llmDisplayName: document.getElementById('llmDisplayName'),
  llmBaseUrl: document.getElementById('llmBaseUrl'),
  llmModel: document.getElementById('llmModel'),
  llmApiKey: document.getElementById('llmApiKey'),
  llmTimeoutMs: document.getElementById('llmTimeoutMs'),
  saveProviderBtn: document.getElementById('saveProviderBtn'),
  ttsApiKey: document.getElementById('ttsApiKey'),
  ttsBaseUrl: document.getElementById('ttsBaseUrl'),
  voicePreferredName: document.getElementById('voicePreferredName'),
  voiceManualId: document.getElementById('voiceManualId'),
  voiceAudioFile: document.getElementById('voiceAudioFile'),
  voiceCloneBtn: document.getElementById('voiceCloneBtn'),
  voiceSaveManualBtn: document.getElementById('voiceSaveManualBtn'),
  backToStep1Btn: document.getElementById('backToStep1Btn'),
  prefAutoReplyEnabled: document.getElementById('prefAutoReplyEnabled'),
  prefMaxChars: document.getElementById('prefMaxChars'),
  prefCooldownSec: document.getElementById('prefCooldownSec'),
  prefMaxTtsPerMinute: document.getElementById('prefMaxTtsPerMinute'),
  prefPersonaMode: document.getElementById('prefPersonaMode'),
  prefMaxContextChars: document.getElementById('prefMaxContextChars'),
  prefSkillsWorkspace: document.getElementById('prefSkillsWorkspace'),
  prefSkillsGlobal: document.getElementById('prefSkillsGlobal'),
  savePrefsBtn: document.getElementById('savePrefsBtn'),
  backToStep2Btn: document.getElementById('backToStep2Btn'),
  completeBtn: document.getElementById('completeBtn')
};

function getTtsMode() {
  const checked = document.querySelector('input[name="ttsMode"]:checked');
  return checked ? checked.value : 'normal';
}

function setStatus(text, isError = false) {
  el.statusText.textContent = text;
  el.statusText.style.color = isError ? '#b42318' : '#42566f';
}

function switchStep(step) {
  const s1 = step === 1;
  const s2 = step === 2;
  const s3 = step === 3;

  el.step1.classList.toggle('hidden', !s1);
  el.step2.classList.toggle('hidden', !s2);
  el.step3.classList.toggle('hidden', !s3);
  el.stepMark1.classList.toggle('active', s1);
  el.stepMark2.classList.toggle('active', s2);
  el.stepMark3.classList.toggle('active', s3);
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

async function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read audio file'));
    reader.readAsDataURL(file);
  });
}

async function saveProvider() {
  setStatus('Saving LLM provider...');
  try {
    await fetchJson('/api/onboarding/provider/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: {
          key: el.llmKey.value.trim(),
          display_name: el.llmDisplayName.value.trim(),
          base_url: el.llmBaseUrl.value.trim(),
          model: el.llmModel.value.trim(),
          api_key: el.llmApiKey.value.trim(),
          timeout_ms: Number(el.llmTimeoutMs.value) || 20000
        },
        active_provider: el.llmKey.value.trim()
      })
    });
    setStatus('LLM provider saved');
    switchStep(2);
  } catch (err) {
    setStatus(`[${err.code || 'ERROR'}] ${err.message}`, true);
  }
}

async function saveManualVoiceId() {
  const voiceId = el.voiceManualId.value.trim();
  if (!voiceId) {
    setStatus('Voice ID is required', true);
    return;
  }
  setStatus('Saving manual voice id...');
  try {
    await fetchJson('/api/onboarding/voice/save-manual', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target_mode: getTtsMode(),
        api_key: el.ttsApiKey.value.trim(),
        base_url: el.ttsBaseUrl.value.trim(),
        voice_id: voiceId
      })
    });
    setStatus('Voice ID saved');
    switchStep(3);
  } catch (err) {
    setStatus(`[${err.code || 'ERROR'}] ${err.message}`, true);
  }
}

async function cloneVoice() {
  const file = el.voiceAudioFile.files?.[0];
  if (!file) {
    setStatus('Please choose an audio file first', true);
    return;
  }
  setStatus('Cloning voice...');
  try {
    const audioDataUrl = await fileToDataUrl(file);
    await fetchJson('/api/onboarding/voice/clone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target_mode: getTtsMode(),
        api_key: el.ttsApiKey.value.trim(),
        base_url: el.ttsBaseUrl.value.trim(),
        preferred_name: el.voicePreferredName.value.trim(),
        audio_data_url: audioDataUrl
      })
    });
    setStatus('Voice clone saved');
    switchStep(3);
  } catch (err) {
    setStatus(`[${err.code || 'ERROR'}] ${err.message}`, true);
  }
}

async function savePreferences() {
  setStatus('Saving preferences...');
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
        skills: {
          workspace: el.prefSkillsWorkspace.checked,
          global: el.prefSkillsGlobal.checked
        }
      })
    });
    setStatus('Preferences saved');
  } catch (err) {
    setStatus(`[${err.code || 'ERROR'}] ${err.message}`, true);
  }
}

async function completeOnboarding() {
  setStatus('Completing onboarding...');
  try {
    await fetchJson('/api/onboarding/complete', { method: 'POST' });
    setStatus('Onboarding completed, redirecting...');
    setTimeout(() => {
      window.location.href = '/';
    }, 500);
  } catch (err) {
    setStatus(`[${err.code || 'ERROR'}] ${err.message}`, true);
  }
}

async function init() {
  try {
    const stateResp = await fetchJson('/api/onboarding/state');
    if (stateResp?.data?.done) {
      window.location.href = '/';
      return;
    }
    const lastStep = String(stateResp?.data?.last_step || 'provider');
    if (lastStep === 'voice') switchStep(2);
    if (lastStep === 'preferences' || lastStep === 'complete') switchStep(3);
  } catch {
    // keep default step
  }

  el.saveProviderBtn.addEventListener('click', saveProvider);
  el.voiceCloneBtn.addEventListener('click', cloneVoice);
  el.voiceSaveManualBtn.addEventListener('click', saveManualVoiceId);
  el.backToStep1Btn.addEventListener('click', () => switchStep(1));
  el.backToStep2Btn.addEventListener('click', () => switchStep(2));
  el.savePrefsBtn.addEventListener('click', savePreferences);
  el.completeBtn.addEventListener('click', completeOnboarding);
}

void init();
