import * as d3 from 'd3';
import { sankey as d3Sankey, sankeyLeft } from 'd3-sankey';
import { resolveGraphSteps } from './graph-resolve.js';

// ── Layout constants ──────────────────────────────────────────────
const MIN_DIAGRAM_WIDTH = 300;
const MAX_DIAGRAM_WIDTH = 900;
const NODE_WIDTH = 20;
const NODE_PADDING = 12;

// ── Colour palettes ──────────────────────────────────────────────
const INGREDIENT_COLOURS = d3.schemeTableau10;

// ── State ─────────────────────────────────────────────────────────
let recipe = null;
let expanded = new Set();
let revealed = new Set();
let recipeIndex = [];
let currentView = 'diagram';
let filters = { diet: 'all', category: 'all', time: 'all', prep: 'all', cuisines: new Set(), ingredientQuery: '' };

// Labels are visible by default; touch devices cannot hover so they must
// never default to the hidden-label explore mode.
const isTouch = window.matchMedia('(pointer: coarse)').matches;
const canHover = window.matchMedia('(hover: hover)').matches;
let labelsOn = true;

// ── Provenance badges ────────────────────────────────────────────
const PROVENANCE_BADGES = {
  generated: { text: 'AI-generated · not yet kitchen-tested', cls: 'provenance-generated' },
  adapted: { text: 'Adapted from a published recipe', cls: 'provenance-adapted' },
  tested: { text: 'Kitchen-tested', cls: 'provenance-tested' },
};

function provenanceBadgeInfo(prov) {
  const badge = PROVENANCE_BADGES[prov?.status] || PROVENANCE_BADGES.generated;
  let text = badge.text;
  if (prov?.status === 'adapted' && prov.source) text = `Adapted from ${prov.source}`;
  if (prov?.status === 'tested' && prov.date) text = `Kitchen-tested ${prov.date}`;
  return { text, cls: badge.cls };
}

// ── Feedback links ───────────────────────────────────────────────
const GITHUB_REPO_URL = 'https://github.com/JonMinton/flow-kitchen';
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
  hideDetail();
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
  d3.select('#tooltip').classed('visible', false);
  hideDetail();

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
  d3.select('#diet-note')
    .text(recipe.diet_notes || '')
    .style('display', recipe.diet_notes ? null : 'none');
  const badge = provenanceBadgeInfo(recipe.provenance);
  d3.select('#provenance-badge')
    .attr('class', `provenance-badge ${badge.cls}`)
    .text(badge.text);

  const ghUrl = `${GITHUB_REPO_URL}/issues/new?title=${encodeURIComponent('Recipe feedback: ' + recipe.title)}&labels=recipe-feedback`;
  wireFeedbackDropdown('#recipe-feedback-btn', '#recipe-feedback-dropdown', '#recipe-github-link', '#recipe-form-link', ghUrl);

  wireViewToggle();
  wireLabelsToggle();
  render();
}

// ── Entry point ───────────────────────────────────────────────────
async function init() {
  recipeIndex = await d3.json(`${import.meta.env.BASE_URL}index.json`);
  route();
  window.addEventListener('hashchange', route);
  wireDetailCard();
  wireResize();
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
  function substanceNode(id) {
    if (nodeIndex.has(id)) return;
    const ing = ingById.get(id);
    if (ing) {
      addNode(id, {
        type: 'ingredient',
        label: `${ing.name} (${ing.quantity})`,
        shortLabel: ing.name,
        colour: ingColourMap.get(id),
      });
    } else {
      addNode(id, {
        type: 'intermediate',
        label: humanize(id),
        shortLabel: humanize(id),
        expandableStepId: expandableOutputs.get(id)?.id || null,
      });
    }
  }

  for (const step of steps) {
    for (const inp of step.inputs || []) substanceNode(inp);
    if (step.output) substanceNode(step.output);
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

  // Wire links: each step connects inputs → output, and nodes remember
  // which steps produce them (for the detail card).
  for (const step of steps) {
    if (!step.output) continue;
    const outNode = nodes[nodeIndex.get(step.output)];
    if (outNode) (outNode.producedBy ||= []).push(step);
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

  // Auto-reveal final product on first render (explore mode)
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
function barycentricRelax(graph, innerW, nodePadding) {
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
        const gap = nodePadding;
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

// ── Detail card (touch-friendly replacement for hover tooltips) ───
function wireDetailCard() {
  document.getElementById('detail-close').addEventListener('click', hideDetail);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideDetail();
  });
}

function showDetail(buildFn) {
  const body = d3.select('#detail-body');
  body.html('');
  buildFn(body);
  document.getElementById('detail-card').hidden = false;
}

function hideDetail() {
  const card = document.getElementById('detail-card');
  if (card) card.hidden = true;
}

function deviceLine(step) {
  const dev = (recipe.devices || []).find(dv => dv.id === step.device);
  if (!dev) return null;
  return `${dev.name}${dev.settings ? ' (' + dev.settings + ')' : ''}`;
}

function stepFacts(body, step) {
  const facts = [];
  if (step.end?.duration_minutes) facts.push(`${step.end.duration_minutes} min`);
  if (step.end?.condition) facts.push(`until ${step.end.condition}`);
  const dev = deviceLine(step);
  if (dev) facts.push(`using ${dev}`);
  if (facts.length) body.append('p').attr('class', 'detail-facts').text(facts.join(' · '));
}

function showLinkDetail(d) {
  showDetail(body => {
    body.append('h3').text(d.action);
    if (d.step) stepFacts(body, d.step);
  });
}

function showNodeDetail(d) {
  showDetail(body => {
    body.append('h3').text(d.label);
    if (d.type === 'final') body.append('p').attr('class', 'detail-facts').text('Final dish');
    for (const step of d.producedBy || []) {
      body.append('p').attr('class', 'detail-step').text(step.action);
      stepFacts(body, step);
    }
  });
}

// ── Shared flow drawing (main diagram + thumbnail) ────────────────
function drawFlow(containerSel, opts) {
  const {
    width, nodeWidth, nodePadding, margin, fontSize, rowHeight, interactive,
  } = opts;

  const steps = resolveGraphSteps(recipe, expanded);
  const graphData = buildGraph(steps);

  const innerW = width - margin.left - margin.right;
  const innerH = Math.max(opts.minHeight, graphData.nodes.length * rowHeight);

  const sankeyGen = d3Sankey()
    .nodeAlign(sankeyLeft)
    .nodeWidth(nodeWidth)
    .nodePadding(nodePadding)
    .nodeSort((a, b) => (a.sortKey ?? 0) - (b.sortKey ?? 0))
    .extent([[0, 0], [innerH, innerW]]);

  const graph = sankeyGen({
    nodes: graphData.nodes.map(d => ({ ...d })),
    links: graphData.links.map(d => ({ ...d })),
  });

  swapAxes(graph, innerW, innerH);
  barycentricRelax(graph, innerW, nodePadding);

  for (const link of graph.links) link.target._hasIncoming = true;

  // Relaxation can push nodes slightly outside [0, innerW]; grow the
  // canvas to the actual content bounds so nothing is clipped.
  const minX = Math.min(0, d3.min(graph.nodes, n => n.x0));
  const maxX = Math.max(innerW, d3.max(graph.nodes, n => n.x1));
  const totalW = (maxX - minX) + margin.left + margin.right;
  const totalH = innerH + margin.top + margin.bottom;

  const container = d3.select(containerSel);
  container.selectAll('*').remove();
  const svg = container
    .append('svg')
    .attr('width', totalW)
    .attr('height', totalH)
    .attr('viewBox', `0 0 ${totalW} ${totalH}`)
    .attr('preserveAspectRatio', 'xMidYMin meet')
    .attr('role', 'img')
    .attr('aria-label', `Ingredient flow diagram for ${recipe.title}`);

  const g = svg.append('g')
    .attr('transform', `translate(${margin.left - minX}, ${margin.top})`);

  const labelVisible = d => labelsOn || revealed.has(d.id);
  const tooltip = d3.select('#tooltip');

  // ── Links (verbs) ──
  const linkPaths = g.append('g').attr('class', 'sankey-links')
    .selectAll('path')
    .data(graph.links)
    .join('path')
    .attr('class', 'sankey-link')
    .attr('d', verticalLinkPath)
    .attr('stroke', d => linkColour(d))
    .attr('stroke-width', d => Math.max(2, d.width))
    .attr('fill', 'none')
    .attr('opacity', 0.35);

  // ── Nodes (substances) ──
  const nodeGroups = g.append('g').attr('class', 'sankey-nodes')
    .selectAll('g')
    .data(graph.nodes)
    .join('g')
    .attr('class', d => `sankey-node sankey-node--${d.type}`)
    .attr('transform', d => `translate(${d.x0}, ${d.y0})`);

  nodeGroups.append('rect')
    .attr('width', d => d.x1 - d.x0)
    .attr('height', d => d.y1 - d.y0)
    .attr('fill', d => nodeColour(d))
    .attr('stroke', d => d3.color(nodeColour(d)).darker(0.5))
    .attr('stroke-width', d => d.type === 'final' ? 1.5 : 1)
    .attr('stroke-dasharray', d => d.type === 'intermediate' ? '3 2' : null)
    .attr('rx', 4)
    .attr('ry', 4);

  // Labels: inside the node when they fit, otherwise just outside it
  // (above for source nodes, below otherwise) with a halo for legibility.
  const outsideLabels = [];
  nodeGroups.append('text')
    .attr('class', 'sankey-label')
    .attr('font-size', fontSize)
    .attr('text-anchor', 'middle')
    .attr('opacity', d => labelVisible(d) ? 1 : 0)
    .text(d => d.shortLabel || d.label)
    .each(function (d) {
      const t = d3.select(this);
      const nodeW = d.x1 - d.x0;
      const nodeH = d.y1 - d.y0;
      const cx = nodeW / 2;
      if (this.getComputedTextLength() <= nodeW - 8) {
        t.attr('x', cx).attr('y', nodeH / 2).attr('dy', '0.35em')
          .attr('fill', d.type === 'final' ? '#fff' : '#333');
      } else {
        const above = !d._hasIncoming;
        t.classed('sankey-label--outside', true)
          .attr('x', cx)
          .attr('y', above ? -5 : nodeH + 4)
          .attr('dy', above ? '0' : '0.8em')
          .attr('fill', '#444');
        const maxPx = Math.max(nodeW + nodePadding * 2 - 4, opts.maxLabelPx || 110);
        let label = t.text();
        while (label.length > 3 && this.getComputedTextLength() > maxPx) {
          label = label.slice(0, -1);
          t.text(label + '…');
        }
        outsideLabels.push({ el: this, d, above });
      }
    });

  // Keep outside labels within the canvas edges, then dodge collisions
  // within a layer by stacking labels on additional rows (needed on narrow
  // screens where nodes sit close together).
  for (const l of outsideLabels) {
    const w = l.el.getComputedTextLength();
    const cx = (l.d.x0 + l.d.x1) / 2;
    const lo = minX - margin.left + 3 + w / 2;
    const hi = maxX + margin.right - 3 - w / 2;
    l.cx = lo < hi ? Math.max(lo, Math.min(hi, cx)) : cx;
    if (l.cx !== cx) d3.select(l.el).attr('x', l.cx - l.d.x0);
  }

  const labelRows = d3.group(outsideLabels, l => `${Math.round(l.d.y0)}|${l.above}`);
  for (const [, labels] of labelRows) {
    labels.sort((a, b) => a.cx - b.cx);
    const rowEnds = [];
    for (const l of labels) {
      const w = l.el.getComputedTextLength();
      const left = l.cx - w / 2;
      let row = 0;
      while (row < 5 && rowEnds[row] != null && left < rowEnds[row] + 8) row++;
      rowEnds[row] = l.cx + w / 2;
      if (row > 0) {
        const t = d3.select(l.el);
        const dy = (fontSize + 3) * row;
        t.attr('y', +t.attr('y') + (l.above ? -dy : dy));
      }
    }
  }

  // Fit the canvas to the actual content (nodes plus dodged label rows),
  // so nothing is ever clipped regardless of how many rows were needed.
  {
    const bb = g.node().getBBox();
    const fitW = Math.ceil(bb.width + 16);
    const fitH = Math.ceil(bb.height + 16);
    const scale = Math.min(1, width / fitW);
    svg
      .attr('viewBox', `${Math.floor(bb.x - 8)} ${Math.floor(bb.y - 8)} ${fitW} ${fitH}`)
      .attr('width', Math.round(fitW * scale))
      .attr('height', Math.round(fitH * scale));
    g.attr('transform', null);
  }

  // Expand/collapse indicator
  nodeGroups.filter(d => interactive && d.expandableStepId && labelVisible(d))
    .append('text')
    .attr('class', 'expand-indicator')
    .attr('x', d => (d.x1 - d.x0) / 2)
    .attr('y', d => (d.y1 - d.y0) - 4)
    .attr('text-anchor', 'middle')
    .attr('fill', d => d.type === 'final' ? '#fff' : '#666')
    .attr('font-size', '10px')
    .text(d => expanded.has(d.expandableStepId) ? '▴' : '▾');

  if (!interactive) {
    svg.style('pointer-events', 'none');
    return;
  }

  // ── Interaction ──
  svg.on('click', () => hideDetail());

  function activateNode(event, d) {
    event.stopPropagation();
    if (!labelsOn && !revealed.has(d.id)) {
      for (const id of findAncestors(d.id, graph)) revealed.add(id);
      render();
      return;
    }
    if (d.expandableStepId) {
      if (expanded.has(d.expandableStepId)) {
        expanded.delete(d.expandableStepId);
      } else {
        expanded.add(d.expandableStepId);
      }
      hideDetail();
      render();
      return;
    }
    showNodeDetail(d);
  }

  function activateLink(event, d) {
    event.stopPropagation();
    showLinkDetail(d);
  }

  nodeGroups
    .style('cursor', 'pointer')
    .attr('tabindex', 0)
    .attr('role', 'button')
    .attr('aria-label', d => {
      const parts = [d.label];
      if (d.type === 'final') parts.push('final dish');
      if (d.expandableStepId) parts.push(expanded.has(d.expandableStepId) ? 'collapse group' : 'expand group');
      return parts.join(', ');
    })
    .on('click', activateNode)
    .on('keydown', (event, d) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        activateNode(event, d);
      }
    });

  linkPaths
    .style('cursor', 'pointer')
    .attr('tabindex', 0)
    .attr('role', 'button')
    .attr('aria-label', d => d.action)
    .on('click', activateLink)
    .on('keydown', (event, d) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        activateLink(event, d);
      }
    });

  // Hover tooltips as a desktop enhancement only
  if (canHover) {
    linkPaths
      .on('mouseenter', (event, d) => {
        const lines = [d.action];
        if (d.step) {
          if (d.step.end?.duration_minutes) lines.push(`Duration: ${d.step.end.duration_minutes} min`);
          if (d.step.end?.condition) lines.push(`Until: ${d.step.end.condition}`);
          const dev = deviceLine(d.step);
          if (dev) lines.push(`Using: ${dev}`);
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

    nodeGroups
      .on('mouseenter', (event, d) => {
        const lines = [d.label];
        if (d.expandableStepId && labelVisible(d)) {
          lines.push(expanded.has(d.expandableStepId) ? '(click to collapse)' : '(click to expand)');
        }
        if (!labelVisible(d)) lines.push('(click to reveal)');
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
}

// ── Main diagram render ───────────────────────────────────────────
function diagramWidth() {
  const el = document.getElementById('score');
  const available = el?.clientWidth || window.innerWidth - 32;
  return Math.max(MIN_DIAGRAM_WIDTH, Math.min(MAX_DIAGRAM_WIDTH, available));
}

let lastRenderWidth = 0;

function render() {
  const width = diagramWidth();
  lastRenderWidth = width;
  const compact = width < 480;
  drawFlow('#score', {
    width,
    nodeWidth: NODE_WIDTH,
    nodePadding: compact ? 8 : NODE_PADDING,
    margin: { top: compact ? 62 : 50, right: 16, bottom: compact ? 62 : 52, left: 16 },
    fontSize: compact ? 10.5 : 12,
    maxLabelPx: compact ? 80 : 110,
    rowHeight: compact ? 44 : 52,
    minHeight: 360,
    interactive: true,
  });
}

// Re-render when the viewport size actually changes (orientation flip,
// window resize) so the diagram always fits the container.
function wireResize() {
  let timer = null;
  window.addEventListener('resize', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (recipe && currentView === 'diagram' &&
          document.getElementById('diagram-view').style.display !== 'none' &&
          Math.abs(diagramWidth() - lastRenderWidth) > 4) {
        render();
      }
    }, 150);
  });
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
      hideDetail();
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

// ── Labels toggle: explore mode hides labels until revealed ───────
let labelsToggleWired = false;
function wireLabelsToggle() {
  updateLabelsToggle();
  if (labelsToggleWired) return;
  labelsToggleWired = true;

  d3.select('#labels-toggle').on('click', () => {
    labelsOn = !labelsOn;
    if (!labelsOn) revealed = new Set();
    updateLabelsToggle();
    hideDetail();
    render();
  });
}

function updateLabelsToggle() {
  d3.select('#labels-toggle').text(labelsOn ? 'Explore Mode' : 'Show Labels');
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
  const printBadge = provenanceBadgeInfo(recipe.provenance);
  container.append('p').attr('class', 'recipe-print-provenance')
    .append('span').attr('class', `provenance-badge ${printBadge.cls}`).text(printBadge.text);
  if (recipe.diet_notes) {
    container.append('p').attr('class', 'diet-note').text(recipe.diet_notes);
  }

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
  // Collapsed view with all labels visible
  const savedExpanded = expanded;
  const savedRevealed = revealed;
  const savedLabelsOn = labelsOn;
  expanded = new Set();
  revealed = new Set();
  labelsOn = true;

  drawFlow('#recipe-thumbnail', {
    width: Math.min(340, diagramWidth()),
    nodeWidth: 14,
    nodePadding: 8,
    margin: { top: 18, right: 10, bottom: 24, left: 10 },
    fontSize: 8.5,
    rowHeight: 36,
    minHeight: 200,
    interactive: false,
  });

  expanded = savedExpanded;
  revealed = savedRevealed;
  labelsOn = savedLabelsOn;
}

// ── Boot ──────────────────────────────────────────────────────────
init();
