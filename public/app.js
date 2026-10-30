// 🌐 Domain Checker - Frontend Application Engine

(function () {
  'use strict';

  const SCAN_PAGE_SIZE = 200;

  // --- STATE MANAGEMENT ---
  const state = {
    baseKeywords: [],
    specificDomains: [],
    // Default TLDs: .com, .io, .co, .xyz, .dev, .app, .tech
    selectedTlds: new Set(['.com', '.io', '.co', '.xyz', '.dev', '.app', '.tech']),
    customTlds: new Set(),
    selectedPrefixes: new Set(['get', 'try', 'use', 'join', 'open']),
    selectedSuffixes: new Set(['app', 'lab', 'labs', 'ai', 'hub', 'ify']),
    customPrefixes: new Set(),
    customSuffixes: new Set(),
    pendingHacks: [],
    alarms: [],
    alarmStatus: { blockedUntil: 0, delay: 0 },
    alarmFilter: 'all',
    alarmQuery: '',
    discoverView: 'found',
    discoverLimit: SCAN_PAGE_SIZE,
    discoverNotice: '',
    discoverNoticeUntil: 0,
    scan: null,
    words: null,
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

  // 120+ High-Utility TLDs for domain hacks
  const HACK_TLDS = [
    // 2-Letter Country & Utility Codes
    'io', 'ai', 'co', 'me', 'sh', 'ly', 'to', 'is', 'it', 'us', 'in', 'im',
    'gg', 'so', 'vc', 'tv', 'cc', 'by', 'do', 'at', 'am', 'be', 'de', 'eu',
    'fr', 'la', 're', 'st', 'ws', 'ch', 'ee', 'li', 'fm', 'pm', 'ag', 'sc',
    'mu', 'nu', 'cx', 'gs', 'ms', 'ht', 'pe', 'ma', 'ph', 'gl', 'pt', 'al',
    'es', 'gr', 'pl', 'ro', 'se', 'fi', 'no', 'nl', 'lu', 'cz', 'sk', 'hu',
    'hr', 'si', 'bg', 'lt', 'lv', 'md', 'mk', 'rs', 'ba', 'je', 'pw', 'vg',
    'tc', 'gd', 'dm', 'lc', 'cl', 'ar', 'uy', 'py', 'bo', 'ec', 'cr', 'pa',
    'bz', 'gt', 'hn', 'sv', 'ni', 'mx', 'ca', 'jp', 'kr', 'tw', 'hk', 'sg',
    'my', 'th', 'vn', 'id',
    // 3+ Letter & Modern gTLDs
    'xyz', 'app', 'dev', 'tech', 'org', 'net', 'art', 'pro', 'top', 'one',
    'run', 'pub', 'fit', 'win', 'bid', 'bio', 'fyi', 'eco', 'ski', 'cat',
    'dog', 'tax', 'law', 'ceo', 'red', 'tips', 'show', 'film', 'pics', 'cool',
    'zone', 'land', 'city', 'haus', 'cafe', 'fund', 'cash', 'bank', 'pay',
    'link', 'live', 'news', 'club', 'work', 'chat', 'page', 'site', 'space',
    'store', 'host', 'media', 'press', 'agency', 'online'
  ];

  // Predefined Prefix & Suffix Collections
  const DEFAULT_PREFIXES = [
    'get', 'try', 'use', 'hey', 'the', 'my', 'your', 'go', 'join', 'meet',
    'open', 'start', 'launch', 'run', 'we', 'ask', 'pro', 'neo', 'meta',
    'super', 'all', 'buy', 'tap', 'click', 'next', 'pure', 'real', 'fast', 'smart', 'one'
  ];

  const DEFAULT_SUFFIXES = [
    'hq', 'app', 'lab', 'labs', 'ai', 'io', 'dev', 'tech', 'hub', 'space',
    'base', 'stack', 'box', 'flow', 'sync', 'grid', 'pulse', 'desk', 'vault',
    'craft', 'link', 'club', 'room', 'house', 'nest', 'crew', 'group', 'zone',
    'co', 'ly', 'ify', 'now', 'pro', 'one', 'x', 'direct', 'online', 'wave'
  ];

  const WORD_MIX_COUNT = 50;

  // --- DOM ELEMENTS ---
  const dom = {
    domainInput: document.getElementById('domainInput'),
    inputStats: document.getElementById('inputStats'),
    totalCheckCount: document.getElementById('totalCheckCount'),
    domainHacksBtn: document.getElementById('domainHacksBtn'),
    affixesBtn: document.getElementById('affixesBtn'),
    wordMixBtn: document.getElementById('wordMixBtn'),
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
    exportTxtBtn: document.getElementById('exportTxtBtn'),
    copyAvailBtn: document.getElementById('copyAvailBtn'),
    clearResultsBtn: document.getElementById('clearResultsBtn'),
    statAll: document.getElementById('statAll'),
    statAvail: document.getElementById('statAvail'),
    statTaken: document.getElementById('statTaken'),
    statFav: document.getElementById('statFav'),
    statErr: document.getElementById('statErr'),
    pillError: document.getElementById('pillError'),
    themeToggleBtn: document.getElementById('themeToggleBtn'),
    themeLabel: document.getElementById('themeLabel'),
    // Domain Hacks Modal
    modalBackdrop: document.getElementById('modalBackdrop'),
    modalTitle: document.getElementById('modalTitle'),
    modalMessage: document.getElementById('modalMessage'),
    modalHacksList: document.getElementById('modalHacksList'),
    modalOkBtn: document.getElementById('modalOkBtn'),
    modalAddHacksBtn: document.getElementById('modalAddHacksBtn'),
    modalCloseXBtn: document.getElementById('modalCloseXBtn'),
    // Prefix & Suffix Modal
    affixesModalBackdrop: document.getElementById('affixesModalBackdrop'),
    affixesModalCloseXBtn: document.getElementById('affixesModalCloseXBtn'),
    prefixChipsContainer: document.getElementById('prefixChipsContainer'),
    suffixChipsContainer: document.getElementById('suffixChipsContainer'),
    selectedPrefixCount: document.getElementById('selectedPrefixCount'),
    selectedSuffixCount: document.getElementById('selectedSuffixCount'),
    customAffixInput: document.getElementById('customAffixInput'),
    addCustomPrefixBtn: document.getElementById('addCustomPrefixBtn'),
    addCustomSuffixBtn: document.getElementById('addCustomSuffixBtn'),
    affixLiveSummary: document.getElementById('affixLiveSummary'),
    cancelAffixesBtn: document.getElementById('cancelAffixesBtn'),
    applyAffixesBtn: document.getElementById('applyAffixesBtn'),
    // Alarms
    addAlarmsBtn: document.getElementById('addAlarmsBtn'),
    alarmAddCount: document.getElementById('alarmAddCount'),
    alarmAddStatus: document.getElementById('alarmAddStatus'),
    alarmTabCount: document.getElementById('alarmTabCount'),
    alarmStatAll: document.getElementById('alarmStatAll'),
    alarmStatAvail: document.getElementById('alarmStatAvail'),
    alarmStatDropping: document.getElementById('alarmStatDropping'),
    alarmStatRegistered: document.getElementById('alarmStatRegistered'),
    alarmSearch: document.getElementById('alarmSearch'),
    clearAlarmsBtn: document.getElementById('clearAlarmsBtn'),
    alarmStatus: document.getElementById('alarmStatus'),
    alarmContainer: document.getElementById('alarmContainer'),
    // Discover
    discoverTabCount: document.getElementById('discoverTabCount'),
    discoverFoundCount: document.getElementById('discoverFoundCount'),
    discoverSingleCount: document.getElementById('discoverSingleCount'),
    discoverTechCount: document.getElementById('discoverTechCount'),
    discoverClassicCount: document.getElementById('discoverClassicCount'),
    discoverElegantCount: document.getElementById('discoverElegantCount'),
    discoverEasyCount: document.getElementById('discoverEasyCount'),
    discoverStatus: document.getElementById('discoverStatus'),
    discoverContainer: document.getElementById('discoverContainer'),
    scanToggleBtn: document.getElementById('scanToggleBtn'),
    scanProgressText: document.getElementById('scanProgressText'),
    scanProgressPercent: document.getElementById('scanProgressPercent'),
    scanProgressFill: document.getElementById('scanProgressFill'),
    scanHealth: document.getElementById('scanHealth'),
    addWordsInput: document.getElementById('addWordsInput'),
    addWordsList: document.getElementById('addWordsList'),
    addWordsBtn: document.getElementById('addWordsBtn'),
    addWordsStatus: document.getElementById('addWordsStatus'),
    addWordsFront: document.getElementById('addWordsFront'),
    addedWords: document.getElementById('addedWords'),
    discoverMoreBtn: document.getElementById('discoverMoreBtn'),
    logicWordsDesc: document.getElementById('logicWordsDesc'),
    logicSections: document.getElementById('logicSections'),
    logicPair: document.getElementById('logicPair'),
    logicDns: document.getElementById('logicDns'),
    logicDnsDesc: document.getElementById('logicDnsDesc'),
    logicScoreDesc: document.getElementById('logicScoreDesc')
  };

  // --- INITIALIZATION ---
  function init() {
    initTheme();
    bindEvents();
    syncTldCheckboxes();
    renderAffixChips();
    updateInputCalculations();
    loadAlarms();
    setInterval(loadAlarms, ALARM_POLL_MS);
    loadScan();
    setInterval(() => {
      if (document.body.getAttribute('data-mode') === 'discover') loadScan();
    }, SCAN_POLL_MS);
  }

  // --- THEME MANAGEMENT ---
  function initTheme() {
    const savedTheme = localStorage.getItem('domain_checker_theme') || 'dark';
    applyTheme(savedTheme);
  }

  function applyTheme(theme) {
    if (theme === 'dark') {
      document.body.classList.add('dark-mode');
      if (dom.themeLabel) dom.themeLabel.textContent = 'Light';
    } else {
      document.body.classList.remove('dark-mode');
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
    dom.alarmAddCount.textContent = totalCombos;
    dom.addAlarmsBtn.disabled = totalCombos === 0;
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
  function showModal(title, message, hackItems = [], showAddBtn = false) {
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

    if (dom.modalAddHacksBtn) {
      dom.modalAddHacksBtn.style.display = showAddBtn ? 'inline-block' : 'none';
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
      state.pendingHacks = [];
      showModal(
        'Domain Hacks Generator',
        'Enter keywords (e.g. "radio", "focus", "studio", "spotify") in the box and click Domain Hacks to discover clever TLD combinations.',
        [],
        false
      );
      return;
    }

    const sortedTlds = [...HACK_TLDS].sort((a, b) => b.length - a.length);
    const hacksFound = [];
    const existingTokens = new Set(dom.domainInput.value.replace(/[,;\t\r\n]+/g, ' ').split(/\s+/).filter(Boolean));

    rawTokens.forEach(token => {
      // If token already has a dot, skip
      if (token.includes('.')) return;

      const word = token.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (word.length < 3) return;

      // Find best matching TLD suffix
      for (const tld of sortedTlds) {
        if (word.endsWith(tld) && word.length > tld.length + 1) {
          const base = word.slice(0, -tld.length);
          const hackDomain = `${base}.${tld}`;

          if (!hacksFound.includes(hackDomain) && !existingTokens.has(hackDomain)) {
            hacksFound.push(hackDomain);
          }
          break;
        }
      }
    });

    if (hacksFound.length > 0) {
      state.pendingHacks = hacksFound;
      showModal(
        'Domain Hacks Found',
        `Found ${hacksFound.length} creative domain hack(s):`,
        hacksFound,
        true
      );
    } else {
      state.pendingHacks = [];
      showModal(
        'No Domain Hacks Found',
        'No word endings matched our 120+ supported TLDs for your current keywords. Try words like "radio", "portfolio", "focus", "creative", "delicious".',
        [],
        false
      );
    }
  }

  function addPendingHacksToSearch() {
    if (state.pendingHacks && state.pendingHacks.length > 0) {
      const currentLines = dom.domainInput.value.split('\n').map(l => l.trim()).filter(Boolean);
      const existingTokens = new Set(dom.domainInput.value.replace(/[,;\t\r\n]+/g, ' ').split(/\s+/).filter(Boolean));
      const toAdd = state.pendingHacks.filter(h => !existingTokens.has(h));

      if (toAdd.length > 0) {
        dom.domainInput.value = currentLines.concat(toAdd).join('\n');
        updateInputCalculations();
      }
    }
    state.pendingHacks = [];
    hideModal();
  }

  // --- PREFIX & SUFFIX NAME GENERATOR ---
  function renderAffixChips() {
    // Prefixes
    if (dom.prefixChipsContainer) {
      dom.prefixChipsContainer.innerHTML = '';
      const allPrefixes = [...DEFAULT_PREFIXES, ...state.customPrefixes];
      allPrefixes.forEach(prefix => {
        const label = document.createElement('label');
        label.className = 'affix-chip';
        const isChecked = state.selectedPrefixes.has(prefix);
        label.innerHTML = `
          <input type="checkbox" value="${prefix}" ${isChecked ? 'checked' : ''}>
          <span>${prefix}-</span>
        `;
        label.querySelector('input').addEventListener('change', (e) => {
          if (e.target.checked) state.selectedPrefixes.add(prefix);
          else state.selectedPrefixes.delete(prefix);
          updateAffixSummary();
        });
        dom.prefixChipsContainer.appendChild(label);
      });
    }

    // Suffixes
    if (dom.suffixChipsContainer) {
      dom.suffixChipsContainer.innerHTML = '';
      const allSuffixes = [...DEFAULT_SUFFIXES, ...state.customSuffixes];
      allSuffixes.forEach(suffix => {
        const label = document.createElement('label');
        label.className = 'affix-chip';
        const isChecked = state.selectedSuffixes.has(suffix);
        label.innerHTML = `
          <input type="checkbox" value="${suffix}" ${isChecked ? 'checked' : ''}>
          <span>-${suffix}</span>
        `;
        label.querySelector('input').addEventListener('change', (e) => {
          if (e.target.checked) state.selectedSuffixes.add(suffix);
          else state.selectedSuffixes.delete(suffix);
          updateAffixSummary();
        });
        dom.suffixChipsContainer.appendChild(label);
      });
    }

    updateAffixSummary();
  }

  function applyAffixPreset(presetName) {
    if (presetName === 'all') {
      DEFAULT_PREFIXES.forEach(p => state.selectedPrefixes.add(p));
      state.customPrefixes.forEach(p => state.selectedPrefixes.add(p));
      DEFAULT_SUFFIXES.forEach(s => state.selectedSuffixes.add(s));
      state.customSuffixes.forEach(s => state.selectedSuffixes.add(s));
    } else if (presetName === 'none') {
      state.selectedPrefixes.clear();
      state.selectedSuffixes.clear();
    }
    renderAffixChips();
  }

  function addCustomAffix(type, text) {
    let clean = text.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!clean) return;

    if (type === 'prefix') {
      state.customPrefixes.add(clean);
      state.selectedPrefixes.add(clean);
    } else {
      state.customSuffixes.add(clean);
      state.selectedSuffixes.add(clean);
    }
    dom.customAffixInput.value = '';
    renderAffixChips();
  }

  function updateAffixSummary() {
    const pCount = state.selectedPrefixes.size;
    const sCount = state.selectedSuffixes.size;

    if (dom.selectedPrefixCount) dom.selectedPrefixCount.textContent = `${pCount} selected`;
    if (dom.selectedSuffixCount) dom.selectedSuffixCount.textContent = `${sCount} selected`;

    const { baseKeywords } = parseInputs(dom.domainInput.value);
    const kCount = baseKeywords.length;
    const totalVariations = kCount * (pCount + sCount);

    if (dom.affixLiveSummary) {
      if (kCount === 0) {
        dom.affixLiveSummary.textContent = `${pCount + sCount} affixes selected (enter keywords in main box to generate)`;
      } else {
        dom.affixLiveSummary.textContent = `${totalVariations} new variations will be generated for ${kCount} keyword${kCount === 1 ? '' : 's'}`;
      }
    }
  }

  function showAffixesModal() {
    updateAffixSummary();
    if (dom.affixesModalBackdrop) dom.affixesModalBackdrop.style.display = 'flex';
  }

  function hideAffixesModal() {
    if (dom.affixesModalBackdrop) dom.affixesModalBackdrop.style.display = 'none';
  }

  function applyAffixesToDomainInput() {
    const { baseKeywords } = parseInputs(dom.domainInput.value);
    if (baseKeywords.length === 0) {
      alert('Please enter at least one keyword (e.g. "flux", "cloud", "nova") in the main box first.');
      return;
    }

    if (state.selectedPrefixes.size === 0 && state.selectedSuffixes.size === 0) {
      alert('Please select at least one prefix or suffix to generate variations.');
      return;
    }

    const generatedNames = [];
    baseKeywords.forEach(keyword => {
      // Prefixes
      state.selectedPrefixes.forEach(prefix => {
        generatedNames.push(`${prefix}${keyword}`);
      });
      // Suffixes
      state.selectedSuffixes.forEach(suffix => {
        generatedNames.push(`${keyword}${suffix}`);
      });
    });

    const currentLines = dom.domainInput.value.split('\n').map(l => l.trim()).filter(Boolean);
    const existingTokens = new Set(dom.domainInput.value.replace(/[,;\t\r\n]+/g, ' ').split(/\s+/).filter(Boolean));
    const toAdd = generatedNames.filter(n => !existingTokens.has(n));

    if (toAdd.length > 0) {
      dom.domainInput.value = currentLines.concat(toAdd).join('\n');
      updateInputCalculations();
    }

    hideAffixesModal();
  }

  // --- WORD MIX GENERATOR ---
  async function loadWords() {
    if (!state.words) {
      const res = await fetch('/api/words');
      state.words = await res.json();
    }
    return state.words;
  }

  async function addWordMixToInput() {
    const { first: firstWords, second: secondWords } = await loadWords();
    const pick = (list) => list[Math.floor(Math.random() * list.length)];
    const names = new Set();
    const existing = new Set(parseInputs(dom.domainInput.value).baseKeywords);

    while (names.size < WORD_MIX_COUNT) {
      const first = pick(firstWords);
      const second = pick(secondWords);
      const name = `${first}${second}`;
      if (first !== second && !existing.has(name)) names.add(name);
    }

    const current = dom.domainInput.value.trim();
    dom.domainInput.value = [current, ...names].filter(Boolean).join('\n');
    updateInputCalculations();
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
          statusFlags: data.status_flags || [],
          error: data.error
        };
      }
    } catch (e) {
      // Local fallback
    }

    try {
      const directUrl = `https://rdap.org/domain/${encodeURIComponent(domain)}`;
      const res = await fetch(directUrl);
      // rdap.org answers 404 itself for TLDs it has no server for
      if (res.status === 404 && new URL(res.url).hostname !== 'rdap.org') {
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

  const retryCounts = new Map(); // domain -> 429 rate limit retries
  const errorRetries = new Map(); // domain -> network/server error retries

  function buildDomainList(baseKeywords, specificDomains) {
    const domains = [];
    const seen = new Set();

    // 1. Combine base keywords with selected TLDs
    baseKeywords.forEach(kw => {
      state.selectedTlds.forEach(tld => {
        const d = `${kw}${tld}`;
        if (!seen.has(d)) {
          seen.add(d);
          domains.push(d);
        }
      });
    });

    // 2. Add specific exact domains (e.g. "rad.io", "mybrand.com") directly without multiplying
    specificDomains.forEach(d => {
      if (!seen.has(d)) {
        seen.add(d);
        domains.push(d);
      }
    });

    return domains;
  }

  async function startCheckProcess() {
    const { baseKeywords, specificDomains } = parseInputs(dom.domainInput.value);
    if (baseKeywords.length === 0 && specificDomains.length === 0) return;

    retryCounts.clear();
    errorRetries.clear();
    dom.progressSection.classList.remove('rate-limited');

    const domainsToCheck = buildDomainList(baseKeywords, specificDomains);

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

      if (result.status === 'error' || (result.status === 'success' && result.available === null)) {
        const errRetries = (errorRetries.get(domain) || 0) + 1;
        errorRetries.set(domain, errRetries);

        if (errRetries <= 2) {
          // Automatic silent background retry (attempt 2 and 3)
          updateProgressUI(
            Math.round((state.completedTasks / state.totalTasks) * 100),
            `🔄 Retrying "${domain}" (attempt ${errRetries + 1}/3)...`
          );
          await sleep(400 * errRetries);
          state.queue.unshift(domain);
          continue;
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

  function buyLinksHtml(domain) {
    return `
        <div class="buy-deck">
          <a href="https://porkbun.com/checkout/search?q=${encodeURIComponent(domain)}" target="_blank" rel="noopener" class="editorial-link" title="Open on Porkbun">Porkbun</a>
          <a href="https://www.namecheap.com/domains/registration/results/?domain=${encodeURIComponent(domain)}" target="_blank" rel="noopener" class="editorial-link" title="Open on Namecheap">Namecheap</a>
          <a href="https://www.cloudflare.com/domains/search?q=${encodeURIComponent(domain)}" target="_blank" rel="noopener" class="editorial-link" title="Open on Cloudflare">Cloudflare</a>
        </div>
      `;
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
      actionsHtml = buyLinksHtml(entry.domain);
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

  // --- ALARMS ---
  const ALARM_POLL_MS = 30000;

  // Phases in display order: what needs attention first
  const ALARM_PHASES = {
    available: { label: 'Available', badge: 'avail', group: 'available' },
    pending_delete: { label: 'Dropping in days', badge: 'error', group: 'dropping' },
    redemption: { label: 'Redemption', badge: 'error', group: 'dropping' },
    expired: { label: 'Expired', badge: 'error', group: 'dropping' },
    registered: { label: 'Registered', badge: 'taken', group: 'registered' },
    pending: { label: 'Waiting', badge: 'taken', group: 'registered' }
  };
  const ALARM_PHASE_ORDER = Object.keys(ALARM_PHASES);

  async function loadAlarms() {
    try {
      const res = await fetch('/api/alarms');
      const data = await res.json();
      state.alarms = data.alarms;
      state.alarmStatus = { blockedUntil: data.blocked_until, delay: data.delay };
      renderAlarms();
    } catch (e) {
      dom.alarmStatus.textContent = 'Local server is not responding.';
    }
  }

  async function addAlarms() {
    const { baseKeywords, specificDomains } = parseInputs(dom.domainInput.value);
    const domains = buildDomainList(baseKeywords, specificDomains);
    if (domains.length === 0) return;

    try {
      const res = await fetch('/api/alarms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domains })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      dom.alarmAddStatus.textContent = `${data.added} added, ${domains.length - data.added} already watched or invalid.`;
      dom.domainInput.value = '';
      updateInputCalculations();
      await loadAlarms();
    } catch (e) {
      dom.alarmAddStatus.textContent = 'Could not save the list. Is the app still running?';
    }
  }

  function renderAlarmCard(alarm) {
    const phase = ALARM_PHASES[alarm.phase];
    const isAvail = alarm.phase === 'available';
    const expiry = formatExpiryDate(alarm.expiration_date);
    const metaTags = [];

    if (isAvail) {
      metaTags.push(`<span class="meta-pill expiry-pill">Free since ${formatAlarmTime(alarm.available_since)}</span>`);
    } else if (expiry) {
      metaTags.push(`<span class="meta-pill expiry-pill">Expires: ${expiry}</span>`);
    }
    if (alarm.last_checked) metaTags.push(`<span class="meta-pill">Checked ${formatAlarmTime(alarm.last_checked)}</span>`);
    if (alarm.failed) metaTags.push('<span class="meta-pill">Last check failed</span>');

    return `
      <div class="record-card ${isAvail ? 'available' : 'taken'}">
        <div class="record-left">
          <div>
            <div class="domain-heading">${alarm.domain}</div>
            <div class="record-meta-line">${metaTags.join('')}</div>
          </div>
        </div>
        <div class="record-right">
          <span class="editorial-badge ${phase.badge}">${phase.badge === 'error' ? '' : '<span class="dot"></span> '}${phase.label}</span>
          ${isAvail ? buyLinksHtml(alarm.domain) : ''}
          <button type="button" class="btn-ghost-sm alarm-remove-btn" data-domain="${alarm.domain}">Remove</button>
        </div>
      </div>
    `;
  }

  function formatAlarmTime(seconds) {
    return new Date(seconds * 1000).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
  }

  function renderAlarms() {
    const counts = { available: 0, dropping: 0, registered: 0 };
    state.alarms.forEach(a => counts[ALARM_PHASES[a.phase].group]++);

    dom.alarmTabCount.textContent = counts.available;
    dom.alarmStatAll.textContent = state.alarms.length;
    dom.alarmStatAvail.textContent = counts.available;
    dom.alarmStatDropping.textContent = counts.dropping;
    dom.alarmStatRegistered.textContent = counts.registered;

    const { blockedUntil, delay } = state.alarmStatus;
    const checked = state.alarms.filter(a => a.last_checked).length;
    const isBlocked = blockedUntil * 1000 > Date.now();
    dom.alarmStatus.classList.toggle('blocked', isBlocked);
    dom.alarmStatus.textContent = isBlocked
      ? `Registry asked us to slow down. Watcher resumes at ${formatAlarmTime(blockedUntil)}.`
      : `${checked} of ${state.alarms.length} checked so far. One query every ${delay} seconds.`;

    const visible = state.alarms
      .filter(a => state.alarmFilter === 'all' || ALARM_PHASES[a.phase].group === state.alarmFilter)
      .filter(a => a.domain.includes(state.alarmQuery))
      .sort((a, b) => ALARM_PHASE_ORDER.indexOf(a.phase) - ALARM_PHASE_ORDER.indexOf(b.phase));

    dom.alarmContainer.innerHTML = visible.length > 0
      ? visible.map(renderAlarmCard).join('')
      : `<div class="empty-state">
          <div class="empty-glyph">◌</div>
          <h3 class="empty-title">Nothing here yet</h3>
          <p class="empty-desc">Enter domains on the left and click <strong>Add to Alarms</strong>.</p>
        </div>`;
  }

  function setMode(mode) {
    document.body.setAttribute('data-mode', mode);
    document.querySelectorAll('.mode-tab').forEach(t => t.classList.toggle('active', t.getAttribute('data-mode') === mode));
    if (mode === 'alarm') loadAlarms();
    if (mode === 'discover') loadScan();
  }

  // --- DISCOVER ---
  const SCAN_POLL_MS = 2000;
  const STALE_SCAN_SECONDS = 60;
  const SCAN_NOTICE_MS = 10000;
  const WORD_LIST_LABELS = {
    tech_first: 'Tech start',
    tech_second: 'Tech end',
    elegant: 'Elegant',
    classic: 'Classic',
    first: 'Adjective',
    second: 'Thing',
    single: 'Single word'
  };

  async function loadScan() {
    try {
      const res = await fetch(`/api/scan?limit=${state.discoverLimit}&kind=${state.discoverView}`);
      state.scan = await res.json();
      renderScan();
    } catch (e) {
      dom.scanHealth.textContent = 'Local server is not responding.';
    }
  }

  function formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    if (hours >= 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
    return `${hours}h ${Math.floor(seconds % 3600 / 60)}m`;
  }

  function renderPairHtml(check) {
    if (!check.second) {
      return `${check.first} <span class="mono-num">#${check.first_rank + 1}</span> &rarr; ${check.domain}`;
    }
    const score = check.first_rank + check.second_rank;
    return `${check.first} <span class="mono-num">#${check.first_rank + 1}</span> + ${check.second} <span class="mono-num">#${check.second_rank + 1}</span> = rank sum ${score} &rarr; ${check.domain}`;
  }

  function renderAnswersHtml(check) {
    const answers = check.answers.map(a => `${a.resolver}: ${a.answer}`).join(', ');
    const outcome = { free: 'may be free', registered: 'registered, skipped' }[check.verdict] || 'unclear, will retry';
    return `${check.domain} &rarr; ${answers} &rarr; <span class="${check.verdict === 'free' ? 'free' : ''}">${outcome}</span>`;
  }

  function renderDiscoveryCard(item) {
    const isVerified = item.verdict === 'available';
    const pills = [
      `<span class="meta-pill">${item.first_word} #${item.first_rank + 1}${item.second_word ? ` + ${item.second_word} #${item.second_rank + 1}` : ' (single word)'}</span>`,
      `<span class="meta-pill expiry-pill">Score ${item.score}</span>`
    ];
    if (item.penalty > 0) pills.push(`<span class="meta-pill">Penalty +${item.penalty}</span>`);

    return `
      <div class="record-card ${isVerified ? 'available' : 'taken'}">
        <div class="record-left">
          <div>
            <div class="domain-heading">${item.domain}</div>
            <div class="record-meta-line">${pills.join('')}</div>
          </div>
        </div>
        <div class="record-right">
          <span class="editorial-badge ${isVerified ? 'avail' : 'error'}">${isVerified ? '<span class="dot"></span> Verified free' : 'Unverified'}</span>
          ${isVerified ? buyLinksHtml(item.domain) : `<button type="button" class="btn-ghost-sm discovery-verify-btn" data-domain="${item.domain}">Verify</button>`}
          <button type="button" class="btn-ghost-sm discovery-hide-btn" data-domain="${item.domain}">Hide</button>
        </div>
      </div>
    `;
  }

  function renderLiveCheck(check) {
    return `
      <div class="record-card live-check ${check.verdict === 'free' ? 'free' : ''}">
        <div class="record-left">
          <div>
            <div class="domain-heading">${check.domain}</div>
            <div class="record-meta-line">${renderPairHtml(check)}</div>
          </div>
        </div>
        <div class="record-meta-line">${renderAnswersHtml(check)}</div>
      </div>
    `;
  }

  function renderScan() {
    const scan = state.scan;
    const percent = scan.checked / scan.total_names * 100;
    const remaining = (scan.total_names - scan.checked) * scan.delay;
    const isFullyChecked = scan.checked === scan.total_names;
    const activeSection = scan.current ? scan.current.section : null;

    dom.discoverTabCount.textContent = scan.found;
    dom.discoverFoundCount.textContent = scan.found;
    dom.discoverSingleCount.textContent = scan.views.single;
    dom.discoverTechCount.textContent = scan.views.tech;
    dom.discoverClassicCount.textContent = scan.views.classic;
    dom.discoverElegantCount.textContent = scan.views.elegant;
    dom.discoverEasyCount.textContent = scan.views.easy;
    dom.scanToggleBtn.textContent = scan.enabled ? 'Pause' : 'Start';

    dom.logicWordsDesc.textContent = `${scan.total_names.toLocaleString()} names in ${scan.sections.length} sections. Checking them all takes about ${formatDuration(scan.total_names * scan.delay)}.`;
    dom.logicSections.innerHTML = scan.sections.map(section => `
      <li class="${section.name === activeSection ? 'active' : ''}"><span>${section.name}</span><span class="mono-num">${section.size.toLocaleString()}</span></li>
    `).join('');
    dom.logicDnsDesc.textContent = `Each name is asked at ${scan.servers[0]}, the .com zone itself. NOERROR means it is in the zone, so it is registered. A free name can't be in the zone, so it can't be missed here. NXDOMAIN means it may be free. No answer means the same name is tried again.`;
    dom.logicScoreDesc.textContent = `Pairs: rank sum, +${scan.joint_penalty} if the words join on the same letter, +${scan.length_penalty} per letter over ${scan.ideal_length}. Single words: rank divided by ${scan.single_divisor}. Lower is better.`;
    const addedHtml = scan.added_words.map(item => `
      <li><span>${item.word}</span><span class="word-list-name">${WORD_LIST_LABELS[item.list]}</span><button type="button" class="btn-ghost-sm word-front-btn" data-word="${item.word}">To Front</button></li>
    `).join('');
    if (addedHtml !== state.addedHtml) {
      state.addedHtml = addedHtml;
      dom.addedWords.innerHTML = addedHtml;
    }

    dom.logicPair.innerHTML = scan.current ? renderPairHtml(scan.current) : 'Waiting to start';
    if (scan.recent.length > 0) dom.logicDns.innerHTML = renderAnswersHtml(scan.recent[0]);

    dom.scanProgressText.textContent = `${scan.checked.toLocaleString()} of ${scan.total_names.toLocaleString()} checked${scan.at_front > 0 ? `, ${scan.at_front.toLocaleString()} at the front` : ''}`;
    dom.scanProgressPercent.textContent = `${percent.toFixed(1)}%`;
    dom.scanProgressFill.style.width = `${percent}%`;

    const age = scan.last_checked ? Math.floor(Date.now() / 1000 - scan.last_checked) : null;
    const isStale = scan.enabled && age !== null && age > STALE_SCAN_SECONDS;
    dom.scanHealth.classList.toggle('blocked', isStale);
    dom.scanHealth.textContent = isStale
      ? `No answer for ${age} seconds. Retrying the same name until DNS responds.`
      : `${!scan.enabled ? 'Paused.' : isFullyChecked ? `Rechecking oldest first, from ${formatAlarmTime(scan.oldest_check)}.` : `About ${formatDuration(remaining)} until every name is checked.`} ${scan.checked_total.toLocaleString()} checks in total, ${scan.errors} retries.`;

    const showsNames = state.discoverView !== 'live';
    const shownTotal = scan.views[state.discoverView] ?? scan.found;
    const html = showsNames
      ? (scan.best.map(renderDiscoveryCard).join('') || '<div class="empty-state"><div class="empty-glyph">◌</div><h3 class="empty-title">Nothing found yet</h3><p class="empty-desc">Press <strong>Start</strong> and the best free names show up here.</p></div>')
      : (scan.recent.map(renderLiveCheck).join('') || '<div class="empty-state"><div class="empty-glyph">◌</div><h3 class="empty-title">No checks yet</h3></div>');
    if (html !== state.discoverHtml) {
      state.discoverHtml = html;
      dom.discoverContainer.innerHTML = html;
    }

    dom.discoverMoreBtn.style.display = showsNames && scan.best.length < shownTotal ? 'block' : 'none';
    dom.discoverStatus.textContent = Date.now() < state.discoverNoticeUntil
      ? state.discoverNotice
      : showsNames
      ? `Top ${scan.best.length} of ${shownTotal} shown. Verified names first, then lowest score.`
      : 'The last 30 names the scanner tried, newest first.';
  }

  async function postScan(path, body) {
    return fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  }

  async function addWords() {
    const { baseKeywords } = parseInputs(dom.addWordsInput.value);
    if (baseKeywords.length === 0) return;

    dom.addWordsStatus.textContent = 'Adding...';
    const res = await postScan('/api/words', {
      list: dom.addWordsList.value,
      words: baseKeywords,
      to_front: dom.addWordsFront.checked
    });
    if (res.ok) {
      const data = await res.json();
      dom.addWordsStatus.textContent = `${data.added} new words, ${data.names.toLocaleString()} new names, ${data.moved.toLocaleString()} sent to the front.`;
      dom.addWordsInput.value = '';
      state.words = null;
      await loadScan();
    } else {
      dom.addWordsStatus.textContent = 'Could not add those words.';
    }
  }

  async function moveWordToFront(button) {
    const word = button.getAttribute('data-word');
    button.disabled = true;
    const res = await postScan('/api/words/front', { word });
    const data = await res.json();
    dom.addWordsStatus.textContent = `${data.moved.toLocaleString()} names with "${word}" sent to the front.`;
    await loadScan();
  }

  async function verifyDiscovery(button) {
    const domain = button.getAttribute('data-domain');
    button.textContent = 'Checking...';
    button.disabled = true;
    const res = await postScan('/api/scan/verify', { domain });
    if (res.ok) {
      const data = await res.json();
      state.discoverNotice = data.verdict === 'taken'
        ? `${domain} is registered after all, so it was removed.`
        : `${domain} is confirmed free.`;
      state.discoverNoticeUntil = Date.now() + SCAN_NOTICE_MS;
    } else {
      button.textContent = 'Retry';
      button.disabled = false;
      return;
    }
    await loadScan();
  }

  // --- EXPORTS (AVAILABLE DOMAINS) ---
  function getAvailableDomainsList() {
    return Array.from(state.results.values())
      .filter(d => d.available === true)
      .map(d => d.domain);
  }

  function exportJson() {
    const available = getAvailableDomainsList();
    if (available.length === 0) {
      showModal('No Available Domains', 'No available domains found to export.');
      return;
    }
    const blob = new Blob([JSON.stringify(available, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `available_domains_${Date.now()}.json`);
  }

  function exportTxt() {
    const available = getAvailableDomainsList();
    if (available.length === 0) {
      showModal('No Available Domains', 'No available domains found to export.');
      return;
    }
    const blob = new Blob([available.join('\n')], { type: 'text/plain;charset=utf-8;' });
    downloadBlob(blob, `available_domains_${Date.now()}.txt`);
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

    // Domain Hacks Button
    dom.domainHacksBtn.addEventListener('click', generateDomainHacks);
    dom.wordMixBtn.addEventListener('click', addWordMixToInput);

    // Domain Hacks Modal OK, Add & Close Button & Backdrop click
    dom.modalOkBtn.addEventListener('click', hideModal);
    if (dom.modalAddHacksBtn) dom.modalAddHacksBtn.addEventListener('click', addPendingHacksToSearch);
    if (dom.modalCloseXBtn) dom.modalCloseXBtn.addEventListener('click', hideModal);
    dom.modalBackdrop.addEventListener('click', (e) => {
      if (e.target === dom.modalBackdrop) hideModal();
    });

    // Prefix & Suffix Modal Triggers & Actions
    if (dom.affixesBtn) {
      dom.affixesBtn.addEventListener('click', showAffixesModal);
    }
    if (dom.affixesModalCloseXBtn) {
      dom.affixesModalCloseXBtn.addEventListener('click', hideAffixesModal);
    }
    if (dom.cancelAffixesBtn) {
      dom.cancelAffixesBtn.addEventListener('click', hideAffixesModal);
    }
    if (dom.applyAffixesBtn) {
      dom.applyAffixesBtn.addEventListener('click', applyAffixesToDomainInput);
    }
    if (dom.affixesModalBackdrop) {
      dom.affixesModalBackdrop.addEventListener('click', (e) => {
        if (e.target === dom.affixesModalBackdrop) hideAffixesModal();
      });
    }

    // Affix Presets
    document.querySelectorAll('.preset-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const preset = e.target.getAttribute('data-preset');
        if (preset) applyAffixPreset(preset);
      });
    });

    // Custom Affix Adders
    if (dom.addCustomPrefixBtn) {
      dom.addCustomPrefixBtn.addEventListener('click', () => addCustomAffix('prefix', dom.customAffixInput.value));
    }
    if (dom.addCustomSuffixBtn) {
      dom.addCustomSuffixBtn.addEventListener('click', () => addCustomAffix('suffix', dom.customAffixInput.value));
    }
    if (dom.customAffixInput) {
      dom.customAffixInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          addCustomAffix('suffix', dom.customAffixInput.value);
        }
      });
    }

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
    document.querySelectorAll('.filter-tab[data-filter]').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.filter-tab[data-filter]').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        state.activeFilter = tab.getAttribute('data-filter');
        filterAllCards();
      });
    });

    dom.searchFilter.addEventListener('input', (e) => {
      state.searchQuery = e.target.value.trim().toLowerCase();
      filterAllCards();
    });

    // Alarms
    document.querySelectorAll('.mode-tab').forEach(tab => {
      tab.addEventListener('click', () => setMode(tab.getAttribute('data-mode')));
    });

    document.querySelectorAll('.alarm-filter').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.alarm-filter').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        state.alarmFilter = tab.getAttribute('data-alarm-filter');
        renderAlarms();
      });
    });

    dom.alarmSearch.addEventListener('input', (e) => {
      state.alarmQuery = e.target.value.trim().toLowerCase();
      renderAlarms();
    });

    dom.addAlarmsBtn.addEventListener('click', addAlarms);

    dom.clearAlarmsBtn.addEventListener('click', async () => {
      if (state.alarms.length > 0 && confirm(`Remove all ${state.alarms.length} domains from the watch list?`)) {
        await fetch('/api/alarms', { method: 'DELETE' });
        await loadAlarms();
      }
    });

    dom.alarmContainer.addEventListener('click', async (e) => {
      const removeBtn = e.target.closest('.alarm-remove-btn');
      if (removeBtn) {
        await fetch(`/api/alarms?domain=${encodeURIComponent(removeBtn.getAttribute('data-domain'))}`, { method: 'DELETE' });
        await loadAlarms();
      }
    });

    // Discover
    dom.scanToggleBtn.addEventListener('click', async () => {
      if (!state.scan) return;
      await postScan('/api/scan', { enabled: !state.scan.enabled });
      await loadScan();
    });

    document.querySelectorAll('.discover-view').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.discover-view').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        state.discoverView = tab.getAttribute('data-discover-view');
        state.discoverLimit = SCAN_PAGE_SIZE;
        loadScan();
      });
    });

    dom.addWordsBtn.addEventListener('click', addWords);
    dom.addWordsInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addWords();
    });
    dom.addedWords.addEventListener('click', (e) => {
      const frontBtn = e.target.closest('.word-front-btn');
      if (frontBtn) moveWordToFront(frontBtn);
    });

    dom.discoverMoreBtn.addEventListener('click', async () => {
      state.discoverLimit += SCAN_PAGE_SIZE;
      await loadScan();
    });

    dom.discoverContainer.addEventListener('click', async (e) => {
      const verifyBtn = e.target.closest('.discovery-verify-btn');
      const hideBtn = e.target.closest('.discovery-hide-btn');
      if (verifyBtn) await verifyDiscovery(verifyBtn);
      if (hideBtn) {
        await fetch(`/api/scan?domain=${encodeURIComponent(hideBtn.getAttribute('data-domain'))}`, { method: 'DELETE' });
        await loadScan();
      }
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
    dom.exportTxtBtn.addEventListener('click', exportTxt);
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
