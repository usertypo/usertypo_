/**
 * Monkeytype-style test activity heatmap (UTC-based).
 * Ported from monkeytypegame/monkeytype test-activity-calendar.ts + test-activity.ts
 */
(function () {
    var cachedSessions = [];
    var cachedSignupYear = null;
    var yearSelectHandler = null;

    function pad2(n) {
        return n < 10 ? '0' + n : String(n);
    }

    function utcDate(y, m, d) {
        return new Date(Date.UTC(y, m, d));
    }

    function utcFromParts(d) {
        return utcDate(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    }

    function addUtcDays(d, days) {
        var next = new Date(d.getTime());
        next.setUTCDate(next.getUTCDate() + days);
        return utcFromParts(next);
    }

    function differenceInUtcDays(a, b) {
        return Math.round((utcFromParts(a).getTime() - utcFromParts(b).getTime()) / 86400000);
    }

    function startOfUtcYear(d) {
        return utcDate(d.getUTCFullYear(), 0, 1);
    }

    function endOfUtcYear(d) {
        return utcDate(d.getUTCFullYear(), 11, 31);
    }

    function startOfUtcMonth(d) {
        return utcDate(d.getUTCFullYear(), d.getUTCMonth(), 1);
    }

    function endOfUtcMonth(d) {
        return utcDate(d.getUTCFullYear(), d.getUTCMonth() + 1, 0);
    }

    function eachUtcMonthOfInterval(start, end) {
        var months = [];
        var cursor = startOfUtcMonth(start);
        var last = startOfUtcMonth(end);
        while (cursor.getTime() <= last.getTime()) {
            months.push(new Date(cursor.getTime()));
            cursor = utcDate(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1);
        }
        return months;
    }

    function formatUtcMonthShort(d) {
        var months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
        return months[d.getUTCMonth()];
    }

    function formatUtcDayLabel(d) {
        var days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return days[d.getUTCDay()] + ' ' + pad2(d.getUTCDate()) + ' ' + months[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
    }

    function previousDayOfWeek(date, dayOfWeek) {
        var dow = date.getUTCDay();
        var delta = (dow - dayOfWeek + 7) % 7;
        if (delta === 0) delta = 7;
        return addUtcDays(date, -delta);
    }

    function nextDayOfWeek(date, dayOfWeek) {
        var dow = date.getUTCDay();
        var delta = (dayOfWeek - dow + 7) % 7;
        if (delta === 0) delta = 7;
        return addUtcDays(date, delta);
    }

    function lastDayOfWeek(date, firstDayOfWeek) {
        return nextDayOfWeek(date, (firstDayOfWeek + 6) % 7);
    }

    function isFirstDayOfWeek(date, firstDayOfWeek) {
        return date.getUTCDay() === firstDayOfWeek;
    }

    function isLastDayOfWeek(date, firstDayOfWeek) {
        return date.getUTCDay() === (firstDayOfWeek + 6) % 7;
    }

    function differenceInUtcWeeks(end, start) {
        return Math.ceil(differenceInUtcDays(end, start) / 7);
    }

    function getFirstDayOfWeek() {
        // The activity card always uses Sunday as its first row so the day
        // labels and heatmap remain consistent across browser locales.
        return 0;
    }

    function utcDateKey(d) {
        return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
    }

    function buildTestsByDays(sessions, lastDayUtc) {
        var counts = {};
        var earliest = null;

        sessions.forEach(function (session) {
            if (!session || session.failed || !session.created_at) return;
            var day = utcFromParts(new Date(session.created_at));
            var key = utcDateKey(day);
            counts[key] = (counts[key] || 0) + 1;
            if (!earliest || day.getTime() < earliest.getTime()) earliest = day;
        });

        if (!earliest) earliest = utcFromParts(lastDayUtc);

        var data = [];
        var cursor = new Date(earliest.getTime());
        var last = utcFromParts(lastDayUtc);
        while (cursor.getTime() <= last.getTime()) {
            data.push(counts[utcDateKey(cursor)] || 0);
            cursor = addUtcDays(cursor, 1);
        }
        return data;
    }

    function buildTestsByDayMap(sessions) {
        var counts = {};
        sessions.forEach(function (session) {
            if (!session || session.failed || !session.created_at) return;
            var key = utcDateKey(utcFromParts(new Date(session.created_at)));
            counts[key] = (counts[key] || 0) + 1;
        });
        return counts;
    }

    function TestActivityCalendar(data, lastDay, firstDayOfWeek, fullYear, countsByDay) {
        this.firstDayOfWeek = firstDayOfWeek;
        this.isFullYear = !!fullYear;
        this.countsByDay = countsByDay || {};

        var local = utcFromParts(lastDay);
        var interval = this.getInterval(local, this.isFullYear);
        this.startDay = interval.start;
        this.endDay = interval.end;
        this.data = this.buildData(data, local);
    }

    TestActivityCalendar.prototype.getInterval = function (lastDay, fullYear) {
        var end = fullYear ? endOfUtcYear(lastDay) : utcFromParts(new Date());
        var start = startOfUtcYear(lastDay);

        if (!fullYear) {
            start = addUtcDays(addUtcDays(end, -52 * 7), 1);
            if (!isFirstDayOfWeek(start, this.firstDayOfWeek)) {
                start = previousDayOfWeek(start, this.firstDayOfWeek);
            }
        }

        return { start: start, end: end };
    };

    TestActivityCalendar.prototype.buildData = function (data, lastDay) {
        var values = new Array(Math.max(0, 386 - data.length));
        for (var i = 0; i < values.length; i++) values[i] = undefined;
        values = values.concat(data);

        var days = differenceInUtcDays(this.endDay, this.startDay) + 1;
        var offset = values.length - days + differenceInUtcDays(this.endDay, lastDay);
        return values.slice(offset);
    };

    TestActivityCalendar.prototype.getMonths = function () {
        var months = eachUtcMonthOfInterval(this.startDay, this.endDay);
        var results = [];
        var startOffset = this.startDay.getUTCDay() - this.firstDayOfWeek;
        if (startOffset < 0) startOffset += 7;
        var gridStart = addUtcDays(this.startDay, -startOffset);

        for (var i = 0; i < months.length; i++) {
            var month = months[i];
            var midpoint = utcDate(month.getUTCFullYear(), month.getUTCMonth(), 16);

            // Only show a month once its midpoint is visible. This keeps the
            // label centered beneath the month and includes the current month
            // as soon as its middle has arrived.
            if (midpoint < this.startDay || midpoint > this.endDay) continue;

            results.push({
                text: formatUtcMonthShort(month),
                column: Math.floor(differenceInUtcDays(midpoint, gridStart) / 7) + 1,
            });
        }
        return results;
    };

    TestActivityCalendar.prototype.getBuckets = function () {
        var filtered = this.data.filter(function (v) { return v !== null && v !== undefined; });
        if (!filtered.length) return [1, 2, 3];

        var sorted = filtered.slice().sort(function (a, b) { return a - b; });
        var trimStart = Math.round(sorted.length * 0.1);
        var trimEnd = sorted.length - Math.round(sorted.length * 0.1);
        var trimmed = sorted.slice(trimStart, trimEnd);
        if (!trimmed.length) trimmed = sorted;

        var sum = trimmed.reduce(function (a, c) { return a + c; }, 0);
        var mid = sum / trimmed.length;
        return [Math.floor(mid / 2), Math.round(mid), Math.round(mid * 1.5)];
    };

    TestActivityCalendar.prototype.getDays = function () {
        var result = [];
        var buckets = this.getBuckets();

        function getValue(v) {
            if (v === undefined) return '0';
            if (v === null || v === 0) return '0';
            for (var b = 0; b < 4; b++) {
                if (v <= buckets[b]) return String(1 + b);
            }
            return '4';
        }

        function makeDay(date, count) {
            var dayLabel = formatUtcDayLabel(date);
            return {
                level: getValue(count),
                label: count
                    ? count + ' ' + (count === 1 ? 'test' : 'tests') + ' on ' + dayLabel
                    : 'no activity on ' + dayLabel,
            };
        }

        var startOffset = this.startDay.getUTCDay() - this.firstDayOfWeek;
        if (startOffset < 0) startOffset += 7;
        for (var i = 0; i < startOffset; i++) {
            var leadingDate = addUtcDays(this.startDay, i - startOffset);
            result.push(makeDay(leadingDate, this.countsByDay[utcDateKey(leadingDate)] || 0));
        }

        var days = differenceInUtcDays(this.endDay, this.startDay);
        var currentDate = new Date(this.startDay.getTime());
        for (var d = 0; d <= days; d++) {
            var count = this.data[d];
            result.push(makeDay(currentDate, count || 0));
            currentDate = addUtcDays(currentDate, 1);
        }

        var endOffset = this.endDay.getUTCDay() - this.firstDayOfWeek;
        for (var j = endOffset; j < 6; j++) {
            var trailingDate = addUtcDays(this.endDay, j - endOffset + 1);
            result.push(makeDay(trailingDate, this.countsByDay[utcDateKey(trailingDate)] || 0));
        }

        return result;
    };

    TestActivityCalendar.prototype.getTotalTests = function () {
        var days = differenceInUtcDays(this.endDay, this.startDay);
        var total = 0;
        for (var i = 0; i <= days; i++) {
            var c = this.data[i];
            if (c) total += c;
        }
        return total;
    };

    function buildCalendar(sessions, mode, signupYear) {
        var firstDayOfWeek = getFirstDayOfWeek();
        var now = utcFromParts(new Date());
        var lastDay = now;
        var fullYear = false;

        if (mode !== 'current' && mode) {
            var year = Number(mode);
            if (isFinite(year)) {
                fullYear = true;
                if (year === now.getUTCFullYear()) {
                    lastDay = now;
                } else {
                    lastDay = endOfUtcYear(utcDate(year, 6, 1));
                }
            }
        }

        var data = buildTestsByDays(sessions, lastDay);
        return new TestActivityCalendar(
            data,
            lastDay,
            firstDayOfWeek,
            fullYear,
            buildTestsByDayMap(sessions)
        );
    }

    function updateMonths(element, months) {
        var el = element.querySelector('.months');
        if (!el) return;
        el.innerHTML = months.map(function (month) {
            return '<div style="grid-column: ' + month.column + '">' + month.text + '</div>';
        }).join('');
    }

    var daysDisplay = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

    function updateLabels(element, firstDayOfWeek) {
        var days = [];
        for (var i = 0; i < 7; i++) {
            days.push(daysDisplay[(firstDayOfWeek + i) % 7]);
        }

        function buildHtml() {
            return days.map(function (it) {
                return '<div><span class="text">' + it.substring(0, 3) + '</span></div>';
            }).join('');
        }

        var daysShort = element.querySelector('.days');
        if (daysShort) daysShort.innerHTML = buildHtml();
    }

    function update(element, calendar) {
        var container = element.querySelector('.activity');
        if (!container) return;

        container.innerHTML = '';

        if (!calendar) {
            updateMonths(element, []);
            var nodata = element.querySelector('.nodata');
            if (nodata) nodata.classList.remove('hidden');
            var title = element.querySelector('.title');
            if (title) title.textContent = '';
            return;
        }

        updateMonths(element, calendar.getMonths());
        var nodataEl = element.querySelector('.nodata');
        if (nodataEl) nodataEl.classList.add('hidden');

        var titleEl = element.querySelector('.title');
        if (titleEl) titleEl.textContent = calendar.getTotalTests() + ' tests';

        var renderedDays = calendar.getDays();
        var weekCount = Math.ceil(renderedDays.length / 7);
        element.style.setProperty('--activity-weeks', weekCount);

        renderedDays.forEach(function (day, index) {
            var elem = document.createElement('div');
            elem.setAttribute('data-level', day.level);
            var column = Math.floor(index / 7);
            if (column < 4) elem.classList.add('tooltip-edge-left');
            if (column >= weekCount - 4) elem.classList.add('tooltip-edge-right');
            if (day.label) {
                elem.setAttribute('aria-label', day.label);
                elem.setAttribute('data-balloon-pos', 'up');
            }
            container.appendChild(elem);
        });
    }

    function initYearSelector(element, selected, signupYear) {
        var picker = element.querySelector('.yearPicker');
        var button = element.querySelector('.yearSelectButton');
        var label = element.querySelector('.yearSelectLabel');
        var menu = element.querySelector('.yearSelectMenu');
        if (!picker || !button || !label || !menu) return;

        if (yearSelectHandler) {
            yearSelectHandler.button.removeEventListener('click', yearSelectHandler.toggle);
            document.removeEventListener('pointerdown', yearSelectHandler.outside);
            document.removeEventListener('keydown', yearSelectHandler.keydown);
        }

        var currentYear = new Date().getUTCFullYear();
        var startYear = Math.min(signupYear || currentYear, currentYear);
        var options = [{ value: 'current', text: 'last 12 months' }];
        for (var year = currentYear; year >= startYear; year--) {
            options.push({ value: String(year), text: String(year) });
        }

        function closeMenu() {
            button.setAttribute('aria-expanded', 'false');
            menu.classList.add('hidden');
        }

        function choose(value, text) {
            selected = value;
            button.dataset.value = value;
            label.textContent = text;
            menu.querySelectorAll('.yearSelectOption').forEach(function (option) {
                option.setAttribute(
                    'aria-selected',
                    option.dataset.value === value ? 'true' : 'false'
                );
            });
            closeMenu();
            update(element, buildCalendar(cachedSessions, value, cachedSignupYear));
        }

        menu.replaceChildren();
        options.forEach(function (optionData) {
            var option = document.createElement('button');
            option.type = 'button';
            option.className = 'yearSelectOption';
            option.dataset.value = optionData.value;
            option.setAttribute('role', 'option');
            option.setAttribute(
                'aria-selected',
                optionData.value === selected ? 'true' : 'false'
            );
            option.textContent = optionData.text;
            option.addEventListener('click', function () {
                choose(optionData.value, optionData.text);
            });
            menu.appendChild(option);
        });

        var selectedOption = options.find(function (option) {
            return option.value === selected;
        }) || options[0];
        button.dataset.value = selectedOption.value;
        label.textContent = selectedOption.text;
        closeMenu();

        var toggle = function () {
            var willOpen = button.getAttribute('aria-expanded') !== 'true';
            button.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
            menu.classList.toggle('hidden', !willOpen);
            if (willOpen) {
                var activeOption = menu.querySelector('[aria-selected="true"]');
                if (activeOption) activeOption.focus();
            }
        };
        var outside = function (event) {
            if (!picker.contains(event.target)) closeMenu();
        };
        var keydown = function (event) {
            if (event.key === 'Escape') {
                closeMenu();
                button.focus();
            }
        };

        button.addEventListener('click', toggle);
        document.addEventListener('pointerdown', outside);
        document.addEventListener('keydown', keydown);
        yearSelectHandler = {
            button: button,
            toggle: toggle,
            outside: outside,
            keydown: keydown,
        };
    }

    function clear(element) {
        if (!element) return;
        element.classList.add('hidden');
        var activity = element.querySelector('.activity');
        if (activity) activity.replaceChildren();
    }

    function init(element, sessions, signupDate) {
        if (!element) return;

        cachedSessions = Array.isArray(sessions)
            ? sessions.filter(function (session) { return session && !session.failed; })
            : [];
        cachedSignupYear = signupDate
            ? new Date(signupDate).getUTCFullYear()
            : (function () {
                var earliest = null;
                cachedSessions.forEach(function (s) {
                    if (!s || !s.created_at) return;
                    var d = new Date(s.created_at);
                    if (!earliest || d < earliest) earliest = d;
                });
                return earliest ? earliest.getUTCFullYear() : new Date().getUTCFullYear();
            })();

        if (!cachedSessions.length) {
            clear(element);
            return;
        }

        element.classList.remove('hidden');

        if (element.querySelector('.yearSelectButton')) {
            initYearSelector(element, 'current', cachedSignupYear);
        }

        var calendar = buildCalendar(cachedSessions, 'current', cachedSignupYear);
        updateLabels(element, calendar.firstDayOfWeek);
        update(element, calendar);
    }

    window.usertypoTestActivity = {
        init: init,
        clear: clear,
        update: update,
        buildCalendar: buildCalendar,
    };
})();
