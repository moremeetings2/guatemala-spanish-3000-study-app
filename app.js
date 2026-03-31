const DATA_URL = "./data/guatemala_spanish_study_pack.json";
const STORAGE_KEY = "guatemala-spanish-3000-progress-v2";
const LEGACY_STORAGE_KEY = "guatemala-spanish-3000-progress-v1";
const DAY_MS = 24 * 60 * 60 * 1000;
const SHORT_REVIEW_DAYS = 3 / 24;
const COLLECTION_ORDER = {
  mainWords: 0,
  coffeePhrases: 1,
  conversationVerbs: 2,
  guatemalaBonus: 3,
};

const state = {
  data: null,
  entries: [],
  filteredEntries: [],
  currentIndex: 0,
  progress: loadProgress(),
  quiz: {
    scope: "due",
    direction: "es-en",
    current: null,
    total: 0,
    correct: 0,
  },
  ui: {
    deck: "all",
    session: "all",
    statusFilter: "all",
    band: "all",
    type: "all",
    search: "",
  },
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
  registerServiceWorker();

  try {
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

function bindEvents() {
  elements.deckSelect.addEventListener("change", (event) => {
    state.ui.deck = event.target.value;
    applyFilters(true);
  });

  elements.sessionFilter.addEventListener("change", (event) => {
    state.ui.session = event.target.value;
    applyFilters(true);
  });

  elements.statusFilter.addEventListener("change", (event) => {
    state.ui.statusFilter = event.target.value;
    applyFilters(true);
  });

  elements.bandFilter.addEventListener("change", (event) => {
    state.ui.band = event.target.value;
    applyFilters(true);
  });

  elements.typeFilter.addEventListener("change", (event) => {
    state.ui.type = event.target.value;
    applyFilters(true);
  });

  elements.searchInput.addEventListener("input", (event) => {
    state.ui.search = event.target.value.trim().toLowerCase();
    applyFilters(true);
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
    ensureQuizQuestion(true);
  });

  elements.quizDirection.addEventListener("change", (event) => {
    state.quiz.direction = event.target.value;
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
    state.ui = {
      deck: "all",
      session: "all",
      statusFilter: "all",
      band: "all",
      type: "all",
      search: "",
    };

    elements.deckSelect.value = "all";
    elements.sessionFilter.value = "all";
    elements.statusFilter.value = "all";
    elements.bandFilter.value = "all";
    elements.typeFilter.value = "all";
    elements.searchInput.value = "";
    applyFilters(true);
  });
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

function loadProgress() {
  try {
    const raw =
      localStorage.getItem(STORAGE_KEY) ||
      localStorage.getItem(LEGACY_STORAGE_KEY);

    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw);
    const normalized = normalizeProgressMap(parsed.progress || parsed);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
  } catch (error) {
    return {};
  }
}

function saveProgress() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.progress));
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
  const utterance = new SpeechSynthesisUtterance(entry.spanish);
  utterance.lang = "es-GT";
  utterance.rate = 0.9;

  const voices = window.speechSynthesis.getVoices();
  const voice =
    voices.find((item) => item.lang === "es-GT") ||
    voices.find((item) => item.lang.startsWith("es")) ||
    null;

  if (voice) {
    utterance.voice = voice;
  }

  window.speechSynthesis.speak(utterance);
}

function exportProgress() {
  const payload = {
    version: 2,
    exportedAt: new Date().toISOString(),
    progress: state.progress,
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
  elements.importStatus.textContent = "Progress exported.";
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
    state.progress = imported;
    saveProgress();
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
