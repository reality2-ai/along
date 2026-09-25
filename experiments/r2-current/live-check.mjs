// Node run of the live exchange. Usage:
// node experiments/r2-current/live-check.mjs [url] [evidence.json]
import {writeFileSync} from 'node:fs';
import {runLiveExchange} from './live-exchange.mjs';

const [url = 'wss://wairoa.mariko.org.nz/r2', out] = process.argv.slice(2);
const result = {runtime: 'node ' + process.version, ...await runLiveExchange(url)};
console.log(JSON.stringify(result, null, 2));
if (out) writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
process.exit(result.passed ? 0 : 1);
