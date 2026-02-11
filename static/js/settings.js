/* global Clock */
/**
 * Settings Manager
 * Handles the settings modal, tabs, and all settings functionality
 */
class SettingsManager {
    constructor() {
        this.modal = document.getElementById('settings-modal');
        this.passkeyNameModal = document.getElementById('passkey-name-modal');
        this.renameTagModal = document.getElementById('rename-tag-modal');
        this.deleteTagModal = document.getElementById('delete-tag-modal');
        this.currentTab = 'security';
        this.passkeyNameResolve = null; // For promise resolution
        this.renameTagResolve = null; // For promise resolution
        this.deleteTagResolve = null; // For promise resolution
        this.thumbnailCacheBytes = 0; // Cache stats
        this.thumbnailCacheFiles = 0; // Cache stats
        this.transcodeCacheBytes = 0; // Cache stats
        this.transcodeCacheFiles = 0; // Cache stats

        if (!this.modal) {
            console.error('Settings modal not found');
            return;
        }

        this.init();
    }

    init() {
        this.bindEvents();
        this.bindPasskeyNameModal();
        this.bindRenameTagModal();
        this.bindDeleteTagModal();
        this.initPasswordToggles();
    }

    bindEvents() {
        // Settings button
        const settingsBtn = document.getElementById('settings-btn');
        if (settingsBtn) {
            settingsBtn.addEventListener('click', () => this.open());
        }

        // Close button
        const closeBtn = this.modal.querySelector('.modal-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.close());
        }

        // Backdrop click
        const backdrop = this.modal.querySelector('.modal-backdrop');
        if (backdrop) {
            backdrop.addEventListener('click', () => this.close());
        }

        // Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (this.deleteTagModal && !this.deleteTagModal.classList.contains('hidden')) {
                    this.closeDeleteTagModal(false);
                } else if (
                    this.renameTagModal &&
                    !this.renameTagModal.classList.contains('hidden')
                ) {
                    this.closeRenameTagModal(null);
                } else if (
                    this.passkeyNameModal &&
                    !this.passkeyNameModal.classList.contains('hidden')
                ) {
                    this.closePasskeyNameModal(null);
                } else if (!this.modal.classList.contains('hidden')) {
                    this.close();
                }
            }
        });

        // Tab switching
        this.modal.querySelectorAll('.settings-tab').forEach((tab) => {
            tab.addEventListener('click', () => this.switchTab(tab.dataset.tab));
        });

        // Password form
        const passwordForm = document.getElementById('settings-password-form');
        if (passwordForm) {
            passwordForm.addEventListener('submit', (e) => this.handlePasswordChange(e));
        }

        // Cache actions
        document
            .getElementById('rebuild-thumbnails-btn')
            ?.addEventListener('click', () => this.rebuildThumbnails());
        document
            .getElementById('reindex-btn')
            ?.addEventListener('click', () => this.reindexMedia());
        document
            .getElementById('clear-transcode-btn')
            ?.addEventListener('click', () => this.clearTranscodeCache());

        // Add passkey button
        document
            .getElementById('add-passkey-btn')
            ?.addEventListener('click', () => this.addPasskey());

        // Passkey delete buttons (event delegation)
        document.getElementById('passkeys-list')?.addEventListener('click', (e) => {
            const deleteBtn = e.target.closest('.passkey-delete');
            if (deleteBtn) {
                const id = parseInt(deleteBtn.dataset.id, 10);
                this.deletePasskey(id);
            }
        });

        // Clock settings
        const clockToggle = document.getElementById('clock-enabled-toggle');
        if (clockToggle) {
            clockToggle.addEventListener('change', () => this.handleClockToggle());
        }

        const clockFormatSelect = document.getElementById('clock-format-select');
        if (clockFormatSelect) {
            clockFormatSelect.addEventListener('change', () => this.handleClockFormatChange());
        }

        const clockAlwaysVisibleToggle = document.getElementById('clock-always-visible-toggle');
        if (clockAlwaysVisibleToggle) {
            clockAlwaysVisibleToggle.addEventListener('change', () =>
                this.handleClockAlwaysVisibleToggle()
            );
        }

        // Default sort settings
        const sortFieldSelect = document.getElementById('default-sort-field');
        if (sortFieldSelect) {
            sortFieldSelect.addEventListener('change', () => this.handleSortFieldChange());
        }

        const sortOrderSelect = document.getElementById('default-sort-order');
        if (sortOrderSelect) {
            sortOrderSelect.addEventListener('change', () => this.handleSortOrderChange());
        }

        // Tag manager
        const tagSearchInput = document.getElementById('tag-search-input');
        if (tagSearchInput) {
            tagSearchInput.addEventListener('input', () => this.filterTags());
        }

        const showUnusedBtn = document.getElementById('show-unused-tags-btn');
        if (showUnusedBtn) {
            showUnusedBtn.addEventListener('click', () => this.toggleUnusedTags());
        }

        // Tag actions (event delegation)
        const tagListBody = document.getElementById('tag-list-body');
        if (tagListBody) {
            tagListBody.addEventListener('click', (e) => {
                const renameBtn = e.target.closest('.tag-action-btn.rename');
                const deleteBtn = e.target.closest('.tag-action-btn.delete');

                if (renameBtn) {
                    const tagName = renameBtn.dataset.tag;
                    this.renameTag(tagName);
                } else if (deleteBtn) {
                    const tagName = deleteBtn.dataset.tag;
                    this.deleteTag(tagName);
                }
            });
        }

        // Tag list sorting
        document.querySelectorAll('.tag-list-table th.sortable').forEach((th) => {
            th.addEventListener('click', () => {
                const sortBy = th.dataset.sort;
                this.sortTags(sortBy);
            });
        });
    }

    /**
     * Bind passkey name modal events
     */
    bindPasskeyNameModal() {
        if (!this.passkeyNameModal) return;

        const input = document.getElementById('passkey-name-input');
        const confirmBtn = document.getElementById('passkey-name-confirm');
        const cancelBtn = document.getElementById('passkey-name-cancel');
        const cancelXBtn = document.getElementById('passkey-name-cancel-x');
        const backdrop = this.passkeyNameModal.querySelector('.modal-backdrop');

        // Confirm button
        confirmBtn?.addEventListener('click', () => {
            const name = input?.value.trim();
            if (!name) {
                this.showPasskeyNameError('Please enter a name for your passkey');
                input?.focus();
                return;
            }
            this.closePasskeyNameModal(name);
        });

        // Cancel buttons
        cancelBtn?.addEventListener('click', () => this.closePasskeyNameModal(null));
        cancelXBtn?.addEventListener('click', () => this.closePasskeyNameModal(null));

        // Backdrop click
        backdrop?.addEventListener('click', () => this.closePasskeyNameModal(null));

        // Enter key to confirm
        input?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                confirmBtn?.click();
            }
        });

        // Clear error on input
        input?.addEventListener('input', () => {
            this.hidePasskeyNameError();
        });
    }

    /**
     * Bind rename tag modal events
     */
    bindRenameTagModal() {
        if (!this.renameTagModal) return;

        const input = document.getElementById('rename-tag-input');
        const confirmBtn = document.getElementById('rename-tag-confirm');
        const cancelBtn = document.getElementById('rename-tag-cancel');
        const cancelXBtn = document.getElementById('rename-tag-cancel-x');
        const backdrop = this.renameTagModal.querySelector('.modal-backdrop');

        // Confirm button
        confirmBtn?.addEventListener('click', () => {
            const name = input?.value.trim();
            if (!name) {
                this.showRenameTagError('Please enter a name for the tag');
                input?.focus();
                return;
            }
            this.closeRenameTagModal(name);
        });

        // Cancel buttons
        cancelBtn?.addEventListener('click', () => this.closeRenameTagModal(null));
        cancelXBtn?.addEventListener('click', () => this.closeRenameTagModal(null));

        // Backdrop click
        backdrop?.addEventListener('click', () => this.closeRenameTagModal(null));

        // Enter key to confirm
        input?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                confirmBtn?.click();
            }
        });

        // Clear error on input
        input?.addEventListener('input', () => {
            this.hideRenameTagError();
        });
    }

    /**
     * Bind delete tag modal events
     */
    bindDeleteTagModal() {
        if (!this.deleteTagModal) return;

        const confirmBtn = document.getElementById('delete-tag-confirm');
        const cancelBtn = document.getElementById('delete-tag-cancel');
        const cancelXBtn = document.getElementById('delete-tag-cancel-x');
        const backdrop = this.deleteTagModal.querySelector('.modal-backdrop');

        // Confirm button
        confirmBtn?.addEventListener('click', () => {
            this.closeDeleteTagModal(true);
        });

        // Cancel buttons
        cancelBtn?.addEventListener('click', () => this.closeDeleteTagModal(false));
        cancelXBtn?.addEventListener('click', () => this.closeDeleteTagModal(false));

        // Backdrop click
        backdrop?.addEventListener('click', () => this.closeDeleteTagModal(false));
    }

    /**
     * Show the passkey name modal and return a promise with the name
     */
    showPasskeyNameModal() {
        return new Promise((resolve) => {
            this.passkeyNameResolve = resolve;

            const input = document.getElementById('passkey-name-input');
            const errorEl = document.getElementById('passkey-name-error');

            // Reset state
            if (input) {
                input.value = '';
            }
            if (errorEl) {
                errorEl.classList.add('hidden');
            }

            // Show modal
            this.passkeyNameModal.classList.remove('hidden');
            document.body.style.overflow = 'hidden';

            // Re-initialize Lucide icons for the modal
            if (typeof lucide !== 'undefined') {
                lucide.createIcons();
            }

            // Focus input after a short delay (for animation)
            setTimeout(() => {
                input?.focus();
            }, 100);
        });
    }

    /**
     * Close the passkey name modal
     */
    closePasskeyNameModal(name) {
        this.passkeyNameModal?.classList.add('hidden');

        // Only restore body scroll if settings modal is also closed
        if (this.modal.classList.contains('hidden')) {
            document.body.style.overflow = '';
        }

        if (this.passkeyNameResolve) {
            this.passkeyNameResolve(name);
            this.passkeyNameResolve = null;
        }
    }

    /**
     * Show error in passkey name modal
     */
    showPasskeyNameError(message) {
        const errorEl = document.getElementById('passkey-name-error');
        if (errorEl) {
            const span = errorEl.querySelector('span');
            if (span) span.textContent = message;
            errorEl.classList.remove('hidden');
        }
    }

    /**
     * Hide error in passkey name modal
     */
    hidePasskeyNameError() {
        const errorEl = document.getElementById('passkey-name-error');
        if (errorEl) {
            errorEl.classList.add('hidden');
        }
    }

    /**
     * Show the rename tag modal and return a promise with the new name
     */
    showRenameTagModal(oldName) {
        return new Promise((resolve) => {
            this.renameTagResolve = resolve;

            const input = document.getElementById('rename-tag-input');
            const oldNameEl = document.getElementById('rename-tag-old-name');
            const errorEl = document.getElementById('rename-tag-error');

            // Set old name in description
            if (oldNameEl) {
                oldNameEl.textContent = oldName;
            }

            // Reset state
            if (input) {
                input.value = oldName;
            }
            if (errorEl) {
                errorEl.classList.add('hidden');
            }

            // Show modal
            this.renameTagModal.classList.remove('hidden');
            document.body.style.overflow = 'hidden';

            // Re-initialize Lucide icons for the modal
            if (typeof lucide !== 'undefined') {
                lucide.createIcons();
            }

            // Focus and select input after a short delay (for animation)
            setTimeout(() => {
                input?.focus();
                input?.select();
            }, 100);
        });
    }

    /**
     * Close the rename tag modal
     */
    closeRenameTagModal(name) {
        this.renameTagModal?.classList.add('hidden');

        // Only restore body scroll if settings modal is also closed
        if (this.modal.classList.contains('hidden')) {
            document.body.style.overflow = '';
        }

        if (this.renameTagResolve) {
            this.renameTagResolve(name);
            this.renameTagResolve = null;
        }
    }

    /**
     * Show error in rename tag modal
     */
    showRenameTagError(message) {
        const errorEl = document.getElementById('rename-tag-error');
        if (errorEl) {
            const span = errorEl.querySelector('span');
            if (span) {
                span.textContent = message;
            }
            errorEl.classList.remove('hidden');

            // Re-initialize Lucide icons
            if (typeof lucide !== 'undefined') {
                lucide.createIcons();
            }
        }
    }

    /**
     * Hide error in rename tag modal
     */
    hideRenameTagError() {
        const errorEl = document.getElementById('rename-tag-error');
        if (errorEl) {
            errorEl.classList.add('hidden');
        }
    }

    /**
     * Show the delete tag modal and return a promise with confirmation
     */
    showDeleteTagModal(tagName, count) {
        return new Promise((resolve) => {
            this.deleteTagResolve = resolve;

            const tagNameEl = document.getElementById('delete-tag-name');
            const warningEl = document.getElementById('delete-tag-warning');
            const countEl = document.getElementById('delete-tag-count');

            // Set tag name
            if (tagNameEl) {
                tagNameEl.textContent = tagName;
            }

            // Show/hide warning based on count
            if (count > 0) {
                if (countEl) {
                    countEl.textContent = count.toString();
                }
                warningEl?.classList.remove('hidden');
            } else {
                warningEl?.classList.add('hidden');
            }

            // Show modal
            this.deleteTagModal.classList.remove('hidden');
            document.body.style.overflow = 'hidden';

            // Re-initialize Lucide icons for the modal
            if (typeof lucide !== 'undefined') {
                lucide.createIcons();
            }
        });
    }

    /**
     * Close the delete tag modal
     */
    closeDeleteTagModal(confirmed) {
        this.deleteTagModal?.classList.add('hidden');

        // Only restore body scroll if settings modal is also closed
        if (this.modal.classList.contains('hidden')) {
            document.body.style.overflow = '';
        }

        if (this.deleteTagResolve) {
            this.deleteTagResolve(confirmed);
            this.deleteTagResolve = null;
        }
    }

    initPasswordToggles() {
        this.modal.querySelectorAll('.password-toggle').forEach((toggle) => {
            toggle.addEventListener('click', () => {
                const wrapper = toggle.closest('.password-input-wrapper');
                const input = wrapper.querySelector('input');
                const eyeOpen = toggle.querySelector('.eye-open');
                const eyeClosed = toggle.querySelector('.eye-closed');

                if (input.type === 'password') {
                    input.type = 'text';
                    eyeOpen.classList.add('hidden');
                    eyeClosed.classList.remove('hidden');
                } else {
                    input.type = 'password';
                    eyeOpen.classList.remove('hidden');
                    eyeClosed.classList.add('hidden');
                }
            });
        });
    }

    open(tab = 'security') {
        this.modal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
        this.switchTab(tab);

        // Re-initialize Lucide icons
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }

        // Focus first focusable element
        const firstFocusable = this.modal.querySelector(
            'button, input, [tabindex]:not([tabindex="-1"])'
        );
        if (firstFocusable) {
            firstFocusable.focus();
        }
    }

    close() {
        this.modal.classList.add('hidden');
        document.body.style.overflow = '';
        this.clearMessages();
        this.resetForms();
    }

    switchTab(tabName) {
        this.currentTab = tabName;

        // Update tab buttons
        this.modal.querySelectorAll('.settings-tab').forEach((tab) => {
            const isActive = tab.dataset.tab === tabName;
            tab.classList.toggle('active', isActive);
            tab.setAttribute('aria-selected', isActive);
        });

        // Update panels
        this.modal.querySelectorAll('.settings-panel').forEach((panel) => {
            panel.classList.toggle('active', panel.id === `settings-${tabName}`);
        });

        // Load tab-specific data
        switch (tabName) {
            case 'passkeys':
                this.loadPasskeys();
                break;
            case 'display':
                this.loadDisplaySettings();
                break;
            case 'tags':
                this.loadTags();
                break;
            case 'cache':
                this.loadCacheStats();
                break;
            case 'about':
                this.loadAboutInfo();
                break;
        }
    }

    clearMessages() {
        this.modal.querySelectorAll('.error-message, .success-message').forEach((el) => {
            el.classList.add('hidden');
        });
    }

    resetForms() {
        this.modal.querySelectorAll('form').forEach((form) => form.reset());
    }

    showError(containerId, message) {
        const container = document.getElementById(containerId);
        if (container) {
            const span = container.querySelector('span');
            if (span) span.textContent = message;
            container.classList.remove('hidden');
        }
    }

    showSuccess(containerId, message) {
        const container = document.getElementById(containerId);
        if (container) {
            const span = container.querySelector('span');
            if (span) span.textContent = message;
            container.classList.remove('hidden');
        }
    }

    hideElement(id) {
        document.getElementById(id)?.classList.add('hidden');
    }

    showElement(id) {
        document.getElementById(id)?.classList.remove('hidden');
    }

    // =========================================
    // PASSWORD MANAGEMENT
    // =========================================

    async handlePasswordChange(e) {
        e.preventDefault();
        this.clearMessages();

        const form = e.target;
        const currentPassword = form.querySelector('#settings-current-password').value;
        const newPassword = form.querySelector('#settings-new-password').value;
        const confirmPassword = form.querySelector('#settings-confirm-password').value;
        const submitBtn = form.querySelector('button[type="submit"]');

        // Validation
        if (newPassword !== confirmPassword) {
            this.showError('settings-password-error', 'New passwords do not match');
            return;
        }

        if (newPassword.length < 6) {
            this.showError('settings-password-error', 'Password must be at least 6 characters');
            return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = 'Updating...';

        try {
            const response = await fetch('/api/auth/password', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    currentPassword,
                    newPassword,
                }),
            });

            if (response.ok) {
                this.showSuccess(
                    'settings-password-success',
                    'Password updated successfully. You may need to log in again on other devices.'
                );
                form.reset();
            } else {
                const error = await response.text();
                this.showError('settings-password-error', error || 'Failed to update password');
            }
        } catch (err) {
            console.error('Password change error:', err);
            this.showError('settings-password-error', 'Connection error. Please try again.');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Update Password';
        }
    }

    // =========================================
    // PASSKEY MANAGEMENT
    // =========================================

    async loadPasskeys() {
        const listContainer = document.getElementById('passkeys-list');
        const emptyContainer = document.getElementById('passkeys-empty');
        const loadingContainer = document.getElementById('passkeys-loading');
        const notSupportedContainer = document.getElementById('passkeys-not-supported');
        const insecureContainer = document.getElementById('passkeys-insecure-context');
        const notEnabledContainer = document.getElementById('passkeys-not-enabled');
        const addBtn = document.getElementById('add-passkey-btn');

        // Show loading while we check
        this.showElement('passkeys-loading');
        this.hideElement('passkeys-list');
        this.hideElement('passkeys-empty');
        this.hideElement('passkeys-not-supported');
        this.hideElement('passkeys-insecure-context');
        if (notEnabledContainer) this.hideElement('passkeys-not-enabled');

        if (!window.webAuthnManager) {
            this.hideElement('passkeys-loading');
            this.showElement('passkeys-not-supported');
            if (addBtn) addBtn.style.display = 'none';
            return;
        }

        // Check server configuration FIRST (most likely issue)
        try {
            const response = await fetch('/api/auth/webauthn/available');

            if (response.ok) {
                const data = await response.json();
                console.debug('Settings: Server response:', data);

                // If WebAuthn is not enabled on server, show specific message
                if (data.enabled !== true) {
                    this.hideElement('passkeys-loading');
                    if (notEnabledContainer) {
                        this.showElement('passkeys-not-enabled');
                    } else {
                        this.showElement('passkeys-not-supported');
                    }
                    if (addBtn) addBtn.style.display = 'none';
                    return;
                }

                // If there's a configuration error, show it
                if (data.configError) {
                    console.error('WebAuthn configuration error:', data.configError);
                    this.hideElement('passkeys-loading');
                    if (notEnabledContainer) {
                        this.showElement('passkeys-not-enabled');
                    } else {
                        this.showElement('passkeys-not-supported');
                    }
                    if (addBtn) addBtn.style.display = 'none';
                    return;
                }

                // If enabled but not available due to other issues (not just missing credentials)
                // Check: if hasCredentials is false, that's OK - we just show empty state
                // But if available is false AND hasCredentials is true, something is wrong
                if (data.available !== true && data.hasCredentials === true) {
                    this.hideElement('passkeys-loading');
                    if (notEnabledContainer) {
                        this.showElement('passkeys-not-enabled');
                    } else {
                        this.showElement('passkeys-not-supported');
                    }
                    if (addBtn) addBtn.style.display = 'none';
                    return;
                }

                // If enabled but no credentials yet, continue to show empty state
                // (don't return early - let it proceed to show passkeys-empty)
            }
        } catch (err) {
            console.error('Failed to check WebAuthn server status:', err);
            // Continue to check client-side issues
        }

        // Server is ready (or we couldn't check), now check client-side issues
        // Check for insecure context
        if (!window.webAuthnManager.isSecureContext) {
            console.debug('Settings: Not secure context');
            this.hideElement('passkeys-loading');
            this.hideElement('passkeys-list');
            this.hideElement('passkeys-empty');
            this.hideElement('passkeys-not-supported');
            if (notEnabledContainer) this.hideElement('passkeys-not-enabled');
            this.showElement('passkeys-insecure-context');
            if (addBtn) addBtn.style.display = 'none';
            return;
        }

        // Check browser WebAuthn support
        if (!window.webAuthnManager.supported) {
            console.debug('Settings: WebAuthn not supported by browser');
            this.hideElement('passkeys-loading');
            this.hideElement('passkeys-list');
            this.hideElement('passkeys-empty');
            this.hideElement('passkeys-insecure-context');
            if (notEnabledContainer) this.hideElement('passkeys-not-enabled');
            this.showElement('passkeys-not-supported');
            if (addBtn) addBtn.style.display = 'none';
            return;
        }

        console.debug('Settings: All checks passed, loading passkeys');
        // All checks passed, proceed to load passkeys
        this.hideElement('passkeys-not-supported');
        this.hideElement('passkeys-insecure-context');
        if (notEnabledContainer) this.hideElement('passkeys-not-enabled');
        this.showElement('passkeys-loading');
        this.hideElement('passkeys-list');
        this.hideElement('passkeys-empty');

        try {
            const passkeys = await window.webAuthnManager.listPasskeys();

            this.hideElement('passkeys-loading');

            if (passkeys.length === 0) {
                this.showElement('passkeys-empty');
                this.hideElement('passkeys-list');
            } else {
                this.hideElement('passkeys-empty');
                this.renderPasskeys(passkeys);
                this.showElement('passkeys-list');
            }

            if (addBtn) addBtn.style.display = '';
        } catch (err) {
            console.error('Failed to load passkeys:', err);
            this.hideElement('passkeys-loading');
            this.showError('passkeys-error', 'Failed to load passkeys. Please try again.');
        }
    }

    renderPasskeys(passkeys) {
        const listContainer = document.getElementById('passkeys-list');
        if (!listContainer) return;

        listContainer.innerHTML = passkeys
            .map(
                (pk) => `
            <div class="passkey-item" data-id="${pk.id}">
                <div class="passkey-info">
                    <div class="passkey-icon">
                        <i data-lucide="fingerprint"></i>
                    </div>
                    <div class="passkey-details">
                        <p class="passkey-name">${this.escapeHtml(pk.name)}</p>
                        <div class="passkey-meta">
                            <span title="Created">
                                <i data-lucide="calendar"></i>
                                Added ${this.formatDate(pk.createdAt)}
                            </span>
                            <span title="Last used">
                                <i data-lucide="clock"></i>
                                Last used ${this.formatDate(pk.lastUsedAt)}
                            </span>
                        </div>
                    </div>
                </div>
                <div class="passkey-actions">
                    <button type="button" class="passkey-delete" data-id="${pk.id}" title="Delete passkey" aria-label="Delete ${this.escapeHtml(pk.name)}">
                        <i data-lucide="trash-2"></i>
                    </button>
                </div>
            </div>
        `
            )
            .join('');

        // Re-initialize Lucide icons for the new content
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
    }

    /**
     * Add a new passkey - uses custom modal instead of browser prompt
     */
    async addPasskey() {
        const addBtn = document.getElementById('add-passkey-btn');

        // Show custom modal to get the name
        const name = await this.showPasskeyNameModal();

        // User cancelled
        if (!name) {
            return;
        }

        // Disable button and show loading state
        if (addBtn) {
            addBtn.disabled = true;
            addBtn.innerHTML = `
                <div class="spinner" style="width: 18px; height: 18px;"></div>
                Registering...
            `;
        }

        this.hideElement('passkeys-error');

        try {
            await window.webAuthnManager.registerPasskey(name);
            await this.loadPasskeys();

            // Show success message
            const errorEl = document.getElementById('passkeys-error');
            if (errorEl) {
                errorEl.classList.remove('error-message');
                errorEl.classList.add('success-message');
                const span = errorEl.querySelector('span');
                if (span) span.textContent = 'Passkey registered successfully!';
                errorEl.classList.remove('hidden');

                // Hide after 3 seconds
                setTimeout(() => {
                    errorEl.classList.add('hidden');
                    errorEl.classList.remove('success-message');
                    errorEl.classList.add('error-message');
                }, 3000);
            }
        } catch (err) {
            console.error('Failed to add passkey:', err);
            const errorEl = document.getElementById('passkeys-error');
            if (errorEl) {
                errorEl.classList.add('error-message');
                errorEl.classList.remove('success-message');
            }
            this.showError('passkeys-error', err.message || 'Failed to register passkey');
        } finally {
            if (addBtn) {
                addBtn.disabled = false;
                addBtn.innerHTML = `
                    <i data-lucide="plus"></i>
                    Add Passkey
                `;
                // Re-initialize icon
                if (typeof lucide !== 'undefined') {
                    lucide.createIcons();
                }
            }
        }
    }

    async deletePasskey(id) {
        // Find the passkey name for the confirmation
        const passkeyItem = document.querySelector(`.passkey-item[data-id="${id}"]`);
        const passkeyName =
            passkeyItem?.querySelector('.passkey-name')?.textContent || 'this passkey';

        // Use the app's confirm modal if available
        let confirmed = false;
        if (typeof MediaApp !== 'undefined' && MediaApp.showConfirmModal) {
            confirmed = await MediaApp.showConfirmModal({
                icon: 'trash-2',
                title: 'Delete Passkey?',
                message: `Are you sure you want to delete "${passkeyName}"? You will no longer be able to sign in using this passkey.`,
                confirmText: 'Delete',
            });
        } else {
            confirmed = confirm(
                `Are you sure you want to delete "${passkeyName}"?\n\n` +
                    `You will no longer be able to sign in using this passkey.`
            );
        }

        if (!confirmed) return;

        const deleteBtn = passkeyItem?.querySelector('.passkey-delete');
        if (deleteBtn) {
            deleteBtn.disabled = true;
            deleteBtn.innerHTML = '<div class="spinner" style="width: 16px; height: 16px;"></div>';
        }

        try {
            await window.webAuthnManager.deletePasskey(id);
            await this.loadPasskeys();
        } catch (err) {
            console.error('Failed to delete passkey:', err);
            this.showError('passkeys-error', err.message || 'Failed to delete passkey');

            // Restore button
            if (deleteBtn) {
                deleteBtn.disabled = false;
                deleteBtn.innerHTML = '<i data-lucide="trash-2"></i>';
                if (typeof lucide !== 'undefined') {
                    lucide.createIcons();
                }
            }
        }
    }

    // =========================================
    // CACHE MANAGEMENT
    // =========================================

    async rebuildThumbnails() {
        const btn = document.getElementById('rebuild-thumbnails-btn');

        const cacheSize = this.formatBytes(this.thumbnailCacheBytes);
        const fileCount = this.thumbnailCacheFiles;
        const fileText = fileCount === 1 ? 'file' : 'files';
        let confirmed = false;
        if (typeof MediaApp !== 'undefined' && MediaApp.showConfirmModal) {
            confirmed = await MediaApp.showConfirmModal({
                icon: 'refresh-cw',
                title: 'Rebuild Thumbnails?',
                message: `This will regenerate all thumbnails. This process may take a long time depending on your library size.<br><br>Current cache size: <strong>${cacheSize} (${fileCount} ${fileText})</strong>`,
                confirmText: 'Rebuild',
            });
        } else {
            confirmed = confirm(
                `This will regenerate all thumbnails (current cache: ${cacheSize}). Continue?`
            );
        }

        if (!confirmed) return;

        this.setCacheLoading(btn, true, 'Rebuilding...');
        this.showCacheStatus('Rebuilding thumbnails... This may take a while.');

        try {
            const response = await fetch('/api/thumbnails/rebuild', {
                method: 'POST',
            });

            if (response.ok) {
                this.showSuccess(
                    'cache-success',
                    'Thumbnail rebuild started. This will continue in the background.'
                );
                // Note: Cache size won't update immediately as rebuild happens in background
            } else {
                const error = await response.text();
                this.showError('cache-error', error || 'Failed to start thumbnail rebuild');
            }
        } catch (err) {
            console.error('Rebuild thumbnails error:', err);
            this.showError('cache-error', 'Connection error. Please try again.');
        } finally {
            this.setCacheLoading(btn, false, 'Rebuild Thumbnails');
            this.hideCacheStatus();
        }
    }

    async reindexMedia() {
        const btn = document.getElementById('reindex-btn');

        this.setCacheLoading(btn, true, 'Indexing...');
        this.showCacheStatus('Scanning for new and modified files...');

        try {
            const response = await fetch('/api/reindex', {
                method: 'POST',
            });

            if (response.ok) {
                this.showSuccess(
                    'cache-success',
                    'Media reindex started. New files will appear shortly.'
                );
            } else {
                const error = await response.text();
                this.showError('cache-error', error || 'Failed to start reindex');
            }
        } catch (err) {
            console.error('Reindex error:', err);
            this.showError('cache-error', 'Connection error. Please try again.');
        } finally {
            this.setCacheLoading(btn, false, 'Reindex Now');
            this.hideCacheStatus();
        }
    }

    async clearTranscodeCache() {
        const btn = document.getElementById('clear-transcode-btn');

        const cacheSize = this.formatBytes(this.transcodeCacheBytes);
        const fileCount = this.transcodeCacheFiles;
        const fileText = fileCount === 1 ? 'file' : 'files';
        let confirmed = false;
        if (typeof MediaApp !== 'undefined' && MediaApp.showConfirmModal) {
            confirmed = await MediaApp.showConfirmModal({
                icon: 'trash-2',
                title: 'Clear Transcode Cache?',
                message: `This will delete all cached video transcodes. Videos will be re-transcoded when played.<br><br>Size to be deleted: <strong>${cacheSize} (${fileCount} ${fileText})</strong>`,
                confirmText: 'Clear',
            });
        } else {
            confirmed = confirm(`Clear all transcoded videos (${cacheSize})?`);
        }

        if (!confirmed) return;

        this.setCacheLoading(btn, true, 'Clearing...');

        try {
            const response = await fetch('/api/transcode/clear', {
                method: 'POST',
            });

            if (response.ok) {
                const data = await response.json();
                this.showSuccess(
                    'cache-success',
                    `Transcode cache cleared. Freed ${this.formatBytes(data.freedBytes || 0)}.`
                );
                // Reload cache stats to show updated size
                this.loadCacheStats();
            } else {
                const error = await response.text();
                this.showError('cache-error', error || 'Failed to clear transcode cache');
            }
        } catch (err) {
            console.error('Clear transcode cache error:', err);
            this.showError('cache-error', 'Connection error. Please try again.');
        } finally {
            this.setCacheLoading(btn, false, 'Clear Cache');
        }
    }

    setCacheLoading(btn, loading, text) {
        if (!btn) return;

        btn.disabled = loading;
        if (loading) {
            btn.dataset.originalHtml = btn.innerHTML;
            btn.innerHTML = `<div class="spinner" style="width: 18px; height: 18px;"></div> ${text}`;
        } else {
            btn.innerHTML = btn.dataset.originalHtml || text;
            // Re-initialize icons
            if (typeof lucide !== 'undefined') {
                lucide.createIcons();
            }
        }
    }

    showCacheStatus(message) {
        const status = document.getElementById('cache-status');
        const statusText = document.getElementById('cache-status-text');
        if (status && statusText) {
            statusText.textContent = message;
            status.classList.remove('hidden');
        }
    }

    hideCacheStatus() {
        this.hideElement('cache-status');
    }

    // =========================================
    // ABOUT INFO
    // =========================================

    async loadAboutInfo() {
        try {
            // Load version
            const versionResponse = await fetch('/version');
            if (versionResponse.ok) {
                const versionData = await versionResponse.json();
                const versionEl = document.getElementById('app-version');
                if (versionEl) {
                    versionEl.textContent = `Version: ${versionData.version} (${versionData.commit?.substring(0, 7) || 'dev'})`;
                }
            }

            // Load stats
            const statsResponse = await fetch('/api/stats');
            if (statsResponse.ok) {
                const stats = await statsResponse.json();
                this.updateElement('stats-files', stats.totalFiles?.toLocaleString() || '0');
                this.updateElement('stats-images', stats.totalImages?.toLocaleString() || '0');
                this.updateElement('stats-videos', stats.totalVideos?.toLocaleString() || '0');
                this.updateElement('stats-folders', stats.totalFolders?.toLocaleString() || '0');
            }
        } catch (err) {
            console.error('Failed to load about info:', err);
        }
    }

    updateElement(id, value) {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    }

    // =========================================
    // CACHE STATS
    // =========================================

    async loadCacheStats() {
        try {
            const statsResponse = await fetch('/api/stats');
            if (statsResponse.ok) {
                const stats = await statsResponse.json();

                // Store cache sizes and file counts for use in confirmation modals
                this.thumbnailCacheBytes = stats.thumbnailCacheBytes || 0;
                this.thumbnailCacheFiles = stats.thumbnailCacheFiles || 0;
                this.transcodeCacheBytes = stats.transcodeCacheBytes || 0;
                this.transcodeCacheFiles = stats.transcodeCacheFiles || 0;

                // Update thumbnail cache size
                const thumbnailSizeEl = document.getElementById('thumbnail-cache-size');
                if (thumbnailSizeEl && stats.thumbnailCacheBytes !== undefined) {
                    const sizeText = this.formatBytes(stats.thumbnailCacheBytes);
                    const countText = stats.thumbnailCacheFiles || 0;
                    thumbnailSizeEl.textContent = `${sizeText} (${countText} files)`;
                }

                // Update transcode cache size
                const transcodeSizeEl = document.getElementById('transcode-cache-size');
                if (transcodeSizeEl && stats.transcodeCacheBytes !== undefined) {
                    const sizeText = this.formatBytes(stats.transcodeCacheBytes);
                    const countText = stats.transcodeCacheFiles || 0;
                    transcodeSizeEl.textContent = `${sizeText} (${countText} files)`;
                }
            }
        } catch (err) {
            console.error('Failed to load cache stats:', err);
        }
    }

    // =========================================
    // DISPLAY SETTINGS
    // =========================================

    /**
     * Load display settings when the Display tab is opened
     */
    loadDisplaySettings() {
        // Load clock enabled state
        const clockToggle = document.getElementById('clock-enabled-toggle');
        if (clockToggle) {
            clockToggle.checked = Preferences.isClockEnabled();
        }

        // Load clock format
        const clockFormatSelect = document.getElementById('clock-format-select');
        if (clockFormatSelect) {
            clockFormatSelect.value = Preferences.getClockFormat();
        }

        // Load clock always visible state
        const clockAlwaysVisibleToggle = document.getElementById('clock-always-visible-toggle');
        if (clockAlwaysVisibleToggle) {
            const clockEnabled = Preferences.isClockEnabled();
            clockAlwaysVisibleToggle.checked = Preferences.isClockAlwaysVisible();
            clockAlwaysVisibleToggle.disabled = !clockEnabled;

            // Update parent row styling to show disabled state
            const row = clockAlwaysVisibleToggle.closest('.settings-row');
            if (row) {
                row.classList.toggle('disabled', !clockEnabled);
            }
        }

        // Load sort field
        const sortFieldSelect = document.getElementById('default-sort-field');
        if (sortFieldSelect) {
            sortFieldSelect.value = Preferences.get('sortField');
        }

        // Load sort order
        const sortOrderSelect = document.getElementById('default-sort-order');
        if (sortOrderSelect) {
            sortOrderSelect.value = Preferences.get('sortOrder');
        }
    }

    /**
     * Handle clock enable/disable toggle
     */
    handleClockToggle() {
        const clockToggle = document.getElementById('clock-enabled-toggle');
        if (!clockToggle) return;

        const isEnabled = Preferences.toggleClock();

        // Update always visible toggle state
        const clockAlwaysVisibleToggle = document.getElementById('clock-always-visible-toggle');
        if (clockAlwaysVisibleToggle) {
            clockAlwaysVisibleToggle.disabled = !isEnabled;

            // Update parent row styling
            const row = clockAlwaysVisibleToggle.closest('.settings-row');
            if (row) {
                row.classList.toggle('disabled', !isEnabled);
            }

            // Set to false if clock is disabled
            if (!isEnabled && clockAlwaysVisibleToggle.checked) {
                clockAlwaysVisibleToggle.checked = false;
                Preferences.setClockAlwaysVisible(false);
            }
        }

        // Notify Clock component to update visibility
        if (typeof Clock !== 'undefined' && Clock) {
            Clock.updateVisibility();
        }

        console.debug('Clock toggled:', clockToggle.checked);
    }

    /**
     * Handle clock format change
     */
    handleClockFormatChange() {
        const clockFormatSelect = document.getElementById('clock-format-select');
        if (!clockFormatSelect) return;

        Preferences.setClockFormat(clockFormatSelect.value);

        // Notify Clock component to update display
        if (typeof Clock !== 'undefined' && Clock) {
            Clock.updateTime();
        }

        console.debug('Clock format changed:', clockFormatSelect.value);
    }

    /**
     * Handle clock always visible toggle
     */
    handleClockAlwaysVisibleToggle() {
        const clockAlwaysVisibleToggle = document.getElementById('clock-always-visible-toggle');
        if (!clockAlwaysVisibleToggle) return;

        Preferences.setClockAlwaysVisible(clockAlwaysVisibleToggle.checked);

        console.debug('Clock always visible toggled:', clockAlwaysVisibleToggle.checked);
    }

    /**
     * Handle sort field change
     */
    handleSortFieldChange() {
        const sortFieldSelect = document.getElementById('default-sort-field');
        if (!sortFieldSelect) return;

        Preferences.set('sortField', sortFieldSelect.value);

        // Update gallery sort dropdown
        const gallerySortSelect = document.getElementById('sort-select');
        if (gallerySortSelect) {
            gallerySortSelect.value = sortFieldSelect.value;
        }

        // Update MediaApp state and reload if gallery is visible
        if (typeof MediaApp !== 'undefined' && MediaApp.state) {
            MediaApp.state.currentSort.field = sortFieldSelect.value;
            if (!document.getElementById('gallery').classList.contains('hidden')) {
                MediaApp.loadDirectory(MediaApp.state.currentPath);
            }
        }

        console.debug('Sort field changed:', sortFieldSelect.value);
    }

    /**
     * Handle sort order change
     */
    handleSortOrderChange() {
        const sortOrderSelect = document.getElementById('default-sort-order');
        if (!sortOrderSelect) return;

        Preferences.set('sortOrder', sortOrderSelect.value);

        // Update gallery sort direction button icon
        const sortDirButton = document.getElementById('sort-direction');
        if (sortDirButton) {
            const icon = sortDirButton.querySelector('i');
            if (icon) {
                icon.setAttribute(
                    'data-lucide',
                    sortOrderSelect.value === 'asc' ? 'arrow-up' : 'arrow-down'
                );
                if (typeof lucide !== 'undefined') {
                    lucide.createIcons();
                }
            }
        }

        // Update MediaApp state and reload if gallery is visible
        if (typeof MediaApp !== 'undefined' && MediaApp.state) {
            MediaApp.state.currentSort.order = sortOrderSelect.value;
            if (!document.getElementById('gallery').classList.contains('hidden')) {
                MediaApp.loadDirectory(MediaApp.state.currentPath);
            }
        }

        console.debug('Sort order changed:', sortOrderSelect.value);
    }

    // =========================================
    // TAG MANAGER
    // =========================================

    /**
     * Load all tags with usage counts
     */
    async loadTags() {
        const tbody = document.getElementById('tag-list-body');
        if (!tbody) return;

        // Show loading state
        tbody.innerHTML = '<tr class="tag-list-loading"><td colspan="3">Loading tags...</td></tr>';

        try {
            const response = await fetch('/api/tags/stats', {
                headers: {
                    Authorization: `Bearer ${sessionStorage.getItem('token')}`,
                },
            });

            if (!response.ok) {
                throw new Error('Failed to load tags');
            }

            const tags = await response.json();
            this.allTags = tags;
            this.filteredTags = tags;
            this.showingUnused = false;
            this.currentSort = { field: 'count', order: 'desc' };

            this.renderTags();
            this.updateSortIndicators();
        } catch (error) {
            console.error('Error loading tags:', error);
            tbody.innerHTML = `
                <tr class="tag-list-empty">
                    <td colspan="3">
                        <i data-lucide="alert-circle"></i>
                        <div>Failed to load tags</div>
                    </td>
                </tr>
            `;
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }
    }

    /**
     * Render tags in the table
     */
    renderTags() {
        const tbody = document.getElementById('tag-list-body');
        if (!tbody) return;

        if (!this.filteredTags || this.filteredTags.length === 0) {
            tbody.innerHTML = `
                <tr class="tag-list-empty">
                    <td colspan="3">
                        <i data-lucide="tag"></i>
                        <div>No tags found</div>
                    </td>
                </tr>
            `;
            if (typeof lucide !== 'undefined') lucide.createIcons();
            return;
        }

        tbody.innerHTML = this.filteredTags
            .map((tag) => {
                const colorStyle = tag.color
                    ? `background-color: ${this.escapeHtml(tag.color)}`
                    : '';
                const colorIndicator = colorStyle
                    ? `<span class="tag-color-indicator" style="${colorStyle}"></span>`
                    : '';

                return `
                <tr>
                    <td>
                        <div class="tag-name-cell">
                            ${colorIndicator}
                            <span class="tag-name-text">${this.escapeHtml(tag.name)}</span>
                        </div>
                    </td>
                    <td>
                        <span class="tag-count">${tag.count}</span>
                    </td>
                    <td>
                        <div class="tag-actions">
                            <button
                                class="tag-action-btn rename"
                                data-tag="${this.escapeHtml(tag.name)}"
                                title="Rename tag"
                                aria-label="Rename ${this.escapeHtml(tag.name)}"
                            >
                                <i data-lucide="edit"></i>
                            </button>
                            <button
                                class="tag-action-btn delete"
                                data-tag="${this.escapeHtml(tag.name)}"
                                title="Delete tag"
                                aria-label="Delete ${this.escapeHtml(tag.name)}"
                            >
                                <i data-lucide="trash-2"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
            })
            .join('');

        if (typeof lucide !== 'undefined') lucide.createIcons();
    }

    /**
     * Filter tags based on search input
     */
    filterTags() {
        const searchInput = document.getElementById('tag-search-input');
        if (!searchInput || !this.allTags) return;

        const searchTerm = searchInput.value.toLowerCase().trim();

        if (!searchTerm) {
            this.filteredTags = this.allTags;
        } else {
            this.filteredTags = this.allTags.filter((tag) =>
                tag.name.toLowerCase().includes(searchTerm)
            );
        }

        this.renderTags();
    }

    /**
     * Sort tags by field
     */
    sortTags(field) {
        if (!this.filteredTags) return;

        // Toggle order if clicking same field
        if (this.currentSort.field === field) {
            this.currentSort.order = this.currentSort.order === 'asc' ? 'desc' : 'asc';
        } else {
            this.currentSort.field = field;
            this.currentSort.order = field === 'count' ? 'desc' : 'asc';
        }

        // Sort the array
        this.filteredTags.sort((a, b) => {
            let aVal = a[field];
            let bVal = b[field];

            // Handle string comparison for name
            if (field === 'name') {
                aVal = aVal.toLowerCase();
                bVal = bVal.toLowerCase();
            }

            if (this.currentSort.order === 'asc') {
                return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
            } else {
                return aVal > bVal ? -1 : aVal < bVal ? 1 : 0;
            }
        });

        this.renderTags();
        this.updateSortIndicators();
    }

    /**
     * Update sort indicators in table headers
     */
    updateSortIndicators() {
        document.querySelectorAll('.tag-list-table th.sortable').forEach((th) => {
            const field = th.dataset.sort;
            th.classList.remove('sorted-asc', 'sorted-desc');

            if (field === this.currentSort.field) {
                th.classList.add(this.currentSort.order === 'asc' ? 'sorted-asc' : 'sorted-desc');
            }
        });

        // Re-render icons to ensure visual updates
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
    }

    /**
     * Toggle showing only unused tags
     */
    async toggleUnusedTags() {
        const btn = document.getElementById('show-unused-tags-btn');
        if (!btn) return;

        this.showingUnused = !this.showingUnused;

        if (this.showingUnused) {
            // Load unused tags
            btn.disabled = true;
            btn.innerHTML = '<i data-lucide="loader"></i> Loading...';
            if (typeof lucide !== 'undefined') lucide.createIcons();

            try {
                const response = await fetch('/api/tags/unused', {
                    headers: {
                        Authorization: `Bearer ${sessionStorage.getItem('token')}`,
                    },
                });

                if (!response.ok) {
                    throw new Error('Failed to load unused tags');
                }

                const unusedNames = await response.json();

                // Filter to only show unused tags
                this.filteredTags = this.allTags.filter((tag) => unusedNames.includes(tag.name));

                btn.innerHTML = '<i data-lucide="filter-x"></i> Show All Tags';
                this.renderTags();
            } catch (error) {
                console.error('Error loading unused tags:', error);
                this.showTagStatus('Failed to load unused tags', 'error');
                this.showingUnused = false;
            } finally {
                btn.disabled = false;
                if (typeof lucide !== 'undefined') lucide.createIcons();
            }
        } else {
            // Show all tags
            this.filteredTags = this.allTags;
            btn.innerHTML = '<i data-lucide="filter"></i> Show Only Unused';
            this.renderTags();
            if (typeof lucide !== 'undefined') lucide.createIcons();
        }
    }

    /**
     * Rename a tag
     */
    async renameTag(tagName) {
        const newName = await this.showRenameTagModal(tagName);
        if (!newName || newName === tagName) return;

        if (!newName.trim()) {
            this.showTagStatus('Tag name cannot be empty', 'error');
            return;
        }

        try {
            const response = await fetch(`/api/tags/${encodeURIComponent(tagName)}/rename`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${sessionStorage.getItem('token')}`,
                },
                body: JSON.stringify({ newName: newName.trim() }),
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to rename tag');
            }

            const result = await response.json();
            this.showTagStatus(
                `Renamed "${tagName}" to "${newName}" (${result.affectedFiles} files updated)`,
                'success'
            );

            // Reload tags
            await this.loadTags();
        } catch (error) {
            console.error('Error renaming tag:', error);
            this.showTagStatus(error.message || 'Failed to rename tag', 'error');
        }
    }

    /**
     * Delete a tag
     */
    async deleteTag(tagName) {
        // Find the tag to show count in confirmation
        const tag = this.allTags.find((t) => t.name === tagName);
        const count = tag ? tag.count : 0;

        // Show confirmation modal
        const confirmed = await this.showDeleteTagModal(tagName, count);
        if (!confirmed) return;

        try {
            const response = await fetch(`/api/tags/${encodeURIComponent(tagName)}/delete`, {
                method: 'DELETE',
                headers: {
                    Authorization: `Bearer ${sessionStorage.getItem('token')}`,
                },
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to delete tag');
            }

            const result = await response.json();
            this.showTagStatus(
                `Deleted "${tagName}" (${result.affectedFiles} files updated)`,
                'success'
            );

            // Reload tags
            await this.loadTags();
        } catch (error) {
            console.error('Error deleting tag:', error);
            this.showTagStatus(error.message || 'Failed to delete tag', 'error');
        }
    }

    /**
     * Show status message in tag manager
     */
    showTagStatus(message, type = 'success') {
        const statusEl = document.getElementById('tag-manager-status');
        if (!statusEl) return;

        statusEl.textContent = message;
        statusEl.className = `tag-manager-status ${type}`;

        // Auto-hide after 5 seconds
        setTimeout(() => {
            statusEl.classList.add('hidden');
        }, 5000);
    }

    // =========================================
    // UTILITY METHODS
    // =========================================

    formatDate(dateStr) {
        if (!dateStr) return 'Never';

        const date = new Date(dateStr);
        const now = new Date();
        const diffMs = now - date;
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffMinutes = Math.floor(diffMs / (1000 * 60));

        if (diffMinutes < 1) return 'just now';
        if (diffMinutes < 60) return `${diffMinutes}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays === 1) return 'yesterday';
        if (diffDays < 7) return `${diffDays} days ago`;
        if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;

        return date.toLocaleDateString();
    }

    formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
}

// Initialize settings manager when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.settingsManager = new SettingsManager();
});
