/**
 * Svelte action: fires a callback when the element enters the viewport.
 * Used for lazy-loading gallery thumbnails.
 *
 * Usage:
 *   <img use:lazyLoad={{ src }} alt="..." />
 */

type LazyLoadOptions = {
    src: string;
    rootMargin?: string;
};

export function lazyLoad(node: HTMLImageElement, options: LazyLoadOptions) {
    const { src, rootMargin = '200px' } = options;

    const observer = new IntersectionObserver(
        (entries) => {
            if (entries[0].isIntersecting) {
                node.src = src;
                observer.disconnect();
            }
        },
        { rootMargin }
    );

    observer.observe(node);

    return {
        update(newOptions: LazyLoadOptions) {
            if (newOptions.src !== src) {
                node.src = newOptions.src;
            }
        },
        destroy() {
            observer.disconnect();
        }
    };
}

/**
 * Svelte action: calls onEnter when the element scrolls into view.
 * Used for infinite-scroll triggers.
 */
export function onVisible(node: HTMLElement, onEnter: () => void, rootMargin = '400px') {
    const observer = new IntersectionObserver(
        (entries) => {
            if (entries[0].isIntersecting) onEnter();
        },
        { rootMargin }
    );
    observer.observe(node);
    return {
        destroy() {
            observer.disconnect();
        }
    };
}
