/**
 * On-screen keymap layouts + language → layout resolution.
 *
 * Character arrangements follow widely published national keyboard standards.
 * Data is authored in this project's { k, s, u } format.
 *
 * Each rendered key shows:
 *   - main (large): character produced in the active language layout
 *   - secondary (small): English QWERTY label for that physical key position
 */
(function (global) {
    'use strict';

    const MODIFIER_NAMES = new Set(['Backspace', 'Tab', 'Caps', 'Enter', 'Shift', 'Space']);

    function row() {
        return Array.prototype.slice.call(arguments);
    }

    function key(k, s, u) {
        const o = { k: k };
        if (s != null && s !== '') o.s = s;
        if (u != null) o.u = u;
        return o;
    }

    const MOD = {
        backspace: key('Backspace', null, 2),
        tab: key('Tab', null, 1.5),
        caps: key('Caps', null, 1.75),
        enter: key('Enter', null, 2.25),
        shiftL: key('Shift', null, 2.25),
        shiftR: key('Shift', null, 2.75),
        space: key('Space', null, 6.25),
        backslash: function (k, s) { return key(k, s, 1.5); },
    };

    // ANSI-aligned rows so each content key maps 1:1 to a US QWERTY position.
    const layouts = {
        QWERTY: [
            row(key('`', '~'), key('1', '!'), key('2', '@'), key('3', '#'), key('4', '$'), key('5', '%'), key('6', '^'), key('7', '&'), key('8', '*'), key('9', '('), key('0', ')'), key('-', '_'), key('=', '+'), MOD.backspace),
            row(MOD.tab, key('q'), key('w'), key('e'), key('r'), key('t'), key('y'), key('u'), key('i'), key('o'), key('p'), key('[', '{'), key(']', '}'), MOD.backslash('\\', '|')),
            row(MOD.caps, key('a'), key('s'), key('d'), key('f'), key('g'), key('h'), key('j'), key('k'), key('l'), key(';', ':'), key("'", '"'), MOD.enter),
            row(MOD.shiftL, key('z'), key('x'), key('c'), key('v'), key('b'), key('n'), key('m'), key(',', '<'), key('.', '>'), key('/', '?'), MOD.shiftR),
            row(MOD.space),
        ],
        AZERTY: [
            row(key('²'), key('&', '1'), key('é', '2'), key('"', '3'), key("'", '4'), key('(', '5'), key('-', '6'), key('è', '7'), key('_', '8'), key('ç', '9'), key('à', '0'), key(')', '°'), key('=', '+'), MOD.backspace),
            row(MOD.tab, key('a'), key('z'), key('e'), key('r'), key('t'), key('y'), key('u'), key('i'), key('o'), key('p'), key('^', '¨'), key('$', '£'), MOD.backslash('*', 'µ')),
            row(MOD.caps, key('q'), key('s'), key('d'), key('f'), key('g'), key('h'), key('j'), key('k'), key('l'), key('m'), key('ù', '%'), MOD.enter),
            row(MOD.shiftL, key('w'), key('x'), key('c'), key('v'), key('b'), key('n'), key(',', '?'), key(';', '.'), key(':', '/'), key('!', '§'), MOD.shiftR),
            row(MOD.space),
        ],
        QWERTZ: [
            row(key('^', '°'), key('1', '!'), key('2', '"'), key('3', '§'), key('4', '$'), key('5', '%'), key('6', '&'), key('7', '/'), key('8', '('), key('9', ')'), key('0', '='), key('ß', '?'), key('´', '`'), MOD.backspace),
            row(MOD.tab, key('q'), key('w'), key('e'), key('r'), key('t'), key('z'), key('u'), key('i'), key('o'), key('p'), key('ü'), key('+', '*'), MOD.backslash('#', "'")),
            row(MOD.caps, key('a'), key('s'), key('d'), key('f'), key('g'), key('h'), key('j'), key('k'), key('l'), key('ö'), key('ä'), MOD.enter),
            row(MOD.shiftL, key('y'), key('x'), key('c'), key('v'), key('b'), key('n'), key('m'), key(',', ';'), key('.', ':'), key('-', '_'), MOD.shiftR),
            row(MOD.space),
        ],
        Spanish: [
            row(key('º', 'ª'), key('1', '!'), key('2', '"'), key('3', '·'), key('4', '$'), key('5', '%'), key('6', '&'), key('7', '/'), key('8', '('), key('9', ')'), key('0', '='), key("'", '?'), key('¡', '¿'), MOD.backspace),
            row(MOD.tab, key('q'), key('w'), key('e'), key('r'), key('t'), key('y'), key('u'), key('i'), key('o'), key('p'), key('`', '^'), key('+', '*'), MOD.backslash('ç')),
            row(MOD.caps, key('a'), key('s'), key('d'), key('f'), key('g'), key('h'), key('j'), key('k'), key('l'), key('ñ'), key('´', '¨'), MOD.enter),
            row(MOD.shiftL, key('z'), key('x'), key('c'), key('v'), key('b'), key('n'), key('m'), key(',', ';'), key('.', ':'), key('-', '_'), MOD.shiftR),
            row(MOD.space),
        ],
        Italian: [
            row(key('\\', '|'), key('1', '!'), key('2', '"'), key('3', '£'), key('4', '$'), key('5', '%'), key('6', '&'), key('7', '/'), key('8', '('), key('9', ')'), key('0', '='), key('\'', '?'), key('ì', '^'), MOD.backspace),
            row(MOD.tab, key('q'), key('w'), key('e'), key('r'), key('t'), key('y'), key('u'), key('i'), key('o'), key('p'), key('è', 'é'), key('+', '*'), MOD.backslash('ù', '§')),
            row(MOD.caps, key('a'), key('s'), key('d'), key('f'), key('g'), key('h'), key('j'), key('k'), key('l'), key('ò', 'ç'), key('à', '°'), MOD.enter),
            row(MOD.shiftL, key('z'), key('x'), key('c'), key('v'), key('b'), key('n'), key('m'), key(',', ';'), key('.', ':'), key('-', '_'), MOD.shiftR),
            row(MOD.space),
        ],
        Arabic: [
            row(key('ذ', 'ّ'), key('1', '!'), key('2', '@'), key('3', '#'), key('4', '$'), key('5', '%'), key('6', '^'), key('7', '&'), key('8', '*'), key('9', ')'), key('0', '('), key('-', '_'), key('=', '+'), MOD.backspace),
            row(MOD.tab, key('ض', 'َ'), key('ص', 'ً'), key('ث', 'ُ'), key('ق', 'ٌ'), key('ف', 'لإ'), key('غ', 'إ'), key('ع', '‘'), key('ه', '÷'), key('خ', '×'), key('ح', '؛'), key('ج', '<'), key('د', '>'), MOD.backslash('\\', '|')),
            row(MOD.caps, key('ش', 'ِ'), key('س', 'ٍ'), key('ي', ']'), key('ب', '['), key('ل', 'لأ'), key('ا', 'أ'), key('ت', 'ـ'), key('ن', '،'), key('م', '/'), key('ك', ':'), key('ط', '"'), MOD.enter),
            row(MOD.shiftL, key('ئ', '~'), key('ء', 'ْ'), key('ؤ', '}'), key('ر', '{'), key('لا', 'لآ'), key('ى', 'آ'), key('ة', '’'), key('و', ','), key('ز', '.'), key('ظ', '؟'), MOD.shiftR),
            row(MOD.space),
        ],
        Russian: [
            row(key('ё'), key('1', '!'), key('2', '"'), key('3', '№'), key('4', ';'), key('5', '%'), key('6', ':'), key('7', '?'), key('8', '*'), key('9', '('), key('0', ')'), key('-', '_'), key('=', '+'), MOD.backspace),
            row(MOD.tab, key('й'), key('ц'), key('у'), key('к'), key('е'), key('н'), key('г'), key('ш'), key('щ'), key('з'), key('х'), key('ъ'), MOD.backslash('\\', '/')),
            row(MOD.caps, key('ф'), key('ы'), key('в'), key('а'), key('п'), key('р'), key('о'), key('л'), key('д'), key('ж'), key('э'), MOD.enter),
            row(MOD.shiftL, key('я'), key('ч'), key('с'), key('м'), key('и'), key('т'), key('ь'), key('б'), key('ю'), key('.', ','), MOD.shiftR),
            row(MOD.space),
        ],
        Greek: [
            row(key('`', '~'), key('1', '!'), key('2', '@'), key('3', '#'), key('4', '$'), key('5', '%'), key('6', '^'), key('7', '&'), key('8', '*'), key('9', '('), key('0', ')'), key('-', '_'), key('=', '+'), MOD.backspace),
            row(MOD.tab, key(';', ':'), key('ς', '΅'), key('ε'), key('ρ'), key('τ'), key('υ'), key('θ'), key('ι'), key('ο'), key('π'), key('[', '{'), key(']', '}'), MOD.backslash('\\', '|')),
            row(MOD.caps, key('α'), key('σ'), key('δ'), key('φ'), key('γ'), key('η'), key('ξ'), key('κ'), key('λ'), key('΄', '¨'), key("'", '"'), MOD.enter),
            row(MOD.shiftL, key('ζ'), key('χ'), key('ψ'), key('ω'), key('β'), key('ν'), key('μ'), key(',', '<'), key('.', '>'), key('/', '?'), MOD.shiftR),
            row(MOD.space),
        ],
        Korean: [
            row(key('`', '~'), key('1', '!'), key('2', '@'), key('3', '#'), key('4', '$'), key('5', '%'), key('6', '^'), key('7', '&'), key('8', '*'), key('9', '('), key('0', ')'), key('-', '_'), key('=', '+'), MOD.backspace),
            row(MOD.tab, key('ㅂ', 'ㅃ'), key('ㅈ', 'ㅉ'), key('ㄷ', 'ㄸ'), key('ㄱ', 'ㄲ'), key('ㅅ', 'ㅆ'), key('ㅛ'), key('ㅕ'), key('ㅑ'), key('ㅐ', 'ㅒ'), key('ㅔ', 'ㅖ'), key('[', '{'), key(']', '}'), MOD.backslash('\\', '|')),
            row(MOD.caps, key('ㅁ'), key('ㄴ'), key('ㅇ'), key('ㄹ'), key('ㅎ'), key('ㅗ'), key('ㅓ'), key('ㅏ'), key('ㅣ'), key(';', ':'), key("'", '"'), MOD.enter),
            row(MOD.shiftL, key('ㅋ'), key('ㅌ'), key('ㅊ'), key('ㅍ'), key('ㅠ'), key('ㅜ'), key('ㅡ'), key(',', '<'), key('.', '>'), key('/', '?'), MOD.shiftR),
            row(MOD.space),
        ],
        Hindi: [
            row(key('ॊ', 'ऒ'), key('1', 'ऍ'), key('2', 'ॅ'), key('3'), key('4'), key('5'), key('6'), key('7'), key('8'), key('9', '('), key('0', ')'), key('-', 'ः'), key('ऋ', 'ृ'), MOD.backspace),
            row(MOD.tab, key('ौ', 'औ'), key('ै', 'ऐ'), key('ा', 'आ'), key('ी', 'ई'), key('ू', 'ऊ'), key('ब', 'भ'), key('ह', 'ङ'), key('ग', 'घ'), key('द', 'ध'), key('ज', 'झ'), key('ड', 'ढ'), key('़', 'ञ'), MOD.backslash('ॉ', 'ऑ')),
            row(MOD.caps, key('ो', 'ओ'), key('े', 'ए'), key('्', 'अ'), key('ि', 'इ'), key('ु', 'उ'), key('प', 'फ'), key('र', 'ऱ'), key('क', 'ख'), key('त', 'थ'), key('च', 'छ'), key('ट', 'ठ'), MOD.enter),
            row(MOD.shiftL, key('ॆ', 'ऎ'), key('ं', 'ँ'), key('म', 'ण'), key('न'), key('व'), key('ल', 'ळ'), key('स', 'श'), key(',', 'ष'), key('.', '।'), key('य', 'य़'), MOD.shiftR),
            row(MOD.space),
        ],
        'Japanese Hiragana': [
            row(key('ろ'), key('ぬ'), key('ふ'), key('あ', 'ぁ'), key('う', 'ぅ'), key('え', 'ぇ'), key('お', 'ぉ'), key('や', 'ゃ'), key('ゆ', 'ゅ'), key('よ', 'ょ'), key('わ', 'を'), key('ほ'), key('へ'), MOD.backspace),
            row(MOD.tab, key('た'), key('て'), key('い', 'ぃ'), key('す'), key('か'), key('ん'), key('な'), key('に'), key('ら'), key('せ'), key('゛', '「'), key('゜', '」'), MOD.backslash('む')),
            row(MOD.caps, key('ち'), key('と'), key('し'), key('は'), key('き'), key('く'), key('ま'), key('の'), key('り'), key('れ'), key('け'), MOD.enter),
            row(MOD.shiftL, key('つ', 'っ'), key('さ'), key('そ'), key('ひ'), key('こ'), key('み'), key('も'), key('ね', '、'), key('る', '。'), key('め', '・'), MOD.shiftR),
            row(MOD.space),
        ],
        'Japanese Katakana': [
            row(key('ロ'), key('ヌ'), key('フ'), key('ア', 'ァ'), key('ウ', 'ゥ'), key('エ', 'ェ'), key('オ', 'ォ'), key('ヤ', 'ャ'), key('ユ', 'ュ'), key('ヨ', 'ョ'), key('ワ', 'ヲ'), key('ホ'), key('ヘ'), MOD.backspace),
            row(MOD.tab, key('タ'), key('テ'), key('イ', 'ィ'), key('ス'), key('カ'), key('ン'), key('ナ'), key('ニ'), key('ラ'), key('セ'), key('゛', '「'), key('゜', '」'), MOD.backslash('ム')),
            row(MOD.caps, key('チ'), key('ト'), key('シ'), key('ハ'), key('キ'), key('ク'), key('マ'), key('ノ'), key('リ'), key('レ'), key('ケ'), MOD.enter),
            row(MOD.shiftL, key('ツ', 'ッ'), key('サ'), key('ソ'), key('ヒ'), key('コ'), key('ミ'), key('モ'), key('ネ', '、'), key('ル', '。'), key('メ', '・'), MOD.shiftR),
            row(MOD.space),
        ],
    };

    function resolveLanguageKeymapLayout(langFile) {
        const id = String(langFile || 'english').toLowerCase();

        if (id.startsWith('arabic')) return 'Arabic';
        if (id.startsWith('russian')) return 'Russian';
        if (id.startsWith('greek')) return 'Greek';
        if (id.startsWith('korean')) return 'Korean';
        if (id.startsWith('hindi')) return 'Hindi';
        if (id.startsWith('japanese_hiragana')) return 'Japanese Hiragana';
        if (id.startsWith('japanese_katakana')) return 'Japanese Katakana';
        if (id.startsWith('french')) return 'AZERTY';
        if (id.startsWith('german')) return 'QWERTZ';
        if (id.startsWith('spanish')) return 'Spanish';
        if (id.startsWith('italian')) return 'Italian';

        return 'QWERTY';
    }

    /**
     * Always set keymapLayout from the active test language.
     * @returns {boolean} whether keymapLayout changed
     */
    function syncKeymapLayoutForLanguage(settings) {
        if (!settings) return false;
        if (!settings.keyboardLayout) settings.keyboardLayout = {};

        const lang = settings.languageContent?.testLanguage || 'english';
        const preferred = resolveLanguageKeymapLayout(lang);
        const current = settings.keyboardLayout.keymapLayout || 'QWERTY';

        if (preferred === current) return false;
        settings.keyboardLayout.keymapLayout = preferred;
        return true;
    }

    /**
     * Return layout rows with `q` set to the US QWERTY label for each
     * physical key position (empty string on modifiers).
     */
    function getKeymapLayoutData(layoutName) {
        const name = layoutName && layouts[layoutName] ? layoutName : 'QWERTY';
        const langRows = layouts[name];
        const qwRows = layouts.QWERTY;

        return langRows.map((row, rowIndex) => {
            const qwRow = qwRows[rowIndex] || [];
            const qwContent = qwRow.filter((k) => !MODIFIER_NAMES.has(k.k));
            let qwIdx = 0;

            return row.map((keyObj) => {
                const copy = {
                    k: keyObj.k,
                    s: keyObj.s,
                    u: keyObj.u,
                    q: '',
                };
                if (!MODIFIER_NAMES.has(keyObj.k)) {
                    const qwKey = qwContent[qwIdx++];
                    copy.q = qwKey ? qwKey.k : '';
                }
                return copy;
            });
        });
    }

    /** Resolve layout data for a language file id. */
    function getKeymapLayoutDataForLanguage(langFile) {
        return getKeymapLayoutData(resolveLanguageKeymapLayout(langFile));
    }

    function isLetterLikeKey(ch) {
        if (typeof ch !== 'string' || ch.length < 1 || ch.length > 2) return false;
        if (MODIFIER_NAMES.has(ch)) return false;
        const code = ch.charCodeAt(0);
        // ASCII letters
        if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) return true;
        // Any non-ASCII glyph counts as a script character for keymap visibility
        // (Cyrillic, Greek, Arabic, Hangul jamo, Devanagari, kana, etc.)
        return code > 127;
    }

    function isModifierKey(name) {
        return MODIFIER_NAMES.has(name);
    }

    /**
     * Resolve the active language file id from the best available source.
     */
    function resolveActiveLanguageFile(explicit) {
        if (explicit) return String(explicit);
        if (typeof global.currentLanguageFile === 'string' && global.currentLanguageFile) {
            return global.currentLanguageFile;
        }
        try {
            const s = global.usertypo_settings
                || JSON.parse(global.localStorage?.getItem('usertypo_settings') || '{}');
            return s?.languageContent?.testLanguage || 'english';
        } catch (e) {
            return 'english';
        }
    }

    global.keymapLayouts = Object.assign({}, global.keymapLayouts || {}, layouts);
    global.resolveLanguageKeymapLayout = resolveLanguageKeymapLayout;
    global.syncKeymapLayoutForLanguage = syncKeymapLayoutForLanguage;
    global.getKeymapLayoutData = getKeymapLayoutData;
    global.getKeymapLayoutDataForLanguage = getKeymapLayoutDataForLanguage;
    global.resolveActiveLanguageFile = resolveActiveLanguageFile;
    global.isKeymapLetterLike = isLetterLikeKey;
    global.isKeymapModifier = isModifierKey;
    global.LANGUAGE_KEYMAP_LAYOUT_NAMES = Object.keys(layouts);
})(typeof window !== 'undefined' ? window : globalThis);
