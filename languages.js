// ═══════════════════════════════════════════════════════════════
//  LANGUAGES – Master language list & dynamic word list loader
// ═══════════════════════════════════════════════════════════════

// All available languages with metadata
const ALL_LANGUAGES = [
    { file: "arabic", name: "Arabic", category: "natural" },
    { file: "arabic_egypt", name: "Arabic Egypt", category: "natural" },
    { file: "arabic_egypt_1k", name: "Arabic Egypt 1k", category: "natural" },
    { file: "arabic_morocco", name: "Arabic Morocco", category: "natural" },
    { file: "dutch", name: "Dutch", category: "natural" },
    { file: "dutch_10k", name: "Dutch 10k", category: "natural" },
    { file: "dutch_1k", name: "Dutch 1k", category: "natural" },
    { file: "english", name: "English", category: "natural" },
    { file: "english_10k", name: "English 10k", category: "natural" },
    { file: "english_1k", name: "English 1k", category: "natural" },
    { file: "english_25k", name: "English 25k", category: "natural" },
    { file: "english_450k", name: "English 450k", category: "natural" },
    { file: "english_5k", name: "English 5k", category: "natural" },
    { file: "english_commonly_misspelled", name: "English Commonly Misspelled", category: "natural" },
    { file: "english_contractions", name: "English Contractions", category: "natural" },
    { file: "english_doubleletter", name: "English Doubleletter", category: "natural" },
    { file: "english_medical", name: "English Medical", category: "natural" },
    { file: "english_old", name: "English Old", category: "natural" },
    { file: "english_shakespearean", name: "English Shakespearean", category: "natural" },
    { file: "french", name: "French", category: "natural" },
    { file: "french_10k", name: "French 10k", category: "natural" },
    { file: "french_1k", name: "French 1k", category: "natural" },
    { file: "french_2k", name: "French 2k", category: "natural" },
    { file: "french_600k", name: "French 600k", category: "natural" },
    { file: "french_bitoduc", name: "French Bitoduc", category: "natural" },
    { file: "german", name: "German", category: "natural" },
    { file: "german_10k", name: "German 10k", category: "natural" },
    { file: "german_1k", name: "German 1k", category: "natural" },
    { file: "german_250k", name: "German 250k", category: "natural" },
    { file: "greek", name: "Greek", category: "natural" },
    { file: "greek_1k", name: "Greek 1k", category: "natural" },
    { file: "greek_25k", name: "Greek 25k", category: "natural" },
    { file: "hindi", name: "Hindi", category: "natural" },
    { file: "hindi_1k", name: "Hindi 1k", category: "natural" },
    { file: "indonesian", name: "Indonesian", category: "natural" },
    { file: "indonesian_1k", name: "Indonesian 1k", category: "natural" },
    { file: "italian", name: "Italian", category: "natural" },
    { file: "italian_1k", name: "Italian 1k", category: "natural" },
    { file: "italian_280k", name: "Italian 280k", category: "natural" },
    { file: "italian_60k", name: "Italian 60k", category: "natural" },
    { file: "italian_7k", name: "Italian 7k", category: "natural" },
    { file: "japanese_hiragana", name: "Japanese Hiragana", category: "natural" },
    { file: "japanese_katakana", name: "Japanese Katakana", category: "natural" },
    { file: "japanese_romaji", name: "Japanese Romaji", category: "natural" },
    { file: "japanese_romaji_1k", name: "Japanese Romaji 1k", category: "natural" },
    { file: "korean", name: "Korean", category: "natural" },
    { file: "korean_1k", name: "Korean 1k", category: "natural" },
    { file: "russian", name: "Russian", category: "natural" },
    { file: "russian_1k", name: "Russian 1k", category: "natural" },
    { file: "russian_25k", name: "Russian 25k", category: "natural" },
    { file: "russian_375k", name: "Russian 375k", category: "natural" },
    { file: "russian_50k", name: "Russian 50k", category: "natural" },
    { file: "russian_abbreviations", name: "Russian Abbreviations", category: "natural" },
    { file: "russian_contractions", name: "Russian Contractions", category: "natural" },
    { file: "russian_contractions_1k", name: "Russian Contractions 1k", category: "natural" },
    { file: "spanish", name: "Spanish", category: "natural" },
    { file: "spanish_10k", name: "Spanish 10k", category: "natural" },
    { file: "spanish_1k", name: "Spanish 1k", category: "natural" },
    { file: "spanish_650k", name: "Spanish 650k", category: "natural" },
    { file: "code_bash", name: "Bash", category: "code" },
    { file: "code_c", name: "C", category: "code" },
    { file: "code_cpp", name: "C++", category: "code" },
    { file: "code_csharp", name: "C#", category: "code" },
    { file: "code_clojure", name: "Clojure", category: "code" },
    { file: "code_css", name: "CSS", category: "code" },
    { file: "code_dart", name: "Dart", category: "code" },
    { file: "code_docker", name: "Docker", category: "code" },
    { file: "code_elixir", name: "Elixir", category: "code" },
    { file: "code_erlang", name: "Erlang", category: "code" },
    { file: "code_fortran", name: "Fortran", category: "code" },
    { file: "code_fsharp", name: "F#", category: "code" },
    { file: "code_git", name: "Git", category: "code" },
    { file: "code_go", name: "Go", category: "code" },
    { file: "code_haskell", name: "Haskell", category: "code" },
    { file: "code_html", name: "HTML", category: "code" },
    { file: "code_java", name: "Java", category: "code" },
    { file: "code_javascript", name: "JavaScript", category: "code" },
    { file: "code_kotlin", name: "Kotlin", category: "code" },
    { file: "code_lua", name: "Lua", category: "code" },
    { file: "code_matlab", name: "MATLAB", category: "code" },
    { file: "code_nim", name: "Nim", category: "code" },
    { file: "code_ocaml", name: "OCaml", category: "code" },
    { file: "code_pascal", name: "Pascal", category: "code" },
    { file: "code_perl", name: "Perl", category: "code" },
    { file: "code_php", name: "PHP", category: "code" },
    { file: "code_powershell", name: "PowerShell", category: "code" },
    { file: "code_python", name: "Python", category: "code" },
    { file: "code_r", name: "R", category: "code" },
    { file: "code_ruby", name: "Ruby", category: "code" },
    { file: "code_rust", name: "Rust", category: "code" },
    { file: "code_scala", name: "Scala", category: "code" },
    { file: "code_sql", name: "SQL", category: "code" },
    { file: "code_swift", name: "Swift", category: "code" },
    { file: "code_typescript", name: "TypeScript", category: "code" },
    { file: "code_visual_basic", name: "Visual Basic", category: "code" },
    { file: "code_zig", name: "Zig", category: "code" },
];

// Default word list (English 200 most common – used as fallback)
let wordList = [
    "the", "be", "of", "and", "a", "to", "in", "he", "have", "it", "that", "for",
    "they", "with", "as", "not", "on", "she", "at", "by", "this", "we", "you",
    "do", "but", "from", "or", "which", "one", "would", "all", "will", "there", "say",
    "who", "make", "when", "can", "more", "if", "no", "man", "out", "other", "so",
    "what", "time", "up", "go", "about", "than", "into", "could", "state", "only",
    "new", "year", "some", "take", "come", "these", "know", "see", "use", "get", "like",
    "then", "first", "any", "work", "now", "may", "such", "give", "over", "think",
    "most", "even", "find", "day", "also", "after", "way", "many", "must", "look",
    "before", "great", "back", "through", "long", "where", "much", "should", "well",
    "people", "down", "own", "just", "because", "good", "each", "those", "feel", "seem",
    "how", "high", "too", "place", "little", "world", "very", "still", "nation", "hand",
    "old", "life", "tell", "write", "become", "here", "show", "house", "both", "between",
    "need", "mean", "call", "develop", "under", "last", "right", "move", "thing", "general",
    "school", "never", "same", "another", "begin", "while", "number", "part", "turn", "real",
    "leave", "might", "want", "point", "form", "off", "child", "few", "small", "since",
    "against", "ask", "late", "home", "interest", "large", "person", "end", "open", "public",
    "follow", "during", "present", "without", "again", "hold", "govern", "around", "possible",
    "head", "consider", "word", "program", "problem", "however", "lead", "system", "set",
    "order", "eye", "plan", "run", "keep", "face", "fact", "group", "play", "stand",
    "increase", "early", "course", "change", "help", "line"
];

// Currently loaded language filename
let currentLanguageFile = 'english';

/**
 * Languages that read/type right-to-left.
 */
function isLanguageRTL(langFile) {
    const id = String(langFile || currentLanguageFile || 'english').toLowerCase();
    return (
        id.startsWith('arabic')
        || id.startsWith('hebrew')
        || id.startsWith('urdu')
        || id.startsWith('persian')
        || id.startsWith('farsi')
        || id.startsWith('pashto')
        || id.startsWith('kurdish')
    );
}

/**
 * Apply LTR/RTL to typing surfaces and body so layout + caret can follow.
 */
function applyTypingTextDirection(langFile) {
    const file = langFile || currentLanguageFile || getSavedLanguage();
    const rtl = isLanguageRTL(file);
    if (document.body) {
        document.body.classList.toggle('typing-rtl', rtl);
        document.body.dataset.textDirection = rtl ? 'rtl' : 'ltr';
    }
    document.querySelectorAll(
        '#text-container, #room-text-container, #typing-area, #room-typing-area, [data-typing-text]'
    ).forEach((el) => {
        el.setAttribute('dir', rtl ? 'rtl' : 'ltr');
    });
    return rtl;
}

/**
 * Caret X relative to the text container for a character box.
 * The caret element is sized to the letter width and must use the letter's
 * left edge so it sits under the glyph (LTR and RTL).
 * Only "after last letter" differs: LTR goes to the right edge, RTL stays
 * on the left edge (reading end of the word).
 */
function getCaretOffsetLeft(targetRect, containerRect, isAfter, isRtl) {
    let left = targetRect.left - containerRect.left;
    if (isAfter && !isRtl) {
        left += targetRect.width;
    }
    return left;
}

/**
 * Layout offset of `el` inside `container`, ignoring CSS transforms on ancestors.
 * Prefer this over getBoundingClientRect deltas while tape/line scroll is animating.
 */
function getLayoutOffsetInContainer(el, container) {
    if (!el || !container) return { left: 0, top: 0 };
    let left = 0;
    let top = 0;
    let node = el;
    while (node && node !== container) {
        left += node.offsetLeft;
        top += node.offsetTop;
        node = node.offsetParent;
    }
    if (node !== container) {
        // Fallback: rect delta is still transform-invariant when both share the
        // same transformed ancestor (caret/text live under the scrolling container).
        const er = el.getBoundingClientRect();
        const cr = container.getBoundingClientRect();
        return { left: er.left - cr.left, top: er.top - cr.top };
    }
    return { left, top };
}

/**
 * Resolve the character node the caret should track.
 * @param {string} idPrefix e.g. "char" or "room-char"
 */
function resolveCaretCharTarget(wordEl, wordIndex, charIndex, idPrefix) {
    let target = document.getElementById(`${idPrefix}-${wordIndex}-${charIndex}`);
    let isAfter = false;
    if (!target) {
        target = document.getElementById(`${idPrefix}-${wordIndex}-${charIndex - 1}`);
        isAfter = true;
    }
    if (!target) target = wordEl;
    return { target: target || wordEl, isAfter };
}

/**
 * Caret box in container layout coordinates (transform-stable).
 */
function getCaretLayoutInContainer(container, wordEl, targetEl, isAfter, isRtl) {
    if (!container || !wordEl) return { left: 0, top: 0, width: 0 };
    const el = targetEl || wordEl;
    const pos = getLayoutOffsetInContainer(el, container);
    const width = el.offsetWidth || 0;
    let left = pos.left;
    if (isAfter && !isRtl) left += width;
    return { left, top: pos.top, width };
}

/**
 * Horizontal center of the expected word (excludes .extra letters) so typing
 * extras after a word does not yank tape-mode centering.
 */
function getWordTapeCenterX(wordEl, container) {
    if (!wordEl || !container) return 0;
    const baseChars = wordEl.querySelectorAll('.char:not(.extra)');
    if (!baseChars.length) {
        const pos = getLayoutOffsetInContainer(wordEl, container);
        return pos.left + (wordEl.offsetWidth || 0) / 2;
    }
    const first = baseChars[0];
    const last = baseChars[baseChars.length - 1];
    const firstPos = getLayoutOffsetInContainer(first, container);
    const lastPos = getLayoutOffsetInContainer(last, container);
    return (firstPos.left + lastPos.left + (last.offsetWidth || 0)) / 2;
}

/**
 * Live translateX from computed style (mid-transition safe).
 */
function getElementTranslateX(el) {
    if (!el) return 0;
    const t = getComputedStyle(el).transform;
    if (!t || t === 'none') return 0;
    try {
        return new DOMMatrixReadOnly(t).m41;
    } catch (e) {
        const m = t.match(/matrix3d\(([^)]+)\)/) || t.match(/matrix\(([^)]+)\)/);
        if (!m) return 0;
        const parts = m[1].split(',').map((v) => parseFloat(v.trim()));
        return m[0].startsWith('matrix3d') ? (parts[12] || 0) : (parts[4] || 0);
    }
}

/**
 * Letter tape: appending/removing .extra grows/shrinks the active word and
 * instantly shifts every following word in layout. Nudge translateX (and the
 * caret's local X) by the opposite delta with transitions frozen so upcoming
 * text on the right does not jitter — only the intentional scroll moves.
 *
 * @param {HTMLElement} textContainer
 * @param {number} widthDelta  newWidth - oldWidth (positive when an extra is added)
 */
function compensateLetterTapeWidthDelta(textContainer, widthDelta) {
    if (!textContainer || !widthDelta) return;
    const tapeMode = document.body?.getAttribute('data-tape-mode')
        || document.body?.dataset?.tapeMode
        || 'off';
    if (tapeMode !== 'letter') return;

    const isRtl = typeof window.isTypingRTL === 'function' ? window.isTypingRTL() : false;
    // LTR extras extend the word to the right of the caret → following words jump
    // right; pull the tape left by the same amount. RTL mirroring uses the opposite.
    const tapeNudge = isRtl ? widthDelta : -widthDelta;
    const caretNudge = isRtl ? -widthDelta : widthDelta;

    const carets = [
        document.getElementById('caret'),
        document.getElementById('pace-caret'),
        document.getElementById('bot-caret'),
    ].filter(Boolean);
    const nodes = [textContainer].concat(carets);

    // Tape layout CSS uses transition !important — inline transition:none loses.
    // Freeze with setProperty(..., 'important') so the width-delta nudge is instant.
    nodes.forEach((n) => {
        n.style.setProperty('transition', 'none', 'important');
    });

    const liveX = getElementTranslateX(textContainer);
    // Commit the live visual position first, then nudge — otherwise some engines
    // keep interpolating from the previous transition target.
    textContainer.style.transform = `translateX(${liveX}px)`;
    void textContainer.offsetWidth;
    textContainer.style.transform = `translateX(${liveX + tapeNudge}px)`;

    carets.forEach((caretEl) => {
        const x = getElementTranslateX(caretEl);
        const topMatch = /translate3d\([^,]+,\s*([-\d.]+)px/.exec(caretEl.style.transform || '');
        const top = topMatch ? topMatch[1] : '0';
        caretEl.style.transform = `translate3d(${x}px, ${top}px, 0)`;
        void caretEl.offsetWidth;
        caretEl.style.transform = `translate3d(${x + caretNudge}px, ${top}px, 0)`;
    });

    void textContainer.offsetWidth;

    nodes.forEach((n) => {
        n.style.removeProperty('transition');
    });
}

window.isLanguageRTL = isLanguageRTL;
window.applyTypingTextDirection = applyTypingTextDirection;
window.getCaretOffsetLeft = getCaretOffsetLeft;
window.getLayoutOffsetInContainer = getLayoutOffsetInContainer;
window.resolveCaretCharTarget = resolveCaretCharTarget;
window.getCaretLayoutInContainer = getCaretLayoutInContainer;
window.getWordTapeCenterX = getWordTapeCenterX;
window.getElementTranslateX = getElementTranslateX;
window.compensateLetterTapeWidthDelta = compensateLetterTapeWidthDelta;
window.isTypingRTL = function () {
    return document.body?.dataset?.textDirection === 'rtl' || isLanguageRTL(currentLanguageFile);
};

// Cache loaded languages to avoid re-fetching
const _langCache = {};

/**
 * Load a language's word list from its JSON file.
 * @param {string} filename - The language filename (without .json extension)
 * @returns {Promise<string[]>} - The words array
 */
async function loadLanguage(filename) {
    if (!filename || filename === 'Off') return wordList;

    // Normalize: UI buttons use _Xk naming but actual files use _XT naming

    // Check cache first
    if (_langCache[filename]) {
        wordList = _langCache[filename];
        currentLanguageFile = filename;
        applyTypingTextDirection(filename);
        if (window.usertypoAdaptRefine && typeof window.usertypoAdaptRefine.rebuildPool === 'function') {
            window.usertypoAdaptRefine.rebuildPool(wordList);
        }
        return wordList;
    }

    try {
        const resp = await fetch('lang/' + filename + '.json');
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const data = await resp.json();

        // Handle both format: { "words": [...] } and direct array [...]
        let wordsArray = null;
        if (Array.isArray(data)) {
            wordsArray = data;
        } else if (data && data.words && Array.isArray(data.words)) {
            wordsArray = data.words;
        }

        if (wordsArray && wordsArray.length > 0) {
            _langCache[filename] = wordsArray;
            wordList = wordsArray;
            currentLanguageFile = filename;
            applyTypingTextDirection(filename);
            if (window.usertypoAdaptRefine && typeof window.usertypoAdaptRefine.rebuildPool === 'function') {
                window.usertypoAdaptRefine.rebuildPool(wordList);
            }
        }
    } catch (err) {
        console.warn('[languages] Failed to load "' + filename + '":', err);
        if (window.location.protocol === 'file:') {
            alert("Error loading language: " + filename + "\n\nBrowsers block loading local JSON files for security when using the 'file://' protocol. You need to run a local web server (e.g. Live Server in VSCode) to use custom languages.");
        }
        // Keep current wordList as fallback
    }
    return wordList;
}

/**
 * Get the saved language from settings, or default to 'english'.
 */
function getSavedLanguage() {
    try {
        const settings = JSON.parse(localStorage.getItem('usertypo_settings') || '{}');
        const lang = settings.languageContent && settings.languageContent.testLanguage;
        return lang || 'english';
    } catch (e) {
        return 'english';
    }
}

/**
 * Save the selected language to settings.
 */
function saveLanguage(filename) {
    try {
        const settings = JSON.parse(localStorage.getItem('usertypo_settings') || '{}');
        if (!settings.languageContent) settings.languageContent = {};
        settings.languageContent.testLanguage = filename;

        if (!settings.keyboardLayout) settings.keyboardLayout = {};
        if (typeof window.syncKeymapLayoutForLanguage === 'function') {
            window.syncKeymapLayoutForLanguage(settings);
        } else if (typeof window.resolveLanguageKeymapLayout === 'function') {
            settings.keyboardLayout.keymapLayout = window.resolveLanguageKeymapLayout(filename);
        }
        settings.keyboardLayout.keymapLangSyncVersion = 1;

        localStorage.setItem('usertypo_settings', JSON.stringify(settings));
        if (window.usertypo_settings) {
            if (!window.usertypo_settings.languageContent) window.usertypo_settings.languageContent = {};
            window.usertypo_settings.languageContent.testLanguage = filename;
            if (!window.usertypo_settings.keyboardLayout) window.usertypo_settings.keyboardLayout = {};
            window.usertypo_settings.keyboardLayout.keymapLayout = settings.keyboardLayout.keymapLayout;
            window.usertypo_settings.keyboardLayout.keymapLangSyncVersion = 1;
        }
        if (typeof currentLanguageFile !== 'undefined') {
            currentLanguageFile = filename;
        }
        applyTypingTextDirection(filename);

        if (window.usertypo_settingsApi?.applyFooterSettings) {
            window.usertypo_settingsApi.applyFooterSettings(settings);
        }

        // Force keymap redraw with the newly selected language
        const redraw = () => {
            if (window.usertypo_settingsApi?.applyKeymapDisplay) {
                window.usertypo_settingsApi.applyKeymapDisplay(window.usertypo_settings || settings);
            } else if (typeof window.renderKeymap === 'function') {
                window.renderKeymap(true, true, filename);
            }
        };
        redraw();
        // Restart/test re-render can race; redraw again on next frames
        requestAnimationFrame(redraw);
        setTimeout(redraw, 50);
        setTimeout(redraw, 350);
    } catch (e) {
        console.warn('[languages] Failed to save language:', e);
    }
}

// Filter language buttons in settings (search)
function filterLangButtons(query) {
    const q = query.toLowerCase().trim();
    const buttons = document.querySelectorAll('.lang-btn');
    const groups = document.querySelectorAll('.lang-group');

    buttons.forEach(btn => {
        const name = btn.textContent.toLowerCase();
        const file = (btn.getAttribute('data-lang-file') || '').toLowerCase();
        const match = !q || name.includes(q) || file.includes(q);
        btn.style.display = match ? '' : 'none';
    });

    // Hide group headers if all buttons in them are hidden
    groups.forEach(group => {
        const visibleBtns = group.querySelectorAll('.lang-btn:not([style*="display: none"])');
        group.style.display = visibleBtns.length > 0 ? '' : 'none';
    });
}

// Select a language button in settings
function selectLangOpt(btn) {
    document.querySelectorAll('.lang-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    const langFile = btn.getAttribute('data-lang-file');
    if (langFile) {
        try {
            saveLanguage(langFile);
        } catch (e) {
            console.error("Error saving language:", e);
        }

        // Update the setting-select display text
        const card = btn.closest('.sub-setting-card') || btn.closest('[data-sub-title]');
        if (card) {
            const selectBtn = card.querySelector('.setting-select .truncate');
            if (selectBtn) {
                selectBtn.textContent = btn.textContent.trim();
            }
        }
        
        // Instantly reload language globally (defer restart if mid-test)
        if (typeof window._initLang === 'function') {
            const testActive = typeof window.usertypo_testRuntime?.isActive === 'function'
                && window.usertypo_testRuntime.isActive();
            window._initLang({ skipRestart: testActive });
        }
    }
}

window.selectLangOpt = selectLangOpt;

/**
 * Languages exactly as listed on the Settings → Test Language panel.
 * Parsed from the settings page fragment (or live DOM) so names/files stay in sync.
 */
let __settingsPageLangCache = null;
function getSettingsPageLanguages() {
    if (__settingsPageLangCache && __settingsPageLangCache.length) {
        return __settingsPageLangCache;
    }

    const collected = [];
    const seen = new Set();

    function pushLang(file, name, category) {
        const f = String(file || '').trim();
        const n = String(name || '').trim();
        if (!f || !n || seen.has(f)) return;
        seen.add(f);
        collected.push({
            file: f,
            name: n,
            category: category || (f.startsWith('code_') ? 'code' : 'natural'),
        });
    }

    // Prefer live settings DOM when available
    const liveBtns = document.querySelectorAll('.lang-btn[data-lang-file]');
    if (liveBtns.length) {
        liveBtns.forEach((btn) => {
            const group = btn.closest('.lang-group');
            let category = 'natural';
            if (group) {
                const header = group.querySelector('span');
                const ht = (header && header.textContent) || '';
                if (/code/i.test(ht)) category = 'code';
            }
            pushLang(btn.getAttribute('data-lang-file'), btn.textContent, category);
        });
    }

    // Fallback: parse embedded settings page fragment
    if (!collected.length) {
        const html = window.__USERTYPO_PAGE_FRAGMENTS__
            && window.__USERTYPO_PAGE_FRAGMENTS__['pages/settings.html'];
        if (typeof html === 'string' && html) {
            const re = /data-lang-file="([^"]+)"[^>]*>\s*([^<]+?)\s*</g;
            let m;
            while ((m = re.exec(html)) !== null) {
                pushLang(m[1], m[2]);
            }
        }
    }

    if (collected.length) {
        __settingsPageLangCache = collected;
        return collected;
    }

    // Last resort
    if (typeof ALL_LANGUAGES !== 'undefined' && Array.isArray(ALL_LANGUAGES)) {
        return ALL_LANGUAGES;
    }
    return [];
}

window.getSettingsPageLanguages = getSettingsPageLanguages;

// Auto-load the saved language on page load (for index.html)
if (typeof document !== 'undefined') {
    window._initLang = (opts = {}) => {
        const saved = getSavedLanguage();
        if (saved) {
            loadLanguage(saved).then(() => {
                const testActive = typeof window.usertypo_testRuntime?.isActive === 'function'
                    && window.usertypo_testRuntime.isActive();
                if (!opts.skipRestart && !testActive && typeof window.restartTest === 'function') {
                    window.restartTest({ randomizeTheme: false });
                }
                if (window.usertypo_settingsApi?.applyKeymapDisplay) {
                    window.usertypo_settingsApi.applyKeymapDisplay();
                } else if (typeof window.renderKeymap === 'function') {
                    window.renderKeymap(true, true, saved);
                }
            });
            
            // Update UI if we are on the settings page
            const btns = document.querySelectorAll('.lang-btn');
            if (btns.length > 0) {
                btns.forEach(b => b.classList.remove('active'));
                const activeBtns = document.querySelectorAll(`.lang-btn[data-lang-file="${saved}"]`);
                activeBtns.forEach(activeBtn => {
                    activeBtn.classList.add('active');
                    const card = activeBtn.closest('.sub-setting-card') || activeBtn.closest('[data-sub-title]');
                    if (card) {
                        const selectBtn = card.querySelector('.setting-select .truncate');
                        if (selectBtn) {
                            selectBtn.textContent = activeBtn.textContent.trim();
                        }
                    }
                });
            }
        }
    };
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', window._initLang);
    } else {
        window._initLang();
    }

    // Handle bfcache restorations (when user hits Back button from settings)
    window.addEventListener('pageshow', (event) => {
        if (event.persisted) {
            window._initLang();
        }
    });

    // Handle cross-tab settings sync
    window.addEventListener('storage', (event) => {
        if (event.key === 'usertypo_settings') {
            window._initLang();
        }
    });
}
