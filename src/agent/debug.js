/* Independent agent diagnostics. Loaded last so it still boots if Settings initialization fails. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const STORE = 'aiva_debug_events_v2';
  const LIMIT = 100;
  let events = [];
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORE) || '[]');
    if (Array.isArray(saved)) events = saved.slice(-LIMIT);
  } catch (error) {}

  function safeText(value, max) {
    return String(value == null ? '' : value).slice(0, max || 900);
  }
  function redact(value) {
    let result = safeText(value, 1200);
    try {
      const key = typeof window.apiKey === 'function' ? window.apiKey() : '';
      if (key && key.length > 5) result = result.split(key).join('[API_KEY_REDACTED]');
    } catch (error) {}
    return result
      .replace(/(?:sk-|Bearer\s+)[A-Za-z0-9._-]{12,}/gi, '[TOKEN_REDACTED]')
      .replace(/([?&](?:key|token|api_key)=)[^&\s]+/gi, '$1[REDACTED]');
  }
  function snapshot() {
    const value = id => $(id) ? safeText($(id).value, 150) : '';
    const checked = id => !!($(id) && $(id).checked);
    let provider = 'unknown';
    try { provider = window.AIVA_PROVIDER_SETTINGS ? window.AIVA_PROVIDER_SETTINGS.current() : 'DeepSeek'; } catch (error) {}
    const scenes = window.SPEC && Array.isArray(window.SPEC.scenes) ? window.SPEC.scenes.length : null;
    return {
      app: 'My Video Agent', capturedAt: new Date().toISOString(),
      page: location.origin + location.pathname, browser: navigator.userAgent,
      provider, model: value('model'),
      apiEndpoint: value('baseUrl').split('?')[0].replace(/\/$/, ''),
      apiKeyPresent: !!(typeof window.apiKey === 'function' && window.apiKey()),
      thinkingToggle: $('thinkingToggleState') ? $('thinkingToggleState').textContent : 'missing',
      thinkingSelect: value('thinking'),
      thinkingOverride: window.THINK_OVERRIDE == null ? null : window.THINK_OVERRIDE,
      modelOverride: window.MODEL_OVERRIDE == null ? null : window.MODEL_OVERRIDE,
      toolsEnabled: checked('useTools'), stageScenes: scenes,
      agentStatus: $('agentStatus') ? safeText($('agentStatus').textContent, 350) : '',
      currentStep: $('stepInfo') ? safeText($('stepInfo').textContent, 160) : ''
    };
  }
  function debugLog(event, details) {
    const record = { time: new Date().toISOString(), event: String(event || 'event'), details: details || {} };
    events.push(record);
    if (events.length > LIMIT) events = events.slice(-LIMIT);
    try { sessionStorage.setItem(STORE, JSON.stringify(events)); } catch (error) {}
    try { console.info('[My Video Agent]', record.event, record.details); } catch (error) {}
    renderDebugReport(false);
  }
  function reportText() {
    return [
      'MY VIDEO AGENT DEBUG REPORT',
      'Privacy: user prompt text, API keys, authorization headers and media are not included.',
      JSON.stringify(snapshot(), null, 2),
      'EVENT LOG (oldest first)',
      ...events.map(event => JSON.stringify(event))
    ].join(String.fromCharCode(10));
  }
  function renderDebugReport(open) {
    const panel = $('debugPanel'), output = $('debugOutput');
    if (!panel || !output) return;
    if (open) panel.hidden = false;
    if (!panel.hidden) output.value = reportText();
    if (panel.hidden) return;
    output.scrollTop = output.scrollHeight;
  }
  async function copyReport() {
    const output = $('debugOutput'), status = $('debugCopyStatus');
    if (!output) return;
    output.value = reportText();
    output.focus(); output.select(); output.setSelectionRange(0, output.value.length);
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(output.value);
        if (status) status.textContent = 'Copied. Paste the report into ChatGPT.';
      } else {
        const copied = document.execCommand('copy');
        if (!copied) throw new Error('Clipboard permission blocked.');
        if (status) status.textContent = 'Copied. Paste the report into ChatGPT.';
      }
    } catch (error) {
      if (status) status.textContent = 'Auto-copy was blocked. The report is visible below: press Ctrl+A, then Ctrl+C.';
      output.focus(); output.select(); output.setSelectionRange(0, output.value.length);
    }
    debugLog('debug_copy_clicked', { eventCount: events.length });
    renderDebugReport(true);
  }

  const openButton = $('btnCopyDebug');
  if (openButton) openButton.addEventListener('click', () => {
    debugLog('debug_panel_opened', { eventCount: events.length });
    renderDebugReport(true);
    copyReport();
  });
  if ($('btnRefreshDebug')) $('btnRefreshDebug').addEventListener('click', () => {
    renderDebugReport(true);
    if ($('debugCopyStatus')) $('debugCopyStatus').textContent = 'Log refreshed. Select the text below to copy manually.';
  });
  if ($('btnCopyDebugText')) $('btnCopyDebugText').addEventListener('click', copyReport);
  if ($('btnCloseDebug')) $('btnCloseDebug').addEventListener('click', () => {
    if ($('debugPanel')) $('debugPanel').hidden = true;
  });

  const previousFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    let request = null;
    try {
      if (url.includes('/chat/completions') && init && init.body) {
        const body = JSON.parse(init.body);
        request = {
          model: body.model || '', provider: snapshot().provider,
          thinking: body.thinking && body.thinking.type || 'OMITTED (provider default)',
          toolChoice: typeof body.tool_choice === 'string' ? body.tool_choice : (body.tool_choice ? 'named_function' : 'none'),
          tools: Array.isArray(body.tools) ? body.tools.map(tool => tool && tool.function && tool.function.name).filter(Boolean) : [],
          stream: !!body.stream, maxTokens: body.max_tokens || null,
          responseFormat: body.response_format && body.response_format.type || 'text'
        };
        debugLog('model_request', request);
      }
    } catch (error) {
      debugLog('request_log_error', { message: safeText(error && error.message || error, 250) });
    }
    const startedAt = Date.now();
    try {
      const response = await previousFetch(input, init);
      if (request) {
        debugLog('model_http_response', {
          status: response.status, ok: response.ok, durationMs: Date.now() - startedAt,
          contentType: response.headers.get('content-type') || ''
        });
        if (!response.ok) {
          response.clone().text().then(body => debugLog('model_api_error', {
            status: response.status, body: redact(body)
          })).catch(error => debugLog('api_error_read_failed', { message: safeText(error.message, 200) }));
        }
      }
      return response;
    } catch (error) {
      if (request) debugLog('model_fetch_failed', {
        name: error && error.name || '', message: safeText(error && error.message || error, 400)
      });
      throw error;
    }
  };

  if (typeof window.streamChat === 'function') {
    const originalStreamChat = window.streamChat;
    window.streamChat = async function(...args) {
      const startedAt = Date.now();
      try {
        const result = await originalStreamChat.apply(this, args);
        debugLog('stream_finished', {
          durationMs: Date.now() - startedAt,
          finishReason: result && result.finishReason || '',
          contentCharacters: String(result && result.content || '').length,
          reasoningCharacters: String(result && result.reasoning || '').length,
          toolCalls: result && Array.isArray(result.toolCalls) ? result.toolCalls.map(call => call.function && call.function.name || 'unknown') : [],
          chunks: result && result.chunks || 0, emptyFinal: !!(result && result.emptyFinal),
          usage: result && result.usage ? {
            promptTokens: result.usage.prompt_tokens || 0,
            completionTokens: result.usage.completion_tokens || 0,
            totalTokens: result.usage.total_tokens || 0
          } : null
        });
        return result;
      } catch (error) {
        debugLog('stream_failed', { name: error && error.name || '', message: redact(error && error.message || error) });
        throw error;
      }
    };
  }

  if (typeof window.runAgent === 'function') {
    const originalRunAgent = window.runAgent;
    window.runAgent = async function(userText) {
      debugLog('agent_task_started', { promptCharacters: String(userText || '').length });
      try {
        await originalRunAgent.apply(this, arguments);
        debugLog('agent_task_finished', {
          stageScenes: window.SPEC && Array.isArray(window.SPEC.scenes) ? window.SPEC.scenes.length : null,
          agentStatus: $('agentStatus') ? safeText($('agentStatus').textContent, 350) : ''
        });
      } catch (error) {
        debugLog('agent_task_failed', { name: error && error.name || '', message: redact(error && error.message || error) });
        throw error;
      }
    };
  }

  window.addEventListener('error', event => debugLog('browser_error', {
    message: safeText(event.message, 400),
    file: safeText(String(event.filename || '').split('?')[0].slice(-160), 160),
    line: event.lineno || null
  }));
  window.addEventListener('unhandledrejection', event => debugLog('unhandled_rejection', {
    message: redact(event.reason && event.reason.message || event.reason || 'Unknown rejection')
  }));
  debugLog('debug_booted', {
    copyButtonFound: !!openButton, panelFound: !!$('debugPanel'),
    streamChatHooked: typeof window.streamChat === 'function',
    runAgentHooked: typeof window.runAgent === 'function'
  });
})();