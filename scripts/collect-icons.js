'use strict';
const fs = require('fs');
const path = require('path');

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name === '.git') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.(html|js|css)$/.test(e.name) && !e.name.includes('page-fragments')) acc.push(p);
  }
  return acc;
}

const icons = new Set();
const re = /material-symbols-outlined[^>]{0,200}>\s*([a-z0-9_]+)/gi;
const reInner = /<span[^>]*material-symbols-outlined[^>]*>\s*([a-z0-9_]+)\s*</gi;
const reJs = /(?:textContent|innerHTML)\s*=\s*['"`]([a-z0-9_]+)['"`]/g;
const reJs2 = /['"`](material-symbols-outlined[^'"`]*)['"`][^;]{0,120}>([a-z0-9_]+)</g;

for (const f of walk('.')) {
  const t = fs.readFileSync(f, 'utf8');
  let m;
  while ((m = re.exec(t))) icons.add(m[1]);
  while ((m = reInner.exec(t))) icons.add(m[1]);
}

// Common dynamically assigned icons from header/auth/notifications
[
  'login','logout','person','volume_off','volume_up','download','warning','error',
  'check_circle','info','close','refresh','progress_activity','swords','group',
  'notifications','settings','keyboard','emoji_events','palette','mail','build',
  'photo_camera','search','search_off','filter_alt','workspace_premium','view_list',
  'text_fields','schedule','alternate_email','tag','speed','my_location','show_chart',
  'drag_indicator','ads_click','group_off','person_add_disabled','smart_toy',
  'keyboard_arrow_up','keyboard_arrow_down','keyboard_arrow_left','keyboard_arrow_right',
  'chevron_right','chevron_left','expand_more','expand_less','arrow_back','arrow_forward',
  'check','add','remove','edit','delete','block','content_copy','visibility','visibility_off',
  'lock','tune','translate','dark_mode','light_mode','history','account_circle',
  'manage_accounts','security','policy','gavel','cookie','send','inbox','done','bolt',
  'local_fire_department','military_tech','person_add','person_remove','forum','chat',
  'play_arrow','pause','stop','replay','star','favorite','link','open_in_new','help',
  'menu','more_vert','more_horiz','filter_list','sort','trending_up','insights','bar_chart',
  'calendar_month','campaign','sports_esports','timelapse','schedule','abc','backspace'
].forEach((i) => icons.add(i));

const list = [...icons].filter(Boolean).sort();
console.log(list.join(','));
console.log('COUNT', list.length);
fs.writeFileSync('scripts/.icon-names.txt', list.join(','));
