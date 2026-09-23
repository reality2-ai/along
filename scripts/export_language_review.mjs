// Regenerate with: node scripts/export_language_review.mjs
// A reviewer can comment on wording in this CSV; no coding is required.
import {writeFile} from 'node:fs/promises';
import {messages} from '../public/locales.js';
import {validateCatalogue} from '../public/i18n.js';

const errors = validateCatalogue();
if (errors.length) throw new Error(errors.join('\n'));
const quote = value => '"' + String(value ?? '').replaceAll('"', '""') + '"';
const rows = [['id', 'English', 'Draft te reo Māori', 'Status']];
for (const [id, phrase] of Object.entries(messages)) {
  rows.push([id, phrase.en, phrase.mi, phrase.mi === null ? 'Untranslated' : 'Draft — not reviewed']);
}
await writeFile(new URL('../docs/LANGUAGE_REVIEW.csv', import.meta.url), rows.map(row => row.map(quote).join(',')).join('\n') + '\n');
console.log(`Exported ${rows.length - 1} phrases. This is the initial catalogue, not full interface coverage.`);
