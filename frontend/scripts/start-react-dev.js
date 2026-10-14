#!/usr/bin/env node

const { spawn } = require('child_process');

const isFastMode = process.argv.includes('--fast');
const isCheckMode = process.argv.includes('--check');

const env = {
  ...process.env,
  FAST_REFRESH: 'true',
  SKIP_PREFLIGHT_CHECK: 'true',
  // Prevent react-scripts from trying to launch a host browser from inside containers/WSL.
  BROWSER: process.env.BROWSER ?? 'none'
};

if (isFastMode) {
  env.GENERATE_SOURCEMAP = 'false';
}

if (isCheckMode) {
  const checkSummary = {
    FAST_REFRESH: env.FAST_REFRESH,
    SKIP_PREFLIGHT_CHECK: env.SKIP_PREFLIGHT_CHECK,
    GENERATE_SOURCEMAP: env.GENERATE_SOURCEMAP ?? '(default)'
  };

  console.log(JSON.stringify(checkSummary, null, 2));
  process.exit(0);
}

const child = spawn('react-scripts', ['start'], {
  env,
  shell: true,
  stdio: 'inherit'
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
