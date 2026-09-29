#!/usr/bin/env node
// `node scripts/awd.mjs <command> …` — the awd CLI from the bundled plugin (dist/awd.mjs) or a dev checkout.
import { pathToFileURL } from 'node:url'
import { entry } from './entry.mjs'

const cli = entry('awd')
process.argv = [process.argv[0], cli, ...process.argv.slice(2)]
await import(pathToFileURL(cli).href)
