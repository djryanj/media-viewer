const Lightbox = {
    elements: {},
    items: [],
    currentIndex: 0,
    touchStartX: 0,
    touchEndX: 0,
    touchStartY: 0,
    isSwiping: false,
    lastTouchMoveTime: 0,

    // Vertical swipe-to-close state
    swipeDownTracking: false, // true once downward axis is committed
    swipeDownStartTime: 0, // timestamp when tracking began (for velocity)
    swipeDownLastY: 0, // most-recent screenY during the gesture
    _swipeDownAbort: null, // AbortController for the commit transitionend listener

    useAppMedia: true,

    // Collection-switch context — set by switchToCollection(), consumed by close()
    // to update the gallery grid once the lightbox is dismissed.
    _switchedCollectionId: null,
    _switchedCollectionName: null,
    _switchedCollectionItems: null,

    // Loading management
    currentLoadId: 0,
    preloadCache: new Map(),
    preloadQueue: [],
    maxPreload: 3,
    isLoading: false,

    // Animation/video loop control
    animationCheckInterval: null,
    lastImageData: null,

    // Video player component instance
    videoPlayer: null,

    // Image failure tracking
    imageFailures: {
        currentFailedImage: null,
        consecutiveFailures: 0,
        lastFailureTime: 0,
    },

    // UI overlay visibility control
    uiOverlaysVisible: true,
    uiOverlaysTimeout: null,
    userHidOverlays: false,
    lastTouchTime: 0,

    // Tags drawer state
    tagsDrawerOpen: false,
    collectionDrawerOpen: false,
    drawerTouchStartY: 0,
    drawerIsDragging: false,
    allTagSuggestions: [], // Cached tag list for autocomplete

    // Mobile soft-keyboard viewport handler for the tags drawer
    _drawerViewportHandler: null,
    drawerHighlightedIndex: -1, // Keyboard-nav index for drawer suggestions

    // Pinch-to-zoom state
    zoom: {
        scale: 1,
        translateX: 0,
        translateY: 0,
        initialDistance: 0,
        initialScale: 1,
        isPinching: false,
        isPanning: false,
        lastTouchX: 0,
        lastTouchY: 0,
        minScale: 1,
        maxScale: 5,
        lastTapTime: 0,
        pinchCenterX: 0,
        pinchCenterY: 0,
    },

    init() {
        this.cacheElements();
        this._initStaticIcons();
        this.videoControlsHeight = 0;
        this.createHotZones();
        this.createLoadingIndicator();
        this.createAutoplayToggle();
        this.createLoopToggle();
        this.createCollectionDrawer();
        this.createTagsDrawer();
        this.bindEvents();
        this.bindZoomEvents();

        const video = this.elements.video;
        if (video) {
            video.addEventListener('video-controls-size', (e) => {
                try {
                    this.videoControlsHeight =
                        e && e.detail && typeof e.detail.height === 'number' ? e.detail.height : 0;
                    this.updateHotZonePositions();
                } catch (err) {
                    console.debug('Lightbox: failed to process video-controls-size event', err);
                }
            });
        }
    },

    cacheElements() {
        this.elements = {
            lightbox: document.getElementById('lightbox'),
            image: document.getElementById('lightbox-image'),
            video: document.getElementById('lightbox-video'),
            videoWrapper: document.querySelector('.lightbox-video-wrapper'),
            title: document.getElementById('lightbox-title'),
            counter: document.getElementById('lightbox-counter'),
            closeBtn: document.querySelector('.lightbox-close'),
            prevBtn: document.querySelector('.lightbox-prev'),
            nextBtn: document.querySelector('.lightbox-next'),
            content: document.querySelector('.lightbox-content'),
            pinBtn: document.getElementById('lightbox-pin'),
            tagBtn: document.getElementById('lightbox-tag'),
            downloadBtn: document.getElementById('lightbox-download'),
        };
    },

    /**
     * Render static icons (pin, tag) once at init time so that
     * updatePinButton / updateTagButton never need to touch innerHTML or
     * call lucide.createIcons() on every navigation — eliminating the DOM
     * mutation cascade that triggers browser extensions on each next/open.
     */
    _initStaticIcons() {
        if (this.elements.pinBtn) {
            this.elements.pinBtn.innerHTML = '<i data-lucide="star"></i>';
        }
        if (this.elements.tagBtn) {
            this.elements.tagBtn.innerHTML = '<i data-lucide="tag"></i>';
        }
        const nodes = [this.elements.pinBtn, this.elements.tagBtn].filter(Boolean);
        if (nodes.length) lucide.createIcons({ nodes });
    },

    createAutoplayToggle() {
        const toggle = document.createElement('button');
        toggle.className = 'lightbox-autoplay hidden';
        toggle.id = 'lightbox-autoplay';
        toggle.title = 'Toggle video autoplay (A)';
        // Pre-render both icon states once; CSS + .enabled class selects the
        // visible icon so updateAutoplayButton() never touches the DOM again.
        toggle.innerHTML = [
            '<i data-lucide="play-circle" class="icon-autoplay-on"></i>',
            '<i data-lucide="pause-circle" class="icon-autoplay-off"></i>',
        ].join('');

        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleAutoplay();
        });

        const info = this.elements.lightbox.querySelector('.lightbox-info');
        if (info) {
            info.parentNode.insertBefore(toggle, info);
        } else {
            this.elements.lightbox.appendChild(toggle);
        }

        this.elements.autoplayBtn = toggle;
        lucide.createIcons({ nodes: [toggle] });
        this.updateAutoplayButton();
    },

    updateAutoplayButton(btn = this.elements.autoplayBtn) {
        if (!btn) return;
        const isEnabled = Preferences.isVideoAutoplayEnabled();
        btn.classList.toggle('enabled', isEnabled);
        btn.title = isEnabled ? 'Autoplay ON (A)' : 'Autoplay OFF (A)';
        // Icon visibility is controlled by CSS (.enabled toggles play-circle vs pause-circle).
        // No innerHTML mutation or lucide.createIcons() call needed.
    },

    toggleAutoplay() {
        const newValue = Preferences.toggleVideoAutoplay();
        this.updateAutoplayButton();
        if (typeof Gallery !== 'undefined' && Gallery.showToast) {
            Gallery.showToast(newValue ? 'Autoplay enabled' : 'Autoplay disabled');
        }
    },

    createLoopToggle() {
        const toggle = document.createElement('button');
        toggle.className = 'lightbox-loop-toggle hidden';
        toggle.id = 'lightbox-loop-toggle';
        toggle.title = 'Toggle loop (L)';
        // Pre-render both icon states once; CSS + .enabled class selects the
        // visible icon so updateLoopButton() never touches the DOM again.
        toggle.innerHTML = [
            '<i data-lucide="repeat" class="icon-loop-on"></i>',
            '<i data-lucide="repeat-1" class="icon-loop-off"></i>',
        ].join('');

        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleLoop();
        });

        const info = this.elements.lightbox.querySelector('.lightbox-info');
        if (info) {
            info.parentNode.insertBefore(toggle, info);
        } else {
            this.elements.lightbox.appendChild(toggle);
        }

        this.elements.loopBtn = toggle;
        lucide.createIcons({ nodes: [toggle] });
        this.updateLoopButton();
    },

    updateLoopButton(btn = this.elements.loopBtn) {
        if (!btn) return;
        const isEnabled = Preferences.isMediaLoopEnabled();
        btn.classList.toggle('enabled', isEnabled);
        btn.title = isEnabled ? 'Loop ON (L)' : 'Loop OFF (L)';
        // Icon visibility is controlled by CSS (.enabled toggles repeat vs repeat-1).
        // No innerHTML mutation or lucide.createIcons() call needed.
    },

    toggleLoop() {
        const newValue = Preferences.toggleMediaLoop();
        this.updateLoopButton();
        if (typeof Gallery !== 'undefined' && Gallery.showToast) {
            Gallery.showToast(newValue ? 'Loop enabled' : 'Loop disabled');
        }
        const currentFile = this.items[this.currentIndex];
        if (!currentFile) return;
        if (currentFile.type === 'video') {
            this.elements.video.loop = newValue;
        } else if (this.isAnimatedImageType(currentFile.name)) {
            if (newValue) {
                this.startAnimationLoopDetection();
            } else {
                this.stopAnimationLoopDetection();
            }
        }
    },

    isAnimatedImageType(filename) {
        if (!filename) return false;
        const ext = filename.toLowerCase().split('.').pop();
        return ['gif', 'webp', 'apng'].includes(ext);
    },

    async parseGifLoopCount(blob) {
        try {
            const buffer = await blob.arrayBuffer();
            const bytes = new Uint8Array(buffer);
            const signature = String.fromCharCode(...bytes.slice(0, 6));
            if (!signature.startsWith('GIF')) return null;

            let pos = 13;
            const packed = bytes[10];
            if (packed & 0x80) {
                const colorTableSize = 3 * Math.pow(2, (packed & 0x07) + 1);
                pos += colorTableSize;
            }

            while (pos < bytes.length - 3) {
                if (bytes[pos] !== 0x21) {
                    pos++;
                    continue;
                }
                if (bytes[pos + 1] === 0xff) {
                    if (bytes[pos + 2] === 0x0b) {
                        const identifier = String.fromCharCode(...bytes.slice(pos + 3, pos + 14));
                        if (identifier === 'NETSCAPE2.0') {
                            if (bytes[pos + 14] === 0x03 && bytes[pos + 15] === 0x01) {
                                const loopCount = bytes[pos + 16] | (bytes[pos + 17] << 8);
                                return loopCount;
                            }
                        }
                    }
                }
                pos++;
            }
            return null;
        } catch (error) {
            console.debug('Error parsing GIF loop count:', error);
            return null;
        }
    },

    shouldShowLoopButton(file) {
        if (!file) return false;
        if (file.type === 'video') return true;
        if (file.type === 'image' && this.isAnimatedImageType(file.name)) return true;
        return false;
    },

    startAnimationLoopDetection() {
        this.stopAnimationLoopDetection();
        if (!Preferences.isMediaLoopEnabled()) return;
        const img = this.elements.image;
        if (!img || img.classList.contains('hidden')) return;
        const currentFile = this.items[this.currentIndex];
        if (!currentFile || !this.isAnimatedImageType(currentFile.name)) return;

        if (currentFile.name && currentFile.name.toLowerCase().endsWith('.gif')) {
            if (currentFile.gifLoopCount === 0) return;
        }
        this.setupAnimationLoopMonitor(img);
    },

    stopAnimationLoopDetection() {
        if (this.animationCheckInterval) {
            clearInterval(this.animationCheckInterval);
            this.animationCheckInterval = null;
        }
        this.lastImageData = null;
    },

    setupAnimationLoopMonitor(img) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const sampleSize = 10;
        canvas.width = sampleSize;
        canvas.height = sampleSize;
        let unchangedFrames = 0;
        const unchangedThreshold = 50;
        const checkInterval = 200;

        this.animationCheckInterval = setInterval(() => {
            if (!img.complete || img.naturalWidth === 0) return;
            try {
                ctx.drawImage(
                    img,
                    0,
                    0,
                    img.naturalWidth,
                    img.naturalHeight,
                    0,
                    0,
                    sampleSize,
                    sampleSize
                );
                const imageData = ctx.getImageData(0, 0, sampleSize, sampleSize);
                const currentData = Array.from(imageData.data).join(',');
                if (this.lastImageData === currentData) {
                    unchangedFrames++;
                    if (unchangedFrames >= unchangedThreshold) {
                        this.restartAnimation(img);
                        unchangedFrames = 0;
                    }
                } else {
                    unchangedFrames = 0;
                }
                this.lastImageData = currentData;
            } catch {
                this.stopAnimationLoopDetection();
            }
        }, checkInterval);
    },

    restartAnimation(img) {
        const currentSrc = img.src;
        const url = new URL(currentSrc);
        url.searchParams.set('_loop', Date.now().toString());
        img.style.opacity = '0.5';
        const onLoad = () => {
            img.style.opacity = '1';
            img.removeEventListener('load', onLoad);
        };
        img.addEventListener('load', onLoad);
        img.src = url.toString();
    },

    createTagsDrawer() {
        // Create the tag summary line inside lightbox-info
        const infoBar = this.elements.lightbox.querySelector('.lightbox-info');
        if (infoBar) {
            const tagSummary = document.createElement('div');
            tagSummary.className = 'lightbox-tag-summary hidden';
            tagSummary.id = 'lightbox-tag-summary';
            tagSummary.innerHTML =
                '<i data-lucide="tag" class="tag-summary-icon"></i><span class="tag-summary-text"></span>';
            const counter = infoBar.querySelector('#lightbox-counter');
            if (counter) {
                infoBar.insertBefore(tagSummary, counter);
            } else {
                infoBar.appendChild(tagSummary);
            }
            this.elements.tagSummary = tagSummary;

            tagSummary.addEventListener('click', (e) => {
                e.stopPropagation();
                this.openTagsDrawer();
            });
        }

        // Create the drawer backdrop
        const backdrop = document.createElement('div');
        backdrop.className = 'lightbox-drawer-backdrop hidden';
        backdrop.addEventListener('click', () => this.closeTagsDrawer());
        this.elements.lightbox.appendChild(backdrop);
        this.elements.drawerBackdrop = backdrop;

        // Create the drawer panel
        const drawer = document.createElement('div');
        drawer.className = 'lightbox-tags-drawer hidden';
        drawer.innerHTML = `
        <div class="drawer-handle-bar"><div class="drawer-handle"></div></div>
        <div class="drawer-header">
            <h3 class="drawer-title"><i data-lucide="tag"></i> Tags</h3>
            <button class="drawer-close" title="Close"><i data-lucide="x"></i></button>
        </div>
        <div class="drawer-body">
            <div class="drawer-tags-list"></div>
            <div class="drawer-empty-state hidden">
                <span class="drawer-empty-text">No tags yet</span>
            </div>
        </div>
        <div class="drawer-footer">
            <div class="drawer-clipboard-actions">
                <button class="drawer-copy-btn btn btn-secondary" title="Copy tags to clipboard (Ctrl+C)">
                    <i data-lucide="copy"></i>
                    <span>Copy</span>
                </button>
                <button class="drawer-paste-btn btn btn-secondary" title="Paste tags from clipboard (Ctrl+V)" disabled>
                    <i data-lucide="clipboard-paste"></i>
                    <span>Paste</span>
                </button>
            </div>
            <div class="drawer-add-tag">
                <input type="text" class="drawer-tag-input" placeholder="Add a tag..." autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" />
                <button class="drawer-add-btn btn btn-primary"><i data-lucide="plus"></i></button>
            </div>
            <div class="drawer-tag-suggestions hidden"></div>
        </div>
    `;

        this.elements.lightbox.appendChild(drawer);
        this.elements.tagsDrawer = drawer;
        this.elements.drawerTagsList = drawer.querySelector('.drawer-tags-list');
        this.elements.drawerEmptyState = drawer.querySelector('.drawer-empty-state');
        this.elements.drawerTagInput = drawer.querySelector('.drawer-tag-input');
        this.elements.drawerAddBtn = drawer.querySelector('.drawer-add-btn');
        this.elements.drawerSuggestions = drawer.querySelector('.drawer-tag-suggestions');
        this.elements.drawerClose = drawer.querySelector('.drawer-close');
        this.elements.drawerCopyBtn = drawer.querySelector('.drawer-copy-btn');
        this.elements.drawerPasteBtn = drawer.querySelector('.drawer-paste-btn');

        // Bind drawer events
        this.elements.drawerClose.addEventListener('click', (e) => {
            e.stopPropagation();
            this.closeTagsDrawer();
        });

        this.elements.drawerAddBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.addTagFromDrawer();
        });

        this.elements.drawerTagInput.addEventListener('input', (e) => {
            this.showDrawerSuggestions(e.target.value);
        });

        this.elements.drawerTagInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const highlighted = this.elements.drawerSuggestions.querySelector(
                    '.drawer-suggestion.active'
                );
                if (highlighted) {
                    this.elements.drawerTagInput.value = highlighted.dataset.tag;
                    this.elements.drawerSuggestions.classList.add('hidden');
                    this.drawerHighlightedIndex = -1;
                }
                this.addTagFromDrawer();
            } else if (e.key === 'Tab') {
                if (!this.elements.drawerSuggestions.classList.contains('hidden')) {
                    e.preventDefault();
                    const items =
                        this.elements.drawerSuggestions.querySelectorAll('.drawer-suggestion');
                    const idx = this.drawerHighlightedIndex >= 0 ? this.drawerHighlightedIndex : 0;
                    if (items[idx]) {
                        this.elements.drawerTagInput.value = items[idx].dataset.tag;
                        this.elements.drawerSuggestions.classList.add('hidden');
                        this.drawerHighlightedIndex = -1;
                        this.addTagFromDrawer();
                    }
                }
            } else if (e.key === 'ArrowDown') {
                if (!this.elements.drawerSuggestions.classList.contains('hidden')) {
                    e.preventDefault();
                    const items =
                        this.elements.drawerSuggestions.querySelectorAll('.drawer-suggestion');
                    if (items.length > 0) {
                        this.drawerHighlightedIndex = Math.min(
                            this.drawerHighlightedIndex + 1,
                            items.length - 1
                        );
                        this.updateDrawerSuggestionHighlight();
                    }
                }
            } else if (e.key === 'ArrowUp') {
                if (!this.elements.drawerSuggestions.classList.contains('hidden')) {
                    e.preventDefault();
                    if (this.drawerHighlightedIndex > 0) {
                        this.drawerHighlightedIndex--;
                        this.updateDrawerSuggestionHighlight();
                    }
                }
            } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                if (!this.elements.drawerSuggestions.classList.contains('hidden')) {
                    this.elements.drawerSuggestions.classList.add('hidden');
                    this.drawerHighlightedIndex = -1;
                } else {
                    this.closeTagsDrawer();
                }
            }
        });

        // Copy button
        this.elements.drawerCopyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.copyTagsFromDrawer();
        });

        // Paste button
        this.elements.drawerPasteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.pasteTagsFromDrawer();
        });

        // Keyboard shortcuts within the drawer
        drawer.addEventListener('keydown', (e) => {
            // Don't intercept if user is typing in the input
            if (e.target.matches('input, textarea')) {
                return;
            }

            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
                e.preventDefault();
                e.stopPropagation();
                this.copyTagsFromDrawer();
            } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
                e.preventDefault();
                e.stopPropagation();
                this.pasteTagsFromDrawer();
            }
        });

        // Prevent clicks inside drawer from closing lightbox or hiding overlays
        drawer.addEventListener('click', (e) => e.stopPropagation());
        drawer.addEventListener(
            'touchstart',
            (e) => {
                if (!e.target.closest('.drawer-handle-bar')) {
                    e.stopPropagation();
                }
            },
            { passive: true }
        );
        drawer.addEventListener(
            'touchend',
            (e) => {
                e.stopPropagation();
                this.lastTouchTime = Date.now();
            },
            { passive: true }
        );

        // Swipe-down to dismiss on the handle bar
        const handleBar = drawer.querySelector('.drawer-handle-bar');
        this.bindDrawerSwipeDismiss(handleBar, drawer);

        lucide.createIcons();
    },

    /**
     * Copy the current lightbox item's tags to the TagClipboard.
     */
    copyTagsFromDrawer() {
        const file = this.items[this.currentIndex];
        if (!file) return;

        const tags = file.tags || [];
        if (tags.length === 0) {
            if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                Gallery.showToast('No tags to copy');
            }
            return;
        }

        if (typeof TagClipboard !== 'undefined') {
            TagClipboard.copyTagsDirect(tags, file.path, file.name);
            if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                Gallery.showToast(
                    `Copied ${tags.length} tag${tags.length !== 1 ? 's' : ''} from "${file.name}"`
                );
            }
            // Update paste button state now that clipboard has content
            this.updateDrawerPasteButton();
        }
    },

    /**
     * Open the paste confirmation modal targeting the current lightbox item.
     * Reuses the existing TagClipboard paste modal.
     */
    pasteTagsFromDrawer() {
        const file = this.items[this.currentIndex];
        if (!file) return;

        if (typeof TagClipboard === 'undefined' || !TagClipboard.hasTags()) {
            if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                Gallery.showToast('No tags in clipboard. Copy tags first.');
            }
            return;
        }

        // Don't allow pasting onto folders
        if (file.type === 'folder') {
            if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                Gallery.showToast('Cannot paste tags onto a folder');
            }
            return;
        }

        // Store a callback so we can refresh after paste completes
        this._pendingPasteRefresh = file.path;

        // Hook into the paste modal's confirm to refresh drawer afterwards.
        // We monkey-patch executePaste to add a post-paste refresh. We do this
        // by wrapping the original if we haven't already.
        this._ensurePasteRefreshHook();

        // Open the existing paste confirmation modal for this single item
        TagClipboard.openPasteModal([file.path], [file.name]);
    },

    /**
     * Ensures a one-time hook on TagClipboard.executePaste so that after
     * a paste completes, we refresh the drawer tags if it's still open.
     */
    _ensurePasteRefreshHook() {
        if (this._pasteRefreshHooked) return;
        this._pasteRefreshHooked = true;

        const originalExecutePaste = TagClipboard.executePaste.bind(TagClipboard);
        TagClipboard.executePaste = async (...args) => {
            await originalExecutePaste(...args);

            // After paste completes, refresh the current lightbox item's tags
            if (this._pendingPasteRefresh) {
                const refreshPath = this._pendingPasteRefresh;
                this._pendingPasteRefresh = null;

                await this._refreshTagsAfterPaste(refreshPath);
            }
        };
    },

    /**
     * Refresh tags for the given path after a paste/merge operation.
     * Updates the lightbox item data, drawer, summary, and gallery.
     */
    async _refreshTagsAfterPaste(path) {
        try {
            const response = await fetch(`/api/tags/file?path=${encodeURIComponent(path)}`);
            if (!response.ok) return;

            const tags = await response.json();

            // Update the item in our items array
            const file = this.items[this.currentIndex];
            if (file && file.path === path) {
                file.tags = tags || [];
                this.updateTagButton(file);
                this.updateTagSummary(file);

                // If the drawer is still open, re-render it
                if (this.tagsDrawerOpen) {
                    this.renderDrawerTags(file);
                    this.updateDrawerPasteButton();
                }
            }

            // Also refresh the gallery item's tag display
            if (typeof Tags !== 'undefined') {
                Tags.updateGalleryItemTagsDOM(path, tags || []);
            }
        } catch (error) {
            console.debug('Lightbox: failed to refresh tags after paste', error);
        }
    },

    /**
     * Update the paste button's disabled state based on clipboard contents.
     */
    updateDrawerPasteButton() {
        if (!this.elements.drawerPasteBtn) return;

        const hasClipboard = typeof TagClipboard !== 'undefined' && TagClipboard.hasTags();
        this.elements.drawerPasteBtn.disabled = !hasClipboard;

        if (hasClipboard) {
            const count = TagClipboard.copiedTags.length;
            const source = TagClipboard.sourceItemName || 'clipboard';
            this.elements.drawerPasteBtn.title = `Paste ${count} tag${count !== 1 ? 's' : ''} from "${source}" (Ctrl+V)`;
        } else {
            this.elements.drawerPasteBtn.title = 'No tags in clipboard';
        }
    },

    /**
     * Update the copy button's disabled state based on current item's tags.
     */
    updateDrawerCopyButton() {
        if (!this.elements.drawerCopyBtn) return;

        const file = this.items[this.currentIndex];
        const hasTags = file && file.tags && file.tags.length > 0;
        this.elements.drawerCopyBtn.disabled = !hasTags;

        if (hasTags) {
            this.elements.drawerCopyBtn.title = `Copy ${file.tags.length} tag${file.tags.length !== 1 ? 's' : ''} to clipboard (Ctrl+C)`;
        } else {
            this.elements.drawerCopyBtn.title = 'No tags to copy';
        }
    },

    bindDrawerSwipeDismiss(handleBar, drawer, closeFn) {
        closeFn = closeFn || (() => this.closeTagsDrawer());
        let startY = 0;
        let currentY = 0;
        let isDragging = false;

        handleBar.addEventListener(
            'touchstart',
            (e) => {
                startY = e.touches[0].clientY;
                isDragging = true;
                drawer.style.transition = 'none';
                e.stopPropagation();
            },
            { passive: true }
        );

        handleBar.addEventListener(
            'touchmove',
            (e) => {
                if (!isDragging) return;
                currentY = e.touches[0].clientY;
                const deltaY = currentY - startY;
                if (deltaY > 0) {
                    drawer.style.transform = `translateY(${deltaY}px)`;
                }
                e.stopPropagation();
            },
            { passive: true }
        );

        handleBar.addEventListener(
            'touchend',
            (e) => {
                if (!isDragging) return;
                isDragging = false;
                drawer.style.transition = '';
                drawer.style.transform = '';
                const deltaY = currentY - startY;
                if (deltaY > 80) {
                    closeFn();
                }
                currentY = 0;
                e.stopPropagation();
            },
            { passive: true }
        );
    },

    openTagsDrawer() {
        if (this.tagsDrawerOpen) return;
        this.tagsDrawerOpen = true;

        const file = this.items[this.currentIndex];
        if (!file) return;

        // Show drawer and backdrop
        this.elements.tagsDrawer.classList.remove('hidden');
        this.elements.drawerBackdrop.classList.remove('hidden');

        // Trigger animation
        requestAnimationFrame(() => {
            this.elements.tagsDrawer.classList.add('open');
            this.elements.drawerBackdrop.classList.add('open');
        });

        // Populate drawer tags
        this.renderDrawerTags(file);

        // Update clipboard button states
        this.updateDrawerCopyButton();
        this.updateDrawerPasteButton();

        // Load suggestions cache
        this.loadTagSuggestionsCache();

        // Clear input
        this.elements.drawerTagInput.value = '';
        this.elements.drawerSuggestions.classList.add('hidden');

        // Focus the tag input on desktop (non-touch) so the user can type immediately
        if (!('ontouchstart' in window)) {
            requestAnimationFrame(() => {
                this.elements.drawerTagInput.focus();
            });
        }

        // Show overlays while drawer is open
        this.userHidOverlays = true;
        this.showUIOverlays();

        // Push history state
        if (typeof HistoryManager !== 'undefined') {
            HistoryManager.pushState('lightbox-drawer');
        }

        this._bindDrawerViewportResize();
    },

    closeTagsDrawer() {
        if (!this.tagsDrawerOpen) return;
        this.tagsDrawerOpen = false;

        this._unbindDrawerViewportResize();

        this.elements.tagsDrawer.classList.remove('open');
        this.elements.drawerBackdrop.classList.remove('open');

        // After animation, hide
        setTimeout(() => {
            if (!this.tagsDrawerOpen) {
                this.elements.tagsDrawer.classList.add('hidden');
                this.elements.drawerBackdrop.classList.add('hidden');
            }
        }, 300);

        // Resume auto-hide
        this.userHidOverlays = false;
        this.hideUIOverlaysDelayed();

        // Remove history state
        if (typeof HistoryManager !== 'undefined' && HistoryManager.hasState('lightbox-drawer')) {
            HistoryManager.removeState('lightbox-drawer');
        }
    },

    // _bindDrawerViewportResize / _unbindDrawerViewportResize
    // -------------------------------------------------------------------------
    // The lightbox is `position:fixed` and the tags drawer is `position:absolute`
    // inside it. On iOS (pre-15.4) the soft keyboard does not shrink `100vh`, so
    // the lightbox stays full layout-viewport height and the drawer's `bottom:0`
    // anchor sits under the keyboard. We listen to visualViewport resize events
    // and clamp the lightbox height to the visual-viewport height so that
    // `bottom:0` of the drawer always resolves to just above the keyboard.
    // Browsers that support `dvh` (iOS 15.4+, Chrome 108+) handle this via CSS
    // already; the inline style set here will still be applied but is equivalent.
    _bindDrawerViewportResize() {
        if (!window.visualViewport || !this.elements.lightbox) return;
        this._drawerViewportHandler = () => {
            if (this.tagsDrawerOpen) {
                this.elements.lightbox.style.height = window.visualViewport.height + 'px';
            }
        };
        window.visualViewport.addEventListener('resize', this._drawerViewportHandler);
        this._drawerViewportHandler(); // apply immediately in case keyboard already open
    },

    _unbindDrawerViewportResize() {
        if (this._drawerViewportHandler && window.visualViewport) {
            window.visualViewport.removeEventListener('resize', this._drawerViewportHandler);
            this._drawerViewportHandler = null;
        }
        if (this.elements.lightbox) {
            this.elements.lightbox.style.height = '';
        }
    },

    closeTagsDrawerWithHistory() {
        if (typeof HistoryManager !== 'undefined' && HistoryManager.hasState('lightbox-drawer')) {
            history.back();
        } else {
            this.closeTagsDrawer();
        }
    },

    renderDrawerTags(file) {
        const tags = file.tags || [];
        const container = this.elements.drawerTagsList;
        container.innerHTML = '';

        if (tags.length === 0) {
            this.elements.drawerEmptyState.classList.remove('hidden');
            this.updateDrawerCopyButton();
            return;
        }

        this.elements.drawerEmptyState.classList.add('hidden');

        tags.forEach((tag) => {
            const chip = document.createElement('div');
            chip.className = 'drawer-tag-chip';
            chip.dataset.tag = tag;
            chip.innerHTML = `
            <button class="drawer-tag-remove" title="Remove tag">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
            <span class="drawer-tag-divider"></span>
            <span class="drawer-tag-text">${this.escapeHtml(tag)}</span>
        `;

            const removeBtn = chip.querySelector('.drawer-tag-remove');
            removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.removeTagFromDrawer(file.path, tag);
            });

            const tagText = chip.querySelector('.drawer-tag-text');
            tagText.addEventListener('click', (e) => {
                e.stopPropagation();

                const searchTag = tag;

                this.tagsDrawerOpen = false;
                this.elements.tagsDrawer.classList.remove('open');
                this.elements.drawerBackdrop.classList.remove('open');
                setTimeout(() => {
                    this.elements.tagsDrawer.classList.add('hidden');
                    this.elements.drawerBackdrop.classList.add('hidden');
                }, 300);

                if (
                    typeof HistoryManager !== 'undefined' &&
                    HistoryManager.hasState('lightbox-drawer')
                ) {
                    HistoryManager.removeState('lightbox-drawer');
                }

                this.close();

                if (typeof HistoryManager !== 'undefined' && HistoryManager.hasState('lightbox')) {
                    HistoryManager.removeState('lightbox');
                }

                if (typeof Tags !== 'undefined') {
                    Tags.searchByTag(searchTag);
                }
            });

            container.appendChild(chip);
        });

        // Update copy button state after rendering tags
        this.updateDrawerCopyButton();
    },

    async removeTagFromDrawer(path, tagName) {
        try {
            const response = await fetch('/api/tags/file', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path, tag: tagName }),
            });

            if (response.ok) {
                const file = this.items[this.currentIndex];
                if (file && file.path === path) {
                    file.tags = file.tags.filter((t) => t !== tagName);
                    this.renderDrawerTags(file);
                    this.updateTagSummary(file);
                    this.updateTagButton(file);
                    // file.tags is already correct — update the gallery card directly
                    // instead of making a redundant GET /api/tags/file round-trip.
                    // Removing a tag never creates new tags, so loadAllTags() is
                    // also unnecessary here.
                    if (typeof Tags !== 'undefined') {
                        Tags.updateGalleryItemTagsDOM(path, file.tags);
                    }
                }

                if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                    Gallery.showToast(`Removed tag "${tagName}"`);
                }
            }
        } catch (error) {
            console.error('Error removing tag:', error);
            if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                Gallery.showToast('Failed to remove tag');
            }
        }
    },

    async addTagFromDrawer() {
        const input = this.elements.drawerTagInput;
        const tagName = input.value.trim();
        if (!tagName) return;

        const file = this.items[this.currentIndex];
        if (!file) return;

        // Check if tag already exists
        if (file.tags && file.tags.includes(tagName)) {
            if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                Gallery.showToast(`Tag "${tagName}" already exists`);
            }
            input.value = '';
            this.elements.drawerSuggestions.classList.add('hidden');
            return;
        }

        try {
            const response = await fetch('/api/tags/file', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: file.path, tag: tagName }),
            });

            if (response.ok) {
                if (!file.tags) file.tags = [];
                file.tags.push(tagName);
                this.renderDrawerTags(file);
                this.updateTagSummary(file);
                this.updateTagButton(file);

                input.value = '';
                this.elements.drawerSuggestions.classList.add('hidden');

                // file.tags already contains the new tag — update the gallery card
                // directly instead of making a redundant GET /api/tags/file round-trip.
                // Also invalidate allTagSuggestions so a newly-added tag appears in
                // autocomplete; reload the cache immediately so suggestions keep working
                // while the drawer remains open.
                if (typeof Tags !== 'undefined') {
                    Tags.updateGalleryItemTagsDOM(file.path, file.tags);
                    Tags.loadAllTags();
                }
                this.allTagSuggestions = [];
                this.loadTagSuggestionsCache();
            }
        } catch (error) {
            console.error('Error adding tag:', error);
            if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                Gallery.showToast('Failed to add tag');
            }
        }
    },

    async loadTagSuggestionsCache() {
        if (this.allTagSuggestions.length > 0) return;
        try {
            const response = await fetch('/api/tags');
            if (response.ok) {
                this.allTagSuggestions = await response.json();
            }
        } catch (error) {
            console.debug('Failed to load tag suggestions:', error);
        }
    },

    updateDrawerSuggestionHighlight() {
        const items = this.elements.drawerSuggestions.querySelectorAll('.drawer-suggestion');
        items.forEach((item, i) => {
            item.classList.toggle('active', i === this.drawerHighlightedIndex);
        });
    },

    showDrawerSuggestions(query) {
        this.drawerHighlightedIndex = -1;
        query = query.trim().toLowerCase();
        if (query.length === 0) {
            this.elements.drawerSuggestions.classList.add('hidden');
            return;
        }

        const file = this.items[this.currentIndex];
        const existingTags = file?.tags || [];

        const matches = this.allTagSuggestions
            .filter(
                (tag) => tag.name.toLowerCase().includes(query) && !existingTags.includes(tag.name)
            )
            .slice(0, 5);

        if (matches.length === 0) {
            this.elements.drawerSuggestions.classList.add('hidden');
            return;
        }

        this.elements.drawerSuggestions.innerHTML = matches
            .map(
                (tag) => `
                <div class="drawer-suggestion" data-tag="${this.escapeAttr(tag.name)}">
                    ${this.highlightMatch(tag.name, query)}
                    <span class="drawer-suggestion-count">(${tag.itemCount})</span>
                </div>
            `
            )
            .join('');

        this.elements.drawerSuggestions.querySelectorAll('.drawer-suggestion').forEach((el) => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                this.elements.drawerTagInput.value = el.dataset.tag;
                this.addTagFromDrawer();
            });
        });

        this.elements.drawerSuggestions.classList.remove('hidden');
    },

    highlightMatch(text, query) {
        if (!query || query.length === 0) return this.escapeHtml(text);
        const lowerText = text.toLowerCase();
        const idx = lowerText.indexOf(query);
        if (idx === -1) return this.escapeHtml(text);
        return (
            this.escapeHtml(text.substring(0, idx)) +
            '<mark>' +
            this.escapeHtml(text.substring(idx, idx + query.length)) +
            '</mark>' +
            this.escapeHtml(text.substring(idx + query.length))
        );
    },

    updateTagSummary(file) {
        if (!this.elements.tagSummary) return;
        const tags = file.tags || [];

        if (tags.length === 0) {
            this.elements.tagSummary.classList.add('hidden');
            return;
        }

        this.elements.tagSummary.classList.remove('hidden');
        const textEl = this.elements.tagSummary.querySelector('.tag-summary-text');
        if (!textEl) return;

        // Show first 2-3 tags as plain text + overflow count
        const maxVisible = 3;
        const visible = tags.slice(0, maxVisible);
        const overflow = tags.length - maxVisible;

        let summaryText = visible.join(', ');
        if (overflow > 0) {
            summaryText += ` +${overflow}`;
        }
        textEl.textContent = summaryText;
    },

    // =========================================
    // END TAGS DRAWER
    // =========================================

    createHotZones() {
        const leftZone = document.createElement('div');
        leftZone.className = 'lightbox-hot-zone lightbox-hot-zone-left';
        leftZone.innerHTML = '<i data-lucide="chevron-left" class="lightbox-hot-zone-icon"></i>';
        leftZone.addEventListener('click', (e) => {
            e.stopPropagation();
            this.prev();
        });

        const rightZone = document.createElement('div');
        rightZone.className = 'lightbox-hot-zone lightbox-hot-zone-right';
        rightZone.innerHTML = '<i data-lucide="chevron-right" class="lightbox-hot-zone-icon"></i>';
        rightZone.addEventListener('click', (e) => {
            e.stopPropagation();
            this.next();
        });

        this.elements.content.appendChild(leftZone);
        this.elements.content.appendChild(rightZone);
        this.elements.hotZoneLeft = leftZone;
        this.elements.hotZoneRight = rightZone;
        lucide.createIcons();
    },

    updateHotZonePositions() {
        const video = this.elements.video;
        const leftZone = this.elements.hotZoneLeft;
        const rightZone = this.elements.hotZoneRight;
        if (!leftZone || !rightZone) return;

        if (!this.elements.lightbox.classList.contains('video-mode')) {
            leftZone.style.bottom = '';
            rightZone.style.bottom = '';
            return;
        }

        if (video && !video.classList.contains('hidden')) {
            if (!video.videoHeight || !video.videoWidth) return;
            const videoRect = video.getBoundingClientRect();
            const viewportHeight = window.innerHeight;
            const videoBottom = viewportHeight - videoRect.bottom;
            const controlsBottom =
                this.elements.videoWrapper?.querySelector('.video-controls-bottom');
            let controlsHeight;
            if (controlsBottom) {
                controlsHeight = controlsBottom.getBoundingClientRect().height;
            } else {
                controlsHeight = 60;
            }
            const padding = 12;
            const bottomPosition = videoBottom + controlsHeight + padding;
            leftZone.style.bottom = `${bottomPosition}px`;
            rightZone.style.bottom = `${bottomPosition}px`;
        }
    },

    createLoadingIndicator() {
        const loader = document.createElement('div');
        loader.className = 'lightbox-loader hidden';
        loader.innerHTML = '<div class="lightbox-spinner"></div>';
        this.elements.content.appendChild(loader);
        this.elements.loader = loader;
    },

    bindEvents() {
        this.elements.closeBtn.addEventListener('click', () => this.closeWithHistory());
        this.elements.prevBtn.addEventListener('click', () => this.prev());
        this.elements.nextBtn.addEventListener('click', () => this.next());
        this.elements.pinBtn.addEventListener('click', () => this.togglePin());

        document.addEventListener('keydown', (e) => {
            if (this.elements.lightbox.classList.contains('hidden')) return;

            if (e.target.matches('input, textarea, [contenteditable="true"]')) {
                if (e.key === 'Escape') {
                    // Close drawer first if open
                    if (this.tagsDrawerOpen) {
                        if (!this.elements.drawerSuggestions.classList.contains('hidden')) {
                            this.elements.drawerSuggestions.classList.add('hidden');
                        } else {
                            this.closeTagsDrawerWithHistory();
                        }
                        return;
                    }
                    if (!document.getElementById('tag-modal')?.classList.contains('hidden')) {
                        Tags.closeModalWithHistory();
                        return;
                    }
                    this.closeWithHistory();
                }
                return;
            }

            switch (e.key) {
                case 'Escape':
                    if (this.tagsDrawerOpen) {
                        this.closeTagsDrawerWithHistory();
                    } else {
                        this.closeWithHistory();
                    }
                    break;
                case 'ArrowLeft':
                    if (!this.tagsDrawerOpen) this.prev();
                    break;
                case 'ArrowRight':
                    if (!this.tagsDrawerOpen) this.next();
                    break;
                case ' ':
                    if (this.elements.video && !this.elements.video.classList.contains('hidden')) {
                        e.preventDefault();
                        if (this.elements.video.paused) {
                            this.elements.video.play();
                        } else {
                            this.elements.video.pause();
                        }
                    }
                    break;
                case 'f':
                case 'F':
                    this.togglePin();
                    break;
                case 't':
                case 'T':
                    if (this.tagsDrawerOpen) {
                        this.closeTagsDrawerWithHistory();
                    } else {
                        this.openTagsDrawer();
                    }
                    break;
                case 'c':
                case 'C':
                    if (this.collectionDrawerOpen) {
                        this.closeCollectionDrawerWithHistory();
                    } else {
                        this.openCollectionDrawer();
                    }
                    break;
                case 'a':
                case 'A':
                    if (!this.elements.autoplayBtn?.classList.contains('hidden')) {
                        this.toggleAutoplay();
                    }
                    break;
                case 'l':
                case 'L':
                    if (!this.elements.loopBtn?.classList.contains('hidden')) {
                        this.toggleLoop();
                    }
                    break;
                case 'd':
                case 'D':
                    this.downloadCurrent();
                    break;
            }
        });

        // Swipe handling
        this.elements.lightbox.addEventListener(
            'touchstart',
            (e) => {
                if (e.target.closest('.video-controls')) return;
                if (e.target.closest('.lightbox-tags-drawer')) return;
                if (e.target.closest('.lightbox-collection-drawer')) return;
                if (e.target.closest('.lightbox-drawer-backdrop')) return;
                if (this.zoom.scale > 1 || e.touches.length > 1) return;
                this.touchStartX = e.changedTouches[0].screenX;
                this.touchStartY = e.changedTouches[0].screenY;
                this.isSwiping = false;
                this.lastTouchMoveTime = 0;
                this.swipeDownTracking = false;
                this.swipeDownStartTime = 0;
                this.swipeDownLastY = 0;
            },
            { passive: true }
        );

        this.elements.lightbox.addEventListener(
            'touchmove',
            (e) => {
                if (e.target.closest('.video-controls')) return;
                if (e.target.closest('.lightbox-tags-drawer')) return;
                if (e.target.closest('.lightbox-collection-drawer')) return;
                if (this.zoom.scale > 1 || this.zoom.isPinching || this.zoom.isPanning) return;

                const touch = e.changedTouches[0];
                const rawDeltaX = touch.screenX - this.touchStartX;
                const rawDeltaY = touch.screenY - this.touchStartY;
                const deltaX = Math.abs(rawDeltaX);
                const deltaY = Math.abs(rawDeltaY);

                // Commit to one axis on the first significant movement.
                if (!this.isSwiping && !this.swipeDownTracking) {
                    if (deltaX > deltaY && deltaX > 10) {
                        this.isSwiping = true;
                    } else if (deltaY > deltaX && deltaY > 10 && rawDeltaY > 0) {
                        // Dominant downward movement — start swipe-to-close tracking.
                        this.swipeDownTracking = true;
                        this.swipeDownStartTime = Date.now();
                        this.elements.lightbox.classList.add('swiping-down');
                    }
                }

                if (this.swipeDownTracking) {
                    // Prevent browser pull-to-refresh while tracking.
                    e.preventDefault();
                    const offset = Math.max(0, rawDeltaY);
                    this._applySwipeDownOffset(offset);
                    this.swipeDownLastY = touch.screenY;
                }

                this.lastTouchMoveTime = Date.now();
            },
            // passive:false required so we can call preventDefault() when
            // tracking a downward swipe (prevents browser pull-to-refresh).
            { passive: false }
        );

        this.elements.lightbox.addEventListener(
            'touchend',
            (e) => {
                if (this.zoom.scale > 1) return;
                if (e.target.closest('.lightbox-tags-drawer')) return;
                if (e.target.closest('.lightbox-collection-drawer')) return;

                if (this.swipeDownTracking) {
                    const rawDeltaY = e.changedTouches[0].screenY - this.touchStartY;
                    const offset = Math.max(0, rawDeltaY);
                    const elapsed = Math.max(1, Date.now() - this.swipeDownStartTime);
                    const velocity = offset / elapsed; // px / ms
                    const distThreshold = Math.min(120, window.innerHeight * 0.3);
                    if (offset > distThreshold || velocity > 0.5) {
                        this._commitSwipeDown();
                    } else {
                        this._cancelSwipeDown();
                    }
                    return;
                }

                if (this.isSwiping) {
                    const timeSinceLastMove = Date.now() - this.lastTouchMoveTime;
                    if (this.lastTouchMoveTime > 0 && timeSinceLastMove > 300) {
                        this.isSwiping = false;
                        return;
                    }
                    this.touchEndX = e.changedTouches[0].screenX;
                    this.handleSwipe();
                }
            },
            { passive: true }
        );

        this.elements.lightbox.addEventListener('click', (e) => {
            if (e.target === this.elements.lightbox) {
                // If controls are hidden a tap anywhere passes through the
                // invisible buttons to the lightbox background.  The first tap
                // should restore the controls, not close the lightbox.
                if (!this.uiOverlaysVisible) {
                    this.userHidOverlays = false;
                    this.showUIOverlays();
                } else {
                    this.closeWithHistory();
                }
            }
        });

        // Tag button now opens the drawer instead of the modal
        if (this.elements.tagBtn) {
            this.elements.tagBtn.addEventListener('click', () => {
                if (this.tagsDrawerOpen) {
                    this.closeTagsDrawerWithHistory();
                } else {
                    this.openTagsDrawer();
                }
            });
        }

        if (this.elements.downloadBtn) {
            this.elements.downloadBtn.addEventListener('click', () => this.downloadCurrent());
        }

        window.addEventListener('resize', () => {
            if (this.elements.lightbox.classList.contains('video-mode')) {
                requestAnimationFrame(() => this.updateHotZonePositions());
            }
        });

        this.elements.video.addEventListener('loadedmetadata', () => {
            requestAnimationFrame(() => this.updateHotZonePositions());
        });

        // UI overlay hide/show
        let uiTouchStartTime = 0;

        this.elements.lightbox.addEventListener('touchstart', (e) => {
            if (
                !e.target.closest('.video-controls') &&
                !e.target.closest('.lightbox-tags-drawer')
            ) {
                uiTouchStartTime = Date.now();
                this.lastTouchTime = Date.now();
            }
        });

        this.elements.lightbox.addEventListener('touchend', (e) => {
            const touchDuration = Date.now() - uiTouchStartTime;
            if (touchDuration >= 300 || this.isSwiping || this.zoom.scale > 1) return;
            if (
                e.target.closest('button') ||
                e.target.closest('input') ||
                e.target.closest('.video-controls') ||
                e.target.closest('.lightbox-tags-drawer') ||
                e.target.closest('.lightbox-drawer-backdrop') ||
                e.target.closest('.lightbox-tag-summary') ||
                e.target.closest('.lightbox-info') ||
                e.target.closest('.lightbox-hot-zone') ||
                e.target === this.elements.lightbox
            ) {
                return;
            }

            if (
                e.target === this.elements.image ||
                e.target === this.elements.video ||
                e.target === this.elements.content ||
                e.target.closest('.lightbox-content')
            ) {
                e.stopPropagation();
                if (this.uiOverlaysVisible) {
                    this.userHidOverlays = true;
                    this.hideUIOverlays();
                } else {
                    this.userHidOverlays = false;
                    this.showUIOverlays();
                }
            }
        });

        this.elements.lightbox.addEventListener('mousemove', () => {
            if (!this.elements.lightbox.classList.contains('hidden')) {
                const timeSinceTouch = Date.now() - this.lastTouchTime;
                if (timeSinceTouch < 500) return;
                this.userHidOverlays = false;
                this.showUIOverlays();
            }
        });
    },

    bindZoomEvents() {
        this.elements.image.addEventListener(
            'touchstart',
            (e) => {
                const now = Date.now();
                const timeSinceLastTap = now - this.zoom.lastTapTime;
                if (timeSinceLastTap < 300 && timeSinceLastTap > 0 && e.touches.length === 1) {
                    if (this.zoom.scale > 1) {
                        e.preventDefault();
                        e.stopPropagation();
                        this.resetZoom();
                        this.zoom.lastTapTime = 0;
                        return;
                    }
                }
                if (e.touches.length === 1) this.zoom.lastTapTime = now;

                if (e.touches.length === 2) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.zoom.isPinching = true;
                    this.zoom.initialDistance = this.getTouchDistance(e.touches);
                    this.zoom.initialScale = this.zoom.scale;
                    this.zoom.pinchCenterX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
                    this.zoom.pinchCenterY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
                } else if (e.touches.length === 1 && this.zoom.scale > 1) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.zoom.isPanning = true;
                    this.zoom.lastTouchX = e.touches[0].clientX;
                    this.zoom.lastTouchY = e.touches[0].clientY;
                }
            },
            { passive: false }
        );

        this.elements.image.addEventListener(
            'touchmove',
            (e) => {
                if (this.zoom.isPinching && e.touches.length === 2) {
                    e.preventDefault();
                    e.stopPropagation();
                    const currentDistance = this.getTouchDistance(e.touches);
                    const scale =
                        (currentDistance / this.zoom.initialDistance) * this.zoom.initialScale;
                    this.zoom.scale = Math.min(
                        Math.max(scale, this.zoom.minScale),
                        this.zoom.maxScale
                    );
                    this.applyZoomTransform();
                } else if (this.zoom.isPanning && e.touches.length === 1 && this.zoom.scale > 1) {
                    e.preventDefault();
                    e.stopPropagation();
                    const deltaX = e.touches[0].clientX - this.zoom.lastTouchX;
                    const deltaY = e.touches[0].clientY - this.zoom.lastTouchY;
                    this.zoom.translateX += deltaX;
                    this.zoom.translateY += deltaY;
                    this.constrainPan();
                    this.zoom.lastTouchX = e.touches[0].clientX;
                    this.zoom.lastTouchY = e.touches[0].clientY;
                    this.applyZoomTransform();
                }
            },
            { passive: false }
        );

        this.elements.image.addEventListener(
            'touchend',
            (e) => {
                if (this.zoom.isPinching) {
                    this.zoom.isPinching = false;
                    if (this.zoom.scale < 1.1) {
                        this.resetZoom();
                        if (
                            typeof HistoryManager !== 'undefined' &&
                            HistoryManager.hasState('lightbox-zoom')
                        ) {
                            HistoryManager.removeState('lightbox-zoom');
                        }
                    } else if (this.zoom.scale > 1 && this.zoom.initialScale <= 1) {
                        if (
                            typeof HistoryManager !== 'undefined' &&
                            !HistoryManager.hasState('lightbox-zoom')
                        ) {
                            HistoryManager.pushState('lightbox-zoom');
                        }
                    }
                }
                if (this.zoom.isPanning && e.touches.length === 0) {
                    this.zoom.isPanning = false;
                }
            },
            { passive: true }
        );

        this.elements.image.addEventListener(
            'touchcancel',
            () => {
                this.zoom.isPinching = false;
                this.zoom.isPanning = false;
            },
            { passive: true }
        );
    },

    getTouchDistance(touches) {
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
    },

    applyZoomTransform() {
        const transform = `translate(${this.zoom.translateX}px, ${this.zoom.translateY}px) scale(${this.zoom.scale})`;
        this.elements.image.style.transform = transform;
        this.elements.image.style.transition =
            this.zoom.isPinching || this.zoom.isPanning ? 'none' : 'transform 0.3s ease';
    },

    constrainPan() {
        if (this.zoom.scale <= 1) {
            this.zoom.translateX = 0;
            this.zoom.translateY = 0;
            return;
        }
        const img = this.elements.image;
        const parent = img.parentElement.getBoundingClientRect();
        const naturalWidth = img.naturalWidth;
        const naturalHeight = img.naturalHeight;
        if (!naturalWidth || !naturalHeight) return;

        const containerAspect = parent.width / parent.height;
        const imageAspect = naturalWidth / naturalHeight;
        let displayWidth, displayHeight;
        if (imageAspect > containerAspect) {
            displayWidth = parent.width;
            displayHeight = parent.width / imageAspect;
        } else {
            displayHeight = parent.height;
            displayWidth = parent.height * imageAspect;
        }

        const scaledWidth = displayWidth * this.zoom.scale;
        const scaledHeight = displayHeight * this.zoom.scale;
        const maxX = Math.max(0, (scaledWidth - parent.width) / 2);
        const maxY = Math.max(0, (scaledHeight - parent.height) / 2);
        this.zoom.translateX = Math.min(Math.max(this.zoom.translateX, -maxX), maxX);
        this.zoom.translateY = Math.min(Math.max(this.zoom.translateY, -maxY), maxY);
    },

    resetZoom() {
        this.zoom.scale = 1;
        this.zoom.translateX = 0;
        this.zoom.translateY = 0;
        this.zoom.isPinching = false;
        this.zoom.isPanning = false;
        this.applyZoomTransform();
        if (typeof HistoryManager !== 'undefined' && HistoryManager.hasState('lightbox-zoom')) {
            HistoryManager.removeState('lightbox-zoom');
        }
    },

    handleSwipe() {
        const swipeThreshold = 50;
        const diff = this.touchStartX - this.touchEndX;
        if (Math.abs(diff) > swipeThreshold) {
            if (diff > 0) {
                this.next();
            } else {
                this.prev();
            }
        }
    },

    // ── Swipe-to-close helpers ─────────────────────────────────────────────

    /**
     * Apply a live translateY + opacity to follow the finger.
     * Called on every touchmove while swipeDownTracking is true.
     */
    _applySwipeDownOffset(offset) {
        const lb = this.elements.lightbox;
        lb.style.transform = `translateY(${offset}px)`;
        // Fade from 1 down towards 0.4 over 400 px of travel.
        lb.style.opacity = String(Math.max(0.4, 1 - offset / 400).toFixed(3));
    },

    /**
     * Animate the lightbox back to its original position (gesture cancelled).
     * Spring-easing gives a satisfying snap-back feel.
     */
    _cancelSwipeDown() {
        this.swipeDownTracking = false;
        const lb = this.elements.lightbox;
        lb.classList.remove('swiping-down');
        lb.classList.add('swipe-cancel');
        lb.style.transform = 'translateY(0)';
        lb.style.opacity = '1';
        lb.addEventListener(
            'transitionend',
            () => {
                lb.classList.remove('swipe-cancel');
                lb.style.transform = '';
                lb.style.opacity = '';
            },
            { once: true }
        );
    },

    /**
     * Slide the lightbox off screen then close it.
     * The AbortController lets close() cancel the listener if it is called
     * directly before the transition finishes.
     */
    _commitSwipeDown() {
        this.swipeDownTracking = false;
        const lb = this.elements.lightbox;
        lb.classList.remove('swiping-down');
        lb.classList.add('swipe-commit');
        lb.style.transform = 'translateY(100vh)';
        lb.style.opacity = '0';
        this._swipeDownAbort = new AbortController();
        lb.addEventListener(
            'transitionend',
            () => {
                this._swipeDownAbort = null;
                lb.classList.remove('swipe-commit');
                lb.style.transform = '';
                lb.style.opacity = '';
                this.closeWithHistory();
            },
            { once: true, signal: this._swipeDownAbort.signal }
        );
    },

    open(index) {
        this.useAppMedia = true;
        this.items = MediaApp.state.mediaFiles;
        this.currentIndex = index;
        this.show();
    },

    openWithItems(items, index) {
        this.useAppMedia = false;
        this.items = items;
        this.currentIndex = index;
        // Opening with an arbitrary item list exits any active collection context.
        this._switchedCollectionId = null;
        this._switchedCollectionName = null;
        this._switchedCollectionItems = null;
        this.show();
    },

    openWithItemsNoHistory(items, index) {
        this.useAppMedia = false;
        this.items = items;
        this.currentIndex = index;
        this.clearPreloadCache();
        this.elements.lightbox.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
        this.uiOverlaysVisible = true;
        this.userHidOverlays = false;
        this.elements.lightbox.classList.remove('ui-overlays-hidden');
        if (typeof Preferences !== 'undefined') {
            this.elements.lightbox.classList.toggle(
                'clock-always-visible',
                Preferences.isClockAlwaysVisible()
            );
        }
        this.showMedia();
        this.updateNavigation();
        if (typeof HistoryManager !== 'undefined') {
            HistoryManager.pushState('lightbox');
        }
    },

    show() {
        this.clearPreloadCache();
        this.elements.lightbox.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
        this.uiOverlaysVisible = true;
        this.userHidOverlays = false;
        this.elements.lightbox.classList.remove('ui-overlays-hidden');
        if (typeof Preferences !== 'undefined') {
            this.elements.lightbox.classList.toggle(
                'clock-always-visible',
                Preferences.isClockAlwaysVisible()
            );
        }
        this.showMedia();
        this.updateNavigation();
        if (typeof HistoryManager !== 'undefined') {
            HistoryManager.pushState('lightbox');
        }
        this.acquireWakeLock();
    },

    close() {
        // Abort any in-flight swipe-to-close commit animation so its
        // transitionend listener does not call closeWithHistory() a second time.
        if (this._swipeDownAbort) {
            this._swipeDownAbort.abort();
            this._swipeDownAbort = null;
        }
        this.swipeDownTracking = false;
        const _lb = this.elements.lightbox;
        if (_lb) {
            _lb.classList.remove('swiping-down', 'swipe-cancel', 'swipe-commit');
            _lb.style.transform = '';
            _lb.style.opacity = '';
        }

        // Close drawers if open
        if (this.tagsDrawerOpen) {
            this.tagsDrawerOpen = false;
            this.elements.tagsDrawer?.classList.remove('open');
            this.elements.tagsDrawer?.classList.add('hidden');
            this.elements.drawerBackdrop?.classList.remove('open');
            this.elements.drawerBackdrop?.classList.add('hidden');
        }
        if (this.collectionDrawerOpen) {
            this.collectionDrawerOpen = false;
            this.elements.collectionDrawer?.classList.remove('open');
            this.elements.collectionDrawer?.classList.add('hidden');
            this.elements.collectionDrawerBackdrop?.classList.remove('open');
            this.elements.collectionDrawerBackdrop?.classList.add('hidden');
        }

        this.elements.lightbox.classList.add('hidden');
        document.body.style.overflow = '';

        // When the user browsed a collection from within the lightbox, update the
        // gallery grid now that the lightbox is dismissed and InfiniteScroll is safe
        // to modify.  Otherwise scroll the gallery to centre the last-viewed item.
        if (
            this._switchedCollectionId !== null &&
            typeof Collections !== 'undefined' &&
            this._switchedCollectionItems?.length
        ) {
            try {
                Collections.mergeCollectionIntoLibrary(
                    this._switchedCollectionId,
                    this._switchedCollectionName,
                    this._switchedCollectionItems
                );
            } catch (e) {
                console.error('[Lightbox.close] mergeCollectionIntoLibrary failed:', e);
            }
        } else if (this.useAppMedia) {
            const currentItem = this.items[this.currentIndex];
            if (currentItem?.path) {
                requestAnimationFrame(() => {
                    const el = document.querySelector(
                        `.gallery-item[data-path="${CSS.escape(currentItem.path)}"]`
                    );
                    el?.scrollIntoView({ block: 'center', behavior: 'instant' });
                });
            }
        }

        this.abortCurrentLoad();
        this.clearPreloadCache();
        this.stopAnimationLoopDetection();
        this.releaseWakeLock();
        this.resetZoom();

        if (this.uiOverlaysTimeout) {
            clearTimeout(this.uiOverlaysTimeout);
            this.uiOverlaysTimeout = null;
        }

        if (this.videoPlayer) {
            this.videoPlayer.destroy();
            this.videoPlayer = null;
        }
    },

    async acquireWakeLock() {
        if (typeof WakeLock !== 'undefined') {
            await WakeLock.acquire('lightbox media viewing');
        }
    },

    releaseWakeLock() {
        if (typeof WakeLock !== 'undefined') {
            const playerOpen =
                typeof Playlist !== 'undefined' &&
                !Playlist.elements?.modal?.classList.contains('hidden');
            if (!playerOpen) WakeLock.release();
        }
    },

    closeWithHistory() {
        if (typeof HistoryManager !== 'undefined' && HistoryManager.hasState('lightbox')) {
            history.back();
        } else {
            this.close();
        }
    },

    handleBackButton() {
        if (this.tagsDrawerOpen) {
            this.closeTagsDrawer();
        } else if (this.zoom.scale > 1) {
            this.resetZoom();
            if (typeof HistoryManager !== 'undefined' && HistoryManager.hasState('lightbox-zoom')) {
                HistoryManager.removeState('lightbox-zoom');
            }
        } else {
            this.close();
        }
    },

    showUIOverlays() {
        if (!this.uiOverlaysVisible) {
            this.uiOverlaysVisible = true;
            this.elements.lightbox.classList.remove('ui-overlays-hidden');
        }
        if (!this.userHidOverlays) {
            this.hideUIOverlaysDelayed();
        }
    },

    hideUIOverlays() {
        this.uiOverlaysVisible = false;
        this.elements.lightbox.classList.add('ui-overlays-hidden');
        if (this.uiOverlaysTimeout) {
            clearTimeout(this.uiOverlaysTimeout);
            this.uiOverlaysTimeout = null;
        }
    },

    hideUIOverlaysDelayed() {
        if (this.uiOverlaysTimeout) {
            clearTimeout(this.uiOverlaysTimeout);
            this.uiOverlaysTimeout = null;
        }
        this.uiOverlaysTimeout = setTimeout(() => {
            // Don't auto-hide if drawer is open
            if (!this.tagsDrawerOpen) {
                this.hideUIOverlays();
            }
            this.uiOverlaysTimeout = null;
        }, 3000);
    },

    prev() {
        if (this.items.length === 0) return;
        if (this.tagsDrawerOpen) this.closeTagsDrawer();
        this.currentIndex = (this.currentIndex - 1 + this.items.length) % this.items.length;
        this.showMedia();
        this.updateNavigation();
    },

    next() {
        if (this.items.length === 0) return;
        if (this.tagsDrawerOpen) this.closeTagsDrawer();
        this.currentIndex = (this.currentIndex + 1) % this.items.length;
        this.showMedia();
        this.updateNavigation();
    },

    updateNavigation() {
        const hasMultiple = this.items.length > 1;
        if (this.elements.hotZoneLeft)
            this.elements.hotZoneLeft.style.display = hasMultiple ? '' : 'none';
        if (this.elements.hotZoneRight)
            this.elements.hotZoneRight.style.display = hasMultiple ? '' : 'none';
        if (this.elements.prevBtn) this.elements.prevBtn.style.display = hasMultiple ? '' : 'none';
        if (this.elements.nextBtn) this.elements.nextBtn.style.display = hasMultiple ? '' : 'none';
    },

    abortCurrentLoad() {
        this.currentLoadId++;
        // Tear down the active player (including any hls.js instance).
        this.videoPlayer?.unload();
        const video = this.elements.video;
        if (video && !video.paused) video.pause();
        if (video && video.src) {
            video.removeAttribute('src');
            video.load();
        }
        const image = this.elements.image;
        if (image) image.removeAttribute('src');
    },

    showLoading() {
        this.loading = true;
        this.elements.loader?.classList.remove('hidden');
        this.elements.image.classList.add('loading');
        this.elements.video.classList.add('loading');
    },

    hideLoading() {
        this.loading = false;
        this.elements.loader?.classList.add('hidden');
        this.elements.image.classList.remove('loading');
        this.elements.video.classList.remove('loading');
        if (this.transcodingCheckTimeout) {
            clearTimeout(this.transcodingCheckTimeout);
            this.transcodingCheckTimeout = null;
        }
        const toast = document.getElementById('toast-notification');
        if (toast && toast.classList.contains('show')) {
            toast.classList.remove('show');
        }
    },

    showMedia() {
        if (this.items.length === 0) return;
        const file = this.items[this.currentIndex];
        if (!file) return;

        this.resetZoom();
        this.stopAnimationLoopDetection();
        this.abortCurrentLoad();

        const loadId = ++this.currentLoadId;

        this.elements.counter.textContent = `${this.currentIndex + 1} / ${this.items.length}`;
        this.elements.title.textContent = file.name;
        this.updatePinButton(file);

        if (file.tags === undefined) {
            file.tags = this.getTagsFromGallery(file.path) || [];
        }

        this.updateTagButton(file);
        this.updateTagSummary(file);
        this.updateCollectionButton(file);

        // Update drawer if it's open
        if (this.tagsDrawerOpen) {
            this.renderDrawerTags(file);
        }

        this.elements.image.classList.add('hidden');
        this.elements.video.classList.add('hidden');

        const isVideo = file.type === 'video';
        const showLoopButton = this.shouldShowLoopButton(file);

        if (!isVideo && this.videoPlayer) {
            this.videoPlayer.destroy();
            this.videoPlayer = null;
        }

        this.elements.lightbox.classList.toggle('video-mode', isVideo);

        if (isVideo) {
            this.updateHotZonePositions();
        } else {
            this.updateHotZonePositions();
        }

        if (this.elements.autoplayBtn) {
            this.elements.autoplayBtn.classList.toggle('hidden', !isVideo);
        }
        if (this.elements.loopBtn) {
            this.elements.loopBtn.classList.toggle('hidden', !showLoopButton);
            this.updateLoopButton();
        }

        if (file.type === 'image') {
            this.loadImage(file, loadId);
        } else if (file.type === 'video') {
            this.loadVideo(file, loadId);
        }

        this.preloadAdjacent();

        if (!this.userHidOverlays) {
            this.hideUIOverlaysDelayed();
        }
    },

    getTagsFromGallery(path) {
        // Use the O(1) path-to-element map maintained by InfiniteScroll when
        // available, falling back to a full DOM scan for non-infinite-scroll
        // contexts (search, playlist, etc.).
        const galleryItem =
            (typeof InfiniteScroll !== 'undefined' &&
                InfiniteScroll._galleryItemsByPath?.get(path)) ||
            document.querySelector(`.gallery-item[data-path="${CSS.escape(path)}"]`);
        if (!galleryItem) return null;
        const tagsContainer = galleryItem.querySelector('.gallery-item-tags');
        if (!tagsContainer && !galleryItem.querySelector('.tag-button.has-tags')) return [];
        if (!tagsContainer) return null;

        const allTagsData = tagsContainer.dataset.allTags;
        if (allTagsData) {
            try {
                return JSON.parse(allTagsData);
            } catch {
                /* fall through */
            }
        }

        const tagElements = tagsContainer.querySelectorAll('.item-tag:not(.more)');
        const tags = [];
        tagElements.forEach((el) => {
            const tagText = el.dataset.tag || el.textContent?.trim();
            if (tagText) tags.push(tagText);
        });
        return tags.length > 0 ? tags : [];
    },

    async fetchAndUpdateTags(file) {
        this.updateTagButton(file);
        this.updateTagSummary(file);
        try {
            const response = await fetch(`/api/tags/file?path=${encodeURIComponent(file.path)}`);
            if (response.ok) {
                const tags = await response.json();
                file.tags = tags || [];
                this.updateTagButton(file);
                this.updateTagSummary(file);
                if (this.tagsDrawerOpen) this.renderDrawerTags(file);
            }
        } catch (error) {
            console.debug('Lightbox: failed to fetch tags for', file.path, error);
        }
    },

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    escapeAttr(text) {
        if (!text) return '';
        return text
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    },

    loadImage(file, loadId) {
        const imageUrl = `/api/files/${file.path.split('/').map(encodeURIComponent).join('/')}`;
        if (this.preloadCache.has(imageUrl)) {
            const cachedImg = this.preloadCache.get(imageUrl);
            if (cachedImg && cachedImg.complete && cachedImg.naturalWidth > 0) {
                this.elements.image.src = cachedImg.src;
                this.elements.image.classList.remove('hidden');
                this.hideLoading();
                if (this.isAnimatedImageType(file.name)) {
                    setTimeout(() => this.startAnimationLoopDetection(), 100);
                }
                return;
            }
        }

        this.showLoading();
        const controller = new AbortController();
        let loadComplete = false;

        const handleError = (isTimeout = false) => {
            if (loadComplete) return;
            loadComplete = true;
            controller.abort();
            if (loadId !== this.currentLoadId) return;
            this.hideLoading();

            const now = Date.now();
            if (now - this.imageFailures.lastFailureTime > 15000) {
                this.imageFailures.consecutiveFailures = 0;
            }
            this.imageFailures.consecutiveFailures++;
            this.imageFailures.lastFailureTime = now;
            this.imageFailures.currentFailedImage = { file, loadId, imageUrl };

            if (isTimeout) {
                console.error('Image load timeout:', file.path);
                if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                    Gallery.showToast('Server not responding. Cannot load image.', 'error');
                }
            } else {
                console.error('Failed to load image:', file.path);
                this.checkImageAuthError(imageUrl);
            }

            if (this.imageFailures.consecutiveFailures >= 2) {
                if (typeof Gallery !== 'undefined' && Gallery.thumbnailFailures) {
                    Gallery.thumbnailFailures.count = Math.max(Gallery.thumbnailFailures.count, 2);
                    Gallery.thumbnailFailures.lastFailureTime = Date.now();
                    if (!Gallery.thumbnailFailures.connectivityCheckInProgress) {
                        Gallery.startConnectivityCheck();
                    }
                }
            }
            this.elements.image.classList.remove('hidden');
            this.elements.image.src = '';
        };

        const timeoutId = setTimeout(() => handleError(true), 5000);

        fetch(imageUrl, { signal: controller.signal })
            .then((response) => {
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return response.blob();
            })
            .then(async (blob) => {
                if (loadComplete || loadId !== this.currentLoadId) return;
                loadComplete = true;
                clearTimeout(timeoutId);
                this.imageFailures.consecutiveFailures = 0;
                this.imageFailures.currentFailedImage = null;

                if (file.name && file.name.toLowerCase().endsWith('.gif')) {
                    file.gifLoopCount = await this.parseGifLoopCount(blob);
                }

                const blobUrl = URL.createObjectURL(blob);
                const img = new Image();
                img.onload = () => {
                    if (loadId !== this.currentLoadId) {
                        URL.revokeObjectURL(blobUrl);
                        return;
                    }
                    this.elements.image.src = blobUrl;
                    this.elements.image.classList.remove('hidden');
                    this.hideLoading();
                    this.preloadCache.set(imageUrl, img);
                    if (this.isAnimatedImageType(file.name)) {
                        setTimeout(() => this.startAnimationLoopDetection(), 100);
                    }
                };
                img.src = blobUrl;
            })
            .catch((error) => {
                if (loadComplete) return;
                const isTimeout = error.name === 'AbortError';
                handleError(isTimeout);
            });
    },

    retryCurrentImage() {
        if (!this.imageFailures.currentFailedImage) return;
        const { file, loadId } = this.imageFailures.currentFailedImage;
        if (loadId === this.currentLoadId) {
            if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                Gallery.showToast('Connection restored. Retrying image...');
            }
            const imageUrl = `/api/files/${file.path.split('/').map(encodeURIComponent).join('/')}`;
            this.preloadCache.delete(imageUrl);
            this.imageFailures.currentFailedImage = null;
            this.showMedia();
        } else {
            this.imageFailures.currentFailedImage = null;
        }
    },

    async checkImageAuthError(imageUrl) {
        try {
            const response = await fetch(imageUrl, { method: 'HEAD' });
            if (response.status === 401) {
                if (typeof SessionManager !== 'undefined') {
                    SessionManager.handleSessionExpired();
                } else {
                    window.location.replace('/login.html');
                }
            }
        } catch (e) {
            console.debug('Lightbox: image check failed', e);
        }
    },

    checkVideoTranscodingStatus(filePath, loadId) {
        this.transcodingCheckTimeout = setTimeout(() => {
            if (loadId !== this.currentLoadId || !this.loading) return;
            if (typeof Gallery !== 'undefined' && typeof Gallery.showToast === 'function') {
                Gallery.showToast(
                    'Preparing video for playback. Large files may take a few minutes...',
                    'info',
                    0
                );
            }
        }, 3000);
    },

    loadVideo(file, loadId) {
        this.showLoading();
        const video = this.elements.video;
        this.initVideoPlayer();

        if (loadId !== this.currentLoadId) return;

        const loadTimeoutId = setTimeout(
            () => {
                if (loadId !== this.currentLoadId) return;
                console.error('Video load timeout:', file.path);
                this.hideLoading();
                if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                    Gallery.showToast(
                        'Video load timeout. Server may be transcoding a large file or experiencing issues.',
                        'error'
                    );
                }
            },
            5 * 60 * 1000
        );

        this.videoPlayer.loadSource(file.path, {
            loop: Preferences.isMediaLoopEnabled(),
            autoplay: Preferences.isVideoAutoplayEnabled(),
            onReady: () => {
                if (loadId !== this.currentLoadId) return;
                clearTimeout(loadTimeoutId);
                video.classList.remove('hidden');
                this.hideLoading();
                requestAnimationFrame(() => this.updateHotZonePositions());
            },
            onError: async (_e) => {
                if (loadId !== this.currentLoadId) return;
                clearTimeout(loadTimeoutId);
                console.error('Lightbox: error loading video:', file.path);
                this.hideLoading();
                const videoUrl = `/api/stream/${file.path.split('/').map(encodeURIComponent).join('/')}`;
                try {
                    const response = await fetchWithTimeout(videoUrl, {
                        method: 'HEAD',
                        timeout: 3000,
                    });
                    if (response.status === 401) {
                        if (typeof SessionManager !== 'undefined')
                            SessionManager.handleSessionExpired();
                        else window.location.replace('/login.html');
                    } else if (response.status === 500) {
                        if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                            Gallery.showToast(
                                'Failed to load video. The file may be corrupted or incompatible with transcoding.',
                                'error',
                                10000
                            );
                        }
                    } else if (response.status >= 400) {
                        if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                            Gallery.showToast(
                                `Failed to load video (Error ${response.status})`,
                                'error',
                                8000
                            );
                        }
                    }
                } catch (err) {
                    console.debug('Lightbox: video auth check failed', err);
                }
            },
            onFallback: () => {
                if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                    Gallery.showToast(
                        'HLS streaming error — falling back to direct stream.',
                        'warning',
                        5000
                    );
                }
            },
        });

        this.checkVideoTranscodingStatus(file.path, loadId);
    },

    initVideoPlayer() {
        if (this.videoPlayer) {
            // destroy() calls unload() which also tears down any hls.js instance.
            this.videoPlayer.destroy();
            this.videoPlayer = null;
        }
        if (typeof VideoPlayer !== 'undefined') {
            this.videoPlayer = new VideoPlayer({
                video: this.elements.video,
                container: this.elements.videoWrapper,
                showNavigation: true,
                onPrevious: () => this.prev(),
                onNext: () => this.next(),
            });
        }
    },

    clearPreloadCache() {
        this.preloadCache.clear();
        this.preloadQueue = [];
    },

    preloadAdjacent() {
        if (this.items.length <= 1) return;
        const indicesToPreload = [];
        for (let i = 1; i <= this.maxPreload; i++) {
            const nextIndex = (this.currentIndex + i) % this.items.length;
            indicesToPreload.push({ index: nextIndex, distance: i, direction: 'next' });
            const prevIndex = (this.currentIndex - i + this.items.length) % this.items.length;
            if (prevIndex !== nextIndex) {
                indicesToPreload.push({ index: prevIndex, distance: i, direction: 'prev' });
            }
        }
        indicesToPreload.sort((a, b) => {
            if (a.direction !== b.direction) return a.direction === 'next' ? -1 : 1;
            return a.distance - b.distance;
        });

        const pathsNeedingTags = [];
        indicesToPreload.forEach((entry, index) => {
            const item = this.items[entry.index];
            if (!item) return;
            if (item.type === 'image') {
                const priority = index < 2 ? 'high' : 'low';
                this.preloadImage(item, priority);
            }
            if (item.tags === undefined) {
                const galleryTags = this.getTagsFromGallery(item.path);
                if (galleryTags !== null) {
                    item.tags = galleryTags;
                } else {
                    pathsNeedingTags.push(item.path);
                }
            }
        });

        if (pathsNeedingTags.length > 0) this.preloadTags(pathsNeedingTags);
        this.cleanPreloadCache();
    },

    async preloadTags(paths) {
        try {
            const response = await fetchWithTimeout('/api/tags/query', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ paths }),
                timeout: 5000,
            });
            if (response.ok) {
                const tagsData = await response.json();
                for (const item of this.items) {
                    if (paths.includes(item.path)) {
                        item.tags = tagsData[item.path] || [];
                    }
                }
            }
        } catch (error) {
            console.debug('Lightbox: failed to preload tags', error);
        }
    },

    preloadImage(file, _ = 'low') {
        const imageUrl = `/api/files/${file.path.split('/').map(encodeURIComponent).join('/')}`;
        if (this.preloadCache.has(imageUrl)) return;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
            controller.abort();
            this.preloadCache.delete(imageUrl);
        }, 5000);
        this.preloadCache.set(imageUrl, null);

        fetch(imageUrl, { signal: controller.signal })
            .then((response) => {
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return response.blob();
            })
            .then((blob) => {
                clearTimeout(timeoutId);
                const blobUrl = URL.createObjectURL(blob);
                const img = new Image();
                img.onload = () => {
                    this.preloadCache.set(imageUrl, img);
                    setTimeout(() => URL.revokeObjectURL(blobUrl), 100);
                };
                img.onerror = () => {
                    this.preloadCache.delete(imageUrl);
                    URL.revokeObjectURL(blobUrl);
                };
                img.src = blobUrl;
            })
            .catch(() => {
                clearTimeout(timeoutId);
                this.preloadCache.delete(imageUrl);
            });
    },

    cleanPreloadCache() {
        const maxCacheSize = this.maxPreload * 2 + 5;
        if (this.preloadCache.size <= maxCacheSize) return;

        const keepUrls = new Set();
        const currentItem = this.items[this.currentIndex];
        if (currentItem)
            keepUrls.add(
                `/api/files/${currentItem.path.split('/').map(encodeURIComponent).join('/')}`
            );
        for (let i = 1; i <= this.maxPreload; i++) {
            const nextItem = this.items[(this.currentIndex + i) % this.items.length];
            const prevItem =
                this.items[(this.currentIndex - i + this.items.length) % this.items.length];
            if (nextItem)
                keepUrls.add(
                    `/api/files/${nextItem.path.split('/').map(encodeURIComponent).join('/')}`
                );
            if (prevItem)
                keepUrls.add(
                    `/api/files/${prevItem.path.split('/').map(encodeURIComponent).join('/')}`
                );
        }
        for (const url of this.preloadCache.keys()) {
            if (!keepUrls.has(url)) this.preloadCache.delete(url);
        }
    },

    updatePinButton(file) {
        const isPinned =
            file.isFavorite || (typeof Favorites !== 'undefined' && Favorites.isPinned(file.path));
        this.elements.pinBtn.classList.toggle('pinned', isPinned);
        this.elements.pinBtn.title = isPinned
            ? 'Remove from favorites (F)'
            : 'Add to favorites (F)';
        // Icon (star SVG) was rendered once in _initStaticIcons().
        // Only the CSS class and title change — no DOM mutation, no lucide call.
    },

    togglePin() {
        if (this.items.length === 0) return;
        const file = this.items[this.currentIndex];
        if (!file) return;
        if (typeof Favorites !== 'undefined') {
            Favorites.toggleFavorite(file.path, file.name, file.type).then((isPinned) => {
                file.isFavorite = isPinned;
                this.updatePinButton(file);
            });
        }
    },

    onFavoriteChanged(path, isPinned) {
        const item = this.items.find((i) => i.path === path);
        if (item) {
            item.isFavorite = isPinned;
            if (this.items[this.currentIndex]?.path === path) this.updatePinButton(item);
        }
    },

    openTagModal() {
        // Now opens the drawer instead
        this.openTagsDrawer();
    },

    refreshCurrentItemTags() {
        if (this.items.length === 0) return;
        const file = this.items[this.currentIndex];
        if (!file) return;
        const updatedTags = this.getTagsFromGallery(file.path);
        if (updatedTags !== null) {
            file.tags = updatedTags;
            this.updateTagButton(file);
            this.updateTagSummary(file);
            if (this.tagsDrawerOpen) this.renderDrawerTags(file);
        }
    },

    /* =========================================================================
     * Collection drawer
     * =====================================================================*/

    createCollectionDrawer() {
        // Create the toolbar button
        const btn = document.createElement('button');
        btn.className = 'lightbox-collection-btn';
        btn.id = 'lightbox-collection';
        btn.title = 'Collections (C)';
        btn.innerHTML = '<i data-lucide="layers"></i>';
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.collectionDrawerOpen) {
                this.closeCollectionDrawerWithHistory();
            } else {
                this.openCollectionDrawer();
            }
        });

        const info = this.elements.lightbox.querySelector('.lightbox-info');
        if (info) {
            info.parentNode.insertBefore(btn, info);
        } else {
            this.elements.lightbox.appendChild(btn);
        }
        this.elements.collectionBtn = btn;
        lucide.createIcons({ nodes: [btn] });

        // Dedicated backdrop for the collection drawer
        const backdrop = document.createElement('div');
        backdrop.className = 'lightbox-collection-drawer-backdrop hidden';
        backdrop.addEventListener('click', () => this.closeCollectionDrawer());
        this.elements.lightbox.appendChild(backdrop);
        this.elements.collectionDrawerBackdrop = backdrop;

        // The drawer panel
        const drawer = document.createElement('div');
        drawer.className = 'lightbox-collection-drawer hidden';
        drawer.innerHTML = `
            <div class="drawer-handle-bar"><div class="drawer-handle"></div></div>
            <div class="drawer-header">
                <h3 class="drawer-title collection-drawer-title"><i data-lucide="layers"></i> Collections</h3>
                <button class="drawer-close collection-drawer-close" title="Close"><i data-lucide="x"></i></button>
            </div>
            <div class="drawer-body collection-membership-view">
                <div class="collection-drawer-list"></div>
                <div class="collection-drawer-empty hidden">
                    <span class="drawer-empty-text">Not in any collection</span>
                </div>
                <div class="collection-drawer-loading hidden">
                    <span class="drawer-empty-text">Loading\u2026</span>
                </div>
            </div>
            <div class="drawer-footer collection-membership-footer">
                <div class="collection-drawer-add-row">
                    <select class="collection-drawer-picker">
                        <option value="">Add to collection\u2026</option>
                    </select>
                    <button class="btn btn-primary collection-drawer-add-btn" disabled>
                        <i data-lucide="plus"></i>
                    </button>
                </div>
                <button class="btn btn-secondary collection-drawer-new-btn">
                    <i data-lucide="plus-circle"></i>
                    New Collection
                </button>
            </div>
            <div class="drawer-body collection-reorder-view hidden">
                <div class="collection-reorder-list"></div>
            </div>
            <div class="drawer-footer collection-reorder-footer hidden">
                <div class="collection-reorder-actions">
                    <button class="btn btn-secondary collection-reorder-cancel">Cancel</button>
                    <button class="btn btn-primary collection-reorder-save">
                        <i data-lucide="check"></i>
                        Save order
                    </button>
                </div>
            </div>
        `;

        this.elements.lightbox.appendChild(drawer);
        this.elements.collectionDrawer = drawer;
        this.elements.collectionDrawerList = drawer.querySelector('.collection-drawer-list');
        this.elements.collectionDrawerEmpty = drawer.querySelector('.collection-drawer-empty');
        this.elements.collectionDrawerLoading = drawer.querySelector('.collection-drawer-loading');
        this.elements.collectionDrawerClose = drawer.querySelector('.collection-drawer-close');
        this.elements.collectionDrawerTitle = drawer.querySelector('.collection-drawer-title');
        this.elements.collectionDrawerPicker = drawer.querySelector('.collection-drawer-picker');
        this.elements.collectionDrawerAddBtn = drawer.querySelector('.collection-drawer-add-btn');
        this.elements.collectionDrawerNewBtn = drawer.querySelector('.collection-drawer-new-btn');
        this.elements.collectionMembershipView = drawer.querySelector(
            '.collection-membership-view'
        );
        this.elements.collectionMembershipFooter = drawer.querySelector(
            '.collection-membership-footer'
        );
        this.elements.collectionReorderView = drawer.querySelector('.collection-reorder-view');
        this.elements.collectionReorderList = drawer.querySelector('.collection-reorder-list');
        this.elements.collectionReorderFooter = drawer.querySelector('.collection-reorder-footer');
        this.elements.collectionReorderCancel = drawer.querySelector('.collection-reorder-cancel');
        this.elements.collectionReorderSave = drawer.querySelector('.collection-reorder-save');

        this.elements.collectionReorderCancel.addEventListener('click', (e) => {
            e.stopPropagation();
            this._closeReorderPanel();
        });

        this.elements.collectionReorderSave.addEventListener('click', async (e) => {
            e.stopPropagation();
            await this._saveReorderPanel();
        });

        this.elements.collectionDrawerClose.addEventListener('click', (e) => {
            e.stopPropagation();
            this.closeCollectionDrawerWithHistory();
        });

        this.elements.collectionDrawerPicker.addEventListener('change', (e) => {
            this.elements.collectionDrawerAddBtn.disabled = !e.target.value;
        });

        this.elements.collectionDrawerAddBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const id = parseInt(this.elements.collectionDrawerPicker.value, 10);
            if (!id) return;
            const file = this.items[this.currentIndex];
            if (!file) return;
            try {
                await Collections.addItemsToCollection(id, [file.path]);
                await this.renderCollectionDrawer(file);
                this.updateCollectionButton(file);
                if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                    const col = Collections.getById(id);
                    Gallery.showToast(`Added to "${col ? col.name : 'collection'}"`);
                }
            } catch (err) {
                console.error('Failed to add to collection:', err);
                if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                    Gallery.showToast('Failed to add to collection');
                }
            }
        });

        this.elements.collectionDrawerNewBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const file = this.items[this.currentIndex];
            if (!file || file.type === 'folder') return;
            if (typeof Collections !== 'undefined') {
                Collections.openCreateModal([file]);
            }
            this.closeCollectionDrawerWithHistory();
        });

        // Prevent inside-drawer interaction from bubbling to the lightbox
        drawer.addEventListener('click', (e) => e.stopPropagation());
        drawer.addEventListener(
            'touchstart',
            (e) => {
                if (!e.target.closest('.drawer-handle-bar')) e.stopPropagation();
            },
            { passive: true }
        );
        drawer.addEventListener(
            'touchend',
            (e) => {
                e.stopPropagation();
                this.lastTouchTime = Date.now();
            },
            { passive: true }
        );

        const handleBar = drawer.querySelector('.drawer-handle-bar');
        this.bindDrawerSwipeDismiss(handleBar, drawer, () => this.closeCollectionDrawer());

        lucide.createIcons({ nodes: [drawer] });
    },

    updateCollectionButton(file) {
        const btn = this.elements.collectionBtn;
        if (!btn) return;
        const isFolder = !file || file.type === 'folder';
        btn.classList.toggle('hidden', isFolder);
        if (!isFolder && typeof Collections !== 'undefined') {
            const inCollection = Collections.isInCollection(file.path);
            btn.classList.toggle('active', inCollection);
            btn.title = inCollection ? 'Collections — in collection (C)' : 'Collections (C)';
        }
    },

    openCollectionDrawer() {
        if (this.collectionDrawerOpen) return;

        const file = this.items[this.currentIndex];
        if (!file || file.type === 'folder') return;
        this.collectionDrawerOpen = true;

        this.elements.collectionDrawer.classList.remove('hidden');
        this.elements.collectionDrawerBackdrop.classList.remove('hidden');

        requestAnimationFrame(() => {
            this.elements.collectionDrawer.classList.add('open');
            this.elements.collectionDrawerBackdrop.classList.add('open');
        });

        this.renderCollectionDrawer(file);

        this.userHidOverlays = true;
        this.showUIOverlays();

        if (typeof HistoryManager !== 'undefined') {
            HistoryManager.pushState('lightbox-collection-drawer');
        }

        this._bindCollectionDrawerViewportResize();
    },

    closeCollectionDrawer() {
        if (!this.collectionDrawerOpen) return;
        this.collectionDrawerOpen = false;

        // If reorder mode was active, reset it silently without saving
        if (this._reorderCollectionId) {
            this._reorderCollectionId = null;
            this._reorderCurrentFilePath = null;
            this._reorderPaths = null;
            this._reorderNames = null;
            this.elements.collectionReorderView?.classList.add('hidden');
            this.elements.collectionReorderFooter?.classList.add('hidden');
            this.elements.collectionMembershipView?.classList.remove('hidden');
            this.elements.collectionMembershipFooter?.classList.remove('hidden');
            if (this.elements.collectionDrawerTitle) {
                this.elements.collectionDrawerTitle.innerHTML =
                    '<i data-lucide="layers"></i> Collections';
                lucide.createIcons({ nodes: [this.elements.collectionDrawerTitle] });
            }
        }

        this._unbindCollectionDrawerViewportResize();

        this.elements.collectionDrawer.classList.remove('open');
        this.elements.collectionDrawerBackdrop.classList.remove('open');

        setTimeout(() => {
            if (!this.collectionDrawerOpen) {
                this.elements.collectionDrawer.classList.add('hidden');
                this.elements.collectionDrawerBackdrop.classList.add('hidden');
            }
        }, 300);

        this.userHidOverlays = false;
        this.hideUIOverlaysDelayed();

        if (
            typeof HistoryManager !== 'undefined' &&
            HistoryManager.hasState('lightbox-collection-drawer')
        ) {
            HistoryManager.removeState('lightbox-collection-drawer');
        }
    },

    closeCollectionDrawerWithHistory() {
        if (
            typeof HistoryManager !== 'undefined' &&
            HistoryManager.hasState('lightbox-collection-drawer')
        ) {
            history.back();
        } else {
            this.closeCollectionDrawer();
        }
    },

    async renderCollectionDrawer(file) {
        const list = this.elements.collectionDrawerList;
        const emptyEl = this.elements.collectionDrawerEmpty;
        const loadingEl = this.elements.collectionDrawerLoading;

        list.innerHTML = '';
        emptyEl.classList.add('hidden');
        loadingEl.classList.remove('hidden');

        try {
            if (typeof Collections === 'undefined') {
                loadingEl.classList.add('hidden');
                emptyEl.classList.remove('hidden');
                return;
            }

            const memberIds = Collections.getMemberships(file.path);
            loadingEl.classList.add('hidden');

            if (memberIds.length === 0) {
                emptyEl.classList.remove('hidden');
            } else {
                emptyEl.classList.add('hidden');
                for (const colId of memberIds) {
                    const col = Collections.getById(colId);
                    if (!col) continue;
                    const row = document.createElement('div');
                    row.className = 'collection-drawer-item';
                    row.innerHTML = `
                        <div class="collection-drawer-item-info">
                            <span class="collection-drawer-item-name">${this.escapeHtml(col.name)}</span>
                            <span class="collection-drawer-item-count">${col.itemCount} item${col.itemCount !== 1 ? 's' : ''}</span>
                        </div>
                        <div class="collection-drawer-item-actions">
                            <button class="btn btn-secondary collection-drawer-browse-btn" data-id="${colId}" title="Browse collection">
                                <i data-lucide="play"></i>
                                Browse
                            </button>
                            <button class="btn btn-secondary collection-drawer-reorder-btn" data-id="${colId}" title="Edit order">
                                <i data-lucide="arrow-up-down"></i>
                                Order
                            </button>
                            <button class="btn btn-secondary collection-drawer-remove-btn" data-id="${colId}" title="Remove from collection">
                                <i data-lucide="x"></i>
                                Remove
                            </button>
                        </div>
                    `;

                    const browseBtn = row.querySelector('.collection-drawer-browse-btn');
                    browseBtn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        await this.switchToCollection(colId, file.path);
                    });

                    const reorderBtn = row.querySelector('.collection-drawer-reorder-btn');
                    reorderBtn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        await this.openReorderPanel(colId, col.name, file.path);
                    });

                    const removeBtn = row.querySelector('.collection-drawer-remove-btn');
                    removeBtn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        try {
                            await Collections.removeItemFromCollection(colId, file.path);
                            await this.renderCollectionDrawer(file);
                            this.updateCollectionButton(file);
                            if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                                Gallery.showToast(`Removed from "${col.name}"`);
                            }
                        } catch {
                            if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                                Gallery.showToast('Failed to remove from collection');
                            }
                        }
                    });

                    list.appendChild(row);
                }
                lucide.createIcons();
            }

            // Populate "add to" picker with collections this item is NOT in
            const picker = this.elements.collectionDrawerPicker;
            picker.innerHTML = '<option value="">Add to collection\u2026</option>';
            (Collections._all || []).forEach((col) => {
                if (!memberIds.includes(col.id)) {
                    const opt = document.createElement('option');
                    opt.value = col.id;
                    opt.textContent = col.name;
                    picker.appendChild(opt);
                }
            });
            this.elements.collectionDrawerAddBtn.disabled = true;
        } catch (e) {
            console.debug('Collection drawer: render error', e);
            loadingEl.classList.add('hidden');
            emptyEl.classList.remove('hidden');
        }
    },

    async openReorderPanel(collectionId, collectionName, currentFilePath) {
        try {
            const detail = await Collections.getCollectionDetail(collectionId);
            const items = detail.items || [];
            if (items.length === 0) {
                if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                    Gallery.showToast('Collection is empty');
                }
                return;
            }

            // Track state for save
            this._reorderCollectionId = collectionId;
            this._reorderCurrentFilePath = currentFilePath;
            // Ordered list of paths — mutable as user moves items
            this._reorderPaths = items.map((i) => i.path);
            this._reorderNames = Object.fromEntries(items.map((i) => [i.path, i.name]));
            // Full item objects keyed by path, used when applying the new order to the lightbox
            this._reorderItems = items.map((item) => ({ ...item, tags: item.tags || [] }));

            // Update drawer title
            this.elements.collectionDrawerTitle.innerHTML = `<i data-lucide="arrow-up-down"></i> ${this.escapeHtml(collectionName)}`;
            lucide.createIcons({ nodes: [this.elements.collectionDrawerTitle] });

            // Switch to reorder view
            this.elements.collectionMembershipView.classList.add('hidden');
            this.elements.collectionMembershipFooter.classList.add('hidden');
            this.elements.collectionReorderView.classList.remove('hidden');
            this.elements.collectionReorderFooter.classList.remove('hidden');

            this._renderReorderList(currentFilePath);
        } catch (e) {
            console.error('Failed to open reorder panel:', e);
            if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                Gallery.showToast('Failed to load collection items');
            }
        }
    },

    _renderReorderList(currentFilePath) {
        const list = this.elements.collectionReorderList;
        const paths = this._reorderPaths;
        const names = this._reorderNames;
        list.innerHTML = '';

        paths.forEach((path, idx) => {
            const isCurrent = path === currentFilePath;
            const row = document.createElement('div');
            row.className = 'reorder-item' + (isCurrent ? ' reorder-item-current' : '');
            row.dataset.idx = idx;
            const thumbUrl = `/api/thumbnails/${path.split('/').map(encodeURIComponent).join('/')}`;
            row.innerHTML = `
                <div class="reorder-item-arrows">
                    <button class="reorder-move-up btn btn-secondary" title="Move up" ${idx === 0 ? 'disabled' : ''}>
                        <i data-lucide="chevron-up"></i>
                    </button>
                    <button class="reorder-move-down btn btn-secondary" title="Move down" ${idx === paths.length - 1 ? 'disabled' : ''}>
                        <i data-lucide="chevron-down"></i>
                    </button>
                </div>
                <img class="reorder-item-thumb" src="${thumbUrl}" alt="${this.escapeAttr(names[path] || path)}" />
                <span class="reorder-item-name" title="${this.escapeAttr(path)}">${this.escapeHtml(names[path] || path)}</span>
                ${isCurrent ? '<span class="reorder-current-badge">current</span>' : ''}
            `;

            row.querySelector('.reorder-move-up').addEventListener('click', (e) => {
                e.stopPropagation();
                if (idx === 0) return;
                [this._reorderPaths[idx - 1], this._reorderPaths[idx]] = [
                    this._reorderPaths[idx],
                    this._reorderPaths[idx - 1],
                ];
                this._renderReorderList(this._reorderCurrentFilePath);
                const movedRow = this.elements.collectionReorderList.querySelector(
                    `.reorder-item[data-idx="${idx - 1}"]`
                );
                movedRow?.scrollIntoView({ block: 'nearest' });
            });

            row.querySelector('.reorder-move-down').addEventListener('click', (e) => {
                e.stopPropagation();
                if (idx === paths.length - 1) return;
                [this._reorderPaths[idx], this._reorderPaths[idx + 1]] = [
                    this._reorderPaths[idx + 1],
                    this._reorderPaths[idx],
                ];
                this._renderReorderList(this._reorderCurrentFilePath);
                const movedRow = this.elements.collectionReorderList.querySelector(
                    `.reorder-item[data-idx="${idx + 1}"]`
                );
                movedRow?.scrollIntoView({ block: 'nearest' });
            });

            const img = row.querySelector('.reorder-item-thumb');
            if (img)
                img.addEventListener(
                    'error',
                    () => {
                        img.style.display = 'none';
                    },
                    { once: true }
                );

            list.appendChild(row);
        });

        lucide.createIcons();
    },

    _closeReorderPanel() {
        this._reorderCollectionId = null;
        this._reorderCurrentFilePath = null;
        this._reorderPaths = null;
        this._reorderNames = null;
        this._reorderItems = null;

        // Restore title
        this.elements.collectionDrawerTitle.innerHTML = '<i data-lucide="layers"></i> Collections';
        lucide.createIcons({ nodes: [this.elements.collectionDrawerTitle] });

        // Switch back to membership view
        this.elements.collectionReorderView.classList.add('hidden');
        this.elements.collectionReorderFooter.classList.add('hidden');
        this.elements.collectionMembershipView.classList.remove('hidden');
        this.elements.collectionMembershipFooter.classList.remove('hidden');
    },

    async _saveReorderPanel() {
        const id = this._reorderCollectionId;
        const paths = this._reorderPaths ? [...this._reorderPaths] : null;
        const currentFilePath = this._reorderCurrentFilePath;
        if (!id || !paths) return;

        const saveBtn = this.elements.collectionReorderSave;
        saveBtn.disabled = true;
        try {
            await Collections.reorderCollectionItems(id, paths);

            // Re-fetch the collection from the API so the order is server-authoritative.
            const detail = await Collections.getCollectionDetail(id);
            const fetchedItems = (detail.items || []).map((item) => ({
                ...item,
                tags: item.tags || [],
            }));

            // Switch the lightbox into collection mode with the new order.
            if (fetchedItems.length > 0) {
                this.items = fetchedItems;
                const newIdx = this.items.findIndex((i) => i.path === currentFilePath);
                this.currentIndex = newIdx >= 0 ? newIdx : 0;
                this.useAppMedia = false;
                this.clearPreloadCache();
                this.showMedia();
                this.updateNavigation();
                // Keep the stored context up to date so close() merges the
                // freshly-ordered items, not the pre-save order.
                this._switchedCollectionId = id;
                this._switchedCollectionName = Collections._currentCollectionName || '';
                this._switchedCollectionItems = fetchedItems;
            }

            // Merge the new order into the full library grid immediately so
            // the grid is correct even if the user doesn't close the lightbox.
            if (fetchedItems.length > 0) {
                Collections.mergeCollectionIntoLibrary(
                    id,
                    Collections._currentCollectionName || '',
                    fetchedItems
                );
            }

            if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                Gallery.showToast('Collection order saved');
            }
        } catch (e) {
            console.error('Failed to save collection order:', e);
            if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                Gallery.showToast('Failed to save order');
            }
        } finally {
            saveBtn.disabled = false;
        }

        this._closeReorderPanel();

        // Refresh membership view for the now-current item
        const file = this.items[this.currentIndex];
        if (file) await this.renderCollectionDrawer(file);
    },

    async switchToCollection(collectionId, currentFilePath) {
        this.closeCollectionDrawer();
        try {
            const detail = await Collections.getCollectionDetail(collectionId);
            const items = (detail.items || []).map((item) => ({
                ...item,
                tags: item.tags || [],
            }));
            if (items.length === 0) {
                console.warn('[switchToCollection] items array is empty, bailing');
                return;
            }

            let idx = items.findIndex((i) => i.path === currentFilePath);
            if (idx < 0) idx = 0;

            const colName =
                Collections.getById(collectionId)?.name ||
                detail.collection?.name ||
                detail.name ||
                '';
            if (typeof Gallery !== 'undefined' && Gallery.showToast && colName) {
                Gallery.showToast(`Browsing: ${colName}`);
            }

            this.useAppMedia = false;
            this.items = items;
            this.currentIndex = idx;
            this.clearPreloadCache();
            this.showMedia();
            this.updateNavigation();

            // Store context so close() can merge the collection into the full
            // library grid once the lightbox is dismissed.
            // NOTE: MediaApp.state.mediaFiles is intentionally NOT overwritten
            // here — keeping the full directory list means mergeCollectionIntoLibrary
            // can prepend the collection items while retaining the rest.
            this._switchedCollectionId = collectionId;
            this._switchedCollectionName = colName;
            this._switchedCollectionItems = items;
        } catch (e) {
            console.error('Failed to load collection:', e);
            if (typeof Gallery !== 'undefined' && Gallery.showToast) {
                Gallery.showToast('Failed to load collection');
            }
        }
    },

    _bindCollectionDrawerViewportResize() {
        if (!window.visualViewport || !this.elements.lightbox) return;
        this._collectionDrawerViewportHandler = () => {
            if (this.collectionDrawerOpen) {
                this.elements.lightbox.style.height = window.visualViewport.height + 'px';
            }
        };
        window.visualViewport.addEventListener('resize', this._collectionDrawerViewportHandler);
        this._collectionDrawerViewportHandler();
    },

    _unbindCollectionDrawerViewportResize() {
        if (this._collectionDrawerViewportHandler && window.visualViewport) {
            window.visualViewport.removeEventListener(
                'resize',
                this._collectionDrawerViewportHandler
            );
            this._collectionDrawerViewportHandler = null;
        }
        if (this.elements.lightbox) {
            this.elements.lightbox.style.height = '';
        }
    },

    updateTagButton(file) {
        if (!this.elements.tagBtn) return;
        const hasTags = file.tags && file.tags.length > 0;
        this.elements.tagBtn.classList.toggle('has-tags', hasTags);
        this.elements.tagBtn.title = 'Manage tags (T)';
        // Icon (tag SVG) was rendered once in _initStaticIcons().
        // Only the CSS class changes — no DOM mutation, no lucide call.
    },

    downloadCurrent() {
        if (this.items.length === 0) return;
        const file = this.items[this.currentIndex];
        if (!file || file.type === 'folder') return;
        const link = document.createElement('a');
        link.href = `/api/files/${file.path.split('/').map(encodeURIComponent).join('/')}?download=true`;
        link.download = file.name;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        if (typeof Gallery !== 'undefined' && Gallery.showToast) {
            Gallery.showToast(`Downloading ${file.name}`);
        }
    },
};

window.Lightbox = Lightbox;

document.addEventListener('DOMContentLoaded', () => {
    Lightbox.init();
});
