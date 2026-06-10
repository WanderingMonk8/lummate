# Lummate

Lummate is an experimental Lumiverse extension project for tactile AI roleplay integration with XToys.

The project is currently focused on the Lumiverse-side architecture for:

- semantic parsing of erotic roleplay scenes
- participant-aware tactile planning
- per-user calibration of semantic action mappings
- held-state continuity between messages
- beat-by-beat playback orchestration from Lumiverse to XToys

## Current Status

This repository is in the design and planning stage.

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

- scaffold the Spindle extension structure
- implement a first vertical slice of the Lumiverse frontend/backend flow
- add parser connection settings, participant profile caching, and action calibration
- integrate XToys webhook command dispatch
