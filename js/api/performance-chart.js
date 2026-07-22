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
            last_3months: false,
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
    var activeIndex = 0;

    function clone(obj) {
        return JSON.parse(JSON.stringify(obj));
    }

    function cssVar(name, fallback) {
        var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        return v || fallback;
    }

    function theme() {
        return {
            bg: cssVar('--theme-bg', '#0b0e14') || '#0b0e14',
            main: cssVar('--theme-primary-light', '#6cdaff') || cssVar('--theme-primary', '#00d0ff'),
            sub: cssVar('--theme-text-muted', '#94a3b8'),
            subAlt: 'rgba(255,255,255,0.06)',
            text: cssVar('--theme-text', '#e2e8f0'),
            error: cssVar('--theme-error', '#ef4444'),
        };
    }

    function blendHex(a, b, t) {
        function parse(hex) {
            hex = String(hex || '').replace('#', '');
            if (hex.length === 3) {
                hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
            }
            if (hex.length !== 6) return [148, 163, 184];
            return [
                parseInt(hex.slice(0, 2), 16),
                parseInt(hex.slice(2, 4), 16),
                parseInt(hex.slice(4, 6), 16),
            ];
        }
        var A = parse(a);
        var B = parse(b);
        var r = Math.round(A[0] + (B[0] - A[0]) * t);
        var g = Math.round(A[1] + (B[1] - A[1]) * t);
        var bl = Math.round(A[2] + (B[2] - A[2]) * t);
        return '#' + [r, g, bl].map(function (n) {
            return n.toString(16).padStart(2, '0');
        }).join('');
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

    function readTypingConfig() {
        try {
            return JSON.parse(localStorage.getItem('usertypo_config') || '{}') || {};
        } catch (e) {
            return {};
        }
    }

    function applyAllFilters() {
        Object.keys(filters).forEach(function (group) {
            if (group === 'date') return;
            setAll(group, true);
        });
        setAll('date', false);
        filters.date.all = true;
        saveFilters();
        updateActive();
        render();
    }

    function applyCurrentSettings() {
        var cfg = readTypingConfig();
        var mode = cfg.testMode === 'time' ? 'time' : 'words';
        var amount = Number(cfg.testAmount) || (mode === 'time' ? 15 : 10);

        Object.keys(filters).forEach(function (group) {
            if (group === 'date') return;
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
            if (group === 'date') return;
            setAll(group, false);
        });
        saveFilters();
        updateActive();
        render();
    }

    function toggleFilter(group, key, exclusiveDate) {
        if (group === 'date' || exclusiveDate) {
            setAll('date', false);
            filters.date[key] = true;
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
        wrap.innerHTML = '<div class="pot-filter-title"><span class="material-symbols-outlined text-[14px]">bookmark</span> filter presets</div>'
            + '<div class="pot-filter-btns">'
            + list.map(function (p) {
                return '<button type="button" class="pot-btn" data-pot-preset="' + p.id + '">'
                    + escapeHtml(p.name)
                    + '</button>';
            }).join('')
            + '</div>';
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
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

        updateAboveChart();
    }

    function groupSummary(group) {
        var keys = Object.keys(filters[group] || {});
        var on = keys.filter(function (k) { return filters[group][k]; });
        return {
            all: on.length === keys.length,
            array: on,
        };
    }

    function updateAboveChart() {
        if (!rootEl) return;
        var el = rootEl.querySelector('[data-pot-above]');
        if (!el) return;

        var date = groupSummary('date');
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

        var html = chip('calendar_month', date) + chip('view_list', mode);
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
                || (getFilter('date', 'last_month') && ageSec <= 2592000)
                || (getFilter('date', 'last_3months') && ageSec <= 7776000);
            if (!dateOk) return;

            out.push(result);
        });
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
        var m = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
        var b = sumY / n - (m * sumX) / n;
        return [[1, m + b], [n, n * m + b]];
    }

    function buildChartData(results) {
        // results arrive newest-first (same as Monkeytype snapshot order)
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
        var speedOn = accountChart[0] === 'on';
        var accOn = accountChart[1] === 'on';
        var avg10On = accountChart[2] === 'on';
        var avg100On = accountChart[3] === 'on';

        var ds = chart.data.datasets;
        ds[0].hidden = !speedOn; // wpm
        ds[1].hidden = !speedOn; // pb
        ds[2].hidden = !accOn; // acc
        ds[3].hidden = !(speedOn && avg10On);
        ds[4].hidden = !(accOn && avg10On);
        ds[5].hidden = !(speedOn && avg100On);
        ds[6].hidden = !(accOn && avg100On);

        chart.options.scales.wpm.display = speedOn;
        chart.options.scales.acc.display = accOn;

        if (speedOn) {
            chart.options.scales.acc.min = 0;
        } else if (accOn && ds[2].data.length) {
            var minAcc = Math.min.apply(null, ds[2].data.map(function (p) { return p.y; }));
            var minAccRounded = Math.floor(minAcc / 5) * 5;
            chart.options.scales.acc.min = minAccRounded;
        }
    }

    function applyColors(chart) {
        var colors = theme();
        var avg10On = accountChart[2] === 'on';
        var avg100On = accountChart[3] === 'on';
        var text02 = blendHex(colors.bg, colors.text, 0.2);
        var main02 = blendHex(colors.bg, colors.main, 0.2);
        var main04 = blendHex(colors.bg, colors.main, 0.4);
        var sub02 = blendHex(colors.bg, colors.sub, 0.2);
        var sub04 = blendHex(colors.bg, colors.sub, 0.4);

        var wpmDs = chart.data.datasets[0];
        var pbDs = chart.data.datasets[1];
        var accDs = chart.data.datasets[2];
        var ao10wpm = chart.data.datasets[3];
        var ao10acc = chart.data.datasets[4];
        var ao100wpm = chart.data.datasets[5];
        var ao100acc = chart.data.datasets[6];

        wpmDs.borderWidth = 0;
        wpmDs.showLine = true;
        wpmDs.borderColor = function (ctx) {
            return ctx.raw && ctx.raw.isPb ? colors.text : colors.main;
        };
        accDs.borderWidth = 0;
        accDs.showLine = false;

        if (avg10On && avg100On) {
            wpmDs.pointBackgroundColor = main02;
            pbDs.borderColor = text02;
            accDs.pointBackgroundColor = sub02;
            ao10wpm.borderColor = main04;
            ao10acc.borderColor = sub04;
            ao100wpm.borderColor = colors.main;
            ao100acc.borderColor = colors.sub;
        } else if ((avg10On && !avg100On) || (!avg10On && avg100On)) {
            pbDs.borderColor = text02;
            wpmDs.pointBackgroundColor = main04;
            accDs.pointBackgroundColor = sub04;
            ao10wpm.borderColor = colors.main;
            ao100wpm.borderColor = colors.main;
            ao10acc.borderColor = colors.sub;
            ao100acc.borderColor = colors.sub;
        } else {
            pbDs.borderColor = text02;
            wpmDs.pointBackgroundColor = function (ctx) {
                return ctx.raw && ctx.raw.isPb ? colors.text : colors.main;
            };
            accDs.pointBackgroundColor = colors.sub;
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
            scale.grid.borderColor = colors.subAlt;
        });
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

        if (!built.chartData.length) {
            destroyChart();
            if (emptyEl) emptyEl.classList.remove('hidden');
            return;
        }
        if (emptyEl) emptyEl.classList.add('hidden');

        await ensureChartJs();

        var colors = theme();
        var wpms = built.chartData.map(function (p) { return p.y; });
        var maxWpm = Math.max.apply(null, wpms.concat([10]));
        var maxBuffered = Math.floor(maxWpm) + (10 - (Math.floor(maxWpm) % 10));

        var config = {
            type: 'line',
            data: {
                datasets: [
                    {
                        yAxisID: 'wpm',
                        data: built.chartData,
                        fill: false,
                        borderWidth: 0,
                        pointRadius: 2.5,
                        pointHoverRadius: 4,
                        order: 3,
                        tension: 0.3,
                    },
                    {
                        yAxisID: 'pb',
                        data: built.pb,
                        fill: false,
                        stepped: true,
                        pointRadius: 0,
                        pointHoverRadius: 0,
                        borderWidth: 2,
                        order: 4,
                    },
                    {
                        yAxisID: 'acc',
                        data: built.accChartData,
                        fill: false,
                        pointStyle: 'triangle',
                        borderWidth: 0,
                        pointRadius: 3.5,
                        pointHoverRadius: 5,
                        showLine: false,
                        order: 3,
                    },
                    {
                        yAxisID: 'wpmAvgTen',
                        data: built.avgTen,
                        fill: false,
                        pointRadius: 0,
                        pointHoverRadius: 0,
                        borderWidth: 2,
                        order: 2,
                        tension: 0.35,
                    },
                    {
                        yAxisID: 'accAvgTen',
                        data: built.avgTenAcc,
                        fill: false,
                        pointRadius: 0,
                        pointHoverRadius: 0,
                        borderWidth: 2,
                        order: 2,
                        tension: 0.35,
                    },
                    {
                        yAxisID: 'wpmAvgHundred',
                        data: built.avgHundred,
                        fill: false,
                        pointRadius: 0,
                        pointHoverRadius: 0,
                        borderWidth: 2.5,
                        order: 1,
                        tension: 0.35,
                    },
                    {
                        yAxisID: 'accAvgHundred',
                        data: built.avgHundredAcc,
                        fill: false,
                        pointRadius: 0,
                        pointHoverRadius: 0,
                        borderWidth: 2.5,
                        order: 1,
                        tension: 0.35,
                    },
                ],
            },
            options: {
                maintainAspectRatio: false,
                animation: false,
                interaction: { mode: 'nearest', intersect: false },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        displayColors: false,
                        backgroundColor: 'rgba(15,18,24,0.94)',
                        titleColor: colors.text,
                        bodyColor: colors.sub,
                        borderColor: 'rgba(255,255,255,0.08)',
                        borderWidth: 1,
                        padding: 10,
                        filter: function (item) {
                            return item.datasetIndex === 0 || item.datasetIndex === 2;
                        },
                        callbacks: {
                            title: function () { return ''; },
                            label: function () { return ''; },
                            beforeLabel: function (item) {
                                activeIndex = item.dataIndex;
                                var raw = item.raw || {};
                                if (item.datasetIndex === 2) {
                                    return 'error rate: ' + round2(raw.errorRate) + '%\nacc: '
                                        + round2(100 - raw.errorRate) + '%';
                                }
                                var lines = [
                                    'wpm: ' + raw.wpm,
                                    'raw: ' + (raw.raw == null ? '—' : raw.raw),
                                    'acc: ' + (raw.acc == null ? '—' : raw.acc),
                                    '',
                                    'mode: ' + raw.mode + ' ' + raw.mode2,
                                    'punctuation: ' + !!raw.punctuation,
                                    'numbers: ' + !!raw.numbers,
                                ];
                                if (raw.isPb) lines.push('', 'new personal best');
                                lines.push('', 'date: ' + new Date(raw.timestamp).toLocaleString());
                                return lines.join('\n');
                            },
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
                        title: { display: true, text: 'Words per Minute' },
                        ticks: { stepSize: 10 },
                        grid: { display: true },
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
                        title: { display: true, text: 'Accuracy' },
                        ticks: { stepSize: 10 },
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
            },
        };

        destroyChart();
        chartInstance = new window.Chart(canvas.getContext('2d'), config);
        applySeriesVisibility(chartInstance);
        applyColors(chartInstance);
        chartInstance.update('none');
    }

    function destroyChart() {
        if (chartInstance) {
            chartInstance.destroy();
            chartInstance = null;
        }
    }

    function setChartToggle(index) {
        var next = accountChart.slice();
        next[index] = next[index] === 'on' ? 'off' : 'on';
        if (next[0] === 'off' && next[1] === 'off') {
            // same guard as Monkeytype: keep one of speed/accuracy on
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

        rootEl.addEventListener('click', function (e) {
            var target = e.target.closest('button');
            if (!target || !rootEl.contains(target)) return;

            if (target.classList.contains('allFilters')) {
                applyAllFilters();
                return;
            }
            if (target.classList.contains('currentConfigFilter')) {
                applyCurrentSettings();
                return;
            }
            if (target.classList.contains('toggleAdvancedFilters')) {
                var panel = rootEl.querySelector('[data-pot-advanced]');
                if (panel) panel.classList.toggle('hidden');
                target.classList.toggle('is-active');
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
                setChartToggle(Number(chartToggle));
                return;
            }

            var group = target.getAttribute('data-pot-group');
            var key = target.getAttribute('data-pot-filter');
            if (group && key) {
                if (e.shiftKey && group !== 'date') {
                    shiftSelectOnly(group, key);
                } else {
                    toggleFilter(group, key, group === 'date');
                }
            }
        });
    }

    async function init(options) {
        rootEl = options && options.root;
        sessions = (options && options.sessions) || [];
        if (!rootEl) return;
        loadPersisted();
        bindUi();
        renderPresetButtons();
        updateActive();
        await render();
    }

    async function setSessions(list) {
        sessions = list || [];
        await render();
    }

    function destroy() {
        destroyChart();
        if (rootEl) rootEl.dataset.potBound = '';
        rootEl = null;
    }

    window.usertypoPerformanceChart = {
        init: init,
        setSessions: setSessions,
        destroy: destroy,
        render: render,
    };
})();
