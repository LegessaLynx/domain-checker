// 🌐 Domain Checker - Frontend Application Engine

(function () {
  'use strict';

  // --- STATE MANAGEMENT ---
  const state = {
    baseKeywords: [],
    specificDomains: [],
    // Default TLDs: .com, .io, .co, .xyz, .dev, .app, .tech
    selectedTlds: new Set(['.com', '.io', '.co', '.xyz', '.dev', '.app', '.tech']),
    customTlds: new Set(),
    results: new Map(), // domain -> { domain, available, expirationDate, registrationDate, registrar, statusFlags, error, starred }
    favorites: new Set(JSON.parse(localStorage.getItem('domain_checker_favs') || '[]')),
    activeFilter: 'all',
    searchQuery: '',
    isRunning: false,
    isPaused: false,
    shouldStop: false,
    queue: [],
    totalTasks: 0,
    completedTasks: 0,
    speedConfig: {
      fast: { delay: 25, concurrency: 10 },
      balanced: { delay: 60, concurrency: 6 },
      safe: { delay: 200, concurrency: 3 }
    }
  };

  // Known TLDs for domain hacks
  const HACK_TLDS = [
    'io', 'ai', 'co', 'me', 'sh', 'ly', 'to', 'is', 'it', 'us', 'in', 'im',
    'gg', 'so', 'vc', 'tv', 'cc', 'by', 'do', 'at', 'am', 'be', 'de', 'eu',
    'fr', 'la', 're', 'st', 'ws', 'xyz', 'app', 'dev', 'tech', 'org', 'net',
    'ch', 'ee', 'li', 'fm', 'pm', 'ag', 'sc', 'mu', 'nu', 'cx', 'gs', 'ms'
  ];

  // --- DOM ELEMENTS ---
  const dom = {
    domainInput: document.getElementById('domainInput'),
    inputStats: document.getElementById('inputStats'),
    totalCheckCount: document.getElementById('totalCheckCount'),
    sampleDataBtn: document.getElementById('sampleDataBtn'),
    clearInputBtn: document.getElementById('clearInputBtn'),
    domainHacksBtn: document.getElementById('domainHacksBtn'),
    selectAllTldsBtn: document.getElementById('selectAllTldsBtn'),
    clearAllTldsBtn: document.getElementById('clearAllTldsBtn'),
    customTldInput: document.getElementById('customTldInput'),
    addCustomTldBtn: document.getElementById('addCustomTldBtn'),
    customTldsContainer: document.getElementById('customTlds'),
    startBtn: document.getElementById('startBtn'),
    runControls: document.getElementById('runControls'),
    pauseBtn: document.getElementById('pauseBtn'),
    stopBtn: document.getElementById('stopBtn'),
    progressSection: document.getElementById('progressSection'),
    progressStatusText: document.getElementById('progressStatusText'),
    progressPercent: document.getElementById('progressPercent'),
    progressBarFill: document.getElementById('progressBarFill'),
    resultsContainer: document.getElementById('resultsContainer'),
    emptyState: document.getElementById('emptyState'),
    searchFilter: document.getElementById('searchFilter'),
    exportJsonBtn: document.getElementById('exportJsonBtn'),
    exportCsvBtn: document.getElementById('exportCsvBtn'),
    copyAvailBtn: document.getElementById('copyAvailBtn'),
    clearResultsBtn: document.getElementById('clearResultsBtn'),
    statAll: document.getElementById('statAll'),
    statAvail: document.getElementById('statAvail'),
    statTaken: document.getElementById('statTaken'),
    statFav: document.getElementById('statFav'),
    statErr: document.getElementById('statErr'),
    pillError: document.getElementById('pillError'),
    statsNav: document.getElementById('statsNav'),
    themeToggleBtn: document.getElementById('themeToggleBtn'),
    themeIcon: document.getElementById('themeIcon'),
    themeLabel: document.getElementById('themeLabel'),
    // Modal
    modalBackdrop: document.getElementById('modalBackdrop'),
    modalTitle: document.getElementById('modalTitle'),
    modalMessage: document.getElementById('modalMessage'),
    modalHacksList: document.getElementById('modalHacksList'),
    modalOkBtn: document.getElementById('modalOkBtn')
  };

  // --- INITIALIZATION ---
  function init() {
    initTheme();
    bindEvents();
    syncTldCheckboxes();
    updateInputCalculations();
  }

  // --- THEME MANAGEMENT ---
  function initTheme() {
    const savedTheme = localStorage.getItem('domain_checker_theme') || 'dark';
    applyTheme(savedTheme);
  }

  function applyTheme(theme) {
    if (theme === 'dark') {
      document.body.classList.add('dark-mode');
      if (dom.themeIcon) dom.themeIcon.textContent = '☀️';
      if (dom.themeLabel) dom.themeLabel.textContent = 'Light';
    } else {
      document.body.classList.remove('dark-mode');
      if (dom.themeIcon) dom.themeIcon.textContent = '🌙';
      if (dom.themeLabel) dom.themeLabel.textContent = 'Dark';
    }
  }

  function toggleTheme() {
    const isDark = document.body.classList.toggle('dark-mode');
    const newTheme = isDark ? 'dark' : 'light';
    localStorage.setItem('domain_checker_theme', newTheme);
    applyTheme(newTheme);
  }

  // --- INPUT PARSER ---
  function parseInputs(text) {
    if (!text) return { baseKeywords: [], specificDomains: [] };
    const cleaned = text.replace(/[,;\t\r\n]+/g, ' ');
    const tokens = cleaned.split(/\s+/).map(t => t.trim().toLowerCase()).filter(Boolean);

    const baseKeywords = [];
    const specificDomains = [];
    const seenBase = new Set();
    const seenSpecific = new Set();

    tokens.forEach(token => {
      let name = token.replace(/^(https?:\/\/)?(www\.)?/, '').replace(/\/.*$/, '');
      name = name.replace(/^[.-]+|[.-]+$/g, '');

      if (!name) return;

      if (name.includes('.')) {
        // Specific domain with TLD (e.g. "rad.io", "mybrand.com")
        if (!seenSpecific.has(name) && /^[a-z0-9.-]+$/.test(name)) {
          seenSpecific.add(name);
          specificDomains.push(name);
        }
      } else {
        // Base keyword without extension (e.g. "startup", "flux")
        if (!seenBase.has(name) && /^[a-z0-9-]+$/.test(name)) {
          seenBase.add(name);
          baseKeywords.push(name);
        }
      }
    });

    return { baseKeywords, specificDomains };
  }

  function updateInputCalculations() {
    const { baseKeywords, specificDomains } = parseInputs(dom.domainInput.value);
    state.baseKeywords = baseKeywords;
    state.specificDomains = specificDomains;

    const baseCount = baseKeywords.length;
    const specCount = specificDomains.length;
    const tldCount = state.selectedTlds.size;
    const totalCombos = (baseCount * tldCount) + specCount;

    let statsDesc = [];
    if (baseCount > 0) statsDesc.push(`${baseCount} keyword${baseCount === 1 ? '' : 's'} (${tldCount} TLDs)`);
    if (specCount > 0) statsDesc.push(`${specCount} specific domain${specCount === 1 ? '' : 's'}`);
    if (statsDesc.length === 0) statsDesc.push('0 keywords detected');

    dom.inputStats.textContent = statsDesc.join(' + ');
    dom.totalCheckCount.textContent = totalCombos;
    dom.startBtn.disabled = totalCombos === 0 || state.isRunning;
    dom.statsNav.textContent = `${state.results.size} records`;
  }

  // --- TLD MANAGEMENT ---
  function syncTldCheckboxes() {
    document.querySelectorAll('.tag-row input[type="checkbox"]').forEach(cb => {
      cb.checked = state.selectedTlds.has(cb.value);
    });
  }

  function addCustomTld(tldStr) {
    let tld = tldStr.trim().toLowerCase();
    if (!tld) return;
    if (!tld.startsWith('.')) tld = '.' + tld;
    if (tld.length < 2) return;

    if (!state.customTlds.has(tld)) {
      state.customTlds.add(tld);
      state.selectedTlds.add(tld);
      renderCustomTlds();
      updateInputCalculations();
      dom.customTldInput.value = '';
    }
  }

  function renderCustomTlds() {
    dom.customTldsContainer.innerHTML = '';
    state.customTlds.forEach(tld => {
      const label = document.createElement('label');
      label.className = 'tag-chip';
      label.innerHTML = `
        <input type="checkbox" value="${tld}" checked>
        <span>${tld} &times;</span>
      `;
      const input = label.querySelector('input');
      input.addEventListener('change', (e) => {
        if (e.target.checked) {
          state.selectedTlds.add(tld);
        } else {
          state.selectedTlds.delete(tld);
          state.customTlds.delete(tld);
          renderCustomTlds();
        }
        updateInputCalculations();
      });
      dom.customTldsContainer.appendChild(label);
    });
  }

  // --- IN-PAGE MODAL DIALOG FOR DOMAIN HACKS ---
  function showModal(title, message, hackItems = []) {
    dom.modalTitle.textContent = title;
    dom.modalMessage.textContent = message;
    dom.modalHacksList.innerHTML = '';

    if (hackItems.length > 0) {
      dom.modalHacksList.style.display = 'flex';
      hackItems.forEach(item => {
        const span = document.createElement('span');
        span.className = 'hack-item-pill';
        span.textContent = item;
        dom.modalHacksList.appendChild(span);
      });
    } else {
      dom.modalHacksList.style.display = 'none';
    }

    dom.modalBackdrop.style.display = 'flex';
  }

  function hideModal() {
    dom.modalBackdrop.style.display = 'none';
  }

  // --- DOMAIN HACK GENERATOR ---
  function generateDomainHacks() {
    const rawTokens = dom.domainInput.value.replace(/[,;\t\r\n]+/g, ' ').split(/\s+/).filter(Boolean);
    if (rawTokens.length === 0) {
      showModal(
        'No Keywords Found',
        'Please enter at least one word (e.g. "radio", "spotify", "portfolio", "delight") to generate domain hacks.'
      );
      return;
    }

    const hacksFound = [];
    const currentInputLines = dom.domainInput.value.split('\n').map(l => l.trim()).filter(Boolean);
    const existingTokens = new Set(dom.domainInput.value.replace(/[,;\t\r\n]+/g, ' ').split(/\s+/).filter(Boolean));

    rawTokens.forEach(token => {
      // If token already has a dot, skip
      if (token.includes('.')) return;

      const word = token.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (word.length < 4) return;

      // Find all matching TLD suffixes
      for (const tld of HACK_TLDS) {
        if (word.endsWith(tld) && word.length > tld.length + 1) {
          const base = word.slice(0, -tld.length);
          const hackDomain = `${base}.${tld}`;

          if (!hacksFound.includes(hackDomain) && !existingTokens.has(hackDomain)) {
            hacksFound.push(hackDomain);
          }
        }
      }
    });

    if (hacksFound.length > 0) {
      // Append ONLY specific hack domains to textarea (without polluting global TLD list!)
      const updatedValue = currentInputLines.concat(hacksFound).join('\n');
      dom.domainInput.value = updatedValue;
      updateInputCalculations();

      showModal(
        'Domain Hacks Found',
        `${hacksFound.length} specific domain hack(s) were generated and added to your check list:`,
        hacksFound
      );
    } else {
      showModal(
        'No Domain Hacks Found',
        'No direct word-ending matches were found for the entered keywords. Try words like "radio", "portfolio", "delight", "focus", "crypto", "craft", "notif".'
      );
    }
  }

  // --- RDAP QUERY ENGINE ---
  async function queryRdap(domain) {
    const proxyUrl = `/api/rdap?domain=${encodeURIComponent(domain)}`;
    
    try {
      const res = await fetch(proxyUrl);
      if (res.status === 429) {
        return { status: 'rate_limited', domain };
      }
      if (res.ok) {
        const data = await res.json();
        return {
          status: 'success',
          domain,
          available: data.available,
          expirationDate: data.expiration_date,
          registrationDate: data.registration_date,
          registrar: data.registrar,
          statusFlags: data.status_flags || []
        };
      }
    } catch (e) {
      // Local fallback
    }

    try {
      const directUrl = `https://rdap.org/domain/${encodeURIComponent(domain)}`;
      const res = await fetch(directUrl);
      if (res.status === 404) {
        return { status: 'success', domain, available: true };
      }
      if (res.status === 429) {
        return { status: 'rate_limited', domain };
      }
      if (res.ok) {
        const data = await res.json();
        let expDate = null;
        if (data.events) {
          const expEvt = data.events.find(ev => ev.eventAction && ev.eventAction.includes('expiration'));
          if (expEvt) expDate = expEvt.eventDate;
        }
        return {
          status: 'success',
          domain,
          available: false,
          expirationDate: expDate,
          registrar: 'Registered (Direct RDAP)',
          statusFlags: data.status || []
        };
      }
      return { status: 'error', domain, error: `RDAP HTTP ${res.status}` };
    } catch (err) {
      return { status: 'error', domain, error: 'Network / RDAP query failed' };
    }
  }

  // --- QUEUE PROCESSOR ---
  function getActiveSpeedConfig() {
    const selected = document.querySelector('input[name="speedPreset"]:checked')?.value || 'balanced';
    return state.speedConfig[selected] || state.speedConfig.balanced;
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  const retryCounts = new Map();

  async function startCheckProcess() {
    const { baseKeywords, specificDomains } = parseInputs(dom.domainInput.value);
    if (baseKeywords.length === 0 && specificDomains.length === 0) return;

    retryCounts.clear();
    dom.progressSection.classList.remove('rate-limited');

    const domainsToCheck = [];
    const seen = new Set();

    // 1. Combine base keywords with selected TLDs
    baseKeywords.forEach(kw => {
      state.selectedTlds.forEach(tld => {
        const d = `${kw}${tld}`;
        if (!seen.has(d)) {
          seen.add(d);
          domainsToCheck.push(d);
        }
      });
    });

    // 2. Add specific exact domains (e.g. "rad.io", "mybrand.com") directly without multiplying
    specificDomains.forEach(d => {
      if (!seen.has(d)) {
        seen.add(d);
        domainsToCheck.push(d);
      }
    });

    state.queue = [...domainsToCheck];
    state.totalTasks = domainsToCheck.length;
    state.completedTasks = 0;
    state.isRunning = true;
    state.isPaused = false;
    state.shouldStop = false;

    // UI Updates
    dom.startBtn.style.display = 'none';
    dom.runControls.style.display = 'flex';
    dom.pauseBtn.textContent = 'Pause';
    dom.progressSection.style.display = 'block';
    dom.emptyState.style.display = 'none';
    updateProgressUI(0, 'Starting registry queries...');

    const config = getActiveSpeedConfig();
    const workers = [];

    for (let i = 0; i < config.concurrency; i++) {
      workers.push(runWorker(config.delay));
    }

    await Promise.all(workers);

    // Finished
    state.isRunning = false;
    dom.progressSection.classList.remove('rate-limited');
    dom.startBtn.style.display = 'block';
    dom.runControls.style.display = 'none';
    updateProgressUI(100, state.shouldStop ? 'Stopped.' : 'All domain checks completed.');
    updateStatsCounters();
  }

  async function runWorker(delayMs) {
    while (state.queue.length > 0 && !state.shouldStop) {
      while (state.isPaused && !state.shouldStop) {
        await sleep(200);
      }
      if (state.shouldStop) break;

      const domain = state.queue.shift();
      if (!domain) break;

      updateProgressUI(
        Math.round((state.completedTasks / state.totalTasks) * 100),
        `Querying: ${domain}...`
      );

      const result = await queryRdap(domain);

      if (result.status === 'rate_limited') {
        const retries = (retryCounts.get(domain) || 0) + 1;
        retryCounts.set(domain, retries);

        if (retries <= 3) {
          const cooldownSec = retries * 2 + 1;
          dom.progressSection.classList.add('rate-limited');

          for (let s = cooldownSec; s > 0; s--) {
            if (state.shouldStop) break;
            const currentPct = Math.round((state.completedTasks / state.totalTasks) * 100);
            updateProgressUI(
              currentPct,
              `⚠️ Rate limited on "${domain}" — waiting ${s}s to retry... (Attempt ${retries}/3)`
            );
            await sleep(1000);
          }

          dom.progressSection.classList.remove('rate-limited');

          if (!state.shouldStop) {
            updateProgressUI(
              Math.round((state.completedTasks / state.totalTasks) * 100),
              `🔄 Retrying "${domain}" now...`
            );
            state.queue.unshift(domain);
          }
          continue;
        } else {
          result.error = 'Rate limit (HTTP 429 - retried 3 times)';
        }
      }

      state.completedTasks++;
      const isFav = state.favorites.has(domain);
      const entry = {
        domain,
        available: result.available,
        expirationDate: result.expirationDate,
        registrationDate: result.registrationDate,
        registrar: result.registrar,
        statusFlags: result.statusFlags || [],
        error: result.error,
        starred: isFav
      };

      state.results.set(domain, entry);
      upsertResultCard(entry);
      updateStatsCounters();

      await sleep(delayMs);
    }
  }

  // --- UI PROGRESS & CARDS ---
  function updateProgressUI(percent, statusMsg) {
    dom.progressBarFill.style.width = `${percent}%`;
    dom.progressPercent.textContent = `${percent}%`;
    dom.progressStatusText.textContent = statusMsg;
  }

  function formatExpiryDate(dateStr) {
    if (!dateStr) return null;
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      const formatted = d.toISOString().split('T')[0];
      const now = new Date();
      const diffMonths = Math.round((d - now) / (1000 * 60 * 60 * 24 * 30.4));
      const rel = diffMonths > 0 ? `in ${diffMonths} mo` : 'Expired / Pending';
      return `${formatted} (${rel})`;
    } catch {
      return dateStr;
    }
  }

  function upsertResultCard(entry) {
    let card = document.getElementById(`card-${entry.domain.replace(/\./g, '_')}`);
    const isAvail = entry.available === true;
    const isTaken = entry.available === false;
    const isErr = !isAvail && !isTaken;

    const expiryFormatted = formatExpiryDate(entry.expirationDate);

    let statusHtml = '';
    let actionsHtml = '';

    if (isAvail) {
      statusHtml = `<span class="editorial-badge avail"><span class="dot"></span> Available</span>`;
      actionsHtml = `
        <div class="buy-deck">
          <a href="https://porkbun.com/checkout/search?q=${encodeURIComponent(entry.domain)}" target="_blank" rel="noopener" class="editorial-link" title="Open on Porkbun">Porkbun</a>
          <a href="https://www.namecheap.com/domains/registration/results/?domain=${encodeURIComponent(entry.domain)}" target="_blank" rel="noopener" class="editorial-link" title="Open on Namecheap">Namecheap</a>
          <a href="https://www.cloudflare.com/domains/search?q=${encodeURIComponent(entry.domain)}" target="_blank" rel="noopener" class="editorial-link" title="Open on Cloudflare">Cloudflare</a>
        </div>
      `;
    } else if (isTaken) {
      statusHtml = `<span class="editorial-badge taken"><span class="dot"></span> Taken</span>`;
      let metaTags = [];
      if (expiryFormatted) {
        metaTags.push(`<span class="meta-pill expiry-pill">Expires: ${expiryFormatted}</span>`);
      }
      if (entry.registrar && entry.registrar !== 'Unknown') {
        metaTags.push(`<span class="meta-pill">${entry.registrar}</span>`);
      }
      actionsHtml = `<div class="record-meta-line">${metaTags.join('')}</div>`;
    } else {
      statusHtml = `<span class="editorial-badge error">⚠️ ${entry.error || 'Error'}</span>`;
      actionsHtml = `<button class="btn-ghost-sm retry-btn" data-domain="${entry.domain}">Retry</button>`;
    }

    const cardClass = `record-card ${isAvail ? 'available' : isTaken ? 'taken' : 'error'}`;

    if (!card) {
      card = document.createElement('div');
      card.id = `card-${entry.domain.replace(/\./g, '_')}`;
      dom.resultsContainer.prepend(card);
    }

    card.className = cardClass;
    card.setAttribute('data-domain', entry.domain);
    card.setAttribute('data-status', isAvail ? 'available' : isTaken ? 'taken' : 'error');
    card.setAttribute('data-fav', entry.starred ? 'true' : 'false');

    card.innerHTML = `
      <div class="record-left">
        <button type="button" class="star-btn ${entry.starred ? 'starred' : ''}" data-domain="${entry.domain}" title="Save domain">
          ${entry.starred ? '★' : '☆'}
        </button>
        <div>
          <div class="domain-heading">${entry.domain}</div>
          ${isTaken ? actionsHtml : ''}
        </div>
      </div>
      <div class="result-right">
        ${statusHtml}
        ${isAvail ? actionsHtml : ''}
        ${isErr ? actionsHtml : ''}
      </div>
    `;

    applyCardVisibility(card);
  }

  function applyCardVisibility(card) {
    const domain = card.getAttribute('data-domain');
    const status = card.getAttribute('data-status');
    const isFav = card.getAttribute('data-fav') === 'true';

    let visible = true;
    if (state.activeFilter === 'available' && status !== 'available') visible = false;
    if (state.activeFilter === 'taken' && status !== 'taken') visible = false;
    if (state.activeFilter === 'favorites' && !isFav) visible = false;
    if (state.activeFilter === 'error' && status !== 'error') visible = false;

    if (state.searchQuery && !domain.toLowerCase().includes(state.searchQuery)) {
      visible = false;
    }

    card.style.display = visible ? 'flex' : 'none';
  }

  function filterAllCards() {
    const cards = dom.resultsContainer.querySelectorAll('.record-card');
    cards.forEach(applyCardVisibility);
  }

  function updateStatsCounters() {
    let availCount = 0;
    let takenCount = 0;
    let errCount = 0;
    let favCount = 0;

    state.results.forEach(item => {
      if (item.available === true) availCount++;
      else if (item.available === false) takenCount++;
      else errCount++;

      if (item.starred) favCount++;
    });

    dom.statAll.textContent = state.results.size;
    dom.statAvail.textContent = availCount;
    dom.statTaken.textContent = takenCount;
    dom.statFav.textContent = favCount;
    dom.statErr.textContent = errCount;
    dom.statsNav.textContent = `${state.results.size} records`;

    dom.pillError.style.display = errCount > 0 ? 'inline-block' : 'none';
  }

  // --- FAVORITES ---
  function toggleFavorite(domain) {
    const isFav = state.favorites.has(domain);
    if (isFav) {
      state.favorites.delete(domain);
    } else {
      state.favorites.add(domain);
    }
    localStorage.setItem('domain_checker_favs', JSON.stringify([...state.favorites]));

    const entry = state.results.get(domain);
    if (entry) {
      entry.starred = !isFav;
      upsertResultCard(entry);
    }
    updateStatsCounters();
    filterAllCards();
  }

  // --- EXPORTS ---
  function exportJson() {
    const data = Array.from(state.results.values());
    if (data.length === 0) {
      showModal('No Records', 'No domain inspection records have been logged yet.');
      return;
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `domain_check_results_${Date.now()}.json`);
  }

  function exportCsv() {
    const data = Array.from(state.results.values());
    if (data.length === 0) {
      showModal('No Records', 'No domain inspection records have been logged yet.');
      return;
    }

    const headers = ['Domain', 'Status', 'Expiration Date', 'Registrar', 'Registration Date', 'Bookmarked'];
    const rows = data.map(d => [
      `"${d.domain}"`,
      `"${d.available === true ? 'Available' : d.available === false ? 'Taken' : 'Error'}"`,
      `"${d.expirationDate || ''}"`,
      `"${(d.registrar || '').replace(/"/g, '""')}"`,
      `"${d.registrationDate || ''}"`,
      `"${d.starred ? 'Yes' : 'No'}"`
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    downloadBlob(blob, `domain_check_results_${Date.now()}.csv`);
  }

  function copyAvailableDomains() {
    const available = Array.from(state.results.values())
      .filter(d => d.available === true)
      .map(d => d.domain);

    if (available.length === 0) {
      showModal('No Available Domains', 'No available domains found to copy.');
      return;
    }

    navigator.clipboard.writeText(available.join('\n')).then(() => {
      const originalText = dom.copyAvailBtn.textContent;
      dom.copyAvailBtn.textContent = 'Copied';
      setTimeout(() => dom.copyAvailBtn.textContent = originalText, 1800);
    });
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // --- EVENT LISTENERS ---
  function bindEvents() {
    // Theme Switcher
    if (dom.themeToggleBtn) {
      dom.themeToggleBtn.addEventListener('click', toggleTheme);
    }

    dom.domainInput.addEventListener('input', updateInputCalculations);

    // Keyboard Shortcut: Ctrl+Enter / Cmd+Enter to Start
    dom.domainInput.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        if (!dom.startBtn.disabled) startCheckProcess();
      }
    });

    // Sample data
    dom.sampleDataBtn.addEventListener('click', () => {
      dom.domainInput.value = 'nova, horizon, fluxapp, hypershift, omni';
      updateInputCalculations();
    });

    // Clear input
    dom.clearInputBtn.addEventListener('click', () => {
      dom.domainInput.value = '';
      updateInputCalculations();
    });

    // Domain Hacks Button
    dom.domainHacksBtn.addEventListener('click', generateDomainHacks);

    // Modal OK Button & Backdrop click
    dom.modalOkBtn.addEventListener('click', hideModal);
    dom.modalBackdrop.addEventListener('click', (e) => {
      if (e.target === dom.modalBackdrop) hideModal();
    });

    // TLD Checkboxes
    document.querySelectorAll('.tag-row input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', (e) => {
        if (e.target.checked) state.selectedTlds.add(e.target.value);
        else state.selectedTlds.delete(e.target.value);
        updateInputCalculations();
      });
    });

    dom.selectAllTldsBtn.addEventListener('click', () => {
      document.querySelectorAll('.tag-row input[type="checkbox"]').forEach(cb => {
        cb.checked = true;
        state.selectedTlds.add(cb.value);
      });
      updateInputCalculations();
    });

    dom.clearAllTldsBtn.addEventListener('click', () => {
      document.querySelectorAll('.tag-row input[type="checkbox"]').forEach(cb => {
        cb.checked = false;
      });
      state.selectedTlds.clear();
      updateInputCalculations();
    });

    dom.addCustomTldBtn.addEventListener('click', () => addCustomTld(dom.customTldInput.value));
    dom.customTldInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addCustomTld(dom.customTldInput.value);
      }
    });

    dom.startBtn.addEventListener('click', startCheckProcess);

    dom.pauseBtn.addEventListener('click', () => {
      state.isPaused = !state.isPaused;
      dom.pauseBtn.textContent = state.isPaused ? 'Resume' : 'Pause';
      updateProgressUI(
        Math.round((state.completedTasks / state.totalTasks) * 100),
        state.isPaused ? 'Paused' : 'Resuming queries...'
      );
    });

    dom.stopBtn.addEventListener('click', () => {
      state.shouldStop = true;
      state.isPaused = false;
      dom.pauseBtn.textContent = 'Pause';
    });

    // Filter Tabs
    document.querySelectorAll('.filter-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        state.activeFilter = tab.getAttribute('data-filter');
        filterAllCards();
      });
    });

    dom.searchFilter.addEventListener('input', (e) => {
      state.searchQuery = e.target.value.trim().toLowerCase();
      filterAllCards();
    });

    // Star & Retry Delegation
    dom.resultsContainer.addEventListener('click', async (e) => {
      const starBtn = e.target.closest('.star-btn');
      if (starBtn) {
        const domain = starBtn.getAttribute('data-domain');
        toggleFavorite(domain);
        return;
      }

      const retryBtn = e.target.closest('.retry-btn');
      if (retryBtn) {
        const domain = retryBtn.getAttribute('data-domain');
        retryBtn.textContent = 'Querying...';
        retryBtn.disabled = true;
        const result = await queryRdap(domain);
        const entry = {
          domain,
          available: result.available,
          expirationDate: result.expirationDate,
          registrationDate: result.registrationDate,
          registrar: result.registrar,
          statusFlags: result.statusFlags || [],
          error: result.error,
          starred: state.favorites.has(domain)
        };
        state.results.set(domain, entry);
        upsertResultCard(entry);
        updateStatsCounters();
      }
    });

    dom.exportJsonBtn.addEventListener('click', exportJson);
    dom.exportCsvBtn.addEventListener('click', exportCsv);
    dom.copyAvailBtn.addEventListener('click', copyAvailableDomains);

    dom.clearResultsBtn.addEventListener('click', () => {
      if (state.results.size > 0 && confirm('Clear all results?')) {
        state.results.clear();
        dom.resultsContainer.innerHTML = '';
        dom.resultsContainer.appendChild(dom.emptyState);
        dom.emptyState.style.display = 'block';
        dom.progressSection.style.display = 'none';
        updateStatsCounters();
      }
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
