/**
 * Replace all calc(X * var(--glow-intensity, 1)) with var(--gi-XX, X) in page HTML files.
 * Run: node scripts/fix-glow-calc.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PAGES_DIR = path.join(ROOT, 'pages');

// Regex to find: calc( X * var(--glow-intensity, 1) )
// X can be: 0.4, .6, 1, 0.055, etc.
const CALC_GLOW_RE = /calc\(\s*([+\d.eE-]+)\s*\*\s*var\(--glow-intensity,\s*1\)\s*\)/g;

function replaceCalcGlow(content, filePath) {
    let count = 0;
    const result = content.replace(CALC_GLOW_RE, (match, alpha) => {
        const giKey = Math.round(parseFloat(alpha) * 100);
        count++;
        return `var(--gi-${giKey}, ${alpha})`;
    });
    if (count > 0) {
        console.log(`  ${path.relative(ROOT, filePath)}: ${count} replacements`);
    }
    return result;
}

function processDir(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            processDir(full);
        } else if (entry.isFile() && entry.name.endsWith('.html')) {
            const content = fs.readFileSync(full, 'utf8');
            const updated = replaceCalcGlow(content, full);
            if (updated !== content) {
                fs.writeFileSync(full, updated, 'utf8');
            }
        }
    }
}

console.log('Replacing calc(X * var(--glow-intensity, 1)) -> var(--gi-XX, X) in pages/...');
processDir(PAGES_DIR);
console.log('Done!');
