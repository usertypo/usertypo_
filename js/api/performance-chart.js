/**
 * Performance Over Time chart — Chart.js line/scatter on typing_sessions.
 * Public API: window.usertypoPerformanceChart
 */
(function () {
    var TIME_AMOUNTS = [15, 30, 60, 120];
    var WORD_AMOUNTS = [10, 25, 50, 100];
    var MS = {
        week: 7 * 24 * 60 * 60 * 1000,
        month: 30 * 24 * 60 * 60 * 1000,
        sixMonths: 180 * 24 * 60 * 60 * 1000,
    };

    var chartInstance = null;
    var chartJsPromise = null;
    var state = {
        sessions: [],
        range: 'all',
        mode: 'all',
        amount: 'all',
        showWpm: true,
        showAcc: true,
        showAvg10: true,
    };

    function loadScript(src) {
        return new Promise(function (resolve, reject) {
            var existing = document.querySelector('script[data-usertypo-chart="' + src + '"]');
            if (existing) {
                if (existing.getAttribute('data-loaded') === '1') {
                    resolve();
                    return;
                }
                existing.addEventListener('load', function () { resolve(); });
                existing.addEventListener('error', function () { reject(new Error('Failed to load ' + src)); });
                return;
            }
            var script = document.createElement('script');
            script.src = src;
            script.async = true;
            script.setAttribute('data-usertypo-chart', src);
            script.onload = function () {
                script.setAttribute('data-loaded', '1');
                resolve();
            };
            script.onerror = function () {
                reject(new Error('Failed to load ' + src));
            };
            document.head.appendChild(script);
        });
    }

    function ensureChartJs() {
        if (window.Chart && window.Chart.registry) {
            return Promise.resolve(window.Chart);
        }
        if (chartJsPromise) return chartJsPromise;
        chartJsPromise = loadScript('https://cdn.jsdelivr.net/npm/chart.js@4.4.8/dist/chart.umd.min.js')
            .then(function () {
                return loadScript(
                    'https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@3.0.0/dist/chartjs-adapter-date-fns.bundle.min.js'
                );
            })
            .then(function () {
                return window.Chart;
            })
            .catch(function (err) {
                chartJsPromise = null;
                throw err;
            });
        return chartJsPromise;
    }

    function cssVar(name, fallback) {
        var value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        return value || fallback;
    }

    function themeColors() {
        return {
            primary: cssVar('--theme-primary-light', '#6cdaff') || cssVar('--theme-primary', '#00d0ff'),
            muted: cssVar('--theme-text-muted', '#94a3b8'),
            outline: cssVar('--theme-outline', '#aaabb0'),
            surface: 'rgba(255, 255, 255, 0.06)',
            grid: 'rgba(255, 255, 255, 0.06)',
            text: cssVar('--theme-text', '#e2e8f0'),
        };
    }

    function isValidSession(session) {
        if (!session || session.failed) return false;
        if (!session.created_at) return false;
        var wpm = Number(session.wpm);
        return isFinite(wpm) && wpm > 0;
    }

    function filterSessions(sessions, opts) {
        var range = (opts && opts.range) || 'all';
        var mode = (opts && opts.mode) || 'all';
        var amount = opts && opts.amount !== undefined ? opts.amount : 'all';

        var list = (sessions || []).filter(isValidSession);

        if (mode === 'time' || mode === 'words') {
            list = list.filter(function (s) {
                return s.mode === mode;
            });
        }

        if (amount !== 'all' && amount != null && amount !== '') {
            var amountNum = Number(amount);
            list = list.filter(function (s) {
                return Number(s.amount) === amountNum;
            });
        }

        list.sort(function (a, b) {
            return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        });

        var now = Date.now();
        if (range === '1w') {
            list = list.filter(function (s) {
                return now - new Date(s.created_at).getTime() <= MS.week;
            });
        } else if (range === '1m') {
            list = list.filter(function (s) {
                return now - new Date(s.created_at).getTime() <= MS.month;
            });
        } else if (range === '6m') {
            list = list.filter(function (s) {
                return now - new Date(s.created_at).getTime() <= MS.sixMonths;
            });
        } else if (range === 'last10' || range === 'last50' || range === 'last100') {
            var n = range === 'last10' ? 10 : range === 'last50' ? 50 : 100;
            list = list.slice(Math.max(0, list.length - n));
        }

        return list;
    }

    function trailingAvg(values, windowSize) {
        var out = [];
        var sum = 0;
        for (var i = 0; i < values.length; i++) {
            sum += values[i];
            if (i >= windowSize) sum -= values[i - windowSize];
            var count = Math.min(i + 1, windowSize);
            out.push(Math.round((sum / count) * 100) / 100);
        }
        return out;
    }

    function formatModeLabel(mode, amount) {
        if (window.usertypoSessions && typeof window.usertypoSessions.formatModeLabel === 'function') {
            return window.usertypoSessions.formatModeLabel(mode, amount);
        }
        if (mode === 'time') return 'timed ' + amount + 's';
        return 'words ' + amount;
    }

    function buildDatasets(filtered) {
        var colors = themeColors();
        var wpmPoints = [];
        var accPoints = [];
        var wpmValues = [];

        filtered.forEach(function (session) {
            var t = new Date(session.created_at).getTime();
            var wpm = Number(session.wpm);
            var acc = session.accuracy == null ? null : Number(session.accuracy);
            wpmValues.push(wpm);
            wpmPoints.push({
                x: t,
                y: wpm,
                session: session,
            });
            if (acc != null && isFinite(acc)) {
                accPoints.push({
                    x: t,
                    y: acc,
                    session: session,
                });
            }
        });

        var avgValues = trailingAvg(wpmValues, 10);
        var avgPoints = filtered.map(function (session, i) {
            return { x: new Date(session.created_at).getTime(), y: avgValues[i] };
        });

        return {
            wpmPoints: wpmPoints,
            accPoints: accPoints,
            avgPoints: avgPoints,
            colors: colors,
        };
    }

    function destroy() {
        if (chartInstance) {
            chartInstance.destroy();
            chartInstance = null;
        }
    }

    function setEmpty(emptyEl, show, count) {
        if (!emptyEl) return;
        if (show) {
            emptyEl.classList.remove('hidden');
            emptyEl.textContent = count === 0
                ? 'No tests match these filters'
                : 'Not enough data to chart';
        } else {
            emptyEl.classList.add('hidden');
        }
    }

    async function render(options) {
        var canvas = options && options.canvas;
        var emptyEl = options && options.emptyEl;
        if (!canvas) return;

        if (options.sessions) state.sessions = options.sessions;
        if (options.range != null) state.range = options.range;
        if (options.mode != null) state.mode = options.mode;
        if (options.amount != null) state.amount = options.amount;
        if (options.showWpm != null) state.showWpm = !!options.showWpm;
        if (options.showAcc != null) state.showAcc = !!options.showAcc;
        if (options.showAvg10 != null) state.showAvg10 = !!options.showAvg10;

        var filtered = filterSessions(state.sessions, state);
        if (!filtered.length) {
            destroy();
            setEmpty(emptyEl, true, 0);
            return { count: 0, filtered: [] };
        }

        setEmpty(emptyEl, false, filtered.length);
        await ensureChartJs();

        var built = buildDatasets(filtered);
        var colors = built.colors;

        var datasets = [
            {
                label: 'WPM',
                data: built.wpmPoints,
                yAxisID: 'y',
                showLine: true,
                borderColor: colors.primary,
                backgroundColor: colors.primary,
                borderWidth: 1.5,
                pointRadius: filtered.length > 200 ? 1.5 : filtered.length > 80 ? 2.5 : 3.5,
                pointHoverRadius: 5,
                pointBackgroundColor: colors.primary,
                tension: 0.15,
                order: 3,
                hidden: !state.showWpm,
            },
            {
                label: 'Avg of 10',
                data: built.avgPoints,
                yAxisID: 'y',
                showLine: true,
                borderColor: colors.outline,
                backgroundColor: 'transparent',
                borderWidth: 2,
                borderDash: [6, 4],
                pointRadius: 0,
                pointHoverRadius: 0,
                tension: 0.25,
                order: 2,
                hidden: !state.showAvg10 || !state.showWpm,
            },
            {
                label: 'Accuracy',
                data: built.accPoints,
                yAxisID: 'y1',
                showLine: true,
                borderColor: colors.muted,
                backgroundColor: colors.muted,
                borderWidth: 1,
                pointRadius: filtered.length > 200 ? 1.5 : 2.5,
                pointHoverRadius: 4,
                pointStyle: 'triangle',
                tension: 0.15,
                order: 1,
                hidden: !state.showAcc,
            },
        ];

        var wpmVals = built.wpmPoints.map(function (p) { return p.y; });
        var maxWpm = Math.max.apply(null, wpmVals.concat([10]));
        var wpmMax = Math.ceil(maxWpm / 10) * 10 + 10;

        var config = {
            type: 'scatter',
            data: { datasets: datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                interaction: {
                    mode: 'nearest',
                    intersect: false,
                    axis: 'x',
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        displayColors: false,
                        backgroundColor: 'rgba(15, 18, 24, 0.92)',
                        titleColor: colors.text,
                        bodyColor: colors.muted,
                        borderColor: 'rgba(255,255,255,0.08)',
                        borderWidth: 1,
                        padding: 10,
                        callbacks: {
                            title: function () {
                                return '';
                            },
                            label: function (ctx) {
                                var raw = ctx.raw || {};
                                var session = raw.session;
                                if (ctx.dataset.label === 'Avg of 10') {
                                    return 'Avg of 10: ' + Number(raw.y).toFixed(1) + ' wpm';
                                }
                                if (ctx.dataset.label === 'Accuracy') {
                                    var linesAcc = ['Accuracy: ' + Number(raw.y).toFixed(1) + '%'];
                                    if (session) {
                                        linesAcc.push(formatModeLabel(session.mode, session.amount));
                                        linesAcc.push(new Date(session.created_at).toLocaleString());
                                    }
                                    return linesAcc;
                                }
                                var lines = ['WPM: ' + Number(raw.y).toFixed(1)];
                                if (session) {
                                    if (session.accuracy != null) {
                                        lines.push('Accuracy: ' + Number(session.accuracy).toFixed(1) + '%');
                                    }
                                    lines.push(formatModeLabel(session.mode, session.amount));
                                    lines.push(new Date(session.created_at).toLocaleString());
                                }
                                return lines;
                            },
                        },
                    },
                },
                scales: {
                    x: {
                        type: 'time',
                        time: {
                            tooltipFormat: 'MMM d, yyyy HH:mm',
                            displayFormats: {
                                hour: 'MMM d Ha',
                                day: 'MMM d',
                                week: 'MMM d',
                                month: 'MMM yyyy',
                            },
                        },
                        grid: { color: colors.grid, drawBorder: false },
                        ticks: {
                            color: colors.muted,
                            maxRotation: 0,
                            autoSkip: true,
                            maxTicksLimit: 8,
                            font: { size: 10, family: "'Roboto Mono', monospace" },
                        },
                    },
                    y: {
                        position: 'right',
                        title: {
                            display: true,
                            text: 'Words per Minute',
                            color: colors.muted,
                            font: { size: 11, family: "'Roboto Mono', monospace" },
                        },
                        min: 0,
                        max: wpmMax,
                        grid: { color: colors.grid, drawBorder: false },
                        ticks: {
                            color: colors.muted,
                            stepSize: Math.max(5, Math.round(wpmMax / 8 / 5) * 5),
                            font: { size: 10, family: "'Roboto Mono', monospace" },
                        },
                        display: state.showWpm || state.showAvg10,
                    },
                    y1: {
                        position: 'left',
                        title: {
                            display: true,
                            text: 'Accuracy',
                            color: colors.muted,
                            font: { size: 11, family: "'Roboto Mono', monospace" },
                        },
                        min: 0,
                        max: 100,
                        grid: { drawOnChartArea: false, drawBorder: false },
                        ticks: {
                            color: colors.muted,
                            stepSize: 20,
                            callback: function (v) { return v + '%'; },
                            font: { size: 10, family: "'Roboto Mono', monospace" },
                        },
                        display: state.showAcc,
                    },
                },
            },
        };

        destroy();
        chartInstance = new window.Chart(canvas.getContext('2d'), config);
        return { count: filtered.length, filtered: filtered };
    }

    function getState() {
        return {
            range: state.range,
            mode: state.mode,
            amount: state.amount,
            showWpm: state.showWpm,
            showAcc: state.showAcc,
            showAvg10: state.showAvg10,
        };
    }

    window.usertypoPerformanceChart = {
        render: render,
        destroy: destroy,
        filterSessions: filterSessions,
        getState: getState,
        TIME_AMOUNTS: TIME_AMOUNTS,
        WORD_AMOUNTS: WORD_AMOUNTS,
    };
})();
