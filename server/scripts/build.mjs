// Bundles the server into dist/server.js and copies the tree-sitter WASM files next to it.
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(serverDir, 'dist');
const watch = process.argv.includes('--watch');

const wasmFiles = [
  path.join('node_modules', 'web-tree-sitter', 'tree-sitter.wasm'),
  path.join('node_modules', 'tree-sitter-php', 'tree-sitter-php.wasm'),
  path.join('node_modules', 'tree-sitter-twig', 'tree-sitter-twig.wasm'),
];

/** Inlines `import x from './file?raw'` as a string (same convention as Vite in tests). */
const rawPlugin = {
  name: 'raw',
  setup(build) {
    build.onResolve({ filter: /\?raw$/ }, (args) => ({
      path: path.resolve(args.resolveDir, args.path.slice(0, -'?raw'.length)),
      namespace: 'raw',
    }));
    build.onLoad({ filter: /.*/, namespace: 'raw' }, async (args) => ({
      contents: await fs.promises.readFile(args.path, 'utf8'),
      loader: 'text',
      watchFiles: [args.path],
    }));
  },
};

/**
 * Our `import` statements make esbuild pick web-tree-sitter's ESM build, which relies on
 * `import.meta.url` (undefined in a CommonJS bundle). Force its CommonJS build instead.
 */
const webTreeSitterCjsPlugin = {
  name: 'web-tree-sitter-cjs',
  setup(build) {
    build.onResolve({ filter: /^web-tree-sitter$/ }, () => ({
      path: path.join(serverDir, 'node_modules', 'web-tree-sitter', 'tree-sitter.cjs'),
    }));
  },
};

const options = {
  entryPoints: [path.join(serverDir, 'src', 'server.ts')],
  outfile: path.join(distDir, 'server.js'),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: true,
  logLevel: 'info',
  plugins: [rawPlugin, webTreeSitterCjsPlugin],
};

fs.mkdirSync(distDir, { recursive: true });
for (const file of wasmFiles) {
  fs.copyFileSync(path.join(serverDir, file), path.join(distDir, path.basename(file)));
}

if (watch) {
  const context = await esbuild.context(options);
  await context.watch();
} else {
  await esbuild.build(options);
}
