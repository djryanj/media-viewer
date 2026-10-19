/**
 * Whether the user has dismissed the media controls (lightbox chrome and video
 * player overlay) with a tap.
 *
 * Lives outside the components so the choice survives swiping to the next or
 * previous item, which remounts the video player. The lightbox and the
 * playlist page reset it when they close.
 */

function createControlsStore() {
    let dismissed = $state(false);

    return {
        get dismissed() {
            return dismissed;
        },
        dismiss() {
            dismissed = true;
        },
        restore() {
            dismissed = false;
        },
        reset() {
            dismissed = false;
        }
    };
}

export const controlsStore = createControlsStore();
