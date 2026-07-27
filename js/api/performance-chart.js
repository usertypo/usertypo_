/**
 * Performance Over Time — Monkeytype-style account history chart.
 * Public API: window.usertypoPerformanceChart
 */
(function () {
    var STORAGE_FILTERS = 'usertypo_pot_filters';
    var STORAGE_CHART = 'usertypo_pot_chart';
    var STORAGE_PRESETS = 'usertypo_pot_presets';

    var TIME_STANDARD = { 15: true, 30: true, 60: true, 120: true };
    var WORD_STANDARD = { 10: true, 25: true, 50: true, 100: true };
    var EXCLUSIVE_GROUPS = { date: true, results: true };

    var defaultFilters = {
        pb: { no: true, yes: true },
        mode: { words: true, time: true },
        words: { '10': true, '25': true, '50': true, '100': true, custom: true },
        time: { '15': true, '30': true, '60': true, '120': true, custom: true },
        punctuation: { on: true, off: true },
        numbers: { on: true, off: true },
        date: {
            last_day: false,
            last_week: false,
            last_month: false,
            all: true,
        },
        results: {
            last_10: false,
            last_50: false,
            last_100: false,
            all: true,
        },
    };

    var chartInstance = null;
    var chartJsPromise = null;
    var rootEl = null;
    var sessions = [];
    var filteredResults = [];
    var filters = clone(defaultFilters);
    var accountChart = ['on', 'on', 'on', 'on']; // speed, acc, avg10, avg100
    var filtersPanelOpen = false;
    var advancedOpen = false;
    var bubbleAnimTimer = null;
    var bubbleCloseTimer = null;
    var themeObserver = null;
    var BUBBLE_W_COLLAPSED = 40;
    var BUBBLE_H_COLLAPSED = 40;
    var BUBBLE_W_FILTERS = 520;
    var BUBBLE_W_ADVANCED = 520;
    var BUBBLE_ANIM_MS = 400;
    var BUBBLE_CLOSE_DELAY_MS = 1000;
    var BUBBLE_EASING = 'cubic-bezier(0.16, 1, 0.3, 1)';

    function clone(obj) {
        return JSON.parse(JSON.stringify(obj));
    }

    function cssVar(name, fallback) {
        var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        return v || fallback;
    }

    function parseColor(input, fallbackRgb) {
        var fb = fallbackRgb || [148, 163, 184];
        var s = String(input || '').trim();
        if (!s) return fb.slice();

        if (s[0] === '#') {
            var hex = s.slice(1);
            if (hex.length === 3) {
                hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
            }
            if (hex.length === 8) hex = hex.slice(0, 6);
            if (hex.length !== 6) return fb.slice();
            return [
                parseInt(hex.slice(0, 2), 16),
                parseInt(hex.slice(2, 4), 16),
                parseInt(hex.slice(4, 6), 16),
            ];
        }

        var rgbMatch = s.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
        if (rgbMatch) {
            return [
                Math.round(Number(rgbMatch[1])),
                Math.round(Number(rgbMatch[2])),
                Math.round(Number(rgbMatch[3])),
            ];
        }
        return fb.slice();
    }

    function rgbToHex(rgb) {
        return '#' + rgb.map(function (n) {
            var v = Math.max(0, Math.min(255, Math.round(n)));
            return v.toString(16).padStart(2, '0');
        }).join('');
    }

    function toRgba(color, alpha) {
        var rgb = parseColor(color);
        return 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + alpha + ')';
    }

    function theme() {
        var bg = cssVar('--theme-bg', '#0b0e14') || '#0b0e14';
        var main = cssVar('--theme-primary', '#00d0ff') || '#00d0ff';
        var mainLight = cssVar('--theme-primary-light', '') || main;
        var sub = cssVar('--theme-text-muted', '#94a3b8') || '#94a3b8';
        var text = cssVar('--theme-text', '#e2e8f0') || '#e2e8f0';
        var error = cssVar('--theme-error', '#ef4444') || '#ef4444';
        return {
            bg: bg,
            main: main,
            mainLight: mainLight,
            sub: sub,
            subAlt: toRgba(text, 0.08),
            text: text,
            error: error,
        };
    }

    function blend(a, b, t) {
        var A = parseColor(a);
        var B = parseColor(b);
        return rgbToHex([
            A[0] + (B[0] - A[0]) * t,
            A[1] + (B[1] - A[1]) * t,
            A[2] + (B[2] - A[2]) * t,
        ]);
    }

    function round2(n) {
        return Math.round(Number(n) * 100) / 100;
    }

    function loadScript(src) {
        return new Promise(function (resolve, reject) {
            var existing = document.querySelector('script[data-usertypo-chart="' + src + '"]');
            if (existing) {
                if (existing.getAttribute('data-loaded') === '1') return resolve();
                existing.addEventListener('load', function () { resolve(); });
                existing.addEventListener('error', function () { reject(new Error(src)); });
                return;
            }
            var s = document.createElement('script');
            s.src = src;
            s.async = true;
            s.setAttribute('data-usertypo-chart', src);
            s.onload = function () { s.setAttribute('data-loaded', '1'); resolve(); };
            s.onerror = function () { reject(new Error(src)); };
            document.head.appendChild(s);
        });
    }

    function ensureChartJs() {
        if (window.Chart) return Promise.resolve(window.Chart);
        if (chartJsPromise) return chartJsPromise;
        chartJsPromise = loadScript('https://cdn.jsdelivr.net/npm/chart.js@4.4.8/dist/chart.umd.min.js')
            .then(function () {
                if (window.Chart && window.Chart.defaults) {
                    window.Chart.defaults.animation = false;
                    if (window.Chart.defaults.elements && window.Chart.defaults.elements.line) {
                        window.Chart.defaults.elements.line.tension = 0.5;
                    }
                }
                return window.Chart;
            })
            .catch(function (err) { chartJsPromise = null; throw err; });
        return chartJsPromise;
    }

    function getFilter(group, key) {
        return !!(filters[group] && filters[group][key]);
    }

    function setAll(group, value) {
        if (!filters[group]) return;
        Object.keys(filters[group]).forEach(function (k) {
            filters[group][k] = value;
        });
    }

    function saveFilters() {
        try { localStorage.setItem(STORAGE_FILTERS, JSON.stringify(filters)); } catch (e) {}
    }

    function saveChartToggles() {
        try { localStorage.setItem(STORAGE_CHART, JSON.stringify(accountChart)); } catch (e) {}
    }

    function loadPersisted() {
        try {
            var f = JSON.parse(localStorage.getItem(STORAGE_FILTERS) || 'null');
            if (f && typeof f === 'object') {
                Object.keys(defaultFilters).forEach(function (group) {
                    if (!f[group]) return;
                    Object.keys(defaultFilters[group]).forEach(function (key) {
                        if (typeof f[group][key] === 'boolean') {
                            filters[group][key] = f[group][key];
                        }
                    });
                });
                // Migrate away from removed last_3months option
                if (f.date && f.date.last_3months && !filters.date.last_day
                    && !filters.date.last_week && !filters.date.last_month && !filters.date.all) {
                    filters.date.all = true;
                }
                ensureExclusiveGroup('date');
                ensureExclusiveGroup('results');
            }
        } catch (e) {}
        try {
            var c = JSON.parse(localStorage.getItem(STORAGE_CHART) || 'null');
            if (Array.isArray(c) && c.length === 4) {
                accountChart = c.map(function (v) { return v === 'off' ? 'off' : 'on'; });
                if (accountChart[0] === 'off' && accountChart[1] === 'off') {
                    accountChart[0] = 'on';
                }
            }
        } catch (e) {}
    }

    function ensureExclusiveGroup(group) {
        var keys = Object.keys(filters[group] || {});
        var on = keys.filter(function (k) { return filters[group][k]; });
        if (on.length === 1) return;
        setAll(group, false);
        if (on.length > 1) {
            filters[group][on[0]] = true;
        } else {
            filters[group].all = true;
        }
    }

    function readTypingConfig() {
        try {
            return JSON.parse(localStorage.getItem('usertypo_config') || '{}') || {};
        } catch (e) {
            return {};
        }
    }

    function applyAllFilters() {
        Object.keys(filters).forEach(function (group) {
            if (EXCLUSIVE_GROUPS[group]) return;
            setAll(group, true);
        });
        setAll('date', false);
        filters.date.all = true;
        setAll('results', false);
        filters.results.all = true;
        saveFilters();
        updateActive();
        render();
    }

    function applyCurrentSettings() {
        var cfg = readTypingConfig();
        var mode = cfg.testMode === 'time' ? 'time' : 'words';
        var amount = Number(cfg.testAmount) || (mode === 'time' ? 15 : 10);

        Object.keys(filters).forEach(function (group) {
            if (EXCLUSIVE_GROUPS[group]) return;
            setAll(group, false);
        });

        filters.pb.no = true;
        filters.pb.yes = true;
        filters.mode[mode] = true;

        if (mode === 'time') {
            if (TIME_STANDARD[amount]) filters.time[String(amount)] = true;
            else filters.time.custom = true;
        } else {
            if (WORD_STANDARD[amount]) filters.words[String(amount)] = true;
            else filters.words.custom = true;
        }

        if (cfg.usePunctuation) filters.punctuation.on = true;
        else filters.punctuation.off = true;

        if (cfg.useNumbers) filters.numbers.on = true;
        else filters.numbers.off = true;

        setAll('date', false);
        filters.date.all = true;
        saveFilters();
        updateActive();
        render();
    }

    function clearAdvancedFilters() {
        Object.keys(filters).forEach(function (group) {
            if (EXCLUSIVE_GROUPS[group]) return;
            setAll(group, false);
        });
        saveFilters();
        updateActive();
        render();
    }

    function toggleFilter(group, key) {
        if (EXCLUSIVE_GROUPS[group]) {
            setAll(group, false);
            filters[group][key] = true;
        } else {
            filters[group][key] = !filters[group][key];
        }
        saveFilters();
        updateActive();
        render();
    }

    function shiftSelectOnly(group, key) {
        setAll(group, false);
        filters[group][key] = true;
        saveFilters();
        updateActive();
        render();
    }

    function getPresets() {
        try {
            var list = JSON.parse(localStorage.getItem(STORAGE_PRESETS) || '[]');
            return Array.isArray(list) ? list : [];
        } catch (e) {
            return [];
        }
    }

    function savePreset() {
        var name = window.prompt('Preset name');
        if (!name || !String(name).trim()) return;
        var list = getPresets();
        list.push({
            id: 'p_' + Date.now(),
            name: String(name).trim().slice(0, 40),
            filters: clone(filters),
        });
        try { localStorage.setItem(STORAGE_PRESETS, JSON.stringify(list)); } catch (e) {}
        renderPresetButtons();
    }

    function applyPreset(id) {
        var preset = getPresets().find(function (p) { return p.id === id; });
        if (!preset) return;
        filters = clone(defaultFilters);
        Object.keys(defaultFilters).forEach(function (group) {
            if (!preset.filters[group]) return;
            Object.keys(defaultFilters[group]).forEach(function (key) {
                if (typeof preset.filters[group][key] === 'boolean') {
                    filters[group][key] = preset.filters[group][key];
                }
            });
        });
        ensureExclusiveGroup('date');
        ensureExclusiveGroup('results');
        saveFilters();
        updateActive();
        render();
    }

    function renderPresetButtons() {
        if (!rootEl) return;
        var wrap = rootEl.querySelector('[data-pot-presets]');
        if (!wrap) return;
        var list = getPresets();
        if (!list.length) {
            wrap.innerHTML = '';
            wrap.classList.add('hidden');
            return;
        }
        wrap.classList.remove('hidden');
        wrap.innerHTML = list.map(function (p) {
            return '<button type="button" class="pot-btn" data-pot-preset="' + p.id + '">'
                + escapeHtml(p.name)
                + '</button>';
        }).join('');
        if (filtersPanelOpen) syncBubbleSize();
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function getBubbleEl() {
        return rootEl ? rootEl.querySelector('[data-pot-filter-bubble]') : null;
    }

    function getBubbleToggle() {
        return rootEl ? rootEl.querySelector('[data-pot-toggle-filters]') : null;
    }

    function bubbleTransition() {
        return 'width ' + BUBBLE_ANIM_MS + 'ms ' + BUBBLE_EASING
            + ', height ' + BUBBLE_ANIM_MS + 'ms ' + BUBBLE_EASING
            + ', border-radius ' + BUBBLE_ANIM_MS + 'ms ' + BUBBLE_EASING;
    }

    function measureBubbleWidth() {
        var bubble = getBubbleEl();
        if (!bubble) return BUBBLE_W_FILTERS;
        var actions = bubble.querySelector('.pot-filters-actions');
        if (!actions) return BUBBLE_W_FILTERS;
        // Icon column (40) + left padding (~8) + actions content
        var needed = Math.ceil(actions.scrollWidth + 48);
        return Math.max(needed, 280);
    }

    function measureBubbleHeight(wantAdvanced) {
        var bubble = getBubbleEl();
        if (!bubble) return BUBBLE_H_COLLAPSED;
        if (!wantAdvanced) return BUBBLE_H_COLLAPSED;

        var prevTransition = bubble.style.transition;
        var prevWidth = bubble.style.width;
        var prevHeight = bubble.style.height;
        var prevVisibility = bubble.style.visibility;
        var hadOpen = bubble.classList.contains('is-open');
        var hadAdvanced = bubble.classList.contains('is-advanced');
        var width = measureBubbleWidth();

        bubble.style.visibility = 'hidden';
        bubble.style.transition = 'none';
        bubble.classList.add('is-open', 'is-advanced');
        bubble.style.width = width + 'px';
        bubble.style.height = 'auto';
        var height = Math.ceil(bubble.scrollHeight);

        bubble.classList.toggle('is-open', hadOpen);
        bubble.classList.toggle('is-advanced', hadAdvanced);
        bubble.style.width = prevWidth;
        bubble.style.height = prevHeight;
        bubble.style.visibility = prevVisibility;
        bubble.style.transition = prevTransition;
        return Math.max(height, BUBBLE_H_COLLAPSED);
    }

    function syncBubbleSize() {
        var bubble = getBubbleEl();
        var toggle = getBubbleToggle();
        if (!bubble) return;

        if (bubbleAnimTimer) {
            clearTimeout(bubbleAnimTimer);
            bubbleAnimTimer = null;
        }

        var advancedBtn = rootEl.querySelector('.toggleAdvancedFilters');
        if (advancedBtn) advancedBtn.classList.toggle('is-active', advancedOpen);

        if (!filtersPanelOpen) {
            advancedOpen = false;
            if (advancedBtn) advancedBtn.classList.remove('is-active');
            if (toggle) {
                toggle.setAttribute('aria-label', 'Open filters');
                toggle.setAttribute('aria-expanded', 'false');
            }
            bubble.classList.remove('is-advanced');
            if (!bubble.classList.contains('is-open')) {
                bubble.style.transition = '';
                bubble.style.width = '';
                bubble.style.height = '';
                bubble.style.borderRadius = '';
                return;
            }
            bubble.style.transition = bubbleTransition();
            bubble.classList.remove('is-open');
            bubble.style.width = BUBBLE_W_COLLAPSED + 'px';
            bubble.style.height = BUBBLE_H_COLLAPSED + 'px';
            bubble.style.borderRadius = '20px';
            bubbleAnimTimer = window.setTimeout(function () {
                bubbleAnimTimer = null;
                if (!filtersPanelOpen) {
                    bubble.style.transition = '';
                    bubble.style.width = '';
                    bubble.style.height = '';
                    bubble.style.borderRadius = '';
                }
            }, BUBBLE_ANIM_MS);
            return;
        }

        var targetW = measureBubbleWidth();
        var targetH = measureBubbleHeight(advancedOpen);
        var targetRadius = advancedOpen ? '1.25rem' : '20px';

        if (toggle) {
            toggle.setAttribute('aria-label', 'Close filters');
            toggle.setAttribute('aria-expanded', 'true');
        }

        var wasOpen = bubble.classList.contains('is-open');
        var wasAdvanced = bubble.classList.contains('is-advanced');
        bubble.classList.add('is-open');
        bubble.classList.toggle('is-advanced', advancedOpen);

        if (!wasOpen) {
            bubble.style.transition = 'none';
            bubble.style.width = BUBBLE_W_COLLAPSED + 'px';
            bubble.style.height = BUBBLE_H_COLLAPSED + 'px';
            bubble.style.borderRadius = '20px';
            void bubble.offsetWidth;
        } else if (!wasAdvanced && advancedOpen) {
            bubble.style.height = BUBBLE_H_COLLAPSED + 'px';
            void bubble.offsetWidth;
        }

        bubble.style.transition = bubbleTransition();
        bubble.style.width = targetW + 'px';
        bubble.style.height = targetH + 'px';
        bubble.style.borderRadius = targetRadius;
    }

    function updatePillIndicators() {
        if (!rootEl) return;
        ['date', 'results'].forEach(function (group) {
            var pill = rootEl.querySelector('[data-pot-group-wrap="' + group + '"]');
            var indicator = rootEl.querySelector('[data-pot-pill-indicator="' + group + '"]');
            if (!pill || !indicator) return;
            var active = pill.querySelector('.pot-btn.is-active');
            if (!active) {
                indicator.style.width = '0px';
                return;
            }
            indicator.style.left = active.offsetLeft + 'px';
            indicator.style.width = active.offsetWidth + 'px';
        });
    }

    function clearBubbleCloseTimer() {
        if (bubbleCloseTimer) {
            clearTimeout(bubbleCloseTimer);
            bubbleCloseTimer = null;
        }
    }

    function scheduleBubbleClose() {
        clearBubbleCloseTimer();
        if (!filtersPanelOpen) return;
        bubbleCloseTimer = window.setTimeout(function () {
            bubbleCloseTimer = null;
            closeFilterBubble();
        }, BUBBLE_CLOSE_DELAY_MS);
    }

    function closeFilterBubble() {
        clearBubbleCloseTimer();
        if (!filtersPanelOpen && !advancedOpen) return;
        filtersPanelOpen = false;
        advancedOpen = false;
        syncBubbleSize();
    }

    function updateActive() {
        if (!rootEl) return;
        rootEl.querySelectorAll('[data-pot-group][data-pot-filter]').forEach(function (btn) {
            var group = btn.getAttribute('data-pot-group');
            var key = btn.getAttribute('data-pot-filter');
            btn.classList.toggle('is-active', getFilter(group, key));
        });

        rootEl.querySelectorAll('[data-pot-chart-toggle]').forEach(function (btn) {
            var idx = Number(btn.getAttribute('data-pot-chart-toggle'));
            btn.classList.toggle('is-active', accountChart[idx] === 'on');
        });

        var advancedBtn = rootEl.querySelector('.toggleAdvancedFilters');
        if (advancedBtn) advancedBtn.classList.toggle('is-active', advancedOpen);

        updateAboveChart();
        updatePillIndicators();
    }

    function groupSummary(group) {
        var keys = Object.keys(filters[group] || {});
        var on = keys.filter(function (k) { return filters[group][k]; });
        return {
            all: on.length === keys.length || (on.length === 1 && on[0] === 'all'),
            array: on,
        };
    }

    function updateAboveChart() {
        if (!rootEl) return;
        var el = rootEl.querySelector('[data-pot-above]');
        if (!el) return;

        var date = groupSummary('date');
        var results = groupSummary('results');
        var mode = groupSummary('mode');
        var words = groupSummary('words');
        var time = groupSummary('time');
        var pb = groupSummary('pb');
        var punct = groupSummary('punctuation');
        var nums = groupSummary('numbers');

        function chip(icon, summary) {
            var label = summary.all ? 'all' : summary.array.join(', ').replace(/_/g, ' ');
            return '<span class="pot-above-chip">'
                + '<span class="material-symbols-outlined">' + icon + '</span>'
                + '<span>' + escapeHtml(label) + '</span>'
                + '</span>';
        }

        var html = chip('calendar_month', date) + chip('history', results) + chip('view_list', mode);
        if (mode.array.indexOf('time') !== -1) html += chip('schedule', time);
        if (mode.array.indexOf('words') !== -1) html += chip('text_fields', words);
        html += chip('workspace_premium', pb);
        html += chip('alternate_email', punct);
        html += chip('tag', nums);
        el.innerHTML = html;
    }

    function isValidSession(session) {
        if (!session || session.failed) return false;
        if (!session.created_at) return false;
        var wpm = Number(session.wpm);
        return isFinite(wpm) && wpm > 0;
    }

    function amountBucket(mode, amount) {
        var n = Number(amount);
        if (mode === 'time') return TIME_STANDARD[n] ? String(n) : 'custom';
        return WORD_STANDARD[n] ? String(n) : 'custom';
    }

    function resultsLimit() {
        if (getFilter('results', 'last_10')) return 10;
        if (getFilter('results', 'last_50')) return 50;
        if (getFilter('results', 'last_100')) return 100;
        return null;
    }

    function filterSessions(list) {
        var out = [];
        (list || []).forEach(function (result) {
            if (!isValidSession(result)) return;

            var isPb = !!result.is_pb;
            if (!getFilter('pb', isPb ? 'yes' : 'no')) return;

            var mode = result.mode === 'time' ? 'time' : 'words';
            if (!getFilter('mode', mode)) return;

            if (mode === 'time') {
                if (!getFilter('time', amountBucket('time', result.amount))) return;
            } else {
                if (!getFilter('words', amountBucket('words', result.amount))) return;
            }

            var punct = result.punctuation ? 'on' : 'off';
            if (!getFilter('punctuation', punct)) return;

            var nums = result.numbers ? 'on' : 'off';
            if (!getFilter('numbers', nums)) return;

            var ageSec = Math.abs(new Date(result.created_at).getTime() - Date.now()) / 1000;
            var dateOk =
                getFilter('date', 'all')
                || (getFilter('date', 'last_day') && ageSec <= 86400)
                || (getFilter('date', 'last_week') && ageSec <= 604800)
                || (getFilter('date', 'last_month') && ageSec <= 2592000);
            if (!dateOk) return;

            out.push(result);
        });

        var limit = resultsLimit();
        if (limit != null && out.length > limit) {
            out = out.slice(0, limit);
        }
        return out;
    }

    function findLineByLeastSquares(valuesY) {
        var n = valuesY.length;
        if (!n) return null;
        var sumX = 0;
        var sumY = 0;
        var sumXY = 0;
        var sumXX = 0;
        for (var i = 0; i < n; i++) {
            var x = i + 1;
            var y = valuesY[i];
            sumX += x;
            sumY += y;
            sumXX += x * x;
            sumXY += x * y;
        }
        var denom = (n * sumXX - sumX * sumX);
        if (!denom) return null;
        var m = (n * sumXY - sumX * sumY) / denom;
        var b = sumY / n - (m * sumX) / n;
        return [[1, m + b], [n, n * m + b]];
    }

    function buildChartData(results) {
        // results arrive newest-first
        var chartData = [];
        var accChartData = [];
        var totalSeconds = 0;

        results.forEach(function (result, idx) {
            var x = idx + 1;
            var wpm = round2(result.wpm);
            var raw = result.raw_wpm == null ? null : round2(result.raw_wpm);
            var acc = result.accuracy == null ? null : round2(result.accuracy);

            chartData.push({
                x: x,
                y: wpm,
                wpm: wpm,
                acc: acc,
                mode: result.mode,
                mode2: result.amount,
                punctuation: !!result.punctuation,
                numbers: !!result.numbers,
                timestamp: new Date(result.created_at).getTime(),
                raw: raw,
                isPb: !!result.is_pb,
            });

            if (acc != null && isFinite(acc)) {
                accChartData.push({
                    x: x,
                    y: acc,
                    errorRate: round2(100 - acc),
                    wpm: wpm,
                    raw: raw,
                    acc: acc,
                    mode: result.mode,
                    mode2: result.amount,
                    punctuation: !!result.punctuation,
                    numbers: !!result.numbers,
                    timestamp: new Date(result.created_at).getTime(),
                    isPb: !!result.is_pb,
                });
            }

            totalSeconds += Math.max(0, Number(result.duration_seconds) || 0);
        });

        var pb = [];
        var currentPb = 0;
        for (var i = chartData.length - 1; i >= 0; i--) {
            var point = chartData[i];
            if (point.y > currentPb) {
                currentPb = point.y;
                pb.push({ x: point.x, y: point.y });
            }
        }
        if (pb.length) {
            pb.push({ x: 1, y: pb[pb.length - 1].y });
        }

        var avgTen = [];
        var avgTenAcc = [];
        var avgHundred = [];
        var avgHundredAcc = [];

        for (var j = 0; j < chartData.length; j++) {
            var subsetTen = chartData.slice(j, j + 10);
            var accSubsetTen = accChartData.slice(j, j + 10);
            avgTen.push({
                x: j + 1,
                y: subsetTen.reduce(function (s, p) { return s + p.y; }, 0) / subsetTen.length,
            });
            if (accSubsetTen.length) {
                avgTenAcc.push({
                    x: j + 1,
                    y: accSubsetTen.reduce(function (s, p) { return s + p.y; }, 0) / accSubsetTen.length,
                });
            }

            var subsetHundred = chartData.slice(j, j + 100);
            var accSubsetHundred = accChartData.slice(j, j + 100);
            avgHundred.push({
                x: j + 1,
                y: subsetHundred.reduce(function (s, p) { return s + p.y; }, 0) / subsetHundred.length,
            });
            if (accSubsetHundred.length) {
                avgHundredAcc.push({
                    x: j + 1,
                    y: accSubsetHundred.reduce(function (s, p) { return s + p.y; }, 0) / accSubsetHundred.length,
                });
            }
        }

        return {
            chartData: chartData,
            accChartData: accChartData,
            pb: pb,
            avgTen: avgTen,
            avgTenAcc: avgTenAcc,
            avgHundred: avgHundred,
            avgHundredAcc: avgHundredAcc,
            totalSeconds: totalSeconds,
        };
    }

    function applySeriesVisibility(chart) {
        if (!chart) return;
        var speedOn = accountChart[0] === 'on';
        var accOn = accountChart[1] === 'on';
        var avg10On = accountChart[2] === 'on';
        var avg100On = accountChart[3] === 'on';

        var visibility = [
            speedOn,
            speedOn,
            accOn,
            speedOn && avg10On,
            accOn && avg10On,
            speedOn && avg100On,
            accOn && avg100On,
        ];

        visibility.forEach(function (visible, idx) {
            if (typeof chart.setDatasetVisibility === 'function') {
                chart.setDatasetVisibility(idx, visible);
            } else if (chart.data.datasets[idx]) {
                chart.data.datasets[idx].hidden = !visible;
            }
        });

        chart.options.scales.wpm.display = speedOn;
        chart.options.scales.acc.display = accOn;

        if (speedOn) {
            chart.options.scales.acc.min = 0;
        } else if (accOn && chart.data.datasets[2] && chart.data.datasets[2].data.length) {
            var minAcc = Math.min.apply(null, chart.data.datasets[2].data.map(function (p) { return p.y; }));
            var minAccRounded = Math.floor(minAcc / 5) * 5;
            chart.options.scales.acc.min = minAccRounded;
        }
    }

    function applyColors(chart) {
        if (!chart) return;
        var colors = theme();
        var avg10On = accountChart[2] === 'on';
        var avg100On = accountChart[3] === 'on';
        var text02 = blend(colors.bg, colors.text, 0.25);
        var main02 = blend(colors.bg, colors.main, 0.25);
        var main04 = blend(colors.bg, colors.main, 0.45);
        var main07 = blend(colors.bg, colors.main, 0.7);
        var sub02 = blend(colors.bg, colors.sub, 0.25);
        var sub04 = blend(colors.bg, colors.sub, 0.45);
        var sub07 = blend(colors.bg, colors.sub, 0.7);

        var wpmDs = chart.data.datasets[0];
        var pbDs = chart.data.datasets[1];
        var accDs = chart.data.datasets[2];
        var ao10wpm = chart.data.datasets[3];
        var ao10acc = chart.data.datasets[4];
        var ao100wpm = chart.data.datasets[5];
        var ao100acc = chart.data.datasets[6];

        wpmDs.borderWidth = 0;
        wpmDs.showLine = false;
        wpmDs.borderColor = colors.main;
        wpmDs.backgroundColor = colors.main;

        accDs.borderWidth = 0;
        accDs.showLine = false;
        accDs.borderColor = colors.sub;
        accDs.backgroundColor = colors.sub;

        pbDs.borderColor = text02;
        pbDs.backgroundColor = text02;

        if (avg10On && avg100On) {
            wpmDs.pointBackgroundColor = function (ctx) {
                return ctx.raw && ctx.raw.isPb ? colors.text : main02;
            };
            wpmDs.pointBorderColor = function (ctx) {
                return ctx.raw && ctx.raw.isPb ? colors.text : main02;
            };
            accDs.pointBackgroundColor = sub02;
            accDs.pointBorderColor = sub02;
            ao10wpm.borderColor = main04;
            ao10wpm.backgroundColor = main04;
            ao10acc.borderColor = sub04;
            ao10acc.backgroundColor = sub04;
            ao100wpm.borderColor = colors.main;
            ao100wpm.backgroundColor = colors.main;
            ao100acc.borderColor = colors.sub;
            ao100acc.backgroundColor = colors.sub;
        } else if (avg10On || avg100On) {
            wpmDs.pointBackgroundColor = function (ctx) {
                return ctx.raw && ctx.raw.isPb ? colors.text : main04;
            };
            wpmDs.pointBorderColor = function (ctx) {
                return ctx.raw && ctx.raw.isPb ? colors.text : main04;
            };
            accDs.pointBackgroundColor = sub04;
            accDs.pointBorderColor = sub04;
            ao10wpm.borderColor = colors.main;
            ao10wpm.backgroundColor = colors.main;
            ao100wpm.borderColor = colors.main;
            ao100wpm.backgroundColor = colors.main;
            ao10acc.borderColor = colors.sub;
            ao10acc.backgroundColor = colors.sub;
            ao100acc.borderColor = colors.sub;
            ao100acc.backgroundColor = colors.sub;
        } else {
            wpmDs.pointBackgroundColor = function (ctx) {
                return ctx.raw && ctx.raw.isPb ? colors.text : colors.main;
            };
            wpmDs.pointBorderColor = function (ctx) {
                return ctx.raw && ctx.raw.isPb ? colors.text : colors.main;
            };
            accDs.pointBackgroundColor = colors.sub;
            accDs.pointBorderColor = colors.sub;
            ao10wpm.borderColor = main07;
            ao10wpm.backgroundColor = main07;
            ao100wpm.borderColor = colors.main;
            ao100wpm.backgroundColor = colors.main;
            ao10acc.borderColor = sub07;
            ao10acc.backgroundColor = sub07;
            ao100acc.borderColor = colors.sub;
            ao100acc.backgroundColor = colors.sub;
        }

        Object.keys(chart.options.scales).forEach(function (id) {
            var scale = chart.options.scales[id];
            scale.ticks = scale.ticks || {};
            scale.title = scale.title || {};
            scale.grid = scale.grid || {};
            scale.ticks.color = colors.sub;
            scale.title.color = colors.sub;
            scale.grid.color = colors.subAlt;
            scale.grid.tickColor = colors.subAlt;
            if (scale.border) scale.border.color = colors.subAlt;
        });
    }

    function hideTooltip() {
        if (!rootEl) return;
        var tip = rootEl.querySelector('[data-pot-tooltip]');
        if (tip) tip.style.display = 'none';
    }

    function buildTooltipHtml(raw) {
        if (!raw) return '';
        var primary = 'var(--theme-primary, #00d0ff)';
        var muted = '#94a3b8';
        var dim = '#64748b';
        var warn = '#ffaa44';
        var html = '';

        if (raw.timestamp) {
            html += '<div style="color:' + muted + ';margin-bottom:1px;">'
                + escapeHtml(new Date(raw.timestamp).toLocaleString())
                + '</div>';
        }
        if (raw.wpm != null) {
            html += '<div style="color:' + primary + ';">'
                + escapeHtml(String(raw.wpm))
                + ' <span style="font-weight:400;font-size:9px;">wpm</span></div>';
        }
        if (raw.raw != null) {
            html += '<div style="color:' + dim + ';">'
                + escapeHtml(String(raw.raw))
                + ' <span style="font-weight:400;font-size:9px;">raw</span></div>';
        }
        if (raw.acc != null) {
            html += '<div style="color:' + muted + ';">'
                + escapeHtml(String(raw.acc))
                + ' <span style="font-weight:400;font-size:9px;">acc</span></div>';
        }
        if (raw.mode != null) {
            html += '<div style="color:' + dim + ';">'
                + escapeHtml(String(raw.mode) + ' ' + String(raw.mode2 == null ? '' : raw.mode2).trim())
                + '</div>';
        }

        var flags = [];
        if (raw.punctuation) flags.push('punctuation');
        if (raw.numbers) flags.push('numbers');
        if (flags.length) {
            html += '<div style="color:' + dim + ';">' + escapeHtml(flags.join(' · ')) + '</div>';
        }
        if (raw.isPb) {
            html += '<div style="color:' + warn + ';">personal best</div>';
        }
        return html;
    }

    function externalTooltipHandler(context) {
        if (!rootEl) return;
        var tip = rootEl.querySelector('[data-pot-tooltip]');
        var wrap = rootEl.querySelector('.performance-chart-wrap');
        if (!tip || !wrap) return;

        var tooltip = context.tooltip;
        if (!tooltip || tooltip.opacity === 0 || !tooltip.dataPoints || !tooltip.dataPoints.length) {
            tip.style.display = 'none';
            return;
        }

        // Prefer wpm point; fall back to accuracy point. Never merge both (avoids duplicates).
        var point = null;
        for (var i = 0; i < tooltip.dataPoints.length; i++) {
            if (tooltip.dataPoints[i].datasetIndex === 0) {
                point = tooltip.dataPoints[i];
                break;
            }
        }
        if (!point) {
            for (var j = 0; j < tooltip.dataPoints.length; j++) {
                if (tooltip.dataPoints[j].datasetIndex === 2) {
                    point = tooltip.dataPoints[j];
                    break;
                }
            }
        }
        if (!point) {
            tip.style.display = 'none';
            return;
        }

        tip.innerHTML = buildTooltipHtml(point.raw || {});
        tip.style.display = 'block';

        var caretX = tooltip.caretX;
        var caretY = tooltip.caretY;
        var tipW = tip.offsetWidth || 120;
        var tipH = tip.offsetHeight || 60;
        var W = wrap.clientWidth;
        var H = wrap.clientHeight;

        var tx = caretX + 15;
        if (tx + tipW > W - 8) tx = caretX - tipW - 15;
        if (tx < 8) tx = 8;

        var ty = caretY;
        var transform = 'translateY(0)';
        if (ty > H / 2) {
            transform = 'translateY(-100%)';
            if (ty - tipH < 8) transform = 'translateY(0)';
        } else if (ty + tipH > H - 8) {
            transform = 'translateY(-100%)';
        }

        tip.style.left = tx + 'px';
        tip.style.top = ty + 'px';
        tip.style.transform = transform;
    }

    function updateTrendText(built) {
        if (!rootEl) return;
        var el = rootEl.querySelector('[data-pot-trend]');
        if (!el) return;
        if (!built.chartData.length || !built.totalSeconds) {
            el.textContent = '';
            return;
        }
        var wpmPoints = filteredResults.map(function (r) { return Number(r.wpm); }).reverse();
        var trend = findLineByLeastSquares(wpmPoints);
        if (!trend) {
            el.textContent = '';
            return;
        }
        var wpmChange = trend[1][1] - trend[0][1];
        var perHour = wpmChange * (3600 / built.totalSeconds);
        var plus = perHour > 0 ? '+' : '';
        el.textContent = 'Speed change per hour spent typing: '
            + plus + round2(perHour) + ' wpm';
    }

    async function render() {
        if (!rootEl) return;
        var canvas = rootEl.querySelector('#performance-over-time-chart');
        var emptyEl = rootEl.querySelector('[data-pot-empty]');
        if (!canvas) return;

        filteredResults = filterSessions(sessions);
        var built = buildChartData(filteredResults);
        updateTrendText(built);
        hideTooltip();

        if (!built.chartData.length) {
            destroyChart();
            if (emptyEl) emptyEl.classList.remove('hidden');
            return;
        }
        if (emptyEl) emptyEl.classList.add('hidden');

        await ensureChartJs();
        if (!rootEl) return;

        var colors = theme();
        var wpms = built.chartData.map(function (p) { return p.y; });
        var maxWpm = Math.max.apply(null, wpms.concat([10]));
        var maxBuffered = Math.floor(maxWpm) + (10 - (Math.floor(maxWpm) % 10 || 10));
        if (maxBuffered < 10) maxBuffered = 10;

        var config = {
            type: 'line',
            data: {
                datasets: [
                    {
                        label: 'wpm',
                        yAxisID: 'wpm',
                        data: built.chartData,
                        fill: false,
                        borderWidth: 0,
                        showLine: false,
                        pointRadius: 2.5,
                        pointHoverRadius: 4,
                        borderColor: colors.main,
                        backgroundColor: colors.main,
                        pointBackgroundColor: colors.main,
                        pointBorderColor: colors.main,
                        order: 3,
                        tension: 0.3,
                    },
                    {
                        label: 'pb',
                        yAxisID: 'pb',
                        data: built.pb,
                        fill: false,
                        stepped: true,
                        pointRadius: 0,
                        pointHoverRadius: 0,
                        borderWidth: 2,
                        borderColor: blend(colors.bg, colors.text, 0.25),
                        backgroundColor: blend(colors.bg, colors.text, 0.25),
                        order: 4,
                    },
                    {
                        label: 'acc',
                        yAxisID: 'acc',
                        data: built.accChartData,
                        fill: false,
                        pointStyle: 'triangle',
                        borderWidth: 0,
                        pointRadius: 3.5,
                        pointHoverRadius: 5,
                        showLine: false,
                        borderColor: colors.sub,
                        backgroundColor: colors.sub,
                        pointBackgroundColor: colors.sub,
                        pointBorderColor: colors.sub,
                        order: 3,
                    },
                    {
                        label: 'avg10wpm',
                        yAxisID: 'wpmAvgTen',
                        data: built.avgTen,
                        fill: false,
                        pointRadius: 0,
                        pointHoverRadius: 0,
                        borderWidth: 2,
                        borderColor: colors.main,
                        backgroundColor: colors.main,
                        order: 2,
                        tension: 0.35,
                    },
                    {
                        label: 'avg10acc',
                        yAxisID: 'accAvgTen',
                        data: built.avgTenAcc,
                        fill: false,
                        pointRadius: 0,
                        pointHoverRadius: 0,
                        borderWidth: 2,
                        borderColor: colors.sub,
                        backgroundColor: colors.sub,
                        order: 2,
                        tension: 0.35,
                    },
                    {
                        label: 'avg100wpm',
                        yAxisID: 'wpmAvgHundred',
                        data: built.avgHundred,
                        fill: false,
                        pointRadius: 0,
                        pointHoverRadius: 0,
                        borderWidth: 2.5,
                        borderColor: colors.main,
                        backgroundColor: colors.main,
                        order: 1,
                        tension: 0.35,
                    },
                    {
                        label: 'avg100acc',
                        yAxisID: 'accAvgHundred',
                        data: built.avgHundredAcc,
                        fill: false,
                        pointRadius: 0,
                        pointHoverRadius: 0,
                        borderWidth: 2.5,
                        borderColor: colors.sub,
                        backgroundColor: colors.sub,
                        order: 1,
                        tension: 0.35,
                    },
                ],
            },
            options: {
                maintainAspectRatio: false,
                animation: false,
                responsive: true,
                interaction: { mode: 'nearest', intersect: false, axis: 'x' },
                plugins: {
                    legend: { display: false },
                    colors: { enabled: false },
                    tooltip: {
                        enabled: false,
                        external: externalTooltipHandler,
                        filter: function (item) {
                            return item.datasetIndex === 0 || item.datasetIndex === 2;
                        },
                    },
                },
                scales: {
                    x: {
                        type: 'linear',
                        reverse: true,
                        min: 0,
                        max: built.chartData.length + 1,
                        display: false,
                        grid: { display: false },
                    },
                    wpm: {
                        type: 'linear',
                        position: 'right',
                        beginAtZero: true,
                        min: 0,
                        max: maxBuffered,
                        title: { display: true, text: 'Words per Minute', color: colors.sub },
                        ticks: { stepSize: 10, color: colors.sub },
                        grid: { display: true, color: colors.subAlt },
                    },
                    pb: {
                        type: 'linear',
                        display: false,
                        beginAtZero: true,
                        min: 0,
                        max: maxBuffered,
                    },
                    acc: {
                        type: 'linear',
                        position: 'left',
                        beginAtZero: true,
                        min: 0,
                        max: 100,
                        reverse: true,
                        title: { display: true, text: 'Accuracy', color: colors.sub },
                        ticks: { stepSize: 10, color: colors.sub },
                        grid: { display: false },
                    },
                    wpmAvgTen: {
                        type: 'linear',
                        display: false,
                        beginAtZero: true,
                        min: 0,
                        max: maxBuffered,
                        grid: { display: false },
                    },
                    accAvgTen: {
                        type: 'linear',
                        display: false,
                        beginAtZero: true,
                        min: 0,
                        max: 100,
                        reverse: true,
                        grid: { display: false },
                    },
                    wpmAvgHundred: {
                        type: 'linear',
                        display: false,
                        beginAtZero: true,
                        min: 0,
                        max: maxBuffered,
                        grid: { display: false },
                    },
                    accAvgHundred: {
                        type: 'linear',
                        display: false,
                        beginAtZero: true,
                        min: 0,
                        max: 100,
                        reverse: true,
                        grid: { display: false },
                    },
                },
                onHover: function (evt, elements) {
                    if (!elements || !elements.length) hideTooltip();
                },
            },
        };

        destroyChart(false);
        chartInstance = new window.Chart(canvas.getContext('2d'), config);
        applySeriesVisibility(chartInstance);
        applyColors(chartInstance);
        chartInstance.update('none');

        canvas.onmouseleave = hideTooltip;
    }

    function destroyChart(clearTip) {
        if (chartInstance) {
            chartInstance.destroy();
            chartInstance = null;
        }
        if (clearTip !== false) hideTooltip();
    }

    function setChartToggle(index) {
        var next = accountChart.slice();
        next[index] = next[index] === 'on' ? 'off' : 'on';
        if (next[0] === 'off' && next[1] === 'off') {
            next[index === 0 ? 1 : 0] = 'on';
        }
        accountChart = next;
        saveChartToggles();
        updateActive();
        if (chartInstance) {
            applySeriesVisibility(chartInstance);
            applyColors(chartInstance);
            chartInstance.update('none');
        } else {
            render();
        }
    }

    function bindUi() {
        if (!rootEl || rootEl.dataset.potBound === '1') return;
        rootEl.dataset.potBound = '1';

        var bubble = getBubbleEl();
        if (bubble) {
            bubble.addEventListener('mouseenter', function () {
                clearBubbleCloseTimer();
            });
            bubble.addEventListener('mouseleave', function () {
                scheduleBubbleClose();
            });
        }

        rootEl.addEventListener('click', function (e) {
            var target = e.target.closest('button');
            if (!target || !rootEl.contains(target)) return;

            if (target.hasAttribute('data-pot-toggle-filters')) {
                e.stopPropagation();
                clearBubbleCloseTimer();
                filtersPanelOpen = !filtersPanelOpen;
                if (!filtersPanelOpen) advancedOpen = false;
                syncBubbleSize();
                return;
            }

            if (target.classList.contains('allFilters')) {
                applyAllFilters();
                return;
            }
            if (target.classList.contains('currentConfigFilter')) {
                applyCurrentSettings();
                return;
            }
            if (target.classList.contains('toggleAdvancedFilters')) {
                e.stopPropagation();
                clearBubbleCloseTimer();
                advancedOpen = !advancedOpen;
                if (advancedOpen) filtersPanelOpen = true;
                syncBubbleSize();
                updateActive();
                return;
            }
            if (target.classList.contains('createFilterPresetBtn')) {
                savePreset();
                return;
            }
            if (target.classList.contains('noFilters')) {
                clearAdvancedFilters();
                return;
            }

            var presetId = target.getAttribute('data-pot-preset');
            if (presetId) {
                applyPreset(presetId);
                return;
            }

            var chartToggle = target.getAttribute('data-pot-chart-toggle');
            if (chartToggle != null) {
                e.preventDefault();
                setChartToggle(Number(chartToggle));
                return;
            }

            var group = target.getAttribute('data-pot-group');
            var key = target.getAttribute('data-pot-filter');
            if (group && key) {
                if (e.shiftKey && !EXCLUSIVE_GROUPS[group]) {
                    shiftSelectOnly(group, key);
                } else {
                    toggleFilter(group, key);
                }
            }
        });
    }

    function watchTheme() {
        if (themeObserver) return;
        var debounce = null;
        themeObserver = new MutationObserver(function () {
            if (debounce) clearTimeout(debounce);
            debounce = setTimeout(function () {
                if (!chartInstance) return;
                applyColors(chartInstance);
                chartInstance.update('none');
            }, 80);
        });
        themeObserver.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['style', 'class', 'data-theme'],
        });
    }

    async function init(options) {
        rootEl = options && options.root;
        sessions = (options && options.sessions) || [];
        if (!rootEl) return;
        loadPersisted();
        bindUi();
        watchTheme();
        renderPresetButtons();
        updateActive();
        requestAnimationFrame(function () {
            updatePillIndicators();
        });
        await render();
    }

    async function setSessions(list) {
        sessions = list || [];
        await render();
    }

    function destroy() {
        destroyChart();
        clearBubbleCloseTimer();
        if (bubbleAnimTimer) {
            clearTimeout(bubbleAnimTimer);
            bubbleAnimTimer = null;
        }
        if (themeObserver) {
            themeObserver.disconnect();
            themeObserver = null;
        }
        if (rootEl) rootEl.dataset.potBound = '';
        rootEl = null;
        filtersPanelOpen = false;
        advancedOpen = false;
    }

    window.usertypoPerformanceChart = {
        init: init,
        setSessions: setSessions,
        destroy: destroy,
        render: render,
    };
})();
