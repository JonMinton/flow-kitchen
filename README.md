# Flow Kitchen

**Live site: [food.jonminton.net](https://food.jonminton.net/)**

Flow Kitchen shows recipes as **dataflow diagrams**: ingredients flow through
steps into intermediate substances and finally into the finished dish, drawn as
a vertical Sankey diagram. Every recipe is also available as a conventional,
printable text recipe — derived from the same underlying graph.

## Provenance — read this first

The recipes were **AI-generated** (drafted with Claude) and have **not been
kitchen-tested unless badged otherwise**. Every recipe carries a provenance
badge on the site:

| Badge | Meaning |
|---|---|
| *AI-generated · not yet kitchen-tested* | Plausible, machine-checked for structural consistency, but quantities, timings and techniques are unverified. Use your judgment, especially on food-safety-relevant steps. |
| *Adapted from …* | Based on a published recipe, with the source named. |
| *Kitchen-tested* | Someone actually cooked it from these instructions. |

Vegetarian labels follow a pragmatic policy: recipes containing Parmesan or
dashi keep the label but carry a visible caveat (`diet_notes`); anything with
gelatine or meat/fish is never labelled vegetarian. This is enforced by the
validator (see below).

## Data model

Each recipe is a single JSON file in `recipes/`, validated against
[`schema/recipe.schema.json`](schema/recipe.schema.json). The essential idea:
a recipe is a DAG whose nodes are *substances* and whose edges are *actions*.

```jsonc
{
  "title": "Scrambled Eggs on Toast",
  "servings": 2,
  "cuisine": "British",
  "vegetarian": true,
  "sweet": false,
  "time_minutes": 10,        // active/attended time
  "prep_minutes": 0,         // unattended lead time (marinating, proving…)
  "provenance": { "status": "generated" },
  "devices":     [ { "id": "pan", "name": "Non-stick Pan" } ],
  "ingredients": [ { "id": "eggs", "name": "Eggs", "quantity": "3" } ],
  "steps": [
    {
      "id": "beat_eggs",
      "device": "pan",
      "action": "Beat eggs with a fork",
      "inputs": ["eggs", "salt"],        // ingredient ids or other steps' outputs
      "output": "beaten_eggs",           // a new substance
      "after": "crack_eggs",             // ordering hint
      "end": { "duration_minutes": 1, "condition": "combined" },
      "steps": [ /* optional sub-steps; parent acts as a collapsed summary */ ]
    }
  ]
}
```

Conventions worth knowing:

- **Nested steps**: a parent step summarises its children and is shown
  collapsed by default. If the group culminates in one product, the final
  child shares the parent's `output` id. If it prepares several parallel
  components, each child gets its own honest output id — the renderer
  (`src/graph-resolve.js`) remaps inputs so the diagram is well-formed at
  every expand/collapse level.
- **Source steps** (e.g. "Preheat oven") may have empty `inputs`.
- `recipes/index.json` is **generated** — never edit it by hand.

## Development

```sh
npm install
npm run dev          # local dev server
npm run validate     # schema + structural + diet-policy checks
npm run build-index  # regenerate recipes/index.json from recipe files
npm run build        # validate, then production build to dist/
```

Deploys to GitHub Pages via `.github/workflows/deploy.yml` on every push to
`main`. The workflow runs the validator first — a structurally broken or
mislabelled recipe fails the deploy.

## Adding or editing a recipe

1. Create `recipes/<kebab-case-id>.json` following the schema (copy a similar
   recipe as a starting point).
2. Set `provenance.status` honestly: `generated`, `adapted` (with `source`),
   or `tested` (with `date`).
3. If it's vegetarian but contains Parmesan/dashi or similar, add a
   `diet_notes` caveat — the validator will insist.
4. Run `npm run build-index && npm run validate` and fix anything reported.
   The validator checks every expand/collapse view of your step graph, so
   dangling inputs or orphan outputs are caught before they render.

## Project history

See [`REVIEW.md`](REVIEW.md) for the full design review and the phased
revision plan this codebase follows. The repository was previously named
`recipes-as-music` after an earlier stave-based visual metaphor that was
retired in favour of the flow diagram.

## License

Code and recipe data are released under the [MIT License](LICENSE). The
recipe texts are AI-generated; no claim is made to their fitness for any
purpose — see the provenance section above.
