// Standalone esbuild config for use as a local workspace package.
// Replaces the electron-browser-shell monorepo build infrastructure.
const esbuild = require('esbuild')
const packageJson = require('./package.json')

console.log(`building ${packageJson.name}`)

const external = [
  'electron',
  'debug',
  'electron-chrome-extensions/preload',
]

const base = {
  bundle: true,
  sourcemap: true,
  external,
}

async function build(opts) {
  await esbuild.build(opts).catch(() => process.exit(1))
}

;(async () => {
  await build({ ...base, entryPoints: ['src/index.ts'], outfile: 'dist/cjs/index.js', platform: 'node', format: 'cjs' })
  await build({ ...base, entryPoints: ['src/index.ts'], outfile: 'dist/esm/index.mjs', platform: 'node', format: 'esm' })
  await build({ ...base, entryPoints: ['src/preload.ts'], outfile: 'dist/chrome-extension-api.preload.js', platform: 'browser', sourcemap: false })
  await build({ ...base, entryPoints: ['src/browser-action.ts'], outfile: 'dist/cjs/browser-action.js', platform: 'browser', format: 'cjs', sourcemap: false })
  await build({ ...base, entryPoints: ['src/browser-action.ts'], outfile: 'dist/esm/browser-action.mjs', platform: 'browser', format: 'esm', sourcemap: false })
})()
