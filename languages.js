// ═══════════════════════════════════════════════════════════════
//  LANGUAGES – Master language list & dynamic word list loader
// ═══════════════════════════════════════════════════════════════

// All available languages with metadata
const ALL_LANGUAGES = [
    { file: "afrikaans", name: "Afrikaans", category: "natural" },
    { file: "afrikaans_10k", name: "Afrikaans 10k", category: "natural" },
    { file: "afrikaans_1k", name: "Afrikaans 1k", category: "natural" },
    { file: "albanian", name: "Albanian", category: "natural" },
    { file: "albanian_1k", name: "Albanian 1k", category: "natural" },
    { file: "amharic", name: "Amharic", category: "natural" },
    { file: "amharic_1k", name: "Amharic 1k", category: "natural" },
    { file: "amharic_5k", name: "Amharic 5k", category: "natural" },
    { file: "arabic", name: "Arabic", category: "natural" },
    { file: "arabic_10k", name: "Arabic 10k", category: "natural" },
    { file: "arabic_egypt", name: "Arabic Egypt", category: "natural" },
    { file: "arabic_egypt_1k", name: "Arabic Egypt 1k", category: "natural" },
    { file: "arabic_morocco", name: "Arabic Morocco", category: "natural" },
    { file: "armenian", name: "Armenian", category: "natural" },
    { file: "armenian_1k", name: "Armenian 1k", category: "natural" },
    { file: "armenian_western", name: "Armenian Western", category: "natural" },
    { file: "armenian_western_1k", name: "Armenian Western 1k", category: "natural" },
    { file: "azerbaijani", name: "Azerbaijani", category: "natural" },
    { file: "azerbaijani_1k", name: "Azerbaijani 1k", category: "natural" },
    { file: "bangla", name: "Bangla", category: "natural" },
    { file: "bangla_10k", name: "Bangla 10k", category: "natural" },
    { file: "bangla_letters", name: "Bangla Letters", category: "natural" },
    { file: "bashkir", name: "Bashkir", category: "natural" },
    { file: "belarusian", name: "Belarusian", category: "natural" },
    { file: "belarusian_100k", name: "Belarusian 100k", category: "natural" },
    { file: "belarusian_10k", name: "Belarusian 10k", category: "natural" },
    { file: "belarusian_1k", name: "Belarusian 1k", category: "natural" },
    { file: "belarusian_25k", name: "Belarusian 25k", category: "natural" },
    { file: "belarusian_50k", name: "Belarusian 50k", category: "natural" },
    { file: "belarusian_5k", name: "Belarusian 5k", category: "natural" },
    { file: "belarusian_lacinka", name: "Belarusian Lacinka", category: "natural" },
    { file: "belarusian_lacinka_1k", name: "Belarusian Lacinka 1k", category: "natural" },
    { file: "bosnian", name: "Bosnian", category: "natural" },
    { file: "bosnian_4k", name: "Bosnian 4k", category: "natural" },
    { file: "bulgarian", name: "Bulgarian", category: "natural" },
    { file: "bulgarian_1k", name: "Bulgarian 1k", category: "natural" },
    { file: "bulgarian_latin", name: "Bulgarian Latin", category: "natural" },
    { file: "bulgarian_latin_1k", name: "Bulgarian Latin 1k", category: "natural" },
    { file: "catalan", name: "Catalan", category: "natural" },
    { file: "catalan_1k", name: "Catalan 1k", category: "natural" },
    { file: "chinese_simplified", name: "Chinese Simplified", category: "natural" },
    { file: "chinese_simplified_10k", name: "Chinese Simplified 10k", category: "natural" },
    { file: "chinese_simplified_1k", name: "Chinese Simplified 1k", category: "natural" },
    { file: "chinese_simplified_50k", name: "Chinese Simplified 50k", category: "natural" },
    { file: "chinese_simplified_5k", name: "Chinese Simplified 5k", category: "natural" },
    { file: "chinese_traditional", name: "Chinese Traditional", category: "natural" },
    { file: "croatian", name: "Croatian", category: "natural" },
    { file: "croatian_1k", name: "Croatian 1k", category: "natural" },
    { file: "czech", name: "Czech", category: "natural" },
    { file: "czech_10k", name: "Czech 10k", category: "natural" },
    { file: "czech_1k", name: "Czech 1k", category: "natural" },
    { file: "danish", name: "Danish", category: "natural" },
    { file: "danish_10k", name: "Danish 10k", category: "natural" },
    { file: "danish_1k", name: "Danish 1k", category: "natural" },
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
    { file: "esperanto", name: "Esperanto", category: "natural" },
    { file: "esperanto_10k", name: "Esperanto 10k", category: "natural" },
    { file: "esperanto_1k", name: "Esperanto 1k", category: "natural" },
    { file: "esperanto_25k", name: "Esperanto 25k", category: "natural" },
    { file: "esperanto_36k", name: "Esperanto 36k", category: "natural" },
    { file: "esperanto_h_sistemo", name: "Esperanto H Sistemo", category: "natural" },
    { file: "esperanto_h_sistemo_10k", name: "Esperanto H Sistemo 10k", category: "natural" },
    { file: "esperanto_h_sistemo_1k", name: "Esperanto H Sistemo 1k", category: "natural" },
    { file: "esperanto_h_sistemo_25k", name: "Esperanto H Sistemo 25k", category: "natural" },
    { file: "esperanto_h_sistemo_36k", name: "Esperanto H Sistemo 36k", category: "natural" },
    { file: "esperanto_x_sistemo", name: "Esperanto X Sistemo", category: "natural" },
    { file: "esperanto_x_sistemo_10k", name: "Esperanto X Sistemo 10k", category: "natural" },
    { file: "esperanto_x_sistemo_1k", name: "Esperanto X Sistemo 1k", category: "natural" },
    { file: "esperanto_x_sistemo_25k", name: "Esperanto X Sistemo 25k", category: "natural" },
    { file: "esperanto_x_sistemo_36k", name: "Esperanto X Sistemo 36k", category: "natural" },
    { file: "estonian", name: "Estonian", category: "natural" },
    { file: "estonian_10k", name: "Estonian 10k", category: "natural" },
    { file: "estonian_1k", name: "Estonian 1k", category: "natural" },
    { file: "estonian_5k", name: "Estonian 5k", category: "natural" },
    { file: "euskera", name: "Euskera", category: "natural" },
    { file: "filipino", name: "Filipino", category: "natural" },
    { file: "filipino_1k", name: "Filipino 1k", category: "natural" },
    { file: "finnish", name: "Finnish", category: "natural" },
    { file: "finnish_10k", name: "Finnish 10k", category: "natural" },
    { file: "finnish_1k", name: "Finnish 1k", category: "natural" },
    { file: "french", name: "French", category: "natural" },
    { file: "french_10k", name: "French 10k", category: "natural" },
    { file: "french_1k", name: "French 1k", category: "natural" },
    { file: "french_2k", name: "French 2k", category: "natural" },
    { file: "french_600k", name: "French 600k", category: "natural" },
    { file: "french_bitoduc", name: "French Bitoduc", category: "natural" },
    { file: "frisian", name: "Frisian", category: "natural" },
    { file: "frisian_1k", name: "Frisian 1k", category: "natural" },
    { file: "friulian", name: "Friulian", category: "natural" },
    { file: "galician", name: "Galician", category: "natural" },
    { file: "georgian", name: "Georgian", category: "natural" },
    { file: "german", name: "German", category: "natural" },
    { file: "german_10k", name: "German 10k", category: "natural" },
    { file: "german_1k", name: "German 1k", category: "natural" },
    { file: "german_250k", name: "German 250k", category: "natural" },
    { file: "greek", name: "Greek", category: "natural" },
    { file: "greek_10k", name: "Greek 10k", category: "natural" },
    { file: "greek_1k", name: "Greek 1k", category: "natural" },
    { file: "greek_25k", name: "Greek 25k", category: "natural" },
    { file: "greek_5k", name: "Greek 5k", category: "natural" },
    { file: "greeklish", name: "Greeklish", category: "natural" },
    { file: "greeklish_10k", name: "Greeklish 10k", category: "natural" },
    { file: "greeklish_1k", name: "Greeklish 1k", category: "natural" },
    { file: "greeklish_25k", name: "Greeklish 25k", category: "natural" },
    { file: "greeklish_5k", name: "Greeklish 5k", category: "natural" },
    { file: "gujarati", name: "Gujarati", category: "natural" },
    { file: "gujarati_1k", name: "Gujarati 1k", category: "natural" },
    { file: "hausa", name: "Hausa", category: "natural" },
    { file: "hausa_1k", name: "Hausa 1k", category: "natural" },
    { file: "hawaiian", name: "Hawaiian", category: "natural" },
    { file: "hawaiian_1k", name: "Hawaiian 1k", category: "natural" },
    { file: "hebrew", name: "Hebrew", category: "natural" },
    { file: "hebrew_10k", name: "Hebrew 10k", category: "natural" },
    { file: "hebrew_1k", name: "Hebrew 1k", category: "natural" },
    { file: "hebrew_5k", name: "Hebrew 5k", category: "natural" },
    { file: "hindi", name: "Hindi", category: "natural" },
    { file: "hindi_1k", name: "Hindi 1k", category: "natural" },
    { file: "hinglish", name: "Hinglish", category: "natural" },
    { file: "hungarian", name: "Hungarian", category: "natural" },
    { file: "hungarian_1k", name: "Hungarian 1k", category: "natural" },
    { file: "hungarian_2k", name: "Hungarian 2k", category: "natural" },
    { file: "icelandic", name: "Icelandic", category: "natural" },
    { file: "icelandic_1k", name: "Icelandic 1k", category: "natural" },
    { file: "indonesian", name: "Indonesian", category: "natural" },
    { file: "indonesian_10k", name: "Indonesian 10k", category: "natural" },
    { file: "indonesian_1k", name: "Indonesian 1k", category: "natural" },
    { file: "irish", name: "Irish", category: "natural" },
    { file: "italian", name: "Italian", category: "natural" },
    { file: "italian_1k", name: "Italian 1k", category: "natural" },
    { file: "italian_280k", name: "Italian 280k", category: "natural" },
    { file: "italian_60k", name: "Italian 60k", category: "natural" },
    { file: "italian_7k", name: "Italian 7k", category: "natural" },
    { file: "japanese_hiragana", name: "Japanese Hiragana", category: "natural" },
    { file: "japanese_katakana", name: "Japanese Katakana", category: "natural" },
    { file: "japanese_romaji", name: "Japanese Romaji", category: "natural" },
    { file: "japanese_romaji_1k", name: "Japanese Romaji 1k", category: "natural" },
    { file: "jyutping", name: "Jyutping", category: "natural" },
    { file: "kabyle", name: "Kabyle", category: "natural" },
    { file: "kabyle_10k", name: "Kabyle 10k", category: "natural" },
    { file: "kabyle_1k", name: "Kabyle 1k", category: "natural" },
    { file: "kabyle_2k", name: "Kabyle 2k", category: "natural" },
    { file: "kabyle_5k", name: "Kabyle 5k", category: "natural" },
    { file: "kannada", name: "Kannada", category: "natural" },
    { file: "kazakh", name: "Kazakh", category: "natural" },
    { file: "kazakh_1k", name: "Kazakh 1k", category: "natural" },
    { file: "khmer", name: "Khmer", category: "natural" },
    { file: "kinyarwanda", name: "Kinyarwanda", category: "natural" },
    { file: "korean", name: "Korean", category: "natural" },
    { file: "korean_1k", name: "Korean 1k", category: "natural" },
    { file: "korean_5k", name: "Korean 5k", category: "natural" },
    { file: "kurdish_central", name: "Kurdish Central", category: "natural" },
    { file: "kurdish_central_2k", name: "Kurdish Central 2k", category: "natural" },
    { file: "kurdish_central_4k", name: "Kurdish Central 4k", category: "natural" },
    { file: "kyrgyz", name: "Kyrgyz", category: "natural" },
    { file: "kyrgyz_1k", name: "Kyrgyz 1k", category: "natural" },
    { file: "latin", name: "Latin", category: "natural" },
    { file: "latvian", name: "Latvian", category: "natural" },
    { file: "latvian_1k", name: "Latvian 1k", category: "natural" },
    { file: "lithuanian", name: "Lithuanian", category: "natural" },
    { file: "lithuanian_1k", name: "Lithuanian 1k", category: "natural" },
    { file: "lithuanian_3k", name: "Lithuanian 3k", category: "natural" },
    { file: "macedonian", name: "Macedonian", category: "natural" },
    { file: "macedonian_10k", name: "Macedonian 10k", category: "natural" },
    { file: "macedonian_1k", name: "Macedonian 1k", category: "natural" },
    { file: "macedonian_75k", name: "Macedonian 75k", category: "natural" },
    { file: "malagasy", name: "Malagasy", category: "natural" },
    { file: "malagasy_1k", name: "Malagasy 1k", category: "natural" },
    { file: "malay", name: "Malay", category: "natural" },
    { file: "malay_1k", name: "Malay 1k", category: "natural" },
    { file: "malayalam", name: "Malayalam", category: "natural" },
    { file: "maltese", name: "Maltese", category: "natural" },
    { file: "maltese_1k", name: "Maltese 1k", category: "natural" },
    { file: "maori_1k", name: "Maori 1k", category: "natural" },
    { file: "marathi", name: "Marathi", category: "natural" },
    { file: "mongolian", name: "Mongolian", category: "natural" },
    { file: "mongolian_10k", name: "Mongolian 10k", category: "natural" },
    { file: "myanmar_burmese", name: "Myanmar Burmese", category: "natural" },
    { file: "nepali", name: "Nepali", category: "natural" },
    { file: "nepali_1k", name: "Nepali 1k", category: "natural" },
    { file: "nepali_romanized", name: "Nepali Romanized", category: "natural" },
    { file: "norwegian_bokmal", name: "Norwegian Bokmal", category: "natural" },
    { file: "norwegian_bokmal_10k", name: "Norwegian Bokmal 10k", category: "natural" },
    { file: "norwegian_bokmal_150k", name: "Norwegian Bokmal 150k", category: "natural" },
    { file: "norwegian_bokmal_1k", name: "Norwegian Bokmal 1k", category: "natural" },
    { file: "norwegian_bokmal_5k", name: "Norwegian Bokmal 5k", category: "natural" },
    { file: "norwegian_bokmal_600k", name: "Norwegian Bokmal 600k", category: "natural" },
    { file: "norwegian_nynorsk", name: "Norwegian Nynorsk", category: "natural" },
    { file: "norwegian_nynorsk_100k", name: "Norwegian Nynorsk 100k", category: "natural" },
    { file: "norwegian_nynorsk_10k", name: "Norwegian Nynorsk 10k", category: "natural" },
    { file: "norwegian_nynorsk_1k", name: "Norwegian Nynorsk 1k", category: "natural" },
    { file: "norwegian_nynorsk_400k", name: "Norwegian Nynorsk 400k", category: "natural" },
    { file: "norwegian_nynorsk_5k", name: "Norwegian Nynorsk 5k", category: "natural" },
    { file: "occitan", name: "Occitan", category: "natural" },
    { file: "occitan_10k", name: "Occitan 10k", category: "natural" },
    { file: "occitan_1k", name: "Occitan 1k", category: "natural" },
    { file: "occitan_2k", name: "Occitan 2k", category: "natural" },
    { file: "occitan_5k", name: "Occitan 5k", category: "natural" },
    { file: "oromo", name: "Oromo", category: "natural" },
    { file: "oromo_1k", name: "Oromo 1k", category: "natural" },
    { file: "oromo_5k", name: "Oromo 5k", category: "natural" },
    { file: "pashto", name: "Pashto", category: "natural" },
    { file: "persian", name: "Persian", category: "natural" },
    { file: "persian_1k", name: "Persian 1k", category: "natural" },
    { file: "persian_20k", name: "Persian 20k", category: "natural" },
    { file: "persian_5k", name: "Persian 5k", category: "natural" },
    { file: "persian_romanized", name: "Persian Romanized", category: "natural" },
    { file: "pinyin", name: "Pinyin", category: "natural" },
    { file: "pinyin_10k", name: "Pinyin 10k", category: "natural" },
    { file: "pinyin_1k", name: "Pinyin 1k", category: "natural" },
    { file: "polish", name: "Polish", category: "natural" },
    { file: "polish_10k", name: "Polish 10k", category: "natural" },
    { file: "polish_200k", name: "Polish 200k", category: "natural" },
    { file: "polish_20k", name: "Polish 20k", category: "natural" },
    { file: "polish_2k", name: "Polish 2k", category: "natural" },
    { file: "polish_40k", name: "Polish 40k", category: "natural" },
    { file: "polish_5k", name: "Polish 5k", category: "natural" },
    { file: "portuguese", name: "Portuguese", category: "natural" },
    { file: "portuguese_1k", name: "Portuguese 1k", category: "natural" },
    { file: "portuguese_320k", name: "Portuguese 320k", category: "natural" },
    { file: "portuguese_3k", name: "Portuguese 3k", category: "natural" },
    { file: "portuguese_550k", name: "Portuguese 550k", category: "natural" },
    { file: "portuguese_5k", name: "Portuguese 5k", category: "natural" },
    { file: "portuguese_acentos_e_cedilha", name: "Portuguese Acentos E Cedilha", category: "natural" },
    { file: "romanian", name: "Romanian", category: "natural" },
    { file: "romanian_100k", name: "Romanian 100k", category: "natural" },
    { file: "romanian_10k", name: "Romanian 10k", category: "natural" },
    { file: "romanian_1k", name: "Romanian 1k", category: "natural" },
    { file: "romanian_200k", name: "Romanian 200k", category: "natural" },
    { file: "romanian_25k", name: "Romanian 25k", category: "natural" },
    { file: "romanian_50k", name: "Romanian 50k", category: "natural" },
    { file: "romanian_5k", name: "Romanian 5k", category: "natural" },
    { file: "russian", name: "Russian", category: "natural" },
    { file: "russian_10k", name: "Russian 10k", category: "natural" },
    { file: "russian_1k", name: "Russian 1k", category: "natural" },
    { file: "russian_25k", name: "Russian 25k", category: "natural" },
    { file: "russian_375k", name: "Russian 375k", category: "natural" },
    { file: "russian_50k", name: "Russian 50k", category: "natural" },
    { file: "russian_5k", name: "Russian 5k", category: "natural" },
    { file: "russian_abbreviations", name: "Russian Abbreviations", category: "natural" },
    { file: "russian_contractions", name: "Russian Contractions", category: "natural" },
    { file: "russian_contractions_1k", name: "Russian Contractions 1k", category: "natural" },
    { file: "sanskrit", name: "Sanskrit", category: "natural" },
    { file: "sanskrit_roman", name: "Sanskrit Roman", category: "natural" },
    { file: "santali", name: "Santali", category: "natural" },
    { file: "serbian", name: "Serbian", category: "natural" },
    { file: "serbian_10k", name: "Serbian 10k", category: "natural" },
    { file: "serbian_latin", name: "Serbian Latin", category: "natural" },
    { file: "serbian_latin_10k", name: "Serbian Latin 10k", category: "natural" },
    { file: "shona", name: "Shona", category: "natural" },
    { file: "shona_1k", name: "Shona 1k", category: "natural" },
    { file: "sinhala", name: "Sinhala", category: "natural" },
    { file: "slovak", name: "Slovak", category: "natural" },
    { file: "slovak_10k", name: "Slovak 10k", category: "natural" },
    { file: "slovak_1k", name: "Slovak 1k", category: "natural" },
    { file: "slovenian", name: "Slovenian", category: "natural" },
    { file: "slovenian_1k", name: "Slovenian 1k", category: "natural" },
    { file: "slovenian_5k", name: "Slovenian 5k", category: "natural" },
    { file: "spanish", name: "Spanish", category: "natural" },
    { file: "spanish_10k", name: "Spanish 10k", category: "natural" },
    { file: "spanish_1k", name: "Spanish 1k", category: "natural" },
    { file: "spanish_650k", name: "Spanish 650k", category: "natural" },
    { file: "swahili_1k", name: "Swahili 1k", category: "natural" },
    { file: "swedish", name: "Swedish", category: "natural" },
    { file: "swedish_1k", name: "Swedish 1k", category: "natural" },
    { file: "swedish_diacritics", name: "Swedish Diacritics", category: "natural" },
    { file: "swiss_german", name: "Swiss German", category: "natural" },
    { file: "swiss_german_1k", name: "Swiss German 1k", category: "natural" },
    { file: "swiss_german_2k", name: "Swiss German 2k", category: "natural" },
    { file: "tamil", name: "Tamil", category: "natural" },
    { file: "tamil_1k", name: "Tamil 1k", category: "natural" },
    { file: "tamil_old", name: "Tamil Old", category: "natural" },
    { file: "tanglish", name: "Tanglish", category: "natural" },
    { file: "tatar", name: "Tatar", category: "natural" },
    { file: "tatar_1k", name: "Tatar 1k", category: "natural" },
    { file: "tatar_5k", name: "Tatar 5k", category: "natural" },
    { file: "tatar_9k", name: "Tatar 9k", category: "natural" },
    { file: "tatar_crimean", name: "Tatar Crimean", category: "natural" },
    { file: "tatar_crimean_10k", name: "Tatar Crimean 10k", category: "natural" },
    { file: "tatar_crimean_15k", name: "Tatar Crimean 15k", category: "natural" },
    { file: "tatar_crimean_1k", name: "Tatar Crimean 1k", category: "natural" },
    { file: "tatar_crimean_5k", name: "Tatar Crimean 5k", category: "natural" },
    { file: "tatar_crimean_cyrillic", name: "Tatar Crimean Cyrillic", category: "natural" },
    { file: "tatar_crimean_cyrillic_10k", name: "Tatar Crimean Cyrillic 10k", category: "natural" },
    { file: "tatar_crimean_cyrillic_15k", name: "Tatar Crimean Cyrillic 15k", category: "natural" },
    { file: "tatar_crimean_cyrillic_1k", name: "Tatar Crimean Cyrillic 1k", category: "natural" },
    { file: "tatar_crimean_cyrillic_5k", name: "Tatar Crimean Cyrillic 5k", category: "natural" },
    { file: "telugu", name: "Telugu", category: "natural" },
    { file: "telugu_1k", name: "Telugu 1k", category: "natural" },
    { file: "thai", name: "Thai", category: "natural" },
    { file: "thai_10k", name: "Thai 10k", category: "natural" },
    { file: "thai_1k", name: "Thai 1k", category: "natural" },
    { file: "thai_20k", name: "Thai 20k", category: "natural" },
    { file: "thai_50k", name: "Thai 50k", category: "natural" },
    { file: "thai_5k", name: "Thai 5k", category: "natural" },
    { file: "thai_60k", name: "Thai 60k", category: "natural" },
    { file: "tibetan", name: "Tibetan", category: "natural" },
    { file: "tibetan_1k", name: "Tibetan 1k", category: "natural" },
    { file: "turkish", name: "Turkish", category: "natural" },
    { file: "turkish_1k", name: "Turkish 1k", category: "natural" },
    { file: "turkish_5k", name: "Turkish 5k", category: "natural" },
    { file: "udmurt", name: "Udmurt", category: "natural" },
    { file: "ukrainian", name: "Ukrainian", category: "natural" },
    { file: "ukrainian_10k", name: "Ukrainian 10k", category: "natural" },
    { file: "ukrainian_1k", name: "Ukrainian 1k", category: "natural" },
    { file: "ukrainian_50k", name: "Ukrainian 50k", category: "natural" },
    { file: "ukrainian_endings", name: "Ukrainian Endings", category: "natural" },
    { file: "ukrainian_latynka", name: "Ukrainian Latynka", category: "natural" },
    { file: "ukrainian_latynka_10k", name: "Ukrainian Latynka 10k", category: "natural" },
    { file: "ukrainian_latynka_1k", name: "Ukrainian Latynka 1k", category: "natural" },
    { file: "ukrainian_latynka_50k", name: "Ukrainian Latynka 50k", category: "natural" },
    { file: "ukrainian_latynka_endings", name: "Ukrainian Latynka Endings", category: "natural" },
    { file: "urdish", name: "Urdish", category: "natural" },
    { file: "urdu", name: "Urdu", category: "natural" },
    { file: "urdu_1k", name: "Urdu 1k", category: "natural" },
    { file: "urdu_5k", name: "Urdu 5k", category: "natural" },
    { file: "uzbek", name: "Uzbek", category: "natural" },
    { file: "uzbek_1k", name: "Uzbek 1k", category: "natural" },
    { file: "uzbek_70k", name: "Uzbek 70k", category: "natural" },
    { file: "vietnamese", name: "Vietnamese", category: "natural" },
    { file: "vietnamese_1k", name: "Vietnamese 1k", category: "natural" },
    { file: "vietnamese_5k", name: "Vietnamese 5k", category: "natural" },
    { file: "welsh", name: "Welsh", category: "natural" },
    { file: "welsh_1k", name: "Welsh 1k", category: "natural" },
    { file: "xhosa", name: "Xhosa", category: "natural" },
    { file: "xhosa_3k", name: "Xhosa 3k", category: "natural" },
    { file: "yiddish", name: "Yiddish", category: "natural" },
    { file: "yoruba_1k", name: "Yoruba 1k", category: "natural" },
    { file: "zulu", name: "Zulu", category: "natural" },
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
let currentLanguageFile = 'english_10k';

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
    filename = filename.replace(/_(\d+)k$/i, '_$1T');

    // Check cache first
    if (_langCache[filename]) {
        wordList = _langCache[filename];
        currentLanguageFile = filename;
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
 * Get the saved language from settings, or default to 'english_10k'.
 */
function getSavedLanguage() {
    try {
        const settings = JSON.parse(localStorage.getItem('usertypo_settings') || '{}');
        const lang = settings.languageContent && settings.languageContent.testLanguage;
        return lang || 'english_10k';
    } catch (e) {
        return 'english_10k';
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
        localStorage.setItem('usertypo_settings', JSON.stringify(settings));
        // Also update the live settings object if available
        if (window.usertypo_settings) {
            if (!window.usertypo_settings.languageContent) window.usertypo_settings.languageContent = {};
            window.usertypo_settings.languageContent.testLanguage = filename;
        }
        if (window.usertypo_settingsApi?.applyFooterSettings) {
            window.usertypo_settingsApi.applyFooterSettings();
        }
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

// Auto-load the saved language on page load (for index.html)
if (typeof document !== 'undefined') {
    window._initLang = (opts = {}) => {
        const saved = getSavedLanguage();
        if (saved) {
            loadLanguage(saved).then(() => {
                const testActive = typeof window.usertypo_testRuntime?.isActive === 'function'
                    && window.usertypo_testRuntime.isActive();
                if (!opts.skipRestart && !testActive && typeof window.restartTest === 'function') {
                    window.restartTest();
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
