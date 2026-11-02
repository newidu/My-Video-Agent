/* Full application settings: provider profiles, workspace preferences, themes and tool access. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const PREFIX = 'aiva_provider_';
  const PROVIDERS = {
    deepseek: { label:'DeepSeek', base:'https://api.deepseek.com', model:'deepseek-v4-flash', auth:true, description:'DeepSeek chat-completions API with its extended-thinking option.' },
    openai: { label:'OpenAI', base:'https://api.openai.com/v1', model:'gpt-4.1-mini', auth:true, description:'OpenAI-compatible Chat Completions API. Select an available model from your account.' },
    openrouter: { label:'OpenRouter', base:'https://openrouter.ai/api/v1', model:'openai/gpt-4.1-mini', auth:true, description:'OpenRouter unified model gateway. Use a model slug available to your account.' },
    groq: { label:'Groq', base:'https://api.groq.com/openai/v1', model:'llama-3.3-70b-versatile', auth:true, description:'Groq OpenAI-compatible endpoint. Model availability can change; load the current list.' },
    together: { label:'Together AI', base:'https://api.together.xyz/v1', model:'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo', auth:true, description:'Together AI OpenAI-compatible endpoint. Load models to confirm current IDs.' },
    fireworks: { label:'Fireworks AI', base:'https://api.fireworks.ai/inference/v1', model:'accounts/fireworks/models/llama-v3p3-70b-instruct', auth:true, description:'Fireworks OpenAI-compatible inference endpoint.' },
    mistral: { label:'Mistral AI', base:'https://api.mistral.ai/v1', model:'mistral-small-latest', auth:true, description:'Mistral chat-completions endpoint.' },
    xai: { label:'xAI', base:'https://api.x.ai/v1', model:'grok-3-mini', auth:true, description:'xAI OpenAI-compatible endpoint.' },
    gemini: { label:'Google Gemini', base:'https://generativelanguage.googleapis.com/v1beta/openai', model:'gemini-2.5-flash', auth:true, description:'Gemini through Google’s OpenAI-compatible endpoint. Use an AI Studio API key.' },
    deepinfra: { label:'DeepInfra', base:'https://api.deepinfra.com/v1/openai', model:'deepseek-ai/DeepSeek-V4-Flash-0731', auth:true, description:'DeepInfra OpenAI-compatible endpoint at /v1/openai. Use a DeepInfra token.' },
    cerebras: { label:'Cerebras', base:'https://api.cerebras.ai/v1', model:'gpt-oss-120b', auth:true, description:'Cerebras OpenAI-compatible Chat Completions endpoint.' },
    sambanova: { label:'SambaNova', base:'https://api.sambanova.ai/v1', model:'DeepSeek-V3.1', auth:true, description:'SambaNova Cloud OpenAI-compatible endpoint.' },
    nvidia: { label:'NVIDIA NIM', base:'https://integrate.api.nvidia.com/v1', model:'deepseek-ai/deepseek-v4-flash', auth:true, description:'NVIDIA NIM OpenAI-compatible chat-completions API.' },
    huggingface: { label:'Hugging Face', base:'https://router.huggingface.co/v1', model:'openai/gpt-oss-120b:fastest', auth:true, description:'Hugging Face Inference Providers OpenAI-compatible router. Use an HF access token.' },
    ollama: { label:'Ollama', base:'http://localhost:11434/v1', model:'llama3.2', auth:false, local:true, description:'Local Ollama server. Start Ollama and enable browser access from this app origin if CORS blocks requests.' },
    lmstudio: { label:'LM Studio', base:'http://localhost:1234/v1', model:'local-model', auth:false, local:true, description:'Local LM Studio OpenAI-compatible server. Start the local server before connecting.' },
    vllm: { label:'vLLM', base:'http://localhost:8000/v1', model:'your-model-id', auth:false, local:true, description:'Local or self-hosted vLLM OpenAI-compatible server.' },
    custom: { label:'Custom endpoint', base:'', model:'', auth:true, description:'Any service exposing the OpenAI-compatible /chat/completions and /models routes.' }
  };
  const NATIVE_ONLY = {
    anthropic:'Anthropic Messages API uses a different request and streaming protocol.',
    bedrock:'AWS Bedrock requires AWS identity/signature or its supported gateway integration.',
    vertex:'Google Vertex AI requires Google Cloud authentication and its native request adapter.',
    azure:'Azure OpenAI uses deployment-scoped URLs and api-key authentication.'
  };
  const memKeys = Object.create(null);
  let activeProvider = 'deepseek';
  let startupReady = false;
  let thinkingEnabled = false;
  const nativeFetch = window.fetch.bind(window);

  function profileKey(id, suffix) { return PREFIX + id + '_' + suffix; }
  function getStorage(key) { try { return localStorage.getItem(key) || ''; } catch (e) { return ''; } }
  function setStorage(key, value) { try { if (value === '' || value == null) localStorage.removeItem(key); else localStorage.setItem(key, String(value)); } catch (e) {} }
  function isLocal() { return !!(PROVIDERS[activeProvider] && PROVIDERS[activeProvider].local); }
  function providerLabel() { return (PROVIDERS[activeProvider] || {}).label || activeProvider; }
  function requiredKey() { return !!((PROVIDERS[activeProvider] || {}).auth); }
  function unsupportedNative() { return !!NATIVE_ONLY[activeProvider]; }
  function rawKey() {
    if (memKeys[activeProvider]) return memKeys[activeProvider];
    try {
      const injected = window.AIVA_SECRETS || {};
      if (injected[activeProvider]) return String(injected[activeProvider]);
      if (activeProvider === 'deepseek' && injected.deepseek) return String(injected.deepseek);
    } catch (e) {}
    if (activeProvider === 'deepseek') {
      const legacy = getStorage('aiva_key');
      if (legacy && $('rememberKey') && $('rememberKey').checked) return legacy;
    }
    return $('rememberKey') && $('rememberKey').checked ? getStorage(profileKey(activeProvider,'key')) : '';
  }
  function saveProfile() {
    const base = ($('baseUrl').value || '').trim().replace(/\/+$/, '');
    const model = ($('model').value || '').trim();
    setStorage(profileKey(activeProvider,'base'), base);
    setStorage(profileKey(activeProvider,'model'), model);
    if ($('rememberKey').checked) {
      const key = ($('apiKey').value || '').trim();
      memKeys[activeProvider] = key;
      setStorage(profileKey(activeProvider,'key'), key);
      if (activeProvider === 'deepseek') setStorage('aiva_key', key);
    } else {
      memKeys[activeProvider] = ($('apiKey').value || '').trim();
      setStorage(profileKey(activeProvider,'key'), '');
      if (activeProvider === 'deepseek') setStorage('aiva_key', '');
    }
    setStorage('aiva_provider', activeProvider);
    setStorage('aiva_remember', $('rememberKey').checked ? '1' : '0');
  }
  function loadProfile(id) {
    activeProvider = PROVIDERS[id] ? id : 'deepseek';
    const def = PROVIDERS[activeProvider];
    const base = getStorage(profileKey(activeProvider,'base')) || (activeProvider === 'deepseek' ? getStorage('aiva_base') || def.base : def.base);
    const model = getStorage(profileKey(activeProvider,'model')) || (activeProvider === 'deepseek' ? getStorage('aiva_model') || def.model : def.model);
    $('baseUrl').value = base || '';
    if (model) {
      if (![...$('model').options].some(o => o.value === model)) {
        const opt = document.createElement('option');
        opt.value = model; opt.textContent = model + ' (provider profile)';
        $('model').insertBefore(opt, $('model').firstChild);
      }
      $('model').value = model;
    } else {
      $('model').value = '';
    }
    const key = getStorage(profileKey(activeProvider,'key')) || (activeProvider === 'deepseek' ? getStorage('aiva_key') : '');
    $('apiKey').value = memKeys[activeProvider] || key || '';
    $('providerPreset').value = activeProvider;
    $('providerDescription').textContent = def.description;
    $('providerKeyHint').textContent = def.auth
      ? 'Saved separately for ' + def.label + '. Leave “Remember” off to keep the key in memory only.'
      : 'This local provider normally does not require a key. The app sends a placeholder bearer token if the server expects one.';
    $('apiKey').disabled = !def.auth;
    $('apiKey').placeholder = def.auth ? 'Paste ' + def.label + ' API key' : 'No API key required for this local provider';
    $('btnForgetKey').disabled = !def.auth;
    $('btnSaveKey').textContent = 'Save ' + def.label + ' profile';
    $('settingsProviderStatus').textContent = unsupportedNative() ? NATIVE_ONLY[activeProvider] : 'Active profile: ' + def.label;
    syncProviderOnlyControls();
    setStorage('aiva_provider',activeProvider);
  }
  function syncProviderOnlyControls() {
    const route = $('modelRoute');
    if (route) {
      const previous = getStorage('aiva_route_preference');
      if (activeProvider === 'deepseek') {
        route.disabled = false;
        if (previous !== '') route.checked = previous !== '0';
      } else {
        if (!route.disabled) setStorage('aiva_route_preference',route.checked ? '1' : '0');
        route.checked = false;
        route.disabled = true;
      }
    }
    const thinking = $('thinking');
    if (thinking) {
      thinking.disabled = activeProvider !== 'deepseek';
      thinking.title = activeProvider === 'deepseek' ? 'DeepSeek extended-thinking request option' : 'Extended thinking is currently provider-specific to DeepSeek.';
    }
    syncThinkingToggle();
  }

  function syncThinkingToggle() {
    const button = $('btnThinkingToggle');
    if (!button) return;
    const label = $('thinkingToggleState');
    const supported = activeProvider === 'deepseek';
    button.disabled = !supported;
    button.setAttribute('aria-pressed', thinkingEnabled ? 'true' : 'false');
    button.classList.toggle('is-on', thinkingEnabled);
    if (label) label.textContent = thinkingEnabled ? 'ON' : 'OFF';
    button.title = supported
      ? 'Extended thinking is ' + (thinkingEnabled ? 'ON' : 'OFF') + '. Click to switch it ' + (thinkingEnabled ? 'off' : 'on') + '.'
      : 'Thinking toggle is currently supported only by the DeepSeek provider.';
  }

  /* Reuse the existing credential object so the original Save/Forget controls and
     model-request code continue to use the currently selected profile. */
  SECRETS.fromHost = () => {
    try {
      const injected = window.AIVA_SECRETS || {};
      return String(injected[activeProvider] || (activeProvider === 'deepseek' ? injected.deepseek : '') || '');
    } catch (e) { return ''; }
  };
  SECRETS.fromUrl = () => {
    if (activeProvider !== 'deepseek') return '';
    try {
      const key = new URLSearchParams(location.search).get('key');
      if (key) { history.replaceState(null,'',location.pathname); memKeys.deepseek = key.trim(); return memKeys.deepseek; }
    } catch (e) {}
    return '';
  };
  SECRETS.stored = () => getStorage(profileKey(activeProvider,'key')) || (activeProvider === 'deepseek' ? getStorage('aiva_key') : '');
  SECRETS.get = () => memKeys[activeProvider] || SECRETS.fromHost() || SECRETS.fromUrl() || (($('rememberKey') && $('rememberKey').checked) ? SECRETS.stored() : '') || '';
  SECRETS.set = value => {
    const key = String(value || '').trim();
    memKeys[activeProvider] = key;
    setStorage(profileKey(activeProvider,'key'), $('rememberKey').checked ? key : '');
    if (activeProvider === 'deepseek') setStorage('aiva_key', $('rememberKey').checked ? key : '');
  };
  SECRETS.clear = () => {
    delete memKeys[activeProvider];
    $('apiKey').value = '';
    setStorage(profileKey(activeProvider,'key'),'');
    if (activeProvider === 'deepseek') setStorage('aiva_key','');
  };
  SECRETS.has = () => !!SECRETS.get();

  /* Function declarations from the original classic scripts are global bindings.
     Replace only the provider lookup functions; leave the engine modules untouched. */
  window.apiKey = () => {
    if (isLocal()) return 'local-provider';
    return SECRETS.get() || (($('apiKey') && $('apiKey').value) || '').trim();
  };
  window.apiBase = () => (($('baseUrl') && $('baseUrl').value) || '').trim().replace(/\/+$/,'');
  window.redact = value => {
    let text = String(value == null ? '' : value);
    const secret = rawKey();
    if (secret && secret.length > 8) text = text.split(secret).join('[redacted]');
    return text.replace(/(?:sk-|Bearer\s+)[A-Za-z0-9._-]{16,}/gi,'[redacted]');
  };
  window.AIVA_PROVIDER_SETTINGS = {
    current: () => activeProvider,
    label: () => providerLabel(),
    needsKey: () => requiredKey(),
    isLocal: () => isLocal(),
    isSupported: () => !unsupportedNative(),
    list: () => Object.keys(PROVIDERS).map(id => ({ id, label:PROVIDERS[id].label, base:PROVIDERS[id].base, auth:PROVIDERS[id].auth, local:!!PROVIDERS[id].local })),
    getProfile: () => ({ provider:activeProvider, baseUrl:$('baseUrl').value, model:$('model').value })
  };

  /* A compatible endpoint may reject DeepSeek-only extensions; normalize requests
     without changing the engine's streaming parser or its tool-call behavior. */
  window.fetch = (input, init) => {
    try {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (init && init.body && /\/chat\/completions(?:\?|$)/.test(url)) {
        const body = JSON.parse(init.body);
        if (activeProvider === 'deepseek') {
          const forcedToolCall = !!(body.tool_choice && body.tool_choice !== 'auto');
          body.thinking = { type: thinkingEnabled && !forcedToolCall ? 'enabled' : 'disabled' };
        } else {
          delete body.thinking;
          delete body.stream_options;
        }
        init = Object.assign({},init,{body:JSON.stringify(body)});
      }
    } catch (e) {}
    return nativeFetch(input,init);
  };

  const originalAgentStatus = window.agentStatus;
  if (typeof originalAgentStatus === 'function') {
    window.agentStatus = message => {
      let value = String(message || '');
      value = value.replace('Paste your DeepSeek API key (sk-…) above and press Save.', 'Add an API key for ' + providerLabel() + ' in Settings → Providers & models, then save the profile.');
      originalAgentStatus(value);
    };
  }

  function setStatus(message, success) {
    const el = $('settingsProviderStatus');
    if (!el) return;
    el.textContent = message;
    el.dataset.state = success ? 'success' : 'error';
  }
  function showPanel(name) {
    const target = document.querySelector('[data-settings-panel="'+name+'"]');
    if (!target) return;
    document.querySelectorAll('[data-settings-panel]').forEach(panel => panel.classList.toggle('active',panel===target));
    document.querySelectorAll('[data-settings-target]').forEach(button => button.classList.toggle('active',button.dataset.settingsTarget===name));
    const content = document.querySelector('.settings-content');
    if (content) content.scrollTop = 0;
  }
  function openSettings(panel) {
    const view = $('settingsView'), editor = document.querySelector('.mainShell');
    if (!view || !editor) return;
    view.hidden = false;
    editor.hidden = true;
    document.body.classList.add('settings-open');
    showPanel(panel || 'general');
  }
  function closeSettings() {
    const view = $('settingsView'), editor = document.querySelector('.mainShell');
    if (!view || !editor) return;
    editor.hidden = false;
    view.hidden = true;
    document.body.classList.remove('settings-open');
    const opener = $('btnOpenSettings');
    if (opener) opener.focus({ preventScroll: true });
  }

  const thinkingPreference = getStorage('aiva_composer_thinking');
  thinkingEnabled = thinkingPreference === '1';
  const thinkingToggle = $('btnThinkingToggle');
  if (thinkingToggle) {
    thinkingToggle.addEventListener('click',() => {
      if (activeProvider !== 'deepseek') return;
      thinkingEnabled = !thinkingEnabled;
      setStorage('aiva_composer_thinking',thinkingEnabled ? '1' : '0');
      syncThinkingToggle();
    });
    syncThinkingToggle();
  }

  $('providerPreset').addEventListener('change',() => {
    saveProfile();
    loadProfile($('providerPreset').value);
  });
  $('baseUrl').addEventListener('change',saveProfile);
  $('model').addEventListener('change',saveProfile);
  $('btnSetManualModel').addEventListener('click',() => {
    const id = $('manualModel').value.trim();
    if (!id) { setStatus('Enter a model ID first.',false); return; }
    let option = [...$('model').options].find(item => item.value === id);
    if (!option) {
      option = document.createElement('option');
      option.value = id;
      option.textContent = id + ' (manual)';
      $('model').insertBefore(option,$('model').firstChild);
    }
    $('model').value = id;
    saveProfile();
    setStatus('Selected model '+id+'.',true);
  });
  $('manualModel').addEventListener('keydown',event => {
    if (event.key === 'Enter') { event.preventDefault(); $('btnSetManualModel').click(); }
  });
  $('apiKey').addEventListener('change',() => { memKeys[activeProvider] = $('apiKey').value.trim(); });
  const savedRemember = getStorage('aiva_remember');
  const legacyRemember = getStorage('aiva_key_remember');
  $('rememberKey').checked = savedRemember === '' ? legacyRemember !== '0' : savedRemember !== '0';
  $('rememberKey').addEventListener('change',() => {
    setStorage('aiva_remember',$('rememberKey').checked ? '1' : '0');
    if (!$('rememberKey').checked) {
      setStorage(profileKey(activeProvider,'key'),'');
      if (activeProvider==='deepseek') setStorage('aiva_key','');
      memKeys[activeProvider] = ($('apiKey').value || '').trim();
    } else saveProfile();
  });
  $('btnSaveKey').addEventListener('click',() => {
    saveProfile();
    setStatus('Saved profile for '+providerLabel()+'. The active editor will use this endpoint.',true);
  });
  $('btnForgetKey').addEventListener('click',() => {
    setStatus('Removed the saved key for '+providerLabel()+'.',true);
  });
  $('btnModels').addEventListener('click',() => {
    setStatus('Requesting model list from '+providerLabel()+'…',true);
  });

  document.querySelectorAll('[data-settings-target]').forEach(button => button.addEventListener('click',() => openSettings(button.dataset.settingsTarget)));
  document.querySelectorAll('[data-open-settings]').forEach(button => button.addEventListener('click',() => openSettings(button.dataset.openSettings)));
  $('btnOpenSettings').onclick = () => openSettings('general');
  $('btnCloseSettings').onclick = closeSettings;
  $('btnFontSettings').onclick = () => $('btnFont').click();

  /* Theme preference shared by Settings, editor, inspector and sidebars. */
  function applyTheme(theme) {
    const allowed = ['warm-dark','graphite','light'];
    const value = allowed.includes(theme) ? theme : 'warm-dark';
    document.body.dataset.theme = value;
    try { localStorage.setItem('aiva_theme',value); } catch (e) {}
    document.querySelectorAll('input[name="settingTheme"]').forEach(el => { el.checked = el.value === value; });
  }
  document.querySelectorAll('input[name="settingTheme"]').forEach(el => el.addEventListener('change',() => applyTheme(el.value)));
  applyTheme(getStorage('aiva_theme') || 'warm-dark');

  /* Startup destination. */
  const startup = $('settingStartupView');
  startup.value = getStorage('aiva_startup_view') || 'editor';
  startup.addEventListener('change',() => setStorage('aiva_startup_view',startup.value));

  /* Editor defaults: these controls write to the original editor controls rather than
     introducing a second independent copy of the editor state. */
  const format = $('settingDefaultFormat');
  const savedDefaultFormat = getStorage('aiva_default_format');
  format.value = savedDefaultFormat || $('formatSel').value || '9:16';
  if (savedDefaultFormat && $('formatSel').value !== savedDefaultFormat) {
    $('formatSel').value = savedDefaultFormat;
    $('formatSel').dispatchEvent(new Event('change',{bubbles:true}));
  }
  format.addEventListener('change',() => setStorage('aiva_default_format',format.value));
  $('formatSel').addEventListener('change',() => {
    format.value = $('formatSel').value;
    setStorage('aiva_default_format',$('formatSel').value);
  });
  $('btnApplyDefaultFormat').onclick = () => {
    $('formatSel').value = format.value;
    $('formatSel').dispatchEvent(new Event('change',{bubbles:true}));
    const s = $('advancedStatus');
    if (s) s.textContent = 'Applied '+format.value+' to the current project.';
  };
  const letter = $('settingLetterMode');
  const letterButton = $('btnLetter');
  const readLetter = () => /ON/i.test(letterButton.textContent);
  letter.checked = readLetter();
  letter.addEventListener('change',() => {
    if (letter.checked !== readLetter()) letterButton.click();
    setStorage('aiva_letter_mode',letter.checked?'1':'0');
  });
  letterButton.addEventListener('click',() => {
    letter.checked = readLetter();
    setStorage('aiva_letter_mode',letter.checked?'1':'0');
  });
  if (getStorage('aiva_letter_mode') !== '') {
    const wanted = getStorage('aiva_letter_mode') === '1';
    if (wanted !== readLetter()) letterButton.click();
    letter.checked = wanted;
  }
  const grid = $('settingShowBeatGrid');
  grid.checked = getStorage('aiva_show_beat_grid') !== '' ? getStorage('aiva_show_beat_grid') === '1' : !!$('musGrid').checked;
  if (getStorage('aiva_show_beat_grid') !== '') {
    $('musGrid').checked = grid.checked;
    $('musGrid').dispatchEvent(new Event('change',{bubbles:true}));
  }
  grid.addEventListener('change',() => {
    $('musGrid').checked = grid.checked;
    $('musGrid').dispatchEvent(new Event('change',{bubbles:true}));
    setStorage('aiva_show_beat_grid',grid.checked?'1':'0');
  });
  $('musGrid').addEventListener('change',() => {
    grid.checked = $('musGrid').checked;
    setStorage('aiva_show_beat_grid',grid.checked?'1':'0');
  });

  /* Persist and apply export bitrate to the editor's existing MediaRecorder export path. */
  const bitrate = $('settingExportBitrate');
  bitrate.value = getStorage('aiva_export_bitrate') || '9000000';
  window.AIVA_EXPORT_SETTINGS = { videoBitsPerSecond: Number(bitrate.value) || 9000000 };
  bitrate.addEventListener('change',() => {
    window.AIVA_EXPORT_SETTINGS.videoBitsPerSecond = Number(bitrate.value) || 9000000;
    setStorage('aiva_export_bitrate',bitrate.value);
  });
  if (window.MediaRecorder && !window.MediaRecorder.__aivaWrapped) {
    const NativeRecorder = window.MediaRecorder;
    const RecorderProxy = new Proxy(NativeRecorder,{
      construct(target,args,newTarget) {
        const options = Object.assign({},args[1] || {});
        options.videoBitsPerSecond = window.AIVA_EXPORT_SETTINGS.videoBitsPerSecond || 9000000;
        return Reflect.construct(target,[args[0],options],newTarget);
      },
      get(target,property) {
        const value = Reflect.get(target,property,target);
        return typeof value === 'function' && property === 'isTypeSupported' ? value.bind(target) : value;
      }
    });
    try { Object.defineProperty(RecorderProxy,'__aivaWrapped',{value:true}); } catch (e) {}
    window.MediaRecorder = RecorderProxy;
  }

  /* Keep the provider model-routing preference scoped to DeepSeek only. */
  $('modelRoute').addEventListener('change',() => setStorage('aiva_route_preference',$('modelRoute').checked?'1':'0'));

  /* Skills filtering keeps the original skill selection UI and persistence. */
  $('skillSearch').addEventListener('input',() => {
    const q = $('skillSearch').value.trim().toLowerCase();
    $('skillList').querySelectorAll('label').forEach(row => { row.hidden = !!q && !row.textContent.toLowerCase().includes(q); });
  });

  /* Read the actual tool registry from the engine; core edit/recovery tools are locked on. */
  function toolRows() {
    const root = $('toolSettingsList');
    if (!root) return;
    root.innerHTML = '';
    let names = [];
    try { names = Object.keys(TOOL_IMPL).filter(name => name !== 'find_tools').sort(); } catch (e) {}
    names.forEach(name => {
      const core = CORE_TOOLS.indexOf(name) >= 0;
      const row = document.createElement('label');
      row.className = 'tool-setting-row';
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.checked = core || isActiveTool(name);
      check.disabled = core;
      check.addEventListener('change',() => {
        if (core) return;
        if (check.checked) activateTool(name);
        else {
          delete ACTIVE_TOOLS[name];
          try { localStorage.setItem('aiva_active_tools',JSON.stringify(ACTIVE_TOOLS)); } catch (e) {}
        }
      });
      const copy = document.createElement('div');
      const title = document.createElement('b');
      title.textContent = name.replace(/_/g,' ');
      const desc = document.createElement('p');
      desc.textContent = (TOOL_HELP[name] || 'Optional agent capability.').split(/(?<=\.)\s/)[0].slice(0,180);
      copy.appendChild(title); copy.appendChild(desc);
      row.appendChild(check); row.appendChild(copy);
      if (core) {
        const badge = document.createElement('span');
        badge.className = 'tool-core-badge'; badge.textContent = 'Core';
        row.appendChild(badge);
      }
      root.appendChild(row);
    });
  }
  $('btnResetTools').onclick = () => {
    resetActiveTools();
    toolRows();
  };

  /* Credentials and preference reset are separate. Neither deletes video project files. */
  $('btnClearCredentials').onclick = () => {
    if (!confirm('Clear all remembered provider API keys from this browser?')) return;
    Object.keys(localStorage).filter(key => key.startsWith(PREFIX) && key.endsWith('_key')).forEach(key => localStorage.removeItem(key));
    localStorage.removeItem('aiva_key');
    Object.keys(memKeys).forEach(key => delete memKeys[key]);
    $('apiKey').value = '';
    setStatus('All remembered provider keys have been cleared.',true);
    $('advancedStatus').textContent = 'Provider keys cleared. Other preferences and project files were kept.';
  };
  $('btnResetPreferences').onclick = () => {
    if (!confirm('Reset My Video Agent preferences, saved provider profiles and tool selections on this browser? Project JSON files will not be deleted.')) return;
    Object.keys(localStorage).filter(key => key.startsWith('aiva_')).forEach(key => localStorage.removeItem(key));
    window.location.reload();
  };

  loadProfile(getStorage('aiva_provider') || 'deepseek');
  const saveButton = $('btnSaveKey');
  if (saveButton) {
    const oldClick = saveButton.onclick;
    saveButton.onclick = event => {
      if (unsupportedNative()) { setStatus(NATIVE_ONLY[activeProvider],false); return; }
      if (oldClick) oldClick.call(saveButton,event);
      saveProfile();
      setStatus('Saved '+providerLabel()+' profile.',true);
    };
  }
  const forgetButton = $('btnForgetKey');
  if (forgetButton) {
    const oldClick = forgetButton.onclick;
    forgetButton.onclick = event => {
      if (oldClick) oldClick.call(forgetButton,event);
      setStatus('Forgot the '+providerLabel()+' key.',true);
    };
  }
  const oldModelsClick = $('btnModels').onclick;
  $('btnModels').onclick = async event => {
    if (unsupportedNative()) { setStatus(NATIVE_ONLY[activeProvider],false); return; }
    if (requiredKey() && !window.apiKey()) { setStatus('Add and save an API key before loading models.',false); return; }
    setStatus('Loading model IDs from '+providerLabel()+'…',true);
    if (oldModelsClick) await oldModelsClick.call($('btnModels'),event);
    const status = $('agentStatus').textContent || 'Model listing finished.';
    setStatus(status,true);
  };

  /* Ensure provider-specific labels and active profile are reflected in the app. */
  const providerChange = () => {
    const def = PROVIDERS[activeProvider];
    if (!def || !def.auth) return;
    if (activeProvider !== 'deepseek') $('agentStatus').textContent = 'Connected profile: '+providerLabel()+'. Enter a prompt to use model '+$('model').value+'.';
  };
  $('providerPreset').addEventListener('change',providerChange);
  toolRows();
  startupReady = true;
  if (startup.value === 'settings') openSettings('general');
  else closeSettings();

  document.addEventListener('keydown',event => {
    if (event.key !== 'Escape' || $('settingsView').hidden) return;
    const target = event.target;
    if (target && /INPUT|TEXTAREA|SELECT/.test(target.tagName)) return;
    event.preventDefault();
    closeSettings();
  });
})();
