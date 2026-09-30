/**
 * Custom text test mode — stored text + options, word plans for the typing engine,
 * saved texts (incl. long "book" texts that remember progress) and the editor modal.
 * The home page owns the engine and calls createPlan() on every restart.
 */
(function () {
    'use strict';

    var CONFIG_KEY = 'usertypo_custom_text';
    var SAVED_KEY = 'usertypo_custom_text_saved';
    var DEFAULT_TEXT = 'The quick brown fox jumps over the lazy dog';
    var MODES = ['simple', 'repeat', 'shuffle', 'random'];
    var LIMIT_TYPES = ['words', 'time', 'sections'];
    var DELIMITERS = ['space', 'pipe'];
    var NEWLINES = ['space', 'period'];
    var LIMIT_MAX = { words: 10000, time: 7200, sections: 10000 };
    var MAX_FILE_BYTES = 5 * 1024 * 1024;
    var MAX_GENERATED_WORDS = 1000;
    var NAME_MAX = 40;

    var MODE_HINTS = {
        simple: 'Type the text once, in order.',
        repeat: 'Loop the text in order until the limit is reached.',
        shuffle: 'Type every word once, in a random order.',
        random: 'Pick random words (or sections) until the limit is reached.'
    };

    var LETTER_PRESETS = {
        home: 'asdfghjkl',
        top: 'qwertyuiop',
        bottom: 'zxcvbnm',
        left: 'qwertasdfgzxcvb',
        right: 'yuiophjklnm'
    };
    var UNIT_PRESETS = {
        letters: 'abcdefghijklmnopqrstuvwxyz',
        home: 'asdfghjkl;',
        numbers: '0123456789',
        symbols: '!@#$%^&*()-_=+[]{};:\'",.<>/?`~\\|',
        bigrams: 'th he in er an re on at en nd ti es or te of ed is it al ar st to nt ng'
    };

    // ── Storage ──────────────────────────────────────────────────────────

    function readJson(key, fallback) {
        try {
            var raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : fallback;
        } catch (e) {
            return fallback;
        }
    }

    function writeJson(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (e) {
            return false;
        }
    }

    function defaults() {
        return {
            text: DEFAULT_TEXT,
            mode: 'simple',
            limitType: 'words',
            limitValue: null,
            delimiter: 'space',
            newlines: 'space',
            book: null
        };
    }

    function pick(value, allowed, fallback) {
        return allowed.indexOf(value) >= 0 ? value : fallback;
    }

    function clampLimit(type, value) {
        var n = parseInt(value, 10);
        if (!isFinite(n) || n <= 0) return null;
        return Math.min(n, LIMIT_MAX[type] || LIMIT_MAX.words);
    }

    function normalizeConfig(raw) {
        var d = defaults();
        var c = raw && typeof raw === 'object' ? raw : {};
        var out = {
            text: typeof c.text === 'string' ? c.text : d.text,
            mode: pick(c.mode, MODES, d.mode),
            limitType: pick(c.limitType, LIMIT_TYPES, d.limitType),
            limitValue: null,
            delimiter: pick(c.delimiter, DELIMITERS, d.delimiter),
            newlines: pick(c.newlines, NEWLINES, d.newlines),
            book: typeof c.book === 'string' && c.book ? c.book : null
        };
        if (out.limitType === 'sections' && out.delimiter !== 'pipe') out.limitType = 'words';
        out.limitValue = clampLimit(out.limitType, c.limitValue);
        return out;
    }

    function hasConfig() {
        try {
            return !!localStorage.getItem(CONFIG_KEY);
        } catch (e) {
            return false;
        }
    }

    function listSaved() {
        var list = readJson(SAVED_KEY, []);
        if (!Array.isArray(list)) return [];
        return list.filter(function (entry) {
            return entry && typeof entry.name === 'string' && typeof entry.text === 'string';
        });
    }

    function writeSaved(list) {
        return writeJson(SAVED_KEY, list);
    }

    function getSaved(name) {
        var list = listSaved();
        for (var i = 0; i < list.length; i++) {
            if (list[i].name === name) return list[i];
        }
        return null;
    }

    function getBookEntry(cfg) {
        if (!cfg || !cfg.book) return null;
        var entry = getSaved(cfg.book);
        return entry && entry.long ? entry : null;
    }

    function getConfig() {
        var cfg = normalizeConfig(readJson(CONFIG_KEY, null));
        var book = getBookEntry(cfg);
        if (cfg.book && !book) cfg.book = null;
        if (book) {
            cfg.text = book.text;
            cfg.mode = 'simple';
        }
        return cfg;
    }

    function setConfig(cfg) {
        var next = normalizeConfig(cfg);
        // Long texts live in the saved list; don't duplicate megabytes in the config.
        if (getBookEntry(next)) next.text = '';
        return writeJson(CONFIG_KEY, next);
    }

    function saveText(name, text, long) {
        var list = listSaved();
        var now = Date.now();
        var entry = { name: name, text: text, long: !!long, progress: 0, updatedAt: now };
        var replaced = false;
        for (var i = 0; i < list.length; i++) {
            if (list[i].name === name) {
                list[i] = entry;
                replaced = true;
                break;
            }
        }
        if (!replaced) list.push(entry);
        return writeSaved(list);
    }

    function removeSaved(name) {
        writeSaved(listSaved().filter(function (entry) { return entry.name !== name; }));
        var raw = readJson(CONFIG_KEY, null);
        if (raw && raw.book === name) {
            raw.book = null;
            raw.text = DEFAULT_TEXT;
            writeJson(CONFIG_KEY, raw);
        }
    }

    function setProgress(name, progress) {
        var list = listSaved();
        for (var i = 0; i < list.length; i++) {
            if (list[i].name === name) {
                list[i].progress = Math.max(0, progress | 0);
                list[i].updatedAt = Date.now();
                writeSaved(list);
                return true;
            }
        }
        return false;
    }

    // ── Parsing + plans ──────────────────────────────────────────────────

    function applyNewlines(text, newlines) {
        var t = String(text || '').replace(/\r\n?/g, '\n').replace(/\t/g, ' ');
        if (newlines === 'period') {
            return t.split('\n').map(function (line) {
                var trimmed = line.trim();
                if (!trimmed) return '';
                return /[.!?;:,]$/.test(trimmed) ? trimmed : trimmed + '.';
            }).filter(Boolean).join(' ');
        }
        return t.replace(/\n/g, ' ');
    }

    function splitWords(text) {
        return text.split(/\s+/).filter(Boolean);
    }

    /** Sections are arrays of words; with the space delimiter every word is its own section. */
    function parseSections(cfg, text) {
        var flat = applyNewlines(text, cfg.newlines);
        if (cfg.delimiter === 'pipe') {
            return flat.split('|').map(splitWords).filter(function (s) { return s.length > 0; });
        }
        return splitWords(flat).map(function (w) { return [w]; });
    }

    function countWords(cfg, text) {
        return parseSections(cfg, text).reduce(function (n, s) { return n + s.length; }, 0);
    }

    function shuffleInPlace(arr) {
        for (var i = arr.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var tmp = arr[i];
            arr[i] = arr[j];
            arr[j] = tmp;
        }
        return arr;
    }

    function flatten(sections) {
        var out = [];
        for (var i = 0; i < sections.length; i++) {
            for (var k = 0; k < sections[i].length; k++) out.push(sections[i][k]);
        }
        return out;
    }

    /**
     * Returns { mode: 'words'|'time', amount, infinite, wordAt(i), textMode, config, book }.
     * amount is the word count (words mode) or seconds (time mode).
     */
    function createPlan() {
        var cfg = getConfig();
        var book = getBookEntry(cfg);
        var sections = parseSections(cfg, cfg.text);
        if (!sections.length) sections = parseSections(defaults(), DEFAULT_TEXT);
        var textMode = book ? 'simple' : cfg.mode;
        var plan = { mode: 'words', amount: 0, infinite: false, textMode: textMode, config: cfg, book: null };

        if (textMode === 'simple' || textMode === 'shuffle') {
            var words;
            if (textMode === 'shuffle') {
                words = shuffleInPlace(flatten(sections));
            } else {
                words = flatten(sections);
            }
            if (book) {
                var total = words.length;
                var offset = Math.min(Math.max(0, book.progress | 0), Math.max(0, total - 1));
                words = words.slice(offset);
                plan.book = { name: book.name, offset: offset, total: total };
            }
            plan.amount = words.length;
            plan.wordAt = function (i) { return words[i]; };
            return plan;
        }

        var stream = [];
        var cursor = 0;
        var last = -1;
        function pushSection() {
            var index;
            if (textMode === 'repeat') {
                index = cursor % sections.length;
                cursor++;
            } else {
                index = Math.floor(Math.random() * sections.length);
                if (sections.length > 1 && index === last) {
                    index = (last + 1 + Math.floor(Math.random() * (sections.length - 1))) % sections.length;
                }
                last = index;
            }
            var s = sections[index];
            for (var k = 0; k < s.length; k++) stream.push(s[k]);
        }
        plan.wordAt = function (i) {
            while (stream.length <= i) pushSection();
            return stream[i];
        };

        var limit = cfg.limitValue;
        if (!limit) {
            plan.infinite = true;
            plan.amount = Infinity;
        } else if (cfg.limitType === 'time') {
            plan.mode = 'time';
            plan.amount = limit;
        } else if (cfg.limitType === 'sections') {
            for (var n = 0; n < limit; n++) pushSection();
            plan.amount = stream.length;
        } else {
            plan.amount = limit;
        }
        return plan;
    }

    function bookPercent(progress, total) {
        if (!total) return 0;
        return Math.min(100, Math.floor((progress / total) * 100));
    }

    /** Stats-screen label, e.g. "custom text repeat 60s" or "custom text · my book 42%". */
    function describe(plan) {
        if (!plan) return 'custom text';
        if (plan.book) {
            var entry = getSaved(plan.book.name);
            var progress = entry ? entry.progress | 0 : 0;
            return 'custom text ' + plan.book.name + ' ' + bookPercent(progress, plan.book.total) + '%';
        }
        var parts = ['custom text', plan.textMode];
        if (plan.infinite) parts.push('no limit');
        else if (plan.mode === 'time') parts.push(plan.amount + 's');
        else parts.push(plan.amount + (plan.amount === 1 ? ' word' : ' words'));
        return parts.join(' ');
    }

    /** Saves how far into a long text the user got. Returns { finished, progress, total } or null. */
    function recordBookProgress(plan, completedWords) {
        if (!plan || !plan.book) return null;
        var done = Math.max(0, Math.min(plan.amount, completedWords | 0));
        if (done <= 0) return null;
        var next = plan.book.offset + done;
        var finished = next >= plan.book.total;
        setProgress(plan.book.name, finished ? 0 : next);
        if (finished) toast('You finished "' + plan.book.name + '". Progress reset to the start.', 'menu_book');
        return { finished: finished, progress: finished ? 0 : next, total: plan.book.total };
    }

    // ── Text tools ───────────────────────────────────────────────────────

    var FANCY_REPLACEMENTS = [
        [/[\u201C\u201D\u201E\u201F\u2033\u00AB\u00BB]/g, '"'],
        [/[\u2018\u2019\u201A\u201B\u2032\u2039\u203A]/g, "'"],
        [/[\u2012\u2013\u2014\u2015\u2212]/g, '-'],
        [/\u2026/g, '...'],
        [/[\u00A0\u2007\u202F]/g, ' ']
    ];

    var TEXT_TOOLS = {
        fancy: function (text) {
            var count = 0;
            FANCY_REPLACEMENTS.forEach(function (pair) {
                text = text.replace(pair[0], function () {
                    count++;
                    return pair[1];
                });
            });
            return { text: text, count: count, label: 'fancy typography' };
        },
        zerowidth: function (text) {
            var count = 0;
            text = text.replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, function () {
                count++;
                return '';
            });
            return { text: text, count: count, label: 'zero-width characters' };
        },
        escapes: function (text) {
            var count = 0;
            text = text.replace(/\\([nt])/g, function (m, ch) {
                count++;
                return ch === 'n' ? '\n' : '\t';
            });
            return { text: text, count: count, label: 'escaped line breaks / tabs' };
        }
    };

    // ── Generators ───────────────────────────────────────────────────────

    function getWordList() {
        try {
            // eslint-disable-next-line no-undef
            if (typeof wordList !== 'undefined' && Array.isArray(wordList)) return wordList;
        } catch (e) { /* ignore */ }
        return [];
    }

    function letterSet(value) {
        var set = {};
        String(value || '').toLowerCase().replace(/\s+/g, '').split('').forEach(function (ch) { set[ch] = true; });
        return set;
    }

    function filterWords(opts) {
        var include = letterSet(opts.include);
        var exclude = letterSet(opts.exclude);
        var includeKeys = Object.keys(include);
        var excludeKeys = Object.keys(exclude);
        var min = Math.max(1, parseInt(opts.min, 10) || 1);
        var max = parseInt(opts.max, 10) || Infinity;
        var seen = {};
        var out = [];
        getWordList().forEach(function (raw) {
            var word = String(raw || '').trim();
            if (!word || /\s/.test(word)) return;
            var lower = word.toLowerCase();
            if (seen[lower]) return;
            if (word.length < min || word.length > max) return;
            var chars = lower.split('');
            if (excludeKeys.length && chars.some(function (ch) { return exclude[ch]; })) return;
            if (includeKeys.length) {
                if (opts.only) {
                    if (!chars.every(function (ch) { return include[ch]; })) return;
                } else if (!chars.some(function (ch) { return include[ch]; })) {
                    return;
                }
            }
            seen[lower] = true;
            out.push(word);
        });
        return out;
    }

    function generateWords(opts) {
        var source = String(opts.units || '');
        var units = /\s/.test(source.trim())
            ? source.split(/\s+/).filter(Boolean)
            : Array.from(source.replace(/\s+/g, ''));
        units = units.filter(function (u, i) { return units.indexOf(u) === i; });
        if (!units.length) return [];
        var min = Math.max(1, parseInt(opts.min, 10) || 1);
        var max = Math.max(min, parseInt(opts.max, 10) || min);
        var count = Math.max(1, Math.min(MAX_GENERATED_WORDS, parseInt(opts.count, 10) || 1));
        var out = [];
        for (var i = 0; i < count; i++) {
            var len = min + Math.floor(Math.random() * (max - min + 1));
            var word = '';
            for (var k = 0; k < len; k++) word += units[Math.floor(Math.random() * units.length)];
            out.push(word);
        }
        return out;
    }

    // ── Modal ────────────────────────────────────────────────────────────

    var modal = null;
    var box = null;
    var draft = null;
    var currentView = 'main';
    var lastFocus = null;
    var pendingDelete = null;
    var pendingDeleteTimer = 0;
    var filterResult = [];
    var handlers = { onApply: null, onClose: null };

    function toast(message, icon) {
        if (window.usertypoNotifications && typeof window.usertypoNotifications.showToast === 'function') {
            window.usertypoNotifications.showToast(message, icon || 'edit_note');
        }
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function seg(name, options) {
        return '<div class="ct-seg" data-ct-seg="' + name + '" role="radiogroup">' +
            options.map(function (o) {
                return '<button type="button" role="radio" data-value="' + o[0] + '">' + o[1] + '</button>';
            }).join('') +
            '</div>';
    }

    function buildMarkup() {
        return [
            '<div id="custom-text-box" class="glass-panel font-mono" data-view="main">',
            '  <div class="ct-head">',
            '    <button type="button" class="ct-icon-btn ct-back" data-ct-back aria-label="Back"><span class="material-symbols-outlined">arrow_back</span></button>',
            '    <div class="ct-title"><span class="material-symbols-outlined">edit_note</span><span id="custom-text-title">Custom Text</span></div>',
            '    <button type="button" class="ct-icon-btn" data-ct-close aria-label="Close"><span class="material-symbols-outlined">close</span></button>',
            '  </div>',
            '  <div class="ct-views">',

            // Main
            '    <section class="ct-view is-active" data-view="main">',
            '      <div class="ct-main">',
            '        <div class="ct-editor">',
            '          <div class="ct-book-banner" data-ct-book-banner>',
            '            <span class="material-symbols-outlined">menu_book</span>',
            '            <span class="ct-book-name" data-ct-book-name></span>',
            '            <span class="ct-book-progress" data-ct-book-progress></span>',
            '            <button type="button" class="ct-chip-btn" data-ct-book-stop>stop reading</button>',
            '          </div>',
            '          <textarea class="ct-field ct-textarea" data-ct-text spellcheck="false" autocomplete="off" placeholder="Type or paste the text you want to practise…"></textarea>',
            '          <div class="ct-editor-foot">',
            '            <span class="ct-count" data-ct-count></span>',
            '            <div class="ct-actions">',
            '              <button type="button" class="ct-chip-btn" data-ct-view="save" data-ct-save-open><span class="material-symbols-outlined">bookmark_add</span>save</button>',
            '              <button type="button" class="ct-chip-btn" data-ct-view="saved"><span class="material-symbols-outlined">folder_open</span>saved <span class="ct-chip-count" data-ct-saved-count>0</span></button>',
            '              <button type="button" class="ct-chip-btn" data-ct-file-open><span class="material-symbols-outlined">upload_file</span>open file</button>',
            '            </div>',
            '          </div>',
            '        </div>',
            '        <div class="ct-options">',
            '          <div class="ct-row">',
            '            <div class="ct-label">mode <span class="ct-hint" data-ct-mode-hint></span></div>',
            '            ' + seg('mode', [['simple', 'simple'], ['repeat', 'repeat'], ['shuffle', 'shuffle'], ['random', 'random']]),
            '          </div>',
            '          <div class="ct-row" data-ct-limit-row>',
            '            <div class="ct-label">limit <span class="ct-hint">leave empty for no limit (shift + enter to finish)</span></div>',
            '            <div class="ct-limit">',
            '              ' + seg('limitType', [['words', 'words'], ['time', 'time'], ['sections', 'sections']]),
            '              <input type="number" min="1" inputmode="numeric" class="ct-field ct-input" data-ct-limit placeholder="no limit" aria-label="Limit" />',
            '            </div>',
            '          </div>',
            '          <div class="ct-row">',
            '            <div class="ct-label">split by <span class="ct-hint">pipe ( | ) splits the text into sections</span></div>',
            '            ' + seg('delimiter', [['space', 'spaces'], ['pipe', 'pipes']]),
            '          </div>',
            '          <div class="ct-row">',
            '            <div class="ct-label">line breaks become</div>',
            '            ' + seg('newlines', [['space', 'a space'], ['period', 'a period + space']]),
            '          </div>',
            '          <div class="ct-row">',
            '            <div class="ct-label">clean up</div>',
            '            <div class="ct-tools">',
            '              <button type="button" class="ct-chip-btn" data-ct-tool="fancy"><span class="material-symbols-outlined">auto_fix_high</span>fancy typography</button>',
            '              <button type="button" class="ct-chip-btn" data-ct-tool="zerowidth"><span class="material-symbols-outlined">auto_fix_high</span>zero-width chars</button>',
            '              <button type="button" class="ct-chip-btn" data-ct-tool="escapes"><span class="material-symbols-outlined">auto_fix_high</span>\\n and \\t</button>',
            '            </div>',
            '          </div>',
            '          <div class="ct-row">',
            '            <div class="ct-label">generate</div>',
            '            <div class="ct-tools">',
            '              <button type="button" class="ct-chip-btn" data-ct-view="filter" data-ct-needs-edit><span class="material-symbols-outlined">filter_alt</span>words filter</button>',
            '              <button type="button" class="ct-chip-btn" data-ct-view="generator" data-ct-needs-edit><span class="material-symbols-outlined">casino</span>random generator</button>',
            '            </div>',
            '          </div>',
            '        </div>',
            '      </div>',
            '    </section>',

            // Save
            '    <section class="ct-view" data-view="save">',
            '      <div class="ct-sub">',
            '        <p class="ct-sub-desc">Saved texts stay in this browser. Saving with a name that already exists replaces that text.</p>',
            '        <div class="ct-row">',
            '          <div class="ct-label">name</div>',
            '          <input type="text" class="ct-field ct-input" data-ct-save-name maxlength="' + NAME_MAX + '" placeholder="e.g. my notes" autocomplete="off" spellcheck="false" />',
            '        </div>',
            '        <label class="ct-toggle-row" data-ct-long-toggle>',
            '          <span class="ct-toggle-text">long text<span>Remembers where you stopped so you can keep reading it test by test, like a book. Long texts always play in simple mode.</span></span>',
            '          <span class="toggle-track" data-ct-long-track><span class="toggle-thumb"></span></span>',
            '        </label>',
            '        <div class="ct-sub-actions">',
            '          <button type="button" class="px-4 py-2 rounded-lg bg-primary text-background-dark font-black uppercase tracking-widest hover:brightness-110 transition-all shadow-[0_0_10px_rgba(0,208,255,0.3)] text-xs" data-ct-save>Save</button>',
            '        </div>',
            '      </div>',
            '    </section>',

            // Saved list
            '    <section class="ct-view" data-view="saved">',
            '      <div class="ct-sub">',
            '        <div class="ct-saved-list" data-ct-saved-list></div>',
            '      </div>',
            '    </section>',

            // Words filter
            '    <section class="ct-view" data-view="filter">',
            '      <div class="ct-sub">',
            '        <p class="ct-sub-desc">Pick words from the current language list that match these rules.</p>',
            '        <div class="ct-grid-2">',
            '          <div class="ct-row"><div class="ct-label">min length</div><input type="number" min="1" class="ct-field ct-input" data-ct-filter="min" placeholder="any" /></div>',
            '          <div class="ct-row"><div class="ct-label">max length</div><input type="number" min="1" class="ct-field ct-input" data-ct-filter="max" placeholder="any" /></div>',
            '        </div>',
            '        <div class="ct-row">',
            '          <div class="ct-label">include letters <span class="ct-hint">words containing any of these</span></div>',
            '          <input type="text" class="ct-field ct-input" data-ct-filter="include" placeholder="e.g. qz" autocomplete="off" spellcheck="false" />',
            '          <div class="ct-tools">',
            '            <button type="button" class="ct-chip-btn" data-ct-letters="home">home row</button>',
            '            <button type="button" class="ct-chip-btn" data-ct-letters="top">top row</button>',
            '            <button type="button" class="ct-chip-btn" data-ct-letters="bottom">bottom row</button>',
            '            <button type="button" class="ct-chip-btn" data-ct-letters="left">left hand</button>',
            '            <button type="button" class="ct-chip-btn" data-ct-letters="right">right hand</button>',
            '          </div>',
            '        </div>',
            '        <label class="ct-toggle-row" data-ct-only-toggle>',
            '          <span class="ct-toggle-text">only these letters<span>Words must be made entirely of the included letters.</span></span>',
            '          <span class="toggle-track" data-ct-only-track><span class="toggle-thumb"></span></span>',
            '        </label>',
            '        <div class="ct-row">',
            '          <div class="ct-label">exclude letters</div>',
            '          <input type="text" class="ct-field ct-input" data-ct-filter="exclude" placeholder="e.g. xj" autocomplete="off" spellcheck="false" />',
            '        </div>',
            '        <div class="ct-sub-actions">',
            '          <span class="ct-result" data-ct-filter-result></span>',
            '          <button type="button" class="ct-chip-btn" data-ct-filter-apply="add">add to text</button>',
            '          <button type="button" class="ct-chip-btn is-active" data-ct-filter-apply="set">replace text</button>',
            '        </div>',
            '      </div>',
            '    </section>',

            // Generator
            '    <section class="ct-view" data-view="generator">',
            '      <div class="ct-sub">',
            '        <p class="ct-sub-desc">Build random words out of the characters below. Separate with spaces to use whole chunks (like bigrams) instead of single characters.</p>',
            '        <div class="ct-row">',
            '          <div class="ct-label">characters</div>',
            '          <input type="text" class="ct-field ct-input" data-ct-gen="units" placeholder="e.g. asdfjkl;" autocomplete="off" spellcheck="false" />',
            '          <div class="ct-tools">',
            '            <button type="button" class="ct-chip-btn" data-ct-units="letters">alphabet</button>',
            '            <button type="button" class="ct-chip-btn" data-ct-units="home">home row</button>',
            '            <button type="button" class="ct-chip-btn" data-ct-units="numbers">numbers</button>',
            '            <button type="button" class="ct-chip-btn" data-ct-units="symbols">symbols</button>',
            '            <button type="button" class="ct-chip-btn" data-ct-units="bigrams">bigrams</button>',
            '          </div>',
            '        </div>',
            '        <div class="ct-grid-2">',
            '          <div class="ct-row"><div class="ct-label">min length</div><input type="number" min="1" class="ct-field ct-input" data-ct-gen="min" value="2" /></div>',
            '          <div class="ct-row"><div class="ct-label">max length</div><input type="number" min="1" class="ct-field ct-input" data-ct-gen="max" value="5" /></div>',
            '        </div>',
            '        <div class="ct-row">',
            '          <div class="ct-label">word count <span class="ct-hint">up to ' + MAX_GENERATED_WORDS + '</span></div>',
            '          <input type="number" min="1" max="' + MAX_GENERATED_WORDS + '" class="ct-field ct-input" data-ct-gen="count" value="100" />',
            '        </div>',
            '        <div class="ct-sub-actions">',
            '          <button type="button" class="ct-chip-btn" data-ct-gen-apply="add">add to text</button>',
            '          <button type="button" class="ct-chip-btn is-active" data-ct-gen-apply="set">replace text</button>',
            '        </div>',
            '      </div>',
            '    </section>',

            '  </div>',
            '  <div class="ct-foot">',
            '    <span class="ct-foot-note" data-ct-note></span>',
            '    <button type="button" class="px-4 py-2 rounded-lg text-slate-400 hover:text-white transition-colors uppercase font-bold tracking-widest" data-ct-close>Cancel</button>',
            '    <button type="button" class="px-4 py-2 rounded-lg bg-primary text-background-dark font-black uppercase tracking-widest hover:brightness-110 transition-all shadow-[0_0_10px_rgba(0,208,255,0.3)]" data-ct-apply>Apply</button>',
            '  </div>',
            '  <input type="file" accept=".txt,text/plain" data-ct-file hidden />',
            '</div>'
        ].join('\n');
    }

    function q(selector) {
        return box ? box.querySelector(selector) : null;
    }

    function ensureModal() {
        if (modal) return;
        modal = document.createElement('div');
        modal.id = 'custom-text-modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-hidden', 'true');
        modal.setAttribute('aria-labelledby', 'custom-text-title');
        modal.innerHTML = buildMarkup();
        document.body.appendChild(modal);
        box = modal.querySelector('#custom-text-box');
        wireEvents();
    }

    function draftText() {
        var book = getBookEntry(draft);
        return book ? book.text : draft.text;
    }

    function setNote(message, isError) {
        var note = q('[data-ct-note]');
        if (!note) return;
        note.textContent = message;
        note.classList.toggle('is-error', !!isError);
    }

    function defaultNote() {
        setNote('Custom text tests are for practice only. They are not saved to your stats or the leaderboards.', false);
    }

    function updateCounts() {
        var text = draftText();
        var words = countWords(draft, text);
        var sections = draft.delimiter === 'pipe' ? parseSections(draft, text).length : 0;
        var parts = ['<b>' + words.toLocaleString() + '</b> ' + (words === 1 ? 'word' : 'words')];
        if (draft.delimiter === 'pipe') parts.push('<b>' + sections.toLocaleString() + '</b> ' + (sections === 1 ? 'section' : 'sections'));
        parts.push('<b>' + text.length.toLocaleString() + '</b> chars');
        q('[data-ct-count]').innerHTML = parts.join(' · ');
    }

    function renderSeg(name) {
        var group = q('[data-ct-seg="' + name + '"]');
        if (!group) return;
        group.querySelectorAll('button').forEach(function (btn) {
            var active = btn.getAttribute('data-value') === draft[name];
            btn.classList.toggle('is-active', active);
            btn.setAttribute('aria-checked', active ? 'true' : 'false');
        });
    }

    function renderMain() {
        var book = getBookEntry(draft);
        var textarea = q('[data-ct-text]');
        var text = draftText();
        if (textarea.value !== text) textarea.value = text;
        textarea.readOnly = !!book;

        if (book) draft.mode = 'simple';
        if (draft.limitType === 'sections' && draft.delimiter !== 'pipe') draft.limitType = 'words';

        ['mode', 'limitType', 'delimiter', 'newlines'].forEach(renderSeg);
        q('[data-ct-seg="mode"]').classList.toggle('is-locked', !!book);
        var sectionsBtn = q('[data-ct-seg="limitType"] button[data-value="sections"]');
        sectionsBtn.disabled = draft.delimiter !== 'pipe';
        sectionsBtn.title = draft.delimiter !== 'pipe' ? 'Split by pipes to limit by sections' : '';

        var limitRow = q('[data-ct-limit-row]');
        limitRow.hidden = !(draft.mode === 'repeat' || draft.mode === 'random');
        var limitInput = q('[data-ct-limit]');
        var limitValue = draft.limitValue ? String(draft.limitValue) : '';
        if (document.activeElement !== limitInput && limitInput.value !== limitValue) limitInput.value = limitValue;
        limitInput.placeholder = draft.limitType === 'time' ? 'seconds' : 'no limit';

        q('[data-ct-mode-hint]').textContent = book ? 'long texts always play in order' : MODE_HINTS[draft.mode];

        var banner = q('[data-ct-book-banner]');
        banner.classList.toggle('is-visible', !!book);
        if (book) {
            var total = countWords(draft, book.text);
            q('[data-ct-book-name]').textContent = book.name;
            q('[data-ct-book-progress]').textContent = bookPercent(book.progress | 0, total) + '% read';
        }

        box.querySelectorAll('[data-ct-tool], [data-ct-needs-edit], [data-ct-save-open]').forEach(function (btn) {
            btn.disabled = !!book;
        });
        q('[data-ct-saved-count]').textContent = String(listSaved().length);
        updateCounts();
    }

    function renderSaved() {
        var listEl = q('[data-ct-saved-list]');
        var list = listSaved().slice().sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
        if (!list.length) {
            listEl.innerHTML = '<div class="ct-saved-empty">No saved texts yet. Use save on the editor to keep a text for later.</div>';
            return;
        }
        listEl.innerHTML = list.map(function (entry) {
            var name = escapeHtml(entry.name);
            var words = countWords(draft, entry.text);
            var meta = words.toLocaleString() + (words === 1 ? ' word' : ' words');
            var bar = '';
            if (entry.long) {
                var pct = bookPercent(entry.progress | 0, words);
                meta += ' · long text · <span class="ct-progress">' + pct + '% read</span>';
                bar = '<div class="ct-saved-bar"><span style="width:' + pct + '%"></span></div>';
            }
            var isCurrent = draft.book === entry.name;
            var deleting = pendingDelete === entry.name;
            return '<div class="ct-saved-item' + (entry.long ? ' is-book' : '') + (isCurrent ? ' is-current' : '') + '" tabindex="0" data-ct-load="' + name + '">' +
                '<span class="material-symbols-outlined">' + (entry.long ? 'menu_book' : 'edit_note') + '</span>' +
                '<div class="ct-saved-info"><span class="ct-saved-name">' + name + '</span><span class="ct-saved-meta">' + meta + '</span>' + bar + '</div>' +
                (entry.long && (entry.progress | 0) > 0
                    ? '<button type="button" class="ct-icon-btn" data-ct-reset="' + name + '" title="Start from the beginning" aria-label="Reset progress"><span class="material-symbols-outlined">restart_alt</span></button>'
                    : '') +
                '<button type="button" class="ct-icon-btn' + (deleting ? ' is-danger' : '') + '" data-ct-delete="' + name + '" title="' + (deleting ? 'Click again to delete' : 'Delete') + '" aria-label="Delete">' +
                '<span class="material-symbols-outlined">' + (deleting ? 'check' : 'delete') + '</span></button>' +
                '</div>';
        }).join('');
    }

    function renderFilterResult() {
        var opts = {
            min: q('[data-ct-filter="min"]').value,
            max: q('[data-ct-filter="max"]').value,
            include: q('[data-ct-filter="include"]').value,
            exclude: q('[data-ct-filter="exclude"]').value,
            only: q('[data-ct-only-track]').classList.contains('on')
        };
        filterResult = filterWords(opts);
        var total = getWordList().length;
        q('[data-ct-filter-result]').innerHTML = total
            ? '<b>' + filterResult.length.toLocaleString() + '</b> of ' + total.toLocaleString() + ' words match'
            : 'Word list is still loading…';
        box.querySelectorAll('[data-ct-filter-apply]').forEach(function (btn) {
            btn.disabled = filterResult.length === 0;
        });
    }

    var VIEW_TITLES = {
        main: 'Custom Text',
        save: 'Save Text',
        saved: 'Saved Texts',
        filter: 'Words Filter',
        generator: 'Random Generator'
    };

    function showView(name) {
        currentView = VIEW_TITLES[name] ? name : 'main';
        box.setAttribute('data-view', currentView);
        box.querySelectorAll('.ct-view').forEach(function (view) {
            view.classList.toggle('is-active', view.getAttribute('data-view') === currentView);
        });
        q('#custom-text-title').textContent = VIEW_TITLES[currentView];
        clearPendingDelete();

        if (currentView === 'main') {
            renderMain();
        } else if (currentView === 'save') {
            var nameInput = q('[data-ct-save-name]');
            nameInput.value = '';
            q('[data-ct-long-track]').classList.toggle('on', countWords(draft, draftText()) > 1000);
            setTimeout(function () { nameInput.focus(); }, 30);
        } else if (currentView === 'saved') {
            renderSaved();
        } else if (currentView === 'filter') {
            renderFilterResult();
        }
        var views = q('.ct-views');
        if (views) views.scrollTop = 0;
    }

    function clearPendingDelete() {
        pendingDelete = null;
        if (pendingDeleteTimer) clearTimeout(pendingDeleteTimer);
        pendingDeleteTimer = 0;
    }

    function shake() {
        box.classList.remove('ct-shake');
        void box.offsetWidth;
        box.classList.add('ct-shake');
    }

    function setDraftText(text) {
        draft.text = text;
        draft.book = null;
        renderMain();
    }

    function insertWords(words, how) {
        if (!words.length) return;
        var joined = words.join(' ');
        var current = draftText().trim();
        setDraftText(how === 'add' && current ? current + ' ' + joined : joined);
        showView('main');
        toast((how === 'add' ? 'Added ' : 'Replaced text with ') + words.length.toLocaleString() + (words.length === 1 ? ' word' : ' words'), 'edit_note');
    }

    function apply() {
        if (!draft) return;
        var sections = parseSections(draft, draftText());
        if (!sections.length) {
            setNote('Add some text first.', true);
            shake();
            q('[data-ct-text]').focus();
            return;
        }
        draft.limitValue = clampLimit(draft.limitType, draft.limitValue);
        if (!setConfig(draft)) {
            setNote('This text is too large to store in the browser.', true);
            shake();
            return;
        }
        close({ applied: true });
        if (typeof handlers.onApply === 'function') handlers.onApply(getConfig());
    }

    function saveCurrent() {
        var nameInput = q('[data-ct-save-name]');
        var name = nameInput.value.trim().slice(0, NAME_MAX);
        if (!name) {
            nameInput.focus();
            shake();
            return;
        }
        var text = draftText();
        if (!parseSections(draft, text).length) {
            toast('There is no text to save.', 'error');
            showView('main');
            return;
        }
        var long = q('[data-ct-long-track]').classList.contains('on');
        var existed = !!getSaved(name);
        if (!saveText(name, text, long)) {
            toast('Not enough browser storage to save this text.', 'error');
            return;
        }
        if (long) {
            draft.book = name;
            draft.mode = 'simple';
        }
        toast((existed ? 'Updated "' : 'Saved "') + name + '"', 'bookmark_add');
        showView('main');
    }

    function loadSaved(name) {
        var entry = getSaved(name);
        if (!entry) return;
        if (entry.long) {
            draft.book = entry.name;
            draft.mode = 'simple';
        } else {
            draft.book = null;
            draft.text = entry.text;
        }
        showView('main');
    }

    function readFile(file) {
        if (!file) return;
        if (file.size > MAX_FILE_BYTES) {
            toast('That file is too large (max 5 MB).', 'error');
            return;
        }
        var reader = new FileReader();
        reader.onload = function () {
            var text = String(reader.result || '');
            if (!text.trim()) {
                toast('That file is empty.', 'error');
                return;
            }
            setDraftText(text);
            toast('Loaded ' + file.name, 'upload_file');
        };
        reader.onerror = function () {
            toast('Could not read that file.', 'error');
        };
        reader.readAsText(file);
    }

    function onBoxClick(e) {
        var target = e.target.closest('button, [data-ct-load], label');
        if (!target || !box.contains(target)) return;

        if (target.matches('.ct-seg button')) {
            if (target.disabled) return;
            var group = target.closest('[data-ct-seg]').getAttribute('data-ct-seg');
            var value = target.getAttribute('data-value');
            if (draft[group] === value) return;
            draft[group] = value;
            if (group === 'limitType') draft.limitValue = clampLimit(value, draft.limitValue);
            renderMain();
            return;
        }
        if (target.hasAttribute('data-ct-close')) return close();
        if (target.hasAttribute('data-ct-back')) return showView('main');
        if (target.hasAttribute('data-ct-apply')) return apply();
        if (target.hasAttribute('data-ct-view')) {
            if (!target.disabled) showView(target.getAttribute('data-ct-view'));
            return;
        }
        if (target.hasAttribute('data-ct-file-open')) {
            q('[data-ct-file]').click();
            return;
        }
        if (target.hasAttribute('data-ct-book-stop')) {
            var book = getBookEntry(draft);
            draft.book = null;
            if (book) draft.text = book.text;
            renderMain();
            return;
        }
        if (target.hasAttribute('data-ct-tool')) {
            if (target.disabled) return;
            var tool = TEXT_TOOLS[target.getAttribute('data-ct-tool')];
            var result = tool(draftText());
            if (result.count > 0) setDraftText(result.text);
            toast(result.count > 0
                ? 'Replaced ' + result.count.toLocaleString() + ' ' + result.label
                : 'No ' + result.label + ' found', 'auto_fix_high');
            return;
        }
        if (target.hasAttribute('data-ct-save')) return saveCurrent();
        if (target.hasAttribute('data-ct-long-toggle') || target.hasAttribute('data-ct-only-toggle')) {
            e.preventDefault();
            var track = target.querySelector('.toggle-track');
            track.classList.toggle('on');
            if (target.hasAttribute('data-ct-only-toggle')) renderFilterResult();
            return;
        }
        if (target.hasAttribute('data-ct-reset')) {
            e.stopPropagation();
            setProgress(target.getAttribute('data-ct-reset'), 0);
            renderSaved();
            toast('Progress reset', 'restart_alt');
            return;
        }
        if (target.hasAttribute('data-ct-delete')) {
            e.stopPropagation();
            var delName = target.getAttribute('data-ct-delete');
            if (pendingDelete === delName) {
                clearPendingDelete();
                removeSaved(delName);
                if (draft.book === delName) {
                    draft.book = null;
                    draft.text = DEFAULT_TEXT;
                }
                renderSaved();
                toast('Deleted "' + delName + '"', 'delete');
                return;
            }
            clearPendingDelete();
            pendingDelete = delName;
            pendingDeleteTimer = setTimeout(function () {
                clearPendingDelete();
                if (currentView === 'saved') renderSaved();
            }, 3000);
            renderSaved();
            return;
        }
        if (target.hasAttribute('data-ct-load')) return loadSaved(target.getAttribute('data-ct-load'));
        if (target.hasAttribute('data-ct-letters')) {
            q('[data-ct-filter="include"]').value = LETTER_PRESETS[target.getAttribute('data-ct-letters')] || '';
            q('[data-ct-only-track]').classList.add('on');
            renderFilterResult();
            return;
        }
        if (target.hasAttribute('data-ct-filter-apply')) {
            if (target.disabled) return;
            insertWords(shuffleInPlace(filterResult.slice()).slice(0, MAX_GENERATED_WORDS), target.getAttribute('data-ct-filter-apply'));
            return;
        }
        if (target.hasAttribute('data-ct-units')) {
            q('[data-ct-gen="units"]').value = UNIT_PRESETS[target.getAttribute('data-ct-units')] || '';
            return;
        }
        if (target.hasAttribute('data-ct-gen-apply')) {
            var words = generateWords({
                units: q('[data-ct-gen="units"]').value,
                min: q('[data-ct-gen="min"]').value,
                max: q('[data-ct-gen="max"]').value,
                count: q('[data-ct-gen="count"]').value
            });
            if (!words.length) {
                q('[data-ct-gen="units"]').focus();
                shake();
                return;
            }
            insertWords(words, target.getAttribute('data-ct-gen-apply'));
        }
    }

    function wireEvents() {
        box.addEventListener('click', onBoxClick);

        box.addEventListener('input', function (e) {
            var t = e.target;
            if (t.matches('[data-ct-text]')) {
                draft.text = t.value;
                updateCounts();
                defaultNote();
            } else if (t.matches('[data-ct-limit]')) {
                draft.limitValue = clampLimit(draft.limitType, t.value);
            } else if (t.matches('[data-ct-filter]')) {
                renderFilterResult();
            }
        });

        box.addEventListener('change', function (e) {
            var t = e.target;
            if (t.matches('[data-ct-limit]')) {
                t.value = draft.limitValue ? String(draft.limitValue) : '';
            } else if (t.matches('[data-ct-file]')) {
                readFile(t.files && t.files[0]);
                t.value = '';
            }
        });

        box.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && currentView === 'main') {
                e.preventDefault();
                apply();
                return;
            }
            if (e.key === 'Enter' && e.target.matches('[data-ct-save-name]')) {
                e.preventDefault();
                saveCurrent();
                return;
            }
            if (e.key === 'Enter' && e.target.matches('[data-ct-load]')) {
                e.preventDefault();
                loadSaved(e.target.getAttribute('data-ct-load'));
                return;
            }
            if (e.key === 'Enter' && e.target.matches('[data-ct-limit]')) {
                e.preventDefault();
                apply();
            }
        });

        modal.addEventListener('mousedown', function (e) {
            if (e.target === modal) close();
        });

        window.addEventListener('keydown', function (e) {
            if (!isOpen()) return;
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopImmediatePropagation();
                if (currentView !== 'main') showView('main');
                else close();
                return;
            }
            // Keep page-level shortcuts (restart, quick settings) from firing underneath.
            if (e.key === 'Tab' && !box.contains(document.activeElement)) {
                e.preventDefault();
                q('[data-ct-text]').focus();
            }
        }, true);
    }

    function open() {
        ensureModal();
        draft = getConfig();
        lastFocus = document.activeElement;
        showView('main');
        defaultNote();
        modal.classList.add('is-open');
        modal.setAttribute('aria-hidden', 'false');
        setTimeout(function () {
            var textarea = q('[data-ct-text]');
            if (!textarea) return;
            textarea.focus();
            if (!textarea.readOnly) textarea.setSelectionRange(textarea.value.length, textarea.value.length);
            textarea.scrollTop = 0;
        }, 60);
    }

    function close(opts) {
        if (!modal || !isOpen()) return;
        var options = opts || {};
        clearPendingDelete();
        modal.classList.remove('is-open');
        modal.setAttribute('aria-hidden', 'true');
        if (document.activeElement && box.contains(document.activeElement)) document.activeElement.blur();
        if (lastFocus && typeof lastFocus.focus === 'function' && document.contains(lastFocus)) {
            try { lastFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
        }
        lastFocus = null;
        if (!options.silent && typeof handlers.onClose === 'function') handlers.onClose(!!options.applied);
    }

    function isOpen() {
        return !!modal && modal.classList.contains('is-open');
    }

    window.usertypoCustomText = {
        hasConfig: hasConfig,
        getConfig: getConfig,
        createPlan: createPlan,
        describe: describe,
        recordBookProgress: recordBookProgress,
        open: open,
        close: close,
        isOpen: isOpen,
        setHandlers: function (next) {
            handlers.onApply = next && typeof next.onApply === 'function' ? next.onApply : null;
            handlers.onClose = next && typeof next.onClose === 'function' ? next.onClose : null;
        }
    };
})();
