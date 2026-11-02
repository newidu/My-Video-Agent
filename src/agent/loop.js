/* Agent execution loop and multi-step tool orchestration. Extracted from original/source.html lines 4190-4373. */
/* ---------- the agent loop ---------- */
/* no step limit: the loop runs until the model stops calling tools (Stop button always works).
   SAFE_CAP only exists so a broken stream can never spin forever — it is far above any real run. */
const SAFE_CAP = 999;
/* Distinguish an actual creation/edit brief from a question about existing footage.
   Do not let a question mark inside a build brief disable the build path. */
function wantsVideo(text) {
  const value = String(text || '').trim();
  if (!value) return false;
  const action = /\b(create|make|generate|build|produce|design|render|edit|modify|change|add|remove|cut|trim|reframe|convert|turn into|animate|subtitle|caption|replace|shorten|extend)\b/i.test(value);
  if (action) return true;
  const startsAsQuestion = /^(?:what|why|how|who|which|explain|tell me|read|count|describe)\b/i.test(value);
  const asksAboutFootage = /\b(video|clip|footage|reel|short|promo|trailer|explainer|intro)\b/i.test(value);
  return !startsAsQuestion && asksAboutFootage && !/\?\s*$/.test(value);
}

/* run every tool call of one assistant turn, streaming its result into the chat */
async function execToolCalls(acc, cur, messages) {
  messages.push({ role: 'assistant', content: acc.content || null, tool_calls: acc.toolCalls });
  for (const tc of acc.toolCalls) {
    const name = tc.function && tc.function.name;
    const rawArgs = (tc.function && tc.function.arguments) || '{}';
    const resRow = addToolRow(cur.step, name || '?', rawArgs);
    let out;
    try {
      const args = rawArgs.trim() ? JSON.parse(rawArgs) : {};
      if (!TOOL_IMPL[name]) out = 'unknown tool: ' + name;
      else {
        const r = await TOOL_IMPL[name](args);
        if (r && typeof r === 'object' && (r.text || r.thumb)) {
          out = r.text;
          if (r.thumb) {
            const img = document.createElement('img');
            img.className = 'thumb';
            img.src = r.thumb;
            cur.step.appendChild(img);
          }
        } else out = (typeof r === 'string') ? r : JSON.stringify(r);
      }
    } catch (e) { out = 'tool error: ' + (e.message || e); }
    out = String(out === undefined ? '' : out);
    if (name !== 'read_skill') out = compactResult(name, rawArgs, out);
    if (out.length > TOOL_CAP) out = out.slice(0, TOOL_CAP) + ' …[truncated ' + (out.length - TOOL_CAP) + ' chars — ask for less or read again]';
    resRow.style.display = '';
    resRow.textContent = '→ ' + (out.length > 1400 ? out.slice(0, 1400) + ' …' : out);
    messages.push({ role: 'tool', tool_call_id: tc.id || ('call_' + name), content: out.slice(0, 12000) });
    $('chat').scrollTop = $('chat').scrollHeight;
  }
}

async function runAgent(userText) {
  const bubble = beginBotBubble();
  const newVideoBuild = SPEC.scenes.length === 0 && wantsVideo(userText);
  const allTools = $('useTools').checked ? toolSchema() : null;
  const buildToolNames = new Set(['replace_spec', 'get_project', 'read_skill', 'list_skill_files', 'verify_video', 'set_style', 'todo_write', 'find_tools', 'set_music', 'beat_map', 'sfx', 'critique', 'audit', 'grab_frame']);
  const tools = allTools ? (newVideoBuild ? allTools.filter(tool => buildToolNames.has(tool.function.name)) : allTools) : null;
  const messages = [{ role: 'system', content: systemPrompt() }]
    .concat(CHAT.filter(m => m.role === 'user' || m.role === 'assistant').slice(-10).map(m => ({ role: m.role, content: m.content })));
  if (newVideoBuild) {
    messages.push({
      role: 'system',
      content: 'NEW VIDEO BUILD MODE: the canvas is empty. Your FIRST tool call MUST be replace_spec with a complete valid video spec. Do not call todo_write or read_skill before the first build. Build first, then verify_video, read relevant skills and refine. Do not answer with a plan.'
    });
  }
  messages.push({ role: 'user', content: userText });

  let cur = beginStep(bubble);
  const render = acc => {
    if (acc.reasoning) {
      cur.think.style.display = '';
      cur.thinkBody.textContent = acc.reasoning;
      cur.think.scrollTop = cur.think.scrollHeight;
    }
    if (acc.content) cur.body.textContent = acc.content;
    $('chat').scrollTop = $('chat').scrollHeight;
  };

  ABORT = new AbortController();
  let finalText = '';
  let built = SPEC.scenes.length > 0;
  let lastPromptTokens = 0;
  try {
    let lastSig = '', repeat = 0;
    let buildHandledBeforeLoop = false;
    let buildFailedBeforeLoop = false;

    if (newVideoBuild && tools) {
      buildHandledBeforeLoop = true;
      cur = beginStep(bubble);
      cur.body.textContent = 'Building video…';
      $('stepInfo').textContent = 'creating first video pass';
      const firstBuild = await buildVideoWithRecovery(messages, tools, render, ABORT.signal, userText);
      addUsage(firstBuild && firstBuild.usage);
      if (firstBuild && firstBuild.toolCalls && firstBuild.toolCalls.length) {
        await execToolCalls(firstBuild, cur, messages);
        built = SPEC.scenes.length > 0;
        cur.body.textContent = built
          ? 'Created ' + SPEC.scenes.length + ' scene' + (SPEC.scenes.length === 1 ? '' : 's') + ' · ' + DUR.toFixed(1) + 's.'
          : 'The model returned a spec, but the editor did not create any scenes. Check the replace_spec tool result.';
      } else {
        cur.body.textContent = window.__LAST_TOOL_CALL_DIAGNOSTIC || 'The provider did not return a valid video spec.';
      }
      if (!built) {
        finalText = cur.body.textContent;
        buildFailedBeforeLoop = true;
      }
    }

    for (let step = buildHandledBeforeLoop ? 1 : 0; !buildFailedBeforeLoop && step < SAFE_CAP; step++) {
      if (step) cur = beginStep(bubble);
      window.STEP_NOTE = '';
      $('stepInfo').textContent = 'step ' + (step + 1) + (tools ? '' : ' · tools off');
      const reminder = [stateLine(), todoReminder()].filter(Boolean).join('\n');
      const wire = reminder ? messages.concat([{ role: 'system', content: reminder }]) : messages;
      /* thinking is the expensive part of a step: let the model plan once, then
         run the mechanical tool steps without it */
      window.THINK_OVERRIDE = newVideoBuild ? 'off' : ($('thinking').value === 'auto' ? (step === 0 ? 'on' : 'off') : null);
      /* step 0 plans on the picked model; routine tool steps are routed down */
      window.MODEL_OVERRIDE = step === 0 ? null : cheapModel($('model').value);
      const acc = await streamChat(wire, tools, render, ABORT.signal);
      if (window.STEP_NOTE) { $('stepInfo').textContent = 'step ' + (step + 1) + ' · ' + window.STEP_NOTE; }
      lastPromptTokens = (acc.usage && (acc.usage.prompt_tokens || 0)) || lastPromptTokens;
      addUsage(acc.usage);
      bubble.usage.textContent = usageLine(acc.usage) + (step ? ' · after ' + (step + 1) + ' steps' : '');

      if (acc.toolCalls && acc.toolCalls.length) {
        const sig = acc.toolCalls.map(tc => (tc.function && tc.function.name) + '(' + ((tc.function && tc.function.arguments) || '') + ')').join('|');
        repeat = sig === lastSig ? repeat + 1 : 0;
        lastSig = sig;
        await execToolCalls(acc, cur, messages);
        pruneTools(messages);
        built = SPEC.scenes.length > 0;
        if (lastPromptTokens > COMPACT_AT && messages.length > 10) {
          const before = messages.length;
          messages = await compactHistory(messages);
          lastPromptTokens = 0;
          addNote(cur.step, 'context compacted: ' + before + ' messages → ' + messages.length + ' (old tool results cleared, session summarised)');
        }
        if (repeat >= 3) {
          cur.body.textContent = 'Stopped the loop: the model repeated the same call 4 times in a row.';
          break;
        }
        continue;
      }

      finalText = acc.content || '';
      const asJson = tryJson(finalText);
      if (asJson && (asJson.spec || Array.isArray(asJson.scenes) || asJson.ops || asJson.action)) {
        if (asJson.say) cur.body.textContent = asJson.say;
        if (asJson.spec || Array.isArray(asJson.scenes)) {
          const directSpec = asJson.spec || asJson;
          if (typeof validVideoBuildSpec === 'function' && validVideoBuildSpec(directSpec)) {
            applyAgentResult({ action: 'replace', spec: directSpec, say: asJson.say || '' });
            finalText = asJson.say || '(video built from structured JSON)';
          } else {
            cur.body.textContent = 'The model returned JSON, but it is not a valid video spec. A spec must contain at least one scene with a duration and text/code elements.';
            finalText = cur.body.textContent;
            break;
          }
        } else {
          applyAgentResult(asJson);
          finalText = asJson.say || '(updated the video)';
        }
        built = SPEC.scenes.length > 0;
        break;
      }

      break;
    }

    const say = built
      ? (finalText || 'Built ' + SPEC.scenes.length + ' scene' + (SPEC.scenes.length === 1 ? '' : 's') + ' · ' + DUR.toFixed(1) + 's · ' + Math.round(DUR * 30) + ' frames.')
      : (finalText || '(no answer)');
    CHAT.push({ role: 'assistant', content: say });
    agentStatus(built ? 'Video built.' : 'Done.');
  } catch (e) {
    if (e && (e.name === 'AbortError' || /aborted/i.test(e.message || ''))) {
      cur.body.textContent = 'Stopped. (nothing was sent back to the model)';
      agentStatus('Stopped.');
      ABORT = null;
      BUSY = false; $('btnSend').disabled = false; $('btnStop').disabled = true;
      $('stepInfo').textContent = '';
      return;
    }
    cur.body.textContent = 'Request failed — ' + (e.message || e) +
      '\nIf it says "Failed to fetch", check the key, the base URL and any ad-blocker.';
    cur.body.classList.add('errline');
    agentStatus('Request failed.');
  } finally {
    ABORT = null;
    BUSY = false; $('btnSend').disabled = false; $('btnStop').disabled = true;
    $('stepInfo').textContent = '';
    $('chat').scrollTop = $('chat').scrollHeight;
  }
}

async function sendPrompt() {
  if (BUSY) return;
  const text = $('prompt').value.trim();
  if (!text) { agentStatus('Type what you want first.'); return; }
  if (!apiKey()) { agentStatus('Add an API key for the selected provider in Settings → Providers & models.'); return; }
  if (SPEC.scenes.length === 0 && wantsVideo(text) && !$('useTools').checked) {
    agentStatus('Turn on “Agent tools and action loop” in Settings → Agent to build videos.');
    return;
  }
  pushMsg('user', text);
  $('prompt').value = '';
  BUSY = true; $('btnSend').disabled = true; $('btnStop').disabled = false;
  agentStatus('Working…');
  await runAgent(text);
}
$('btnSend').onclick = sendPrompt;
$('btnStop').onclick = () => { if (ABORT) ABORT.abort(); agentStatus('Stopped.'); };
$('prompt').addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); sendPrompt(); }
});

