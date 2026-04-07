import { spawnSync } from 'node:child_process';

const playwrightArgs = ['playwright', 'test', ...process.argv.slice(2)];
const grepInvert = [];

if (!process.env.PLAYWRIGHT_INCLUDE_PERFORMANCE) {
    grepInvert.push('@performance');
}

if (!process.env.PLAYWRIGHT_INCLUDE_DOCS_SCREENSHOTS) {
    grepInvert.push('@docs-screenshots');
}

if (grepInvert.length > 0 && !playwrightArgs.includes('--grep-invert')) {
    playwrightArgs.push('--grep-invert', grepInvert.join('|'));
}

const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const result = spawnSync(command, playwrightArgs, {
    stdio: 'inherit',
    env: process.env,
});

if (result.error) {
    throw result.error;
}

process.exit(result.status ?? 1);
