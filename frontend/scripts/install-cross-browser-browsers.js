const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const frontendRoot = path.resolve(__dirname, '..');
const localRoot = path.join(frontendRoot, '.local');
const debRoot = path.join(localRoot, 'browser-debs');

const chromeDebPath = path.join(debRoot, 'google-chrome-stable_current_amd64.deb');
const chromeInstallRoot = path.join(localRoot, 'google-chrome');
const chromeExecutablePath = path.join(chromeInstallRoot, 'opt/google/chrome/chrome');

const edgeDebPath = path.join(debRoot, 'microsoft-edge-stable_current_amd64.deb');
const edgeInstallRoot = path.join(localRoot, 'microsoft-edge');
const edgeExecutablePath = path.join(edgeInstallRoot, 'opt/microsoft/msedge/msedge');

const chromeDownloadUrl = 'https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb';
const edgeIndexUrl = 'https://packages.microsoft.com/repos/edge/pool/main/m/microsoft-edge-stable/';
const edgeDownloadBaseUrl = 'https://packages.microsoft.com/repos/edge/pool/main/m/microsoft-edge-stable';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    ...options,
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
  }
}

function fetchText(url) {
  return execFileSync('curl', ['-fsSL', '-A', 'curl/8.0', url], { encoding: 'utf8' });
}

async function download(url, destination) {
  await fs.promises.mkdir(path.dirname(destination), { recursive: true });
  const tempPath = `${destination}.tmp`;
  run('curl', ['-fL', '-A', 'curl/8.0', '-o', tempPath, url]);
  await fs.promises.rename(tempPath, destination);
}

function versionParts(fileName) {
  const match = fileName.match(/^microsoft-edge-stable_(\d+(?:\.\d+)+)-\d+_amd64\.deb$/);
  if (!match) {
    return [];
  }
  return match[1].split('.').map((part) => Number(part));
}

function compareVersions(a, b) {
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (a[index] || 0) - (b[index] || 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

async function latestEdgeDebUrl() {
  const index = await fetchText(edgeIndexUrl);
  const files = [...index.matchAll(/microsoft-edge-stable_[^"'<>\s]+_amd64\.deb/g)].map((match) => match[0]);
  const latest = files.sort((a, b) => compareVersions(versionParts(a), versionParts(b))).pop();

  if (!latest) {
    throw new Error(`Could not find a Microsoft Edge .deb in ${edgeIndexUrl}`);
  }

  return `${edgeDownloadBaseUrl}/${latest}`;
}

async function installDebBrowser({ name, url, debPath, installRoot, executablePath }) {
  if (fs.existsSync(executablePath)) {
    console.log(`${name} already installed at ${executablePath}`);
    return;
  }

  console.log(`Downloading ${name}...`);
  await download(typeof url === 'function' ? await url() : url, debPath);

  await fs.promises.rm(installRoot, { recursive: true, force: true });
  await fs.promises.mkdir(installRoot, { recursive: true });
  run('dpkg-deb', ['-x', debPath, installRoot]);
  console.log(`${name} installed at ${executablePath}`);
}

async function main() {
  run('npx', ['playwright', 'install', 'chromium', 'firefox'], { cwd: frontendRoot });

  if (process.platform !== 'linux' || os.arch() !== 'x64') {
    console.log('Skipping no-sudo Chrome/Edge .deb install because this is not linux x64.');
    console.log('Set E2E_REAL_BROWSERS=true to use system-installed Chrome and Edge on this platform.');
    return;
  }

  await installDebBrowser({
    name: 'Google Chrome',
    url: chromeDownloadUrl,
    debPath: chromeDebPath,
    installRoot: chromeInstallRoot,
    executablePath: chromeExecutablePath,
  });

  await installDebBrowser({
    name: 'Microsoft Edge',
    url: latestEdgeDebUrl,
    debPath: edgeDebPath,
    installRoot: edgeInstallRoot,
    executablePath: edgeExecutablePath,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
