let open = $state(false);

export const settingsStore = {
    get open() {
        return open;
    },
    show() {
        open = true;
    },
    hide() {
        open = false;
    }
};
