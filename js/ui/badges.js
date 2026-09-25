/**
 * Profile badges — art, rows, show-all box, and badge lookups.
 * Public API: window.usertypoBadges
 */
(function () {
    var CACHE_TTL_MS = 120000;
    var cache = Object.create(null);
    var uidCounter = 0;

    var ORDER = ['discord_mod', 'contributor', 'first_100', 'first_1k'];

    var DEFS = {
        discord_mod: {
            name: 'Discord Mod',
            description: 'Keeps the usertypo_ Discord community running smoothly.',
        },
        contributor: {
            name: 'Contributor',
            description: 'Helped build usertypo_.',
        },
        first_100: {
            name: 'First 100',
            description: 'One of the first 100 people to join usertypo_.',
        },
        first_1k: {
            name: 'First 1K',
            description: 'One of the first 1,000 people to join usertypo_.',
        },
    };

    var DISCORD_PATH =
        'M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,' +
        '72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,' +
        '105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,' +
        '2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,' +
        '6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,' +
        '65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,' +
        '73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,46,96.12,53,91.08,65.69,84.69,65.69Z';

    var STAR_PATH = 'M0,-3.2 C0.35,-0.9 0.9,-0.35 3.2,0 C0.9,0.35 0.35,0.9 0,3.2 C-0.35,0.9 -0.9,0.35 -3.2,0 C-0.9,-0.35 -0.35,-0.9 0,-3.2Z';

    // Pixel-grid redraw of the usertypo_ favicon mark (USER / o / caret), 32×32 space.
    var GLYPHS = {
        U: ['#..#', '#..#', '#..#', '#..#', '.##.'],
        S: ['.###', '#...', '.##.', '...#', '###.'],
        E: ['####', '#...', '###.', '#...', '####'],
        R: ['###.', '#..#', '###.', '#.#.', '#..#'],
    };
    var O_GLYPH = [
        '..####..',
        '.######.',
        '##....##',
        '##....##',
        '##....##',
        '##....##',
        '##....##',
        '.######.',
        '..####..',
    ];

    function pixelPath(rows, originX, originY, pixel) {
        var d = '';
        for (var r = 0; r < rows.length; r++) {
            var row = rows[r];
            var c = 0;
            while (c < row.length) {
                if (row.charAt(c) !== '#') { c++; continue; }
                var start = c;
                while (c < row.length && row.charAt(c) === '#') c++;
                var x = +(originX + start * pixel).toFixed(2);
                var y = +(originY + r * pixel).toFixed(2);
                var w = +((c - start) * pixel).toFixed(2);
                d += 'M' + x + ' ' + y + 'h' + w + 'v' + pixel + 'h' + (-w) + 'z';
            }
        }
        return d;
    }

    var MARK_USER_PATH = (function () {
        var pixel = 0.8;
        var x = 8.4;
        var d = '';
        ['U', 'S', 'E', 'R'].forEach(function (ch) {
            d += pixelPath(GLYPHS[ch], x, 8.2, pixel);
            x += 5 * pixel;
        });
        return d;
    })();
    var MARK_O_PATH = pixelPath(O_GLYPH, 8.2, 13, 0.9);

    function escapeHtml(value) {
        if (window.usertypoEscape && typeof window.usertypoEscape.html === 'function') {
            return window.usertypoEscape.html(value);
        }
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function nextUid() {
        uidCounter += 1;
        return 'utb' + uidCounter;
    }

    function normalize(list) {
        var seen = Object.create(null);
        var out = [];
        (Array.isArray(list) ? list : []).forEach(function (id) {
            var key = String(id || '').trim();
            if (!DEFS[key] || seen[key]) return;
            seen[key] = true;
            out.push(key);
        });
        out.sort(function (a, b) { return ORDER.indexOf(a) - ORDER.indexOf(b); });
        return out;
    }

    function sheen(uid, clipShape) {
        return '<clipPath id="' + uid + '-clip">' + clipShape + '</clipPath>' +
            '<g clip-path="url(#' + uid + '-clip)"><g transform="rotate(22 16 16)">' +
                '<rect class="ut-badge__sheen" x="-14" y="-10" width="9" height="52" fill="url(#' + uid + '-sheen)"></rect>' +
            '</g></g>';
    }

    function sheenGradient(uid) {
        return '<linearGradient id="' + uid + '-sheen" x1="0" y1="0" x2="1" y2="0">' +
            '<stop offset="0" stop-color="#fff" stop-opacity="0"></stop>' +
            '<stop offset="0.5" stop-color="#fff" stop-opacity="0.75"></stop>' +
            '<stop offset="1" stop-color="#fff" stop-opacity="0"></stop>' +
        '</linearGradient>';
    }

    function star(x, y, scale, extraClass) {
        return '<g transform="translate(' + x + ' ' + y + ') scale(' + scale + ')">' +
            '<path class="ut-badge__spark' + (extraClass ? ' ' + extraClass : '') + '" d="' + STAR_PATH + '" fill="#fff"></path>' +
        '</g>';
    }

    function artGoldHex(uid, label) {
        var outer = 'M16 1.5L28.6 8.75V23.25L16 30.5L3.4 23.25V8.75Z';
        var inner = 'M16 4.3L26.2 10.15V21.85L16 27.7L5.8 21.85V10.15Z';
        return '<defs>' +
                '<linearGradient id="' + uid + '-rim" x1="0" y1="0" x2="0" y2="1">' +
                    '<stop offset="0" stop-color="#FFF6C9"></stop>' +
                    '<stop offset="0.5" stop-color="#F2A516"></stop>' +
                    '<stop offset="1" stop-color="#9A5200"></stop>' +
                '</linearGradient>' +
                '<linearGradient id="' + uid + '-fill" x1="0" y1="0" x2="0.4" y2="1">' +
                    '<stop offset="0" stop-color="#FFF1A8"></stop>' +
                    '<stop offset="0.45" stop-color="#FFD24A"></stop>' +
                    '<stop offset="1" stop-color="#FF9F1C"></stop>' +
                '</linearGradient>' +
                sheenGradient(uid) +
            '</defs>' +
            '<path d="' + outer + '" fill="url(#' + uid + '-rim)"></path>' +
            '<path d="' + inner + '" fill="url(#' + uid + '-fill)"></path>' +
            '<path d="M16 4.3L26.2 10.15V15.2H5.8V10.15Z" fill="#fff" opacity="0.22"></path>' +
            '<text x="16" y="19.3" text-anchor="middle" class="ut-badge__num" font-size="9.2" fill="#7A3A00">' + label + '</text>' +
            sheen(uid, '<path d="' + inner + '"></path>') +
            star(26.6, 5.4, 1, 'ut-badge__spark--a') +
            star(5.2, 25.6, 0.6, 'ut-badge__spark--b');
    }

    function artAmethystDiamond(uid, label, fontSize) {
        var outer = 'M16 1.2L30.8 16L16 30.8L1.2 16Z';
        var inner = 'M16 4.4L27.6 16L16 27.6L4.4 16Z';
        return '<defs>' +
                '<linearGradient id="' + uid + '-rim" x1="0" y1="0" x2="1" y2="1">' +
                    '<stop offset="0" stop-color="#F5D0FE"></stop>' +
                    '<stop offset="0.55" stop-color="#9333EA"></stop>' +
                    '<stop offset="1" stop-color="#581C87"></stop>' +
                '</linearGradient>' +
                '<linearGradient id="' + uid + '-fill" x1="0" y1="0" x2="1" y2="1">' +
                    '<stop offset="0" stop-color="#D8B4FE"></stop>' +
                    '<stop offset="0.5" stop-color="#A855F7"></stop>' +
                    '<stop offset="1" stop-color="#EC4899"></stop>' +
                '</linearGradient>' +
                sheenGradient(uid) +
            '</defs>' +
            '<path d="' + outer + '" fill="url(#' + uid + '-rim)"></path>' +
            '<path d="' + inner + '" fill="url(#' + uid + '-fill)"></path>' +
            '<path d="M16 4.4L27.6 16H16Z" fill="#fff" opacity="0.2"></path>' +
            '<path d="M16 27.6L4.4 16H16Z" fill="#3B0764" opacity="0.18"></path>' +
            '<text x="16" y="19.1" text-anchor="middle" class="ut-badge__num" font-size="' + fontSize + '" fill="#fff" stroke="#4C1D95" stroke-width="1.1" paint-order="stroke">' + label + '</text>' +
            sheen(uid, '<path d="' + inner + '"></path>') +
            star(24.6, 6.6, 0.75, 'ut-badge__spark--a');
    }

    function artDiscord(uid) {
        var shield = 'M16 1.6L28.2 5.9V15.3C28.2 22.7 23 28.1 16 30.5C9 28.1 3.8 22.7 3.8 15.3V5.9Z';
        var inner = 'M16 4.2L25.8 7.7V15.3C25.8 21.3 21.7 25.8 16 27.9C10.3 25.8 6.2 21.3 6.2 15.3V7.7Z';
        return '<defs>' +
                '<linearGradient id="' + uid + '-rim" x1="0" y1="0" x2="0" y2="1">' +
                    '<stop offset="0" stop-color="#C7CCFF"></stop>' +
                    '<stop offset="1" stop-color="#3C45A5"></stop>' +
                '</linearGradient>' +
                '<linearGradient id="' + uid + '-fill" x1="0" y1="0" x2="0" y2="1">' +
                    '<stop offset="0" stop-color="#7983F5"></stop>' +
                    '<stop offset="0.55" stop-color="#5865F2"></stop>' +
                    '<stop offset="1" stop-color="#4752C4"></stop>' +
                '</linearGradient>' +
                sheenGradient(uid) +
            '</defs>' +
            '<path d="' + shield + '" fill="url(#' + uid + '-rim)"></path>' +
            '<path d="' + inner + '" fill="url(#' + uid + '-fill)"></path>' +
            '<path d="M16 4.2L25.8 7.7V13H6.2V7.7Z" fill="#fff" opacity="0.14"></path>' +
            '<g transform="translate(8.3 10.2) scale(0.1211)"><path d="' + DISCORD_PATH + '" fill="#fff"></path></g>' +
            sheen(uid, '<path d="' + inner + '"></path>');
    }

    function artContributor(uid) {
        return '<defs>' + sheenGradient(uid) + '</defs>' +
            '<rect class="ut-badge__tile" x="2" y="2" width="28" height="28" rx="8"></rect>' +
            '<rect class="ut-badge__tile-shine" x="3.2" y="3.2" width="25.6" height="11" rx="7"></rect>' +
            '<path class="ut-badge__mark-fg" d="' + MARK_USER_PATH + '"></path>' +
            '<path class="ut-badge__mark-o" d="' + MARK_O_PATH + '"></path>' +
            '<rect class="ut-badge__mark-fg ut-badge__caret" x="16.3" y="22.1" width="7.6" height="1.6" rx="0.3"></rect>' +
            sheen(uid, '<rect x="2" y="2" width="28" height="28" rx="8"></rect>');
    }

    function art(id) {
        var uid = nextUid();
        if (id === 'first_100') return artAmethystDiamond(uid, '100', 8.2);
        if (id === 'first_1k') return artGoldHex(uid, '1K');
        if (id === 'discord_mod') return artDiscord(uid);
        if (id === 'contributor') return artContributor(uid);
        return '';
    }

    /**
     * One badge.
     * @param {string} id
     * @param {object} [options]
     * @param {string} [options.size] xs|sm|md|lg
     * @param {boolean} [options.tip] delayed hover tip (default true)
     */
    function renderOne(id, options) {
        var def = DEFS[id];
        if (!def) return '';
        var opts = options || {};
        var size = opts.size || 'md';
        var tip = opts.tip !== false;
        var label = def.name + ' — ' + def.description;
        return '<span class="ut-badge ut-badge--' + id + ' ut-badge--' + size + '"' +
            ' role="img" aria-label="' + escapeHtml(label) + '"' +
            (tip ? ' data-tip="' + escapeHtml(def.name) + '"' : '') + '>' +
            '<svg class="ut-badge__svg" viewBox="0 0 32 32" aria-hidden="true" focusable="false">' +
                art(id) +
            '</svg>' +
        '</span>';
    }

    /** Inline list of badges; `options.max` caps how many are shown. */
    function render(badges, options) {
        var list = normalize(badges);
        var max = options && Number(options.max);
        if (max > 0) list = list.slice(0, max);
        return list.map(function (id) {
            return renderOne(id, options);
        }).join('');
    }

    /**
     * Row above an avatar: first `max` badges plus a Show all button when there are more.
     * @param {string[]} badges
     * @param {object} [options]
     * @param {number} [options.max] default 3
     * @param {string} [options.size] default md
     * @param {string} [options.username]
     */
    function renderRow(badges, options) {
        var list = normalize(badges);
        if (!list.length) return '';
        var opts = options || {};
        var max = Math.max(1, Number(opts.max) || 3);
        var size = opts.size || 'md';
        var shown = list.slice(0, max);
        var hidden = list.length - shown.length;
        var html = shown.map(function (id) { return renderOne(id, { size: size }); }).join('');
        if (hidden > 0) {
            html += '<button type="button" class="ut-badge-more"' +
                ' data-badges="' + escapeHtml(list.join(',')) + '"' +
                ' data-username="' + escapeHtml(opts.username || '') + '"' +
                ' aria-label="Show all ' + list.length + ' badges">' +
                    '<span class="ut-badge-more__count">+' + hidden + '</span>' +
                    '<span class="ut-badge-more__label">Show all</span>' +
                '</button>';
        }
        return '<div class="ut-badge-row" role="list" aria-label="Badges">' + html + '</div>';
    }

    /** Fill (or clear + hide) a host element with a badge row. */
    function mountRow(el, badges, options) {
        if (!el) return;
        var html = renderRow(badges, options);
        el.innerHTML = html;
        el.hidden = !html;
    }

    function readCache(userId) {
        var hit = cache[userId];
        if (!hit) return null;
        if ((Date.now() - hit.at) > CACHE_TTL_MS) {
            delete cache[userId];
            return null;
        }
        return hit.badges;
    }

    /**
     * Badges for many users in one RPC.
     * @param {string[]} userIds
     * @param {object} [options] { force: boolean }
     * @returns {Promise<Object<string, string[]>>} user_id → badge ids (users without badges omitted)
     */
    async function fetchFor(userIds, options) {
        var force = !!(options && options.force);
        var out = Object.create(null);
        var missing = [];
        var seen = Object.create(null);
        (userIds || []).forEach(function (raw) {
            var id = String(raw || '').trim();
            if (!id || seen[id] || id.indexOf('guest_') === 0) return;
            seen[id] = true;
            var cached = force ? null : readCache(id);
            if (cached) {
                if (cached.length) out[id] = cached;
                return;
            }
            missing.push(id);
        });
        if (!missing.length || !window.usertypoDb) return out;
        try {
            var client = await window.usertypoDb.getClient();
            var result = await client.rpc('get_profile_badges', { p_ids: missing });
            if (result.error || !Array.isArray(result.data)) return out;
            var byId = Object.create(null);
            result.data.forEach(function (row) {
                if (row && row.user_id) byId[row.user_id] = normalize(row.badges);
            });
            var now = Date.now();
            missing.forEach(function (id) {
                var list = byId[id] || [];
                cache[id] = { at: now, badges: list };
                if (list.length) out[id] = list;
            });
        } catch (e) { /* badges are optional */ }
        return out;
    }

    async function fetchOne(userId, options) {
        var map = await fetchFor([userId], options);
        return map[String(userId || '').trim()] || [];
    }

    function invalidate(userId) {
        if (userId) delete cache[String(userId)];
    }

    // ── Show-all box ─────────────────────────────────────────────────────
    function $(id) {
        return document.getElementById(id);
    }

    function isAllOpen() {
        var overlay = $('badges-overlay');
        return !!(overlay && !overlay.classList.contains('pointer-events-none'));
    }

    function setAllOpen(isOpen) {
        var overlay = $('badges-overlay');
        var box = $('badges-box');
        if (!overlay || !box) return;
        overlay.classList.toggle('pointer-events-none', !isOpen);
        overlay.classList.toggle('opacity-0', !isOpen);
        overlay.classList.toggle('pointer-events-auto', isOpen);
        overlay.classList.toggle('opacity-100', isOpen);
        box.classList.toggle('scale-95', !isOpen);
        box.classList.toggle('scale-100', isOpen);
        overlay.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
    }

    function openAll(badges, username) {
        var list = normalize(badges);
        var listEl = $('badges-list');
        var titleEl = $('badges-title');
        if (!listEl || !list.length) return;
        if (titleEl) {
            titleEl.textContent = username ? (username + '\u2019s badges') : 'Badges';
        }
        listEl.innerHTML = list.map(function (id) {
            var def = DEFS[id];
            return '<li class="ut-badge-item">' +
                renderOne(id, { size: 'lg', tip: false }) +
                '<div class="ut-badge-item__text">' +
                    '<p class="ut-badge-item__name ut-badge-item__name--' + id + '">' + escapeHtml(def.name) + '</p>' +
                    '<p class="ut-badge-item__desc">' + escapeHtml(def.description) + '</p>' +
                '</div>' +
            '</li>';
        }).join('');
        setAllOpen(true);
        var closeBtn = $('badges-close-btn');
        if (closeBtn) {
            try { closeBtn.focus({ preventScroll: true }); } catch (_) { /* ignore */ }
        }
    }

    function closeAll() {
        setAllOpen(false);
    }

    function onDocumentClick(event) {
        var target = event.target;
        if (!target || !target.closest) return;
        var more = target.closest('.ut-badge-more');
        if (more) {
            event.preventDefault();
            event.stopPropagation();
            var ids = String(more.getAttribute('data-badges') || '').split(',');
            openAll(ids, more.getAttribute('data-username') || '');
            return;
        }
        if (!isAllOpen()) return;
        if (target.closest('#badges-close-btn')) {
            closeAll();
            return;
        }
        var box = $('badges-box');
        if (box && box.contains(target)) return;
        var overlay = $('badges-overlay');
        if (overlay && overlay.contains(target)) {
            event.stopPropagation();
            closeAll();
        }
    }

    function onKeyDown(event) {
        if (event.key !== 'Escape' || !isAllOpen()) return;
        // Capture phase: close only this box, not the profile box underneath.
        event.stopPropagation();
        closeAll();
    }

    // ── Hover tip (fixed to <body> so tables / scroll boxes never clip it) ──
    var TIP_DELAY_MS = 500;
    var tipEl = null;
    var tipTimer = null;
    var tipTarget = null;

    function ensureTip() {
        if (tipEl && tipEl.parentNode) return tipEl;
        tipEl = document.createElement('div');
        tipEl.className = 'ut-badge-tip';
        tipEl.setAttribute('role', 'tooltip');
        document.body.appendChild(tipEl);
        return tipEl;
    }

    function hideTip() {
        if (tipTimer) {
            clearTimeout(tipTimer);
            tipTimer = null;
        }
        tipTarget = null;
        if (tipEl) tipEl.classList.remove('is-visible');
    }

    function showTip(badge) {
        if (!badge || !document.contains(badge)) return;
        var tip = ensureTip();
        tip.textContent = badge.getAttribute('data-tip') || '';
        tip.classList.remove('is-visible');
        var rect = badge.getBoundingClientRect();
        var tipRect = tip.getBoundingClientRect();
        var margin = 8;
        var left = rect.left + rect.width / 2 - tipRect.width / 2;
        left = Math.max(margin, Math.min(left, window.innerWidth - tipRect.width - margin));
        var top = rect.top - tipRect.height - margin;
        if (top < margin) top = rect.bottom + margin;
        tip.style.left = Math.round(left) + 'px';
        tip.style.top = Math.round(top) + 'px';
        tip.classList.add('is-visible');
    }

    function onMouseOver(event) {
        var target = event.target;
        var badge = target && target.closest ? target.closest('.ut-badge[data-tip]') : null;
        if (badge === tipTarget) return;
        hideTip();
        if (!badge) return;
        tipTarget = badge;
        tipTimer = setTimeout(function () {
            tipTimer = null;
            if (tipTarget === badge) showTip(badge);
        }, TIP_DELAY_MS);
    }

    function onMouseOut(event) {
        if (!tipTarget) return;
        var next = event.relatedTarget;
        if (next && tipTarget.contains(next)) return;
        hideTip();
    }

    function boot() {
        document.addEventListener('click', onDocumentClick, true);
        document.addEventListener('keydown', onKeyDown, true);
        document.addEventListener('mouseover', onMouseOver);
        document.addEventListener('mouseout', onMouseOut);
        document.addEventListener('pointerdown', hideTip, true);
        window.addEventListener('scroll', hideTip, true);
        window.addEventListener('blur', hideTip);
    }

    window.usertypoBadges = {
        ORDER: ORDER.slice(),
        DEFS: DEFS,
        normalize: normalize,
        renderOne: renderOne,
        render: render,
        renderRow: renderRow,
        mountRow: mountRow,
        fetchFor: fetchFor,
        fetchOne: fetchOne,
        invalidate: invalidate,
        openAll: openAll,
        closeAll: closeAll,
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
