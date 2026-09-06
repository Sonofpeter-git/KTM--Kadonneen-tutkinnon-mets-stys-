/**
 * Lets `node --test` run the components directly.
 *
 * Node cannot parse JSX, and standing up a whole browser test runner to prove
 * that a panel renders is out of proportion. esbuild transforms .jsx on the way
 * in; everything else is left to Node.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';

export async function load(url, context, nextLoad) {
  if (url.endsWith('.jsx')) {
    const source = await readFile(fileURLToPath(url), 'utf8');
    const { code } = await transform(source, {
      loader: 'jsx',
      jsx: 'automatic',
      format: 'esm',
      target: 'node22',
      sourcefile: url,
    });
    return { format: 'module', source: code, shortCircuit: true };
  }
  return nextLoad(url, context);
}
