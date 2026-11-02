/* Model transport, build recovery, context and task-list handling. Section boundaries are validated against original/source.html by scripts/check.js. */
/* ---------- streaming model call ---------- */
/* model routing (Claude-Code pattern): the expensive model thinks and plans,
   the cheap one grinds through the mechanical tool steps */
const MODEL_ROUTE_STORE = 'aiva_route';
const ROUTE_CHEAP = 'deepseek-flash';
function cheapModel(picked) { return /pro|reasoner|opus|sonnet|gpt-5|large/.test(String(picked || '')) ? ROUTE_CHEAP : null; }
async function streamChat(messages, tools, onState, signal, toolChoice, requestOptions) {
  requestOptions = requestOptions || {};
  const picked = $('model').value;
  const model = (window.MODEL_OVERRIDE && $('modelRoute') && $('modelRoute').checked) ? window.MODEL_OVERRIDE : picked;
  const body = {
    model: requestOptions.model || model, messages, stream: true,
    stream_options: { include_usage: true },
    temperature: requestOptions.temperature === undefined ? 0.6 : requestOptions.temperature,
    max_tokens: requestOptions.maxTokens || 6000
  };
  if (requestOptions.responseFormat) body.response_format = requestOptions.responseFormat;
  const forced = !!(toolChoice && toolChoice !== 'auto');
  if (tools && tools.length) { body.tools = tools; body.tool_choice = toolChoice || 'auto'; }

  // Explicit request/agent overrides always beat the composer preference.
  let think = requestOptions.thinking || window.THINK_OVERRIDE;
  if (!think && typeof window.AIVA_COMPOSER_THINKING === 'function') think = window.AIVA_COMPOSER_THINKING() ? 'on' : 'off';
  if (!think) think = $('thinking').value;
  if (think === 'on') body.thinking = { type: 'enabled' };
  else if (think === 'off') body.thinking = { type: 'disabled' };
  window.THINK_BLOCKED = window.THINK_BLOCKED || {};
  if (body.thinking && body.thinking.type === 'enabled' && window.THINK_BLOCKED[model]) body.thinking = { type: 'disabled' };
  if (forced && body.thinking && body.thinking.type === 'enabled') body.thinking = { type: 'disabled' };

  const post = requestBody => fetch(apiBase() + '/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey() },
    body: JSON.stringify(requestBody), signal
  });
  let res = await post(body);
  if (!res.ok) {
    let txt = await res.text();
    if (res.status === 400 && /think|tool_choice|function call/i.test(txt)) {
      window.THINK_BLOCKED[model] = true;
      agentStatus(model + ' rejected the thinking/tool-choice combination — retrying explicitly with Thinking OFF.');
      // DeepSeek enables thinking by default when this property is omitted.
      const b2 = JSON.parse(JSON.stringify(body));
      b2.thinking = { type: 'disabled' };
      res = await post(b2);
      if (res.ok) window.STEP_NOTE = 'Thinking explicitly disabled for this tool call';
      else {
        txt = await res.text();
        const b3 = JSON.parse(JSON.stringify(body));
        b3.thinking = { type: 'disabled' };
        b3.tool_choice = 'auto';
        res = await post(b3);
        if (res.ok) window.STEP_NOTE = 'Thinking OFF; tool choice relaxed to auto';
        else txt = await res.text();
      }
    }
    if (!res.ok) {
      const error = new Error('API ' + res.status + ': ' + redact(txt.slice(0, 700)));
      error.status = res.status;
      error.retryableToolMode = /tool_choice|function call|tool calling/i.test(txt);
      throw error;
    }
  }

  const acc = { content: '', reasoning: '', toolCalls: [], usage: null, finishReason: '', refusal: '', responseId: '', responseModel: '', chunks: 0, receivedDone: false };
  const textFrom = value => {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map(part => typeof part === 'string' ? part : (part && (part.text || part.content || '') || '')).join('');
    return '';
  };
  const mergeToolCalls = calls => {
    if (!Array.isArray(calls)) return;
    calls.forEach((tc, k) => {
      const index = tc.index === undefined ? k : tc.index;
      let slot = acc.toolCalls[index];
      if (!slot) slot = acc.toolCalls[index] = { id: '', type: 'function', function: { name: '', arguments: '' } };
      if (tc.id) slot.id = tc.id;
      if (tc.type) slot.type = tc.type;
      if (tc.function) {
        if (tc.function.name) slot.function.name += tc.function.name;
        if (tc.function.arguments) slot.function.arguments += tc.function.arguments;
      }
    });
  };
  const consumePayload = payload => {
    if (!payload || payload === '[DONE]') { if (payload === '[DONE]') acc.receivedDone = true; return; }
    let event;
    try { event = JSON.parse(payload); }
    catch (error) { acc.parseWarnings = (acc.parseWarnings || 0) + 1; return; }
    if (event.error) {
      const detail = typeof event.error === 'string' ? event.error : JSON.stringify(event.error);
      throw new Error('API stream error: ' + redact(detail.slice(0, 700)));
    }
    if (event.id) acc.responseId = event.id;
    if (event.model) acc.responseModel = event.model;
    if (event.usage) acc.usage = event.usage;
    const choice = event.choices && event.choices[0];
    if (!choice) { onState(acc); return; }
    const delta = choice.delta || choice.message || {};
    const reasoning = delta.reasoning_content !== undefined ? delta.reasoning_content : delta.reasoning;
    if (reasoning) acc.reasoning += textFrom(reasoning);
    if (delta.content !== undefined && delta.content !== null) acc.content += textFrom(delta.content);
    if (delta.refusal) acc.refusal += textFrom(delta.refusal);
    if (choice.finish_reason) acc.finishReason = choice.finish_reason;
    mergeToolCalls(delta.tool_calls);
    acc.chunks += 1;
    onState(acc);
  };

  if (!res.body) {
    const data = await res.json();
    if (data.error) throw new Error('API response error: ' + redact(JSON.stringify(data.error).slice(0, 700)));
    const choice = data.choices && data.choices[0];
    if (!choice || !choice.message) throw new Error('The API response did not contain choices[0].message.');
    const message = choice.message;
    acc.content = textFrom(message.content);
    acc.reasoning = textFrom(message.reasoning_content || message.reasoning);
    acc.refusal = textFrom(message.refusal);
    acc.toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    acc.finishReason = choice.finish_reason || '';
    acc.usage = data.usage || null;
    acc.responseId = data.id || '';
    acc.responseModel = data.model || '';
    onState(acc);
    return acc;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', ended = false;
  try {
    while (!ended) {
      const part = await reader.read();
      if (part.done) { ended = true; buffer += decoder.decode(); }
      else buffer += decoder.decode(part.value, { stream: true });
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line || line.startsWith(':') || !line.startsWith('data:')) continue;
        consumePayload(line.slice(5).trim());
      }
    }
    const tail = buffer.trim();
    if (tail && tail.startsWith('data:')) consumePayload(tail.slice(5).trim());
  } finally {
    try { reader.releaseLock(); } catch (error) {}
  }
  acc.toolCalls = acc.toolCalls.filter(Boolean);
  acc.content = String(acc.content || '').trim() ? acc.content : '';
  acc.emptyFinal = !acc.content.trim() && !acc.toolCalls.length;
  if (acc.emptyFinal && acc.reasoning.trim()) acc.emptyReasoning = true;
  return acc;
}

function tryJson(txt) {
  if (!txt) return null;
  let t = String(txt).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  if (t[0] !== '{') return null;
  try { return JSON.parse(t); } catch (e) { return null; }
}

function validVideoBuildSpec(spec) {
  return !!(
    spec && typeof spec === 'object' &&
    Array.isArray(spec.scenes) && spec.scenes.length > 0 && spec.scenes.length <= 40 &&
    spec.scenes.every(scene =>
      scene && typeof scene === 'object' &&
      Number.isFinite(Number(scene.dur)) && Number(scene.dur) > 0 &&
      Array.isArray(scene.elements) && scene.elements.length > 0 && scene.elements.length <= 40 &&
      scene.elements.every(element => element && (element.type === 'text' || element.type === 'code'))
    )
  );
}

function buildSpecFromResponse(result) {
  const parsed = result && tryJson(result.content);
  if (!parsed) return null;
  const spec = parsed.spec || (Array.isArray(parsed.scenes) ? parsed : null);
  if (!validVideoBuildSpec(spec)) return null;
  return { parsed, spec };
}

function isBuildRefusal(result) {
  if (!result) return false;
  if (result.refusal || result.finishReason === 'content_filter') return true;
  return /\bI(?:'m| am) sorry,?\s*(?:but\s+)?I (?:cannot|can't) (?:assist with|help with|provide that|create that|generate that)\b|\bI (?:cannot|can't) (?:assist with|help with|provide that|create that|generate that)\b/i.test(String(result.content || ''));
}

/* Recover the build in the agent transport itself, not in the Settings UI. */
async function buildVideoWithRecovery(messages, tools, onState, signal, originalUserText) {
  const buildTool = (tools || []).find(tool => tool && tool.function && tool.function.name === 'replace_spec');
  if (!buildTool) {
    window.__LAST_TOOL_CALL_DIAGNOSTIC = 'Video tools are disabled. Turn on Agent tools in Settings → Agent.';
    return { content: '', toolCalls: [], usage: null };
  }

  const systemMessage = (messages || []).find(message => message && message.role === 'system');
  const history = (messages || []).filter(message =>
    message && message !== systemMessage && (message.role === 'user' || message.role === 'assistant') &&
    typeof message.content === 'string'
  ).slice(-10);
  const base = [];
  if (systemMessage) base.push(systemMessage);
  base.push(...history);
  base.push({
    role: 'system',
    content:
      'BUILD RECOVERY: the previous answer did not create the video. Call replace_spec now. ' +
      'Do not answer with a plan or prose. Build a complete video with 3–6 scenes unless the user requests otherwise. ' +
      'Every scene must have numeric dur, bg and an elements array. Each element type must be text or code. ' +
      'Original request: ' + String(originalUserText || '').slice(0, 5000)
  });

  const previousThinking = window.THINK_OVERRIDE;
  const previousModel = window.MODEL_OVERRIDE;
  window.THINK_OVERRIDE = 'off';
  window.MODEL_OVERRIDE = null;
  window.__LAST_TOOL_CALL_DIAGNOSTIC = '';

  try {
    const attempts = [
      { label: 'required tool mode', choice: 'required' },
      { label: 'named function mode', choice: { type: 'function', function: { name: 'replace_spec' } } },
      { label: 'automatic single-tool mode', choice: 'auto' }
    ];
    let lastResult = null;
    let lastError = null;

    for (const attempt of attempts) {
      try {
        const result = await streamChat(base, [buildTool], onState, signal, attempt.choice, {
          thinking: 'off', maxTokens: 7000
        });
        lastResult = result;
        if ((result.toolCalls || []).some(call => call.function && call.function.name === 'replace_spec')) {
          window.STEP_NOTE = 'build recovered with ' + attempt.label;
          return result;
        }
        if (isBuildRefusal(result)) {
          window.__LAST_TOOL_CALL_DIAGNOSTIC = 'The provider returned a safety refusal: ' + String(result.refusal || result.content || '').slice(0, 240);
          return result;
        }
        const recovered = buildSpecFromResponse(result);
        if (!recovered && !(result.toolCalls || []).length && !String(result.content || '').trim() &&
            (String(result.reasoning || '').trim() || result.finishReason)) {
          const reason = result.finishReason || 'unknown';
          window.__LAST_TOOL_CALL_DIAGNOSTIC =
            'DeepSeek finished the thinking pass but returned no final answer or video tool call (finish_reason: ' + reason + '). ' +
            'The agent stopped instead of starting another thinking pass. Turn Thinking OFF and retry, or choose a model that supports tool calls.';
          window.STEP_NOTE = 'empty final response — stopped; no repeated thinking request';
          return result;
        }
        if (recovered) {
          window.STEP_NOTE = 'build recovered from structured JSON';
          return {
            content: recovered.parsed.say || '',
            reasoning: result.reasoning || '',
            toolCalls: [{
              id: 'call_json_recovered_replace_spec',
              type: 'function',
              function: { name: 'replace_spec', arguments: JSON.stringify({ spec: recovered.spec }) }
            }],
            usage: result.usage,
            finishReason: result.finishReason
          };
        }
      } catch (error) {
        if (error && (error.name === 'AbortError' || /aborted/i.test(error.message || ''))) throw error;
        lastError = error;
        if (!error.retryableToolMode && !(error.status === 400 && /tool|function/i.test(error.message || ''))) break;
      }
    }

    /* Compatibility path for models that can emit JSON but do not implement tools. */
    const jsonMessages = base.concat([{
      role: 'system',
      content:
        'Return only valid JSON, with no Markdown: {"spec":{"format":"9:16","scenes":[{"id":"s1","name":"Scene 1","dur":2.5,"bg":"#101820","elements":[{"type":"text","text":"...","x":540,"y":900,"size":100,"color":"#ffffff"}]}]}}. ' +
        'Create the complete video requested above now.'
    }]);
    try {
      let result;
      try {
        result = await streamChat(jsonMessages, null, onState, signal, null, {
          thinking: 'off', maxTokens: 7000, responseFormat: { type: 'json_object' }
        });
      } catch (formatError) {
        if (formatError && (formatError.name === 'AbortError' || /aborted/i.test(formatError.message || ''))) throw formatError;
        result = await streamChat(jsonMessages, null, onState, signal, null, {
          thinking: 'off', maxTokens: 7000
        });
      }
      if (isBuildRefusal(result)) {
        window.__LAST_TOOL_CALL_DIAGNOSTIC = 'The provider returned a safety refusal: ' + String(result.refusal || result.content || '').slice(0, 240);
        return result;
      }
      const recovered = buildSpecFromResponse(result);
      if (recovered) {
        window.STEP_NOTE = 'build recovered through JSON output mode';
        return {
          content: recovered.parsed.say || '',
          reasoning: result.reasoning || '',
          toolCalls: [{
            id: 'call_json_mode_replace_spec',
            type: 'function',
            function: { name: 'replace_spec', arguments: JSON.stringify({ spec: recovered.spec }) }
          }],
          usage: result.usage,
          finishReason: result.finishReason
        };
      }
      lastResult = result || lastResult;
    } catch (error) {
      if (error && (error.name === 'AbortError' || /aborted/i.test(error.message || ''))) throw error;
      lastError = error;
    }

    if (lastResult && isBuildRefusal(lastResult)) {
      window.__LAST_TOOL_CALL_DIAGNOSTIC = 'The provider refused this request: ' + String(lastResult.refusal || lastResult.content || '').slice(0, 240);
    } else if (lastError) {
      window.__LAST_TOOL_CALL_DIAGNOSTIC = 'Video build request failed: ' + String(lastError.message || lastError).slice(0, 320);
    } else {
      window.__LAST_TOOL_CALL_DIAGNOSTIC =
        'The selected model did not return a replace_spec tool call or a valid video JSON spec. ' +
        'Choose a model with tool-calling or JSON-output support.' +
        (lastResult && lastResult.content ? ' Last response: ' + String(lastResult.content).slice(0, 180) : '');
    }
    return lastResult || { content: '', toolCalls: [], usage: null };
  } finally {
    window.THINK_OVERRIDE = previousThinking;
    window.MODEL_OVERRIDE = previousModel;
  }
}

/* ---------- task list (TodoWrite pattern) ---------- */
let TODOS = [];
let TODO_EL = null;
function renderTodos(todos) {
  if (!todos.length) { if (TODO_EL) TODO_EL.remove(); TODO_EL = null; return; }
  const done = todos.filter(t => t.status === 'completed').length;
  const html = '<b>plan · ' + done + '/' + todos.length + '</b>' + todos.map(t => {
    const icon = t.status === 'completed' ? '✔' : t.status === 'in_progress' ? '▶' : '○';
    const cls = t.status === 'completed' ? 'done' : t.status === 'in_progress' ? 'act' : '';
    return '<div class="it ' + cls + '"><span>' + icon + '</span><span>' + esc(t.text) + '</span></div>';
  }).join('');
  if (!TODO_EL) {
    TODO_EL = document.createElement('div');
    TODO_EL.className = 'todo';
    const host = document.querySelector('.msg.bot:last-of-type');
    if (host) host.insertBefore(TODO_EL, host.querySelector('.usage'));
  }
  TODO_EL.innerHTML = html;
  $('chat').scrollTop = $('chat').scrollHeight;
}
function addNote(host, text) {
  const d = document.createElement('div');
  d.className = 'tres';
  d.style.display = '';
  d.textContent = '⟳ ' + text;
  host.appendChild(d);
  $('chat').scrollTop = $('chat').scrollHeight;
}
function esc(t) { return String(t === undefined ? '' : t).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function todoReminder() {
  if (!TODOS.length) return '';
  const now = TODOS.filter(t => t.status === 'in_progress').map(t => '“' + t.text + '”')[0] || 'none';
  const left = TODOS.filter(t => t.status !== 'completed').length;
  return '[todo list] ' + TODOS.map((t, i) => (i + 1) + '.' + (t.status === 'completed' ? '✔' : t.status === 'in_progress' ? '▶' : '○') + ' ' + t.text).join(' · ') +
    '  → working on: ' + now + ' · ' + left + ' left. Mark a task completed the moment it is done.';
}

/* ---------- context budget (Claude-Code style) ---------- */
const FILE_READS = {};      // path -> times read (read-once policy for skill files)
const TOOL_KEEP = 4;        // last N tool results stay verbatim (was 6)
const TOOL_CAP = 3000;      // chars kept from any single tool result (was 6000)
/* the model's window, not a magic number: compaction fires at 60% of it */
const MODEL_WINDOW = 128000;
const COMPACT_AT = Math.round(MODEL_WINDOW * 0.6);

/* strip the noise out of a tool result before it enters the context: empty
   fields, long arrays, float hair. Claude Code does this in a PreToolUse hook;
   we do it at the one place every result passes through. */
function trimJson(v, depth) {
  depth = depth || 0;
  if (Array.isArray(v)) {
    const arr = v.slice(0, 8).map(x => trimJson(x, depth + 1));
    if (v.length > 8) arr.push('…+' + (v.length - 8) + ' more');
    return arr;
  }
  if (v && typeof v === 'object') {
    const out = {};
    Object.keys(v).forEach(k => {
      const val = v[k];
      if (val === null || val === undefined || val === '' || (Array.isArray(val) && !val.length)) return;
      out[k] = trimJson(val, depth + 1);
    });
    return out;
  }
  if (typeof v === 'number' && !Number.isInteger(v)) return Math.round(v * 100) / 100;
  if (typeof v === 'string' && v.length > 400) return v.slice(0, 400) + '…';
  return v;
}
let LAST_RESULT = { key: '', content: '' };
function compactResult(name, argsRaw, out) {
  let s = String(out === undefined ? '' : out);
  const t = s.trim();
  if (t[0] === '{' || t[0] === '[') {
    try { s = JSON.stringify(trimJson(JSON.parse(t))); } catch (e) {}
  }
  s = s.replace(/[ \t]{2,}/g, ' ');
  const key = name + '(' + (argsRaw || '') + ')';
  if (key === LAST_RESULT.key && s === LAST_RESULT.content) return '[identical to your previous ' + name + ' result — nothing changed]';
  LAST_RESULT = { key, content: s };
  return s;
}

function pruneTools(messages) {
  let seen = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'tool') continue;
    seen++;
    if (seen > TOOL_KEEP) {
      const s = String(m.content);
      if (s.startsWith('[cleared')) continue;
      m.content = '[cleared] ' + s.slice(0, 80).replace(/\s+/g, ' ') + (s.length > 80 ? ' …' : '') +
        ' (' + s.length + ' chars dropped — call the tool again if you still need it)';
    }
  }
}
function stateLine() {
  const errs = Object.keys(window.CODE_ERRORS || {});
  return '[state] ' + SCENES.length + ' scene(s) · ' + DUR.toFixed(1) + 's · ' + Math.round(DUR * 30) +
    ' frames · ' + SPEC.format + ' · style: ' + (SPEC.style ? 'saved' : 'none') +
    ' · code errors: ' + (errs.length ? errs.join(', ') : 'none');
}
async function compactHistory(messages) {
  const keepUser = [...messages].reverse().find(m => m.role === 'user' && typeof m.content === 'string');
  const body = messages.slice(1).filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({ role: m.role, content: String(m.content || '').slice(0, 4000) }));
  const req = [{
    role: 'system',
    content: 'Compress this agent session into a handover note for a successor that must finish the same job. Keep, verbatim where it matters: the objective, the design decisions (palette, fonts, motion rules), scene/element ids that exist now, what failed and why, the open todo items. Max 200 words. No pleasantries.'
  }].concat(body);
  const acc = await streamChat(req, null, () => {}, ABORT.signal);
  addUsage(acc.usage);
  const summary = (acc.content || '').slice(0, 4000);
  return [
    messages[0],
    { role: 'user', content: '[compacted earlier session — your own handover note]\n' + summary },
    keepUser || { role: 'user', content: 'Continue the same job.' }
  ];
}

