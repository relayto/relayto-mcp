#!/usr/bin/env node
import { run } from './cli.js';

const code = await run(process.argv.slice(2), { stdout: process.stdout, stderr: process.stderr, env: process.env });
// Let stdout drain before exiting (pipes are asynchronous on macOS and Windows).
process.stdout.write('', () => process.exit(code));
