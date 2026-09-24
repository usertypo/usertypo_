'use strict';
const fs = require('fs');
const path = require('path');

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name === '.git' || e.name === '.font-cache') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.(html|js|css)$/.test(e.name) && !e.name.includes('page-fragments')) acc.push(p);
  }
  return acc;
}

const icons = new Set();

function addIcon(name) {
  if (!name || !/^[a-z][a-z0-9_]*$/.test(name)) return;
  // Digits-only / tiny tokens are never Material Symbols names.
  if (/^\d+$/.test(name) || name.length < 3) return;
  icons.add(name);
}

const re = /material-symbols-outlined[^>]{0,300}>\s*([a-z0-9_]+)/gi;
const reInner = /<span[^>]*material-symbols-outlined[^>]*>\s*([a-z0-9_]+)\s*</gi;
const reTextContent = /(?:textContent|innerText)\s*=\s*['"`]([a-z][a-z0-9_]{2,})['"`]/g;
const reToast = /(?:toast|showToast)\s*\(\s*(?:[^,)]*,\s*)?['"`]([a-z][a-z0-9_]{2,})['"`]\s*\)/gi;
const reDataIcon = /data-(?:sub-)?icon=['"`]([a-z][a-z0-9_]{2,})['"`]/gi;
const reJsHtml = /['"`]material-symbols-outlined[^'"`]*['"`][^;]{0,160}>\s*([a-z0-9_]+)/g;

// Bare UI/config strings that look like snake_case but are not icons.
const notIcon = new Set([
  'reset', 'export', 'hidden', 'none', 'auto', 'flex', 'grid', 'true', 'false',
  'success', 'advanced', 'day', 'mode', 'time', 'words', 'personal', 'punctuation',
  'numbers', 'english', 'custom', 'active', 'inactive', 'online', 'offline',
]);

for (const f of walk('.')) {
  const t = fs.readFileSync(f, 'utf8');
  let m;
  while ((m = re.exec(t))) addIcon(m[1]);
  while ((m = reInner.exec(t))) addIcon(m[1]);
  while ((m = reTextContent.exec(t))) {
    if (!notIcon.has(m[1])) addIcon(m[1]);
  }
  while ((m = reToast.exec(t))) {
    if (!notIcon.has(m[1])) addIcon(m[1]);
  }
  while ((m = reDataIcon.exec(t))) addIcon(m[1]);
  while ((m = reJsHtml.exec(t))) addIcon(m[1]);
}

// Dynamically assigned icons (header/auth/notifications/modals/toasts)
[
  'login','logout','person','volume_off','volume_up','download','warning','error',
  'check_circle','info','close','refresh','progress_activity','swords','group',
  'notifications','settings','keyboard','emoji_events','palette','mail','build',
  'school','photo_camera','search','search_off','filter_alt','workspace_premium','view_list',
  'text_fields','schedule','alternate_email','tag','speed','my_location','show_chart',
  'drag_indicator','ads_click','group_off','person_add_disabled','smart_toy',
  'keyboard_arrow_up','keyboard_arrow_down','keyboard_arrow_left','keyboard_arrow_right',
  'chevron_right','chevron_left','expand_more','expand_less','arrow_back','arrow_forward',
  'check','add','remove','edit','delete','block','content_copy','visibility','visibility_off',
  'lock','lock_open','tune','translate','dark_mode','light_mode','history','account_circle',
  'manage_accounts','security','policy','gavel','cookie','send','inbox','done','bolt',
  'local_fire_department','military_tech','person_add','person_remove','forum','chat',
  'play_arrow','pause','stop','replay','star','favorite','link','open_in_new','help',
  'menu','more_vert','more_horiz','filter_list','sort','trending_up','insights','bar_chart',
  'calendar_month','campaign','sports_esports','timelapse','abc','backspace',
  // Confirm modal / settings — missing these causes partial ligatures (restart_alt → star)
  'restart_alt','library_music','font_download','bookmark','bookmark_add','color_lens',
  'settings_suggest','shortcut','pace','graphic_eq','edit_square','all_inclusive',
  // Header admin control — missing glyph renders as raw ligature text
  'admin_panel_settings','switch_account',
  // Header chill toggle (pause saving tests)
  'spa',
].forEach(addIcon);

const list = [...icons].filter(Boolean).sort();
console.log(list.join(','));
console.log('COUNT', list.length);
fs.writeFileSync('scripts/.icon-names.txt', list.join(','));
fs.writeFileSync('scripts/.icon-text.txt', list.join(' '));
