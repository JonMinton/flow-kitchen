# Flow Kitchen / recipes-as-music — Review & Revision Plan

*16 July 2026. Findings verified by running the site locally and by scripted audit of
all 81 recipe JSON files.*

**Decisions agreed (16 Jul 2026):**
1. **Purpose:** a real public recipe site — other people should be able to cook from it.
   Content verification, correct diet flags and visible provenance are requirements,
   not polish.
2. **Identity:** the Sankey flow diagram *is* the product. The musical-score idea is
   retired; the repo should be renamed to match "Flow Kitchen" (GitHub auto-redirects
   the old name; update `GITHUB_REPO_URL` in `renderer.js` and any deploy references).
3. **Vegetarian policy:** pragmatic labelling with per-recipe notes (e.g. "contains
   Parmesan — use a vegetarian hard cheese"), except gelatine-containing recipes
   (panna cotta) lose the vegetarian flag outright.
4. **Progressive reveal:** the default label visibility may be device/screen-dependent —
   decide by visual testing at phone/tablet/desktop widths once the renderer is
   responsive (Phase 2). Working hypothesis: labels visible by default on touch/small
   screens (hover discovery is impossible there), reveal available as an optional
   explore mode.

---

## 1. What this project is right now

A Vite + D3 static site (deployed to food.jonminton.net via GitHub Pages) with:

- 81 recipe JSON files describing recipes as **dataflow graphs**: ingredients → steps
  (with device, action, duration/end-condition, nested sub-steps) → intermediate
  substances → final dish.
- A landing page with filter pills (diet / category / time / prep / cuisine / ingredient
  search) over a hand-maintained `index.json`.
- A per-recipe **vertical Sankey diagram**: nodes are substances, links are actions.
  Labels are hidden until clicked ("progressive reveal"); expandable parent steps;
  a "Show Recipe" toggle renders a printable conventional recipe text.

## 2. The underlying idea — assessment

**The strong part.** Recipes genuinely *are* DAGs, and almost no recipe site shows this.
The JSON schema (inputs/output/device/end-condition, nested step groups) is a genuinely
good intermediate representation — it can drive *many* views (Sankey, timeline,
mise-en-place checklist, plain text, shopping list), and the "Show Recipe" view proves
the point: the text recipe is *derived* from the graph.

**The drift.** The repo is called *recipes-as-music*; the very first commit already
"replaces horizontal stave renderer with vertical Sankey diagram". The musical-score
metaphor — **time as the x-axis, devices as staves/instruments, parallelism made
visible** — is what the name promises, and it is exactly what the current Sankey
*doesn't* encode:

- Time is not encoded at all (durations only appear in hover tooltips).
- Devices are not encoded at all (also tooltip-only).
- Link widths carry no meaning (`value: 1` for every link), so the one thing a Sankey
  is *for* — magnitudes — is decorative here.
- Parallelism ("start the rice while the sauce simmers") — arguably the most useful
  thing a graph view could give a cook — is not visible.

So the current diagram answers "*what combines with what*" but not "*when, on what,
for how long, and what can I do in parallel*". **Decision: the Sankey is the product**
— the score view is retired, but the tap-to-detail card (Phase 2) should surface the
time/device information the tooltips currently hide.

**The interaction model.** Progressive reveal (labels hidden until you click a node,
which reveals all its ancestors) makes the first impression of every recipe a set of
anonymous coloured bars (verified — see screenshot notes in §4). It reads as a
guessing game rather than an explanation. It could work as an optional "quiz mode",
but as the default it hides the content the visitor came for.

**The critical content gap: the verbs are hover-only.** Step actions, durations and
devices exist *only* in mouse-hover tooltips. On any touch device there is no hover —
so on a phone or tablet (i.e. the device actually present in a kitchen) **the
instructions are unreachable from the diagram entirely**.

## 3. Cross-device / rendering issues (verified locally)

| # | Issue | Evidence |
|---|-------|----------|
| R1 | **Fixed 600 px SVG width** (`WIDTH = 600` in `renderer.js`). On a 1728 px desktop viewport the SVG is still 600 px (verified: `svg.clientWidth === 600`); on a 390 px phone CSS `max-width:100%` scales the whole SVG to ~0.65×, so 11 px labels render at ~7 px — illegible. No re-render on resize/orientation change. | JS probe in live page |
| R2 | **Right-edge clipping.** `barycentricRelax` shifts nodes but its overflow clamp works per-layer against `innerW`; with `MARGIN.left = 20` the rightmost node (right edge at x≈586 + 20 translate = 606 > 600) is clipped by the SVG boundary. | Screenshot: rightmost green node cut off in tzatziki |
| R3 | **Label truncation even at full size.** Labels are fitted inside node width at ~7 px/char, so most ingredient labels truncate to "Cucu…", "Minc…", "Oliv…" even on desktop. Node width here is proportional to link count, not label length, so this can't be tuned away — labels need to move outside nodes or nodes need min-widths. | JS probe: 11 of 13 labels truncated |
| R4 | **Hover-only tooltips** (`mouseenter`/`mousemove`) for all step detail → nothing on touch. Tooltip positioning uses `clientX` against `position:fixed` — fine, but there is no tap/click equivalent. | Code + no touch handlers anywhere |
| R5 | **No accessibility layer.** No ARIA roles/labels on SVG, no keyboard navigation, no focus states; type distinctions (ingredient/intermediate/final) partly colour-only. | Code |
| R6 | **Print** of the *diagram* view isn't handled (print CSS only handles the text view). Minor. | Code |

## 4. Data integrity issues (scripted audit of all 81 recipes)

| # | Issue | Scope |
|---|-------|-------|
| D1 | **Broken collapsed views.** In 14 recipes, a top-level step's `inputs` reference outputs of *sub-steps of another collapsed group* (e.g. tzatziki's `combine_and_season` consumes `minced_garlic`, `lemon_juice`, `chopped_dill`, which only exist inside the collapsed `prep_aromatics` group). Result in the default collapsed diagram: the group's own output (`prepped_aromatics`) dangles as a spurious second "final" (orange) node, and the sub-outputs appear as orphan grey streams feeding the dish from nowhere. **Verified visually on tzatziki.** Affected: arepas, caesar-salad, caprese-salad, carbonara, cauliflower-cheese, ceviche, chicken-biryani, chilli-con-carne, coq-au-vin, egg-fried-rice, jambalaya, kimchi-jjigae, laksa, tzatziki. | 14/81 |
| D2 | **Vegetarian flag errors.** miso-soup (dashi is normally bonito-based), panna-cotta (**gelatine — unambiguously not vegetarian**), gnocchi & pasta-aglio-e-olio (Parmesan uses animal rennet — a known judgment call, but strict labelling would exclude or note it). Diet labels are a trust/safety feature; errors here are worse than layout bugs. | 4 found |
| D3 | **index.json is hand-duplicated state** and already drifting: title mismatches (scrambled-eggs: "Scrambled Eggs" vs "Scrambled Eggs on Toast"; stir-fried noodles casing), and `time_minutes` diverging badly from summed step durations (ramen: 180 vs ~468; moussaka 90 vs 142; baklava 60 vs 108; shepherds-pie 60 vs 100; macaroni-cheese 30 vs 48). | ongoing |
| D4 | Minor: tacos-al-pastor declares an `onion` ingredient no step uses. | 1 |
| D5 | **No validation anywhere** — no schema, no CI check; D1–D4 shipped silently. | — |

## 5. Provenance

- **No README, no LICENSE, no attribution of any kind.** Recipes arrived in bulk
  (19, then 10, then 51 per commit) with no sources; they are evidently generated
  (presumably AI-assisted) rather than tested.
- Consequences: quantities, times, temperatures and techniques are unverified
  (the timing discrepancies in D3 and diet errors in D2 are direct evidence);
  food-safety-relevant steps (e.g. chicken doneness) carry the same uncertainty;
  and there's no statement to visitors about any of this on a public site.
- Recommended baseline regardless of purpose: a README + on-site note stating how
  recipes were produced; a per-recipe `provenance` field
  (`generated | adapted-from | tested`, with source/date); and a visible
  "untested/generated" vs "kitchen-tested" badge if the site is meant for others.

## 6. Revision plan

Phased so each phase ships independently. Ordering reflects the "public recipe site"
decision: data trust first, kitchen usability second, identity third, content
verification ongoing.

**Status (16 Jul 2026):** Phases 1–3 are implemented and deployed. Label-visibility
testing (Phase 2 item 4) concluded that labels-on works at all widths thanks to
row-dodging, so the default is uniform across devices with Explore Mode as the
opt-in reveal game. Phase 4 (content verification) is ongoing.

### Phase 1 — Data pipeline & integrity (foundation, ~small)
1. Write a JSON Schema for the recipe format; document it in the README.
2. Add `scripts/validate.js` (port of the audit used for this review): referential
   integrity (inputs/devices/`after`), collapsed-view solvability (fixes D1 class),
   unused ingredients, duplicate outputs, diet-flag lint (ingredient blacklist),
   servings/title consistency.
3. **Generate `index.json` from the recipe files** (title, servings, ingredients,
   derived total time from step durations) + a small per-recipe metadata block
   (cuisine, vegetarian, sweet, prep) — removes D3's whole failure class.
4. Run validator + generator in the GitHub Action before build; fail the deploy on error.
5. Fix the 14 D1 recipes (data-side: top-level steps should consume sibling groups'
   *parent* outputs; the renderer could also remap defensively) and D2/D4.
6. Apply the agreed diet policy: add a `diet_notes` field per recipe; unflag
   panna cotta as vegetarian; add caveat notes for dashi/Parmesan recipes; extend the
   validator's diet lint to enforce the policy (gelatine ⇒ never vegetarian;
   dashi/Parmesan ⇒ requires a note).

### Phase 2 — Renderer correctness & legibility (~medium)
1. Responsive width: measure `#score` container, re-render on `ResizeObserver`;
   drop the 600 px constant; scale node padding/font with width.
2. Fix R2 clipping (clamp against margins correctly, or enlarge SVG to content bounds).
3. Labels: render **outside/beside nodes** with leader alignment (or a min node
   width + two-line wrap); stop sizing text by flow width.
4. Label-visibility defaults: implement both modes behind a toggle, then **visually
   test** at 390 px / 768 px / 1280 px+ (screenshots of representative simple, medium
   and complex recipes, e.g. scrambled-eggs, tzatziki, ramen) and set the default per
   breakpoint/pointer-type (`pointer: coarse` media query). Hypothesis to test:
   labels-on for touch/small screens, reveal optional everywhere.
5. Touch/click detail: tapping a node or link opens a fixed detail card (action,
   duration, device, "until…") instead of hover-only tooltips; keep hover as a
   desktop enhancement. This is what makes the site usable in a kitchen.
6. Accessibility pass: `role="img"` + title/desc, focusable nodes with keyboard
   activation, non-colour cues for node types.

### Phase 3 — Identity & provenance (~small, mostly writing)
1. Rename the repo to match the "Flow Kitchen" identity (GitHub redirects the old
   URL); update `GITHUB_REPO_URL`, issue links and README references.
2. README: what the project is, the data model, how recipes were produced, how to
   add/verify a recipe.
3. LICENSE (code) + explicit statement on recipe content.
4. On-site provenance: site-level note plus per-recipe badge
   (`generated` / `adapted-from` / `kitchen-tested`), driven by a `provenance`
   field in each recipe JSON.

### Phase 4 — Content verification (ongoing)
Required for the public-site goal. Per-recipe provenance/tested status starting at
`generated`; prioritise verifying high-traffic recipes (add lightweight analytics or
use feedback-form volume to rank); re-derive `time_minutes` from step durations
(fixes ramen/moussaka/baklava discrepancies); food-safety review of meat/fish/egg
recipes (doneness cues, temperatures) before they earn a `kitchen-tested` badge.
