# tnc-programstation — instructions

Goal: use a HEIDENHAIN programming station as a behaviour oracle (ground truth) to verify the simulator. It supplies no features. It serves rule #1 (authentic TNC behaviour), which nothing in the repo currently tests.

## Verified repo state (2026-09-27, HEAD 216a76e)

- HEAD 216a76e: RL/RR, RND/CHF, APPR/DEP, CP/LP, ZX/YZ arcs.
- Stale docs: HANDOFF.md and TODO.md (2026-09-23) predate it; v0.5 build and RL/RR items are done. README "Known simplifications" is wrong (still says RL/RR is drawn on the centreline).
- `node tests/manual.js`: ALL PASS. Expected values are derived from the manual's rules, not from a control, so the tests share the implementation's interpretation and cannot catch misreadings.
- `node tests/corpus.js`: 2806 programs, 1021 clean, 1785 with errors, 0 crashes. Top buckets:
  - ~1867 `TOOL n NOT DEFINED` (`core.js:1063`). Programs rely on TOOL.T, not `TOOL DEF`; the sim has no tool-table fallback.
  - 244 `CYCL DEF DATUM SETTING` and 140 `RIGID TAPPING`: not implemented.
  - ~214 `TCH PROBE 4xx` datum cycles: not found in the 426 manual, likely iTNC 530/TNC 640 dialect.
  - Q formulas (`Q1 = Q2 - Q3`) and `FQn` feeds fail, but both are in the 426 manual (`research/tnc426_430_280476_manual_en.txt:17404`, `:17411`). These are interpreter bugs.
  - Also failing: `CALL LBL n REPQn`, `FN 9: IF … GOTO LBL "name"`, `FN 16/PRINT`.
- Host: darwin arm64.
- Only station reference in research: iTNC 530 programming station, NC SW 340 494-05 (`research/itnc530.txt:74`). No TNC 426 station exists in the repo.
- `research/`, `search-heidenhain/` and `.tools/` are gitignored.

## Station is an oracle for

1. Exact error-message text and the block it is flagged on (error register).
2. Behaviour of `TOOL CALL` with no `TOOL DEF` (largest corpus bucket).
3. TEST RUN machining time, to compare with the sim's `sum(length/feed)`.
4. Contour graphics for RL/RR, APPR/DEP, RND/CHF, replacing self-derived expectations.
5. Dialog prompt order for `L`, `TOOL CALL`, `BLK FORM`, NEW PGM (P1 PGM MGT / editing).
6. P9 five-axis: cycle 19, M128.

## Station is NOT an oracle for

- 426 syntax acceptance. The iTNC 530 accepts a superset (e.g. `TCH PROBE 4xx`); do not let it define validity. Use `research/tnc426_430_280476_manual_en.txt`.
- 426 screen layout and soft keys (iTNC UI differs). Use `research/tnc426_pilot_en.pdf`.

## Procedure (in order)

1. **Manual-derived fixes first, no station needed:**
   - Q formulas, `FQ` feeds, `REPQ`, `FN 9 IF … GOTO`.
   - Default TOOL.T fallback (the manual documents the tool table); this targets the ~1867 bucket.
   - Re-run `node tests/corpus.js`.
2. **Triage the remaining corpus failures by dialect:** tag each as "in 426 manual" or "iTNC-only". Implement or reject strictly against the 426 manual.
3. **Station setup. UNVERIFIED, check before acting:**
   - HEIDENHAIN still offers a free iTNC 530 / TNC 640 programming-station demo, and what its block limit is.
   - The Windows x64 installer runs in an ARM Windows VM (UTM/Parallels) under emulation.
   - Test the demo before any licence purchase. Rule #4: name the tool and ask the user before installing anything.
4. **Golden set, 15–25 programs:** BRACKET.H, NAMEPLATE.H, NAMEPLATE_V2.H, the tests/manual.js examples, and 1–2 per top failing corpus bucket. Per program, capture from TEST RUN:
   - accepted, or error text + block number;
   - machining time;
   - end position;
   - plan-view screenshot.

   Store the data as `tests/golden/*.json`. Add `tests/station.js` in the style of `tests/manual.js`, asserting the sim matches.
5. **Legal / hygiene:**
   - Screenshots and raw captures go under `research/` (gitignored).
   - Commit only numbers and our own descriptions; never station UI images or binaries.
   - Keep the "not affiliated with HEIDENHAIN" disclaimer consistent.
6. **Sync docs afterwards:** TODO.md, HANDOFF.md, README "Known simplifications".

Priority: step 1 now (manual only). Station only for what the manual cannot settle: exact messages, timing, graphics, dialogs.
