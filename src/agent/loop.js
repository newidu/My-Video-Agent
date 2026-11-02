/* Video agent execution loop and first-build orchestration. Section boundaries are validated against original/source.html by scripts/check.js. */
/* ---------- the agent loop ---------- */
/* Bounded agent loop: a broken model cannot consume hundreds of requests by
   alternating repeated tool calls. The user can still stop any active request. */
const MAX_AGENT_STEPS = 32;
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


/* Deterministic task preflight: load actual skill text and create the visible
   todo list before the first build/edit request, rather than trusting the model
   to remember that the skill index is only an index. */
function selectTaskSkills(userText) {
  const q = String(userText || '').toLowerCase();
  const paths = ['video-generation/SKILL.md'];
  const add = path => { if (SKILL_FILES[path] && !paths.includes(path)) paths.push(path); };
  if (/ugc|influencer|creator|product demo|unboxing/.test(q)) add('video-generation/workflows/ugc-video.md');
  else if (/talking.?head|interview|presenter|face.?cam/.test(q)) add('video-generation/workflows/talking-head.md');
  else if (/slide|presentation|pitch deck/.test(q)) add('video-generation/workflows/slides-to-video.md');
  else if (/long.?form|long video|podcast|webinar|convert.*short|shorts from/.test(q)) add('video-generation/workflows/long-to-short.md');
  else if (/product launch|launch video|advert|ad campaign|marketing/.test(q)) {
    add('video-generation/workflows/product-launch.md');
    add('video-generation/workflows/marketing-growth.md');
  } else {
    add('video-generation/workflows/creative-shorts/00-preflight.md');
    add('video-generation/workflows/creative-shorts/01-concept-and-script.md');
    add('video-generation/workflows/creative-shorts/03-shot-design.md');
    add('video-generation/workflows/creative-shorts/05-editing.md');
  }
  if (/motion|kinetic|typography|animated text|title sequence|motion graphic/.test(q)) {
    add('video-generation/workflows/motion-graphics.md');
    add('video-generation/references/motion-graphics.md');
  }
  return paths.slice(0, 6);
}
function showDirectToolResult(host, name, args, result) {
  const row = addToolRow(host, name, JSON.stringify(args || {}));
  row.style.display = '';
  const value = String(result === undefined ? '' : result);
  row.textContent = '→ ' + (value.length > 1400 ? value.slice(0, 1400) + ' …' : value);
}
function updateAgentTodo(pattern, status, host) {
  if (!Array.isArray(TODOS) || !TODOS.length) return;
  const items = TODOS.map(item => ({ text: item.text, status: pattern.test(item.text) ? status : item.status }));
  const result = TOOL_IMPL.todo_write({ items });
  if (host) showDirectToolResult(host, 'todo_write', { items }, result);
}
function runAgentPreflight(userText, host, messages, isNewBuild) {
  const plan = [
    { text: 'Understand the brief and inspect the current project', status: 'completed' },
    { text: 'Read the relevant skill files', status: 'in_progress' },
    { text: isNewBuild ? 'Build the first complete video pass' : 'Apply the requested video changes', status: 'pending' },
    { text: 'Verify all scenes and fix visual or code issues', status: 'pending' },
    { text: 'Review the finished result and report completion', status: 'pending' }
  ];
  let result = TOOL_IMPL.todo_write({ items: plan });
  showDirectToolResult(host, 'todo_write', { items: plan }, result);
  const paths = selectTaskSkills(userText);
  const loaded = [];
  for (const path of paths) {
    const content = TOOL_IMPL.read_skill({ path });
    loaded.push({ path, content: String(content || '') });
    showDirectToolResult(host, 'read_skill', { path }, content);
  }
  const readyPlan = plan.map((item, i) => ({
    text: item.text,
    status: i < 2 ? 'completed' : i === 2 ? 'in_progress' : 'pending'
  }));
  result = TOOL_IMPL.todo_write({ items: readyPlan });
  showDirectToolResult(host, 'todo_write', { items: readyPlan }, result);
  messages[0].content += '\n\n===================== SKILLS READ FOR THIS TASK =====================\n' +
    loaded.map(item => '===== ' + item.path + ' =====\n' + item.content).join('\n\n') +
    '\n===================== END TASK SKILLS =====================';
  if (window.AIVA_DEBUG && window.AIVA_DEBUG.log) {
    window.AIVA_DEBUG.log('agent_preflight', { skillPaths: paths, todoCount: readyPlan.length, newVideoBuild: !!isNewBuild });
  }
  return paths;
}
function verificationIssues(reportText) {
  try {
    const report = JSON.parse(String(reportText || ''));
    return ['code_errors', 'blank_frames', 'low_contrast', 'off_frame', 'overlaps']
      .filter(key => Array.isArray(report[key]) && report[key].length)
      .map(key => key + ': ' + report[key].length);
  } catch (e) { return ['verification report could not be parsed']; }
}

/* run every tool call of one assistant turn, streaming its result into the chat */
async function execToolCalls(acc, cur, messages) {
  const assistantTurn = { role: 'assistant', content: acc.content || null, tool_calls: acc.toolCalls };
  // DeepSeek thinking + tools requires reasoning_content on the follow-up request.
  const provider = window.AIVA_PROVIDER_SETTINGS ? window.AIVA_PROVIDER_SETTINGS.current() : 'deepseek';
  if (provider === 'deepseek' && acc.reasoning) assistantTurn.reasoning_content = acc.reasoning;
  messages.push(assistantTurn);
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
  const buildToolNames = new Set(['replace_spec', 'get_project', 'read_skill', 'list_skill_files', 'verify_video', 'set_style', 'todo_write', 'find_tools', 'set_music', 'beat_map', 'sfx', 'critique', 'audit', 'grab_frame', 'apply_ops', 'add_element', 'set_text', 'remove_element', 'find_elements', 'check_code', 'snapshot', 'restore_snapshot', 'undo', 'redo', 'set_playhead', 'list_fonts', 'set_font', 'media_info', 'count_frames', 'export_video', 'export_poster']);
  const tools = allTools ? (newVideoBuild ? allTools.filter(tool => buildToolNames.has(tool.function.name)) : allTools) : null;
  let messages = [{ role: 'system', content: systemPrompt() }]
    .concat(CHAT.filter(m => m.role === 'user' || m.role === 'assistant').slice(-10).map(m => ({ role: m.role, content: m.content })));
  if (newVideoBuild) {
    messages.push({
      role: 'system',
      content: 'NEW VIDEO BUILD MODE: the canvas is empty. The task preflight has already created the todo list and loaded the relevant skill files. Now create a complete valid first-pass video with replace_spec, then verify it and refine until it passes.'
    });
  }
  messages.push({ role: 'user', content: userText });

  let cur = beginStep(bubble);
  const taskRequiresAgentLoop = !!(tools && wantsVideo(userText));
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
    if (taskRequiresAgentLoop) runAgentPreflight(userText, cur.step, messages, newVideoBuild);
    const signatureCounts = new Map();
    let loopGuardHit = false;
    let loopFinished = false;
    let hasVerified = false;
    let stepsExecuted = 0;
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
        if (built) {
          updateAgentTodo(/Build the first complete video pass/i, 'completed', cur.step);
          updateAgentTodo(/Verify all scenes and fix visual or code issues/i, 'in_progress', cur.step);
        }
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

    for (let step = buildHandledBeforeLoop ? 1 : 0; !buildFailedBeforeLoop && step < MAX_AGENT_STEPS; step++) {
      stepsExecuted = step + 1;
      if (step) cur = beginStep(bubble);
      window.STEP_NOTE = '';
      $('stepInfo').textContent = 'step ' + (step + 1) + (tools ? '' : ' · tools off');
      const reminder = [stateLine(), todoReminder()].filter(Boolean).join('\n');
      const wire = reminder ? messages.concat([{ role: 'system', content: reminder }]) : messages;
      /* thinking is the expensive part of a step: let the model plan once, then
         run the mechanical tool steps without it */
      const composerThinkingOn = typeof window.AIVA_COMPOSER_THINKING === 'function'
        ? window.AIVA_COMPOSER_THINKING()
        : ($('thinking').value === 'on' || ($('thinking').value === 'auto' && step === 0));
      window.THINK_OVERRIDE = newVideoBuild ? 'off' : (composerThinkingOn ? 'on' : 'off');
      /* step 0 plans on the picked model; routine tool steps are routed down */
      window.MODEL_OVERRIDE = step === 0 ? null : cheapModel($('model').value);
      const acc = await streamChat(wire, tools, render, ABORT.signal);
      if (window.STEP_NOTE) { $('stepInfo').textContent = 'step ' + (step + 1) + ' · ' + window.STEP_NOTE; }
      lastPromptTokens = (acc.usage && (acc.usage.prompt_tokens || 0)) || lastPromptTokens;
      addUsage(acc.usage);
      bubble.usage.textContent = usageLine(acc.usage) + (step ? ' · after ' + (step + 1) + ' steps' : '');

      if (acc.toolCalls && acc.toolCalls.length) {
        const sig = acc.toolCalls.map(tc => (tc.function && tc.function.name) + '(' + ((tc.function && tc.function.arguments) || '') + ')').join('|');
        const sameSignatureCount = (signatureCounts.get(sig) || 0) + 1;
        signatureCounts.set(sig, sameSignatureCount);
        if (sameSignatureCount >= 4) {
          loopGuardHit = true;
          finalText = 'Stopped safely: the agent repeated the same tool-call sequence four times. The remaining tasks are still visible in Todo.';
          cur.body.textContent = finalText;
          break;
        }
        const callNames = acc.toolCalls.map(tc => tc.function && tc.function.name);
        const lastVerifyIndex = callNames.lastIndexOf('verify_video');
        const lastMutationIndex = Math.max(...callNames.map((name, index) =>
          ['replace_spec', 'apply_ops', 'add_element', 'set_text', 'remove_element'].includes(name) ? index : -1));
        await execToolCalls(acc, cur, messages);
        if (lastVerifyIndex > lastMutationIndex) {
          const verifyResult = messages.slice(-callNames.length)[lastVerifyIndex];
          hasVerified = verificationIssues(verifyResult && verifyResult.content).length === 0;
        }
        if (lastMutationIndex >= lastVerifyIndex && lastMutationIndex >= 0) hasVerified = false;
        if (lastMutationIndex >= 0) updateAgentTodo(/Build the first complete video pass|Apply the requested video changes/i, 'completed', cur.step);
        if (hasVerified) updateAgentTodo(/Verify all scenes and fix visual or code issues/i, 'completed', cur.step);
        else if (lastVerifyIndex >= 0) updateAgentTodo(/Verify all scenes and fix visual or code issues/i, 'in_progress', cur.step);
        pruneTools(messages);
        built = SPEC.scenes.length > 0;
        if (lastPromptTokens > COMPACT_AT && messages.length > 10) {
          const before = messages.length;
          messages = await compactHistory(messages);
          lastPromptTokens = 0;
          addNote(cur.step, 'context compacted: ' + before + ' messages → ' + messages.length + ' (old tool results cleared, session summarised)');
        }
        continue;
      }

      finalText = acc.content || '';
      if (!finalText.trim() && !acc.toolCalls.length && (acc.reasoning || acc.finishReason)) {
        const reason = acc.finishReason || 'unknown';
        const providerName = window.AIVA_PROVIDER_SETTINGS && window.AIVA_PROVIDER_SETTINGS.label
          ? window.AIVA_PROVIDER_SETTINGS.label() : 'The selected provider';
        const thinkingAdvice = provider === 'deepseek'
          ? ' Turn Thinking OFF and retry, or select a model with a working final-answer/tool-call response.'
          : ' Retry the request or choose a model with a working final-answer/tool-call response.';
        finalText = providerName + ' (' + String($('model').value || 'selected model') + ') returned no final response (finish_reason: ' + reason + '). ' +
          'The agent stopped instead of repeating the request.' + thinkingAdvice;
        cur.body.textContent = finalText;
        if (window.AIVA_DEBUG && window.AIVA_DEBUG.log) {
          window.AIVA_DEBUG.log('agent_empty_final', {
            finishReason: reason, reasoningCharacters: String(acc.reasoning || '').length,
            contentCharacters: 0, toolCalls: 0
          });
        }
        loopFinished = true;
        break;
      }
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
            loopFinished = true;
            break;
          }
        } else {
          applyAgentResult(asJson);
          finalText = asJson.say || '(updated the video)';
        }
        built = SPEC.scenes.length > 0;
      }

      if (taskRequiresAgentLoop && built && !hasVerified) {
        const reportText = TOOL_IMPL.verify_video({});
        showDirectToolResult(cur.step, 'verify_video', {}, reportText);
        const issues = verificationIssues(reportText);
        messages.push({ role: 'system', content: 'MANDATORY AUTOMATIC VERIFICATION REPORT:\n' + String(reportText).slice(0, 9000) + '\nFindings: ' + (issues.length ? issues.join(', ') : 'none') + '. Fix all findings before you finish.' });
        if (issues.length) {
          updateAgentTodo(/Verify all scenes and fix visual or code issues/i, 'in_progress', cur.step);
          cur.body.textContent = 'Verification found issues (' + issues.join(', ') + '). Continuing to fix them.';
          finalText = '';
          continue;
        }
        hasVerified = true;
        updateAgentTodo(/Verify all scenes and fix visual or code issues/i, 'completed', cur.step);
        updateAgentTodo(/Review the finished result and report completion/i, 'completed', cur.step);
        finalText = (finalText ? finalText + '\n\n' : '') + 'Automated verification passed: no code errors, blank frames, low-contrast text, off-frame elements or overlaps were reported.';
      }

      loopFinished = true;
      break;
    }

    if (!loopFinished && !buildFailedBeforeLoop && (loopGuardHit || stepsExecuted >= MAX_AGENT_STEPS)) {
      finalText = finalText || ('Stopped safely after ' + MAX_AGENT_STEPS + ' agent steps. The remaining tasks are still visible in Todo; no further model calls were sent.');
      cur.body.textContent = finalText;
    }
    const say = built
      ? (finalText || 'Built ' + SPEC.scenes.length + ' scene' + (SPEC.scenes.length === 1 ? '' : 's') + ' · ' + DUR.toFixed(1) + 's · ' + Math.round(DUR * 30) + ' frames.')
      : (finalText || '(no answer)');
    CHAT.push({ role: 'assistant', content: say });
    agentStatus(loopGuardHit || (!loopFinished && stepsExecuted >= MAX_AGENT_STEPS) ? 'Stopped safely; review the remaining Todo items.' : (built ? 'Video built.' : 'Done.'));
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

