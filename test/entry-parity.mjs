import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as esm from '../dist/exact-time.mjs';

const context = vm.createContext({});
vm.runInContext(readFileSync(new URL('../dist/exact-time.jsx', import.meta.url), 'utf8'), context);
const probes = JSON.parse(readFileSync(0, 'utf8'));

function execute(api, [entry, args]) {
  if (entry === 'toPremiereMilliseconds') {
    const [time] = args;
    // Frame counts are bigint in the module and decimal strings in ES3.
    args = [{ ...time, frames: api === esm ? BigInt(time.frames) : time.frames }];
  }
  try {
    return { value: api[entry](...args) };
  } catch (error) {
    return { refused: error.message };
  }
}

const results = [esm, context.ExactTime].map(api => probes.map(probe => execute(api, probe)));
process.stdout.write(JSON.stringify(results, (_, value) => typeof value === 'bigint' ? String(value) : value));
