// config-v2.js — Config v2 前端逻辑

const TABS = [
  { id: 'providers',      label: 'providers',      getUrl: '/api/config/providers/raw',    putUrl: '/api/config/providers/raw',    bodyKey: 'yaml' },
  { id: 'tools',          label: 'tools',          getUrl: '/api/config/tools/raw',        putUrl: '/api/config/tools/raw',        bodyKey: 'yaml' },
  { id: 'skills',         label: 'skills',         getUrl: '/api/config/skills/raw',       putUrl: '/api/config/skills/raw',       bodyKey: 'yaml' },
  { id: 'persona',        label: 'persona',        getUrl: '/api/config/persona/raw',      putUrl: '/api/config/persona/raw',      bodyKey: 'yaml' },
  { id: 'voice-policy',   label: 'voice-policy',   getUrl: '/api/config/voice-policy/raw', putUrl: '/api/config/voice-policy/raw', bodyKey: 'yaml' },
  { id: 'desktop-live2d', label: 'desktop-live2d', getUrl: '/api/config/desktop-live2d/raw', putUrl: '/api/config/desktop-live2d/raw', bodyKey: 'json' },
];

const THEME_KEY = 'yachiyo_theme_v1';
const AGENT_SESSION_ID = 'config-v2-agent';
const GIT_PAGE_SIZE = 3;

const TTS_PROVIDER_TYPES = [
  { value: 'tts_dashscope', label: 'DashScope (阿里百炼)' },
  { value: 'tts_gpt_sovits', label: 'GPT-SoVITS (自部署)' },
  { value: 'tts_edge', label: 'Edge TTS (微软, 免费)' },
  { value: 'tts_windows', label: 'Windows SAPI (离线)' }
];

const el = {
  tabBar:        document.querySelector('.cv2-tabbar'),
  editor:        document.getElementById('editor'),
  loadBtn:       document.getElementById('loadBtn'),
  saveBtn:       document.getElementById('saveBtn'),
  status:        document.getElementById('cv2-status'),
  fileLabel:     document.getElementById('cv2-file-label'),
  readonlyBadge: document.getElementById('cv2-readonly-badge'),
  agentMessages: document.getElementById('agentMessages'),
  agentInput:    document.getElementById('agentInput'),
  agentSendBtn:  document.getElementById('agentSendBtn'),
  themeSelect:   document.getElementById('themeSelect'),
  gitLog:        document.getElementById('cv2-git-log'),
  dirtyBadge:    document.getElementById('cv2-dirty-badge'),
  gitRefreshBtn: document.getElementById('gitRefreshBtn'),
  gitPrevBtn:    document.getElementById('gitPrevBtn'),
  gitNextBtn:    document.getElementById('gitNextBtn'),
  gitPageInfo:   document.getElementById('gitPageInfo'),
  // Provider panel
  providerPanel: document.getElementById('cv2-provider-panel'),
  activeLlm:     document.getElementById('cv2-activeLlm'),
  activeTts:     document.getElementById('cv2-activeTts'),
  addTtsBtn:     document.getElementById('cv2-addTtsBtn'),
  ttsCards:      document.getElementById('cv2-ttsCards'),
};

let activeTabId = TABS[0].id;
let ws = null;
let wsReady = false;
let streamingEl = null;
let streamingText = '';

// git 翻页状态
let gitPage = 0;
let gitCommitsCache = [];
let gitCurrentFile = '';

// ── Theme ──────────────────────────────────────────────────────────────────
function applyTheme(pref) {
  const resolved = pref === 'auto'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : pref;
  document.documentElement.setAttribute('data-theme', resolved);
  el.themeSelect.value = pref;
}

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY) || 'auto';
  applyTheme(saved);
  el.themeSelect.addEventListener('change', () => {
    localStorage.setItem(THEME_KEY, el.themeSelect.value);
    applyTheme(el.themeSelect.value);
  });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if ((localStorage.getItem(THEME_KEY) || 'auto') === 'auto') applyTheme('auto');
  });
}

// ── Status ─────────────────────────────────────────────────────────────────
function setStatus(text, isErr = false) {
  el.status.textContent = text;
  el.status.className = `status ${isErr ? 'err' : 'ok'}`;
}

// ── API ────────────────────────────────────────────────────────────────────
async function fetchJson(url, opts = {}) {
  const res = await fetch(url, opts);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ── Tabs ───────────────────────────────────────────────────────────────────
function buildTabs() {
  TABS.forEach((tab, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cv2-tab';
    btn.textContent = tab.label;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
    btn.setAttribute('aria-controls', 'cv2-tabpanel');
    btn.id = `cv2-tab-${tab.id}`;
    btn.dataset.tabId = tab.id;

    btn.addEventListener('keydown', (e) => {
      const tabs = [...el.tabBar.querySelectorAll('.cv2-tab')];
      const idx = tabs.indexOf(e.currentTarget);
      if (e.key === 'ArrowRight') { e.preventDefault(); tabs[(idx + 1) % tabs.length].focus(); }
      if (e.key === 'ArrowLeft')  { e.preventDefault(); tabs[(idx - 1 + tabs.length) % tabs.length].focus(); }
      if (e.key === 'Home')       { e.preventDefault(); tabs[0].focus(); }
      if (e.key === 'End')        { e.preventDefault(); tabs[tabs.length - 1].focus(); }
    });

    btn.addEventListener('click', () => switchTab(tab.id));
    el.tabBar.appendChild(btn);
  });
}

function switchTab(id) {
  activeTabId = id;
  const tab = TABS.find(t => t.id === id);

  el.tabBar.querySelectorAll('.cv2-tab').forEach(b => {
    b.setAttribute('aria-selected', b.dataset.tabId === id ? 'true' : 'false');
  });

  el.fileLabel.textContent = `${tab.label}.${tab.bodyKey === 'json' ? 'json' : 'yaml'}`;

  // Show provider panel only on providers tab
  const isProviders = tab.id === 'providers';
  el.providerPanel.hidden = !isProviders;
  if (isProviders) refreshProviderPanel();

  if (tab.readonly) {
    el.readonlyBadge.hidden = false;
    el.saveBtn.disabled = true;
    el.saveBtn.setAttribute('aria-disabled', 'true');
    el.editor.readOnly = true;
    el.editor.setAttribute('aria-readonly', 'true');
  } else {
    el.readonlyBadge.hidden = true;
    el.saveBtn.disabled = false;
    el.saveBtn.removeAttribute('aria-disabled');
    el.editor.readOnly = false;
    el.editor.setAttribute('aria-readonly', 'false');
  }

  loadTab();
  loadGitLog();
}

async function loadTab() {
  const tab = TABS.find(t => t.id === activeTabId);
  setStatus('加载中…');
  try {
    const data = await fetchJson(tab.getUrl);
    el.editor.value = data[tab.bodyKey] || '';
    setStatus('已加载');
    if (activeTabId === 'providers') refreshProviderPanel();
  } catch (err) {
    setStatus(err.message, true);
  }
}

async function saveTab() {
  const tab = TABS.find(t => t.id === activeTabId);
  if (tab.readonly || !tab.putUrl) { setStatus('只读文件，无法保存', true); return; }
  setStatus('保存中…');
  try {
    await fetchJson(tab.putUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [tab.bodyKey]: el.editor.value }),
    });
    setStatus('已保存 ✓');
    loadGitLog();
  } catch (err) {
    setStatus(err.message, true);
  }
}

// ── Git log ────────────────────────────────────────────────────────────────
function formatDate(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso || '—';
  const pad = n => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function updatePagination() {
  const totalPages = Math.max(1, Math.ceil(gitCommitsCache.length / GIT_PAGE_SIZE));
  el.gitPageInfo.textContent = `${gitPage + 1} / ${totalPages}`;
  el.gitPrevBtn.disabled = gitPage === 0;
  el.gitNextBtn.disabled = gitPage >= totalPages - 1;
}

function renderGitPage() {
  el.gitLog.innerHTML = '';

  if (gitCommitsCache.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'cv2-git-empty';
    empty.textContent = '暂无提交记录';
    el.gitLog.appendChild(empty);
    updatePagination();
    return;
  }

  const fileName = gitCurrentFile;
  const start = gitPage * GIT_PAGE_SIZE;
  const pageCommits = gitCommitsCache.slice(start, start + GIT_PAGE_SIZE);

  pageCommits.forEach((commit, localIdx) => {
    const globalIdx = start + localIdx;
    const li = document.createElement('li');
    li.className = 'cv2-git-entry';

    const dot = document.createElement('span');
    dot.className = 'cv2-git-dot';
    dot.setAttribute('aria-hidden', 'true');

    const shortEl = document.createElement('span');
    shortEl.className = 'cv2-git-short';
    shortEl.textContent = commit.short;

    const subjectEl = document.createElement('span');
    subjectEl.className = 'cv2-git-subject';
    subjectEl.textContent = commit.subject;
    subjectEl.title = commit.subject;

    const dateEl = document.createElement('span');
    dateEl.className = 'cv2-git-date';
    dateEl.textContent = formatDate(commit.date);

    const actions = document.createElement('div');
    actions.className = 'cv2-git-actions';

    // 恢复按钮（全局第 0 条 = 最新，不显示）
    if (globalIdx > 0) {
      const restoreBtn = document.createElement('button');
      restoreBtn.type = 'button';
      restoreBtn.className = 'cv2-git-btn cv2-git-btn--restore';
      restoreBtn.textContent = '恢复';
      restoreBtn.setAttribute('aria-label', `恢复 ${fileName} 到 ${commit.short} 版本`);
      restoreBtn.addEventListener('click', async () => {
        if (!confirm(`确认将 ${fileName} 恢复到 ${commit.short}？\n${commit.subject}`)) return;
        try {
          await fetchJson('/api/config/git/restore', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hash: commit.hash, file: fileName }),
          });
          setStatus(`已恢复到 ${commit.short} ✓`);
          loadTab();
          loadGitLog();
        } catch (e) {
          setStatus(e.message, true);
        }
      });
      actions.appendChild(restoreBtn);
    }

    const previewBtn = document.createElement('button');
    previewBtn.type = 'button';
    previewBtn.className = 'cv2-git-btn';
    previewBtn.textContent = '预览';
    previewBtn.setAttribute('aria-label', `预览 ${commit.short} 版本的 ${fileName}`);
    previewBtn.addEventListener('click', async () => {
      try {
        const d = await fetchJson(`/api/config/git/show?hash=${commit.hash}&file=${encodeURIComponent(fileName)}`);
        el.editor.value = d.content;
        setStatus(`预览 ${commit.short} — 未保存`);
      } catch (e) {
        setStatus(e.message, true);
      }
    });
    actions.appendChild(previewBtn);

    li.append(dot, shortEl, subjectEl, dateEl, actions);
    el.gitLog.appendChild(li);
  });

  updatePagination();
}

async function loadGitLog() {
  const tab = TABS.find(t => t.id === activeTabId);
  const fileName = tab.id === 'desktop-live2d' ? 'desktop-live2d.json' : `${tab.id}.yaml`;

  // tab 切换时重置到第一页
  if (fileName !== gitCurrentFile) {
    gitPage = 0;
    gitCurrentFile = fileName;
  }

  try {
    const data = await fetchJson(`/api/config/git/log?file=${encodeURIComponent(fileName)}&limit=50`);
    el.dirtyBadge.hidden = !data.dirty;
    gitCommitsCache = data.commits || [];
    renderGitPage();
  } catch (err) {
    el.gitLog.innerHTML = `<li class="cv2-git-empty">加载失败: ${err.message}</li>`;
    updatePagination();
  }
}

// ── Agent WebSocket ────────────────────────────────────────────────────────
function initWs() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);

  ws.addEventListener('open', () => { wsReady = true; });

  ws.addEventListener('message', (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }

    const msgSessionId = msg.session_id || msg.data?.session_id || msg.params?.session_id;
    if (msgSessionId && msgSessionId !== AGENT_SESSION_ID) return;

    if (msg.type === 'start') {
      if (streamingEl) streamingEl.querySelector('.cv2-msg-text').textContent = '思考中…';
      return;
    }

    if (msg.type === 'event') {
      if (streamingEl && msg.data?.event === 'tool.call') {
        streamingEl.querySelector('.cv2-msg-text').textContent = `调用工具: ${msg.data.payload?.name || '…'}`;
      }
      return;
    }

    if (msg.type === 'final') {
      finishAgentMessage(msg.output || streamingText || '（无回复）');
      return;
    }

    if (msg.type === 'error') {
      finishAgentMessage(`错误：${msg.message || 'unknown error'}`, true);
      return;
    }
  });

  ws.addEventListener('error', () => setStatus('Agent 连接失败', true));
  ws.addEventListener('close', () => { wsReady = false; });
}

function appendMsg(role, text) {
  const div = document.createElement('div');
  div.className = `cv2-msg cv2-msg--${role}`;
  const span = document.createElement('span');
  span.className = 'cv2-msg-text';
  span.textContent = text;
  div.appendChild(span);
  el.agentMessages.appendChild(div);
  el.agentMessages.scrollTop = el.agentMessages.scrollHeight;
  return div;
}

function finishAgentMessage(output, isErr = false) {
  if (streamingEl) {
    streamingEl.classList.remove('is-streaming');
    streamingEl.querySelector('.cv2-msg-text').textContent = output;

    if (!isErr) {
      const codeMatch = output.match(/```(?:yaml|json)?\n([\s\S]*?)```/);
      if (codeMatch) {
        const applyBtn = document.createElement('button');
        applyBtn.type = 'button';
        applyBtn.className = 'cv2-apply-btn';
        applyBtn.textContent = '应用到编辑器';
        applyBtn.setAttribute('aria-label', '将 agent 建议的代码应用到编辑器');
        const captured = codeMatch[1];
        applyBtn.addEventListener('click', () => {
          el.editor.value = captured;
          setStatus('已从 Agent 应用');
          el.editor.focus();
        });
        streamingEl.appendChild(applyBtn);
      }
    }
  }
  streamingText = '';
  streamingEl = null;
  el.agentMessages.scrollTop = el.agentMessages.scrollHeight;
}

function sendAgentMessage() {
  const userText = el.agentInput.value.trim();
  if (!userText) return;
  if (!wsReady) { setStatus('Agent 未连接，请稍候', true); return; }

  el.agentInput.value = '';
  appendMsg('user', userText);

  const tab = TABS.find(t => t.id === activeTabId);
  const contextPrefix = `[当前编辑的 ${tab.label} 文件内容]\n\`\`\`\n${el.editor.value}\n\`\`\`\n\n`;

  streamingText = '';
  streamingEl = appendMsg('agent', '…');
  streamingEl.classList.add('is-streaming');

  ws.send(JSON.stringify({
    type: 'run',
    session_id: AGENT_SESSION_ID,
    input: contextPrefix + userText,
  }));
}

// ── Provider quick-panel ───────────────────────────────────────────────────

function parseProvidersYaml(yamlText) {
  try {
    // Use a simple YAML-like parser for the providers structure
    // We only need top-level keys under `providers:` and `active_provider:`
    const YAML = window.YAML || null;
    if (YAML) {
      const parsed = YAML.parse(yamlText);
      return parsed || {};
    }
  } catch { /* fallback to regex */ }
  return {};
}

function parseProvidersFromEditor() {
  const text = el.editor.value;
  const activeMatch = text.match(/^active_provider:\s*(.+)$/m);
  const activeTtsMatch = text.match(/^active_tts_provider:\s*(.+)$/m);

  // Extract provider entries: find keys at 2-space indent, then their type
  const providers = [];
  const lines = text.split('\n');
  let inProviders = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Detect start of providers section
    if (/^providers:\s*/.test(line)) {
      inProviders = true;
      continue;
    }

    // Skip comments and empty lines
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    // Detect end of providers section (new top-level key with 0 indent)
    if (inProviders && line.length > 0 && line[0] !== ' ' && line[0] !== '\t') {
      inProviders = false;
      continue;
    }

    if (!inProviders) continue;

    // Provider key at exactly 2-space indent: "  some_key:"
    const keyMatch = line.match(/^  ([a-zA-Z_]\w*):\s*$/);
    if (keyMatch) {
      const key = keyMatch[1];
      // Look ahead for type in the next few lines (skip comments/blank)
      let type = '';
      for (let j = i + 1; j < Math.min(i + 20, lines.length); j++) {
        const nextTrimmed = lines[j].trim();
        if (nextTrimmed === '' || nextTrimmed.startsWith('#')) continue;
        // If we hit another provider key (2-space indent), stop
        if (/^  [a-zA-Z_]\w*:\s*$/.test(lines[j])) break;
        const typeMatch = nextTrimmed.match(/^type:\s*(.+)$/);
        if (typeMatch) { type = typeMatch[1].trim(); break; }
        // If we hit any other field, type might appear later but stop after a few non-type lines
      }
      providers.push({ key, type });
    }
  }

  return {
    activeProvider: activeMatch ? activeMatch[1].trim() : '',
    activeTtsProvider: activeTtsMatch ? activeTtsMatch[1].trim() : '',
    providers
  };
}

function getTtsProviders() {
  const parsed = parseProvidersFromEditor();
  return {
    activeProvider: parsed.activeProvider,
    activeTtsProvider: parsed.activeTtsProvider,
    ttsProviders: parsed.providers.filter(p => p.type && p.type.startsWith('tts_')),
    llmProviders: parsed.providers.filter(p => !p.type || !p.type.startsWith('tts_'))
  };
}

function refreshProviderPanel() {
  const { activeProvider, activeTtsProvider, ttsProviders, llmProviders } = getTtsProviders();

  // LLM select
  el.activeLlm.innerHTML = '';
  llmProviders.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.key;
    opt.textContent = p.key;
    el.activeLlm.appendChild(opt);
  });
  el.activeLlm.value = activeProvider;

  // TTS select
  el.activeTts.innerHTML = '';
  if (ttsProviders.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '(无 TTS Provider)';
    el.activeTts.appendChild(opt);
  } else {
    ttsProviders.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.key;
      opt.textContent = p.key;
      el.activeTts.appendChild(opt);
    });
  }
  el.activeTts.value = activeTtsProvider;

  // TTS cards
  renderTtsCards(ttsProviders);
}

function renderTtsCards(ttsProviders) {
  el.ttsCards.innerHTML = '';
  ttsProviders.forEach((p) => {
    const card = document.createElement('div');
    card.className = 'cv2-pp-card';

    const head = document.createElement('div');
    head.className = 'cv2-pp-card-head';
    const title = document.createElement('strong');
    title.textContent = p.key;
    const typeLabel = document.createElement('span');
    typeLabel.style.cssText = 'font-size:11px;color:var(--muted)';
    const typeInfo = TTS_PROVIDER_TYPES.find(t => t.value === p.type);
    typeLabel.textContent = typeInfo ? typeInfo.label : p.type;
    head.appendChild(title);
    head.appendChild(typeLabel);

    card.appendChild(head);
    el.ttsCards.appendChild(card);
  });
}

function setActiveLlm(key) {
  const text = el.editor.value;
  const updated = text.replace(/^active_provider:\s*.+$/m, `active_provider: ${key}`);
  if (updated !== text) {
    el.editor.value = updated;
    setStatus(`Active LLM 已切换为 ${key}`);
  }
}

function setActiveTts(key) {
  const text = el.editor.value;
  // Try to replace existing active_tts_provider line
  const hasLine = /^active_tts_provider:\s*.+$/m.test(text);
  if (hasLine) {
    el.editor.value = text.replace(/^active_tts_provider:\s*.+$/m, `active_tts_provider: ${key}`);
  } else {
    // Insert after active_provider line
    el.editor.value = text.replace(
      /^(active_provider:\s*.+)$/m,
      `$1\nactive_tts_provider: ${key}`
    );
  }
  setStatus(`Active TTS 已切换为 ${key}`);
}

function addTtsProviderFromPanel() {
  const type = window.prompt(
    '选择 TTS Provider 类型:\n\n' +
    TTS_PROVIDER_TYPES.map((t, i) => `${i + 1}. ${t.label} (${t.value})`).join('\n') +
    '\n\n请输入序号 (1-4):'
  );
  if (type === null) return;

  const idx = Number(type) - 1;
  const selected = TTS_PROVIDER_TYPES[idx];
  if (!selected) { setStatus('无效的选择', true); return; }

  const keyPrefix = selected.value.replace('tts_', '');
  // Generate unique key
  const parsed = getTtsProviders();
  const used = new Set(parsed.ttsProviders.map(p => p.key));
  let index = 1;
  let key = `${keyPrefix}_${index}`;
  while (used.has(key)) { index++; key = `${keyPrefix}_${index}`; }

  // Build YAML block for the new provider
  let yamlBlock = `\n  ${key}:\n    type: ${selected.value}\n`;

  // Add type-specific default fields
  switch (selected.value) {
    case 'tts_dashscope':
      yamlBlock += '    # DashScope (阿里百炼) TTS\n';
      yamlBlock += '    base_url: https://dashscope.aliyuncs.com/api/v1\n';
      yamlBlock += '    api_key_env: DASHSCOPE_API_KEY\n';
      yamlBlock += '    tts_model: qwen3-tts-vc-2026-01-22\n';
      yamlBlock += '    tts_voice: ""\n';
      yamlBlock += '    # realtime (可选，用于桌面端实时语音)\n';
      yamlBlock += '    tts_realtime_model: qwen3-tts-vc-realtime-2026-01-15\n';
      yamlBlock += '    tts_realtime_voice: Cherry\n';
      break;
    case 'tts_gpt_sovits':
      yamlBlock += '    # GPT-SoVITS 自部署 TTS\n';
      yamlBlock += '    base_url: http://127.0.0.1:9880\n';
      yamlBlock += '    tts_voice: default\n';
      yamlBlock += '    tts_language: zh\n';
      yamlBlock += '    endpoint: /tts\n';
      yamlBlock += '    speed: 1.0\n';
      yamlBlock += '    top_k: 5\n';
      yamlBlock += '    top_p: 1.0\n';
      yamlBlock += '    temperature: 1.0\n';
      yamlBlock += '    ref_audio_path: ""\n';
      yamlBlock += '    prompt_text: ""\n';
      yamlBlock += '    prompt_language: zh\n';
      break;
    case 'tts_edge':
      yamlBlock += '    # Edge TTS (微软免费，无需 API Key)\n';
      yamlBlock += '    tts_voice: zh-CN-XiaoxiaoNeural\n';
      yamlBlock += '    rate: "+0%"\n';
      yamlBlock += '    pitch: "+0Hz"\n';
      yamlBlock += '    volume: "+0%"\n';
      yamlBlock += '    output_format: audio-24khz-48kbitrate-mono-mp3\n';
      break;
    case 'tts_windows':
      yamlBlock += '    # Windows SAPI (离线，无需 API Key)\n';
      yamlBlock += '    tts_voice: Microsoft Huihui Desktop\n';
      yamlBlock += '    rate: 0\n';
      yamlBlock += '    volume: 100\n';
      break;
  }

  // Append before the first non-provider top-level key, or at the end
  const text = el.editor.value;
  const lines = text.split('\n');
  let insertIdx = lines.length;

  // Find the end of the providers section
  let inProviders = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^providers:\s*$/.test(lines[i].trim())) {
      inProviders = true;
      continue;
    }
    if (inProviders && /^[a-zA-Z]/.test(lines[i]) && !lines[i].startsWith(' ')) {
      insertIdx = i;
      break;
    }
  }

  lines.splice(insertIdx, 0, yamlBlock);
  el.editor.value = lines.join('\n');

  // Set as active TTS
  setActiveTts(key);
  refreshProviderPanel();
  setStatus(`已添加 TTS Provider: ${key} (${selected.label})`);
}

// ── Bootstrap ──────────────────────────────────────────────────────────────
function init() {
  initTheme();
  buildTabs();
  switchTab(TABS[0].id);

  el.loadBtn.addEventListener('click', loadTab);
  el.saveBtn.addEventListener('click', saveTab);
  el.gitRefreshBtn.addEventListener('click', () => { gitPage = 0; loadGitLog(); });
  el.gitPrevBtn.addEventListener('click', () => { if (gitPage > 0) { gitPage--; renderGitPage(); } });
  el.gitNextBtn.addEventListener('click', () => {
    const totalPages = Math.ceil(gitCommitsCache.length / GIT_PAGE_SIZE);
    if (gitPage < totalPages - 1) { gitPage++; renderGitPage(); }
  });
  el.agentSendBtn.addEventListener('click', sendAgentMessage);
  el.agentInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      sendAgentMessage();
    }
  });

  // Provider panel events
  el.activeLlm.addEventListener('change', () => setActiveLlm(el.activeLlm.value));
  el.activeTts.addEventListener('change', () => setActiveTts(el.activeTts.value));
  el.addTtsBtn.addEventListener('click', addTtsProviderFromPanel);

  initWs();
}

init();
