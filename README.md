# Lummate

Lummate is a Lumiverse extension for tactile AI roleplay integration with XToys.

The project is currently focused on the Lumiverse-side architecture for:

- semantic parsing of erotic roleplay scenes
- participant-aware tactile planning
- per-user calibration of semantic action mappings
- held-state continuity between messages
- beat-by-beat playback orchestration from Lumiverse to XToys

## Current Status

This repository is now release-ready for the current v1 scope.

The Lumiverse-side extension has been verified in Lumiverse far enough to confirm:

- the extension installs successfully
- the frontend loads successfully
- a custom per-message action button can be injected into the native message action row
- frontend/backend messaging and runtime per-chat session plumbing are working
- per-message breakout controls work on desktop hover and mobile long-press
- the hidden parser-session arming/disarming lifecycle is implemented
- a Lummate settings drawer is available for parser connection selection, XToys action-name mapping, and Lumiverse-side tactile calibration presets
- participant tactile profiles are derived, cached, regenerable, and reused
- group chats can cache more than one character profile when Lumiverse exposes the participant roster
- tracked participant selection is available per chat, with persisted contact-zone targeting
- Play now produces runtime message plans with ordered semantic/resolved beats
- current physical/emotional state parsing is implemented with baseline fallback
- the parser can use structured LLM output with deterministic zone-scoped fallback
- contact filtering now respects tracked participant ownership, tracked contact zones, and multi-participant scene context
- calibrated tactile resolution is now active, including preset fallback, XToys action-name mapping, participant contribution modulation, and safety-clamped resolved beats
- tactile calibration changes now affect resolved beat output
- runtime-only held-state continuity is now active, including entry-beat transition selection and end-of-playback resolution for replace/modulate/basic blend flows
- Lumiverse-side beat scheduling is now active, including beat-by-beat timer ownership, cancellation, loop handling, hold completion, and runtime scheduler-state verification
- XToys webhook delivery now follows the working private-webhook action-trigger path, including quantized `low` / `medium` / `high` action dispatch with optional intensity and ramp fields

The parser still mixes LLM output with deterministic fallback logic while the scene-matching rules are being tuned. Blend behavior is still a Lumiverse-side heuristic for now rather than a true XToys-side concurrent execution model. But the Lumiverse-side shell, state model, tracked-participant flow, profile cache, held-state controller, scheduler, and XToys compatibility delivery path are now active and usable inside Lumiverse.

## Version

Current release: `1.0.0`

The main working documents are:

- [lumiverse-xtoys-extension-design.md](./lumiverse-xtoys-extension-design.md) — end-to-end product and systems design
- [lumiverse-xtoys-implementation-plan.md](./lumiverse-xtoys-implementation-plan.md) — Lumiverse-side implementation breakdown

## Project Direction

The planned extension will:

1. attach playback controls to Lumiverse assistant messages
2. parse selected scenes on demand rather than auto-play on generation
3. resolve semantic scene actions into calibrated tactile plans
4. use Lumiverse as the sequencing controller
5. send XToys control events through a backend integration layer

## Near-Term Goals

- keep tightening tracked-participant and tracked-zone parsing across mixed multi-party scenes
- refine held-state transition heuristics, especially where concurrent actions may look like blend vs replace
- tighten the quantized XToys action contract and script examples
- reduce dependence on deterministic parser fallback as structured parser coverage improves
- deepen the calibrated contribution model and expose clearer resolution diagnostics where needed
- revisit deferred XToys-side live modulation and multi-toy routing after real-device feedback
