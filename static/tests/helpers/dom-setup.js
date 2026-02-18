/**
 * DOM setup utilities for testing
 * Helps create common DOM structures needed for tests
 */

/**
 * Create a basic app structure for testing
 * @returns {Object} Object containing references to created elements
 */
export function createAppStructure() {
    const container = document.createElement('div');
    container.id = 'app';

    const header = document.createElement('header');
    header.className = 'header';

    const gallery = document.createElement('div');
    gallery.className = 'gallery';
    gallery.id = 'gallery';

    const lightbox = document.createElement('div');
    lightbox.className = 'lightbox';
    lightbox.id = 'lightbox';
    lightbox.style.display = 'none';

    const searchModal = document.createElement('div');
    searchModal.className = 'modal';
    searchModal.id = 'search-modal';
    searchModal.style.display = 'none';

    container.appendChild(header);
    container.appendChild(gallery);
    container.appendChild(lightbox);
    container.appendChild(searchModal);

    document.body.appendChild(container);

    return {
        container,
        header,
        gallery,
        lightbox,
        searchModal,
    };
}

/**
 * Create a gallery item element
 * @param {Object} item - Item data
 * @returns {HTMLElement}
 */
export function createGalleryItem(item = {}) {
    const {
        type = 'image',
        name = 'test-item.jpg',
        path = '/test/test-item.jpg',
        thumbnail = '/thumbnails/test-item.jpg',
    } = item;

    const itemEl = document.createElement('div');
    itemEl.className = `gallery-item ${type}`;
    itemEl.dataset.path = path;
    itemEl.dataset.name = name;
    itemEl.dataset.type = type;

    if (type === 'image' || type === 'video') {
        const img = document.createElement('img');
        img.src = thumbnail;
        img.alt = name;
        itemEl.appendChild(img);
    }

    const nameEl = document.createElement('div');
    nameEl.className = 'item-name';
    nameEl.textContent = name;
    itemEl.appendChild(nameEl);

    return itemEl;
}

/**
 * Create a video player element
 * @param {string} src - Video source URL
 * @returns {HTMLVideoElement}
 */
export function createVideoPlayer(src = '/test/video.mp4') {
    const video = document.createElement('video');
    video.id = 'player';
    video.controls = true;
    video.src = src;
    return video;
}

/**
 * Wait for an element to appear in the DOM
 * @param {string} selector - CSS selector
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<Element>}
 */
export function waitForElement(selector, timeout = 3000) {
    return new Promise((resolve, reject) => {
        const element = document.querySelector(selector);
        if (element) {
            return resolve(element);
        }

        const observer = new MutationObserver(() => {
            const element = document.querySelector(selector);
            if (element) {
                observer.disconnect();
                resolve(element);
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
        });

        setTimeout(() => {
            observer.disconnect();
            reject(new Error(`Element ${selector} not found within ${timeout}ms`));
        }, timeout);
    });
}

/**
 * Trigger a custom event on an element
 * @param {Element} element - Target element
 * @param {string} eventName - Event name
 * @param {Object} detail - Event detail data
 */
export function triggerEvent(element, eventName, detail = {}) {
    const event = new CustomEvent(eventName, {
        bubbles: true,
        cancelable: true,
        detail,
    });
    element.dispatchEvent(event);
}

/**
 * Simulate a click event
 * @param {Element} element - Element to click
 */
export function click(element) {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

/**
 * Simulate keyboard event
 * @param {Element} element - Target element
 * @param {string} key - Key name
 * @param {Object} options - Additional options
 */
export function pressKey(element, key, options = {}) {
    const event = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
        ...options,
    });
    element.dispatchEvent(event);
}

/**
 * Clean up the DOM after tests
 */
export function cleanup() {
    document.body.innerHTML = '';
    document.head.innerHTML = '';
}
