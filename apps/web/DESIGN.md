---
name: ProveBack
description: Guest verification for Google Meet, shown as a station concourse board.
colors:
  board: "#131417"
  board-2: "#1b1d20"
  cell: "#202226"
  cell-edge: "#383b41"
  paint: "#f3f0e8"
  dim: "#979ea6"
  amber: "#f2a81d"
  amber-ink: "#2e2000"
  red: "#b92d22"
  red-on-board: "#f0705f"
  steel: "#dcdfe1"
  steel-frame: "#b0b5b9"
  panel: "#f4f4f1"
  field: "#fcfcfa"
  rule: "#aeb3b9"
  rule-soft: "#c9cdd1"
  ink: "#16181b"
  ink-2: "#454b51"
typography:
  display:
    fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif"
    fontSize: "54px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.02em"
  headline:
    fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif"
    fontSize: "36px"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "0.02em"
  title:
    fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif"
    fontSize: "21px"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "0.06em"
  body:
    fontFamily: "Barlow, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.12em"
  flap:
    fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif"
    fontSize: "28px"
    fontWeight: 600
    lineHeight: "38px"
rounded:
  cell: "2px"
  strip: "3px"
  control: "4px"
spacing:
  cell-gap: "2px"
  row-gap: "8px"
  control-gap: "10px"
  card: "22px"
  gutter: "24px"
  page-top: "32px"
components:
  flap-cell:
    backgroundColor: "{colors.cell}"
    textColor: "{colors.paint}"
    typography: "{typography.flap}"
    rounded: "{rounded.cell}"
    width: "23px"
    height: "38px"
  flap-cell-verified:
    backgroundColor: "{colors.paint}"
    textColor: "{colors.board}"
  flap-cell-now:
    backgroundColor: "{colors.cell}"
    textColor: "{colors.amber}"
  flap-cell-failed:
    backgroundColor: "{colors.cell}"
    textColor: "{colors.red-on-board}"
  flap-cell-waiting:
    backgroundColor: "{colors.cell}"
    textColor: "{colors.dim}"
  board-row:
    backgroundColor: "{colors.board}"
    textColor: "{colors.paint}"
    rounded: "{rounded.strip}"
    padding: "5px 8px"
  button:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "11px 18px"
  button-primary:
    backgroundColor: "{colors.board}"
    textColor: "{colors.paint}"
    rounded: "{rounded.control}"
    padding: "11px 18px"
  button-primary-hover:
    backgroundColor: "#2b2e33"
  button-danger:
    backgroundColor: "transparent"
    textColor: "{colors.red}"
    rounded: "{rounded.control}"
    padding: "11px 18px"
  input:
    backgroundColor: "{colors.field}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
  card:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "22px"
  chip-neutral:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    typography: "{typography.label}"
    rounded: "{rounded.cell}"
    padding: "5px 8px"
  badge-verified:
    backgroundColor: "{colors.board}"
    textColor: "{colors.paint}"
    rounded: "{rounded.cell}"
    padding: "5px 8px"
  badge-pending:
    backgroundColor: "{colors.amber}"
    textColor: "{colors.amber-ink}"
    rounded: "{rounded.cell}"
    padding: "5px 8px"
  badge-failed:
    backgroundColor: "{colors.red}"
    textColor: "#ffffff"
    rounded: "{rounded.cell}"
    padding: "5px 8px"
  nav-tab:
    backgroundColor: "{colors.board}"
    textColor: "{colors.dim}"
    padding: "12px 14px 11px"
  nav-tab-active:
    backgroundColor: "{colors.board}"
    textColor: "{colors.paint}"
---

# Design System: ProveBack

## Overview

**Creative North Star: "The Concourse Board"**

ProveBack looks like the split-flap departure board in a rail station concourse: the one screen every head in the room lifts to. Names and statuses sit in fixed cells on matte board black, lettered in paint white, and a change of status arrives as a mechanical cascade instead of a colour swap. The bot's 1280x720 camera tile is the board itself; the host dashboard and the guest's phone are the working surfaces around it, on a brushed-steel ground, and each of them carries the same board row so a guest's line reads identically wherever it appears.

The system is plain, dense and public-facing. It is a piece of shared signage, so it is legible at a glance, through video compression, in a small tile: large condensed capitals, strong contrast, and a word for every state. It must not read as a crypto project and must not read as a government or border-control system. The interface language is English.

Colour is rationed. The board is black and white; amber means only "this step is happening now"; a dim red marks a row that needs another try; verified is the cell turned over to its white face. There are no gradients, no glow, and no drop shadows.

**Key Characteristics:**
- One shared board row (lamp, 12 name cells, 9 status cells, on board black) on the bot tile, the host's participant list and the guest's phone.
- Split-flap cascade as the only signature motion: 66 ms steps, 45 ms stagger, left to right.
- Board black and paint white for the board; brushed steel, panel and ink for working screens.
- Amber reserved for the step happening now; verified is an inverted paint-white cell, never green.
- Every status is a word; colour and lamp only accompany it.
- Condensed uppercase for anything the board says; a plain companion sans for sentences, forms and tables.
- Flat: no gradients, glow or drop shadows.

## Colors

A two-material palette: matte board black with paint-white lettering for the board, cool brushed steel with near-black ink for working screens, plus two signal colours that are spent sparingly.

### Primary
- **Board Black** (`board`, #131417): the board surface. Bot tile, top bar, guest page header, the strip behind every board row, primary buttons, the verified badge on light surfaces, text selection and form accent colour. Also the dark module colour of every QR code.
- **Paint White** (`paint`, #f3f0e8): lettering on the board, the QR plate on the bot tile, the board's head rule, the active tab underline, and the face of a verified cell.

### Secondary
- **Signal Amber** (`amber`, #f2a81d): the step happening right now. Amber letters in status cells, the amber lamp, and the amber "Scanning" badge. **Amber Ink** (`amber-ink`, #2e2000) is the text colour on an amber fill.

### Tertiary
- **Stop Red** (`red`, #b92d22): failure and destructive actions on light surfaces: failure reasons, form errors, the error box border, the danger button, the failed badge.
- **Stop Red on Board** (`red-on-board`, #f0705f): the same meaning lifted for board black: letters and lamp of a failed row.

### Neutral
- **Cell** (`cell`, #202226) and **Cell Edge** (`cell-edge`, #383b41): the face of a flap cell and its one-pixel top edge; also the top bar's select and button borders and an unlit lamp ring.
- **Board Shade** (`board-2`, #1b1d20): the mock-mode ribbon above the app.
- **Dim** (`dim`, #979ea6): quiet text on the board: waiting status, column heads, inactive tabs, secondary lines in the guest header, the lamp ring.
- **Brushed Steel** (`steel`, #dcdfe1): page ground for the dashboard and guest page. **Steel Frame** (`steel-frame`, #b0b5b9) is the darker 16px frame around the bot board.
- **Panel** (`panel`, #f4f4f1): cards and pick buttons. **Field** (`field`, #fcfcfa): inputs and the selected pick.
- **Rule** (`rule`, #aeb3b9) and **Rule Soft** (`rule-soft`, #c9cdd1): card and input borders; dividers between list rows.
- **Ink** (`ink`, #16181b) and **Ink 2** (`ink-2`, #454b51): text on light surfaces; secondary text, field labels and hints.

### Named Rules
**The Amber Is Now Rule.** Amber is reserved for the step happening now: a guest who is scanning, a bot that is joining or in the waiting room, a live stream that is reconnecting. It is never decoration, never a brand colour, never a generic warning.

**The Turned Flap Rule.** Verified is an inverted cell: paint-white face, board-black letter. It is never green. On light surfaces the same inversion is a board-black badge with paint-white text.

**The Word First Rule.** Status is always carried by a word (WAITING, SCANNING, VERIFIED, TRY AGAIN, MEMBER). The lamp and the colour repeat the word; they never replace it. Lamps are hidden from assistive technology and each cell group carries its text for screen readers.

## Typography

**Display Font:** Barlow Condensed (with Arial Narrow, sans-serif), weights 600 and 700
**Body Font:** Barlow (with system-ui, -apple-system, Segoe UI, sans-serif), weights 400, 500, 600

**Character:** A signage pairing from one family. The condensed cut is always uppercase and letterspaced, and speaks for the board: headings, cells, buttons, tabs, labels, chips. The regular cut is sentence case and speaks for people: explanations, form values, table text. Numerals are tabular everywhere.

### Hierarchy
- **Display** (700, 54px, line-height 1, 0.02em): the meeting title on the bot tile, one line, ellipsised. The plate instruction beside it is 46px/700 and the board's head count 32px/700.
- **Headline** (700, 36px, line-height 1.05, 0.02em): page h1, closed by a 2px ink rule. 34px on the guest header; result statements are 30px.
- **Title** (600, 21px, line-height 1.15, 0.06em): card and section h2. 24px on the guest page. Sub-section h3 is 15px, 0.12em, in Ink 2.
- **Body** (400, 16px, line-height 1.5): sentences and form values. Hints and secondary text are 14px in Ink 2; lead and hint paragraphs are capped at 58ch and 62ch. Emphasis is weight 500 or 600. Bot tile body is 28px/500.
- **Label** (600, 14px, 0.12em, uppercase): field labels, participant kind, chips and badges (0.1em), small buttons. Buttons and tabs use the same voice at 16px and 17px; board column heads at 22px with 0.24em.
- **Flap** (600, cell-height line box, uppercase): one glyph per cell. Four sizes, cell width x height / glyph: sm 15x24 / 17px, md 23x38 / 28px, lg 29x46 / 36px, xl 33x52 / 40px.

### Named Rules
**The Two Voices Rule.** Condensed uppercase is the board speaking; sentence-case Barlow is a person being told something. Never set a sentence in condensed caps, and never set a status word in body type on the board.

**The Wordmark Rule.** PROVEBACK is set in Barlow Condensed 700, uppercase, tracked wide (0.18em to 0.3em by size). There is no logo mark.

## Layout

Working screens sit in a centred 1160px container with 24px side padding, 32px above the content and 72px below. The top bar is sticky, board black, with the wordmark, workspace switcher, account, and a row of tabs. Pages open with a headline closed by a 2px ink rule, then a two-column split: a fixed-feeling 340px (maximum) column of forms and controls and a fluid column for the list. Columns and stacked cards are 24px apart; the split collapses to one column below 860px. Lists are plain rows separated by a soft 1px rule, 14px to 16px of vertical padding, no zebra striping.

The guest page is phone first: a board-black header carrying the meeting title and, once the guest has started, their own board row under a 2px paint rule; then a 480px body on steel with 20px side padding. Tap targets in the pick list are at least 60px tall.

The bot tile is a fixed 1280x720 stage, scaled uniformly to fit the viewport and never scrolled. A 16px steel frame surrounds the board; inside, 28px padding, a 356px paint-white plate on the left (316px QR, one instruction, one reassurance, the wordmark at the foot) and the board on the right: title, head rule with "n / m VERIFIED", column heads GUEST and STATUS, then exactly eight rows 8px apart. Empty slots stay as blank cells so the board is whole before anyone joins. Past eight people, those who still need to act come first and the last row states "+ N MORE".

Board rows adapt, they do not reflow into something else: below 720px the host's row stacks status under name and the md cell shrinks to 19x32; the guest's row is always stacked and shrinks the same way below 360px.

## Elevation & Depth

Flat. Depth is conveyed by material change only: board black against steel, panel against steel, a white-faced cell against dark ones. There are no drop shadows, no glow, no gradients and no blur anywhere in the build.

### Shadow Vocabulary
- **Cell edge** (`box-shadow: inset 0 1px 0 #383b41`): the lit top edge of a flap cell, paired with a 1px dark hinge line across the middle. Removed on a verified cell, which is a flat white face.
- **Inset keyline** (`box-shadow: inset 0 0 0 1px` in Rule or Ink; `inset 0 0 0 2px` Ink on a selected pick): a border drawn inside the box for outlined chips and the selected option. It is a line, not depth.

### Named Rules
**The Flat Board Rule.** No gradients, no glow, no drop shadows. The only shadow is the cell's inset edge; any other inset value is a keyline standing in for a border.

## Shapes

Small, square-shouldered, mechanical. Cells and chips have a 2px radius; the board strip behind a row 3px; cards, inputs and buttons 4px. The only circles are the row lamps (12px, 18px on the bot tile). Borders are 1px hairlines in Rule on light surfaces and Cell Edge on the board; structural rules are heavier and solid: 2px ink under a page headline, 3px paint under the board's head rule, 3px paint under the active tab. Dashed borders mean "not real": an empty list, or a simulation card. Icons are two inline square-capped strokes (check, cross) at text size.

## Components

### Flap (signature)
Text set in fixed split-flap cells: mechanical, exact, never proportional.
- **Shape:** inline row of cells 2px apart; each cell 2px radius, Cell face, inset Cell Edge top line, a 1px hinge line at mid height.
- **Content:** uppercased and padded with blanks to a fixed cell count. Text longer than the count is cut and the last cell shows a full stop.
- **Tones:** paint (default), verified (paint face, board letter, no edge), now (amber letters), failed (red-on-board letters), dim (waiting).
- **Motion, the cascade:** when text changes, only changed cells move. Each runs through 3 to 5 intermediate glyphs at 66 ms per step (one frame of the 15 fps bot stream), staggered 45 ms per cell from left to right, then lands. Each glyph change plays an 80 ms landing (scaleY from 0.25, brightness from 0.55, ease-out). With prefers-reduced-motion the text is set immediately and the landing is off.
- **On light surfaces:** a lone Flap sits in its own strip of board black (3px padding, 3px radius) so an inverted cell still reads.

### Board Row (signature)
One line of the board: lamp, name in 12 cells, status in 9 cells, always on board black. The same component on the bot tile (xl), the host's participant list (md) and the guest's phone (md, stacked).
- **Lamp:** 12px circle with a 2px ring. Dim ring = waiting, unlit ring = empty or bot, paint fill = verified or member, amber fill = now, red-on-board fill = failed.
- **Status words:** WAITING (dim), SCANNING (amber), VERIFIED (inverted), TRY AGAIN (red on board), MEMBER (paint), BOT (dim). Nine characters at most.
- **Bot tile:** fixed columns of 30px lamp, 418px name, flexible status, 18px gutters, aligned under the GUEST and STATUS heads.
- **Host list:** beneath the row, plain text carries what the board cannot: kind, the full name when it exceeds 12 cells, the failure reason in red, and the check results as label and value pairs.

### Buttons
Signage keys: condensed uppercase, hairline, square.
- **Shape:** 4px radius, 1px border, padding 11px 18px; small 7px 11px at 14px; block 15px 18px at 18px, full width.
- **Default:** transparent with Ink text and border. **Primary:** Board Black fill, Paint text. On the board-black sign-in card the primary inverts to Paint fill with Board text. **Danger:** Stop Red text and border. **Ghost:** no border, underlined.
- **Hover / Active / Disabled:** hover tints the fill (8% ink; primary lightens to #2b2e33; danger 10% red) over 120 ms; active moves down 1px; disabled is 40% opacity.
- **Focus:** 2px outline in the current text colour, 2px offset, on every focusable element.

### Chips and Badges
- **Style:** condensed 14px uppercase, 0.1em, 2px radius, padding 5px 8px.
- **Chip:** neutral is Ink 2 text inside a 1px Rule keyline (policy facts, nationality, "You"); info is Ink text inside a 1px Ink keyline (default policy, bot in meeting); good is Board fill with Paint text (a live meeting); bad is Stop Red fill with white text (revoked, bot error).
- **Status badge:** used where a board row does not fit, in the guest's pick list. Waiting is outlined, Scanning is amber fill with Amber Ink, Verified is Board fill with a check, Not verified is Stop Red fill with a cross. The word is always present.

### Cards / Containers
- **Corner Style:** 4px radius.
- **Background:** Panel on steel; the sign-in card is Board Black with Paint text.
- **Shadow Strategy:** none; see Elevation.
- **Border:** 1px Rule. A dashed Ink border marks a simulation card.
- **Internal Padding:** 22px (36px 30px on the sign-in card). Narrow centred cards are capped at 440px.
- **States:** empty is a dashed Rule box with centred Ink 2 text; error is Panel with a 1px Stop Red border, red text and a small retry button; loading is centred Ink 2 text.

### Inputs / Fields
- **Style:** Field background, 1px Rule border, 4px radius, padding 10px 12px, Barlow 16px. The label sits above in the Label voice, the hint below at 14px Ink 2. Checkboxes and radios are 18px with a board-black accent.
- **Focus:** 2px Ink outline with no offset, border turns Ink.
- **Error:** a sentence in Stop Red, weight 500, below the form.
- **Pick option (guest):** full-width Panel button, at least 60px tall, Barlow 19px/600, name on the left and status badge on the right. Hover turns the border Ink; selected is Field with a 2px Ink inset keyline; disabled is transparent with Ink 2 text.

### Navigation
- **Top bar:** sticky Board Black. Wordmark, workspace select (Cell fill, Cell Edge border), account email in Dim, ghost sign-out button in Paint.
- **Tabs:** condensed 17px/600 uppercase, 0.12em. Dim at rest, Paint on hover, Paint with a 3px Paint underline when active. The row scrolls sideways on narrow screens.
- **Back link:** a condensed uppercase underlined link above the page headline on detail pages.
- **Links:** Ink, underlined at 1px, 2px on hover.

### Simulation Surfaces
When Google, Recall or Self is replaced by a stand-in, the page or card says so in the first sentence under its heading, in bold, in plain words ("Simulation, not a real Google sign-in."). A simulation card inside a real page also takes a dashed Ink border. In mock mode a single Board Shade ribbon above the app states in a sentence that the data is fake and offers a reset.

## Do's and Don'ts

### Do:
- **Do** use the shared board row (lamp, 12 name cells, 9 status cells, on board black) whenever a participant's verification state is shown as a line.
- **Do** keep status words to nine characters and uppercase, and pair every lamp and colour with its word.
- **Do** reserve amber for the step happening now.
- **Do** show verified as an inverted paint-white cell on the board and a board-black badge on light surfaces.
- **Do** announce a change of state with the cascade (66 ms steps, 45 ms stagger, left to right) and set the text immediately under prefers-reduced-motion.
- **Do** put a lone Flap on a light surface inside its own strip of board black.
- **Do** disclose a simulation in the first sentence under the heading.
- **Do** design the bot tile for 1280x720 at 15 fps seen small: nothing below 22px, no hover, no scrolling.
- **Do** write the interface in English, in plain sentences.

### Don't:
- **Don't** use green for verified, or any colour as the only carrier of status.
- **Don't** use amber for decoration, branding or generic warnings.
- **Don't** add gradients, glow, blur or drop shadows; the only shadow is the cell's inset edge.
- **Don't** make it look like a crypto project.
- **Don't** make it look like a government, customs or border-control system.
- **Don't** label a simulation with a tag above the heading in place of the sentence under it.
- **Don't** set flap text in proportional widths or mixed case, or let a row change its cell count.
- **Don't** set sentences in condensed capitals.
