// Generates recipes/index.json from the individual recipe files.
// The recipe files are the single source of truth; never edit index.json by hand.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RECIPES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'recipes');

export function buildIndex() {
  const entries = [];
  for (const file of readdirSync(RECIPES_DIR).sort()) {
    if (!file.endsWith('.json') || file === 'index.json') continue;
    const r = JSON.parse(readFileSync(join(RECIPES_DIR, file), 'utf8'));
    const entry = {
      id: file.replace(/\.json$/, ''),
      title: r.title,
      cuisine: r.cuisine,
      servings: r.servings,
      vegetarian: r.vegetarian,
      sweet: r.sweet,
      time_minutes: r.time_minutes,
      prep_minutes: r.prep_minutes,
      ingredients: (r.ingredients || []).map(i => i.name),
    };
    if (r.diet_notes) entry.diet_notes = r.diet_notes;
    entries.push(entry);
  }
  entries.sort((a, b) => a.title.localeCompare(b.title));
  return entries;
}

export function indexJson() {
  return JSON.stringify(buildIndex(), null, 2) + '\n';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(join(RECIPES_DIR, 'index.json'), indexJson());
  console.log(`Wrote recipes/index.json (${buildIndex().length} recipes)`);
}
