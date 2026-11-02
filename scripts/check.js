#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'ui', 'index.html'), 'utf8');
const scriptPaths = [...html.matchAll(/<script src="([^"]+)"\s*><\/script>/g)].map(m => m[1]);
if (!scriptPaths.length) throw new Error('No ordered engine scripts found in ui/index.html');
const settingsScript = './redesign/settings.js';
const debugScript = '../src/agent/debug.js';
const engineScriptPaths = scriptPaths.filter(p => p !== settingsScript && p !== debugScript);
const required = [
 '../src/skills/skill-manifest.js','../src/canvas/primitives.js','../src/canvas/scene-engine.js',
 '../src/editor/interaction.js','../src/features/fonts.js','../src/features/audio-music.js',
 '../src/editor/history-and-audit.js','../src/agent/session-and-skills.js','../src/agent/tools.js',
 '../src/agent/model-streaming-context.js','../src/agent/loop.js','../src/agent/spec-bridge-and-boot.js'
];
if (JSON.stringify(engineScriptPaths) !== JSON.stringify(required)) throw new Error('Engine script load order changed. Review ui/index.html and README.md.');
if (scriptPaths[scriptPaths.length - 2] !== settingsScript || scriptPaths[scriptPaths.length - 1] !== debugScript) throw new Error('The Settings controller and independent debug script must load last.');
for (const relative of [...engineScriptPaths, settingsScript, debugScript]) {
  const file = path.resolve(root, 'ui', relative);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) throw new Error('Missing or unsafe script path: ' + relative);
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Syntax check failed: ${relative}\n${result.stderr || result.stdout}`);
}
const settingsCss = path.join(root, 'ui', 'redesign', 'settings.css');
if (!fs.existsSync(settingsCss)) throw new Error('Missing dedicated settings stylesheet.');
const cssText = fs.readFileSync(settingsCss,'utf8');
if ((cssText.match(/\{/g) || []).length !== (cssText.match(/\}/g) || []).length) throw new Error('Unbalanced braces in settings.css.');
const settingsHtmlIds = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map(m => m[1]);
const duplicateIds = [...new Set(settingsHtmlIds.filter((id, i) => settingsHtmlIds.indexOf(id) !== i))];
if (duplicateIds.length) throw new Error('Duplicate UI element IDs: ' + duplicateIds.join(', '));
for (const id of ['settingsView','btnCloseSettings','btnOpenSettings','providerPreset','apiKey','baseUrl','model','skillBox','toolSettingsList','musicBox','settingDefaultFormat','settingExportBitrate','manualModel','btnFontSettings','btnThinkingToggle','thinkingToggleState','btnCopyDebug','debugPanel','debugOutput','btnRefreshDebug','btnCopyDebugText','btnCloseDebug','debugCopyStatus']) {
 if (!settingsHtmlIds.includes(id)) throw new Error('Settings UI is missing required element: ' + id);
}
const legacyControls = html.match(/<div id="legacyEditorControls" hidden>([\s\S]*?)<\/div>/);
if (!legacyControls) throw new Error('Legacy engine controls must stay hidden outside the Settings UI.');
for (const id of ['formatSel','btnLetter','btnMusicOn','btnFont','btnRestart']) {
 if (!legacyControls[1].includes('id="' + id + '"')) throw new Error('Editor preference control must be hidden and managed in Settings: ' + id);
}
if (html.includes('id="btnOpenSkills"') || html.includes('id="btnMusic"')) throw new Error('A Settings-only shortcut is still visible in the editor.');
const settingsController = fs.readFileSync(path.join(root, 'ui', 'redesign', 'settings.js'),'utf8');
const modelStream = fs.readFileSync(path.join(root, 'src', 'agent', 'model-streaming-context.js'),'utf8');
const agentLoop = fs.readFileSync(path.join(root, 'src', 'agent', 'loop.js'),'utf8');
const agentTools = fs.readFileSync(path.join(root, 'src', 'agent', 'tools.js'),'utf8');
const agentSession = fs.readFileSync(path.join(root, 'src', 'agent', 'session-and-skills.js'),'utf8');
if (!modelStream.includes('async function buildVideoWithRecovery') || !modelStream.includes("choice: 'required'")) throw new Error('Video build recovery must live in the model transport and request required tool calls.');
if (!settingsController.includes('aiva_composer_thinking') || !settingsController.includes('function syncThinkingToggle') || !settingsController.includes('window.AIVA_COMPOSER_THINKING = () => thinkingEnabled')) throw new Error('Composer Thinking preference must be exposed to the engine.');
if (settingsController.includes('window.fetch = (input, init)')) throw new Error('Settings must not overwrite request-level thinking decisions.');
if (!modelStream.includes("b2.thinking = { type: 'disabled' }") || !modelStream.includes('window.AIVA_COMPOSER_THINKING()')) throw new Error('DeepSeek fallback must explicitly disable thinking and use the composer toggle.');
if (!modelStream.includes("const ROUTE_CHEAP = 'deepseek-flash'") || !settingsController.includes("model:'deepseek-flash'") || !html.includes('value="deepseek-flash"')) throw new Error('DeepSeek settings and routing must use the current official model ID.');
if (!agentLoop.includes('assistantTurn.reasoning_content = acc.reasoning')) throw new Error('DeepSeek reasoning_content must be preserved between tool calls.');
if (!agentLoop.includes('DeepSeek completed its thinking pass but returned no final response')) throw new Error('Reasoning-only responses must stop rather than silently repeating.');
const debugScriptText = fs.readFileSync(path.join(root, 'src', 'agent', 'debug.js'),'utf8');
if (!debugScriptText.includes('function renderDebugReport(open)') || !debugScriptText.includes("debugLog('model_request'") || !debugScriptText.includes("debugLog('stream_finished'") || !debugScriptText.includes('btnCopyDebugText')) throw new Error('Independent debug UI must render logs and support copying.');
if (settingsController.includes('installToolCallRecovery')) throw new Error('Model recovery must not be owned by the Settings UI.');
if (!modelStream.includes('responseFormat: { type: \'json_object\' }') || !modelStream.includes('validVideoBuildSpec')) throw new Error('JSON-output fallback and video spec validation are missing.');
if (!agentLoop.includes('buildVideoWithRecovery(messages, tools')) throw new Error('The agent loop does not call the first-class video build recovery.');
const runAgentStart = agentLoop.indexOf('async function runAgent');
const firstRecoveryCall = agentLoop.indexOf('buildVideoWithRecovery(messages, tools', runAgentStart);
const normalLoopStart = agentLoop.indexOf('for (let step =', runAgentStart);
if (firstRecoveryCall < 0 || normalLoopStart < 0 || firstRecoveryCall > normalLoopStart) throw new Error('A new empty-stage video must call replace_spec recovery before the normal chat/tool loop.');
if (agentLoop.includes('Nothing is on the stage yet — forcing the build.')) throw new Error('The old empty-stage forced-build path is still present.');
if (!agentLoop.includes("newVideoBuild ? 'off'")) throw new Error('New video builds must start with thinking disabled.');
if (!agentTools.includes('maximum 40 scenes per build') || !agentTools.includes('minItems: 1')) throw new Error('replace_spec payload validation/schema is incomplete.');
if (!agentSession.includes('NEW VIDEO FIRST') || agentSession.includes('1. PLAN FIRST.')) throw new Error('System prompt still contains conflicting first-action instructions.');

if (html.includes('project-tile') || html.includes('Untitled project')) throw new Error('Static project placeholder remains in the editor sidebar.');
if (html.includes('class="preview-toolbar"')) throw new Error('Redundant preview heading remains above the canvas.');
if (html.includes('id="btnRestart" class="subtle-button"')) throw new Error('Duplicate restart action remains in the top toolbar.');
const editorStart = html.indexOf('<main class="mainShell">');
const editorEnd = html.indexOf('</main>',editorStart);
const editorHtml = html.slice(editorStart,editorEnd);
if (editorHtml.includes('class="sidebar-label"') || editorHtml.includes('⌘ K')) throw new Error('Redundant editor sidebar labels or a non-wired keyboard hint remain.');
if (!editorHtml.includes('id="btnStart"') || !editorHtml.includes('id="scrub"') || !html.includes('id="btnPlay"')) throw new Error('Editor playback/timeline controls are incomplete.');
if (!html.includes('id="btnUndo"') || !html.includes('id="btnRedo"') || !html.includes('id="btnExport"') || !editorHtml.includes('id="btnSave"') || !editorHtml.includes('id="btnLoad"')) throw new Error('Editor project/export actions are incomplete.');
const settingsCssText = fs.readFileSync(settingsCss,'utf8');
for (const rule of ['.settings-view[hidden]','.mainShell[hidden]','body.settings-open > .app > .topbar']) {
 if (!settingsCssText.includes(rule)) throw new Error('Settings/Editor navigation rule missing: ' + rule);
}
const source = fs.readFileSync(path.join(root, 'original', 'source.html'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'skills', 'manifest.json'), 'utf8'));
for (const marker of ['function sendPrompt()', 'function syncSpec()', 'window.SKILL_FILES', 'window.SKILL_ORDER']) {
 if (!source.includes(marker)) throw new Error('Original source validation failed; missing ' + marker);
}
const sections = [
 ['/* ============================================================\n   CANVAS PRIMITIVES','/* ---------------- edit model ---------------- */','src/canvas/primitives.js'],
 ['/* ---------------- edit model ---------------- */','/* ============================================================\n   Editor UI — select / drag / edit / delete / export','src/canvas/scene-engine.js'],
 ['/* ============================================================\n   Editor UI — select / drag / edit / delete / export','/* ============================================================\n   FONT TOOL','src/editor/interaction.js'],
 ['/* ============================================================\n   FONT TOOL','/* ============================================================\n   MUSIC & BEAT','src/features/fonts.js'],
 ['/* ============================================================\n   MUSIC & BEAT','/* ============================================================\n   TOOLBOX','src/features/audio-music.js'],
 ['/* ============================================================\n   TOOLBOX','/* ============================================================\n   DEEPSEEK AGENT','src/editor/history-and-audit.js'],
 ['/* ============================================================\n   DEEPSEEK AGENT','/* ---------- tools ---------- */','src/agent/session-and-skills.js'],
 ['/* ---------- tools ---------- */','/* ---------- streaming model call ---------- */','src/agent/tools.js'],
 ['/* ---------- streaming model call ---------- */','/* ---------- the agent loop ---------- */','src/agent/model-streaming-context.js'],
 ['/* ---------- the agent loop ---------- */','/* ---------- applying the answer ---------- */','src/agent/loop.js'],
 ['/* ---------- applying the answer ---------- */','</script>','src/agent/spec-bridge-and-boot.js']
];
for (const [startMarker,endMarker,file] of sections) {
 const start = source.indexOf(startMarker);
 const end = source.indexOf(endMarker, start + startMarker.length);
 if (start < 0 || end < 0 || end <= start) throw new Error('Could not resolve source section markers for ' + file);
 const expected = source.slice(start, end);
 const actual = fs.readFileSync(path.join(root,file),'utf8').split(/\r?\n/).slice(1).join('\n');
 if (actual !== expected) throw new Error('Extracted code differs from original source section in ' + file + '. Keep original/source.html and the modular file synchronized.');
}
const skillStart = source.indexOf('window.SKILL_FILES = ') + 'window.SKILL_FILES = '.length;
const skillEnd = source.indexOf(';\nwindow.SKILL_ORDER = ', skillStart);
const originalSkills = JSON.parse(source.slice(skillStart, skillEnd));
if (manifest.order.length !== Object.keys(originalSkills).length) throw new Error('Skill count mismatch against original HTML.');
for (const skill of manifest.order) {
 const skillFile = path.join(root, 'skills', skill);
 if (!fs.existsSync(skillFile)) throw new Error('Skill missing: ' + skill);
 if (fs.readFileSync(skillFile,'utf8') !== originalSkills[skill]) throw new Error('Skill content changed: ' + skill);
}
console.log(`OK: ${engineScriptPaths.length} ordered engine scripts + settings controller syntax; unique UI IDs; ${manifest.order.length} exact skill files; all engine chunks match original source.`);
