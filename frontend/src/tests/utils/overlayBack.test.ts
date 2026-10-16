import { describe, it, expect, beforeEach } from 'vitest';
import { closeOverlayOnBack } from '$lib/utils/overlayBack';
import { lightboxStore } from '$lib/stores/lightbox.svelte';
import type { MediaFile } from '$lib/api/types';

const img = { name: 'a.jpg', path: 'a.jpg', type: 'image' } as unknown as MediaFile;

describe('closeOverlayOnBack', () => {
    beforeEach(() => lightboxStore.close());

    it('returns false and does nothing when no overlay is open', () => {
        expect(closeOverlayOnBack()).toBe(false);
    });

    it('closes an open lightbox and reports the back press as consumed', () => {
        lightboxStore.show(img, [img]);
        expect(closeOverlayOnBack()).toBe(true);
        expect(lightboxStore.open).toBe(false);
    });
});
