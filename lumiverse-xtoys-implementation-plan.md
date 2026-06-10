# Lumiverse XToys Extension Implementation Plan

## Purpose

This document translates the working design into an implementation-oriented plan for the Lumiverse side of the XToys extension.

The goal is to move from product behavior and system rules into a practical build order, clear component boundaries, and implementation milestones.

## Scope

This plan focuses on the Lumiverse side of the extension:

- extension structure
- message-triggered parsing flow
- parser connection selection
- cached participant profiles
- current-state parsing
- semantic beat planning
- semantic action calibration
- held-state memory
- transition planning
- user settings and stale-plan tracking
- XToys command emission from Lumiverse

This plan does not attempt to fully implement the XToys-side script/runtime behavior yet.

## Primary Build Goal

Build a Lumiverse Spindle extension that can:

1. attach a `Play / Stop` control to assistant messages
2. parse a selected message on demand
3. derive or load cached participant profiles
4. resolve semantic beats into calibrated tactile plans
5. compare new plans against the current held state
6. schedule beat-by-beat execution from Lumiverse
7. emit XToys control events through a backend integration layer
8. maintain safety, caching, stale flags, and parser session state

## Suggested Build Phases

### Phase 1: Extension Skeleton

Goal:

- create the Lumiverse Spindle extension structure
- establish frontend/backend communication
- establish persistent storage and secure settings areas

Deliverables:

- extension manifest and basic registration
- frontend message action injection
- backend command handler
- typed shared message contracts
- persistent storage wrapper
- parser connection settings storage

Feasibility assessment:

- strongly supported by the Lumiverse developer guide
- Quick Start documents the required extension structure
- Manifest documents `spindle.json`
- Lifecycle documents install, enable, rebuild, and restart behavior
- frontend/backend messaging is first-class

### Phase 2: Core State Model

Goal:

- define the local data models used across the planner

Deliverables:

- `ParticipantProfile`
- `ParticipantState`
- `ActionCalibrationPreset`
- `SemanticBeat`
- `MessagePlan`
- `HeldState`
- `ParserSessionState`
- `PlanStalenessState`

Feasibility assessment:

- fully feasible
- mostly extension-owned TypeScript modeling work
- Lumiverse does not impose these data structures, which gives us flexibility

### Phase 3: Message-Level UI Controls

Goal:

- add the per-message `Play / Stop` control surface
- add breakout actions for `Regenerate` and playback mode selection

Deliverables:

- main `Play / Stop` toggle
- hover breakout on desktop
- long-press breakout on mobile
- message-level loading and stale indicators

Feasibility assessment:

- feasible, but not via a dedicated message-action API
- should be implemented through message-targeted DOM injection
- DOM Helper explicitly supports message-targeted injection with virtualization persistence
- this is one of the main custom UI areas in the project

### Phase 4: Parser Session and On-Demand Planning

Goal:

- implement the hidden parser arming model
- parse only on `Play`
- keep lightweight continuity tracking while armed

Deliverables:

- dormant / armed parser session state
- deactivation threshold handling
- later-message relevance tracking
- auto-disarm clearing held state and temporary continuity context

Feasibility assessment:

- feasible
- implemented through backend logic plus frontend/backend messaging
- generation event subscriptions are available if needed, but require the `generation` permission
- the hidden arm/disarm model is custom extension behavior

### Phase 5: Participant Profile Derivation and Caching

Goal:

- derive and cache participant tactile profiles
- support regeneration and stale invalidation

Deliverables:

- character profile derivation pipeline
- user profile derivation pipeline
- cached profile storage
- source fingerprinting
- manual regeneration support

Feasibility assessment:

- strongly supported
- `spindle.userStorage` gives per-user persistent storage for derived profiles and overrides
- this is a good fit for Lumiverse's storage model

### Phase 6: Current-State Parsing

Goal:

- infer the actor and actee current physical/emotional state from semantic context
- fall back to baseline values when not present

Deliverables:

- state extraction step in the parser pipeline
- baseline fallback logic
- state schema shared with the modulation layer
- parsed-state provenance and fallback markers

Feasibility assessment:

- feasible
- parser logic is custom, but Lumiverse supports backend generation calls and connection profile selection
- users can select a cheaper parser connection profile instead of using their main roleplay connection

### Phase 7: Semantic Beat Planner

Goal:

- parse a selected assistant message into ordered semantic beats

Deliverables:

- genital-contact scope filtering
- beat extraction
- duration class extraction
- continuity verdict extraction
- actor/actee weighting extraction
- response-mode extraction

Feasibility assessment:

- feasible
- backend can read chat messages through the documented chat mutation API
- the parsing logic itself is custom and will likely be the largest domain-specific piece

### Phase 8: Calibrated Tactile Resolution

Goal:

- convert semantic beats into Lumiverse-side tactile plans using user-calibrated action presets

Deliverables:

- action preset lookup
- fallback preset resolution
- XToys action-name mapping
- participant contribution calculation
- combined actor/actee result computation
- safety clamping

Feasibility assessment:

- feasible
- mostly extension-owned logic
- Lumiverse supports the settings, storage, and backend execution needed to implement it
- XToys action-name mapping is a user-defined contract layer, not something Lumiverse provides

### Phase 9: Transition and Held-State Controller

Goal:

- compare the new message plan against the current held state
- resolve `replace`, `modulate`, or `blend`

Deliverables:

- held-state memory
- persisted held-state snapshot per chat
- transition-mode selector
- composite-blend support
- end-of-playback resolver
- resume-previous-held logic

Feasibility assessment:

- feasible
- this is custom controller logic on the Lumiverse side
- per-chat persistence is supported through `userStorage`
- blend realism remains a tested constraint on the XToys side, but controller logic can still be implemented now

### Phase 10: Lumiverse Beat Scheduler

Goal:

- make Lumiverse the timing owner for beat-by-beat execution

Deliverables:

- beat scheduler
- beat cancellation
- loop and hold handling
- stop and panic-stop behavior
- playback completion callbacks

Feasibility assessment:

- feasible
- backend runtime is the natural place to own timers and beat sequencing
- no special Lumiverse scheduler API is required

### Phase 11: XToys Backend Integration Layer

Goal:

- emit one beat or control event at a time from Lumiverse to XToys

Deliverables:

- XToys webhook client
- backend request wrapper
- payload builder
- user-defined XToys action-name dispatch
- stop / hold / resume command emission
- logging and error reporting

Feasibility assessment:

- feasible
- best implemented through Lumiverse backend networking support
- XToys webhook communication is a good fit for a backend integration client
- exact payload behavior should still be validated against real XToys setups

### Phase 12: Staleness, Regeneration, and Settings

Goal:

- make cached plans and profiles robust as settings evolve

Deliverables:

- stale plan flagging rules
- stale indicators in UI
- regenerate-on-demand flow
- settings persistence
- parser-relevant versioning or revision counters
- stale-flagging on calibration/profile/settings changes

Feasibility assessment:

- strongly supported
- storage, UI settings surfaces, and message-level controls are all available
- stale-flag logic itself is custom but straightforward

## Proposed Module Breakdown

### Frontend

Suggested areas:

- `message-actions`
- `playback-controls`
- `breakout-menu`
- `settings-panel`
- `status-badges`

Responsibilities:

- render per-message controls
- surface stale/loading/playing states
- send actions to backend
- expose parser-connection settings
- expose action calibration UI

### Backend

Suggested areas:

- `parser-session-service`
- `parser-connection-service`
- `profile-cache-service`
- `state-parser-service`
- `semantic-beat-parser`
- `tactile-plan-resolver`
- `held-state-controller`
- `beat-scheduler`
- `xtoys-client`
- `staleness-service`

Responsibilities:

- own parsing and planning
- store persistent state
- manage playback timing
- emit XToys events

### Shared Types

Suggested areas:

- `participant-types`
- `beat-types`
- `plan-types`
- `settings-types`
- `xtoys-command-types`

## Lumiverse Capability Mapping

The implementation plan relies on these documented Lumiverse capabilities:

- extension structure via `spindle.json`, `src/backend.ts`, and `src/frontend.ts`
- backend/frontend messaging via `ctx.sendToBackend(...)`, `ctx.onBackendMessage(...)`, `spindle.onFrontendMessage(...)`, and `spindle.sendToFrontend(...)`
- message-level UI injection via `ctx.dom.findMessageElement(...)`, `ctx.dom.inject(...)`, and message-targeted virtualization persistence
- per-user persistence via `spindle.userStorage`
- chat message access via `spindle.chat.getMessages(chatId)` under the chat mutation API
- generation calls via `spindle.generate.raw(...)` and connection selection via `spindle.connections.list(...)`
- backend event subscriptions including generation and message lifecycle events

Expected gated permissions for v1:

- `generation`
- `chat_mutation`
- `cors_proxy`

Expected free-tier capabilities used by v1:

- events
- user storage
- secure enclave
- DOM
- frontend/backend messaging
- logging
- toast notifications

## Core Runtime Pipeline

The intended Lumiverse runtime pipeline should be:

1. assistant message finishes generating
2. user reads the message
3. user presses `Play`
4. backend loads message text and relevant chat context
5. backend loads the selected parser connection profile
6. backend loads cached participant profiles
7. backend parses semantic beats and continuity verdict
8. backend parses current participant state
9. backend loads calibrated action presets and XToys action-name mappings
10. backend resolves final tactile beats
11. backend compares against held state
12. backend selects transition mode
13. backend stores the message plan
14. backend persists or updates held-state context for the chat when needed
15. backend schedules beat-by-beat execution
16. backend emits XToys commands one beat at a time
17. backend resolves final idle / hold / resume / loop state

## Key Data Models

### ParticipantProfile

Should include:

- participant id
- display name
- source fingerprint
- derived mechanical axes
- user overrides
- updated timestamp

### ParticipantState

Should include:

- arousal-like values
- energy or fatigue-like values
- steadiness or shakiness-like values
- focus or overwhelm-like values
- parsed-from-message provenance
- fallback marker

### Parser Settings

Should include:

- parser connection profile id
- parser enabled or armed state defaults if needed
- deactivation threshold

### XToys Action Mapping Settings

Should include:

- semantic action type
- user-defined XToys action name
- optional fallback action name
- supported flag
- updated timestamp

### ActionCalibrationPreset

Should include:

- semantic action type
- supported flag
- fallback target
- xtoys action name
- base amplitude
- base tempo
- preferred execution profile
- preferred transition style
- repeat style
- hold tendency
- revision marker

### SemanticBeat

Should include:

- message id
- order index
- action type
- strength
- frequency
- duration class
- duration ms
- persistence
- response mode
- actor weight
- actee weight
- explicit change
- explicit stop

### MessagePlan

Should include:

- message id
- plan revision
- created timestamp
- playback mode
- stale flag
- semantic beats
- resolved beats
- continuity verdict
- transition mode
- stale reasons

### HeldState

Should include:

- action family
- resolved action preset
- resolved execution profile
- strength
- frequency
- persistence
- actor contribution
- actee contribution
- source message id
- chat id
- started at
- last updated at

### ParserSessionState

Should include:

- armed or dormant state
- consecutive non-relevant message count
- last relevant message id
- current held state reference
- temporary continuity memory

### ParserConnectionSettings

Should include:

- selected connection profile id
- fallback behavior when unset
- updated timestamp

## Recommended Implementation Order

The most practical implementation order is:

1. extension skeleton and storage
2. shared types and local state models
3. per-message `Play / Stop` UI
4. backend `Play` action plumbing
5. parser connection settings
6. parser session state
7. participant profile cache
8. semantic beat parser stub
9. action calibration preset loader
10. simple plan resolver
11. beat scheduler
12. XToys webhook emission
13. held-state persistence and transitions
14. stale plan tracking
15. regeneration controls

This order gives us a usable vertical slice early.

## Recommended First Vertical Slice

Before implementing the full design, build a minimal end-to-end version that proves the Lumiverse plumbing.

Suggested first slice:

1. add a message-level `Play` button
2. parse one selected message into a single simplified beat
3. use one selected parser connection profile
4. resolve that beat through one default calibrated action preset
5. send one XToys webhook event with a user-defined XToys action name
6. support `Stop`

Then expand to:

- multiple beats
- held state
- transition modes
- caching
- stale tracking

## Parser Strategy

The parser layer likely needs to be split into smaller steps:

1. contact relevance detection
2. participant extraction
3. beat extraction
4. current-state extraction
5. continuity verdict extraction

This will make the planner easier to debug than one monolithic prompt.

## Staleness Strategy

Any parser-relevant preset change should be able to mark old message plans as stale.

This should include:

- participant profile updates
- user profile updates
- action calibration changes
- parser connection changes
- duration-table changes
- smoothing changes
- safety cap changes

Likely implementation options:

- per-plan revision snapshots
- global parser-settings revision counter
- per-calibration revision counter

## Open Planning Questions

These are still planning questions, not blockers for starting the Lumiverse extension skeleton:

- exact file/folder structure for the Spindle extension
- whether parsing should be one prompt or several smaller prompt steps
- where calibration UI should live in the Lumiverse settings model
- whether the first playable slice should use a mocked XToys client
- what minimum chat context window should be sent into the semantic parser

## Definition of Done for Lumiverse V1

Lumiverse-side implementation can be considered functionally complete for v1 when:

1. the extension injects message-level playback controls
2. pressing `Play` creates a plan on demand
3. the planner uses a selected Lumiverse parser connection profile
4. the planner uses cached participant profiles and baseline fallback states
5. the planner resolves beats through calibrated action presets and XToys action-name mappings
6. Lumiverse schedules beats one at a time
7. XToys commands are emitted from Lumiverse backend code
8. held state and transition modes work for basic replace/modulate flows and survive chat reopening through persisted snapshots
9. stale plans are flagged when relevant presets change
10. `Stop` and safety shutdown behavior work reliably

## Immediate Next Step

After this planning document, the next implementation step should be:

1. inspect or scaffold the Lumiverse Spindle extension structure
2. create the shared state/type definitions
3. add the first message-level `Play` UI and backend action path
