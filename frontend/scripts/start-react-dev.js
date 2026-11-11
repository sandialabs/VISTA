#!/usr/bin/env node

// Starts the Vite dev server (npm run dev / npm run dev:fast).
// --fast is kept for compatibility with the react-scripts era; Vite serves source files
// unbundled, so there is no slower mode to skip. --check prints the effective settings.

const { spawn } = require('child_process');
const path = require('path');

const isCheckMode = process.argv.includes('--check');

const env = {
  ...process.env,
  HOST: process.env.HOST || 'localhost',
  PORT: process.env.PORT || '3000',
};

if (isCheckMode) {
  console.log(JSON.stringify({
    HOST: env.HOST,
    PORT: env.PORT,
    REACT_APP_BACKEND_URL: env.REACT_APP_BACKEND_URL || 'http://localhost:8000',
  }, null, 2));
  process.exit(0);
}

const viteBin = path.join(__dirname, '..', 'node_modules', 'vite', 'bin', 'vite.js');
const child = spawn(process.execPath, [viteBin], {
  cwd: path.join(__dirname, '..'),
  env,
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
