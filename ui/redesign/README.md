# UI/UX redesign

The application now has a dedicated, Claude Code-inspired Settings workspace alongside the video editor.

## Settings sections

- **General** — startup destination and workspace navigation.
- **Appearance** — warm charcoal, graphite and light themes.
- **Video editor** — default aspect ratio, letter selection, beat-grid preference and export bitrate.
- **Providers & models** — independent API key, base URL and model profiles for DeepSeek, OpenAI, OpenRouter, Groq, Together AI, Fireworks AI, Mistral, xAI, Google Gemini's OpenAI-compatible endpoint, DeepInfra, Cerebras, SambaNova, NVIDIA NIM, Hugging Face Inference Providers, Ollama, LM Studio, vLLM and custom OpenAI-compatible endpoints.
- **Skills** — bundled skill selection and index-only mode.
- **Agent** — reasoning mode, DeepSeek Flash routing, tool-loop toggle and session controls.
- **Tools** — active optional tool inventory; core editing and recovery tools are locked on.
- **Audio & music** — the existing music, beat and sound-effect controls.
- **Advanced** — local storage information, credential clearing, preference reset and shortcuts.

## Provider compatibility

The current agent transport uses the OpenAI-compatible Chat Completions protocol. Provider profiles save their own base URL, model ID and optional API key. For providers that support the compatible protocol, requests are sent to `/chat/completions` and model discovery uses `/models`.

DeepSeek-specific thinking and Flash routing are only sent when DeepSeek is selected. Non-DeepSeek compatible requests omit those DeepSeek-only fields. Local Ollama, LM Studio and vLLM profiles do not require an API key.

Anthropic's native Messages API, AWS Bedrock, Google Vertex AI and Azure-specific authentication are shown as planned integrations, not as supported drop-in providers. They require separate native protocol or authentication adapters. Custom OpenAI-compatible gateways can be used where configured.

This project currently connects text/agent model providers. It does not yet expose native API credentials or integrations for third-party video generation, image generation, transcription or TTS services. The current video composition is rendered through the app's canvas editor; music and beat synthesis use the existing local audio engine. Export quality is adjustable through the browser's MediaRecorder bitrate option; frame capture currently runs at the editor's fixed 30 fps.

## Security

Remembered API keys are stored in browser `localStorage` on the current device and are not encrypted by this UI. Keep “Remember API key” off on shared devices. A secure OS credential vault or server-side secret proxy is a separate integration.

## Integration contract

- The active app entry point remains `ui/index.html`.
- `ui/redesign/claude.css` styles the agent-first desktop workspace.
- `ui/redesign/settings.css` styles the full-screen settings area and themes.
- `ui/redesign/settings.js` handles view navigation, provider profiles, preferences and optional tool toggles.
- Existing engine element IDs are preserved without duplicates.
- The original 12 classic engine scripts remain in their existing order. The settings controller is loaded after them.
- Keep the canvas, agent, editor, music, and skills behavior in their original engine files unless a separately tested engine change is necessary.
