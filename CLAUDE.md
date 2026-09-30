# CLAUDE.md — TNC 426/430 Simulator

## North star

A program written here must run **the same** on a real HEIDENHAIN TNC 426/430 — same moves,
same errors, same timing. Not "close enough." Where that can't be verified yet (no oracle,
no manual citation), say so plainly in the closing report instead of implying parity.
Authority order: `research/tnc426_430_280476_manual_en.txt` (426/430, NC SW 280 476) →
programming-station oracle (`tnc-programstation/instruct.md`, TODO.md P10) → nothing else.
The iTNC 530 station is a *timing/dialog/error-text* oracle only — never a *syntax* oracle
(it accepts a superset the 426/430 rejects).

## End-of-run report — every run, every agent

Close every run with this, soldier-style — terse, no re-narration of the tool trail:

```
SOLVED
- <what> — <why it mattered>
RISK / NOT VERIFIED
- <anything not checked against manual or oracle — or "none" if genuinely covered>
NEXT
- <single next item closest to 1:1 parity — cite the TODO.md P# it comes from>
```

One screen, max. Diffs, file paths, triangle counts, screenshots — that's what the transcript
is for. The closing report is the "so what," not a second copy of the work.

## Phase before Rust + React (now — this is where all current work happens)

Single offline HTML file, `python3 build.py`, plain ES5-ish browser JS, three.js r186 bundled.
Everything in TODO.md P0–P10 lives here:

- Klartext interpreter correctness — parser, cycles, Q-params, error register (P0/P1). **This
  is the parity-critical code.**
- Programming-station oracle work (P10) — the actual parity *gate*, not a nice-to-have.
- UI, profiles, program I/O, effects, AI generation, visual quality, tools/callouts, flowchart
  (P2, P4–P8) — all ship inside the one HTML file, no server, no build step for the user.
- TNC 430 multi-axis (P9) — a `window.TNC_MACHINES['430']` kinematics config, still inside the
  same file, never a UI fork.

Nothing here needs Rust or React. Don't touch either while a P0/P1 item is open — that's scope
leak, not future-proofing.

## Phase after Rust + React (later — gated, not started)

This is TODO.md P11 ("future-proofing — backend service + Windows/Mac desktop app"), now named:
a Rust backend/core + React frontend, replacing the single-file delivery model.

- **Gate to start:** P0/P1 closed out and P10's golden set is oracle-verified. Porting an
  interpreter whose correctness is still unverified just ports the bugs faster.
- **What moves:** the interpreter core (parser / cycles / Q-params / error register) — it's the
  part parity actually depends on.
- **What probably doesn't move:** the three.js renderer and most of the UI. Don't rewrite what
  isn't the bottleneck for parity.
- **What doesn't happen now:** no JS in this repo gets restructured "to be Rust-ready." That's
  speculative work against a phase the user hasn't un-deferred. YAGNI.
- Explicitly deferred per TODO.md P11 until the user says otherwise. This section exists so
  scope doesn't drift either direction — phase-1 work sliding into rewrite-prep, or phase-2 work
  starting before phase-1 has earned it.

## Everything else

TODO.md's "RULES THAT DON'T CHANGE" is the source of truth for behavioural rules (authentic TNC
behaviour, keyboard-first, ship a direct HTML link, ask before installing, a DEV tab that lies
is worse than none). Not duplicated here — read it before touching interpreter behaviour.
