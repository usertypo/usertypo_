const fs = require('fs');
const path = require('path');

const KEEP_LANGUAGES = [
    'english',
    'spanish',
    'french',
    'german',
    'dutch',
    'arabic',
    'korean',
    'japanese',
    'italian',
    'indonesian',
    'russian',
    'greek',
    'hindi',
    'chinese'
];

function isKept(filename) {
    if (filename.startsWith('code_')) return true; // keep all coding languages
    
    // Check if filename starts with any of the keep prefixes
    for (const prefix of KEEP_LANGUAGES) {
        // e.g. 'english' matches 'english', 'english_ze', 'english_10T'
        if (filename === prefix || filename.startsWith(prefix + '_')) {
            return true;
        }
    }
    return false;
}

// 1. Delete unused files in lang/
const langDir = path.resolve(__dirname, '..', 'lang');
const files = fs.readdirSync(langDir);
let deletedFiles = 0;

for (const file of files) {
    if (!file.endsWith('.json')) continue;
    
    const basename = file.replace('.json', '');
    if (!isKept(basename)) {
        fs.unlinkSync(path.join(langDir, file));
        deletedFiles++;
    }
}
console.log(`Deleted ${deletedFiles} unused language files from lang/`);

// 2. Update languages.js
const langJsPath = path.resolve(__dirname, '..', 'languages.js');
let langJsContent = fs.readFileSync(langJsPath, 'utf8');

// The ALL_LANGUAGES array spans lines. We can filter it with a regex or just line-by-line.
const lines = langJsContent.split('\n');
const newLines = [];
let inAllLanguages = false;

for (let line of lines) {
    if (line.includes('const ALL_LANGUAGES = [')) {
        inAllLanguages = true;
        newLines.push(line);
        continue;
    }
    
    if (inAllLanguages && line.includes('];')) {
        inAllLanguages = false;
        newLines.push(line);
        continue;
    }
    
    if (inAllLanguages) {
        // Look for { file: "something" ... }
        const match = line.match(/file:\s*"([^"]+)"/);
        if (match) {
            const filename = match[1];
            if (isKept(filename)) {
                newLines.push(line);
            }
        } else {
            // Keep comments or empty lines in the array
            newLines.push(line);
        }
    } else {
        newLines.push(line);
    }
}

fs.writeFileSync(langJsPath, newLines.join('\n'));
console.log('Updated languages.js');

// 3. Update pages/settings.html
const settingsPath = path.resolve(__dirname, '..', 'pages', 'settings.html');
let settingsContent = fs.readFileSync(settingsPath, 'utf8');

const settingsLines = settingsContent.split('\n');
const newSettingsLines = [];

for (let line of settingsLines) {
    // Looking for <button class="opt-btn lang-btn" data-lang-file="FILENAME" ...
    if (line.includes('lang-btn') && line.includes('data-lang-file=')) {
        const match = line.match(/data-lang-file="([^"]+)"/);
        if (match) {
            const filename = match[1];
            if (isKept(filename)) {
                newSettingsLines.push(line);
            }
        } else {
            newSettingsLines.push(line);
        }
    } else {
        newSettingsLines.push(line);
    }
}

fs.writeFileSync(settingsPath, newSettingsLines.join('\n'));
console.log('Updated pages/settings.html');
