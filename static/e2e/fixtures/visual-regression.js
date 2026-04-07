import fs from 'node:fs/promises';
import path from 'node:path';

function formatSnapshot(value) {
    return `${JSON.stringify(value, null, 2)}\n`;
}

function normalizeSnapshotValue(value) {
    if (Array.isArray(value)) {
        return value.map((entry) => normalizeSnapshotValue(entry));
    }

    if (value && typeof value === 'object') {
        const normalizedObject = {};

        Object.entries(value).forEach(([key, entryValue]) => {
            if (entryValue === undefined) {
                return;
            }

            normalizedObject[key] = normalizeSnapshotValue(entryValue);
        });

        return normalizedObject;
    }

    return value;
}

function findFirstDifference(actual, reference, path = 'root') {
    if (typeof actual !== typeof reference) {
        return `${path}: type ${typeof actual} !== ${typeof reference}`;
    }

    if (Array.isArray(actual) && Array.isArray(reference)) {
        if (actual.length !== reference.length) {
            return `${path}: length ${actual.length} !== ${reference.length}`;
        }

        for (let index = 0; index < actual.length; index += 1) {
            const diff = findFirstDifference(actual[index], reference[index], `${path}[${index}]`);
            if (diff) {
                return diff;
            }
        }

        return null;
    }

    if (actual && reference && typeof actual === 'object' && typeof reference === 'object') {
        const actualKeys = Object.keys(actual);
        const referenceKeys = Object.keys(reference);

        if (actualKeys.length !== referenceKeys.length) {
            return `${path}: key count ${actualKeys.length} !== ${referenceKeys.length}`;
        }

        for (const key of actualKeys) {
            if (!Object.hasOwn(reference, key)) {
                return `${path}: missing key ${key} in reference`;
            }

            const diff = findFirstDifference(actual[key], reference[key], `${path}.${key}`);
            if (diff) {
                return diff;
            }
        }

        return null;
    }

    return actual === reference
        ? null
        : `${path}: ${JSON.stringify(actual)} !== ${JSON.stringify(reference)}`;
}

export async function captureVisualSnapshot(page, locator, options = {}) {
    return locator.evaluate((element, snapshotOptions) => {
        element.scrollIntoView({ block: 'center', inline: 'nearest' });

        const rootRect = element.getBoundingClientRect();
        const ignoreTextSelectors = snapshotOptions.ignoreTextSelectors ?? [];
        const styleKeys = snapshotOptions.styleKeys ?? [
            'display',
            'position',
            'color',
            'background-color',
            'border-top-color',
            'border-right-color',
            'border-bottom-color',
            'border-left-color',
            'border-radius',
            'box-shadow',
            'font-size',
            'font-weight',
            'line-height',
            'letter-spacing',
            'text-transform',
            'opacity',
            'gap',
            'align-items',
            'justify-content',
            'padding-top',
            'padding-right',
            'padding-bottom',
            'padding-left',
            'margin-top',
            'margin-right',
            'margin-bottom',
            'margin-left',
        ];
        const maxNodes = snapshotOptions.maxNodes ?? 120;

        const normalizeText = (text) =>
            String(text || '')
                .replace(/\s+/g, ' ')
                .trim();

        const shouldIgnoreText = (node) =>
            ignoreTextSelectors.some((selector) => node.matches(selector));

        const getSnapshotText = (targetElement) => {
            if (!ignoreTextSelectors.length) {
                return normalizeText(targetElement.innerText || targetElement.textContent || '');
            }

            const ignoredNodes = ignoreTextSelectors.flatMap((selector) =>
                Array.from(targetElement.querySelectorAll(selector))
            );
            const originalState = ignoredNodes.map((ignoredNode) => ({
                ignoredNode,
                textContent: ignoredNode.textContent,
                value:
                    ignoredNode instanceof HTMLInputElement ||
                    ignoredNode instanceof HTMLTextAreaElement
                        ? ignoredNode.value
                        : undefined,
            }));

            try {
                originalState.forEach(({ ignoredNode }) => {
                    if (
                        ignoredNode instanceof HTMLInputElement ||
                        ignoredNode instanceof HTMLTextAreaElement
                    ) {
                        ignoredNode.value = '';
                    }

                    ignoredNode.textContent = '';
                });

                return normalizeText(targetElement.innerText || targetElement.textContent || '');
            } finally {
                originalState.forEach(({ ignoredNode, textContent, value }) => {
                    ignoredNode.textContent = textContent;
                    if (
                        (ignoredNode instanceof HTMLInputElement ||
                            ignoredNode instanceof HTMLTextAreaElement) &&
                        value !== undefined
                    ) {
                        ignoredNode.value = value;
                    }
                });
            }
        };

        const snapshotNodes = [];
        const nodes = [element, ...element.querySelectorAll('*')].slice(0, maxNodes);

        nodes.forEach((node) => {
            if (!(node instanceof HTMLElement)) {
                return;
            }

            const rect = node.getBoundingClientRect();
            const computedStyle = window.getComputedStyle(node);
            if (
                rect.width <= 0 ||
                rect.height <= 0 ||
                computedStyle.display === 'none' ||
                computedStyle.visibility === 'hidden' ||
                computedStyle.opacity === '0'
            ) {
                return;
            }

            const directText = normalizeText(
                Array.from(node.childNodes)
                    .filter((childNode) => childNode.nodeType === Node.TEXT_NODE)
                    .map((childNode) => childNode.textContent)
                    .join(' ')
            );

            const styles = {};
            styleKeys.forEach((key) => {
                styles[key] = computedStyle.getPropertyValue(key).trim();
            });

            snapshotNodes.push({
                tag: node.tagName.toLowerCase(),
                id: node.id || undefined,
                classes: Array.from(node.classList).sort(),
                text: shouldIgnoreText(node) ? undefined : directText || undefined,
                value: shouldIgnoreText(node)
                    ? undefined
                    : node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement
                      ? node.value
                      : undefined,
                rect: {
                    x: Math.round(rect.left - rootRect.left),
                    y: Math.round(rect.top - rootRect.top),
                    width: Math.round(rect.width),
                    height: Math.round(rect.height),
                },
                styles,
            });
        });

        return {
            size: {
                width: Math.round(rootRect.width),
                height: Math.round(rootRect.height),
            },
            text: getSnapshotText(element),
            nodes: snapshotNodes,
        };
    }, options);
}

export async function writeVisualSnapshot(snapshot, outputPath) {
    const normalizedSnapshot = normalizeSnapshotValue(snapshot);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, formatSnapshot(normalizedSnapshot));
}

async function readSnapshot(filePath) {
    try {
        await fs.access(filePath);
    } catch (error) {
        if (error?.code === 'ENOENT') {
            throw new Error(
                `Missing visual baseline: ${filePath}. Run 'cd static && npm run test:e2e:visual:baselines' or 'make frontend-test-e2e-visual-baselines' to create it.`
            );
        }
        throw error;
    }
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

export async function assertMatchesReferenceImage(actualSnapshot, referencePath, options = {}) {
    const normalizedActualSnapshot = normalizeSnapshotValue(actualSnapshot);

    if (process.env.VISUAL_UPDATE_BASELINES === '1') {
        await fs.mkdir(path.dirname(referencePath), { recursive: true });
        await fs.writeFile(referencePath, formatSnapshot(normalizedActualSnapshot));
        return;
    }

    const reference = await readSnapshot(referencePath);

    const diff = findFirstDifference(normalizedActualSnapshot, reference);
    if (diff) {
        throw new Error(`Visual regression snapshot mismatch for ${referencePath}: ${diff}`);
    }
}
