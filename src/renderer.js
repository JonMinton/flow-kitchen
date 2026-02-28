import * as d3 from 'd3';
import { sankey as d3Sankey, sankeyLeft } from 'd3-sankey';

// ── Layout constants ──────────────────────────────────────────────
const WIDTH = 600;
const NODE_WIDTH = 20;
const NODE_PADDING = 12;
const MARGIN = { top: 40, right: 20, bottom: 40, left: 20 };

// ── Colour palettes ──────────────────────────────────────────────
const INGREDIENT_COLOURS = d3.schemeTableau10;

// ── State ─────────────────────────────────────────────────────────
let recipe = null;
let expanded = new Set();
let revealed = new Set();

// ── Entry point ───────────────────────────────────────────────────
async function init() {
  recipe = await d3.json('/victoria-sponge.json');

  d3.select('#recipe-title').text(recipe.title);
  d3.select('#recipe-meta').text(`Serves ${recipe.servings}`);

  render();
}

// ── Gather visible steps (respecting expand state) ────────────────
function visibleSteps(steps, parentId = null) {
  const result = [];
  for (const step of steps) {
    if (step.steps && expanded.has(step.id)) {
      result.push(...visibleSteps(step.steps, step.id));
    } else {
      result.push({ ...step, _parentId: parentId });
    }
  }
  return result;
}

// ── Humanize an ID like "creamed_mixture" → "Creamed mixture" ─────
function humanize(id) {
  return id.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
}

// ── Build graph: nodes = substances, links = actions ──────────────
function buildGraph(steps) {
  const nodes = [];
  const links = [];
  const nodeIndex = new Map();

  const ingById = new Map(recipe.ingredients.map(i => [i.id, i]));
  const allIngIds = new Set(recipe.ingredients.map(i => i.id));

  const ingColourMap = new Map();
  recipe.ingredients.forEach((ing, i) => {
    ingColourMap.set(ing.id, INGREDIENT_COLOURS[i % INGREDIENT_COLOURS.length]);
  });

  function addNode(id, meta) {
    if (nodeIndex.has(id)) return nodeIndex.get(id);
    const idx = nodes.length;
    nodes.push({ id, ...meta });
    nodeIndex.set(id, idx);
    return idx;
  }

  function addLink(sourceId, targetId, action, step) {
    const s = nodeIndex.get(sourceId);
    const t = nodeIndex.get(targetId);
    if (s != null && t != null && s !== t) {
      links.push({ source: s, target: t, value: 1, action, step });
    }
  }

  // Which parent steps have children (for expand/collapse on their output node)
  const expandableOutputs = new Map();
  function findExpandables(stepList) {
    for (const step of stepList) {
      if (step.steps && step.steps.length && step.output) {
        expandableOutputs.set(step.output, step);
      }
      if (step.steps) findExpandables(step.steps);
    }
  }
  findExpandables(recipe.steps);

  // Create substance nodes from visible step inputs/outputs
  for (const step of steps) {
    for (const inp of step.inputs || []) {
      if (!nodeIndex.has(inp)) {
        const ing = ingById.get(inp);
        if (ing) {
          addNode(inp, {
            type: 'ingredient',
            label: `${ing.name} (${ing.quantity})`,
            shortLabel: ing.name,
            colour: ingColourMap.get(inp),
          });
        } else {
          addNode(inp, {
            type: 'intermediate',
            label: humanize(inp),
            shortLabel: humanize(inp),
            expandableStepId: expandableOutputs.get(inp)?.id || null,
          });
        }
      }
    }
    if (step.output && !nodeIndex.has(step.output)) {
      const ing = ingById.get(step.output);
      if (ing) {
        addNode(step.output, {
          type: 'ingredient',
          label: `${ing.name} (${ing.quantity})`,
          shortLabel: ing.name,
          colour: ingColourMap.get(step.output),
        });
      } else {
        addNode(step.output, {
          type: 'intermediate',
          label: humanize(step.output),
          shortLabel: humanize(step.output),
          expandableStepId: expandableOutputs.get(step.output)?.id || null,
        });
      }
    }
  }

  // Mark final products (outputs not consumed by any step)
  const consumedOutputs = new Set();
  for (const step of steps) {
    for (const inp of step.inputs || []) consumedOutputs.add(inp);
  }
  for (const step of steps) {
    if (step.output && !consumedOutputs.has(step.output)) {
      const node = nodes[nodeIndex.get(step.output)];
      if (node) node.type = 'final';
    }
  }

  // Wire links: each step connects inputs → output
  for (const step of steps) {
    if (!step.output) continue;
    for (const inp of step.inputs || []) {
      if (nodeIndex.has(inp) && nodeIndex.has(step.output)) {
        addLink(inp, step.output, step.action, step);
      }
    }
  }

  // ── Sort keys: group nodes by which step-stream they belong to ──
  // For each substance, find the earliest consuming step index.
  // This clusters ingredients that feed the same step, and separates
  // jam (late consumer) from butter/sugar/etc (early consumer).
  const substanceFirstConsumer = new Map();
  steps.forEach((step, idx) => {
    for (const inp of step.inputs || []) {
      if (!substanceFirstConsumer.has(inp)) {
        substanceFirstConsumer.set(inp, idx);
      }
    }
  });

  for (const node of nodes) {
    const consumer = substanceFirstConsumer.get(node.id);
    node.sortKey = consumer != null ? consumer : steps.length;
  }

  // Auto-reveal final product on first render
  if (revealed.size === 0) {
    for (const node of nodes) {
      if (node.type === 'final') revealed.add(node.id);
    }
  }

  return { nodes, links };
}

// ── Find ancestor node IDs (upstream via links) ───────────────────
function findAncestors(nodeId, graph) {
  const ancestors = new Set();
  const visited = new Set();

  const inbound = new Map();
  for (const link of graph.links) {
    const tid = link.target.id ?? link.target;
    const sid = link.source.id ?? link.source;
    if (!inbound.has(tid)) inbound.set(tid, []);
    inbound.get(tid).push(sid);
  }

  function walk(id) {
    if (visited.has(id)) return;
    visited.add(id);
    ancestors.add(id);
    for (const parent of inbound.get(id) || []) {
      walk(parent);
    }
  }

  walk(nodeId);
  return ancestors;
}

// ── Swap x↔y after d3-sankey horizontal layout ────────────────────
function swapAxes(graph, totalWidth, totalHeight) {
  const layoutW = graph.nodes.reduce((m, n) => Math.max(m, n.x1), 0);
  const layoutH = graph.nodes.reduce((m, n) => Math.max(m, n.y1), 0);

  const scaleX = totalWidth / (layoutH || 1);
  const scaleY = totalHeight / (layoutW || 1);

  for (const node of graph.nodes) {
    const ox0 = node.x0, ox1 = node.x1, oy0 = node.y0, oy1 = node.y1;
    node.x0 = oy0 * scaleX;
    node.x1 = oy1 * scaleX;
    node.y0 = ox0 * scaleY;
    node.y1 = ox1 * scaleY;
  }

  for (const link of graph.links) {
    link.x0_center = link.y0 * scaleX;
    link.x1_center = link.y1 * scaleX;
    link.y0 = link.source.y1;
    link.y1 = link.target.y0;
    link.width = link.width * scaleX;
  }
}

// ── Barycentric relaxation: attract nodes toward their neighbours ─
// Each node is nudged toward the average x-centre of its connected
// neighbours. Nodes with no shared connections drift apart naturally.
function barycentricRelax(graph, innerW) {
  // Group nodes into layers by y-position (within tolerance)
  const layerMap = new Map();
  for (const node of graph.nodes) {
    const key = Math.round(node.y0 / 10) * 10; // bucket by ~10px
    if (!layerMap.has(key)) layerMap.set(key, []);
    layerMap.get(key).push(node);
  }
  const layers = [...layerMap.values()];

  const ITERATIONS = 8;
  const DAMPING = 0.3;

  for (let iter = 0; iter < ITERATIONS; iter++) {
    for (const layer of layers) {
      if (layer.length <= 1) continue;

      // Compute target x for each node based on connected neighbours
      for (const node of layer) {
        let sumX = 0;
        let count = 0;

        for (const link of graph.links) {
          if (link.source === node) {
            sumX += (link.target.x0 + link.target.x1) / 2;
            count++;
          } else if (link.target === node) {
            sumX += (link.source.x0 + link.source.x1) / 2;
            count++;
          }
        }

        if (count > 0) {
          const idealX = sumX / count;
          const cx = (node.x0 + node.x1) / 2;
          const dx = (idealX - cx) * DAMPING;
          const w = node.x1 - node.x0;
          node.x0 += dx;
          node.x1 = node.x0 + w;
        }
      }

      // Resolve overlaps: sort by x0, push apart
      layer.sort((a, b) => a.x0 - b.x0);
      for (let i = 1; i < layer.length; i++) {
        const gap = NODE_PADDING;
        if (layer[i].x0 < layer[i - 1].x1 + gap) {
          const w = layer[i].x1 - layer[i].x0;
          layer[i].x0 = layer[i - 1].x1 + gap;
          layer[i].x1 = layer[i].x0 + w;
        }
      }

      // Clamp right edge to innerW
      const last = layer[layer.length - 1];
      if (last.x1 > innerW) {
        const overflow = last.x1 - innerW;
        for (const n of layer) {
          n.x0 -= overflow;
          n.x1 -= overflow;
        }
        // Re-clamp left edge
        if (layer[0].x0 < 0) {
          const shift = -layer[0].x0;
          for (const n of layer) {
            n.x0 += shift;
            n.x1 += shift;
          }
        }
      }
    }
  }

  // Recompute link x-centres from final node positions.
  // Distribute link attachment points evenly across each node's width,
  // sorted so that links aim toward their partner without crossing.
  for (const node of graph.nodes) {
    const outLinks = graph.links.filter(l => l.source === node);
    const inLinks = graph.links.filter(l => l.target === node);

    // Sort outgoing links by target x-centre
    outLinks.sort((a, b) =>
      (a.target.x0 + a.target.x1) / 2 - (b.target.x0 + b.target.x1) / 2
    );
    const nw = node.x1 - node.x0;
    if (outLinks.length > 0) {
      const step = nw / (outLinks.length + 1);
      outLinks.forEach((l, i) => { l.x0_center = node.x0 + step * (i + 1); });
    }

    // Sort incoming links by source x-centre
    inLinks.sort((a, b) =>
      (a.source.x0 + a.source.x1) / 2 - (b.source.x0 + b.source.x1) / 2
    );
    if (inLinks.length > 0) {
      const step = nw / (inLinks.length + 1);
      inLinks.forEach((l, i) => { l.x1_center = node.x0 + step * (i + 1); });
    }
  }
}

// ── Vertical link path ────────────────────────────────────────────
function verticalLinkPath(d) {
  const sx = d.x0_center;
  const sy = d.y0;
  const tx = d.x1_center;
  const ty = d.y1;
  const midY = (sy + ty) / 2;
  return `M${sx},${sy} C${sx},${midY} ${tx},${midY} ${tx},${ty}`;
}

// ── Render ─────────────────────────────────────────────────────────
function render() {
  const steps = visibleSteps(recipe.steps);
  const graphData = buildGraph(steps);

  const innerW = WIDTH - MARGIN.left - MARGIN.right;
  const estimatedHeight = Math.max(400, graphData.nodes.length * 50);
  const innerH = estimatedHeight;

  const sankeyGen = d3Sankey()
    .nodeAlign(sankeyLeft)
    .nodeWidth(NODE_WIDTH)
    .nodePadding(NODE_PADDING)
    .nodeSort((a, b) => (a.sortKey ?? 0) - (b.sortKey ?? 0))
    .extent([[0, 0], [innerH, innerW]]);

  const graph = sankeyGen({
    nodes: graphData.nodes.map(d => ({ ...d })),
    links: graphData.links.map(d => ({ ...d })),
  });

  swapAxes(graph, innerW, innerH);
  barycentricRelax(graph, innerW);

  const totalW = innerW + MARGIN.left + MARGIN.right;
  const totalH = innerH + MARGIN.top + MARGIN.bottom;

  // Clear & recreate SVG
  d3.select('#score').selectAll('*').remove();
  const svg = d3.select('#score')
    .append('svg')
    .attr('width', totalW)
    .attr('height', totalH)
    .attr('viewBox', `0 0 ${totalW} ${totalH}`)
    .attr('preserveAspectRatio', 'xMidYMin meet');

  const g = svg.append('g')
    .attr('transform', `translate(${MARGIN.left}, ${MARGIN.top})`);

  // ── Render links (verbs) ──
  const linkG = g.append('g').attr('class', 'sankey-links');
  const tooltip = d3.select('#tooltip');

  linkG.selectAll('path')
    .data(graph.links)
    .join('path')
    .attr('class', 'sankey-link')
    .attr('d', verticalLinkPath)
    .attr('stroke', d => linkColour(d))
    .attr('stroke-width', d => Math.max(2, d.width))
    .attr('fill', 'none')
    .attr('opacity', 0.35)
    .on('mouseenter', (event, d) => {
      const lines = [d.action];
      if (d.step) {
        if (d.step.end?.duration_minutes) lines.push(`Duration: ${d.step.end.duration_minutes} min`);
        if (d.step.end?.condition) lines.push(`Until: ${d.step.end.condition}`);
        const dev = recipe.devices.find(dv => dv.id === d.step.device);
        if (dev) lines.push(`Using: ${dev.name}${dev.settings ? ' (' + dev.settings + ')' : ''}`);
      }
      tooltip
        .html(lines.join('<br>'))
        .classed('visible', true)
        .style('left', (event.clientX + 12) + 'px')
        .style('top', (event.clientY - 10) + 'px');
    })
    .on('mousemove', (event) => {
      tooltip
        .style('left', (event.clientX + 12) + 'px')
        .style('top', (event.clientY - 10) + 'px');
    })
    .on('mouseleave', () => tooltip.classed('visible', false));

  // ── Render nodes (substances) ──
  const nodeG = g.append('g').attr('class', 'sankey-nodes');

  const nodeGroups = nodeG.selectAll('g')
    .data(graph.nodes)
    .join('g')
    .attr('class', d => `sankey-node sankey-node--${d.type}`)
    .attr('transform', d => `translate(${d.x0}, ${d.y0})`);

  nodeGroups.append('rect')
    .attr('width', d => d.x1 - d.x0)
    .attr('height', d => d.y1 - d.y0)
    .attr('fill', d => nodeColour(d))
    .attr('stroke', d => d3.color(nodeColour(d)).darker(0.5))
    .attr('stroke-width', 1)
    .attr('rx', 4)
    .attr('ry', 4);

  // Labels — only for revealed nodes
  nodeGroups.append('text')
    .attr('class', 'sankey-label')
    .attr('x', d => (d.x1 - d.x0) / 2)
    .attr('y', d => (d.y1 - d.y0) / 2)
    .attr('dy', '0.35em')
    .attr('text-anchor', 'middle')
    .attr('opacity', d => revealed.has(d.id) ? 1 : 0)
    .text(d => {
      const w = d.x1 - d.x0;
      const label = d.shortLabel || d.label;
      const maxChars = Math.floor(w / 7);
      if (maxChars < 3) return '';
      return label.length > maxChars ? label.slice(0, maxChars - 1) + '\u2026' : label;
    })
    .attr('fill', d => d.type === 'final' ? '#fff' : '#333');

  // Expand/collapse indicator
  nodeGroups.filter(d => d.expandableStepId && revealed.has(d.id))
    .append('text')
    .attr('class', 'expand-indicator')
    .attr('x', d => (d.x1 - d.x0) / 2)
    .attr('y', d => (d.y1 - d.y0) - 4)
    .attr('text-anchor', 'middle')
    .attr('fill', '#666')
    .attr('font-size', '10px')
    .text(d => expanded.has(d.expandableStepId) ? '\u25b4' : '\u25be');

  // Click: reveal → then expand/collapse
  nodeGroups
    .style('cursor', 'pointer')
    .on('click', (event, d) => {
      if (!revealed.has(d.id)) {
        const ancestors = findAncestors(d.id, graph);
        for (const id of ancestors) revealed.add(id);
        render();
      } else if (d.expandableStepId) {
        if (expanded.has(d.expandableStepId)) {
          expanded.delete(d.expandableStepId);
        } else {
          expanded.add(d.expandableStepId);
        }
        render();
      }
    });

  // Node tooltips
  nodeGroups
    .on('mouseenter', (event, d) => {
      const lines = [d.label];
      if (d.expandableStepId && revealed.has(d.id)) {
        lines.push(expanded.has(d.expandableStepId) ? '(click to collapse)' : '(click to expand)');
      }
      if (!revealed.has(d.id)) lines.push('(click to reveal)');
      tooltip
        .html(lines.join('<br>'))
        .classed('visible', true)
        .style('left', (event.clientX + 12) + 'px')
        .style('top', (event.clientY - 10) + 'px');
    })
    .on('mousemove', (event) => {
      tooltip
        .style('left', (event.clientX + 12) + 'px')
        .style('top', (event.clientY - 10) + 'px');
    })
    .on('mouseleave', () => tooltip.classed('visible', false));
}

// ── Node colour by type ───────────────────────────────────────────
function nodeColour(d) {
  switch (d.type) {
    case 'ingredient': return d.colour || '#999';
    case 'intermediate': return '#b8c9dc';
    case 'final': return '#c0713a';
    default: return '#999';
  }
}

// ── Link colour: inherit from source node ─────────────────────────
function linkColour(d) {
  if (d.source.colour) return d.source.colour;
  return '#999';
}

// ── Boot ──────────────────────────────────────────────────────────
init();
