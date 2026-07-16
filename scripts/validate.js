// Validates every recipe file against the schema and a set of structural,
// diet-labelling and consistency rules. Exits non-zero on any error so it can
// gate CI deploys. Warnings are reported but do not fail the build.
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv/dist/2020.js';
import { resolveGraphSteps } from '../src/graph-resolve.js';
import { indexJson } from './build-index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RECIPES_DIR = join(ROOT, 'recipes');

const schema = JSON.parse(readFileSync(join(ROOT, 'schema', 'recipe.schema.json'), 'utf8'));
const ajv = new Ajv({ allErrors: true });
const validateSchema = ajv.compile(schema);

// Ingredient-name fragments that contradict a vegetarian flag outright…
const NEVER_VEGETARIAN = [
  'gelatine', 'gelatin', 'beef', 'pork', 'chicken', 'lamb', 'mince', 'bacon',
  'guanciale', 'pancetta', 'chorizo', 'sausage', 'prawn', 'shrimp', 'fish',
  'anchov', 'salmon', 'tuna', 'squid', 'oyster sauce', 'fish sauce', 'lard',
  'bonito', 'ham', 'duck', 'crab',
];
// …and ones that are compatible only with a diet_notes caveat (pragmatic policy).
const NEEDS_NOTE = ['parmesan', 'dashi', 'worcestershire', 'grana padano', 'pecorino'];

let errors = 0;
let warnings = 0;
function err(id, msg) { errors++; console.error(`ERROR   ${id}: ${msg}`); }
function warn(id, msg) { warnings++; console.warn(`warning ${id}: ${msg}`); }

function walkSteps(steps, fn, parent = null) {
  for (const s of steps) {
    fn(s, parent);
    if (s.steps) walkSteps(s.steps, fn, s);
  }
}

// Longest dependency chain through the leaf steps (input/output edges plus
// explicit `after` edges), used to sanity-check the authored times.
function criticalPathMinutes(recipe) {
  const leaves = [];
  walkSteps(recipe.steps, s => { if (!s.steps) leaves.push(s); });
  const byOutput = new Map(leaves.map(s => [s.output, s]));
  const byId = new Map(leaves.map(s => [s.id, s]));
  const finish = new Map();
  function finishTime(s, stack = new Set()) {
    if (finish.has(s.id)) return finish.get(s.id);
    if (stack.has(s.id)) return 0; // cycle; reported separately
    stack.add(s.id);
    let start = 0;
    for (const inp of s.inputs || []) {
      const dep = byOutput.get(inp);
      if (dep && dep !== s) start = Math.max(start, finishTime(dep, stack));
    }
    for (const a of [].concat(s.after || [])) {
      const dep = byId.get(a);
      if (dep && dep !== s) start = Math.max(start, finishTime(dep, stack));
    }
    stack.delete(s.id);
    const t = start + (s.end?.duration_minutes || 0);
    finish.set(s.id, t);
    return t;
  }
  return Math.max(0, ...leaves.map(s => finishTime(s)));
}

function checkRecipe(id, r) {
  if (!validateSchema(r)) {
    for (const e of validateSchema.errors) err(id, `schema: ${e.instancePath || '/'} ${e.message}`);
    return; // structural checks assume a schema-valid shape
  }

  const ingredientIds = new Set(r.ingredients.map(i => i.id));
  const deviceIds = new Set((r.devices || []).map(d => d.id));

  // Unique ids, device/after references, output collisions
  const stepIds = new Map();
  const outputOwners = new Map(); // output -> [step]
  const ancestors = new Map(); // step -> Set of ancestor steps
  walkSteps(r.steps, (s, parent) => {
    if (stepIds.has(s.id)) err(id, `duplicate step id '${s.id}'`);
    stepIds.set(s.id, s);
    const anc = new Set(parent ? [parent, ...ancestors.get(parent)] : []);
    ancestors.set(s, anc);
    if (s.device && !deviceIds.has(s.device)) err(id, `step '${s.id}' uses undeclared device '${s.device}'`);
    if (!outputOwners.has(s.output)) outputOwners.set(s.output, []);
    outputOwners.get(s.output).push(s);
    if (ingredientIds.has(s.output)) err(id, `step '${s.id}' output '${s.output}' collides with an ingredient id`);
  });
  walkSteps(r.steps, s => {
    for (const a of [].concat(s.after || [])) {
      if (!stepIds.has(a)) err(id, `step '${s.id}' after '${a}' matches no step`);
    }
  });
  // The same output id may only be shared along an ancestor chain
  // (a group summarising its final child), never by unrelated steps.
  for (const [out, owners] of outputOwners) {
    for (let i = 0; i < owners.length; i++) {
      for (let j = i + 1; j < owners.length; j++) {
        const a = owners[i], b = owners[j];
        if (!ancestors.get(a).has(b) && !ancestors.get(b).has(a)) {
          err(id, `output '${out}' produced by unrelated steps '${a.id}' and '${b.id}'`);
        }
      }
    }
  }

  // Every input must resolve to something (ingredient or some step's output)
  const allOutputs = new Set(outputOwners.keys());
  walkSteps(r.steps, s => {
    for (const inp of s.inputs) {
      if (!ingredientIds.has(inp) && !allOutputs.has(inp)) {
        err(id, `step '${s.id}' input '${inp}' matches no ingredient or step output`);
      }
    }
  });

  // Unused ingredients
  const used = new Set();
  walkSteps(r.steps, s => s.inputs.forEach(i => used.add(i)));
  for (const ing of ingredientIds) {
    if (!used.has(ing)) err(id, `ingredient '${ing}' is never used by any step`);
  }

  // The diagram must be well-formed in both extreme visibility states:
  // everything collapsed (the default view) and everything expanded.
  const groupIds = [];
  walkSteps(r.steps, s => { if (s.steps) groupIds.push(s.id); });
  for (const [label, expanded] of [
    ['collapsed view', new Set()],
    ['expanded view', new Set(groupIds)],
  ]) {
    const steps = resolveGraphSteps(r, expanded);
    const produced = new Set(steps.map(s => s.output));
    const consumed = new Set(steps.flatMap(s => s.inputs));
    for (const s of steps) {
      for (const inp of s.inputs) {
        if (!ingredientIds.has(inp) && !produced.has(inp)) {
          err(id, `${label}: step '${s.id}' input '${inp}' has no visible producer`);
        }
      }
    }
    const finals = [...produced].filter(o => !consumed.has(o));
    if (finals.length !== 1) {
      err(id, `${label}: expected exactly 1 final product, got ${finals.length} (${finals.join(', ')})`);
    }
  }

  // Diet lint (pragmatic policy)
  const ingredientNames = r.ingredients.map(i => i.name.toLowerCase());
  if (r.vegetarian) {
    for (const frag of NEVER_VEGETARIAN) {
      const hit = ingredientNames.find(n => n.includes(frag));
      if (hit) err(id, `flagged vegetarian but ingredient '${hit}' matches '${frag}'`);
    }
    for (const frag of NEEDS_NOTE) {
      const hit = ingredientNames.find(n => n.includes(frag));
      if (hit && !(r.diet_notes || '').toLowerCase().includes(frag.split(' ')[0])) {
        err(id, `flagged vegetarian with '${hit}' but diet_notes does not mention '${frag}'`);
      }
    }
  }

  // Timing sanity (warning only): authored total vs dependency-chain estimate
  const authored = r.time_minutes + r.prep_minutes;
  const critical = criticalPathMinutes(r);
  if (critical > 0 && Math.abs(critical - authored) > Math.max(20, authored * 0.6)) {
    warn(id, `time_minutes+prep_minutes = ${authored}m but step dependency chain sums to ~${Math.round(critical)}m`);
  }
}

const files = readdirSync(RECIPES_DIR).sort()
  .filter(f => f.endsWith('.json') && f !== 'index.json');
for (const file of files) {
  const id = file.replace(/\.json$/, '');
  let r;
  try {
    r = JSON.parse(readFileSync(join(RECIPES_DIR, file), 'utf8'));
  } catch (e) {
    err(id, `invalid JSON: ${e.message}`);
    continue;
  }
  checkRecipe(id, r);
}

// index.json must be exactly what build-index generates
const committed = readFileSync(join(RECIPES_DIR, 'index.json'), 'utf8');
if (committed !== indexJson()) {
  err('index', `recipes/index.json is stale — run: npm run build-index`);
}

console.log(`\n${files.length} recipes checked: ${errors} error(s), ${warnings} warning(s)`);
if (errors > 0) process.exit(1);
