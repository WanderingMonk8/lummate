# Lummate

Lummate is an experimental Lumiverse extension project for tactile AI roleplay integration with XToys.

The project is currently focused on the Lumiverse-side architecture for:

- semantic parsing of erotic roleplay scenes
- participant-aware tactile planning
- per-user calibration of semantic action mappings
- held-state continuity between messages
- beat-by-beat playback orchestration from Lumiverse to XToys

## Current Status

This repository is now in early implementation.

The Phase 1 Lumiverse Spindle scaffold is working locally and has been verified in Lumiverse far enough to confirm:

- the extension installs successfully
- the frontend loads successfully
- a custom per-message action button can be injected into the native message action row
- frontend/backend messaging and runtime per-chat session plumbing are working
- a Lummate settings drawer is available for parser connection selection, XToys action-name mapping, and Lumiverse-side tactile calibration presets
- a first heuristic planner stub runs on Play and surfaces a visible per-message plan preview for verification

The project is still pre-LLM-parser and pre-XToys-runtime-integration, but the extension shell is now active, inspectable, and testable inside Lumiverse.

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

- expand the working scaffold into parser-aware message actions
- replace the heuristic planner stub with LLM-backed semantic parsing
- deepen semantic beat parsing and multi-beat message plan generation
- add participant profile caching and richer state parsing
- integrate XToys webhook command dispatch
