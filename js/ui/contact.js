/**
 * Contact modal — glass panel matching the header menu bubble.
 * Public via window.usertypoContact / openContactModal / closeContactModal.
 */
(function () {
    var CONTACT_TO = 'contactusertypo@gmail.com';
    var busy = false;
    var wired = false;

    function $(id) {
        return document.getElementById(id);
    }

    function toast(message, icon) {
        if (window.usertypoNotifications && typeof window.usertypoNotifications.showToast === 'function') {
            window.usertypoNotifications.showToast(message, icon || 'mail');
            return;
        }
        try { window.alert(message); } catch (e) { /* ignore */ }
    }

    function isOpen() {
        var modal = $('contact-modal');
        return !!(modal && !modal.classList.contains('opacity-0') && !modal.classList.contains('pointer-events-none'));
    }

    function setStatus(text, isError) {
        var el = $('contact-status');
        if (!el) return;
        if (!text) {
            el.textContent = '';
            el.classList.add('hidden');
            el.classList.remove('text-error', 'text-slate-500', 'text-primary');
            return;
        }
        el.textContent = text;
        el.classList.remove('hidden', 'text-error', 'text-slate-500', 'text-primary');
        el.classList.add(isError ? 'text-error' : 'text-slate-500');
    }

    function setBusy(isBusy) {
        busy = !!isBusy;
        var btn = $('contact-send-btn');
        var label = $('contact-send-label');
        var form = $('contact-form');
        if (btn) {
            btn.disabled = busy;
            btn.classList.toggle('opacity-60', busy);
            btn.classList.toggle('cursor-not-allowed', busy);
        }
        if (label) label.textContent = busy ? 'Sending…' : 'Send';
        if (form) {
            form.querySelectorAll('input, textarea, button').forEach(function (el) {
                if (el.id === 'contact-send-btn' || el.id === 'contact-close-btn') return;
                if (el === btn) return;
                if (el.type === 'submit') return;
                if (el.id === 'contact-problem-btn') el.disabled = busy;
                else if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') el.readOnly = busy;
            });
        }
    }

    function closeProblemMenu() {
        var btn = $('contact-problem-btn');
        var menu = $('contact-problem-menu');
        if (btn) btn.setAttribute('aria-expanded', 'false');
        if (menu) menu.classList.add('hidden');
    }

    function openProblemMenu() {
        var btn = $('contact-problem-btn');
        var menu = $('contact-problem-menu');
        if (btn) btn.setAttribute('aria-expanded', 'true');
        if (menu) menu.classList.remove('hidden');
    }

    function toggleProblemMenu() {
        var btn = $('contact-problem-btn');
        if (!btn || busy) return;
        if (btn.getAttribute('aria-expanded') === 'true') closeProblemMenu();
        else openProblemMenu();
    }

    function selectProblem(value, label) {
        var hidden = $('contact-problem');
        var labelEl = $('contact-problem-label');
        var menu = $('contact-problem-menu');
        if (hidden) hidden.value = value || '';
        if (labelEl) {
            labelEl.textContent = label || value || 'Select a topic…';
            labelEl.classList.toggle('text-slate-400', !value);
            labelEl.classList.toggle('text-white', !!value);
        }
        if (menu) {
            menu.querySelectorAll('.contact-problem-option').forEach(function (opt) {
                var selected = opt.getAttribute('data-value') === value;
                opt.setAttribute('aria-selected', selected ? 'true' : 'false');
            });
        }
        closeProblemMenu();
    }

    function resizeDescription() {
        var ta = $('contact-description');
        if (!ta) return;
        var styles = window.getComputedStyle(ta);
        var lineHeight = parseFloat(styles.lineHeight);
        if (!lineHeight || Number.isNaN(lineHeight)) {
            var fontSize = parseFloat(styles.fontSize) || 14;
            lineHeight = fontSize * 1.45;
        }
        var padY = (parseFloat(styles.paddingTop) || 0) + (parseFloat(styles.paddingBottom) || 0);
        var minH = lineHeight * 2 + padY;
        var maxH = lineHeight * 5 + padY;
        ta.style.height = 'auto';
        var next = Math.min(Math.max(ta.scrollHeight, minH), maxH);
        ta.style.height = next + 'px';
        ta.style.overflowY = ta.scrollHeight > maxH + 1 ? 'auto' : 'hidden';
    }

    function resetForm() {
        var form = $('contact-form');
        if (form) form.reset();
        selectProblem('', 'Select a topic…');
        setStatus('');
        setBusy(false);
        resizeDescription();
    }

    function setOpen(open) {
        var modal = $('contact-modal');
        var box = $('contact-box');
        if (!modal || !box) return;

        if (open) {
            modal.classList.remove('pointer-events-none', 'opacity-0');
            modal.classList.add('pointer-events-auto', 'opacity-100');
            box.classList.remove('scale-95', 'opacity-0');
            box.classList.add('scale-100', 'opacity-100');
            modal.setAttribute('aria-hidden', 'false');
            document.body.dataset.contactOpen = '1';
            // Clear a stuck inert from older builds (inert on #app-body locks the modal too).
            document.body.removeAttribute('inert');
            closeProblemMenu();
            window.setTimeout(function () {
                var name = $('contact-name');
                if (name) name.focus();
                resizeDescription();
            }, 40);
        } else {
            closeProblemMenu();
            modal.classList.add('pointer-events-none', 'opacity-0');
            modal.classList.remove('pointer-events-auto', 'opacity-100');
            box.classList.add('scale-95', 'opacity-0');
            box.classList.remove('scale-100', 'opacity-100');
            modal.setAttribute('aria-hidden', 'true');
            delete document.body.dataset.contactOpen;
            document.body.removeAttribute('inert');
            setBusy(false);
            setStatus('');
        }
    }

    function openModal() {
        if (!$('contact-modal')) return;
        if (!isOpen()) resetForm();
        setOpen(true);
    }

    function closeModal() {
        if (busy) return;
        setOpen(false);
    }

    function validate(payload) {
        if (!payload.name) return 'Please enter your name.';
        if (!payload.email || payload.email.indexOf('@') < 1) return 'Please enter a valid email.';
        if (!payload.problem) return 'Please select a problem type.';
        if (!payload.description) return 'Please add a description.';
        return '';
    }

    function collectPayload() {
        return {
            name: String(($('contact-name') && $('contact-name').value) || '').trim(),
            email: String(($('contact-email') && $('contact-email').value) || '').trim(),
            problem: String(($('contact-problem') && $('contact-problem').value) || '').trim(),
            description: String(($('contact-description') && $('contact-description').value) || '').trim(),
        };
    }

    function contactApiUrl() {
        var cfg = window.USERTYPO_CONFIG || {};
        var base = (cfg.backend && cfg.backend.url)
            || (cfg.multiplayer && cfg.multiplayer.url)
            || '';
        base = String(base || '').replace(/\/+$/, '');
        return (base || '') + '/api/contact';
    }

    async function sendContact(payload) {
        var response = await fetch(contactApiUrl(), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
            },
            body: JSON.stringify(payload),
        });

        var data = null;
        try {
            data = await response.json();
        } catch (e) {
            data = null;
        }

        if (!response.ok) {
            var message = (data && data.error) || 'Could not send your message. Please try again.';
            throw new Error(message);
        }
        return data;
    }

    async function onSubmit(event) {
        if (event) event.preventDefault();
        if (busy || !isOpen()) return;

        closeProblemMenu();
        var payload = collectPayload();
        var error = validate(payload);
        if (error) {
            setStatus(error, true);
            return;
        }

        setBusy(true);
        setStatus('Sending…');

        try {
            await sendContact(payload);
            toast('Message sent. Thanks for reaching out!', 'check_circle');
            setOpen(false);
            resetForm();
        } catch (err) {
            setStatus((err && err.message) || 'Could not send your message.', true);
            setBusy(false);
        }
    }

    function onDocumentKeydown(event) {
        if (!isOpen()) return;

        if (event.key === 'Escape') {
            if ($('contact-problem-btn') && $('contact-problem-btn').getAttribute('aria-expanded') === 'true') {
                event.preventDefault();
                closeProblemMenu();
                return;
            }
            event.preventDefault();
            closeModal();
            return;
        }

        if (event.key !== 'Enter') return;
        if (event.isComposing) return;

        var target = event.target;
        if (target && !target.closest('#contact-modal')) return;

        // Description: Shift+Enter inserts a newline; Enter sends (dual-box pattern).
        if (target && target.id === 'contact-description' && event.shiftKey) return;

        if (target && target.closest && target.closest('#contact-problem-menu')) {
            return;
        }
        if (target && target.id === 'contact-problem-btn') return;

        event.preventDefault();
        onSubmit();
    }

    function wire() {
        if (wired) return;
        var modal = $('contact-modal');
        var form = $('contact-form');
        if (!modal || !form) return;
        wired = true;

        // Event delegation so Contact works in shell + page footers (home/signin SPA swaps).
        document.addEventListener('click', function (e) {
            var btn = e.target && e.target.closest ? e.target.closest('[data-open-contact]') : null;
            if (!btn) return;
            e.preventDefault();
            openModal();
        });

        var closeBtn = $('contact-close-btn');
        var backdrop = $('contact-backdrop');
        var problemBtn = $('contact-problem-btn');
        var problemMenu = $('contact-problem-menu');
        var description = $('contact-description');

        if (closeBtn) closeBtn.addEventListener('click', function (e) {
            e.preventDefault();
            closeModal();
        });
        if (backdrop) backdrop.addEventListener('click', function () {
            closeModal();
        });

        form.addEventListener('submit', onSubmit);

        if (problemBtn) {
            problemBtn.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                toggleProblemMenu();
            });
        }

        if (problemMenu) {
            problemMenu.addEventListener('click', function (e) {
                var opt = e.target && e.target.closest ? e.target.closest('.contact-problem-option') : null;
                if (!opt) return;
                e.preventDefault();
                selectProblem(opt.getAttribute('data-value') || '', opt.textContent.trim());
            });
        }

        if (description) {
            description.addEventListener('input', resizeDescription);
        }

        document.addEventListener('click', function (e) {
            if (!isOpen()) return;
            var picker = $('contact-problem-picker');
            if (!picker) return;
            if (e.target && picker.contains(e.target)) return;
            closeProblemMenu();
        });

        document.addEventListener('keydown', onDocumentKeydown, true);

        resizeDescription();
    }

    function init() {
        wire();
    }

    window.usertypoContact = {
        open: openModal,
        close: closeModal,
        isOpen: isOpen,
        to: CONTACT_TO,
    };
    window.openContactModal = openModal;
    window.closeContactModal = closeModal;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
