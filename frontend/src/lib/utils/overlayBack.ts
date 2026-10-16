import { lightboxStore } from '$lib/stores/lightbox.svelte';

/**
 * Close the topmost full-screen overlay in response to a browser/mobile back
 * press. Returns true when an overlay was closed, meaning the back press has
 * been consumed and the underlying navigation must not proceed.
 */
export function closeOverlayOnBack(): boolean {
    if (lightboxStore.open) {
        lightboxStore.close();
        return true;
    }
    return false;
}
