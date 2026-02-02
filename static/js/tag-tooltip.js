const TagTooltip = {
    tooltip: null,
    currentTarget: null,
    hoverZone: null,
    isMobile: false,

    init() {
        this.isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
        this.createTooltip();
        this.bindGlobalEvents();
    },

    createTooltip() {
        this.hoverZone = document.createElement('div');
        this.hoverZone.className = 'tag-tooltip-zone';

        this.tooltip = document.createElement('div');
        this.tooltip.className = 'tag-tooltip';
        this.tooltip.innerHTML = `
        <div class="tag-tooltip-title">All tags <span class="tag-tooltip-hint">(tap to search)</span></div>
        <div class="tag-tooltip-tags"></div>
    `;

        this.hoverZone.appendChild(this.tooltip);
        document.body.appendChild(this.hoverZone);

        // Handle clicks on tags within tooltip
        this.tooltip.addEventListener('click', (e) => {
            const target = e.target instanceof Element ? e.target : null;
            if (!target) return;

            const tooltipTag = target.closest('.tag-tooltip-tag');
            const removeBtn = target.closest('.tag-tooltip-remove');

            // Handle remove button
            if (removeBtn) {
                e.preventDefault();
                e.stopPropagation();
                const tagName = tooltipTag?.dataset.tag;
                const itemPath = tooltipTag?.dataset.path;

                if (tagName && itemPath && typeof Tags !== 'undefined') {
                    Tags.removeTagFromItem(itemPath, tagName);
                    // Refresh tooltip after removal
                    setTimeout(() => {
                        if (this.currentTarget) {
                            const galleryItem = this.currentTarget.closest('.gallery-item');
                            if (!galleryItem) {
                                this.hide();
                                return;
                            }
                            const allTags = this.getTagsForItem(galleryItem);
                            if (allTags && allTags.length > 3) {
                                this.show(this.currentTarget);
                            } else {
                                this.hide();
                            }
                        }
                    }, 100);
                }
                return;
            }

            // Handle tag text click for search
            if (tooltipTag) {
                e.preventDefault();
                e.stopPropagation();
                const tagName = tooltipTag.dataset.tag;
                if (tagName) {
                    this.hide();
                    if (typeof Tags !== 'undefined') {
                        Tags.searchByTag(tagName);
                    }
                }
            }
        });
    },

    bindGlobalEvents() {
        // Click to toggle tooltip on +n indicator
        document.addEventListener('click', (e) => {
            const target = e.target instanceof Element ? e.target : null;
            if (!target) return;

            const moreTag = target.closest('.item-tag.more');

            if (moreTag) {
                e.preventDefault();
                e.stopPropagation();

                // Toggle tooltip on click
                if (
                    this.currentTarget === moreTag &&
                    this.hoverZone.classList.contains('visible')
                ) {
                    this.hide();
                } else {
                    this.show(moreTag);
                }
                return;
            }

            // If clicking inside tooltip, let other handlers deal with it
            if (target.closest('.tag-tooltip')) {
                return;
            }

            // Clicking elsewhere closes tooltip
            if (this.hoverZone.classList.contains('visible')) {
                this.hide();
            }
        });

        // Also handle touch for mobile
        document.addEventListener(
            'touchend',
            (e) => {
                const target = e.target instanceof Element ? e.target : null;
                if (!target) return;

                const moreTag = target.closest('.item-tag.more');

                if (moreTag) {
                    e.preventDefault();
                    e.stopPropagation();

                    // Toggle tooltip on tap
                    if (
                        this.currentTarget === moreTag &&
                        this.hoverZone.classList.contains('visible')
                    ) {
                        this.hide();
                    } else {
                        this.show(moreTag);
                    }
                    return;
                }

                // If tapping inside tooltip, let the click handler deal with it
                if (target.closest('.tag-tooltip')) {
                    return;
                }

                // Tapping elsewhere closes tooltip
                if (this.hoverZone.classList.contains('visible')) {
                    this.hide();
                }
            },
            { passive: false }
        );

        // Hide on scroll/resize
        window.addEventListener('scroll', () => this.hide(), { passive: true });
        window.addEventListener('resize', () => this.hide(), { passive: true });
    },

    isPointInElement(x, y, element) {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        const buffer = 5;
        return (
            x >= rect.left - buffer &&
            x <= rect.right + buffer &&
            y >= rect.top - buffer &&
            y <= rect.bottom + buffer
        );
    },

    show(targetElement) {
        this.currentTarget = targetElement;

        const galleryItem = targetElement.closest('.gallery-item');
        if (!galleryItem) return;

        const allTags = this.getTagsForItem(galleryItem);
        if (!allTags || allTags.length === 0) return;

        const itemPath = galleryItem.dataset.path;

        const tagsContainer = this.tooltip.querySelector('.tag-tooltip-tags');

        tagsContainer.innerHTML = allTags
            .map(
                (tag) => `
            <span class="tag-tooltip-tag" data-tag="${this.escapeAttr(tag)}" data-path="${this.escapeAttr(itemPath)}">
                <button class="tag-tooltip-remove" title="Remove &quot;${this.escapeAttr(tag)}&quot; tag">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M18 6L6 18M6 6l12 12"/></svg>
                </button>
                <span class="tag-tooltip-divider"></span>
                <span class="tag-tooltip-text">${this.escapeHtml(tag)}</span>
            </span>
        `
            )
            .join('');

        this.position(targetElement);
        this.hoverZone.classList.add('visible');
    },

    hide() {
        this.hoverZone.classList.remove('visible');
        this.currentTarget = null;
    },

    position(targetElement) {
        const targetRect = targetElement.getBoundingClientRect();

        this.tooltip.style.visibility = 'hidden';
        this.hoverZone.classList.add('visible');

        const tooltipRect = this.tooltip.getBoundingClientRect();

        let top = targetRect.top - tooltipRect.height - 8;
        let left = targetRect.left + targetRect.width / 2 - tooltipRect.width / 2;

        if (left < 8) {
            left = 8;
        }
        if (left + tooltipRect.width > window.innerWidth - 8) {
            left = window.innerWidth - tooltipRect.width - 8;
        }

        if (top < 8) {
            top = targetRect.bottom + 8;
        }

        this.tooltip.style.position = 'fixed';
        this.tooltip.style.top = `${top}px`;
        this.tooltip.style.left = `${left}px`;
        this.tooltip.style.visibility = '';
    },

    getTagsForItem(galleryItem) {
        const tagsContainer = galleryItem.querySelector('.gallery-item-tags[data-all-tags]');
        if (tagsContainer?.dataset.allTags) {
            try {
                return JSON.parse(tagsContainer.dataset.allTags);
            } catch (e) {
                console.error('Failed to parse tags data:', e);
            }
        }

        const path = galleryItem.dataset.path;

        if (MediaApp.state.listing?.items) {
            const item = MediaApp.state.listing.items.find((i) => i.path === path);
            if (item?.tags) return item.tags;
        }

        if (MediaApp.state.mediaFiles) {
            const item = MediaApp.state.mediaFiles.find((i) => i.path === path);
            if (item?.tags) return item.tags;
        }

        return [];
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
};

document.addEventListener('DOMContentLoaded', () => {
    TagTooltip.init();
});

window.TagTooltip = TagTooltip;
