const STORAGE_KEY = 'careerFitScorer.v1';

let state;
let storageAvailable = true;

function getDefaultCriteria() {
  const names = [
    { id: 'compensation', name: 'Compensation' },
    { id: 'scope', name: 'Scope' },
    { id: 'title', name: 'Title' },
    { id: 'tier', name: 'Tier of Company' },
    { id: 'domain', name: 'Domain' },
    { id: 'wlb', name: 'Work Life Balance' }
  ];
  const evenWeight = Math.floor(100 / names.length);
  return names.map(n => ({ ...n, weight: evenWeight }));
}

function cloneCriteria(criteria) {
  return criteria.map(c => ({ ...c }));
}

function makeId(prefix) {
  const rand = window.crypto && window.crypto.randomUUID
    ? window.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${rand}`;
}

function detectStorageAvailability() {
  try {
    const testKey = '__career_fit_scorer_test__';
    localStorage.setItem(testKey, '1');
    localStorage.removeItem(testKey);
    return true;
  } catch (e) {
    return false;
  }
}

function showStorageWarning() {
  document.getElementById('storage-warning').classList.remove('hidden');
}

function loadState() {
  if (!storageAvailable) return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function saveState(currentState) {
  if (!storageAvailable) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(currentState));
  } catch (e) {
    storageAvailable = false;
    showStorageWarning();
  }
}

function initState() {
  storageAvailable = detectStorageAvailability();
  if (!storageAvailable) {
    showStorageWarning();
  }
  const loaded = loadState();
  if (loaded && Array.isArray(loaded.criteria) && Array.isArray(loaded.opportunities)) {
    state = loaded;
    if (typeof state.criteriaStale !== 'boolean') {
      state.criteriaStale = false;
    }
    if (!Array.isArray(state.reviewedCriteria)) {
      state.reviewedCriteria = cloneCriteria(state.criteria);
    }
  } else {
    const criteria = getDefaultCriteria();
    state = { criteria, opportunities: [], criteriaStale: false, reviewedCriteria: cloneCriteria(criteria) };
  }
}

function computeScore(opportunity, criteria) {
  let fixed = 0;
  let rangeMinOffset = 0;
  let rangeMaxOffset = 0;
  let midOffset = 0;
  let hasUnknown = false;

  for (const criterion of criteria) {
    const raw = opportunity.scores[criterion.id];
    if (raw === undefined) continue;
    const weightFraction = criterion.weight / 100;
    if (raw === 'unknown') {
      hasUnknown = true;
      rangeMinOffset += weightFraction * 1;
      rangeMaxOffset += weightFraction * 5;
      midOffset += weightFraction * 3;
    } else {
      fixed += weightFraction * raw;
    }
  }

  if (!hasUnknown) {
    return { type: 'fixed', value: fixed, sortKey: fixed };
  }
  return {
    type: 'range',
    min: fixed + rangeMinOffset,
    max: fixed + rangeMaxOffset,
    mid: fixed + midOffset,
    sortKey: fixed + midOffset
  };
}

function getRankedOpportunities(currentState) {
  return currentState.opportunities
    .map(opportunity => ({ opportunity, score: computeScore(opportunity, currentState.criteria) }))
    .sort((a, b) => b.score.sortKey - a.score.sortKey);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

let editingOpportunityId = null;

function renderAll() {
  renderCriteriaPanel();
  renderOpportunityForm();
  renderRankedPanel();
}

function getMaxAllowedWeight(criterionId) {
  const otherTotal = state.criteria.reduce((sum, c) => sum + (c.id === criterionId ? 0 : c.weight), 0);
  return 100 - otherTotal;
}

function renderCriteriaPanel() {
  const list = document.getElementById('criteria-list');
  const meanWeight = state.criteria.length > 0 ? Math.floor(100 / state.criteria.length) : 0;
  // The slider's `max` is a shared "typical range" scale, not the true 0-100
  // ceiling — it's set so the mean sits at the visual midpoint of the track,
  // giving equal room to move up or down from it. It's recomputed only here
  // (on a full re-render), never per-drag, so it can't cause the sibling-shift
  // bug. It never clips an existing value, and the number input (max=100)
  // remains the uncapped way to reach anything the slider's scale doesn't cover.
  const highestWeight = state.criteria.reduce((max, c) => Math.max(max, c.weight), 0);
  const sliderScaleMax = Math.min(100, Math.max(meanWeight * 2, highestWeight, 20));
  list.innerHTML = state.criteria.map(criterion => `
    <div class="criterion-row">
      <input type="text" class="criterion-name" data-id="${criterion.id}" value="${escapeHtml(criterion.name)}">
      <input type="range" class="criterion-weight-slider" data-id="${criterion.id}" min="0" max="${sliderScaleMax}" step="1" value="${criterion.weight}" list="criteria-mean-marker">
      <input type="number" class="criterion-weight-number" data-id="${criterion.id}" min="0" max="100" step="1" value="${criterion.weight}">
      <button type="button" class="remove-criterion-btn" data-id="${criterion.id}" aria-label="Remove ${escapeHtml(criterion.name)}">✕</button>
    </div>
  `).join('') + `<datalist id="criteria-mean-marker"><option value="${meanWeight}"></option></datalist>`;
  renderWeightBanner();
}

function renderWeightBanner() {
  const total = state.criteria.reduce((sum, c) => sum + c.weight, 0);
  const banner = document.getElementById('weight-banner');
  const remaining = 100 - total;
  banner.textContent = remaining === 0
    ? `${total}% allocated — ready`
    : `${total}% allocated — ${Math.abs(remaining)}% ${remaining > 0 ? 'remaining' : 'over'}`;
  banner.classList.toggle('banner-ok', remaining === 0);
  banner.classList.toggle('banner-warn', remaining !== 0);
}

function attachCriteriaPanelEvents() {
  const list = document.getElementById('criteria-list');

  list.addEventListener('input', (e) => {
    const id = e.target.dataset.id;
    if (!id) return;
    const criterion = state.criteria.find(c => c.id === id);
    if (!criterion) return;

    if (e.target.classList.contains('criterion-name')) {
      criterion.name = e.target.value;
      state.criteriaStale = true;
      saveState(state);
      renderOpportunityForm();
      renderRankedPanel();
    } else if (e.target.classList.contains('criterion-weight-slider')) {
      // Slider `max` stays fixed at 100 for every row (never resized to the
      // remaining headroom) — resizing it visually rescales the track, which
      // makes untouched sliders look like they're moving on their own.
      // The cap is enforced here instead: silently snap back if dragged past it.
      const maxAllowed = getMaxAllowedWeight(id);
      const newWeight = Math.min(maxAllowed, Number(e.target.value));
      if (newWeight !== Number(e.target.value)) {
        e.target.value = newWeight;
      }
      criterion.weight = newWeight;
      e.target.closest('.criterion-row').querySelector('.criterion-weight-number').value = newWeight;
      state.criteriaStale = true;
      renderWeightBanner();
      saveState(state);
      renderRankedPanel();
    } else if (e.target.classList.contains('criterion-weight-number')) {
      const raw = e.target.value;
      if (raw === '') return;
      const parsed = Number(raw);
      if (Number.isNaN(parsed)) return;
      const rounded = Math.round(parsed);
      const maxAllowed = getMaxAllowedWeight(id);

      if (rounded > maxAllowed) {
        e.target.value = criterion.weight;
        e.target.setCustomValidity(`Max ${maxAllowed}%\n(100% total limit)`);
        e.target.reportValidity();
        e.target.setCustomValidity('');
        return;
      }

      const clamped = Math.max(0, rounded);
      criterion.weight = clamped;
      const slider = e.target.closest('.criterion-row').querySelector('.criterion-weight-slider');
      if (clamped > Number(slider.max)) {
        // Typed a value past this row's own visual scale — grow only this
        // row's slider max so its thumb doesn't clip below the true value.
        // Never touches sibling rows, so it can't cause the shift bug either.
        slider.max = clamped;
      }
      slider.value = clamped;
      if (clamped !== parsed) {
        e.target.value = clamped;
      }
      state.criteriaStale = true;
      renderWeightBanner();
      saveState(state);
      renderRankedPanel();
    }
  });

  list.addEventListener('click', (e) => {
    if (!e.target.classList.contains('remove-criterion-btn')) return;
    const id = e.target.dataset.id;
    const criterion = state.criteria.find(c => c.id === id);
    if (!criterion) return;
    if (!confirm(`Remove criterion "${criterion.name}"? Existing scores for it will be ignored.`)) return;
    state.criteria = state.criteria.filter(c => c.id !== id);
    state.criteriaStale = true;
    saveState(state);
    renderAll();
  });

  document.getElementById('add-criterion-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('new-criterion-name');
    const name = input.value.trim();
    if (!name) return;
    state.criteria.push({ id: makeId('criterion'), name, weight: 0 });
    input.value = '';
    state.criteriaStale = true;
    saveState(state);
    renderAll();
  });

  document.getElementById('reset-defaults-btn').addEventListener('click', () => {
    if (!confirm('Reset criteria and weights to the defaults? This discards custom criteria, renames, and weight changes.')) return;
    state.criteria = getDefaultCriteria();
    state.criteriaStale = true;
    saveState(state);
    renderAll();
  });

  document.getElementById('reevaluate-btn').addEventListener('click', () => {
    state.reviewedCriteria = cloneCriteria(state.criteria);
    state.criteriaStale = false;
    saveState(state);
    renderRankedPanel();
  });
}

function renderOpportunityForm() {
  const container = document.getElementById('opportunity-form-container');
  const heading = document.getElementById('opportunity-form-title');

  if (state.criteria.length === 0) {
    heading.textContent = 'Add Opportunity';
    container.innerHTML = '<p class="empty-state">Add at least one criterion first.</p>';
    return;
  }

  const editing = editingOpportunityId
    ? state.opportunities.find(o => o.id === editingOpportunityId)
    : null;

  heading.textContent = editing ? 'Edit Opportunity' : 'Add Opportunity';

  const rowsHtml = state.criteria.map(criterion => {
    const currentScore = editing ? editing.scores[criterion.id] : undefined;
    const numberButtons = [1, 2, 3, 4, 5].map(n => `
      <button type="button" class="score-btn ${currentScore === n ? 'active' : ''}" data-criterion="${criterion.id}" data-value="${n}">${n}</button>
    `).join('');
    const unknownActive = currentScore === 'unknown' ? 'active' : '';
    return `
      <div class="score-row" data-criterion-row="${criterion.id}">
        <span class="score-row-label">${escapeHtml(criterion.name)}</span>
        <div class="score-buttons">
          ${numberButtons}
          <button type="button" class="score-btn unknown-btn ${unknownActive}" data-criterion="${criterion.id}" data-value="unknown">?</button>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = `
    <form id="opportunity-form">
      <input type="text" id="opportunity-title" placeholder="Job title / company" value="${editing ? escapeHtml(editing.title) : ''}" required>
      <div class="score-rows">${rowsHtml}</div>
      <div class="opportunity-form-actions">
        <button type="submit" class="primary-btn">Save</button>
        ${editing ? '<button type="button" id="cancel-edit-btn" class="secondary-btn">Cancel</button>' : ''}
      </div>
    </form>
  `;

  attachOpportunityFormEvents();
}

function attachOpportunityFormEvents() {
  const form = document.getElementById('opportunity-form');
  if (!form) return;

  form.querySelectorAll('.score-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const row = btn.closest('.score-row');
      row.querySelectorAll('.score-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const titleInput = document.getElementById('opportunity-title');
    const title = titleInput.value.trim();
    if (!title) return;

    const scores = {};
    let allScored = true;
    form.querySelectorAll('.score-row').forEach(row => {
      const criterionId = row.dataset.criterionRow;
      const activeBtn = row.querySelector('.score-btn.active');
      if (!activeBtn) {
        allScored = false;
        return;
      }
      const value = activeBtn.dataset.value;
      scores[criterionId] = value === 'unknown' ? 'unknown' : Number(value);
    });

    if (!allScored) {
      alert('Please score every criterion (or mark it "?") before saving.');
      return;
    }

    if (editingOpportunityId) {
      const opp = state.opportunities.find(o => o.id === editingOpportunityId);
      opp.title = title;
      opp.scores = scores;
      opp.updatedAt = new Date().toISOString();
      editingOpportunityId = null;
    } else {
      state.opportunities.push({
        id: makeId('opportunity'),
        title,
        scores,
        updatedAt: new Date().toISOString()
      });
    }

    saveState(state);
    renderOpportunityForm();
    renderRankedPanel();
  });

  const cancelBtn = document.getElementById('cancel-edit-btn');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      editingOpportunityId = null;
      renderOpportunityForm();
    });
  }
}

function renderRankedPanel() {
  const container = document.getElementById('ranked-list-container');
  const banner = document.getElementById('obsolete-banner');
  const isStale = state.criteriaStale === true;
  // While stale, the ranking is computed against the last-reviewed snapshot
  // of criteria/weights, not the live ones — the whole point of "obsolete" is
  // that it doesn't move again until Reevaluate is clicked.
  const criteriaForRanking = isStale ? state.reviewedCriteria : state.criteria;
  const totalForRanking = criteriaForRanking.reduce((sum, c) => sum + c.weight, 0);

  if (totalForRanking !== 100) {
    banner.classList.add('hidden');
    container.classList.remove('obsolete');
    container.innerHTML = '<p class="empty-state">Set weights to total 100% to see rankings.</p>';
    return;
  }

  if (state.opportunities.length === 0) {
    banner.classList.add('hidden');
    container.classList.remove('obsolete');
    container.innerHTML = '<p class="empty-state">No opportunities yet — add one above.</p>';
    return;
  }

  banner.classList.toggle('hidden', !isStale);
  container.classList.toggle('obsolete', isStale);

  const ranked = getRankedOpportunities({ criteria: criteriaForRanking, opportunities: state.opportunities });

  const medals = ['🥇', '🥈', '🥉'];

  container.innerHTML = ranked.map((entry, index) => {
    const { opportunity, score } = entry;
    const scoreText = score.type === 'fixed'
      ? score.value.toFixed(1)
      : `${score.min.toFixed(1)} – ${score.max.toFixed(1)} (mid ${score.mid.toFixed(1)})`;
    const medal = medals[index] ? `<span class="rank-medal">${medals[index]}</span>` : '';
    return `
      <div class="ranked-row">
        <span class="rank-number">${medal}#${index + 1}</span>
        <span class="rank-title">${escapeHtml(opportunity.title)}</span>
        <span class="rank-score">${scoreText}</span>
        <button type="button" class="edit-opportunity-btn" data-id="${opportunity.id}">Edit</button>
        <button type="button" class="delete-opportunity-btn" data-id="${opportunity.id}">Delete</button>
      </div>
    `;
  }).join('');

  attachRankedPanelEvents();
}

function attachRankedPanelEvents() {
  document.querySelectorAll('.edit-opportunity-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      editingOpportunityId = btn.dataset.id;
      renderOpportunityForm();
      document.getElementById('opportunity-panel').scrollIntoView({ behavior: 'smooth' });
    });
  });

  document.querySelectorAll('.delete-opportunity-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const opp = state.opportunities.find(o => o.id === id);
      if (!opp) return;
      if (!confirm(`Delete "${opp.title}"?`)) return;
      state.opportunities = state.opportunities.filter(o => o.id !== id);
      if (editingOpportunityId === id) editingOpportunityId = null;
      saveState(state);
      renderOpportunityForm();
      renderRankedPanel();
    });
  });
}

function init() {
  initState();
  renderCriteriaPanel();
  attachCriteriaPanelEvents();
  renderOpportunityForm();
  renderRankedPanel();
}

document.addEventListener('DOMContentLoaded', init);