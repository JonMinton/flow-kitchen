// Shared between the renderer and scripts/validate.js.
//
// A recipe's steps form a tree: parent steps summarise their children and are
// shown collapsed by default. Step inputs may reference outputs at a different
// nesting level than is currently visible (e.g. a top-level step consuming a
// sub-step's output while that group is collapsed, or a group's summary output
// while the group is expanded). resolveGraphSteps() flattens the tree to the
// currently visible steps and remaps every input to substances that actually
// exist at this visibility level, so the diagram is well-formed in every
// expand/collapse state.

export function collectVisibleSteps(steps, expanded) {
  const visible = [];
  (function collect(list) {
    for (const s of list) {
      if (s.steps && s.steps.length && expanded.has(s.id)) collect(s.steps);
      else visible.push(s);
    }
  })(steps);
  return visible;
}

export function resolveGraphSteps(recipe, expanded) {
  const parentOf = new Map();
  const producers = new Map();
  (function walk(list, parent) {
    for (const s of list) {
      parentOf.set(s, parent);
      if (s.output) {
        if (!producers.has(s.output)) producers.set(s.output, []);
        producers.get(s.output).push(s);
      }
      if (s.steps) walk(s.steps, s);
    }
  })(recipe.steps, null);

  const visible = collectVisibleSteps(recipe.steps, expanded);
  const visibleSet = new Set(visible);
  const visibleOutputs = new Set(visible.filter(s => s.output).map(s => s.output));
  const ingredientIds = new Set((recipe.ingredients || []).map(i => i.id));

  // Outputs of an expanded group's visible subtree that nothing inside the
  // subtree consumes — what the group "hands on" when its summary node is gone.
  function subtreeTerminalOutputs(group) {
    const subVisible = collectVisibleSteps(group.steps, expanded);
    const consumed = new Set();
    for (const s of subVisible) for (const i of s.inputs || []) consumed.add(i);
    return [...new Set(
      subVisible.filter(s => s.output && !consumed.has(s.output)).map(s => s.output)
    )];
  }

  function resolveInput(x) {
    if (visibleOutputs.has(x) || ingredientIds.has(x)) return [x];
    for (const p of producers.get(x) || []) {
      // Producer hidden inside a collapsed group: its nearest visible
      // ancestor's summary output stands in for it.
      let a = parentOf.get(p);
      while (a) {
        if (visibleSet.has(a)) return a.output ? [a.output] : [x];
        a = parentOf.get(a);
      }
      // x is the summary output of a group that is currently expanded:
      // substitute the group's terminal outputs.
      if (p.steps && p.steps.length && expanded.has(p.id)) {
        return subtreeTerminalOutputs(p);
      }
    }
    return [x];
  }

  return visible.map(s => ({
    ...s,
    inputs: [...new Set((s.inputs || []).flatMap(resolveInput))].filter(i => i !== s.output),
  }));
}
