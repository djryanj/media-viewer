/**
 * Settings Manager
 * Handles the settings modal, tabs, and all settings functionality
 */
class SettingsManager {
    constructor() {
        this.modal = document.getElementById('settings-modal');
        this.passkeyNameModal = document.getElementById('passkey-name-modal');
        this.currentTab = 'security';
        this.passkeyNameResolve = null; // For promise resolution

        if (!this.modal) {
            console.error('Settings modal not found');
            return;
        }

        this.init();
    }

    init() {
        this.bindEvents();
        this.bindPasskeyNameModal();
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
                if (this.passkeyNameModal && !this.passkeyNameModal.classList.contains('hidden')) {
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
        const addBtn = document.getElementById('add-passkey-btn');

        // Check WebAuthn support
        if (!window.webAuthnManager || !window.webAuthnManager.supported) {
            this.hideElement('passkeys-loading');
            this.hideElement('passkeys-list');
            this.hideElement('passkeys-empty');
            this.showElement('passkeys-not-supported');
            if (addBtn) addBtn.style.display = 'none';
            return;
        }

        this.hideElement('passkeys-not-supported');
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

        let confirmed = false;
        if (typeof MediaApp !== 'undefined' && MediaApp.showConfirmModal) {
            confirmed = await MediaApp.showConfirmModal({
                icon: 'refresh-cw',
                title: 'Rebuild Thumbnails?',
                message:
                    'This will regenerate all thumbnails. This process may take a long time depending on your library size.',
                confirmText: 'Rebuild',
            });
        } else {
            confirmed = confirm('This will regenerate all thumbnails. Continue?');
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

        let confirmed = false;
        if (typeof MediaApp !== 'undefined' && MediaApp.showConfirmModal) {
            confirmed = await MediaApp.showConfirmModal({
                icon: 'trash-2',
                title: 'Clear Transcode Cache?',
                message:
                    'This will delete all cached video transcodes. Videos will be re-transcoded when played.',
                confirmText: 'Clear',
            });
        } else {
            confirmed = confirm('Clear all transcoded videos?');
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
