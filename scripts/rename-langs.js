const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const LANG_DIR = path.resolve(__dirname, '..', 'lang');

// 1. Remove Chinese variants
const files = fs.readdirSync(LANG_DIR);
for (const file of files) {
    if (file.startsWith('chinese_simplified') || 
        file.startsWith('chinese_traditional') || 
        file.startsWith('chinese_ze')) {
        console.log(`Deleting ${file}`);
        execSync(`git rm "lang/${file}" -f`, { cwd: path.resolve(__dirname, '..') });
    }
}

// 2. Remove 2T, 5T, 10T for specific languages
const TRUNCATE_LANGS = ['arabic', 'chinese', 'greek', 'hindi', 'indonesian', 'japanese', 'korean', 'russian'];
const TRUNCATE_SUFFIXES = ['_2T.json', '_5T.json', '_10T.json', '_2k.json', '_5k.json', '_10k.json'];

for (const lang of TRUNCATE_LANGS) {
    for (const suffix of TRUNCATE_SUFFIXES) {
        const file = `${lang}${suffix}`;
        if (fs.existsSync(path.join(LANG_DIR, file))) {
            console.log(`Deleting ${file}`);
            try {
                execSync(`git rm "lang/${file}" -f`, { cwd: path.resolve(__dirname, '..') });
            } catch (e) {
                // Ignore if it was not tracked in git
                fs.unlinkSync(path.join(LANG_DIR, file));
            }
        }
    }
}

// 3. Rename T to k in lang directory
const remainingFiles = fs.readdirSync(LANG_DIR);
for (const file of remainingFiles) {
    if (file.match(/_(\d+)T\.json$/)) {
        const newFile = file.replace(/_(\d+)T\.json$/, '_$1k.json');
        console.log(`Renaming ${file} to ${newFile}`);
        try {
            execSync(`git mv "lang/${file}" "lang/${newFile}"`, { cwd: path.resolve(__dirname, '..') });
        } catch(e) {
            fs.renameSync(path.join(LANG_DIR, file), path.join(LANG_DIR, newFile));
        }
    }
}

// 4. Update languages.js
const langJsPath = path.resolve(__dirname, '..', 'languages.js');
let langJs = fs.readFileSync(langJsPath, 'utf8');

// Remove the line: filename = filename.replace(/_(\d+)k$/i, '_$1T');
langJs = langJs.split('\n').filter(line => !line.includes('filename = filename.replace(/_(\\d+)k$/i,')).join('\n');
// Clean up ALL_LANGUAGES array
const lines = langJs.split('\n');
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
        const match = line.match(/file:\s*"([^"]+)"/);
        if (match) {
            const fileKey = match[1];
            
            // Filter out Chinese variants
            if (fileKey.startsWith('chinese_simplified') || 
                fileKey.startsWith('chinese_traditional') || 
                fileKey.startsWith('chinese_ze')) {
                continue;
            }
            
            // Filter out 2k, 5k, 10k for truncated langs
            let skip = false;
            for (const lang of TRUNCATE_LANGS) {
                if (fileKey === `${lang}_2k` || fileKey === `${lang}_5k` || fileKey === `${lang}_10k`) {
                    skip = true;
                    break;
                }
            }
            if (skip) continue;
            
            newLines.push(line);
        } else {
            newLines.push(line);
        }
    } else {
        newLines.push(line);
    }
}

fs.writeFileSync(langJsPath, newLines.join('\n'));
console.log('Updated languages.js');

// 5. Update settings.html
const settingsPath = path.resolve(__dirname, '..', 'pages', 'settings.html');
let settingsHtml = fs.readFileSync(settingsPath, 'utf8');

const settingsLines = settingsHtml.split('\n');
const newSettingsLines = [];

for (let line of settingsLines) {
    if (line.includes('lang-btn') && line.includes('data-lang-file=')) {
        const match = line.match(/data-lang-file="([^"]+)"/);
        if (match) {
            let fileKey = match[1];
            
            // Normalize T to k in data-lang-file
            fileKey = fileKey.replace(/_(\d+)T$/, '_$1k');
            
            // Filter out Chinese variants
            if (fileKey.startsWith('chinese_simplified') || 
                fileKey.startsWith('chinese_traditional') || 
                fileKey.startsWith('chinese_ze')) {
                continue;
            }
            
            // Filter out 2k, 5k, 10k for truncated langs
            let skip = false;
            for (const lang of TRUNCATE_LANGS) {
                if (fileKey === `${lang}_2k` || fileKey === `${lang}_5k` || fileKey === `${lang}_10k`) {
                    skip = true;
                    break;
                }
            }
            if (skip) continue;
            
            // Update line text (T to k)
            line = line.replace(/_(\d+)T"/, '_$1k"');
            
            // Update UI text (e.g. >English 10t< to >English 10k<)
            line = line.replace(/>([^<]*?)(\d+)t</ig, '>$1$2k<');
            
            newSettingsLines.push(line);
        } else {
            newSettingsLines.push(line);
        }
    } else {
        newSettingsLines.push(line);
    }
}

fs.writeFileSync(settingsPath, newSettingsLines.join('\n'));
console.log('Updated pages/settings.html');
