/**
 * System confirm modal — export data + destructive account actions.
 * Uses the menu-bubble glass panel style. Public via window helpers.
 */
(function () {
    var MODE = {
        EXPORT: 'export',
        RESET_SETTINGS: 'reset-settings',
        RESET_ACCOUNT: 'reset-account',
        DELETE_ACCOUNT: 'delete-account',
        LOGOUT_ALL: 'logout-all',
    };

    var currentMode = null;
    var busy = false;

    function $(id) {
        return document.getElementById(id);
    }

    function toast(message, icon) {
        if (window.usertypoNotifications && typeof window.usertypoNotifications.showToast === 'function') {
            window.usertypoNotifications.showToast(message, icon || 'check_circle');
            return;
        }
        if (typeof window.triggerSave === 'function' && message.indexOf('reset') !== -1) {
            window.triggerSave('reset');
            return;
        }
        try { window.alert(message); } catch (e) { /* ignore */ }
    }

    function setBusy(isBusy) {
        busy = !!isBusy;
        var ok = $('system-confirm-ok');
        var cancel = $('system-confirm-cancel');
        if (ok) {
            ok.disabled = busy;
            ok.classList.toggle('opacity-60', busy);
            ok.classList.toggle('cursor-not-allowed', busy);
        }
        if (cancel) cancel.disabled = busy;
    }

    function setStatus(text, isError) {
        var el = $('system-confirm-status');
        if (!el) return;
        if (!text) {
            el.textContent = '';
            el.classList.add('hidden');
            el.classList.remove('text-error', 'text-slate-500');
            return;
        }
        el.textContent = text;
        el.classList.remove('hidden');
        el.classList.toggle('text-error', !!isError);
        el.classList.toggle('text-slate-500', !isError);
    }

    function configure(mode) {
        currentMode = mode;
        var title = $('system-confirm-title');
        var message = $('system-confirm-message');
        var icon = $('system-confirm-icon');
        var ok = $('system-confirm-ok');

        setStatus('');
        setBusy(false);

        if (ok) {
            ok.classList.remove('system-confirm-ok-danger');
            ok.classList.add(
                'bg-primary/15',
                'hover:bg-primary/25',
                'text-primary',
                'border',
                'border-primary/25'
            );
        }

        if (mode === MODE.EXPORT) {
            if (title) title.textContent = 'Export Data';
            if (message) message.textContent = 'Would you like to download your usertypo_ data?';
            if (icon) icon.textContent = 'download';
            if (ok) ok.textContent = 'Download';
            return;
        }

        if (mode === MODE.RESET_SETTINGS) {
            if (title) title.textContent = 'Reset All Settings';
            if (message) message.textContent = 'This will restore every typing setting to its default value. Continue?';
            if (icon) icon.textContent = 'refresh';
            if (ok) {
                ok.textContent = 'Reset';
                ok.classList.add('system-confirm-ok-danger');
            }
            return;
        }

        if (mode === MODE.LOGOUT_ALL) {
            if (title) title.textContent = 'Logout from all devices';
            if (message) message.textContent = 'This signs you out of every active session, including this one. Continue?';
            if (icon) icon.textContent = 'logout';
            if (ok) {
                ok.textContent = 'Logout All';
                ok.classList.add('system-confirm-ok-danger');
            }
            return;
        }

        if (mode === MODE.RESET_ACCOUNT) {
            if (title) title.textContent = 'Reset Account';
            if (message) message.textContent = 'This permanently clears your test history, stats, friends, notifications, and progress. Your login stays. Continue?';
            if (icon) icon.textContent = 'restart_alt';
            if (ok) {
                ok.textContent = 'Reset';
                ok.classList.add('system-confirm-ok-danger');
            }
            return;
        }

        if (mode === MODE.DELETE_ACCOUNT) {
            if (title) title.textContent = 'Delete Account';
            if (message) message.textContent = 'This permanently deletes your usertypo_ account and all associated data. This cannot be undone.';
            if (icon) icon.textContent = 'person_remove';
            if (ok) {
                ok.textContent = 'Delete';
                ok.classList.add('system-confirm-ok-danger');
            }
        }
    }

    function setOpen(isOpen) {
        var modal = $('system-confirm-modal');
        var box = $('system-confirm-box');
        if (!modal || !box) return;
        if (isOpen) {
            modal.classList.remove('pointer-events-none', 'opacity-0');
            modal.classList.add('pointer-events-auto', 'opacity-100');
            box.classList.remove('scale-95', 'opacity-0');
            box.classList.add('scale-100', 'opacity-100');
            modal.setAttribute('aria-hidden', 'false');
        } else {
            modal.classList.add('pointer-events-none', 'opacity-0');
            modal.classList.remove('pointer-events-auto', 'opacity-100');
            box.classList.add('scale-95', 'opacity-0');
            box.classList.remove('scale-100', 'opacity-100');
            modal.setAttribute('aria-hidden', 'true');
            currentMode = null;
            setBusy(false);
            setStatus('');
        }
    }

    function openModal(mode) {
        if (!$('system-confirm-modal')) return;
        configure(mode);
        setOpen(true);
    }

    function closeModal() {
        if (busy) return;
        setOpen(false);
    }

    async function requireSignedIn() {
        if (!window.usertypoAuth) {
            if (window.navigateTo) window.navigateTo('/signin');
            else window.location.href = '/signin';
            return false;
        }
        await window.usertypoAuth.ready();
        var state = window.usertypoAuth.getState();
        if (!state.isSignedIn) {
            if (window.navigateTo) window.navigateTo('/signin');
            else window.location.href = '/signin';
            return false;
        }
        return true;
    }

    async function runExport() {
        if (!window.usertypoSessions || typeof window.usertypoSessions.exportTestHistoryCsv !== 'function') {
            throw new Error('Export unavailable.');
        }
        var result = await window.usertypoSessions.exportTestHistoryCsv();
        if (result && result.error) {
            throw new Error(result.message || 'No test history to export.');
        }
        toast('Data downloaded.', 'download');
    }

    async function runResetSettings() {
        if (!window.usertypo_settingsApi || typeof window.usertypo_settingsApi.resetToDefaults !== 'function') {
            throw new Error('Settings reset unavailable.');
        }
        window.usertypo_settingsApi.resetToDefaults();
        if (typeof window.triggerSave === 'function') window.triggerSave('reset');
        else toast('Settings reset to defaults', 'refresh');
    }

    async function runLogoutAll() {
        if (!window.usertypoAccount) throw new Error('Account helpers unavailable.');
        await window.usertypoAccount.logoutAllDevices();
        toast('Signed out of all devices.', 'logout');
        if (window.navigateTo) window.navigateTo('/signin');
        else window.location.href = '/signin';
    }

    async function runResetAccount() {
        if (!window.usertypoAccount) throw new Error('Account helpers unavailable.');
        await window.usertypoAccount.resetAccountData();
        toast('Account data cleared.', 'restart_alt');
    }

    async function runDeleteAccount() {
        if (!window.usertypoAccount) throw new Error('Account helpers unavailable.');
        await window.usertypoAccount.deleteAccount();
        toast('Account deleted.', 'person_remove');
        if (window.navigateTo) window.navigateTo('/');
        else window.location.href = '/';
    }

    async function onConfirm() {
        if (busy || !currentMode) return;
        var mode = currentMode;

        if (mode !== MODE.RESET_SETTINGS) {
            var okAuth = await requireSignedIn();
            if (!okAuth) {
                closeModal();
                return;
            }
        }

        setBusy(true);
        setStatus(mode === MODE.EXPORT ? 'Preparing download…' : 'Working…');

        try {
            if (mode === MODE.EXPORT) await runExport();
            else if (mode === MODE.RESET_SETTINGS) await runResetSettings();
            else if (mode === MODE.LOGOUT_ALL) await runLogoutAll();
            else if (mode === MODE.RESET_ACCOUNT) await runResetAccount();
            else if (mode === MODE.DELETE_ACCOUNT) await runDeleteAccount();

            setBusy(false);
            setOpen(false);
        } catch (err) {
            console.error('[usertypo system confirm]', err);
            var mapped = window.usertypoAccount && window.usertypoAccount.mapRpcError
                ? window.usertypoAccount.mapRpcError(err)
                : { message: (err && err.message) || 'Something went wrong.' };
            setBusy(false);
            setStatus(mapped.message || 'Something went wrong.', true);
        }
    }

    function boot() {
        var modal = $('system-confirm-modal');
        if (!modal) return;
        var cancel = $('system-confirm-cancel');
        var ok = $('system-confirm-ok');
        var box = $('system-confirm-box');
        if (cancel) cancel.addEventListener('click', closeModal);
        if (ok) ok.addEventListener('click', onConfirm);
        document.addEventListener('click', function (event) {
            if (!currentMode || busy) return;
            if (!modal || modal.classList.contains('pointer-events-none')) return;
            if (box && box.contains(event.target)) return;
            if (modal.contains(event.target) || event.target === modal) {
                closeModal();
            }
        }, true);
        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && currentMode) closeModal();
        });
    }

    window.openExportDataModal = function () {
        openModal(MODE.EXPORT);
    };

    window.confirmSystemDanger = function (kind) {
        if (kind === 'reset-settings') openModal(MODE.RESET_SETTINGS);
        else if (kind === 'logout-all') openModal(MODE.LOGOUT_ALL);
        else if (kind === 'reset-account') openModal(MODE.RESET_ACCOUNT);
        else if (kind === 'delete-account') openModal(MODE.DELETE_ACCOUNT);
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
