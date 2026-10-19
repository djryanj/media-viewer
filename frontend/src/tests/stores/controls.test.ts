import { describe, it, expect, beforeEach } from 'vitest';
import { controlsStore } from '$lib/stores/controls.svelte';

describe('controlsStore', () => {
    beforeEach(() => controlsStore.reset());

    it('starts with controls not dismissed', () => {
        expect(controlsStore.dismissed).toBe(false);
    });

    it('dismiss() and restore() set the flag', () => {
        controlsStore.dismiss();
        expect(controlsStore.dismissed).toBe(true);
        controlsStore.restore();
        expect(controlsStore.dismissed).toBe(false);
    });

    it('reset() clears a dismissal', () => {
        controlsStore.dismiss();
        controlsStore.reset();
        expect(controlsStore.dismissed).toBe(false);
    });
});
