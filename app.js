const DATA_URL = "./data/guatemala_spanish_study_pack.json";
const STORAGE_KEY = "guatemala-spanish-3000-progress-v1";

const state = {
  data: null,
  entries: [],
  filteredEntries: [],
  currentIndex: 0,
  progress: loadProgress(),
  ui: {
    deck: "all",
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
  progressGrid: document.querySelector("#progress-grid"),
  favoriteButton: document.querySelector("#favorite-button"),
  nextButton: document.querySelector("#next-button"),
  shuffleButton: document.querySelector("#shuffle-button"),
  clearFiltersButton: document.querySelector("#clear-filters-button"),
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
    state.entries = flattenCollections(state.data.collections);
    state.filteredEntries = state.entries.slice();
    renderHero();
    applyFilters();
  } catch (error) {
    elements.heroDescription.textContent = "The workbook data could not be loaded.";
    elements.entryList.innerHTML = `<p class="empty-state">${error.message}</p>`;
  }
}

function bindEvents() {
  elements.deckSelect.addEventListener("change", (event) => {
    state.ui.deck = event.target.value;
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
      setStatus(entry.id, button.dataset.status);
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

  elements.clearFiltersButton.addEventListener("click", () => {
    state.ui = {
      deck: "all",
      statusFilter: "all",
      band: "all",
      type: "all",
      search: "",
    };
    elements.deckSelect.value = "all";
    elements.statusFilter.value = "all";
    elements.bandFilter.value = "all";
    elements.typeFilter.value = "all";
    elements.searchInput.value = "";
    applyFilters(true);
  });
}

function renderHero() {
  const { meta } = state.data;
  elements.heroDescription.textContent = meta.description || "Study offline on your phone.";

  const cards = [
    ["Words", meta.counts.words],
    ["Phrases", meta.counts.phrases],
    ["Guatemala notes", meta.counts.bonus],
    ["Tracked cards", meta.counts.total],
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

function applyFilters(resetIndex = false) {
  const filtered = state.entries.filter((entry) => {
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

    if (["new", "learning", "known"].includes(state.ui.statusFilter)) {
      if (progress.status !== state.ui.statusFilter) {
        return false;
      }
    }

    if (state.ui.search) {
      const haystack = [
        entry.spanish,
        entry.english,
        entry.partOfSpeech,
        entry.context,
        entry.note,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      if (!haystack.includes(state.ui.search)) {
        return false;
      }
    }

    return true;
  });

  state.filteredEntries = filtered;
  if (resetIndex || state.currentIndex >= filtered.length) {
    state.currentIndex = 0;
  }

  renderFlashcard();
  renderList();
  renderProgress();
}

function renderFlashcard() {
  elements.flashcard.classList.remove("is-flipped");
  const entry = currentEntry();

  if (!entry) {
    elements.cardFrontText.textContent = "No cards found";
    elements.cardFrontMeta.textContent = "Try changing the filters.";
    elements.cardBackText.textContent = "";
    elements.cardBackMeta.textContent = "";
    document.querySelectorAll(".status-button").forEach((button) => {
      button.classList.remove("is-active");
    });
    return;
  }

  const progress = readEntryProgress(entry.id);
  elements.cardFrontText.textContent = entry.spanish;
  elements.cardFrontMeta.textContent = buildFrontMeta(entry);
  elements.cardBackText.textContent = entry.english;
  elements.cardBackMeta.textContent = buildBackMeta(entry);
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

    const meta = [];
    if (entry.rank) meta.push(`Rank ${entry.rank}`);
    if (entry.band) meta.push(entry.band);
    if (entry.partOfSpeech) meta.push(entry.partOfSpeech);
    if (entry.context) meta.push(entry.context);
    if (entry.note) meta.push(entry.note);
    node.querySelector(".entry-meta").textContent = meta.join(" • ");

    const pills = node.querySelector(".status-pill-row");
    pills.appendChild(makePill(progress.status, progress.status));
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
  const counts = {
    total: state.entries.length,
    new: 0,
    learning: 0,
    known: 0,
    favorite: 0,
  };

  state.entries.forEach((entry) => {
    const progress = readEntryProgress(entry.id);
    counts[progress.status] += 1;
    if (progress.favorite) {
      counts.favorite += 1;
    }
  });

  const cards = [
    ["Total cards", counts.total],
    ["Known", counts.known],
    ["Learning", counts.learning],
    ["New", counts.new],
    ["Favorites", counts.favorite],
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
  for (let index = state.filteredEntries.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [state.filteredEntries[index], state.filteredEntries[swapIndex]] = [
      state.filteredEntries[swapIndex],
      state.filteredEntries[index],
    ];
  }
}

function flattenCollections(collections) {
  return Object.entries(collections).flatMap(([collection, entries]) =>
    entries.map((entry) => ({
      ...entry,
      collection,
    }))
  );
}

function loadProgress() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    return {};
  }
}

function saveProgress() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.progress));
}

function readEntryProgress(entryId) {
  return state.progress[entryId] || { status: "new", favorite: false };
}

function setStatus(entryId, status) {
  const progress = readEntryProgress(entryId);
  state.progress[entryId] = { ...progress, status };
  saveProgress();
}

function toggleFavorite(entryId) {
  const progress = readEntryProgress(entryId);
  state.progress[entryId] = { ...progress, favorite: !progress.favorite };
  saveProgress();
}

function refreshAfterProgressChange() {
  applyFilters();
}

function makePill(kind, label) {
  const pill = document.createElement("span");
  pill.className = "status-pill";
  pill.dataset.status = kind;
  pill.textContent = label;
  return pill;
}

function buildFrontMeta(entry) {
  return [entry.band, entry.partOfSpeech, entry.context].filter(Boolean).join(" • ");
}

function buildBackMeta(entry) {
  return [entry.commonForms, entry.note].filter(Boolean).join(" • ");
}

function entryLabel(entry) {
  if (entry.type === "word") {
    return entry.band || "Word";
  }
  if (entry.type === "phrase") {
    return "Coffee phrase";
  }
  return "Guatemala note";
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    });
  }
}
