/**
 * Test utility functions
 * Common helpers for writing tests
 */

/**
 * Wait for a condition to be true
 * @param {Function} condition - Function that returns boolean
 * @param {number} timeout - Timeout in milliseconds
 * @param {number} interval - Check interval in milliseconds
 * @returns {Promise<void>}
 */
export async function waitFor(condition, timeout = 3000, interval = 50) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
        if (await condition()) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, interval));
    }
    throw new Error('Timeout waiting for condition');
}

/**
 * Wait for a specific time
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise<void>}
 */
export function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Mock localStorage
 * @returns {Object} Mock localStorage object
 */
export function createMockLocalStorage() {
    let store = {};

    return {
        getItem: (key) => store[key] || null,
        setItem: (key, value) => {
            store[key] = String(value);
        },
        removeItem: (key) => {
            delete store[key];
        },
        clear: () => {
            store = {};
        },
        get length() {
            return Object.keys(store).length;
        },
        key: (index) => {
            const keys = Object.keys(store);
            return keys[index] || null;
        },
    };
}

/**
 * Mock URL and history API
 * @returns {Object} Functions to control mock history
 */
export function createMockHistory() {
    const history = [];
    let currentIndex = -1;

    const pushState = (state, title, url) => {
        currentIndex++;
        history[currentIndex] = { state, title, url };
        history.length = currentIndex + 1;
        window.location.href = url;
    };

    const replaceState = (state, title, url) => {
        if (currentIndex >= 0) {
            history[currentIndex] = { state, title, url };
        } else {
            pushState(state, title, url);
        }
        window.location.href = url;
    };

    const back = () => {
        if (currentIndex > 0) {
            currentIndex--;
            const entry = history[currentIndex];
            window.location.href = entry.url;
            window.dispatchEvent(new PopStateEvent('popstate', { state: entry.state }));
        }
    };

    const forward = () => {
        if (currentIndex < history.length - 1) {
            currentIndex++;
            const entry = history[currentIndex];
            window.location.href = entry.url;
            window.dispatchEvent(new PopStateEvent('popstate', { state: entry.state }));
        }
    };

    window.history.pushState = pushState;
    window.history.replaceState = replaceState;
    window.history.back = back;
    window.history.forward = forward;

    return {
        getHistory: () => [...history],
        getCurrentIndex: () => currentIndex,
        reset: () => {
            history.length = 0;
            currentIndex = -1;
        },
    };
}

/**
 * Load a script file into the test environment
 * @param {string} scriptPath - Path to the script file
 * @returns {Promise<void>}
 */
export async function loadScript(scriptPath) {
    const fs = await import('fs/promises');
    const path = await import('path');
    const { fileURLToPath } = await import('url');

    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const fullPath = path.resolve(__dirname, '../../', scriptPath);
    const code = await fs.readFile(fullPath, 'utf-8');

    // Execute the code in the global context
    const script = new Function(code);
    script();
}

/**
 * Create a spy function with tracking
 * @param {Function} implementation - Optional implementation
 * @returns {Function}
 */
export function createSpy(implementation = () => {}) {
    const calls = [];
    const spy = function (...args) {
        calls.push(args);
        return implementation.apply(this, args);
    };
    spy.calls = calls;
    spy.callCount = () => calls.length;
    spy.calledWith = (...args) =>
        calls.some((call) => JSON.stringify(call) === JSON.stringify(args));
    spy.reset = () => {
        calls.length = 0;
    };
    return spy;
}

/**
 * Assert that an element has specific attributes
 * @param {Element} element - Element to check
 * @param {Object} attributes - Expected attributes
 */
export function assertAttributes(element, attributes) {
    for (const [key, value] of Object.entries(attributes)) {
        const actual = element.getAttribute(key);
        if (actual !== value) {
            throw new Error(`Expected attribute ${key}="${value}", got "${actual}"`);
        }
    }
}

/**
 * Assert that an element has specific classes
 * @param {Element} element - Element to check
 * @param {string[]} classes - Expected classes
 */
export function assertClasses(element, classes) {
    for (const cls of classes) {
        if (!element.classList.contains(cls)) {
            throw new Error(`Expected element to have class "${cls}"`);
        }
    }
}

/**
 * Get the text content of an element, normalized
 * @param {Element} element - Element to get text from
 * @returns {string}
 */
export function getTextContent(element) {
    return element.textContent.trim().replace(/\s+/g, ' ');
}

/**
 * Create a mock IntersectionObserver
 * @returns {Function} Mock constructor
 */
export function createMockIntersectionObserver() {
    const observers = new Map();

    return class MockIntersectionObserver {
        constructor(callback, options) {
            this.callback = callback;
            this.options = options;
            this.elements = new Set();
            observers.set(this, { callback, options, elements: this.elements });
        }

        observe(element) {
            this.elements.add(element);
        }

        unobserve(element) {
            this.elements.delete(element);
        }

        disconnect() {
            this.elements.clear();
        }

        // Test helper to trigger intersection
        static triggerIntersection(element, isIntersecting = true) {
            for (const [_observer, data] of observers) {
                if (data.elements.has(element)) {
                    data.callback([
                        {
                            target: element,
                            isIntersecting,
                            intersectionRatio: isIntersecting ? 1 : 0,
                        },
                    ]);
                }
            }
        }
    };
}
