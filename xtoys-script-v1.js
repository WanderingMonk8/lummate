/*
  Lummate XToys Trigger Matrix Reference

  This file is a setup reference for the preferred v1 XToys contract.

  Preferred v1 model:
  - Lummate sends one webhook event at a time
  - the payload includes an "action" field
  - the action string already includes the intensity band
  - XToys reacts by matching that action string directly

  Example beat actions:
  - thrust-low
  - thrust-medium
  - thrust-high

  Optional extra fields:
  - intensity
  - seconds

  Those extra fields can be used in XToys expressions if desired, but the main
  contract is the action string itself.

  Recommended XToys setup:
  1. Create one Private Webhook block.
  2. Use the private webhook ID in Lummate settings.
  3. For each action string below, create a matching XToys trigger/action.
  4. Connect each trigger/action to the prebuilt pattern or toy behavior you want.
  5. Optionally use "intensity" and "seconds" inside XToys expressions.

  Recommended beat trigger/action names:
  - tease-low
  - tease-medium
  - tease-high
  - stroke-low
  - stroke-medium
  - stroke-high
  - thrust-low
  - thrust-medium
  - thrust-high
  - suction-low
  - suction-medium
  - suction-high
  - grind-low
  - grind-medium
  - grind-high
  - pulse-low
  - pulse-medium
  - pulse-high
  - lick-low
  - lick-medium
  - lick-high
  - squeeze-low
  - squeeze-medium
  - squeeze-high
  - pause-low
  - pause-medium
  - pause-high

  Recommended control action names:
  - stop
  - hold
  - resume
  - panicstop

  Example payloads from Lummate:

  Beat:
  {
    "action": "thrust-high",
    "intensity": 79,
    "seconds": 0.24
  }

  Stop:
  {
    "action": "stop"
  }

  Hold:
  {
    "action": "hold"
  }

  Resume:
  {
    "action": "resume"
  }

  Panic stop:
  {
    "action": "panicstop"
  }

  If a later XToys JavaScript layer is added, it should still switch primarily
  on the final action string:

    thrust-low
    thrust-medium
    thrust-high

  rather than reconstructing the level from a base semantic action.
*/
