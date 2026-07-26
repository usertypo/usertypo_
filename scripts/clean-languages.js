/**
 * Clean ALL language files:
 * 1. Fix truncated contractions in English files
 * 2. Remove vulgar/foul/inappropriate words from ALL language files
 * 3. Generate a comprehensive report
 */
const fs = require('fs');
const path = require('path');

const LANG_DIR = path.resolve(__dirname, '..', 'lang');

// ── Truncated contractions (English-only) ──
const ENGLISH_TRUNCATION_FIXES = {
  'doesn':   'doesnt',
  'didn':    'didnt',
  'don':     'dont',
  'won':     'wont',
  'wouldn':  'wouldnt',
  'couldn':  'couldnt',
  'shouldn': 'shouldnt',
  'wasn':    'wasnt',
  'weren':   'werent',
  'hasn':    'hasnt',
  'haven':   'havent',
  'hadn':    'hadnt',
  'isn':     'isnt',
  'aren':    'arent',
  'ain':     'aint',
  'mustn':   'mustnt',
  'needn':   'neednt',
  'shan':    'shant',
  'mightn':  'mightnt',
  'daren':   'darent',
};

// ── Vulgar words in multiple languages ──
// English vulgar/offensive words
const ENGLISH_VULGAR = [
  'fuck','fucked','fucker','fuckers','fucking','fucks','fck','fuk',
  'shit','shits','shitty','shitting','bullshit',
  'ass','asses','asshole','assholes',
  'bitch','bitches','bitchy','bitching',
  'damn','damned','dammit','goddamn','goddamned',
  'crap','crappy',
  'bastard','bastards',
  'nigger','niggers','nigga','niggas',
  'retard','retarded','retards',
  'faggot','faggots','fag','fags',
  'dyke','dykes',
  'tranny','trannies',
  'spic','spics',
  'chink','chinks',
  'kike','kikes',
  'wetback','wetbacks',
  'beaner','beaners',
  'gook','gooks',
  'coon','coons',
  'penis','penises',
  'vagina','vaginas',
  'dick','dicks',
  'cock','cocks',
  'pussy','pussies',
  'tit','tits','titty','titties',
  'boob','boobs','booby',
  'dildo','dildos',
  'whore','whores',
  'slut','sluts','slutty',
  'porn','porno','pornography',
  'hoe','hoes',
  'cum','cumming',
  'orgasm','orgasms',
  'erection',
  'masturbate','masturbation',
  'blowjob','blowjobs',
  'handjob',
  'horny',
  'stripper','strippers',
  'prostitute','prostitutes','prostitution',
  'rape','raped','rapes','rapist','rapists',
  'molest','molested','molester',
  'pedophile','pedophiles',
  'incest','bestiality',
  'anal','anus','butthole',
  'clitoris','scrotum',
  'testicle','testicles',
  'ejaculate','ejaculation',
  'fetish','bondage','kinky','boner',
  'nympho',
  'poop','poopy','pooping','pooped','poops',
  'piss','pissed','pissing',
  'fart','farts','farting','farted',
  'diarrhea',
  'stoner','pothead','crackhead',
  'junkie','junkies',
  'meth','heroin','cocaine','ecstasy',
  'murder','murdered','murderer','murders',
  'kill','killed','killer','killers','killing','kills',
  'suicide',
  'terrorist','terrorists','terrorism',
  'genocide',
  'torture','tortured',
  'slaughter','slaughtered',
  'idiot','idiots','idiotic',
  'stupid','stupidity',
  'moron','morons','moronic',
  'dumb','dumber','dumbest','dumbass',
  'loser','losers',
  'creep','creepy','creeps',
  'pervert','perverts','pervy',
  'sicko',
  'psycho','psychos',
  'freak','freaks','freaky',
  'ugly','uglier','ugliest',
  'fat','fatty','fatso',
  'skinny','obese','lame',
  'suck','sucks','sucked','sucker','sucking',
  'screw','screwed',
  'butt','butts','crotch','groin',
  'pimp','pimps',
  'thug','thugs',
  'trash','trashy',
  'skank','skanky',
  'douche','douchebag',
  'jerk','jerks',
  'wanker','wankers',
  'twat','twats',
  'tosser','bellend',
  'bollocks','bugger',
  'prick','pricks',
  'bloody',
  'weed',
  'naked',
  'pee','peeing','peed',
  'vomit','barf','snot',
  'booger','boogers',
  'constipation',
  'retarded',
  'crackers',
];

// Spanish vulgar words
const SPANISH_VULGAR = [
  'puta','putas','puto','putos','putada',
  'mierda','mierdas',
  'joder','jodido','jodida',
  'coño','coños',
  'culo','culos',
  'verga','vergas',
  'pendejo','pendejos','pendeja','pendejas',
  'cabron','cabrón','cabrones',
  'chingar','chingada','chingado',
  'marica','maricon','maricón',
  'perra','perras',
  'idiota','idiotas',
  'estupido','estúpido','estupida','estúpida',
  'imbecil','imbécil',
  'gilipollas',
  'zorra','zorras',
  'mamada','mamadas',
  'cojones',
  'carajo',
  'maldito','maldita','malditos','malditas',
  'pinche',
  'culero','culera',
  'huevon','huevón',
  'tonto','tonta','tontos','tontas',
];

// French vulgar words
const FRENCH_VULGAR = [
  'merde','merdes',
  'putain','putains',
  'salaud','salauds','salope','salopes',
  'connard','connards','connasse','connasses',
  'enculer','enculé','enculée',
  'baiser','baisé','baisée',
  'foutre','fous','foutu','foutue',
  'bordel',
  'chier','chié',
  'couille','couilles',
  'bite','bites',
  'nique','niquer','niqué',
  'pédé','pédés',
  'gouine','gouines',
  'imbécile','imbéciles',
  'idiot','idiote','idiots','idiotes',
  'stupide','stupides',
  'con','conne','cons','connes',
  'abruti','abrutie','abrutis',
  'crétin','crétine','crétins',
  'débile','débiles',
  'branleur','branleurs','branleuse',
  'cul','culs',
  'pétasse',
  'pouffiasse',
  'tarlouze',
];

// German vulgar words
const GERMAN_VULGAR = [
  'scheiße','scheisse','scheiss',
  'arsch','arschloch',
  'ficken','fick','gefickt',
  'hurensohn',
  'hure','huren',
  'schwanz',
  'fotze',
  'wichser','wichsen',
  'schlampe','schlampen',
  'drecksau',
  'mistkerl',
  'idiot','idioten',
  'dumm','dummkopf',
  'blöd','blödmann',
  'trottel',
  'depp','deppen',
  'vollidiot',
  'penner',
  'assi',
  'schwuchtel',
  'tunte',
];

// Portuguese vulgar words
const PORTUGUESE_VULGAR = [
  'merda','merdas',
  'puta','putas','puto','putos',
  'caralho','caralhos',
  'foder','fodido','fodida','foda',
  'buceta','boceta',
  'cuzão','cuzao',
  'viado','viados',
  'bicha','bichas',
  'otário','otario','otária',
  'babaca','babacas',
  'idiota','idiotas',
  'imbecil','imbecis',
  'estúpido','estupido','estúpida','estupida',
  'burro','burra','burros','burras',
  'vadia','vadias',
  'piranha','piranhas',
  'desgraçado','desgraçada','desgraça',
  'cretino','cretina',
  'bosta',
  'cu','cú',
  'pau','paus',
];

// Italian vulgar words
const ITALIAN_VULGAR = [
  'cazzo','cazzi',
  'merda','merde',
  'stronzo','stronza','stronzi',
  'puttana','puttane',
  'figa','fighe',
  'minchia',
  'vaffanculo',
  'coglione','coglioni',
  'idiota','idioti',
  'stupido','stupida','stupidi',
  'cretino','cretina','cretini',
  'imbecille','imbecilli',
  'deficiente','deficienti',
  'porco','porca',
  'troia','troie',
  'bastardo','bastarda','bastardi',
  'frocio','froci',
  'finocchio',
  'cornuto','cornuta',
  'culo','culi',
  'tette',
  'scopare','scopata',
];

// Dutch vulgar words
const DUTCH_VULGAR = [
  'godverdomme','verdomme',
  'kut','kutje',
  'lul','lullen',
  'klootzak','klootzakken',
  'hoer','hoeren',
  'neuken','geneukt',
  'schijt',
  'tyfus',
  'kanker',
  'tering',
  'mongool','mongolen',
  'debiel','debielen',
  'idioot','idioten',
  'sukkel','sukkels',
  'eikel','eikels',
  'stomme','stom',
];

// Turkish vulgar words
const TURKISH_VULGAR = [
  'siktir','siktirgit',
  'orospu',
  'amına','amina',
  'göt','got',
  'yarrak',
  'piç',
  'gavat',
  'ibne',
  'aptal','aptalar',
  'salak','salaklar',
  'gerizekalı','gerizekali',
  'mal',
  'dangalak',
  'hıyar',
  'pezevenk',
];

// Indonesian/Malay vulgar words
const INDONESIAN_VULGAR = [
  'kontol','memek',
  'bego','goblok',
  'anjing','bangsat',
  'bajingan','keparat',
  'tolol','bodoh',
  'brengsek',
  'sialan',
  'kampret','kampung',
  'jancok','jancuk',
  'asu',
  'setan',
];

// Build the master vulgar set per language prefix
function buildVulgarSet(langPrefix) {
  const set = new Set(ENGLISH_VULGAR.map(w => w.toLowerCase()));
  
  if (langPrefix === 'spanish') {
    SPANISH_VULGAR.forEach(w => set.add(w.toLowerCase()));
  } else if (langPrefix === 'french') {
    FRENCH_VULGAR.forEach(w => set.add(w.toLowerCase()));
  } else if (langPrefix === 'german') {
    GERMAN_VULGAR.forEach(w => set.add(w.toLowerCase()));
  } else if (langPrefix.startsWith('portuguese')) {
    PORTUGUESE_VULGAR.forEach(w => set.add(w.toLowerCase()));
  } else if (langPrefix === 'italian') {
    ITALIAN_VULGAR.forEach(w => set.add(w.toLowerCase()));
  } else if (langPrefix === 'dutch') {
    DUTCH_VULGAR.forEach(w => set.add(w.toLowerCase()));
  } else if (langPrefix === 'turkish') {
    TURKISH_VULGAR.forEach(w => set.add(w.toLowerCase()));
  } else if (langPrefix === 'indonesian' || langPrefix === 'malay') {
    INDONESIAN_VULGAR.forEach(w => set.add(w.toLowerCase()));
  }
  
  return set;
}

// Get language prefix from filename (e.g. "english_1T.json" → "english")
function getLangPrefix(filename) {
  return filename.replace(/(_\d+T)?\.json$/, '');
}

function isEnglish(filename) {
  return filename.startsWith('english') && !filename.startsWith('english_ze');
}

// Skip code_ files — they're programming language snippets, not natural language
function isCodeFile(filename) {
  return filename.startsWith('code_');
}

// ── Process all files ──
const files = fs.readdirSync(LANG_DIR).filter(f => f.endsWith('.json'));
const report = {};
let totalTruncFixed = 0;
let totalVulgarRemoved = 0;
let filesChanged = 0;

for (const filename of files) {
  if (isCodeFile(filename)) continue;
  
  const filepath = path.join(LANG_DIR, filename);
  const raw = fs.readFileSync(filepath, 'utf8');
  
  let words;
  try {
    words = JSON.parse(raw);
  } catch (e) {
    console.log(`⚠️  Skipping ${filename} — invalid JSON`);
    continue;
  }
  
  if (!Array.isArray(words)) {
    console.log(`⚠️  Skipping ${filename} — not a word array`);
    continue;
  }

  const langPrefix = getLangPrefix(filename);
  const isEng = isEnglish(filename);
  const vulgarSet = buildVulgarSet(langPrefix);
  const totalBefore = words.length;
  
  const fixes = [];
  const removed = [];
  const result = [];

  for (const word of words) {
    const lower = word.toLowerCase();

    // Fix truncated contractions (English only)
    if (isEng && ENGLISH_TRUNCATION_FIXES[lower]) {
      const fixed = ENGLISH_TRUNCATION_FIXES[lower];
      fixes.push({ from: word, to: fixed });
      result.push(fixed);
      continue;
    }

    // Remove vulgar words
    if (vulgarSet.has(lower)) {
      removed.push(word);
      continue;
    }

    result.push(word);
  }

  // Deduplicate
  const seen = new Set();
  const deduped = [];
  for (const w of result) {
    const key = w.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(w);
    }
  }

  if (fixes.length > 0 || removed.length > 0) {
    fs.writeFileSync(filepath, JSON.stringify(deduped, null, 2) + '\n', 'utf8');
    
    report[filename] = {
      truncationsFixed: fixes,
      vulgarRemoved: removed,
      totalBefore,
      totalAfter: deduped.length,
    };
    
    totalTruncFixed += fixes.length;
    totalVulgarRemoved += removed.length;
    filesChanged++;
    
    console.log(`✅ ${filename}: ${fixes.length} truncations, ${removed.length} vulgar removed (${totalBefore} → ${deduped.length})`);
  }
}

console.log(`\n══════════════════════════════════════`);
console.log(`📊 Total: ${filesChanged} files changed, ${totalTruncFixed} truncations fixed, ${totalVulgarRemoved} vulgar words removed`);

// Write full report
const reportPath = path.resolve(__dirname, '..', 'language-cleanup-report-all.json');
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(`📝 Full report: ${reportPath}`);
