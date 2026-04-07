import { spawn } from 'node:child_process';

const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const child = spawn(
    command,
    ['playwright', 'test', 'e2e/specs/visual', '--project=chromium', '--reporter=list'],
    {
        stdio: 'inherit',
        env: {
            ...process.env,
            PLAYWRIGHT_HTML_OPEN: 'never',
            VISUAL_UPDATE_BASELINES: '1',
        },
    }
);

const exitCode = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? 1));
});

if (exitCode !== 0) {
    process.exit(exitCode);
}
