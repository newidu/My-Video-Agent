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
const engineScriptPaths = scriptPaths.filter(p => p !== settingsScript);
const required = [
 '../src/skills/skill-manifest.js','../src/canvas/primitives.js','../src/canvas/scene-engine.js',
 '../src/editor/interaction.js','../src/features/fonts.js','../src/features/audio-music.js',
 '../src/editor/history-and-audit.js','../src/agent/session-and-skills.js','../src/agent/tools.js',
 '../src/agent/model-streaming-context.js','../src/agent/loop.js','../src/agent/spec-bridge-and-boot.js'
];
if (JSON.stringify(engineScriptPaths) !== JSON.stringify(required)) throw new Error('Engine script load order changed. Review ui/index.html and README.md.');
if (scriptPaths[scriptPaths.length - 1] !== settingsScript) throw new Error('The settings controller must load after the classic engine scripts.');
for (const relative of [...engineScriptPaths, settingsScript]) {
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
for (const id of ['settingsView','btnCloseSettings','btnOpenSettings','providerPreset','apiKey','baseUrl','model','skillBox','toolSettingsList','musicBox','settingDefaultFormat','settingExportBitrate','manualModel','btnFontSettings']) {
 if (!settingsHtmlIds.includes(id)) throw new Error('Settings UI is missing required element: ' + id);
}
const legacyControls = html.match(/<div id="legacyEditorControls" hidden>([\s\S]*?)<\/div>/);
if (!legacyControls) throw new Error('Legacy engine controls must stay hidden outside the Settings UI.');
for (const id of ['formatSel','btnLetter','btnMusicOn','btnFont','btnRestart']) {
 if (!legacyControls[1].includes('id="' + id + '"')) throw new Error('Editor preference control must be hidden and managed in Settings: ' + id);
}
if (html.includes('id="btnOpenSkills"') || html.includes('id="btnMusic"')) throw new Error('A Settings-only shortcut is still visible in the editor.');
const settingsController = fs.readFileSync(path.join(root, 'ui', 'redesign', 'settings.js'),'utf8');
if (!settingsController.includes('installToolCallRecovery') || !settingsController.includes("signal, 'required'")) throw new Error('Missing required-tool recovery for replace_spec.');
if (!settingsController.includes('__LAST_TOOL_CALL_DIAGNOSTIC')) throw new Error('Missing actionable tool-call failure diagnostics.');
const agentLoop = fs.readFileSync(path.join(root, 'src', 'agent', 'loop.js'),'utf8');
if (!agentLoop.includes('if (!built) break;')) throw new Error('Agent must stop cleanly after an unrecovered build tool call.');

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
 [334,521,'src/canvas/primitives.js'], [522,970,'src/canvas/scene-engine.js'],
 [971,1966,'src/editor/interaction.js'], [1967,2018,'src/features/fonts.js'],
 [2019,2527,'src/features/audio-music.js'], [2528,2920,'src/editor/history-and-audit.js'],
 [2921,3368,'src/agent/session-and-skills.js'], [3369,3951,'src/agent/tools.js'],
 [3952,4189,'src/agent/model-streaming-context.js'], [4190,4374,'src/agent/loop.js'],
 [4375,4526,'src/agent/spec-bridge-and-boot.js']
];
const sourceLines = source.split(/\r?\n/);
for (const [start,end,file] of sections) {
 const actual = fs.readFileSync(path.join(root,file),'utf8').split(/\r?\n/).slice(1).join('\n');
 const expected = sourceLines.slice(start-1,end).join('\n') + '\n';
 if (actual !== expected) throw new Error('Extracted code differs from original source in ' + file);
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
