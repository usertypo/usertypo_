const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'pages', 'userstats.html');
let content = fs.readFileSync(file, 'utf8');

// 1. Revert the is-dragging CSS: replace the compact placeholder block with the original dimmed approach
// Find the block from "/* Source card" comment through the closing brace of the second .sortable-card.is-dragging
const dragRegex = /\/\*\s*Source card stays visible.*?\*\/\s*\/\*\s*Source card becomes.*?\*\/\s*\.sortable-card\.is-dragging\s*\{[^}]*\}\s*\.sortable-card\.is-dragging\s*>\s*\*\s*\{[^}]*\}\s*\.sortable-card\.is-dragging\s*\{[^}]*\}/s;
const originalDragCSS = `/* Source card stays visible, just dimmed \u2014 NEVER collapses */
        .sortable-card.is-dragging {
            opacity: 0.25 !important;
            pointer-events: none !important;
            transition: opacity 0.15s ease !important;
        }`;

if (dragRegex.test(content)) {
    content = content.replace(dragRegex, originalDragCSS);
    console.log('[OK] Reverted is-dragging CSS to original dimmed approach');
} else {
    console.log('[SKIP] Could not find compact placeholder CSS block');
}

// 2. Add glass-panel back to graph cards in sortable section
// These are the col-span-12 cards with IDs
const cardIds = [
    'performance-over-time-card',
    'hand-biometrics-card',
    'error-diagnostics-card',
    'hardware-hotspots-card',
];
for (const id of cardIds) {
    const re = new RegExp(`(class="col-span-12\\s+)(p-6 rounded-xl[^"]*"\\s+id="${id}")`, 'g');
    if (re.test(content)) {
        content = content.replace(re, `$1glass-panel $2`);
        console.log(`[OK] Added glass-panel to #${id}`);
    } else {
        console.log(`[SKIP] Could not find #${id}`);
    }
}

// Activity Tracker card (no ID, has animation delay)
content = content.replace(
    /class="col-span-12\s+p-6 rounded-xl opacity-0 animate-fade-in-up \[animation-delay:350ms\]"/,
    'class="col-span-12 glass-panel p-6 rounded-xl opacity-0 animate-fade-in-up [animation-delay:350ms]"'
);
console.log('[OK] Added glass-panel to Activity Tracker card');

// Score Distribution card (no ID, right after Activity Tracker)
content = content.replace(
    /<div class="col-span-12\s+p-6 rounded-xl">\s*<div class="flex items-center justify-between gap-4 mb-6">\s*<h2 class="font-headline text-lg font-bold">Score Distribution/,
    (match) => match.replace('class="col-span-12 p-6 rounded-xl"', 'class="col-span-12 glass-panel p-6 rounded-xl"')
);
console.log('[OK] Added glass-panel to Score Distribution card');

// Test History card
content = content.replace(
    /class="col-span-12\s+rounded-xl overflow-hidden">\s*<div class="p-6 border-b border-white\/5 flex justify-between items-center">\s*<h2 class="font-headline text-lg font-bold">Comprehensive Test History/,
    (match) => match.replace('class="col-span-12 rounded-xl overflow-hidden"', 'class="col-span-12 glass-panel rounded-xl overflow-hidden"')
);
console.log('[OK] Added glass-panel to Test History card');

fs.writeFileSync(file, content, 'utf8');
console.log('\nDone! All changes applied.');
