/* ==========================================================================
 * TNC 426 simulator  --  lessons.js
 * Teaching content: interactive lessons, "break it" lessons, the power-user
 * manual and the system prompt for the program-writing LLM.
 * Plain browser JS, no modules, no DOM. Exposes one global: TNC_LESSONS.
 * Every program in here is checked against core.js + sim.js.
 * ========================================================================== */

var TNC_LESSONS = (function () {
  'use strict';

  function P(lines) { return lines.join('\n'); }

  var BLK = ['BLK FORM 0.1 Z X+0 Y+0 Z-20', 'BLK FORM 0.2 X+100 Y+80 Z+0'];
  function prog(name, body) {
    return P(['BEGIN PGM ' + name + ' MM'].concat(BLK, body, ['END PGM ' + name + ' MM']));
  }

  /* ======================================================================
   * LEARN
   * ==================================================================== */

  var L1 = prog('HELLO', [
    'TOOL CALL 4 Z S3000',          // 3
    'L Z+50 R0 FMAX M3',            // 4
    'L X+20 Y+40 R0 FMAX',          // 5
    'L Z+2 R0 FMAX',                // 6
    'L Z-2 R0 F150',                // 7
    'L X+80 R0 F500',               // 8
    'L Z+50 R0 FMAX M30'            // 9
  ]);                               // 10 END PGM

  var L2 = prog('SAFEZ', [
    'TOOL CALL 4 Z S3000',          // 3
    'L Z+50 R0 FMAX M3',            // 4
    'L X+15 Y+20 R0 FMAX',          // 5
    'L Z+2 R0 FMAX',                // 6
    'L Z-3 R0 F150',                // 7
    'L X+85 R0 F500',               // 8
    'L Z+2 R0 FMAX',                // 9
    'L X+15 Y+40 R0 FMAX',          // 10
    'L Z-3 R0 F150',                // 11
    'L X+85 R0 F500',               // 12
    'L Z+2 R0 FMAX',                // 13
    'L X+15 Y+60 R0 FMAX',          // 14
    'L Z-3 R0 F150',                // 15
    'L X+85 R0 F500',               // 16
    'L Z+50 R0 FMAX M30'            // 17
  ]);                               // 18 END PGM

  function arcs(dr) {
    return prog('ARCS', [
      'TOOL CALL 4 Z S3000',                    // 3
      'L Z+50 R0 FMAX M3',                      // 4
      'CC X+25 Y+40',                           // 5
      'L X+13 Y+40 R0 FMAX',                    // 6
      'L Z+2 R0 FMAX',                          // 7
      'L Z-2 R0 F150',                          // 8
      'C X+13 Y+40 DR- F500',                   // 9
      'L Z+2 R0 FMAX',                          // 10
      'L X+58 Y+70 R0 FMAX',                    // 11
      'L Z-2 R0 F150',                          // 12
      'CR X+82 Y+70 R+15 DR' + dr + ' F500',    // 13
      'L Z+2 R0 FMAX',                          // 14
      'L X+58 Y+45 R0 FMAX',                    // 15
      'L Z-2 R0 F150',                          // 16
      'CR X+82 Y+45 R-15 DR+ F500',             // 17
      'L Z+50 R0 FMAX M30'                      // 18
    ]);                                         // 19 END PGM
  }
  var L3 = arcs('+'), L3b = arcs('-');

  function cyc200(depth, feed, peck, clr2) {
    return [
      'CYCL DEF 200 DRILLING',
      '  Q200=+2     ;SET-UP CLEARANCE',
      '  Q201=' + depth + '   ;DEPTH',
      '  Q206=' + feed + '   ;FEED RATE FOR PLNGNG',
      '  Q202=' + peck + '    ;PLUNGING DEPTH',
      '  Q210=+0     ;DWELL TIME AT TOP',
      '  Q203=+0     ;SURFACE COORDINATE',
      '  Q204=' + clr2 + '   ;2ND SET-UP CLEARANCE'
    ];
  }

  var L4 = prog('DRILL', [].concat(
    ['TOOL CALL 1 Z S2000',                     // 3
     'L Z+50 R0 FMAX M3'],                      // 4
    cyc200('-2.5', '+100', '+2.5', '+50'),      // 5
    ['L X+20 Y+20 R0 FMAX M99',                 // 6
     'L X+80 Y+20 R0 FMAX M99',                 // 7
     'L X+80 Y+60 R0 FMAX M99',                 // 8
     'L X+20 Y+60 R0 FMAX M99',                 // 9
     'TOOL CALL 2 Z S1800',                     // 10
     'L Z+50 R0 FMAX M3'],                      // 11
    cyc200('-15', '+150', '+5', '+50'),         // 12
    ['L X+20 Y+20 R0 FMAX M99',                 // 13
     'L X+80 Y+20 R0 FMAX M99',                 // 14
     'L X+80 Y+60 R0 FMAX M99',                 // 15
     'L X+20 Y+60 R0 FMAX M99',                 // 16
     'L Z+50 R0 FMAX M30']                      // 17
  ));                                           // 18 END PGM

  var L5 = prog('LOOPS', [
    'TOOL CALL 5 Z S3000',          // 3
    'L Z+50 R0 FMAX M3',            // 4
    'FN 0: Q1 = -2',                // 5
    'FN 0: Q2 = +0',                // 6
    'L X+15 Y+15 R0 FMAX',          // 7
    'L Z+2 R0 FMAX',                // 8
    'LBL 1',                        // 9
    'FN 1: Q2 = +Q2 + +Q1',         // 10
    'L Z+Q2 R0 F200',               // 11
    'L X+85 R0 F800',               // 12
    'L Y+65 R0',                    // 13
    'L X+15 R0',                    // 14
    'L Y+15 R0',                    // 15
    'CALL LBL 1 REP 3/3',           // 16
    'L Z+50 R0 FMAX M30'            // 17
  ]);                               // 18 END PGM

  var L6 = prog('INCR', [].concat(
    ['TOOL CALL 2 Z S1800',                     // 3
     'L Z+50 R0 FMAX M3'],                      // 4
    cyc200('-12', '+150', '+6', '+10'),         // 5
    ['L X+20 Y+10 R0 FMAX M99',                 // 6
     'L IY+15 R0 FMAX M99',                     // 7
     'L IY+15 R0 FMAX M99',                     // 8
     'L IY+15 R0 FMAX M99',                     // 9
     'L IY+15 R0 FMAX M99',                     // 10
     'TOOL CALL 5 Z S3000',                     // 11
     'L Z+50 R0 FMAX M3',                       // 12
     'L X+58 Y-8 R0 FMAX',                      // 13
     'L Z+0 R0 FMAX',                           // 14
     'LBL 1',                                   // 15
     'L IZ-3 R0 F300',                          // 16
     'L IY+96 R0 F800',                         // 17
     'L IX+12 R0',                              // 18
     'L IZ-3 R0 F300',                          // 19
     'L IY-96 R0 F800',                         // 20
     'L IX+12 R0',                              // 21
     'CALL LBL 1 REP 1/1',                      // 22
     'L Z+50 R0 FMAX M30']                      // 23
  ));                                           // 24 END PGM

  var learn = [
    {
      id: 'hello',
      title: 'Hello, TNC',
      blurb: 'Your first program: a blank, a tool, a spindle and one straight cut.',
      steps: [
        { say: "Every HEIDENHAIN program lives between `BEGIN PGM` and `END PGM`, with the same name and the same unit on both. `MM` means every number is millimetres. The control numbers the blocks for you: `BEGIN PGM` is block 0.",
          program: L1, focus: [0, 10], run: false },
        { say: "`BLK FORM 0.1 Z` is the blank's **MIN point** — the corner with the smallest X, Y and Z. The `Z` right after `0.1` names the tool axis. `BLK FORM 0.2` is the **MAX point**, the opposite corner.\n\nHere that is a 100 × 80 × 20 block with the datum on the top face at the front-left corner, the way most shops set it. The blank is only for the graphics; it moves nothing.",
          program: null, focus: [1, 2], run: false },
        { say: "`TOOL CALL 4 Z S3000` loads tool 4 (a Ø6 end mill) along Z and sets 3000 rpm. It does **not** start the spindle. A tool change stops the spindle, and `S` only sets the speed.",
          program: null, focus: [3], run: false },
        { say: "`L Z+50 R0 FMAX M3`: move straight up at rapid (`FMAX`, valid for this block only), with no radius compensation (`R0`). `M3` starts the spindle clockwise at the **start** of the block, so it is turning before anything touches metal.\n\nThe simulator parks the tool at X0 Y0 Z0 (the top corner of the blank), so the first move always goes up.",
          program: null, focus: [4], run: false },
        { say: "Now the cut. Rapid over the start point, rapid down to 2 mm above the top, then `L Z-2 F150` feeds 2 mm into the part and `L X+80 F500` mills a slot along X. `F` is modal: it stays in force until you program a new one. Only the axes you write in a block move.",
          program: null, focus: [5, 6, 7, 8], run: false },
        { say: "`M30` on the retract ends the program and stops the spindle, at the **end** of the block, so the tool is already clear when the spindle stops. Press start and watch your first slot appear.",
          program: null, focus: [9], run: true }
      ]
    },
    {
      id: 'safez',
      title: 'The safe-Z habit',
      blurb: 'Rapid above, feed down, cut, retract, rapid over. The rhythm every old hand has in their fingers.',
      steps: [
        { say: "Three slots, one rhythm. Watch the Z column: the tool only moves sideways at rapid when it is **above** the part. First it goes to a clearance height, Z+50, high enough to clear the vice jaws and the clamps.",
          program: L2, focus: [4, 5], run: false },
        { say: "Rapid down to **Z+2**, not to Z0. Then feed the last 2 mm. That little gap covers a saw-cut blank that is taller than the drawing, a tool length that is a bit off, and a datum set in a hurry. A rapid that ends *exactly* on the surface leaves no room for any of that.",
          program: null, focus: [6, 7], run: false },
        { say: "Cut, then **retract before you move sideways**. `L Z+2 R0 FMAX` lifts the tool out of the slot before `L X+15 Y+40 R0 FMAX` crosses to the next one. Moving sideways at rapid while the tool is still in the slot is how end mills and spindle bearings get ruined.",
          program: null, focus: [8, 9, 10], run: false },
        { say: "Crossing at Z+2 is fine here because the top is flat and nothing sticks up. If a clamp, a boss or a finished feature is in the way, go back up to Z+50 first. Old hands do this without thinking. That is the point: make it a habit, so it still happens at the end of a long shift.",
          program: null, focus: [13, 14], run: false },
        { say: "Run it and watch the rapids (dashed) and the feed moves. Every rapid starts or ends above the part.",
          program: null, focus: null, run: true }
      ]
    },
    {
      id: 'arcs',
      title: 'Arcs with CC and C',
      blurb: 'Circle centres, which way DR turns, and why R has a sign.',
      steps: [
        { say: "`CC X+25 Y+40` sets the **circle centre**. It moves nothing; it only stores a point. It stays in force for every `C` block after it, until you program a new `CC`.",
          program: L3, focus: [5], run: false },
        { say: "`C X+13 Y+40 DR-` is an arc around that centre, ending at X13 Y40. The start is where the tool already is. If the end point is the same as the start point, you get a **full circle**. The start and end must both be the same distance from `CC` (here, within 0.05 mm), or the control stops with `ARC END POS. INCORRECT`.",
          program: null, focus: [6, 9], run: false },
        { say: "**DR+** is counter-clockwise and **DR−** is clockwise, seen from above, looking down the Z axis. With the spindle on M3, a clockwise path around the outside of a boss (or counter-clockwise inside a pocket) is climb milling.",
          program: null, focus: [9], run: false },
        { say: "`CR` needs no centre. You give the end point and a radius, and the control works out the centre. Two circles of that radius pass through both points, so the **sign of R** chooses between them.\n\n- `R+15`: the short arc, central angle 180° or less\n- `R-15`: the long arc, more than 180°",
          program: null, focus: [13, 17], run: false },
        { say: "Run it: a full circle, a shallow short arc at the top and a deep long arc below it. They have the same end points and the same radius, but a different sign.",
          program: null, focus: [9, 13, 17], run: true },
        { say: "Now block 13 says `DR-` instead of `DR+`. It uses the same points and the same radius, but the other short arc: it bulges up instead of dipping down. Run it and compare. Getting the sign or the DR wrong still gives you a perfectly good arc, just in the wrong place.",
          program: L3b, focus: [13], run: true }
      ]
    },
    {
      id: 'cycle200',
      title: 'Let the cycle drill',
      blurb: 'CYCL DEF 200: define it once, call it with M99 at every hole.',
      steps: [
        { say: "A spot drill first, so the Ø8.5 drill has somewhere to start and does not walk. Note `M3` after **each** `TOOL CALL`. `CYCL DEF 200 DRILLING` and its indented Q lines count as **one** NC block (block 5). Defining the cycle does nothing yet. It only stores the parameters.",
          program: L4, focus: [3, 4, 5], run: false },
        { say: "The parameters:\n\n- `Q200` set-up clearance above the surface (rapid to here)\n- `Q201` depth, measured from the surface\n- `Q206` plunging feed\n- `Q202` peck (plunging) depth\n- `Q210` dwell at the top (accepted; the simulator does not wait)\n- `Q203` Z of the part surface\n- `Q204` 2nd set-up clearance, where the tool goes after the hole",
          program: null, focus: [5], run: false },
        { say: "`L X+20 Y+20 R0 FMAX M99` goes to the hole position and then calls the cycle there. `M99` works for one block only, so every hole gets its own `M99`. Between holes the tool travels at Q204 (Z+50 here), so it clears everything.",
          program: null, focus: [6, 7, 8, 9], run: false },
        { say: "The drill uses a new `CYCL DEF 200` with depth -15 and `Q202=+5`. It pecks: it feeds 5 mm, rapids out to set-up clearance to clear the chips, rapids back to just above the last depth, and feeds on. That is three pecks per hole. Program the depth **negative**. The real control takes its direction from the sign; the simulator only uses the size.",
          program: null, focus: [12, 13], run: false },
        { say: "Run it. Watch the spot drill make its cones, then the drill peck its way down the same four holes.",
          program: null, focus: null, run: true }
      ]
    },
    {
      id: 'loops',
      title: 'Loops: LBL and REP',
      blurb: 'Depth passes with a Q parameter, and the r + 1 rule that catches everybody once.',
      steps: [
        { say: "Q parameters are the control's variables. `FN 0: Q1 = -2` stores the step per pass. `FN 0: Q2 = +0` is the current depth, starting at the top face.",
          program: L5, focus: [5, 6], run: false },
        { say: "`LBL 1` marks the start of the repeated section. Inside it, `FN 1: Q2 = +Q2 + +Q1` adds the step (Q2 becomes -2, then -4 and so on), and `L Z+Q2` feeds to that depth. The Q parameter goes where the number would be: `Z+Q2`.",
          program: null, focus: [9, 10, 11], run: false },
        { say: "`CALL LBL 1 REP 3/3` jumps back to `LBL 1` and repeats the section. The key rule: **REP r runs the section r + 1 times**. It has already run once on the way down. REP 3 adds three more passes, so there are 4 passes and a final depth of -8.",
          program: null, focus: [16], run: false },
        { say: "Compare this with a **subprogram**: `CALL LBL 5` with no REP jumps to `LBL 5`, runs until `LBL 0`, and comes back. Subprograms go **after** `M30`, so the main program never runs into them by accident.",
          program: null, focus: [16, 17], run: false },
        { say: "Run it and watch the square groove go down 2 mm at a time. Then look at MIN Z in the stats: -8 mm. That is four passes, one more than the REP count.",
          program: null, focus: null, run: true }
      ]
    },
    {
      id: 'incremental',
      title: 'Incremental thinking',
      blurb: 'IX, IY, IZ: moves relative to where you are. Brilliant for patterns, and dangerous if you lose track of where you are.',
      steps: [
        { say: "`I` in front of an axis makes that move **incremental**, measured from the current position rather than from the datum. The first hole is absolute: `L X+20 Y+10`. Each `L IY+15 R0 FMAX M99` then moves 15 mm further in Y and drills. That gives five holes, 15 mm apart, and you never have to add up a coordinate.",
          program: L6, focus: [6, 7, 8, 9, 10], run: false },
        { say: "A staircase, built step by step. The tool drops to Z0 in front of the part, then inside the loop `L IZ-3` steps 3 mm down, `L IY+96` crosses the part, `L IX+12` moves over one step, and it does the same on the way back.",
          program: null, focus: [13, 14, 15, 16, 17, 18], run: false },
        { say: "The same loop body works for every step, because each move is relative. `REP 1/1` runs it twice, so there are four steps: -3, -6, -9 and -12. You could not do that with absolute Z in the loop unless you used a Q parameter.",
          program: null, focus: [19, 20, 21, 22], run: false },
        { say: "Where it hurts: an incremental move only knows where the tool **is**, not where it should be. If you start the program part-way through, add a block, or change the REP count, every move after that shifts. Rule of thumb: go to an **absolute** position before each feature, and use incremental moves inside it.",
          program: null, focus: [6, 13], run: false },
        { say: "Run it: a column of holes and a four-step staircase. The FRONT view shows the staircase best.",
          program: null, focus: null, run: true }
      ]
    }
  ];

  /* ======================================================================
   * BREAK IT
   * ==================================================================== */

  var breakit = [
    {
      id: 'diagonal-rapid',
      title: 'The diagonal rapid',
      blurb: 'FMAX to the next feature while the tool is still down in the part.',
      broken: prog('RAPID', [
        'TOOL CALL 4 Z S3000',
        'L Z+50 R0 FMAX M3',
        'L X+20 Y+20 R0 FMAX',
        'L Z+2 R0 FMAX',
        'L Z-5 R0 F150',
        'L X+80 R0 F500',
        'L X+20 Y+60 R0 FMAX',
        'L X+80 R0 F500',
        'L Z+50 R0 FMAX M30'
      ]),
      expect: 'RAPID_IN_MATERIAL',
      story: "The first slot sounds sweet. Then the axes take off together at full rapid, straight across the part with the cutter still 5 mm deep. There is a bang like a dropped vice, the Ø6 is gone, and there is a shiny diagonal gouge right across the top face. The foreman does not say anything. He just looks at the spindle and listens to it run down.",
      why: "Block `L X+20 Y+60 R0 FMAX` was written as if the tool were above the part, but the block before left it at Z-5. `FMAX` moves the axes at rapid traverse, not a cutting feed. Only the axes you write move, so Z stays at -5 and the cutter drives sideways through uncut material at rapid.",
      fix: prog('RAPID', [
        'TOOL CALL 4 Z S3000',
        'L Z+50 R0 FMAX M3',
        'L X+20 Y+20 R0 FMAX',
        'L Z+2 R0 FMAX',
        'L Z-5 R0 F150',
        'L X+80 R0 F500',
        'L Z+2 R0 FMAX',
        'L X+20 Y+60 R0 FMAX',
        'L Z-5 R0 F150',
        'L X+80 R0 F500',
        'L Z+50 R0 FMAX M30'
      ]),
      rule: "Retract in Z first, then rapid in XY, then feed back down."
    },
    {
      id: 'forgot-m3',
      title: 'Forgot M3',
      blurb: 'Tool change, new speed, and a spindle that is not turning.',
      broken: prog('NOM3', [].concat(
        ['TOOL CALL 1 Z S2000', 'L Z+50 R0 FMAX M3'],
        cyc200('-2.5', '+100', '+2.5', '+50'),
        ['L X+50 Y+40 R0 FMAX M99',
         'TOOL CALL 2 Z S1800',
         'L Z+50 R0 FMAX'],
        cyc200('-15', '+150', '+5', '+50'),
        ['L X+50 Y+40 R0 FMAX M99',
         'L Z+50 R0 FMAX M30']
      )),
      expect: 'SPINDLE_OFF',
      story: "The spot drill runs fine. The changer swaps in the Ø8.5, the display proudly says S1800, and the drill comes down at feed without turning. It meets the spot, the Z axis groans, and on a machine with no spindle interlock the drill either snaps with a crack or the axis trips out on following error. Either way, the operator now has half a drill stuck in the part.",
      why: "A tool change stops the spindle, and the `S` in `TOOL CALL` only sets the speed. Nothing starts the spindle again until an `M3` or `M4`. The block after the second `TOOL CALL` has no M3, so the cycle feeds into the part with the spindle stopped.",
      fix: prog('NOM3', [].concat(
        ['TOOL CALL 1 Z S2000', 'L Z+50 R0 FMAX M3'],
        cyc200('-2.5', '+100', '+2.5', '+50'),
        ['L X+50 Y+40 R0 FMAX M99',
         'TOOL CALL 2 Z S1800',
         'L Z+50 R0 FMAX M3'],
        cyc200('-15', '+150', '+5', '+50'),
        ['L X+50 Y+40 R0 FMAX M99',
         'L Z+50 R0 FMAX M30']
      )),
      rule: "Every TOOL CALL is followed by a block with M3 (or M4), with no exceptions."
    },
    {
      id: 'early-m5',
      title: 'M5 one block too early',
      blurb: 'Stopping the spindle while there is still a cut to go.',
      broken: prog('EARLYM5', [
        'TOOL CALL 4 Z S3000',
        'L Z+50 R0 FMAX M3',
        'L X+20 Y+20 R0 FMAX',
        'L Z+2 R0 FMAX',
        'L Z-3 R0 F150',
        'L X+80 R0 F500',
        'L Y+60 R0 M5',
        'L X+20 R0',
        'L Z+50 R0 FMAX M30'
      ]),
      expect: 'SPINDLE_OFF',
      story: "Three sides of the frame are perfect. On the corner the spindle whines down to silence, and then the table keeps moving and drags a stationary end mill through aluminium. It squeals, the flutes load up, and the last side looks as if it was chewed. Someone tidied up the program and put the M5 on the wrong line.",
      why: "`M5` takes effect at the **end** of its block. So `L Y+60 R0 M5` still cuts its own side with the spindle running, and the spindle stops as that block finishes. The next block, `L X+20`, is still a cutting move, and it runs with the spindle stopped.",
      fix: prog('EARLYM5', [
        'TOOL CALL 4 Z S3000',
        'L Z+50 R0 FMAX M3',
        'L X+20 Y+20 R0 FMAX',
        'L Z+2 R0 FMAX',
        'L Z-3 R0 F150',
        'L X+80 R0 F500',
        'L Y+60 R0',
        'L X+20 R0',
        'L Z+50 R0 FMAX M5',
        'M30'
      ]),
      rule: "Put M5 on the retract block, never on a cutting move."
    },
    {
      id: 'iz-instead-of-z',
      title: 'IZ instead of Z',
      blurb: 'One extra letter, and the depth loop walks down into the table.',
      broken: prog('WALKDOWN', [
        'TOOL CALL 4 Z S3000',
        'L Z+50 R0 FMAX M3',
        'FN 0: Q1 = -2',
        'FN 0: Q2 = +0',
        'L X+20 Y+20 R0 FMAX',
        'L Z+2 R0 FMAX',
        'LBL 1',
        'FN 1: Q2 = +Q2 + +Q1',
        'L IZ+Q2 R0 F150',
        'L X+80 R0 F500',
        'L Y+60 R0',
        'L X+20 R0',
        'L Y+20 R0',
        'CALL LBL 1 REP 4/4',
        'L Z+50 R0 FMAX M30'
      ]),
      expect: 'BELOW_BLANK',
      story: "The first pass cuts nothing but air, and that should have been the clue. The second pass cuts 4 deep, the third 10, the fourth 18. On the fifth pass the cutter goes through the bottom of the blank, into the parallels and into the vice. There is a noise nobody forgets, and the next thing is a quiet phone call to the maintenance department.",
      why: "Q2 holds an **absolute** depth: -2, -4, -6, -8, -10. `L IZ+Q2` adds that depth to wherever the tool already is, instead of going to it. From Z+2, the passes land at 0, -4, -10, -18 and -28. The steps get bigger every time, and the last one is 8 mm below the bottom of the 20 mm blank.",
      fix: prog('WALKDOWN', [
        'TOOL CALL 4 Z S3000',
        'L Z+50 R0 FMAX M3',
        'FN 0: Q1 = -2',
        'FN 0: Q2 = +0',
        'L X+20 Y+20 R0 FMAX',
        'L Z+2 R0 FMAX',
        'LBL 1',
        'FN 1: Q2 = +Q2 + +Q1',
        'L Z+Q2 R0 F150',
        'L X+80 R0 F500',
        'L Y+60 R0',
        'L X+20 R0',
        'L Y+20 R0',
        'CALL LBL 1 REP 4/4',
        'L Z+50 R0 FMAX M30'
      ]),
      rule: "If a Q parameter holds a depth, go to it with Z. If it holds a step, add it with IZ. Never mix the two."
    },
    {
      id: 'rep-off-by-one',
      title: 'The REP off-by-one',
      blurb: 'Four passes wanted, REP 4/4 written, five passes cut.',
      broken: prog('FOURPASS', [
        'TOOL CALL 5 Z S3000',
        'L Z+50 R0 FMAX M3',
        'FN 0: Q1 = -1',
        'FN 0: Q2 = +0',
        'L X+15 Y+15 R0 FMAX',
        'L Z+2 R0 FMAX',
        'LBL 1',
        'FN 1: Q2 = +Q2 + +Q1',
        'L Z+Q2 R0 F200',
        'L X+85 R0 F800',
        'L Y+65 R0',
        'L X+15 R0',
        'L Y+15 R0',
        'CALL LBL 1 REP 4/4',
        'L Z+50 R0 FMAX M30'
      ]),
      expect: 'SILENT:minZ',
      silentNote: "Nothing crashes and there are no alarms. MIN Z reads -5 mm on the broken program and -4 mm on the fix. The groove is 1 mm too deep, which you only find out with a depth gauge.",
      story: "It runs beautifully. It sounds right, and the chips look right. The gasket groove is supposed to be 4.0 deep. The inspector puts the depth micrometer on it, reads 5.0, and measures again. The seal sits loose, and the whole batch is already cut.",
      why: "In `CALL LBL 1 REP 4/4` the section has already run once on the way down to the CALL block. REP 4 adds four **more** passes, so there are five in total at 1 mm each. Four passes need `REP 3/3`.",
      fix: prog('FOURPASS', [
        'TOOL CALL 5 Z S3000',
        'L Z+50 R0 FMAX M3',
        'FN 0: Q1 = -1',
        'FN 0: Q2 = +0',
        'L X+15 Y+15 R0 FMAX',
        'L Z+2 R0 FMAX',
        'LBL 1',
        'FN 1: Q2 = +Q2 + +Q1',
        'L Z+Q2 R0 F200',
        'L X+85 R0 F800',
        'L Y+65 R0',
        'L X+15 R0',
        'L Y+15 R0',
        'CALL LBL 1 REP 3/3',
        'L Z+50 R0 FMAX M30'
      ]),
      rule: "For n passes, program REP n−1."
    },
    {
      id: 'chip-load',
      title: 'Feeding a Ø3 like a Ø12',
      blurb: 'Speeds and feeds copied from the big cutter onto the small one.',
      broken: prog('TINYCUT', [
        'TOOL CALL 9 Z S3000',
        'L Z+50 R0 FMAX M3',
        'L X+20 Y+40 R0 FMAX',
        'L Z+2 R0 FMAX',
        'L Z-1 R0 F100',
        'L X+80 R0 F1200',
        'L Z+50 R0 FMAX M30'
      ]),
      expect: 'CHIP_LOAD',
      story: "S3000 F1200 is a happy feed for the Ø12, so it was copied onto the engraving job. The Ø3 goes in, and the pitch of the sound rises. Before anyone reaches the feed override there is a small *tink*, and a 3 mm stub is left in the collet. The broken end is somewhere in the chip tray and nobody will ever find it.",
      why: "Feed per tooth is fz = F ÷ (S × flutes) = 1200 ÷ (3000 × 3) = 0.133 mm. That is fine for a Ø12 (the simulator's limit is 0.012 × 12 + 0.005 = 0.149). For a Ø3 the limit is 0.012 × 3 + 0.005 = 0.041 mm, so this is more than three times too much. Small cutters want more rpm and a much smaller bite.",
      fix: prog('TINYCUT', [
        'TOOL CALL 9 Z S8000',
        'L Z+50 R0 FMAX M3',
        'L X+20 Y+40 R0 FMAX',
        'L Z+2 R0 FMAX',
        'L Z-1 R0 F100',
        'L X+80 R0 F900',
        'L Z+50 R0 FMAX M30'
      ]),
      rule: "Work out F from the chip load: F = fz × S × flutes, for every cutter, every time."
    },
    {
      id: 'no-cc',
      title: 'Circle without a centre',
      blurb: 'A C block with no CC in front of it.',
      broken: prog('NOCC', [
        'TOOL CALL 4 Z S3000',
        'L Z+50 R0 FMAX M3',
        'L X+30 Y+40 R0 FMAX',
        'L Z+2 R0 FMAX',
        'L Z-2 R0 F150',
        'C X+30 Y+40 DR+ F500',
        'L Z+50 R0 FMAX M30'
      ]),
      expect: 'ERROR:CIRCLE CENTER UNDEFINED',
      story: "It is the cheapest lesson of the eight. The tool feeds down, the control reaches the circle, and it stops with an error message. No bang and no smoke, just a program that someone copied from another job without copying the `CC` line above the circle.",
      why: "A `C` block has no centre of its own. It uses the last `CC`. With no `CC` programmed, the control has nothing to go round, and it reports `CIRCLE CENTER UNDEFINED`. (A `CR` block does not need one, because it works out its own centre from the radius.)",
      fix: prog('NOCC', [
        'TOOL CALL 4 Z S3000',
        'L Z+50 R0 FMAX M3',
        'CC X+50 Y+40',
        'L X+30 Y+40 R0 FMAX',
        'L Z+2 R0 FMAX',
        'L Z-2 R0 F150',
        'C X+30 Y+40 DR+ F500',
        'L Z+50 R0 FMAX M30'
      ]),
      rule: "Every C needs a CC above it, and copy them together."
    },
    {
      id: 'no-begin',
      title: 'The forgotten BEGIN PGM',
      blurb: 'A program typed on a PC and sent across without its first line.',
      broken: P(BLK.concat([
        'TOOL CALL 4 Z S3000',
        'L Z+50 R0 FMAX M3',
        'L X+20 Y+40 R0 FMAX',
        'L Z+2 R0 FMAX',
        'L Z-2 R0 F150',
        'L X+80 R0 F500',
        'L Z+50 R0 FMAX M30',
        'END PGM HELLO MM'
      ])),
      expect: 'ERROR:PROGRAM START UNDEFINED',
      story: "On the control itself you cannot make this mistake, because the editor writes `BEGIN PGM` and `END PGM` for you. You make it at a desk. You write the program in a text editor, trim the header while tidying up, and send the file over the serial line. The control will not run it.",
      why: "The first NC block of a program must be `BEGIN PGM NAME MM` (or `INCH`). Without it there is no program start, and the simulator reports `PROGRAM START UNDEFINED` on the first block. The `END PGM` line must have the same name and unit.",
      fix: prog('HELLO', [
        'TOOL CALL 4 Z S3000',
        'L Z+50 R0 FMAX M3',
        'L X+20 Y+40 R0 FMAX',
        'L Z+2 R0 FMAX',
        'L Z-2 R0 F150',
        'L X+80 R0 F500',
        'L Z+50 R0 FMAX M30'
      ]),
      rule: "BEGIN PGM is the first line and END PGM is the last, with the same name and unit on both."
    }
  ];

  /* ======================================================================
   * MANUAL
   * ==================================================================== */

  var manual = [
    {
      title: 'Program structure',
      body: "A program starts with `BEGIN PGM NAME MM` and ends with `END PGM NAME MM`. `INCH` is accepted, but no values are converted (see Simplifications). Leaving out the unit gives `UNIT OF MEASURE MISSING`. The block numbers are assigned by the control: `BEGIN PGM` is block 0, and a `CYCL DEF` together with its Q lines is **one** block. Anything after `;` is a comment.\n\n`BLK FORM 0.1 Z X.. Y.. Z..` is the MIN point of the blank. `BLK FORM 0.2 X.. Y.. Z..` is the MAX point. Both are absolute, and incremental `IX` is not accepted here. The blank only defines the graphics and the safety checks.\n\nThe simulated tool starts at X0 Y0 Z0 with the spindle stopped and a modal feed of F500. Execution stops at `M2`/`M30` or `END PGM`."
    },
    {
      title: 'Straight lines: L',
      body: "`L X+10 Y-5 Z+2 R0 F500 M3`. Only the axes you write move. The others stay where they are.\n\n- `X Y Z`: absolute, from the datum. `IX IY IZ`: incremental, from the current position. You can mix them in one block.\n- `F`: feed in mm/min. It is **modal**, so it stays until you program a new one.\n- `FMAX`: rapid traverse (18 000 mm/min in the simulator), for this block only. It does not change the modal F.\n- `R0`, `RL`, `RR`: accepted, but the simulator always follows the tool centreline.\n- Any coordinate or F can be a Q parameter: `Z+Q2`, `Z-Q2` (negated), `FQ3`.\n- A block with only M words, such as `M30`, is allowed."
    },
    {
      title: 'Arcs: CC, C, CR',
      body: "`CC X.. Y..` stores the circle centre and moves nothing. An axis you leave out takes the current tool position. `IX`/`IY` in a CC are measured from the current position.\n\n`C X.. Y.. DR±` is an arc around the last CC, from the current position to the end point. If the end point is the same as the start point, it is a full circle. The start and end radius must agree within 0.05 mm, or you get `ARC END POS. INCORRECT`. With no CC at all you get `CIRCLE CENTER UNDEFINED`.\n\n`CR X.. Y.. R±r DR±` is an arc from its radius. **+R** takes the arc with a central angle of 180° or less, and **−R** takes the one over 180°. A chord longer than 2r is an error. The simulator stores the centre it works out as the new CC, so program a fresh `CC` before the next `C`.\n\n**DR+** is counter-clockwise and **DR−** is clockwise, seen from +Z. Always program DR (the simulator treats a missing DR as DR+).",
      rows: [
        ['Word', 'Meaning'],
        ['CC X Y', 'circle centre (modal)'],
        ['C X Y DR±', 'arc around CC to X Y'],
        ['CR X Y R±r DR±', 'arc of radius r; +R ≤ 180°, −R > 180°'],
        ['DR+ / DR−', 'counter-clockwise / clockwise, seen from +Z']
      ]
    },
    {
      title: 'Cycles: define, then call',
      body: "`CYCL DEF` stores the parameters and moves nothing. It stays active until the next `CYCL DEF`. You call it with `CYCL CALL` at the current position, with `M99` on a positioning block (move first, then run the cycle, for that block only), or with `M99` on its own line. Q values that come from Q parameters are read at the `CYCL DEF`. The simulator runs cycles 200, 201, 203 and 4. Any other number gives `CYCLE n NOT IMPLEMENTED IN SIMULATOR`. A zero depth gives `CYCL DEF INCOMPLETE`.\n\nThe drilling cycles start from wherever the tool is in XY: they rapid to Q203 + Q200, work down, and finish at Q203 + Q204. The simulator uses only the size of the depth. On a real control the sign sets the direction, so **always program the depth negative**."
    },
    {
      title: 'CYCL DEF 200 DRILLING',
      body: "Pecks to depth. After each peck the tool rapids to set-up clearance, then rapids back to 0.2 mm above the last depth. If Q202 is 0, or the same as the depth, the hole is drilled in one plunge.",
      rows: [
        ['Q', 'Meaning', 'Simulator default'],
        ['Q200', 'set-up clearance above surface', '2'],
        ['Q201', 'depth (negative)', '— required'],
        ['Q206', 'plunging feed, mm/min', 'modal F'],
        ['Q202', 'peck (plunging) depth', 'full depth'],
        ['Q210', 'dwell at top, s', 'accepted, not simulated'],
        ['Q203', 'surface coordinate (Z)', '0'],
        ['Q204', '2nd set-up clearance (final retract)', 'Q200']
      ]
    },
    {
      title: 'CYCL DEF 201 REAMING',
      body: "Rapid to set-up clearance, feed to depth at Q206, go back out at Q208, then rapid to the 2nd set-up clearance. Note: in the simulator, Q208 = 0 means rapid. On a real TNC, 0 means go back out at the reaming feed.",
      rows: [
        ['Q', 'Meaning', 'Simulator default'],
        ['Q200', 'set-up clearance', '2'],
        ['Q201', 'depth (negative)', '— required'],
        ['Q206', 'reaming feed', 'modal F'],
        ['Q211', 'dwell at depth', 'not read'],
        ['Q208', 'retract feed', '18 000 (rapid)'],
        ['Q203', 'surface coordinate', '0'],
        ['Q204', '2nd set-up clearance', 'Q200']
      ]
    },
    {
      title: 'CYCL DEF 203 UNIVERSAL DRILLING',
      body: "Like 200, plus these: each peck gets smaller by Q212, but never below Q205. For the first Q213 pecks, the tool first backs off Q256 in place to break the chip. The simulator then still does the full retract after every peck, at Q208. A real 203 skips that retract while it is chip breaking. There is also a final retract at Q208.",
      rows: [
        ['Q', 'Meaning', 'Simulator default'],
        ['Q200 Q201 Q206 Q202 Q203 Q204', 'as in cycle 200', 'as in 200'],
        ['Q210', 'dwell at top', 'accepted, not simulated'],
        ['Q212', 'decrement per peck', '0'],
        ['Q213', 'number of chip breaks', '0'],
        ['Q205', 'minimum plunging depth', '0'],
        ['Q211', 'dwell at depth', 'not read'],
        ['Q208', 'retract feed (0 = rapid in simulator)', '18 000'],
        ['Q256', 'chip-break retract distance', '0.2']
      ]
    },
    {
      title: 'CYCL DEF 4 POCKET MILLING',
      body: "Use the dotted form. First put the tool at the **pocket centre, at set-up clearance above the surface**. The simulator takes surface = current Z − 4.1. Then call it. The tool plunges at the centre, so use a centre-cutting end mill. It clears the pocket in widening rectangles, with a step-over of 0.7 × tool radius, one depth level at a time. The corners come out at the tool radius, and the RADIUS value in 4.6 is ignored. If the pocket is smaller than the tool, you get `TOOL TOO LARGE`.\n\nIf you write it with Q lines instead, the simulator takes the first seven values **in order** and ignores the Q numbers. Use the dotted form.",
      rows: [
        ['Line', 'Meaning'],
        ['CYCL DEF 4.0 POCKET MILLING', 'start of the definition'],
        ['CYCL DEF 4.1 SET UP 2', 'set-up clearance'],
        ['CYCL DEF 4.2 DEPTH -10', 'pocket depth'],
        ['CYCL DEF 4.3 PECKG 5 F80', 'plunge per level, plunging feed'],
        ['CYCL DEF 4.4 X60', 'pocket length in X'],
        ['CYCL DEF 4.5 Y40', 'pocket length in Y'],
        ['CYCL DEF 4.6 F300 DR+ RADIUS 0', 'milling feed; DR+ = climb with M3, DR− = conventional']
      ]
    },
    {
      title: 'Labels: subprograms and section repeats',
      body: "`LBL n` (n ≥ 1) marks a place. `LBL 0` marks the end of a subprogram.\n\n- **Subprogram**: `CALL LBL n` with no REP runs from `LBL n` to the next `LBL 0`, then carries on after the call. Put subprograms **after** `M2`/`M30`, so the main program never runs into them.\n- **Program-section repeat**: `LBL n … CALL LBL n REP r/r`, with the label **above** the call. It repeats the blocks between them. The section has already run once, so there are **r + 1 passes in total**.\n\nCalls can be nested up to 30 deep. If the program produces more than 10 000 moves, the simulator aborts with `EXCESSIVE SUBPROGRAM NESTING` (this catches runaway loops). Calling a label that does not exist gives `LABEL NUMBER NOT FOUND`."
    },
    {
      title: 'Q parameters and FN 0–4',
      body: "Q parameters are variables, numbered freely. A Q parameter that has never been set reads as 0. You can use them in coordinates, F, S, the tool number and cycle parameters (`Q201=Q5`, `Q201=-Q5`). The format is the control's own: `FN 1: Q2 = +Q2 + +Q1`. Any other FN number gives `ARITHMETICAL ERROR`.",
      rows: [
        ['Function', 'Example', 'Result'],
        ['FN 0 assign', 'FN 0: Q1 = -2', 'Q1 = −2'],
        ['FN 1 add', 'FN 1: Q2 = +Q2 + +Q1', 'Q2 + Q1'],
        ['FN 2 subtract', 'FN 2: Q3 = +Q4 - +2', 'Q4 − 2'],
        ['FN 3 multiply', 'FN 3: Q5 = +Q1 * +3', 'Q1 × 3'],
        ['FN 4 divide', 'FN 4: Q6 = +Q5 / +2', 'Q5 ÷ 2 (÷0 → DIVISION BY ZERO)']
      ]
    },
    {
      title: 'M-functions',
      body: "M words can go on an `L`, `C` or `CR` block, on a `CYCL CALL`, or on a line of their own. Some act at the **start** of the block, before the move. Others act at the **end**, after it. A tool change always stops the spindle. Calling the same tool again, only to change S, does not stop it. Other M numbers are accepted and ignored.",
      rows: [
        ['M', 'Effect', 'When'],
        ['M3', 'spindle on, clockwise', 'block start'],
        ['M4', 'spindle on, counter-clockwise', 'block start'],
        ['M5', 'spindle stop', 'block end'],
        ['M8', 'coolant on', 'block start'],
        ['M9', 'coolant off', 'block end'],
        ['M13 / M14', 'M3 / M4 plus coolant on', 'block start'],
        ['M2 / M30', 'spindle and coolant off, program end (nothing after runs)', 'block end'],
        ['M99', 'call the active cycle at this position, this block only', 'after the move']
      ]
    },
    {
      title: 'Tool table',
      body: "`TOOL CALL t Z S3000` (t = tool number, S = rpm). The axis letter is required, and without it you get `TOOL AXIS MISSING`. `DL`/`DR` oversizes are accepted and ignored. `TOOL CALL 0 Z` unloads the tool. A number that is not in the table gives `TOOL t NOT DEFINED`. The spot drill and the chamfer mill are drawn as 90° cones, and every other tool is a flat-bottomed cylinder. The chip-load check counts 3 flutes for end mills and 5 for the face mill. There is no tapping cycle and no probing, so T3 and T11 are only in the table for show.",
      rows: [
        ['T', 'Name', 'Ø', 'R', 'L'],
        ['1', 'SPOT_DRILL_90', '6', '3.000', '72.400'],
        ['2', 'DRILL_8.5', '8.5', '4.250', '118.200'],
        ['3', 'TAP_M10', '10', '5.000', '96.000'],
        ['4', 'ENDMILL_6', '6', '3.000', '64.100'],
        ['5', 'ENDMILL_12', '12', '6.000', '88.750'],
        ['6', 'FACEMILL_50', '50', '25.000', '52.300'],
        ['7', 'BORE_HEAD', '32', '16.000', '142.000'],
        ['8', 'CHAMFER_45', '10', '5.000', '58.900'],
        ['9', 'ENDMILL_3', '3', '1.500', '58.000'],
        ['11', 'PROBE_TS640', '6', '3.000', '155.000'],
        ['42', 'REAMER_H7', '10', '5.000', '101.300']
      ]
    },
    {
      title: 'Safety checks (the simulator’s, not the TNC’s)',
      body: "The real TNC 426 would run every one of these crashes without a word. Its test graphics show the material being removed, not collisions. These checks are the simulator's own, run over a height-field model of the blank.",
      rows: [
        ['Event', 'Severity', 'Triggers when'],
        ['RAPID_IN_MATERIAL', 'crash', 'any rapid (including inside cycles) where the tool touches material more than 0.05 mm above the tool tip'],
        ['SPINDLE_OFF', 'crash', 'a feed or arc move removes material while the spindle is stopped'],
        ['BELOW_BLANK', 'crash', 'a feed move over the blank goes more than 3 mm below its bottom'],
        ['THROUGH_CUT', 'info', 'a feed move breaks through the bottom (parallels assumed underneath)'],
        ['CHIP_LOAD', 'warning', 'end mill or face mill, mainly sideways move, cutting material, with fz = F ÷ (S × flutes) > 0.012·D + 0.005']
      ]
    },
    {
      title: 'Error messages',
      rows: [
        ['Message', 'Usual cause'],
        ['PROGRAM START UNDEFINED', 'first block is not BEGIN PGM'],
        ['UNIT OF MEASURE MISSING', 'BEGIN PGM without MM / INCH'],
        ['BLK FORM DEFINITION INCORRECT', 'an X, Y or Z missing, or incremental'],
        ['TOOL NUMBER MISSING / TOOL AXIS MISSING', 'TOOL CALL without a number / without Z'],
        ['TOOL t NOT DEFINED', 'tool number not in the table'],
        ['BLOCK FORMAT INCORRECT', 'unknown word or unsupported block type'],
        ['CIRCLE CENTER UNDEFINED', 'C without a CC before it'],
        ['CIRCLE RADIUS MISSING', 'CR without R'],
        ['ARC END POS. INCORRECT', 'end point not on the circle, or chord longer than 2R'],
        ['ARITHMETICAL ERROR', 'malformed FN, or FN number not 0–4'],
        ['DIVISION BY ZERO', 'FN 4 with a zero divisor'],
        ['FEED RATE MISSING', 'F zero or negative'],
        ['CYCL DEF INCOMPLETE', 'cycle called with no definition, or depth / size 0'],
        ['TOOL TOO LARGE', 'pocket smaller than the tool (cycle 4)'],
        ['CYCLE n NOT IMPLEMENTED IN SIMULATOR', 'cycle other than 200 / 201 / 203 / 4'],
        ['LABEL NUMBER NOT FOUND', 'CALL LBL to a label that does not exist'],
        ['EXCESSIVE SUBPROGRAM NESTING', 'more than 30 levels deep, or more than 10 000 moves']
      ],
      body: "These are the interpreter's messages. The program still draws up to and around the faulty block, and the faulty block itself is skipped."
    },
    {
      title: 'Known simplifications',
      body: "- **RL/RR** are parsed and displayed, but the path follows the tool centreline. Offset the contour by the tool radius yourself.\n- **INCH** is recorded but not converted. Write in mm.\n- **Cycle time** is the sum of length ÷ feed. It does not include dwells, tool changes or acceleration, so it is optimistic.\n- **Material** is a height field seen from above, so undercuts and overhangs cannot be shown. Drills are flat-bottomed, not 118° points.\n- **Rapid** is a straight line at 18 000 mm/min. A real machine's rapid may not follow a straight line.\n- **Cycle 4** follows its own spiral-out path, not HEIDENHAIN's exact path."
    },
    {
      title: 'Keyboard shortcuts',
      rows: [
        ['Key', 'Action'],
        ['↑ ↓', 'block cursor'],
        ['← →', 'scrub the run (SHIFT: 5 s steps)'],
        ['ENTER', 'step one block; edit the block in EDIT mode'],
        ['ESC', 'stop / cancel'],
        ['SPACE', 'NC start / NC stop'],
        ['S', 'single block'],
        ['R', 'reset'],
        ['E / I / D / C', 'edit / insert / delete / copy block'],
        ['TAB', 'raw text editor'],
        ['G', 'view: 3D / TOP / FRONT / SIDE'],
        ['1 – 5', 'speed'],
        ['F1 – F4', 'operating mode'],
        ['+ / −', 'feed override'],
        ['HOME / END', 'first / last block'],
        ['PGUP / PGDN', 'cursor 12 blocks up / down'],
        ['M', 'program manager'],
        ['H', 'help'],
        ['CTRL+Z', 'undo'],
        ['CTRL+SHIFT+Z / CTRL+Y', 'redo'],
        ['CTRL+S', 'save as .H'],
        ['P', 'chips & sparks'],
        ['B', 'smoke & fire']
      ],
      body: "Keys work when the focus is not in a text field."
    }
  ];

  /* ======================================================================
   * AI SYSTEM PROMPT
   * ==================================================================== */

  var aiSystemPrompt = P([
    'You write HEIDENHAIN TNC 426 conversational (Klartext) programs for a browser simulator. Its interpreter accepts ONLY the syntax below; anything else is rejected with an error. Units are mm.',
    '',
    'OUTPUT FORMAT',
    '- Reply with ONLY the program inside a single ```klartext fenced block. Nothing before or after the fence.',
    '- No block numbers. One block per line.',
    '- Line 1: BEGIN PGM <NAME> MM. Last line: END PGM <NAME> MM (same name). NAME: uppercase A-Z, 0-9, _ only, max 16 characters.',
    '- Lines 2-3: the BLK FORM. Then a header of ; comment lines describing the part: blank size, features, tools with S and F.',
    '',
    'BLANK',
    'BLK FORM 0.1 Z X+0 Y+0 Z-20   (MIN corner; Z after 0.1 = tool axis)',
    'BLK FORM 0.2 X+100 Y+80 Z+0   (MAX corner)',
    'Absolute values only. Convention: datum at front-left corner, top face Z+0, blank bottom negative. The tool starts at X0 Y0 Z0.',
    '',
    'SUPPORTED BLOCKS',
    'TOOL CALL 5 Z S3000            tool number, axis Z (required), speed. Does NOT start the spindle.',
    'L X+10 Y+20 Z-3 R0 F500 M3     straight line. Only written axes move.',
    '  X Y Z absolute; IX IY IZ incremental. F = feed mm/min, modal. FMAX = rapid, this block only.',
    '  Always write R0. RL/RR are ignored (path = tool centreline): offset contours by the tool radius yourself.',
    'CC X+50 Y+40                   circle centre (modal, moves nothing)',
    'C X+30 Y+40 DR+                arc around the last CC to X Y. End = start gives a full circle. Start and end must be equally far from CC (0.05 mm). Always program a CC before C.',
    'CR X+80 Y+40 R+20 DR-          arc by radius: +R = arc of 180 deg or less, -R = more than 180 deg.',
    '  DR+ = counter-clockwise, DR- = clockwise, seen from +Z.',
    'LBL 1 / LBL 0 / CALL LBL 1 / CALL LBL 1 REP 3/3',
    'FN 0: Q1 = -2      FN 1: Q2 = +Q2 + +Q1      (FN 2 minus, FN 3 times, FN 4 divide)',
    '  Q parameters in coordinates and feeds: L Z+Q2 FQ3. Unset Q = 0.',
    'M30 (alone on a line), or M words on L/C/CR blocks',
    '; comment (whole line or after a block)',
    'Never use: APPR, DEP, CT, RND, CHF, LP, CP, FK, TOOL DEF, CYCL DEF 7/other cycles, FN 5+, IF/jumps, INCH, block numbers.',
    '',
    'M-FUNCTIONS AND TIMING',
    'M3/M4 spindle on, M8 coolant on, M13/M14 spindle+coolant: act at block START.',
    'M5 spindle stop, M9 coolant off, M2/M30 end program: act at block END. Nothing after M2/M30 runs.',
    'Every TOOL CALL stops the spindle: the next block must carry M3, e.g. L Z+50 R0 FMAX M3.',
    'Put M5 only on a retract block, never on a cutting move.',
    '',
    'LOOPS',
    'Section repeat: LBL n ... CALL LBL n REP r/r runs the section r+1 times in total (4 passes = REP 3/3).',
    'Subprogram: CALL LBL n (no REP) runs LBL n ... LBL 0. Place subprograms after M30.',
    'Depth passes: FN 0: Q1 = -2 (step), FN 0: Q2 = +0, then inside the loop FN 1: Q2 = +Q2 + +Q1 and L Z+Q2. Use Z+Q2 (absolute), never IZ+Q2.',
    '',
    'CYCLES (only 200, 201, 203, 4)',
    'A CYCL DEF plus its indented Q lines is ONE block. It only defines; call it with M99 on a positioning block (moves, then runs the cycle there, that block only) or with CYCL CALL. Depths negative.',
    'CYCL DEF 200 DRILLING',
    '  Q200=+2    ;SET-UP CLEARANCE',
    '  Q201=-15   ;DEPTH',
    '  Q206=+150  ;FEED RATE FOR PLNGNG',
    '  Q202=+5    ;PLUNGING DEPTH (peck)',
    '  Q210=+0    ;DWELL TIME AT TOP',
    '  Q203=+0    ;SURFACE COORDINATE',
    '  Q204=+50   ;2ND SET-UP CLEARANCE (final retract height)',
    'L X+20 Y+20 R0 FMAX M99',
    'L X+80 Y+20 R0 FMAX M99',
    'CYCL DEF 201 REAMING: Q200 Q201 Q206 (ream feed) Q211 Q208 (retract feed) Q203 Q204.',
    'CYCL DEF 203 UNIVERSAL DRILLING: as 200 plus Q212 (peck decrement) Q213 (chip breaks) Q205 (min peck) Q211 Q208 Q256 (chip-break distance).',
    'Pocket, dotted form. First position at the pocket centre at Z = surface + 4.1 value, then call:',
    'CYCL DEF 4.0 POCKET MILLING',
    'CYCL DEF 4.1 SET UP 2',
    'CYCL DEF 4.2 DEPTH -10',
    'CYCL DEF 4.3 PECKG 3 F100',
    'CYCL DEF 4.4 X60',
    'CYCL DEF 4.5 Y40',
    'CYCL DEF 4.6 F600 DR+ RADIUS 0',
    'L X+50 Y+40 R0 FMAX',
    'L Z+2 R0 FMAX M99',
    'Pocket sides must be larger than the tool diameter.',
    '',
    'TOOL TABLE (T name radius)',
    'T1 SPOT_DRILL_90 R3 (cone) | T2 DRILL_8.5 R4.25 | T3 TAP_M10 R5 (no tapping cycle, do not use) | T4 ENDMILL_6 R3 | T5 ENDMILL_12 R6 | T6 FACEMILL_50 R25 | T7 BORE_HEAD R16 | T8 CHAMFER_45 R5 (cone) | T9 ENDMILL_3 R1.5 | T11 PROBE_TS640 R3 (never cut) | T42 REAMER_H7 R5 (use with 201).',
    'Nothing else exists.',
    '',
    'SAFETY RULES THE SIMULATOR ENFORCES (a violation is reported as a crash)',
    '1. Rapid into material: never move FMAX where the tool would touch uncut stock. Pattern: L Z+50 R0 FMAX M3, then FMAX in XY above the part, then FMAX down to Z+2, feed into the cut, feed along it, and FMAX back to Z+2 (or Z+50 over obstacles) BEFORE any XY rapid. Never FMAX below Z+2 over the part.',
    '2. Spindle off: no cutting move without M3/M4 active since the last TOOL CALL.',
    '3. Below blank: never feed more than 3 mm below the blank bottom. Keep depths inside the blank; through-cuts at most 1 mm below the bottom.',
    '4. Chip load (end mills and face mill): fz = F / (S x flutes) must be <= 0.012 x D + 0.005. Flutes: end mills 3, face mill 5. Choose F = fz x S x flutes.',
    '   Safe values: T9 S8000 F900 | T4 S3000 F500 | T5 S3000 F1000 | T6 S1200 F2000.',
    '   Drills: T1 S2000 Q206=+100, T2 S1800 Q206=+150, T42 S400 Q206=+80.',
    'Plunge at a low feed (F100-F200). Keep every cut within the blank.',
    '',
    'ERRORS',
    'If you receive an error report from the simulator (interpreter errors or crash events, each with a block number; BEGIN PGM is block 0 and a CYCL DEF with its Q lines is one block), find the cause and return the COMPLETE corrected program, in the same format, with nothing outside the fence.'
  ]);

  return { learn: learn, breakit: breakit, manual: manual, aiSystemPrompt: aiSystemPrompt };
})();

if (typeof module !== 'undefined') module.exports = TNC_LESSONS;
