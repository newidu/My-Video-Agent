# UI/UX redesign

The active UI uses a Claude Code-inspired desktop workspace layout:
- left workspace navigation with project file actions and quick tools
- dedicated AI conversation pane with collapsible model/connection and skill settings
- live video canvas with a separate inspector panel
- warm charcoal surfaces, restrained terracotta accents, compact typography, keyboard-oriented controls

The design is an original implementation inspired by the interaction patterns and visual language of modern coding-agent workspaces. It does not copy Claude Code branding or assets.

## Integration contract

- The functional UI entry point remains `ui/index.html`.
- The redesign stylesheet is `ui/redesign/claude.css`; the original `ui/styles/base.css` is retained as the engine's compatibility baseline.
- All existing engine element IDs are preserved.
- The original classic engine scripts load in the same order. Do not convert them to ES modules without a separate migration.
- Keep editing, agent, canvas, audio, skills, and persistence logic in `src/` and `skills/`; this layer is presentation only.
- Model settings and skill pack remain available from the left navigation.
