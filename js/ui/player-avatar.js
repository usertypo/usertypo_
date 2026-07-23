/**
 * Shared player avatar — photo + XP ring + level badge (matches header account bubble).
 * Public API: window.usertypoPlayerAvatar
 */
(function () {
    var CIRCUMFERENCE = 2 * Math.PI * 18; // r=18 in 40×40 viewBox

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function escapeAttr(value) {
        return escapeHtml(value).replace(/`/g, '&#96;');
    }

    function initialFor(name) {
        var clean = String(name || '?').trim();
        return (clean.charAt(0) || '?').toUpperCase();
    }

    function clampPercent(value) {
        var n = Number(value);
        if (!isFinite(n)) return 0;
        return Math.min(100, Math.max(0, n));
    }

    function normalizeLevel(value) {
        var n = Math.floor(Number(value));
        if (!isFinite(n) || n < 1) return 1;
        return n;
    }

    function ringOffset(percent) {
        return CIRCUMFERENCE * (1 - clampPercent(percent) / 100);
    }

    function pickProgress(source) {
        if (!source || typeof source !== 'object') {
            return { level: 1, percentToNext: 0 };
        }
        var level = source.level != null ? source.level : source.Level;
        var pct = source.percentToNext != null
            ? source.percentToNext
            : (source.percent_to_next != null ? source.percent_to_next : null);
        if (pct == null && window.usertypoProgression && typeof window.usertypoProgression.percentToNext === 'function') {
            var into = source.xpIntoLevel != null ? source.xpIntoLevel : source.xp_into_level;
            var need = source.xpToNext != null ? source.xpToNext : source.xp_to_next;
            if (into != null && need != null) {
                pct = window.usertypoProgression.percentToNext(into, need);
            }
        }
        return {
            level: normalizeLevel(level),
            percentToNext: clampPercent(pct),
        };
    }

    /**
     * @param {object} options
     * @param {string} [options.avatarUrl]
     * @param {string} [options.name]
     * @param {number} [options.level]
     * @param {number} [options.percentToNext]
     * @param {string} [options.size] xs|sm|md|lg|xl|host
     * @param {string} [options.className]
     * @param {boolean} [options.showLevel] default true (false for guests/bots without levels)
     * @param {boolean} [options.isBot]
     * @param {string} [options.initial]
     * @param {string} [options.title]
     * @param {string} [options.id] optional root id
     */
    function render(options) {
        var opts = options || {};
        var size = opts.size || 'md';
        var progress = pickProgress(opts);
        var showLevel = opts.showLevel !== false && !opts.isBot;
        var name = opts.name || (opts.isBot ? 'Bot' : 'Player');
        var initial = opts.initial || initialFor(name);
        var avatarUrl = opts.avatarUrl || '';
        var userId = opts.userId || opts.user_id || '';
        if (opts.isBot || (userId && String(userId).indexOf('guest_') === 0)) userId = '';
        var clickable = !!userId && opts.clickable !== false;
        var extraClass = opts.className ? (' ' + String(opts.className)) : '';
        if (clickable) extraClass += ' player-level-avatar--clickable';
        var title = opts.title != null ? opts.title : name;
        var idAttr = opts.id ? ' id="' + escapeAttr(opts.id) + '"' : '';
        var userAttr = userId ? ' data-user-id="' + escapeAttr(userId) + '"' : '';
        var offset = ringOffset(showLevel ? progress.percentToNext : 0);
        var ringOpacity = showLevel ? '' : ' opacity-0';

        var photoInner;
        if (opts.isBot) {
            photoInner = '<span class="material-symbols-outlined player-level-avatar__bot" aria-hidden="true">smart_toy</span>';
        } else if (avatarUrl) {
            photoInner = '<img class="player-level-avatar__img" src="' + escapeAttr(avatarUrl) +
                '" alt="' + escapeAttr(name) + '" loading="lazy" decoding="async" />';
        } else {
            photoInner = '<span class="player-level-avatar__initial">' + escapeHtml(initial) + '</span>';
        }

        return '<span' + idAttr + userAttr +
            ' class="player-level-avatar player-level-avatar--' + escapeAttr(size) + extraClass + '"' +
            ' title="' + escapeAttr(title) + '"' +
            ' data-level="' + progress.level + '"' +
            ' data-xp-percent="' + progress.percentToNext + '"' +
            (clickable ? ' role="button" tabindex="0"' : ' role="img"') +
            ' aria-label="' + escapeAttr(name + (showLevel ? (', level ' + progress.level) : '') + (clickable ? ' — view profile' : '')) + '">' +
            '<svg class="player-level-avatar__ring" viewBox="0 0 40 40" aria-hidden="true">' +
                '<circle class="player-level-avatar__track' + ringOpacity + '" cx="20" cy="20" r="18" fill="none"></circle>' +
                '<circle class="player-level-avatar__progress' + ringOpacity + '" cx="20" cy="20" r="18" fill="none"' +
                    ' stroke-linecap="round"' +
                    ' style="stroke-dasharray:' + CIRCUMFERENCE + ';stroke-dashoffset:' + offset + ';"></circle>' +
            '</svg>' +
            '<span class="player-level-avatar__photo">' + photoInner + '</span>' +
            (showLevel
                ? '<span class="player-level-avatar__level">' + escapeHtml(String(progress.level)) + '</span>'
                : '') +
            '</span>';
    }

    function fromPlayer(player, options) {
        var source = player || {};
        var progress = pickProgress(source);
        return render(Object.assign({
            avatarUrl: source.avatarUrl || source.avatar_url || '',
            name: source.name || source.username || source.display_name || 'Player',
            level: progress.level,
            percentToNext: progress.percentToNext,
            isBot: !!(source.isBot || source.is_bot),
            userId: source.userId || source.user_id || '',
        }, options || {}));
    }

    function mount(el, options) {
        if (!el) return null;
        el.innerHTML = render(options);
        return el.firstElementChild;
    }

    window.usertypoPlayerAvatar = {
        CIRCUMFERENCE: CIRCUMFERENCE,
        ringOffset: ringOffset,
        pickProgress: pickProgress,
        render: render,
        fromPlayer: fromPlayer,
        mount: mount,
        initialFor: initialFor,
    };
})();
