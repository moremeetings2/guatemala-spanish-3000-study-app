const DATA_URL = "./data/guatemala_spanish_study_pack.json";
const LOCAL_STORAGE_PROGRESS_KEY = "guatemala-spanish-3000-progress-v2";
const LEGACY_STORAGE_KEY = "guatemala-spanish-3000-progress-v1";
const LOCAL_STORAGE_PREFERENCES_KEY = "guatemala-spanish-3000-preferences-v1";
const DAY_MS = 24 * 60 * 60 * 1000;
const SHORT_REVIEW_DAYS = 3 / 24;
const AUDIO_RATE_MIN = 0.6;
const AUDIO_RATE_MAX = 1.0;
const LEGACY_AUDIO_DEFAULT_RATE = 0.72;
const AUDIO_PREFERENCES_VERSION = 2;
const PERSISTENCE_SCHEMA_VERSION = 1;
const DATABASE_NAME = "guatemala-spanish-study-app-db";
const DATABASE_VERSION = 1;
const DATABASE_STORE = "appState";
const DATABASE_KEYS = {
  progress: "progress",
  preferences: "preferences",
};
const COLLECTION_ORDER = {
  mainWords: 0,
  coffeePhrases: 1,
  conversationVerbs: 2,
  guatemalaBonus: 3,
};

let databasePromise = null;
let progressSaveTimer = null;
let preferencesSaveTimer = null;
let pendingProgressEnvelope = null;
let pendingPreferencesEnvelope = null;
let speechVoicesReady = false;

function defaultUiState() {
  return {
    deck: "all",
    session: "all",
    statusFilter: "all",
    band: "all",
    type: "all",
    search: "",
  };
}

function defaultQuizState() {
  return {
    scope: "due",
    direction: "es-en",
    current: null,
    total: 0,
    correct: 0,
  };
}

function defaultAudioState() {
  return {
    version: AUDIO_PREFERENCES_VERSION,
    voiceURI: "auto",
    rate: 0.68,
  };
}

const state = {
  data: null,
  entries: [],
  filteredEntries: [],
  currentIndex: 0,
  progress: {},
  quiz: defaultQuizState(),
  ui: defaultUiState(),
  audio: defaultAudioState(),
  speechVoices: [],
};

const elements = {
  heroDescription: document.querySelector("#hero-description"),
  heroStats: document.querySelector("#hero-stats"),
  deckSelect: document.querySelector("#deck-select"),
  sessionFilter: document.querySelector("#session-filter"),
  statusFilter: document.querySelector("#status-filter"),
  bandFilter: document.querySelector("#band-filter"),
  typeFilter: document.querySelector("#type-filter"),
  searchInput: document.querySelector("#search-input"),
  resultsSummary: document.querySelector("#results-summary"),
  entryList: document.querySelector("#entry-list"),
  flashcard: document.querySelector("#flashcard"),
  cardFrontText: document.querySelector("#card-front-text"),
  cardFrontMeta: document.querySelector("#card-front-meta"),
  cardBackText: document.querySelector("#card-back-text"),
  cardBackMeta: document.querySelector("#card-back-meta"),
  studySummary: document.querySelector("#study-summary"),
  progressGrid: document.querySelector("#progress-grid"),
  reviewSummary: document.querySelector("#review-summary"),
  favoriteButton: document.querySelector("#favorite-button"),
  nextButton: document.querySelector("#next-button"),
  shuffleButton: document.querySelector("#shuffle-button"),
  speakButton: document.querySelector("#speak-button"),
  clearFiltersButton: document.querySelector("#clear-filters-button"),
  exportProgressButton: document.querySelector("#export-progress-button"),
  importProgressInput: document.querySelector("#import-progress-input"),
  importStatus: document.querySelector("#import-status"),
  voiceSelect: document.querySelector("#voice-select"),
  speechRateInput: document.querySelector("#speech-rate-input"),
  speechRateValue: document.querySelector("#speech-rate-value"),
  speechStatus: document.querySelector("#speech-status"),
  quizScope: document.querySelector("#quiz-scope"),
  quizDirection: document.querySelector("#quiz-direction"),
  quizPrompt: document.querySelector("#quiz-prompt"),
  quizMeta: document.querySelector("#quiz-meta"),
  quizOptions: document.querySelector("#quiz-options"),
  quizFeedback: document.querySelector("#quiz-feedback"),
  quizNextButton: document.querySelector("#quiz-next-button"),
  quizSpeakButton: document.querySelector("#quiz-speak-button"),
  entryTemplate: document.querySelector("#entry-template"),
};

bootstrap();

async function bootstrap() {
  bindEvents();
  bindLifecycleEvents();
  registerServiceWorker();

  try {
    await hydratePersistedState();
    initializeSpeechControls();
    const response = await fetch(DATA_URL);
    if (!response.ok) {
      throw new Error(`Failed to load data (${response.status})`);
    }

    state.data = await response.json();
    state.entries = sortEntries(flattenCollections(state.data.collections));
    renderHero();
    applyFilters(true);
  } catch (error) {
    elements.heroDescription.textContent = "The workbook data could not be loaded.";
    elements.studySummary.textContent = error.message;
    elements.entryList.innerHTML = `<p class="empty-state">${error.message}</p>`;
    elements.quizPrompt.textContent = "Quiz unavailable";
    elements.quizMeta.textContent = error.message;
  }
}

function bindLifecycleEvents() {
  window.addEventListener("pagehide", flushPendingPersistence);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      flushPendingPersistence();
    }
  });
}

function bindEvents() {
  elements.deckSelect.addEventListener("change", (event) => {
    state.ui.deck = event.target.value;
    queuePreferencesSave();
    applyFilters(true);
  });

  elements.sessionFilter.addEventListener("change", (event) => {
    state.ui.session = event.target.value;
    queuePreferencesSave();
    applyFilters(true);
  });

  elements.statusFilter.addEventListener("change", (event) => {
    state.ui.statusFilter = event.target.value;
    queuePreferencesSave();
    applyFilters(true);
  });

  elements.bandFilter.addEventListener("change", (event) => {
    state.ui.band = event.target.value;
    queuePreferencesSave();
    applyFilters(true);
  });

  elements.typeFilter.addEventListener("change", (event) => {
    state.ui.type = event.target.value;
    queuePreferencesSave();
    applyFilters(true);
  });

  elements.searchInput.addEventListener("input", (event) => {
    state.ui.search = event.target.value.trim().toLowerCase();
    applyFilters(true);
  });

  elements.voiceSelect.addEventListener("change", (event) => {
    state.audio.voiceURI = event.target.value;
    queuePreferencesSave();
    renderSpeechControls();
  });

  elements.speechRateInput.addEventListener("input", (event) => {
    state.audio.rate = clamp(Number(event.target.value), AUDIO_RATE_MIN, AUDIO_RATE_MAX);
    queuePreferencesSave();
    renderSpeechControls();
  });

  elements.flashcard.addEventListener("click", () => {
    elements.flashcard.classList.toggle("is-flipped");
  });

  document.querySelectorAll(".status-button").forEach((button) => {
    button.addEventListener("click", () => {
      const entry = currentEntry();
      if (!entry) {
        return;
      }
      setManualStatus(entry.id, button.dataset.status);
      refreshAfterProgressChange();
    });
  });

  elements.favoriteButton.addEventListener("click", () => {
    const entry = currentEntry();
    if (!entry) {
      return;
    }
    toggleFavorite(entry.id);
    refreshAfterProgressChange();
  });

  elements.nextButton.addEventListener("click", nextCard);

  elements.shuffleButton.addEventListener("click", () => {
    shuffleFilteredEntries();
    state.currentIndex = 0;
    renderFlashcard();
  });

  elements.speakButton.addEventListener("click", () => {
    speakEntry(currentEntry());
  });

  elements.quizScope.addEventListener("change", (event) => {
    state.quiz.scope = event.target.value;
    queuePreferencesSave();
    ensureQuizQuestion(true);
  });

  elements.quizDirection.addEventListener("change", (event) => {
    state.quiz.direction = event.target.value;
    queuePreferencesSave();
    ensureQuizQuestion(true);
  });

  elements.quizNextButton.addEventListener("click", () => {
    ensureQuizQuestion(true);
  });

  elements.quizSpeakButton.addEventListener("click", () => {
    speakEntry(state.quiz.current?.entry || null);
  });

  elements.exportProgressButton.addEventListener("click", exportProgress);
  elements.importProgressInput.addEventListener("change", importProgress);

  elements.clearFiltersButton.addEventListener("click", () => {
    state.ui = defaultUiState();
    syncControlsFromState();
    queuePreferencesSave();
    applyFilters(true);
  });
}

async function hydratePersistedState() {
  const persisted = await loadPersistedState();
  state.progress = persisted.progress;
  state.ui = {
    ...defaultUiState(),
    ...persisted.preferences.ui,
  };
  state.quiz = {
    ...defaultQuizState(),
    ...persisted.preferences.quiz,
    current: null,
    total: 0,
    correct: 0,
  };
  state.audio = {
    ...defaultAudioState(),
    ...persisted.preferences.audio,
  };
  syncControlsFromState();
}

function syncControlsFromState() {
  elements.deckSelect.value = state.ui.deck;
  elements.sessionFilter.value = state.ui.session;
  elements.statusFilter.value = state.ui.statusFilter;
  elements.bandFilter.value = state.ui.band;
  elements.typeFilter.value = state.ui.type;
  elements.searchInput.value = state.ui.search;
  elements.quizScope.value = state.quiz.scope;
  elements.quizDirection.value = state.quiz.direction;
  elements.speechRateInput.value = String(state.audio.rate);
  elements.speechRateValue.textContent = formatSpeechRate(state.audio.rate);
}

function initializeSpeechControls() {
  renderSpeechControls();

  if (!("speechSynthesis" in window)) {
    speechVoicesReady = false;
    renderSpeechControls();
    return;
  }

  const loadVoices = () => {
    const availableVoices = window.speechSynthesis.getVoices();
    state.speechVoices = rankSpanishVoices(availableVoices);
    speechVoicesReady = true;

    if (
      state.audio.voiceURI !== "auto" &&
      !state.speechVoices.some((voice) => voice.voiceURI === state.audio.voiceURI)
    ) {
      state.audio.voiceURI = "auto";
      queuePreferencesSave();
    }

    renderSpeechControls();
  };

  loadVoices();
  if (typeof window.speechSynthesis.addEventListener === "function") {
    window.speechSynthesis.addEventListener("voiceschanged", loadVoices);
  } else {
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }

  window.setTimeout(loadVoices, 300);
}

function renderSpeechControls() {
  elements.speechRateValue.textContent = formatSpeechRate(state.audio.rate);

  if (!("speechSynthesis" in window)) {
    elements.voiceSelect.innerHTML = '<option value="auto">Speech unavailable</option>';
    elements.voiceSelect.disabled = true;
    elements.speechRateInput.disabled = true;
    elements.speechStatus.textContent = "Speech synthesis is not available in this browser.";
    return;
  }

  const options = [
    '<option value="auto">Auto (best Spanish voice)</option>',
    ...state.speechVoices.map(
      (voice) =>
        `<option value="${escapeHtml(voice.voiceURI)}">${escapeHtml(formatVoiceLabel(voice))}</option>`
    ),
  ];

  elements.voiceSelect.innerHTML = options.join("");
  elements.voiceSelect.value = state.audio.voiceURI;
  elements.voiceSelect.disabled = false;
  elements.speechRateInput.disabled = false;

  const activeVoice = getActiveSpeechVoice();
  if (!speechVoicesReady) {
    elements.speechStatus.textContent = "Loading Spanish voices...";
  } else if (!state.speechVoices.length) {
    elements.speechStatus.textContent =
      "No Spanish voices were found. The browser will fall back to its default voice.";
  } else if (state.audio.voiceURI === "auto") {
    elements.speechStatus.textContent =
      `Auto voice: ${formatVoiceLabel(activeVoice)} at ${formatSpeechRate(state.audio.rate)}. ` +
      "For best clarity on iPhone, install an enhanced Spanish voice in Settings > Accessibility > Spoken Content > Voices.";
  } else {
    elements.speechStatus.textContent =
      `Selected voice: ${formatVoiceLabel(activeVoice)} at ${formatSpeechRate(state.audio.rate)}.`;
  }
}

function applyFilters(resetIndex = false, options = {}) {
  const { syncQuiz = true } = options;
  const basicFiltered = state.entries.filter(matchesBaseFilters);
  let filtered = basicFiltered;

  if (state.ui.session === "due") {
    filtered = selectDueEntries(basicFiltered);
  } else if (state.ui.session === "weak") {
    filtered = selectWeakEntries(basicFiltered);
  }

  state.filteredEntries = sortEntries(filtered.slice());
  if (resetIndex || state.currentIndex >= state.filteredEntries.length) {
    state.currentIndex = 0;
  }

  renderHero();
  renderStudySummary(basicFiltered);
  renderFlashcard();
  renderList();
  renderProgress();

  if (syncQuiz) {
    ensureQuizQuestion(false);
  } else {
    renderQuiz();
  }
}

function matchesBaseFilters(entry) {
  if (state.ui.deck !== "all" && entry.collection !== state.ui.deck) {
    return false;
  }

  if (state.ui.band !== "all" && entry.band !== state.ui.band) {
    return false;
  }

  if (state.ui.type !== "all" && entry.type !== state.ui.type) {
    return false;
  }

  const progress = readEntryProgress(entry.id);
  if (state.ui.statusFilter === "favorite" && !progress.favorite) {
    return false;
  }

  if (["new", "learning", "known"].includes(state.ui.statusFilter) && progress.status !== state.ui.statusFilter) {
    return false;
  }

  if (state.ui.search) {
    const haystack = [
      entry.spanish,
      entry.english,
      entry.partOfSpeech,
      entry.context,
      entry.focus,
      entry.miniPhrase,
      entry.miniPhraseEnglish,
      entry.phrasePattern,
      entry.note,
      entry.tags?.join(" "),
      collectionLabel(entry.collection),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    if (!haystack.includes(state.ui.search)) {
      return false;
    }
  }

  return true;
}

function renderHero() {
  if (!state.data) {
    return;
  }

  const { meta } = state.data;
  const counts = computeReviewCounts(state.entries);
  const dailyTarget = getDailyTarget();
  elements.heroDescription.textContent =
    `${meta.description || "Study offline on your phone."} Daily target: ${dailyTarget} cards.`;

  const accuracy = counts.quizSeen ? `${Math.round((counts.quizCorrect / counts.quizSeen) * 100)}%` : "0%";
  const cards = [
    ["Words", meta.counts.words],
    ["Coffee phrases", meta.counts.coffeePhrases ?? 0],
    ["Conversation verbs", meta.counts.conversationVerbs ?? 0],
    ["Guatemala notes", meta.counts.bonus ?? 0],
    ["Due today", counts.due],
    ["Quiz accuracy", accuracy],
  ];

  elements.heroStats.innerHTML = cards
    .map(
      ([label, value]) => `
        <article class="stat-card">
          <strong>${value}</strong>
          <span>${label}</span>
        </article>
      `
    )
    .join("");
}

function renderStudySummary(basicFiltered) {
  const overall = computeReviewCounts(state.entries);
  const sessionLabel = {
    all: "all filtered cards",
    due: "the due queue",
    weak: "weak spots",
  }[state.ui.session];

  elements.studySummary.textContent =
    `${state.filteredEntries.length} cards in ${sessionLabel}. ` +
    `${basicFiltered.length} cards match the current filters. ` +
    `${overall.due} due today, ${overall.weak} weak cards across the full deck.`;
}

function renderFlashcard() {
  elements.flashcard.classList.remove("is-flipped");
  const entry = currentEntry();

  if (!entry) {
    elements.cardFrontText.textContent = "No cards found";
    elements.cardFrontMeta.textContent = "Try changing the filters.";
    elements.cardBackText.textContent = "";
    elements.cardBackMeta.textContent = "";
    elements.favoriteButton.textContent = "Favorite";
    document.querySelectorAll(".status-button").forEach((button) => {
      button.classList.remove("is-active");
    });
    return;
  }

  const progress = readEntryProgress(entry.id);
  elements.cardFrontText.textContent = entry.spanish;
  elements.cardFrontMeta.textContent = buildFrontMeta(entry, progress);
  elements.cardBackText.textContent = entry.english;
  elements.cardBackMeta.textContent = buildBackMeta(entry, progress);
  elements.favoriteButton.textContent = progress.favorite ? "Favorited" : "Favorite";

  document.querySelectorAll(".status-button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.status === progress.status);
  });
}

function renderList() {
  const entries = state.filteredEntries.slice(0, 80);
  const total = state.filteredEntries.length;
  const shown = entries.length;
  elements.resultsSummary.textContent = total
    ? `Showing ${shown} of ${total} matching cards`
    : "No matching cards";

  if (!shown) {
    elements.entryList.innerHTML = '<p class="empty-state">No cards match the current filters.</p>';
    return;
  }

  const fragment = document.createDocumentFragment();
  entries.forEach((entry) => {
    const progress = readEntryProgress(entry.id);
    const node = elements.entryTemplate.content.firstElementChild.cloneNode(true);

    node.querySelector(".entry-type").textContent = entryLabel(entry);
    node.querySelector(".entry-spanish").textContent = entry.spanish;
    node.querySelector(".entry-english").textContent = entry.english;

    const favoriteButton = node.querySelector(".mini-favorite");
    favoriteButton.textContent = progress.favorite ? "Starred" : "Star";
    favoriteButton.addEventListener("click", () => {
      toggleFavorite(entry.id);
      refreshAfterProgressChange();
    });

    const meta = buildListMetaBits(entry, progress);
    node.querySelector(".entry-meta").textContent = meta.join(" • ");

    const pills = node.querySelector(".status-pill-row");
    pills.appendChild(makePill(progress.status, progress.status));
    if (isDueProgress(progress)) {
      pills.appendChild(makePill("due", "due"));
    }
    if (isWeakProgress(progress)) {
      pills.appendChild(makePill("weak", "weak"));
    }
    if (progress.favorite) {
      pills.appendChild(makePill("favorite", "favorite"));
    }

    node.addEventListener("click", (event) => {
      if (event.target.closest("button")) {
        return;
      }
      const position = state.filteredEntries.findIndex((item) => item.id === entry.id);
      if (position >= 0) {
        state.currentIndex = position;
        renderFlashcard();
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    });

    fragment.appendChild(node);
  });

  elements.entryList.innerHTML = "";
  elements.entryList.appendChild(fragment);
}

function renderProgress() {
  const counts = computeReviewCounts(state.entries);
  const accuracy = counts.quizSeen ? `${Math.round((counts.quizCorrect / counts.quizSeen) * 100)}%` : "0%";
  const cards = [
    ["Total cards", counts.total],
    ["Due today", counts.due],
    ["Weak cards", counts.weak],
    ["Known", counts.known],
    ["Learning", counts.learning],
    ["Quiz accuracy", accuracy],
  ];

  elements.progressGrid.innerHTML = cards
    .map(
      ([label, value]) => `
        <article class="progress-item">
          <strong>${value}</strong>
          <span>${label}</span>
        </article>
      `
    )
    .join("");

  elements.reviewSummary.textContent =
    `${counts.reviewed} reviewed, ${counts.favorite} favorited. ` +
    `${counts.quizSeen} quiz attempts with ${accuracy} accuracy. ` +
    `${counts.due} cards ready today and ${counts.weak} weak cards resurfacing.`;
}

function ensureQuizQuestion(forceNew = false) {
  const pool = getQuizPool();
  if (!pool.length) {
    state.quiz.current = null;
    renderQuiz();
    return;
  }

  const stillValid =
    !forceNew &&
    state.quiz.current &&
    pool.some((entry) => entry.id === state.quiz.current.entry.id);

  if (stillValid) {
    renderQuiz();
    return;
  }

  state.quiz.current = buildQuizQuestion(pool);
  renderQuiz();
}

function renderQuiz() {
  const question = state.quiz.current;
  if (!question) {
    elements.quizPrompt.textContent = "No quiz cards available";
    elements.quizMeta.textContent = "Switch the quiz source or review more cards.";
    elements.quizOptions.innerHTML = "";
    elements.quizFeedback.textContent = "";
    elements.quizFeedback.className = "quiz-feedback";
    return;
  }

  elements.quizPrompt.textContent = question.prompt;
  elements.quizMeta.textContent =
    `${quizScopeLabel(state.quiz.scope)} • ${quizDirectionLabel(state.quiz.direction)} • ` +
    `Score ${state.quiz.correct}/${state.quiz.total}`;

  const fragment = document.createDocumentFragment();
  question.options.forEach((option) => {
    const button = document.createElement("button");
    button.className = "quiz-option";
    button.type = "button";
    button.textContent = option.label;

    if (question.answered) {
      button.disabled = true;
      if (option.correct) {
        button.classList.add("is-correct");
      } else if (option.label === question.selectedLabel) {
        button.classList.add("is-wrong");
      }
    } else {
      button.addEventListener("click", () => answerQuiz(option.label));
    }

    fragment.appendChild(button);
  });

  elements.quizOptions.innerHTML = "";
  elements.quizOptions.appendChild(fragment);
  elements.quizFeedback.textContent = question.feedback || "";
  elements.quizFeedback.className = `quiz-feedback ${question.feedbackClass || ""}`.trim();
}

function answerQuiz(selectedLabel) {
  const question = state.quiz.current;
  if (!question || question.answered) {
    return;
  }

  const selected = question.options.find((option) => option.label === selectedLabel);
  if (!selected) {
    return;
  }

  const wasCorrect = selected.correct;
  const schedule = applyReviewOutcome(question.entry.id, wasCorrect);
  question.answered = true;
  question.selectedLabel = selectedLabel;
  state.quiz.total += 1;

  if (wasCorrect) {
    state.quiz.correct += 1;
    question.feedback = `Correct. Next review ${schedule.label}.`;
    question.feedbackClass = "is-correct";
  } else {
    question.feedback =
      `Not quite. Correct answer: ${question.correctLabel}. Back ${schedule.label}.`;
    question.feedbackClass = "is-wrong";
  }

  applyFilters(false, { syncQuiz: false });
}

function buildQuizQuestion(pool) {
  const entry = pickRandomEntry(pool, state.quiz.current?.entry?.id || null);
  const direction = state.quiz.direction;
  const prompt = direction === "es-en" ? entry.spanish : entry.english;
  const correctLabel = direction === "es-en" ? entry.english : entry.spanish;
  const distractors = buildDistractors(entry, direction, correctLabel);
  const options = shuffleArray([
    { label: correctLabel, correct: true },
    ...distractors.map((label) => ({ label, correct: false })),
  ]).slice(0, 4);

  return {
    entry,
    prompt,
    correctLabel,
    options,
    answered: false,
    selectedLabel: null,
    feedback: "",
    feedbackClass: "",
  };
}

function buildDistractors(entry, direction, correctLabel) {
  const targetValue = direction === "es-en" ? "english" : "spanish";
  const pool = state.entries.filter((candidate) => {
    if (candidate.id === entry.id || candidate.type !== entry.type) {
      return false;
    }

    if (entry.type === "word" && candidate.band !== entry.band) {
      return false;
    }

    return candidate[targetValue] && candidate[targetValue] !== correctLabel;
  });

  const labels = [];
  const seen = new Set([correctLabel]);
  shuffleArray(pool.slice()).some((candidate) => {
    const label = candidate[targetValue];
    if (!seen.has(label)) {
      seen.add(label);
      labels.push(label);
    }
    return labels.length === 3;
  });

  if (labels.length < 3) {
    shuffleArray(state.entries.slice()).some((candidate) => {
      const label = candidate[targetValue];
      if (
        candidate.id !== entry.id &&
        label &&
        !seen.has(label)
      ) {
        seen.add(label);
        labels.push(label);
      }
      return labels.length === 3;
    });
  }

  return labels;
}

function getQuizPool() {
  if (state.quiz.scope === "filtered") {
    return state.filteredEntries.length ? state.filteredEntries : state.entries;
  }

  if (state.quiz.scope === "weak") {
    return selectWeakEntries(state.entries);
  }

  if (state.quiz.scope === "due") {
    return selectDueEntries(state.entries);
  }

  return state.entries;
}

function nextCard() {
  if (!state.filteredEntries.length) {
    return;
  }

  state.currentIndex = (state.currentIndex + 1) % state.filteredEntries.length;
  renderFlashcard();
}

function currentEntry() {
  return state.filteredEntries[state.currentIndex] || null;
}

function shuffleFilteredEntries() {
  state.filteredEntries = shuffleArray(state.filteredEntries.slice());
}

function flattenCollections(collections) {
  return Object.entries(collections).flatMap(([collection, entries]) =>
    entries.map((entry) => ({
      ...entry,
      collection,
    }))
  );
}

function sortEntries(entries) {
  return entries.sort((left, right) => {
    const leftRank = left.rank ?? Number.MAX_SAFE_INTEGER;
    const rightRank = right.rank ?? Number.MAX_SAFE_INTEGER;
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }

    const leftCollectionOrder = COLLECTION_ORDER[left.collection] ?? Number.MAX_SAFE_INTEGER;
    const rightCollectionOrder = COLLECTION_ORDER[right.collection] ?? Number.MAX_SAFE_INTEGER;
    if (leftCollectionOrder !== rightCollectionOrder) {
      return leftCollectionOrder - rightCollectionOrder;
    }

    const leftSortOrder = left.sortOrder ?? Number.MAX_SAFE_INTEGER;
    const rightSortOrder = right.sortOrder ?? Number.MAX_SAFE_INTEGER;
    if (leftSortOrder !== rightSortOrder) {
      return leftSortOrder - rightSortOrder;
    }

    return left.spanish.localeCompare(right.spanish);
  });
}

function computeReviewCounts(entries) {
  const counts = {
    total: entries.length,
    new: 0,
    learning: 0,
    known: 0,
    favorite: 0,
    due: selectDueEntries(entries).length,
    weak: selectWeakEntries(entries).length,
    reviewed: 0,
    quizSeen: 0,
    quizCorrect: 0,
  };

  entries.forEach((entry) => {
    const progress = readEntryProgress(entry.id);
    counts[progress.status] += 1;
    counts.reviewed += progress.reviewCount;
    counts.quizSeen += progress.quizSeen;
    counts.quizCorrect += progress.quizCorrect;
    if (progress.favorite) {
      counts.favorite += 1;
    }
  });

  return counts;
}

function selectDueEntries(entries) {
  const target = getDailyTarget();
  const sorted = sortEntries(entries.slice());
  const seen = new Set();

  const overdue = sorted.filter((entry) => {
    const progress = readEntryProgress(entry.id);
    return progress.reviewCount > 0 && isDueProgress(progress);
  });

  const weak = sorted.filter((entry) => {
    if (seen.has(entry.id)) {
      return false;
    }
    const progress = readEntryProgress(entry.id);
    return isWeakProgress(progress);
  });

  const fresh = sorted.filter((entry) => {
    const progress = readEntryProgress(entry.id);
    return progress.status === "new" && progress.reviewCount === 0;
  }).slice(0, target);

  return dedupeEntries([...overdue, ...weak.slice(0, target), ...fresh], seen);
}

function selectWeakEntries(entries) {
  return sortEntries(entries.slice()).filter((entry) => isWeakProgress(readEntryProgress(entry.id)));
}

function dedupeEntries(entries, existingSeen = new Set()) {
  const unique = [];
  entries.forEach((entry) => {
    if (existingSeen.has(entry.id)) {
      return;
    }
    existingSeen.add(entry.id);
    unique.push(entry);
  });
  return unique;
}

function isDueProgress(progress) {
  if (progress.status === "learning" && !progress.dueAt) {
    return true;
  }

  if (!progress.dueAt) {
    return false;
  }

  const dueMs = Date.parse(progress.dueAt);
  return !Number.isNaN(dueMs) && dueMs <= Date.now();
}

function isWeakProgress(progress) {
  return (
    progress.status === "learning" ||
    progress.lastOutcome === "incorrect" ||
    progress.wrongCount > Math.max(1, progress.quizCorrect) ||
    progress.ease < 2.1
  );
}

function getDailyTarget() {
  const raw = state.data?.meta?.dashboardStats?.["Words/day target"];
  const target = Number(raw);
  return Number.isFinite(target) && target > 0 ? target : 25;
}

async function loadPersistedState() {
  const database = await openAppDatabase();
  const progressRecords = [
    readLocalStorageRecord(LOCAL_STORAGE_PROGRESS_KEY, "localStorage", true),
    readLocalStorageRecord(LEGACY_STORAGE_KEY, "legacyLocalStorage", false),
    await readDatabaseRecord(DATABASE_KEYS.progress, Boolean(database)),
  ];
  const preferencesRecords = [
    readLocalStorageRecord(LOCAL_STORAGE_PREFERENCES_KEY, "localStorage", true),
    await readDatabaseRecord(DATABASE_KEYS.preferences, Boolean(database)),
  ];
  const progressResolution = resolvePersistedKind(DATABASE_KEYS.progress, progressRecords);
  const preferencesResolution = resolvePersistedKind(DATABASE_KEYS.preferences, preferencesRecords);

  await repairPersistedKind(
    DATABASE_KEYS.progress,
    progressResolution,
    Boolean(database),
    LOCAL_STORAGE_PROGRESS_KEY
  );
  await repairPersistedKind(
    DATABASE_KEYS.preferences,
    preferencesResolution,
    Boolean(database),
    LOCAL_STORAGE_PREFERENCES_KEY
  );

  return {
    progress: progressResolution.value,
    preferences: preferencesResolution.value,
  };
}

function readLocalStorageRecord(storageKey, source, requiredStore) {
  const raw = localStorage.getItem(storageKey);
  if (raw == null) {
    return {
      source,
      storageKey,
      requiredStore,
      exists: false,
      raw: null,
      invalid: false,
    };
  }

  try {
    return {
      source,
      storageKey,
      requiredStore,
      exists: true,
      raw: JSON.parse(raw),
      invalid: false,
    };
  } catch (error) {
    return {
      source,
      storageKey,
      requiredStore,
      exists: true,
      raw: null,
      invalid: true,
    };
  }
}

async function readDatabaseRecord(key, databaseAvailable) {
  if (!databaseAvailable) {
    return {
      source: "indexedDB",
      storageKey: null,
      requiredStore: true,
      exists: false,
      raw: null,
      invalid: false,
    };
  }

  try {
    const raw = await readDatabaseValue(key);
    return {
      source: "indexedDB",
      storageKey: null,
      requiredStore: true,
      exists: raw != null,
      raw,
      invalid: false,
    };
  } catch (error) {
    console.error(`Failed to read ${key} from IndexedDB.`, error);
    return {
      source: "indexedDB",
      storageKey: null,
      requiredStore: true,
      exists: true,
      raw: null,
      invalid: true,
    };
  }
}

function resolvePersistedKind(kind, records) {
  const normalizedRecords = records.map((record) => normalizePersistedRecord(kind, record));
  const validRecords = normalizedRecords.filter((record) => record.valid);

  if (!validRecords.length) {
    return {
      value: defaultPersistedValue(kind),
      envelope: null,
      shouldRepair: false,
    };
  }

  const winner = validRecords.slice().sort(comparePersistedRecords)[0];
  const envelope = winner.isEnvelope
    ? winner.envelope
    : buildPersistenceEnvelope(kind, winner.value);
  const shouldRepair = normalizedRecords.some((record) => shouldRepairPersistedRecord(record, envelope));

  return {
    value: winner.value,
    envelope,
    shouldRepair,
  };
}

function normalizePersistedRecord(kind, record) {
  if (!record.exists) {
    return {
      ...record,
      valid: false,
      isEnvelope: false,
      envelope: null,
      value: null,
      score: -1,
      updatedAtMs: null,
    };
  }

  if (record.invalid) {
    return {
      ...record,
      valid: false,
      isEnvelope: false,
      envelope: null,
      value: null,
      score: -1,
      updatedAtMs: null,
    };
  }

  const envelope = extractPersistenceEnvelope(kind, record.raw);
  if (envelope) {
    return {
      ...record,
      valid: true,
      isEnvelope: true,
      envelope,
      value: envelope.value,
      score: persistedValueScore(kind, envelope.value),
      updatedAtMs: Date.parse(envelope.updatedAt),
    };
  }

  const legacyValue = extractLegacyPersistedValue(kind, record.raw);
  if (legacyValue == null) {
    return {
      ...record,
      valid: false,
      isEnvelope: false,
      envelope: null,
      value: null,
      score: -1,
      updatedAtMs: null,
    };
  }

  return {
    ...record,
    valid: true,
    isEnvelope: false,
    envelope: null,
    value: legacyValue,
    score: persistedValueScore(kind, legacyValue),
    updatedAtMs: null,
  };
}

async function repairPersistedKind(kind, resolution, databaseAvailable, localStorageKey) {
  if (!resolution.shouldRepair || !resolution.envelope) {
    return;
  }

  if (!databaseAvailable) {
    writeLocalStorageMirror(localStorageKey, resolution.envelope, kind);
    return;
  }

  try {
    await persistValue(kind, resolution.envelope, localStorageKey);
  } catch (error) {
    console.error(`Failed to repair ${kind} persistence stores.`, error);
    writeLocalStorageMirror(localStorageKey, resolution.envelope, kind);
  }
}

function normalizePersistedPreferences(raw) {
  const defaults = {
    ui: defaultUiState(),
    quiz: {
      scope: defaultQuizState().scope,
      direction: defaultQuizState().direction,
    },
    audio: defaultAudioState(),
  };

  const ui = raw?.ui || {};
  const quiz = raw?.quiz || {};
  const audio = raw?.audio || {};
  const audioRate = clamp(safeNumber(audio.rate, defaults.audio.rate), AUDIO_RATE_MIN, AUDIO_RATE_MAX);
  const hasLegacyAudioDefaults =
    safeNumber(audio.version, 0) < AUDIO_PREFERENCES_VERSION &&
    (audio.voiceURI == null || audio.voiceURI === "auto") &&
    Math.abs(audioRate - LEGACY_AUDIO_DEFAULT_RATE) < 0.001;

  return {
    ui: {
      deck: allowedValue(ui.deck, ["all", "mainWords", "coffeePhrases", "conversationVerbs", "guatemalaBonus"], defaults.ui.deck),
      session: allowedValue(ui.session, ["all", "due", "weak"], defaults.ui.session),
      statusFilter: allowedValue(ui.statusFilter, ["all", "new", "learning", "known", "favorite"], defaults.ui.statusFilter),
      band: allowedValue(ui.band, ["all", "1K", "2K", "3K"], defaults.ui.band),
      type: allowedValue(ui.type, ["all", "word", "phrase", "bonus"], defaults.ui.type),
      search: "",
    },
    quiz: {
      scope: allowedValue(quiz.scope, ["due", "weak", "filtered", "all"], defaults.quiz.scope),
      direction: allowedValue(quiz.direction, ["es-en", "en-es"], defaults.quiz.direction),
    },
    audio: {
      version: AUDIO_PREFERENCES_VERSION,
      voiceURI: typeof audio.voiceURI === "string" && audio.voiceURI ? audio.voiceURI : defaults.audio.voiceURI,
      rate: hasLegacyAudioDefaults ? defaults.audio.rate : audioRate,
    },
  };
}

function defaultPersistedValue(kind) {
  if (kind === DATABASE_KEYS.progress) {
    return {};
  }

  return normalizePersistedPreferences({});
}

function buildPersistenceEnvelope(kind, value, updatedAt = new Date().toISOString()) {
  const normalizedUpdatedAt = normalizeDate(updatedAt) || new Date().toISOString();
  return {
    schemaVersion: PERSISTENCE_SCHEMA_VERSION,
    kind,
    updatedAt: normalizedUpdatedAt,
    value,
  };
}

function extractPersistenceEnvelope(kind, raw) {
  if (
    !isPlainObject(raw) ||
    raw.schemaVersion !== PERSISTENCE_SCHEMA_VERSION ||
    raw.kind !== kind ||
    !("value" in raw)
  ) {
    return null;
  }

  const updatedAt = normalizeDate(raw.updatedAt);
  if (!updatedAt) {
    return null;
  }

  const value = normalizePersistenceValue(kind, raw.value);
  if (value == null) {
    return null;
  }

  return buildPersistenceEnvelope(kind, value, updatedAt);
}

function extractLegacyPersistedValue(kind, raw) {
  const payload = extractLegacyPersistencePayload(kind, raw);
  if (payload == null) {
    return null;
  }

  return normalizePersistenceValue(kind, payload);
}

function extractLegacyPersistencePayload(kind, raw) {
  if (!isPlainObject(raw)) {
    return null;
  }

  if (
    "schemaVersion" in raw &&
    "kind" in raw &&
    "updatedAt" in raw &&
    "value" in raw
  ) {
    return null;
  }

  if (kind === DATABASE_KEYS.progress) {
    const payload = isPlainObject(raw.progress) ? raw.progress : raw;
    if (!Object.keys(payload).length) {
      return {};
    }

    return Object.values(payload).some((value) => isPlainObject(value)) ? payload : null;
  }

  const payload = isPlainObject(raw.preferences) ? raw.preferences : raw;
  if (!Object.keys(payload).length) {
    return {};
  }

  return ["ui", "quiz", "audio"].some((key) => key in payload) ? payload : null;
}

function normalizePersistenceValue(kind, raw) {
  if (kind === DATABASE_KEYS.progress) {
    return normalizeProgressMap(raw);
  }

  if (kind === DATABASE_KEYS.preferences) {
    return normalizePersistedPreferences(raw);
  }

  return null;
}

function persistedValueScore(kind, value) {
  if (kind === DATABASE_KEYS.progress) {
    return Object.values(value).reduce(
      (score, progress) => score + (isMeaningfulProgress(progress) ? 1 : 0),
      0
    );
  }

  const defaults = normalizePersistedPreferences({});
  let score = 0;
  if (!serializedValueEquals(value.ui, defaults.ui)) score += 1;
  if (!serializedValueEquals(value.quiz, defaults.quiz)) score += 1;
  if (!serializedValueEquals(value.audio, defaults.audio)) score += 1;
  return score;
}

function isMeaningfulProgress(progress) {
  return (
    progress.favorite ||
    progress.status !== "new" ||
    progress.reviewCount > 0 ||
    progress.quizSeen > 0 ||
    progress.quizCorrect > 0 ||
    progress.correctStreak > 0 ||
    progress.wrongCount > 0 ||
    progress.intervalDays > 0 ||
    progress.dueAt != null ||
    progress.lastReviewedAt != null ||
    progress.lastOutcome != null
  );
}

function comparePersistedRecords(left, right) {
  const leftHasTimestamp = Number.isFinite(left.updatedAtMs);
  const rightHasTimestamp = Number.isFinite(right.updatedAtMs);

  if (leftHasTimestamp && rightHasTimestamp && left.updatedAtMs !== right.updatedAtMs) {
    return right.updatedAtMs - left.updatedAtMs;
  }

  if (leftHasTimestamp !== rightHasTimestamp) {
    return leftHasTimestamp ? -1 : 1;
  }

  if (left.score !== right.score) {
    return right.score - left.score;
  }

  return persistedSourcePriority(right.source) - persistedSourcePriority(left.source);
}

function shouldRepairPersistedRecord(record, resolvedEnvelope) {
  if (!record.requiredStore) {
    return false;
  }

  if (!record.exists || !record.valid || !record.isEnvelope || !record.envelope) {
    return true;
  }

  return !serializedValueEquals(record.envelope, resolvedEnvelope);
}

function persistedSourcePriority(source) {
  if (source === "localStorage") {
    return 3;
  }

  if (source === "legacyLocalStorage") {
    return 2;
  }

  return 1;
}

function buildPersistedPreferences() {
  return normalizePersistedPreferences({
    ui: state.ui,
    quiz: {
      scope: state.quiz.scope,
      direction: state.quiz.direction,
    },
    audio: {
      version: AUDIO_PREFERENCES_VERSION,
      voiceURI: state.audio.voiceURI,
      rate: state.audio.rate,
    },
  });
}

function queueProgressSave() {
  pendingProgressEnvelope = buildPersistenceEnvelope(DATABASE_KEYS.progress, state.progress);
  writeLocalStorageMirror(
    LOCAL_STORAGE_PROGRESS_KEY,
    pendingProgressEnvelope,
    DATABASE_KEYS.progress
  );

  if (progressSaveTimer) {
    clearTimeout(progressSaveTimer);
  }

  progressSaveTimer = window.setTimeout(() => {
    progressSaveTimer = null;
    const envelope = pendingProgressEnvelope;
    pendingProgressEnvelope = null;
    if (envelope) {
      void persistValue(DATABASE_KEYS.progress, envelope, LOCAL_STORAGE_PROGRESS_KEY);
    }
  }, 0);
}

function queuePreferencesSave() {
  pendingPreferencesEnvelope = buildPersistenceEnvelope(
    DATABASE_KEYS.preferences,
    buildPersistedPreferences()
  );
  writeLocalStorageMirror(
    LOCAL_STORAGE_PREFERENCES_KEY,
    pendingPreferencesEnvelope,
    DATABASE_KEYS.preferences
  );

  if (preferencesSaveTimer) {
    clearTimeout(preferencesSaveTimer);
  }

  preferencesSaveTimer = window.setTimeout(() => {
    preferencesSaveTimer = null;
    const envelope = pendingPreferencesEnvelope;
    pendingPreferencesEnvelope = null;
    if (envelope) {
      void persistValue(
        DATABASE_KEYS.preferences,
        envelope,
        LOCAL_STORAGE_PREFERENCES_KEY
      );
    }
  }, 0);
}

function flushPendingPersistence() {
  if (progressSaveTimer) {
    clearTimeout(progressSaveTimer);
    progressSaveTimer = null;
  }
  const progressEnvelope = pendingProgressEnvelope;
  pendingProgressEnvelope = null;
  if (progressEnvelope) {
    void persistValue(DATABASE_KEYS.progress, progressEnvelope, LOCAL_STORAGE_PROGRESS_KEY);
  }

  if (preferencesSaveTimer) {
    clearTimeout(preferencesSaveTimer);
    preferencesSaveTimer = null;
  }
  const preferencesEnvelope = pendingPreferencesEnvelope;
  pendingPreferencesEnvelope = null;
  if (preferencesEnvelope) {
    void persistValue(
      DATABASE_KEYS.preferences,
      preferencesEnvelope,
      LOCAL_STORAGE_PREFERENCES_KEY
    );
  }
}

async function openAppDatabase() {
  if (!("indexedDB" in window)) {
    return null;
  }

  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(DATABASE_STORE)) {
          database.createObjectStore(DATABASE_STORE, { keyPath: "key" });
        }
      };

      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => database.close();
        resolve(database);
      };

      request.onerror = () => reject(request.error);
    }).catch((error) => {
      console.error("Failed to open IndexedDB.", error);
      databasePromise = null;
      return null;
    });
  }

  return databasePromise;
}

async function readDatabaseValue(key) {
  const database = await openAppDatabase();
  if (!database) {
    return null;
  }

  const transaction = database.transaction(DATABASE_STORE, "readonly");
  const request = transaction.objectStore(DATABASE_STORE).get(key);
  const record = await requestToPromise(request);
  await transactionToPromise(transaction);
  return record?.value ?? null;
}

async function persistValue(key, value, mirrorLocalStorageKey = null) {
  if (mirrorLocalStorageKey) {
    writeLocalStorageMirror(mirrorLocalStorageKey, value, key);
  }

  const database = await openAppDatabase();
  if (!database) {
    return;
  }

  const transaction = database.transaction(DATABASE_STORE, "readwrite");
  transaction.objectStore(DATABASE_STORE).put({ key, value });
  await transactionToPromise(transaction);
}

function writeLocalStorageMirror(storageKey, value, label = storageKey) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(value));
  } catch (error) {
    console.error(`Failed to mirror ${label} to localStorage.`, error);
  }
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionToPromise(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function saveProgress() {
  queueProgressSave();
}

function defaultProgress() {
  return {
    status: "new",
    favorite: false,
    reviewCount: 0,
    quizSeen: 0,
    quizCorrect: 0,
    correctStreak: 0,
    wrongCount: 0,
    intervalDays: 0,
    ease: 2.3,
    dueAt: null,
    lastReviewedAt: null,
    lastOutcome: null,
  };
}

function normalizeProgressMap(rawMap) {
  if (!rawMap || typeof rawMap !== "object" || Array.isArray(rawMap)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(rawMap).flatMap(([entryId, progress]) => {
      if (!progress || typeof progress !== "object") {
        return [];
      }
      return [[entryId, normalizeProgressEntry(progress)]];
    })
  );
}

function normalizeProgressEntry(progress) {
  const defaults = defaultProgress();
  const status = ["new", "learning", "known"].includes(progress.status)
    ? progress.status
    : "new";

  const normalized = {
    ...defaults,
    ...progress,
    status,
    favorite: Boolean(progress.favorite),
    reviewCount: safeNumber(progress.reviewCount, progress.quizSeen || 0),
    quizSeen: safeNumber(progress.quizSeen),
    quizCorrect: safeNumber(progress.quizCorrect),
    correctStreak: safeNumber(progress.correctStreak),
    wrongCount: safeNumber(progress.wrongCount),
    intervalDays: safeNumber(progress.intervalDays),
    ease: clamp(safeNumber(progress.ease, defaults.ease), 1.4, 3.2),
    dueAt: normalizeDate(progress.dueAt),
    lastReviewedAt: normalizeDate(progress.lastReviewedAt),
    lastOutcome: ["correct", "incorrect"].includes(progress.lastOutcome) ? progress.lastOutcome : null,
  };

  return normalized;
}

function readEntryProgress(entryId) {
  return normalizeProgressEntry(state.progress[entryId] || defaultProgress());
}

function updateEntryProgress(entryId, nextProgress) {
  state.progress[entryId] = normalizeProgressEntry(nextProgress);
  saveProgress();
  return state.progress[entryId];
}

function setManualStatus(entryId, status) {
  const current = readEntryProgress(entryId);
  const next = { ...current, status };

  if (status === "new") {
    next.reviewCount = 0;
    next.correctStreak = 0;
    next.intervalDays = 0;
    next.dueAt = null;
    next.lastOutcome = null;
  } else if (status === "learning") {
    next.dueAt = new Date().toISOString();
    next.intervalDays = 0;
    next.lastReviewedAt = new Date().toISOString();
  } else if (status === "known") {
    next.correctStreak = Math.max(2, current.correctStreak);
    next.intervalDays = Math.max(3, current.intervalDays || 3);
    next.dueAt = addDays(next.intervalDays);
    next.lastReviewedAt = new Date().toISOString();
  }

  updateEntryProgress(entryId, next);
}

function toggleFavorite(entryId) {
  const progress = readEntryProgress(entryId);
  updateEntryProgress(entryId, { ...progress, favorite: !progress.favorite });
}

function applyReviewOutcome(entryId, wasCorrect) {
  const current = readEntryProgress(entryId);
  const now = new Date().toISOString();
  const next = {
    ...current,
    reviewCount: current.reviewCount + 1,
    quizSeen: current.quizSeen + 1,
    lastReviewedAt: now,
    lastOutcome: wasCorrect ? "correct" : "incorrect",
  };

  if (wasCorrect) {
    next.quizCorrect = current.quizCorrect + 1;
    next.correctStreak = current.correctStreak + 1;
    next.ease = clamp(current.ease + 0.12, 1.4, 3.2);
    next.intervalDays = current.intervalDays < 1
      ? 1
      : Math.max(1, Math.round(current.intervalDays * next.ease));
    next.status = next.correctStreak >= 2 || next.intervalDays >= 3 ? "known" : "learning";
    next.dueAt = addDays(next.intervalDays);
  } else {
    next.correctStreak = 0;
    next.wrongCount = current.wrongCount + 1;
    next.ease = clamp(current.ease - 0.2, 1.4, 3.2);
    next.intervalDays = SHORT_REVIEW_DAYS;
    next.status = "learning";
    next.dueAt = addDays(SHORT_REVIEW_DAYS);
  }

  const saved = updateEntryProgress(entryId, next);
  return {
    progress: saved,
    label: wasCorrect ? `in ${formatDays(saved.intervalDays)}` : `in ${formatDays(SHORT_REVIEW_DAYS)}`,
  };
}

function refreshAfterProgressChange() {
  applyFilters(false);
}

function makePill(kind, label) {
  const pill = document.createElement("span");
  pill.className = "status-pill";
  pill.dataset.status = kind;
  pill.textContent = label;
  return pill;
}

function buildFrontMeta(entry, progress) {
  const bits = [];

  if (entry.type === "word") {
    bits.push(entry.band, entry.partOfSpeech);
  } else if (entry.type === "phrase") {
    bits.push(collectionLabel(entry.collection), entry.focus, entry.context);
  } else {
    bits.push("Guatemala note");
  }

  bits.push(formatDueSummary(progress));
  return bits.filter(Boolean).join(" • ");
}

function buildBackMeta(entry, progress) {
  const bits = [];

  if (entry.type === "word") {
    bits.push(entry.commonForms, phrasebankSummary(entry));
  } else if (entry.type === "phrase") {
    if (entry.focus) {
      bits.push(`Focus: ${entry.focus}`);
    }
    if (entry.context) {
      bits.push(`Use: ${entry.context}`);
    }
    if (entry.note) {
      bits.push(entry.note);
    }
  } else {
    bits.push(entry.note);
  }

  bits.push(reviewScoreSummary(progress));
  return bits.filter(Boolean).join(" • ");
}

function buildListMetaBits(entry, progress) {
  const bits = [];

  if (entry.type === "word") {
    bits.push(`Rank ${entry.rank}`, entry.band, entry.partOfSpeech, phrasebankSummary(entry));
  } else if (entry.type === "phrase") {
    bits.push(collectionLabel(entry.collection));
    if (entry.focus) {
      bits.push(`Focus: ${entry.focus}`);
    }
    if (entry.context) {
      bits.push(`Use: ${entry.context}`);
    }
  } else {
    bits.push("Guatemala note", entry.note);
  }

  bits.push(formatDueSummary(progress));
  return bits.filter(Boolean);
}

function reviewScoreSummary(progress) {
  if (!progress.quizSeen) {
    return "No quiz history yet";
  }

  return `Quiz ${progress.quizCorrect}/${progress.quizSeen}`;
}

function formatDueSummary(progress) {
  if (progress.status === "new" && progress.reviewCount === 0) {
    return "Fresh card";
  }

  if (!progress.dueAt) {
    return progress.status === "known" ? "Scheduled later" : "Ready now";
  }

  const dueMs = Date.parse(progress.dueAt);
  if (Number.isNaN(dueMs)) {
    return "";
  }

  if (dueMs <= Date.now()) {
    return "Due now";
  }

  return `Due ${formatDistance(dueMs - Date.now())}`;
}

function formatDistance(deltaMs) {
  const hours = Math.round(deltaMs / (60 * 60 * 1000));
  if (hours < 24) {
    return `in ${hours}h`;
  }

  return `in ${Math.round(hours / 24)}d`;
}

function entryLabel(entry) {
  if (entry.type === "word") {
    return entry.band || "Word";
  }
  if (entry.type === "phrase") {
    return collectionLabel(entry.collection);
  }
  return "Guatemala note";
}

function collectionLabel(collection) {
  return {
    mainWords: "Main word",
    coffeePhrases: "Coffee phrase",
    conversationVerbs: "Conversation verb",
    guatemalaBonus: "Guatemala bonus",
  }[collection] || "Study card";
}

function phrasebankSummary(entry) {
  if (!entry.miniPhrase) {
    return "";
  }

  const english = entry.miniPhraseEnglish ? ` -> ${entry.miniPhraseEnglish}` : "";
  const pattern = entry.phrasePattern ? ` (${entry.phrasePattern})` : "";
  return `Phrase: ${entry.miniPhrase}${english}${pattern}`;
}

function quizScopeLabel(scope) {
  return {
    due: "Due today",
    weak: "Weak spots",
    filtered: "Current filter",
    all: "All cards",
  }[scope];
}

function quizDirectionLabel(direction) {
  return direction === "es-en" ? "Spanish to English" : "English to Spanish";
}

function allowedValue(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function serializedValueEquals(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function formatSpeechRate(rate) {
  return `${rate.toFixed(2)}x`;
}

function normalizeSpeechText(text) {
  return String(text)
    .replace(/\[word\]/gi, "palabra")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatVoiceLabel(voice) {
  if (!voice) {
    return "Browser default Spanish voice";
  }

  return `${voice.name} (${voice.lang})`;
}

function getActiveSpeechVoice() {
  if (!state.speechVoices.length) {
    return null;
  }

  if (state.audio.voiceURI !== "auto") {
    return state.speechVoices.find((voice) => voice.voiceURI === state.audio.voiceURI) || state.speechVoices[0];
  }

  return state.speechVoices[0];
}

function rankSpanishVoices(voices) {
  return voices
    .filter((voice) => typeof voice.lang === "string" && voice.lang.toLowerCase().startsWith("es"))
    .slice()
    .sort((left, right) => scoreVoice(right) - scoreVoice(left));
}

function scoreVoice(voice) {
  const lang = (voice.lang || "").toLowerCase();
  const name = (voice.name || "").toLowerCase();
  let score = 0;

  if (lang === "es-gt") score += 140;
  else if (lang === "es-mx") score += 130;
  else if (lang === "es-us") score += 120;
  else if (lang === "es-419") score += 115;
  else if (lang.startsWith("es-")) score += 100;
  else if (lang === "es") score += 90;

  if (name.includes("siri")) score += 50;
  if (name.includes("premium")) score += 35;
  if (name.includes("enhanced")) score += 30;
  if (name.includes("natural")) score += 25;
  if (name.includes("neural")) score += 25;
  if (name.includes("high quality")) score += 20;
  if (voice.localService) score += 5;

  return score;
}

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeDate(value) {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return null;
  }

  return new Date(timestamp).toISOString();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function addDays(days) {
  return new Date(Date.now() + days * DAY_MS).toISOString();
}

function formatDays(days) {
  if (days < 1) {
    return `${Math.round(days * 24)} hours`;
  }
  if (days < 7) {
    return `${Math.round(days)} day${Math.round(days) === 1 ? "" : "s"}`;
  }
  const weeks = Math.round((days / 7) * 10) / 10;
  return `${weeks} week${weeks === 1 ? "" : "s"}`;
}

function pickRandomEntry(entries, avoidId) {
  if (entries.length === 1) {
    return entries[0];
  }

  const shuffled = shuffleArray(entries.slice());
  return shuffled.find((entry) => entry.id !== avoidId) || shuffled[0];
}

function shuffleArray(items) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
  return items;
}

function speakEntry(entry) {
  if (!entry || !("speechSynthesis" in window)) {
    return;
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(normalizeSpeechText(entry.spanish));
  const voice = getActiveSpeechVoice();
  utterance.lang = voice?.lang || "es-GT";
  utterance.rate = state.audio.rate;
  utterance.pitch = 1;
  utterance.volume = 1;

  if (voice) {
    utterance.voice = voice;
  }

  window.speechSynthesis.speak(utterance);
}

function exportProgress() {
  const payload = {
    version: 3,
    exportedAt: new Date().toISOString(),
    progress: state.progress,
    preferences: buildPersistedPreferences(),
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);

  link.href = url;
  link.download = `guatemala-spanish-progress-${stamp}.json`;
  link.click();
  URL.revokeObjectURL(url);
  elements.importStatus.textContent = "Study data exported.";
}

async function importProgress(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const imported = normalizeProgressMap(parsed.progress || parsed);
    const importedPreferences = normalizePersistedPreferences(parsed.preferences || {});
    state.progress = imported;
    state.ui = {
      ...defaultUiState(),
      ...importedPreferences.ui,
    };
    state.quiz = {
      ...state.quiz,
      ...importedPreferences.quiz,
      current: null,
      total: 0,
      correct: 0,
    };
    state.audio = {
      ...defaultAudioState(),
      ...importedPreferences.audio,
    };
    syncControlsFromState();
    renderSpeechControls();
    saveProgress();
    queuePreferencesSave();
    elements.importStatus.textContent = `Imported ${Object.keys(imported).length} progress records.`;
    applyFilters(true);
  } catch (error) {
    elements.importStatus.textContent = "Import failed. Please choose a valid progress JSON file.";
  } finally {
    elements.importProgressInput.value = "";
  }
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    });
  }
}
