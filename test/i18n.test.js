import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalizer, setLocalizedText, validateCatalogue, errorPhraseKey} from '../public/i18n.js';
import {languageKey} from '../public/locales.js';

test('language persists separately from journey data and restores without a network', () => {
  const data = new Map([['along-journeys-v1', 'saved journeys']]);
  const storage = {getItem: key => data.get(key), setItem: (key, value) => data.set(key, value)};
  const first = createLocalizer({storage});
  assert.equal(first.language, 'en');
  assert.deepEqual(first.setLanguage('mi'), {language: 'mi', stored: true});
  const reopened = createLocalizer({storage});
  assert.equal(reopened.language, 'mi');
  assert.equal(reopened.tag, 'mi-NZ');
  assert.equal(reopened.text('action.settings'), 'Ngā tautuhinga');
  assert.equal(data.get('along-journeys-v1'), 'saved journeys');
  assert.equal(data.size, 2);
});

test('blocked storage and corrupt preferences leave language switching usable', () => {
  const blocked = createLocalizer({storage: {getItem() {throw Error();}, setItem() {throw Error();}}});
  assert.deepEqual(blocked.setLanguage('mi'), {language: 'mi', stored: false});
  assert.equal(blocked.text('action.understood'), 'Kua mārama');
  for (const invalid of ['__proto__', 'constructor', 'fr', null]) {
    const localizer = createLocalizer({storage: {getItem: () => invalid}});
    assert.equal(localizer.language, 'en');
    assert.throws(() => localizer.setLanguage(invalid), /Unsupported language/);
    assert.equal(localizer.language, 'en');
  }
});

test('untranslated phrases carry English metadata and substitutions preserve official names', () => {
  const localizer = createLocalizer({storage: null, catalogue: {'flow.destinationSelected': {en: 'Destination already selected: {place}', mi: null}}});
  localizer.setLanguage('mi');
  const place = 'Waitematā <img src=x onerror=alert(1)> {language}';
  const phrase = localizer.phrase('flow.destinationSelected', {place});
  assert.deepEqual(phrase, {text: `Destination already selected: ${place}`, lang: 'en-NZ', fallback: true, draft: false});
  const element = {setAttribute(key, value) {this[key] = value;}};
  setLocalizedText(element, localizer, 'flow.destinationSelected', {place});
  assert.equal(element.textContent, phrase.text);
  assert.equal(element.lang, 'en-NZ');
  assert.equal(element.innerHTML, undefined);
  assert.throws(() => localizer.text('flow.destinationSelected'), /Missing place/);
  assert.throws(() => localizer.text('constructor'), /Unknown interface phrase/);
});

test('switch notifications do not repeat and can be removed without changing other state', () => {
  const localizer = createLocalizer({storage: null}), received = [];
  const unsubscribe = localizer.subscribe(language => received.push(language));
  localizer.setLanguage('mi');localizer.setLanguage('mi');localizer.setLanguage('en');
  unsubscribe();localizer.setLanguage('mi');
  assert.deepEqual(received, ['mi', 'en']);
});

test('catalogue validates placeholders and rejects empty translations', () => {
  assert.deepEqual(validateCatalogue(), []);
  assert.deepEqual(validateCatalogue({bad: {en: 'From {place}', mi: 'Mai i {stop}'}}), ['bad: placeholders differ']);
  assert.deepEqual(validateCatalogue({bad: {en: 'From', mi: ''}}), ['bad: Māori must be non-empty text or null']);
});


test('known worker messages translate without guessing at unexpected errors',()=>{
  const language=createLocalizer({storage:null});language.setLanguage('mi');
  const key=errorPhraseKey(new Error('Choose a valid date.'));
  assert.equal(key,'engine.date');assert.equal(language.text(key),'Kōwhiria he rā whaimana.');
  assert.equal(errorPhraseKey(new Error('Choose a valid date. Extra server text')),null);
  assert.equal(errorPhraseKey(new Error('<script>unexpected</script>')),null);
  assert.equal(errorPhraseKey(null),null);
});
