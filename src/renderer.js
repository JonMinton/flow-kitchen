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
let recipeIndex = [];
let currentView = 'diagram';
let filters = { diet: 'all', category: 'all', time: 'all', prep: 'all', cuisines: new Set(), ingredientQuery: '' };

// ── Feedback links ───────────────────────────────────────────────
const GITHUB_REPO_URL = 'https://github.com/JonMinton/recipes-as-music';
const GOOGLE_FORM_URL = 'https://forms.gle/s3G3RaV6uNNbWsHY9';

let outsideClickWired = false;

function wireFeedbackDropdown(btnSel, dropdownSel, ghLinkSel, formLinkSel, ghUrl) {
  const btn = document.querySelector(btnSel);
  const dropdown = document.querySelector(dropdownSel);
  const ghLink = document.querySelector(ghLinkSel);
  const formLink = document.querySelector(formLinkSel);

  ghLink.href = ghUrl;
  formLink.href = GOOGLE_FORM_URL;

  btn.onclick = (e) => {
    e.stopPropagation();
    // Close any other open dropdowns first
    document.querySelectorAll('.feedback-dropdown.open').forEach(d => {
      if (d !== dropdown) d.classList.remove('open');
    });
    dropdown.classList.toggle('open');
  };

  dropdown.onclick = (e) => e.stopPropagation();

  if (!outsideClickWired) {
    outsideClickWired = true;
    document.addEventListener('click', () => {
      document.querySelectorAll('.feedback-dropdown.open').forEach(d => {
        d.classList.remove('open');
      });
    });
  }
}

// ── Routing ──────────────────────────────────────────────────────
function route() {
  const hash = window.location.hash.replace('#', '');
  if (hash && recipeIndex.find(r => r.id === hash)) {
    showDiagramView(hash);
  } else {
    showLandingView();
  }
}

function showLandingView() {
  d3.select('#landing-view').style('display', null);
  d3.select('#diagram-view').style('display', 'none');
  buildCuisineFilters();
  wireFilters();
  renderCards();

  const ghUrl = `${GITHUB_REPO_URL}/issues/new?title=${encodeURIComponent('Feature request: ')}&labels=enhancement`;
  wireFeedbackDropdown('#landing-feedback-btn', '#landing-feedback-dropdown', '#landing-github-link', '#landing-form-link', ghUrl);
}

function showDiagramView(id) {
  d3.select('#landing-view').style('display', 'none');
  d3.select('#diagram-view').style('display', null);
  loadRecipe(id);
}

// ── Landing page: cuisine pills ──────────────────────────────────
function buildCuisineFilters() {
  const container = d3.select('#cuisine-filters');
  // Keep the label, remove old pills
  container.selectAll('.pill').remove();

  const cuisines = [...new Set(recipeIndex.map(r => r.cuisine))].sort();
  container.selectAll('.pill')
    .data(cuisines)
    .join('a')
    .attr('class', d => `pill cuisine-pill${filters.cuisines.has(d) ? ' active' : ''}`)
    .attr('href', '#')
    .text(d => d)
    .on('click', (event, d) => {
      event.preventDefault();
      if (filters.cuisines.has(d)) {
        filters.cuisines.delete(d);
      } else {
        filters.cuisines.add(d);
      }
      buildCuisineFilters();
      renderCards();
    });
}

// ── Landing page: wire filter controls ───────────────────────────
let filtersWired = false;
function wireFilters() {
  if (filtersWired) return;
  filtersWired = true;

  // Single-select pill groups (diet, category, time)
  d3.selectAll('#filter-bar .pill[data-filter]').on('click', function () {
    const filterName = this.dataset.filter;
    const value = this.dataset.value;
    filters[filterName] = value;

    // Update active state within group
    d3.selectAll(`#filter-bar .pill[data-filter="${filterName}"]`)
      .classed('active', function () { return this.dataset.value === value; });

    renderCards();
  });

  // Ingredient search
  d3.select('#ingredient-search').on('input', function () {
    filters.ingredientQuery = this.value.toLowerCase().trim();
    renderCards();
  });
}

// ── Landing page: render cards ───────────────────────────────────
function renderCards() {
  let filtered = recipeIndex;

  // Diet filter
  if (filters.diet === 'vegetarian') {
    filtered = filtered.filter(r => r.vegetarian);
  }

  // Category filter
  if (filters.category === 'sweet') {
    filtered = filtered.filter(r => r.sweet);
  } else if (filters.category === 'savoury') {
    filtered = filtered.filter(r => !r.sweet);
  }

  // Time filter
  if (filters.time === 'quick') {
    filtered = filtered.filter(r => r.time_minutes < 20);
  } else if (filters.time === 'medium') {
    filtered = filtered.filter(r => r.time_minutes >= 20 && r.time_minutes <= 60);
  } else if (filters.time === 'long') {
    filtered = filtered.filter(r => r.time_minutes > 60);
  }

  // Prep filter
  if (filters.prep === 'none') {
    filtered = filtered.filter(r => (r.prep_minutes || 0) === 0);
  } else if (filters.prep === 'under2h') {
    filtered = filtered.filter(r => (r.prep_minutes || 0) > 0 && (r.prep_minutes || 0) < 120);
  } else if (filters.prep === 'over2h') {
    filtered = filtered.filter(r => (r.prep_minutes || 0) >= 120 && (r.prep_minutes || 0) < 480);
  } else if (filters.prep === 'overnight') {
    filtered = filtered.filter(r => (r.prep_minutes || 0) >= 480);
  }

  // Cuisine multi-select
  if (filters.cuisines.size > 0) {
    filtered = filtered.filter(r => filters.cuisines.has(r.cuisine));
  }

  // Ingredient search
  if (filters.ingredientQuery) {
    const q = filters.ingredientQuery;
    filtered = filtered.filter(r =>
      r.ingredients.some(ing => ing.toLowerCase().includes(q))
    );
  }

  // Results count
  d3.select('#results-count').text(
    `${filtered.length} recipe${filtered.length !== 1 ? 's' : ''}`
  );

  // Card grid
  const grid = d3.select('#card-grid');
  grid.selectAll('.recipe-card')
    .data(filtered, d => d.id)
    .join(
      enter => enter.append('a')
        .attr('class', 'recipe-card')
        .attr('href', d => `#${d.id}`)
        .call(cardContent),
      update => update
        .attr('href', d => `#${d.id}`)
        .call(sel => sel.selectAll('*').remove())
        .call(cardContent),
      exit => exit.remove()
    );
}

function cardContent(sel) {
  sel.append('h2').attr('class', 'card-title').text(d => d.title);

  const badges = sel.append('div').attr('class', 'card-badges');
  badges.append('span').attr('class', 'badge badge-cuisine').text(d => d.cuisine);
  badges.filter(d => d.vegetarian).append('span').attr('class', 'badge badge-veg').text('Vegetarian');
  badges.filter(d => d.sweet).append('span').attr('class', 'badge badge-sweet').text('Sweet');

  sel.append('p').attr('class', 'card-time').text(d => {
    if (d.time_minutes < 60) return `${d.time_minutes} min`;
    const h = Math.floor(d.time_minutes / 60);
    const m = d.time_minutes % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  });

  sel.append('p').attr('class', 'card-servings').text(d => `Serves ${d.servings}`);
}

// ── Load a recipe by ID ─────────────────────────────────────────
async function loadRecipe(id) {
  recipe = await d3.json(`${import.meta.env.BASE_URL}${id}.json`);
  expanded = new Set();
  revealed = new Set();

  // Reset to diagram view
  currentView = 'diagram';
  d3.select('#score').style('display', null);
  d3.select('#recipe-text').style('display', 'none').html('');
  d3.select('#diagram-view').classed('recipe-view-active', false);
  d3.select('#view-toggle').text('Show Recipe');

  const entry = recipeIndex.find(r => r.id === id);
  d3.select('#recipe-title').text(recipe.title);
  d3.select('#recipe-meta').text(
    `${entry ? entry.cuisine + ' · ' : ''}Serves ${recipe.servings}`
  );

  const ghUrl = `${GITHUB_REPO_URL}/issues/new?title=${encodeURIComponent('Recipe feedback: ' + recipe.title)}&labels=recipe-feedback`;
  wireFeedbackDropdown('#recipe-feedback-btn', '#recipe-feedback-dropdown', '#recipe-github-link', '#recipe-form-link', ghUrl);

  wireViewToggle();
  render();
}

// ── Entry point ───────────────────────────────────────────────────
async function init() {
  recipeIndex = await d3.json(`${import.meta.env.BASE_URL}index.json`);
  route();
  window.addEventListener('hashchange', route);
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
function barycentricRelax(graph, innerW) {
  const layerMap = new Map();
  for (const node of graph.nodes) {
    const key = Math.round(node.y0 / 10) * 10;
    if (!layerMap.has(key)) layerMap.set(key, []);
    layerMap.get(key).push(node);
  }
  const layers = [...layerMap.values()];

  const ITERATIONS = 8;
  const DAMPING = 0.3;

  for (let iter = 0; iter < ITERATIONS; iter++) {
    for (const layer of layers) {
      if (layer.length <= 1) continue;

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

      layer.sort((a, b) => a.x0 - b.x0);
      for (let i = 1; i < layer.length; i++) {
        const gap = NODE_PADDING;
        if (layer[i].x0 < layer[i - 1].x1 + gap) {
          const w = layer[i].x1 - layer[i].x0;
          layer[i].x0 = layer[i - 1].x1 + gap;
          layer[i].x1 = layer[i].x0 + w;
        }
      }

      const last = layer[layer.length - 1];
      if (last.x1 > innerW) {
        const overflow = last.x1 - innerW;
        for (const n of layer) {
          n.x0 -= overflow;
          n.x1 -= overflow;
        }
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

  for (const node of graph.nodes) {
    const outLinks = graph.links.filter(l => l.source === node);
    const inLinks = graph.links.filter(l => l.target === node);

    outLinks.sort((a, b) =>
      (a.target.x0 + a.target.x1) / 2 - (b.target.x0 + b.target.x1) / 2
    );
    const nw = node.x1 - node.x0;
    if (outLinks.length > 0) {
      const step = nw / (outLinks.length + 1);
      outLinks.forEach((l, i) => { l.x0_center = node.x0 + step * (i + 1); });
    }

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

// ── View toggle ───────────────────────────────────────────────────
let toggleWired = false;
function wireViewToggle() {
  if (toggleWired) return;
  toggleWired = true;

  d3.select('#view-toggle').on('click', () => {
    if (currentView === 'diagram') {
      currentView = 'recipe';
      d3.select('#score').style('display', 'none');
      d3.select('#recipe-text').style('display', null);
      d3.select('#diagram-view').classed('recipe-view-active', true);
      d3.select('#view-toggle').text('Show Flow');
      renderRecipeText();
    } else {
      currentView = 'diagram';
      d3.select('#score').style('display', null);
      d3.select('#recipe-text').style('display', 'none');
      d3.select('#diagram-view').classed('recipe-view-active', false);
      d3.select('#view-toggle').text('Show Recipe');
    }
  });
}

// ── Recipe text rendering ─────────────────────────────────────────
function renderRecipeText() {
  const container = d3.select('#recipe-text');
  container.html('');

  const entry = recipeIndex.find(r => r.id === window.location.hash.replace('#', ''));

  // Title + meta
  container.append('h2').attr('class', 'recipe-print-title').text(recipe.title);
  const metaParts = [];
  if (entry?.cuisine) metaParts.push(entry.cuisine);
  metaParts.push(`Serves ${recipe.servings}`);
  container.append('p').attr('class', 'recipe-print-meta').text(metaParts.join(' · '));

  // Thumbnail
  container.append('div').attr('class', 'recipe-thumbnail').attr('id', 'recipe-thumbnail');
  renderThumbnail();

  // Ingredients
  container.append('h3').attr('class', 'recipe-section-heading').text('Ingredients');
  const ul = container.append('ul').attr('class', 'recipe-ingredients');
  for (const ing of recipe.ingredients) {
    ul.append('li').text(`${ing.quantity} ${ing.name}`);
  }

  // Method
  container.append('h3').attr('class', 'recipe-section-heading').text('Method');
  const methodDiv = container.append('div').attr('class', 'recipe-method');
  const sections = generateMethodSteps(recipe.steps);

  let standaloneCounter = 1;
  for (const section of sections) {
    if (section.type === 'group') {
      methodDiv.append('h4').attr('class', 'recipe-method-heading').text(section.heading);
      const ol = methodDiv.append('ol').attr('class', 'recipe-method-steps');
      for (const sub of section.substeps) {
        let text = sub.action;
        if (sub.end?.duration_minutes) text += ` (${sub.end.duration_minutes} min)`;
        if (sub.end?.condition) text += ` — until ${sub.end.condition}`;
        ol.append('li').text(text);
      }
    } else {
      let text = section.action;
      if (section.end?.duration_minutes) text += ` (${section.end.duration_minutes} min)`;
      if (section.end?.condition) text += ` — until ${section.end.condition}`;
      methodDiv.append('p')
        .attr('class', 'recipe-standalone-step')
        .text(`${standaloneCounter}. ${text}`);
      standaloneCounter++;
    }
  }
}

function generateMethodSteps(steps) {
  const sections = [];
  for (const step of steps) {
    if (step.steps && step.steps.length) {
      sections.push({
        type: 'group',
        heading: step.action || humanize(step.id),
        substeps: flattenChildren(step.steps),
      });
    } else {
      sections.push({
        type: 'standalone',
        action: step.action,
        end: step.end,
      });
    }
  }
  return sections;
}

function flattenChildren(steps) {
  const result = [];
  for (const step of steps) {
    if (step.steps && step.steps.length) {
      result.push(...flattenChildren(step.steps));
    } else {
      result.push(step);
    }
  }
  return result;
}

// ── Thumbnail rendering ───────────────────────────────────────────
function renderThumbnail() {
  const thumbContainer = d3.select('#recipe-thumbnail');
  thumbContainer.html('');

  // Save global state
  const savedExpanded = expanded;
  const savedRevealed = revealed;

  // Collapsed view with all labels visible
  expanded = new Set();
  revealed = new Set();

  const steps = visibleSteps(recipe.steps);
  const graphData = buildGraph(steps);

  // Reveal all nodes for the thumbnail
  for (const node of graphData.nodes) revealed.add(node.id);

  // Smaller dimensions
  const thumbW = 300;
  const thumbNodeWidth = 14;
  const thumbNodePadding = 8;
  const thumbMargin = { top: 20, right: 10, bottom: 20, left: 10 };
  const innerW = thumbW - thumbMargin.left - thumbMargin.right;
  const innerH = Math.max(200, graphData.nodes.length * 35);

  const sankeyGen = d3Sankey()
    .nodeAlign(sankeyLeft)
    .nodeWidth(thumbNodeWidth)
    .nodePadding(thumbNodePadding)
    .nodeSort((a, b) => (a.sortKey ?? 0) - (b.sortKey ?? 0))
    .extent([[0, 0], [innerH, innerW]]);

  const graph = sankeyGen({
    nodes: graphData.nodes.map(d => ({ ...d })),
    links: graphData.links.map(d => ({ ...d })),
  });

  swapAxes(graph, innerW, innerH);
  barycentricRelax(graph, innerW);

  const totalW = innerW + thumbMargin.left + thumbMargin.right;
  const totalH = innerH + thumbMargin.top + thumbMargin.bottom;

  const svg = thumbContainer.append('svg')
    .attr('width', totalW)
    .attr('height', totalH)
    .attr('viewBox', `0 0 ${totalW} ${totalH}`)
    .attr('preserveAspectRatio', 'xMidYMin meet')
    .style('pointer-events', 'none');

  const g = svg.append('g')
    .attr('transform', `translate(${thumbMargin.left}, ${thumbMargin.top})`);

  // Links
  g.append('g').selectAll('path')
    .data(graph.links)
    .join('path')
    .attr('d', verticalLinkPath)
    .attr('stroke', d => linkColour(d))
    .attr('stroke-width', d => Math.max(1.5, d.width))
    .attr('fill', 'none')
    .attr('opacity', 0.3);

  // Nodes
  const nodeGroups = g.append('g').selectAll('g')
    .data(graph.nodes)
    .join('g')
    .attr('transform', d => `translate(${d.x0}, ${d.y0})`);

  nodeGroups.append('rect')
    .attr('width', d => d.x1 - d.x0)
    .attr('height', d => d.y1 - d.y0)
    .attr('fill', d => nodeColour(d))
    .attr('stroke', d => d3.color(nodeColour(d)).darker(0.5))
    .attr('stroke-width', 0.5)
    .attr('rx', 3)
    .attr('ry', 3);

  nodeGroups.append('text')
    .attr('x', d => (d.x1 - d.x0) / 2)
    .attr('y', d => (d.y1 - d.y0) / 2)
    .attr('dy', '0.35em')
    .attr('text-anchor', 'middle')
    .attr('font-size', '8px')
    .attr('font-weight', 500)
    .attr('fill', d => d.type === 'final' ? '#fff' : '#333')
    .text(d => {
      const w = d.x1 - d.x0;
      const label = d.shortLabel || d.label;
      const maxChars = Math.floor(w / 5);
      if (maxChars < 3) return '';
      return label.length > maxChars ? label.slice(0, maxChars - 1) + '\u2026' : label;
    });

  // Restore global state
  expanded = savedExpanded;
  revealed = savedRevealed;
}

// ── Boot ──────────────────────────────────────────────────────────
init();
