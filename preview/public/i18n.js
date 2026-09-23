import {languageKey, languages, messages} from './locales.js';

const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const validLanguage = language => own(languages, language);
const placeholders = text => [...text.matchAll(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g)].map(match => match[1]);

export function validateCatalogue(catalogue = messages) {
  const errors = [];
  for (const [id, entry] of Object.entries(catalogue)) {
    if (typeof entry.en !== 'string' || !entry.en.trim()) {
      errors.push(`${id}: missing English source`);
      continue;
    }
    if (entry.mi === null) continue;
    if (typeof entry.mi !== 'string' || !entry.mi.trim()) {
      errors.push(`${id}: Māori must be non-empty text or null`);
      continue;
    }
    const names = text => [...new Set(placeholders(text))].sort().join(',');
    if (names(entry.en) !== names(entry.mi)) errors.push(`${id}: placeholders differ`);
  }
  return errors;
}

// This module does not access journey storage or reset navigation. Callers update
// their existing view when the locale changes, retaining the current task.
export function createLocalizer({storage, catalogue = messages} = {}) {
  let language = 'en';
  try {
    if (storage === undefined) storage = globalThis.localStorage;
    const saved = storage?.getItem(languageKey);
    if (validLanguage(saved)) language = saved;
  } catch { /* Storage may be blocked; in-memory language choice still works. */ }
  const listeners = new Set();
  function phrase(id, values = {}) {
    if (!own(catalogue, id)) throw new Error(`Unknown interface phrase: ${id}`);
    const entry = catalogue[id];
    const translated = language === 'mi' && typeof entry.mi === 'string' && entry.mi.trim();
    const actualLanguage = translated ? 'mi' : 'en';
    const template = translated ? entry.mi : entry.en;
    const text = template.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (_, name) => {
      if (!own(values, name) || values[name] == null) throw new Error(`Missing ${name} for ${id}`);
      return String(values[name]);
    });
    return {text, lang: languages[actualLanguage].tag,
      fallback: language !== actualLanguage, draft: actualLanguage === 'mi'};
  }
  return {
    get language() { return language; },
    get tag() { return languages[language].tag; },
    phrase,
    text: (id, values) => phrase(id, values).text,
    setLanguage(next) {
      if (!validLanguage(next)) throw new Error(`Unsupported language: ${next}`);
      const changed = next !== language;
      language = next;
      let stored = false;
      try { if (storage) { storage.setItem(languageKey, language); stored = true; } } catch {}
      if (changed) for (const listener of listeners) listener(language);
      return {language, stored};
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
}

// Use textContent for phrases: user-supplied names must never become markup.
// Each binding receives its actual language, including explicit English fallback.
export function setLocalizedText(element, localizer, id, values) {
  const phrase = localizer.phrase(id, values);
  element.textContent = phrase.text;
  element.setAttribute('lang', phrase.lang);
  return phrase;
}

// Worker errors retain their established English protocol for compatibility with
// cached workers. Translate only exact recognised messages; never guess at an
// unexpected browser/server error's meaning.
export function errorPhraseKey(error, catalogue=messages){
  const source=error?.message;
  return Object.keys(catalogue).find(key=>key.startsWith('engine.')&&catalogue[key].en===source)||null;
}
