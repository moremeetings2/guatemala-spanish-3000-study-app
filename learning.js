'use strict';

// The learning shell reuses the existing catalog, progress, speech, and auth engine.
const PRACTICE_DECKS = { words: ['mainWords', 'essential200'], phrases: ['everydaySpeaking', 'everydayConversation'] };
const LEARNING_NAV = [['home', 'Home', 'home'], ['words', 'Words', 'style'], ['phrases', 'Phrases', 'forum'], ['verbs', 'Verbs', 'spellcheck'], ['library', 'Library', 'menu_book']];
// No network scripts or empty ad boxes until a provider, consent, and rights review are approved.
const MONETIZATION = Object.freeze({ enabled: false, eligibleViews: ['lesson', 'reading'] });

function practiceSnapshot(S) {
  const sessions = S.practice || {};
  if (!PRACTICE_DECKS[S.tab]) return sessions;
  const deck = S.study.source?.replace(/^deck:/, '');
  if (!PRACTICE_DECKS[S.tab].includes(deck)) return sessions;
  const cardId = S.study.order[S.study.idx % S.study.order.length] || null;
  if (sessions[S.tab]?.deck === deck && sessions[S.tab]?.cardId === cardId) return sessions;
  return { ...sessions, [S.tab]: { deck, cardId } };
}

function openPractice(lane, requestedDeck) {
  const practice = practiceSnapshot(appState);
  const previous = practice[lane];
  const decks = PRACTICE_DECKS[lane];
  const legacyDeck = appState.study.source === 'filter' ? appState.browse.deck : appState.study.source?.replace(/^deck:/, '');
  const deck = requestedDeck || (decks.includes(previous?.deck) ? previous.deck : decks.includes(legacyDeck) ? legacyDeck : decks[0]);
  if (!decks.includes(deck)) return;
  const source = 'deck:' + deck;
  const order = orderFor(source);
  const resume = previous?.deck === deck ? previous.cardId : legacyDeck === deck
    ? appState.study.order[appState.study.idx % appState.study.order.length] : null;
  setState({ tab: lane, route: null, practice, practiceMode: 'study', practiceQ: '', practiceLimit: 100,
    study: { source, order, idx: Math.max(0, order.indexOf(resume)), flipped: false, showSentence: false } });
}

function practiceMode(mode) {
  const patch = { practiceMode: mode };
  if (mode === 'quiz') patch.quiz = { ...appState.quiz, source: appState.study.source, dir: studyDirection(), phase: 'intro' };
  setState(patch);
}

function ratePractice(correct) {
  const study = appState.study;
  const id = study.order[study.idx % study.order.length];
  if (!id) return;
  grade(id, correct);
  setState({ study: { ...appState.study, idx: study.idx + 1, flipped: false, showSentence: false } });
}

function countryOptions() {
  return [{ id: 'shared', name: 'Shared Spanish', count: null }, { id: 'guatemala', name: 'Guatemala', count: filterCards({ deck: 'guatemalaLexicon' }).length }]
    .concat((appState.data.COUNTRY_LEX || []).map(c => ({ id: c.id, name: c.name, count: c.entries.length })));
}
function countryFocus() { return countryOptions().find(c => c.id === appState.settings.country) || countryOptions()[0]; }
function tutorSystem() {
  const country = countryFocus();
  return AI_SYSTEM + (country.id === 'shared' ? ' Teach widely understood Spanish; clearly label regional differences.' : ` The learner's country focus is ${country.name}. Explain regional usage when relevant without presenting it as universal.`);
}
function openCountries() { setState({ route: 'countries', countryDraft: countryFocus().id }); }
function learningHeading(kicker, title, subtitle = '') {
  return `<div class="learn-heading"><p class="learn-kicker">${esc(kicker)}</p><h1>${esc(title)}</h1>${subtitle ? `<p class="learn-subtitle">${esc(subtitle)}</p>` : ''}</div>`;
}
function learnButton(label, fn, primary = false, attrs = '') {
  return `<button type="button" class="learn-button ${primary ? 'primary' : ''}" ${h(fn)} ${attrs}>${label}</button>`;
}
function learningActive() {
  if (appState.tab === 'words' || appState.tab === 'phrases') return appState.tab;
  if (appState.tab === 'verbs') return 'verbs';
  return appState.tab === 'home' && !appState.route ? 'home' : 'library';
}
function renderLearningNav() {
  const active = learningActive();
  return `<nav class="learn-nav" aria-label="Main navigation">${LEARNING_NAV.map(([key, label, icon]) => `<button type="button" data-fid="nav-${key}" aria-label="${label}" ${h(() => goTab(key))} ${key === active ? 'aria-current="page"' : ''}>${ms(icon, 23)}<span>${label}</span></button>`).join('')}</nav>`;
}
function renderLearningHeader() {
  const focus = countryFocus();
  return `<header class="learn-header"><button class="learn-brand" ${h(() => goTab('home'))} aria-label="Hablavos home">${brandMark(30, 20)}<span>Hablavos</span></button><div class="learn-header-actions"><button class="learn-country" ${h(openCountries)} aria-label="Country focus: ${esc(focus.name)}">${ms('public', 18)}<span>${esc(focus.name)}</span>${ms('expand_more', 18)}</button><button class="learn-account" ${h(() => setState({ route: 'settings' }))} aria-label="Account and settings">${ms('account_circle', 27)}</button></div></header>`;
}
function renderLearningHome(v) {
  return `<section class="learn-page">${learningHeading('Free to learn. Free to keep going.', 'Practice, your way.', 'Words today. Phrases tomorrow. Choose what helps you speak.')}
    <div class="learn-home-grid"><div><div class="learn-practice-pair">
    <button class="learn-tile tinted" ${h(() => openPractice('words'))}>${ms('style', 30)}<h2>Words</h2><p>Build vocabulary.<br>Stay as long as you like.</p><span>Practice words ${ms('north_east', 18)}</span></button>
    <button class="learn-tile" ${h(() => openPractice('phrases'))}>${ms('forum', 30)}<h2>Phrases</h2><p>Find the words for<br>everyday conversations.</p><span>Practice phrases ${ms('north_east', 18)}</span></button></div>
    <button class="learn-verb-banner" ${h(() => goTab('verbs'))}><span><strong>Make verbs make sense.</strong><small>hablar / hablo / hablé<br>Simple explanations. Useful examples.</small></span>${ms('arrow_forward', 24)}</button>
    <p class="learn-note">No daily limit. No hearts. Review reminders guide you, not stop you.</p>
    <div class="learn-review-row">${learnButton(`Review due · ${v.home.dueCount}`, v.home.onReviewDue)}${learnButton(`Weak spots · ${v.home.weakCount}`, v.home.onReviewWeak)}</div></div>
    <aside class="learn-home-aside"><p class="learn-kicker">A phrase to take with you</p><p class="learn-quote" lang="es">Déjame ver.</p><p>Let me check. A small phrase that makes everyday conversation easier.</p>${learnButton(`${ms('volume_up', 19)} Listen`, () => speak('Déjame ver.'))}
    <hr><p class="learn-kicker">Your country focus</p><h2>${esc(countryFocus().name)}</h2><p>Keep a shared Spanish foundation. Explore local words without losing your progress.</p>${learnButton('Choose or change country', openCountries)}</aside></div>
    <div class="learn-home-footer">${learnButton('Ask anything in Spanish', () => openChat(null))}${learnButton('Your progress', () => goTab('progress'))}<span>${appState.data.CARDS.length.toLocaleString()} cards · ${appState.data.STORIES.length} stories</span></div></section>`;
}

function renderPractice(v) {
  const lane = appState.tab;
  const deck = appState.study.source.slice(5);
  const mode = appState.practiceMode || 'study';
  const toolbar = `<div class="learn-toolbar"><label>Collection<select data-fid="practice-collection" aria-label="Study collection" ${hc(e => openPractice(lane, e.target.value))}>${PRACTICE_DECKS[lane].map(id => `<option value="${id}" ${deck === id ? 'selected' : ''}>${esc(DECK_DEFS[id].name)} · ${filterCards({ deck: id }).length}</option>`).join('')}</select></label><div class="learn-segments" role="group" aria-label="Practice view">${['study', 'browse', 'quiz'].map(m => learnButton(m[0].toUpperCase() + m.slice(1), () => practiceMode(m), false, `data-fid="practice-mode-${m}" aria-pressed="${mode === m}"`)).join('')}</div></div>`;
  let body;
  if (mode === 'browse') {
    const cards = filterCards({ deck, q: appState.practiceQ });
    const limit = appState.practiceLimit || 100;
    body = `<label class="learn-search">Search this collection<input data-fid="practice-search" type="search" value="${esc(appState.practiceQ || '')}" ${hi(e => setState({ practiceQ: e.target.value, practiceLimit: 100 }))}></label><p class="learn-note">${cards.length} cards</p><div class="learn-list">${cards.slice(0, limit).map(c => `<article class="learn-list-row"><div><strong lang="es">${esc(c.es)}</strong><p>${esc(c.en)}</p></div>${learnButton('Study', () => setState({ practiceMode: 'study', study: { ...appState.study, idx: appState.study.order.indexOf(c.id), flipped: false, showSentence: false } }))}</article>`).join('') || '<p>No cards match. Try a different word.</p>'}</div>${cards.length > limit ? learnButton('Show more cards', () => setState({ practiceLimit: limit + 100 })) : ''}`;
  } else if (mode === 'quiz') {
    // A focused quiz must never silently widen to unrelated collections.
    body = renderQuiz({ ...v, quiz: { ...v.quiz, sources: [] } });
  } else {
    body = renderStudy({ ...v, study: { ...v.study, focusedPractice: true, title: '', sources: [] } });
  }
  return `<section class="learn-page learn-practice">${learningHeading('Open practice', lane === 'words' ? 'Words that stay with you.' : 'Phrases for real life.', 'Study freely, browse, or check what you know.')}<div class="learn-note learn-unlimited">No daily cap</div>${toolbar}<div class="learn-practice-body">${body}</div></section>`;
}

function renderLearningLibrary() {
  const tiles = [
    ['Read & listen', `${appState.data.STORIES.length} stories with word lookup and audio.`, 'menu_book', () => goTab('read')],
    ['Saved cards', 'Your starred cards and vocabulary saved while reading.', 'bookmark', () => setState({ route: 'saved' })],
    ['Country references', 'Explore all 21 regional collections.', 'public', openCountries],
    ['My Words', 'Your private collection. Add the words you need.', 'edit_note', () => setState({ route: 'mywords' })],
    ['AI tutor', 'Optional on-device help. First download is about 2.4 GB.', 'smart_toy', () => openChat(null)],
    ['Your progress', 'Reviews, learning history, and collection progress.', 'insights', () => goTab('progress')],
  ];
  return `<section class="learn-page">${learningHeading('Your learning library', 'More ways to make it stick.', 'Stories, saved vocabulary, and regional reference. No digging through your profile.')}${appState.study.order.length ? learnButton('Resume last study session', () => goTab('study')) : ''}<div class="learn-library-grid">${tiles.map(([title, sub, icon, fn]) => `<button class="learn-library-tile" ${h(fn)}>${ms(icon, 27)}<h2>${title}</h2><p>${sub}</p></button>`).join('')}</div><h2 class="learn-section-title">All collections</h2><div class="learn-decks">${appState.data.DECKS.map(d => learnButton(`<span>${esc(d.name)}</span><small>${filterCards({ deck: d.id }).length} cards</small>`, () => openBrowse({ deck: d.id }))).join('')}</div></section>`;
}
function savedWordKey(es) { return es.trim().toLocaleLowerCase('es'); }
function removeSavedCard(card) {
  // The library merges stars and reading vocabulary; one Remove clears both.
  const key = savedWordKey(card.es);
  const matching = filterCards({ star: true }).filter(c => savedWordKey(c.es) === key);
  const cardState = { ...appState.cardState };
  matching.forEach(c => { cardState[c.id] = { ...cs(c.id), star: false }; });
  setState({ cardState, saved: appState.saved.filter(c => savedWordKey(c.es) !== key) });
  matching.forEach(c => queueProgressSync(c.id));
}
function renderSavedCards() {
  const starred = filterCards({ star: true });
  const rows = starred.concat(appState.saved.filter(s => !starred.some(c => savedWordKey(c.es) === savedWordKey(s.es))));
  return `<section class="learn-page">${learnButton('Library', () => goTab('library'))}${learningHeading('Private practice collection', 'Your saved cards.', 'Stars and reading vocabulary, together in one place.')}<div class="learn-list">${rows.map(c => `<article class="learn-list-row"><div><strong lang="es">${esc(c.es)}</strong><p>${esc(c.en)}</p></div><div class="learn-row-actions">${learnButton('Listen', () => speak(c.es))}${learnButton('Remove', () => removeSavedCard(c))}</div></article>`).join('') || '<p>No saved cards yet. Star a study card or save a word while reading.</p>'}</div>${starred.length ? learnButton('Study starred cards', () => { setStudySource('starred'); goTab('study'); }, true) : ''}</section>`;
}
function renderCountries() {
  const options = countryOptions();
  const selected = options.find(c => c.id === appState.countryDraft) || countryFocus();
  return `<section class="learn-page">${learnButton('Library', () => goTab('library'))}${learningHeading('One app. Your country focus.', 'Where will you use your Spanish?', 'Your core words and phrases stay with you when you switch.')}<div class="learn-country-layout"><div class="learn-country-grid">${options.map(c => `<button class="learn-country-choice" data-fid="country-${c.id}" ${h(() => setState({ countryDraft: c.id }))} aria-pressed="${selected.id === c.id}">${esc(c.name)}</button>`).join('')}</div><aside class="learn-pack"><p class="learn-kicker">${selected.id === 'shared' ? 'Shared foundation' : 'Regional reference'}</p><h2>${esc(selected.name)}</h2><p>${selected.count === null ? 'Widely understood words and everyday phrases, without one country as the default.' : `${selected.count} regional entries with meanings and examples. These are references, not a complete country course.`}</p><p>Switching never resets your cards or progress.</p>${learnButton('Use this country', () => { setState({ settings: { ...appState.settings, country: selected.id }, lexCountry: selected.id === 'shared' ? 'guatemala' : selected.id, route: null, tab: 'home' }); }, true)}${selected.id !== 'shared' ? learnButton('Explore local words', () => setState({ lexCountry: selected.id, lexQ: '', route: 'lexicon', tab: 'library' })) : ''}<p class="learn-note">Regional text is included in the app's offline cache after a successful online visit. Pronunciation uses your device's Spanish voice, not country-specific recordings.</p></aside></div></section>`;
}

const VERB_PERSONS = [['yo', 'Yo'], ['tu', 'Tú'], ['usted', 'Usted']];
const VERB_TENSES = [['present', 'Now'], ['past', 'Completed past'], ['background', 'Background past'], ['future', 'Going to']];
const VERB_LESSONS = {
  hablar: { meaning: 'to speak', description: 'A regular verb: see how the ending changes.',
    forms: { present: ['hablo', 'hablas', 'habla'], past: ['hablé', 'hablaste', 'habló'], background: ['hablaba', 'hablabas', 'hablaba'], future: ['voy a hablar', 'vas a hablar', 'va a hablar'] },
    tails: { present: 'español.', past: 'con Ana ayer.', background: 'español todos los días.', future: 'con Ana mañana.' },
    english: { present: ['I speak Spanish.', 'You speak Spanish.', 'You speak Spanish.'], past: ['I spoke with Ana yesterday.', 'You spoke with Ana yesterday.', 'You spoke with Ana yesterday.'], background: ['I used to speak Spanish every day.', 'You used to speak Spanish every day.', 'You used to speak Spanish every day.'], future: ['I am going to speak with Ana tomorrow.', 'You are going to speak with Ana tomorrow.', 'You are going to speak with Ana tomorrow.'] },
    explanations: { present: 'Use the present for habits and things that are generally true. Remove -ar and add the ending for the person: yo hablo, tú hablas, usted habla.', past: 'Use the preterite for a completed event. Hablé means I spoke, not I speak. Habló is the usted form. Written accents are part of the word.', background: 'Use the imperfect for past habits or background situations. Hablaba describes what someone used to do; hablé presents a completed event.', future: 'For plans, use a form of ir + a + the base verb. In voy a hablar, voy changes with the person, but hablar stays unchanged.' } },
  poder: { meaning: 'can; to be able to', description: 'An irregular verb: puedo, pude, and podía.',
    forms: { present: ['puedo', 'puedes', 'puede'], past: ['pude', 'pudiste', 'pudo'], background: ['podía', 'podías', 'podía'], future: ['voy a poder', 'vas a poder', 'va a poder'] },
    tails: { present: 'ayudar.', past: 'ayudar ayer.', background: 'ayudar antes.', future: 'ayudar mañana.' },
    english: { present: ['I can help.', 'You can help.', 'You can help.'], past: ['I was able to help yesterday.', 'You were able to help yesterday.', 'You were able to help yesterday.'], background: ['I could help before.', 'You could help before.', 'You could help before.'], future: ['I am going to be able to help tomorrow.', 'You are going to be able to help tomorrow.', 'You are going to be able to help tomorrow.'] },
    explanations: { present: 'Poder changes its stem from pod- to pued- in these present-tense forms. Follow it with a base verb: puedo ayudar, I can help.', past: 'Poder uses pud- in the preterite. In this positive, completed-event example, pude ayudar means I managed or was able to help. Context matters: it is not always interchangeable with podía.', background: 'Podía describes ability in a past background situation. It does not by itself say whether the person actually helped. Compare pude ayudar, which presents helping as achieved in this example.', future: 'Use ir + a + poder + a base verb to describe future ability: voy a poder ayudar. Only the form of ir changes for the person here.' } },
};
function openVerb(verb) { setState({ verbLesson: { verb, tense: 'present', person: 'yo', answer: null }, tab: 'verbs', route: 'lesson' }); }
function renderVerbs() {
  return `<section class="learn-page">${learningHeading('Verbs & tenses', 'Understand the pattern.', 'Start with what you want to say, not a wall of conjugations.')}<div class="learn-library-grid">${Object.entries(VERB_LESSONS).map(([verb, l]) => `<button class="learn-library-tile" ${h(() => openVerb(verb))} aria-label="Explore ${verb}"><p class="learn-kicker">${l.meaning}</p><h2 lang="es">${verb}</h2><p>${l.description}</p><span>Explore this verb ${ms('arrow_forward', 18)}</span></button>`).join('')}</div><div class="learn-explanation"><h2>Same verb. Different moment.</h2><p><strong>Hablo</strong> = I speak. <strong>Hablé</strong> = I spoke.</p><p>Compare now, completed events, past habits, and future plans. Choose the part you need.</p></div><p class="learn-note">Starter collection: 2 verbs, 4 useful tense patterns, and 3 people. More reviewed lessons can be added without changing your practice decks.</p></section>`;
}
function renderVerbLesson() {
  const state = appState.verbLesson || { verb: 'hablar', tense: 'present', person: 'yo' };
  const lesson = VERB_LESSONS[state.verb] || VERB_LESSONS.hablar;
  const person = Math.max(0, VERB_PERSONS.findIndex(p => p[0] === state.person));
  const form = lesson.forms[state.tense][person];
  const sentence = `${VERB_PERSONS[person][1]} ${form} ${lesson.tails[state.tense]}`;
  const patch = p => setState({ verbLesson: { ...state, ...p, answer: null } });
  const answers = VERB_TENSES.map(([t]) => lesson.forms[t][person]);
  return `<section class="learn-page learn-lesson">${learnButton('All verbs', () => goTab('verbs'))}${learningHeading(lesson.meaning, state.verb, 'One verb. A few useful ways to use it.')}<div class="learn-segments wrapping" role="group" aria-label="Tense">${VERB_TENSES.map(([key, label]) => learnButton(label, () => patch({ tense: key }), false, `data-fid="tense-${key}" aria-pressed="${state.tense === key}"`)).join('')}</div><div class="learn-segments learn-persons" role="group" aria-label="Who is speaking?">${VERB_PERSONS.map(([key, label]) => learnButton(label, () => patch({ person: key }), false, `data-fid="person-${key}" aria-pressed="${state.person === key}"`)).join('')}</div><div class="learn-explanation"><p class="learn-quote" lang="es" data-fid="verb-example">${esc(sentence)}</p><p>${esc(lesson.english[state.tense][person])}</p>${learnButton(`${ms('volume_up', 20)} Listen`, () => speak(sentence), false, 'aria-label="Listen to example"')}</div><h2>Why this form?</h2><p>${esc(lesson.explanations[state.tense])}</p><p class="learn-note">Tú is informal; usted is formal. Vos is also used in several countries, including Guatemala. These starter examples use tú; changing your country does not silently substitute a different conjugation.</p><section class="learn-check"><p class="learn-kicker">Try it in context</p><h2>${esc(lesson.english[state.tense][person])}</h2><p>Choose the verb form that fits this example.</p><div class="learn-answer-options">${answers.map(a => learnButton(esc(a), () => setState({ verbLesson: { ...state, answer: a } }), false, `lang="es"`)).join('')}</div>${state.answer ? `<p role="status" class="learn-feedback">${state.answer === form ? `That fits. ${esc(sentence)}` : `Try again. Look at the person and the time in the example.`}</p>` : ''}</section></section>`;
}

function renderLearningView(v) {
  if (appState.route === 'countries') return renderCountries();
  if (appState.route === 'lesson') return renderVerbLesson();
  if (appState.route === 'saved') return renderSavedCards();
  if (appState.route) return null;
  if (appState.tab === 'home') return renderLearningHome(v);
  if (PRACTICE_DECKS[appState.tab]) return renderPractice(v);
  if (appState.tab === 'library') return renderLearningLibrary();
  if (appState.tab === 'verbs') return renderVerbs();
  return null;
}
