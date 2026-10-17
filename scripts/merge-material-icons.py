"""Merge missing Material Symbols ligatures into the local subset TTF.

Usage: python scripts/merge-material-icons.py <source.ttf> <backup-tag> <icon> [<icon> ...]
The source font is a Google Fonts subset fetched with ?text=<icon names>.
"""
from fontTools.ttLib import TTFont
from fontTools.ttLib.tables.otTables import Ligature
import copy
import os
import shutil
import sys

MAIN_PATH = "css/fonts/material-symbols.ttf"
if len(sys.argv) < 4:
    raise SystemExit(__doc__)
SRC_PATH = sys.argv[1]
BACKUP = "scripts/.font-cache/material-symbols.before-%s.ttf" % sys.argv[2]
WANTED = set(sys.argv[3:])


def name_of(g):
    if g == "underscore":
        return "_"
    if len(g) == 1:
        return g
    if g.startswith("uni") and len(g) == 7:
        try:
            return chr(int(g[3:], 16))
        except Exception:
            return g
    return g


def find_ligatures(font, wanted):
    gsub = font["GSUB"].table
    out = {}
    for fr in gsub.FeatureList.FeatureRecord:
        if fr.FeatureTag not in ("rlig", "liga"):
            continue
        for li in fr.Feature.LookupListIndex:
            lookup = gsub.LookupList.Lookup[li]
            for st in lookup.SubTable:
                while hasattr(st, "ExtSubTable"):
                    st = st.ExtSubTable
                if not hasattr(st, "ligatures"):
                    continue
                for first, ligs in st.ligatures.items():
                    for lig in ligs:
                        comps = [first] + list(lig.Component)
                        name = "".join(name_of(c) for c in comps)
                        if name in wanted:
                            out[name] = (comps, lig.LigGlyph)
    return out


def main():
    shutil.copy2(MAIN_PATH, BACKUP)
    main_font = TTFont(MAIN_PATH)
    src = TTFont(SRC_PATH)

    found = find_ligatures(src, WANTED)
    print("found in src", sorted(found.keys()))
    missing = WANTED - set(found.keys())
    if missing:
        print("WARNING still missing", missing)
        if not found:
            raise SystemExit("no ligatures found in source font")

    glyf_main = main_font["glyf"]
    glyf_src = src["glyf"]
    hmtx_main = main_font["hmtx"]
    hmtx_src = src["hmtx"]

    copied = []
    for _name, (comps, lig_glyph) in found.items():
        for gname in list(comps) + [lig_glyph]:
            if gname in glyf_main:
                continue
            glyf_main[gname] = copy.deepcopy(glyf_src[gname])
            if gname in hmtx_src.metrics:
                hmtx_main.metrics[gname] = hmtx_src.metrics[gname]
            copied.append(gname)
    print("copied glyphs", copied)

    cmap_table = None
    for table in main_font["cmap"].tables:
        if table.platformID == 3 and table.platEncID in (1, 10):
            cmap_table = table
            break
    if cmap_table is None:
        cmap_table = main_font["cmap"].tables[0]

    for _name, (comps, _lig_glyph) in found.items():
        for gname in comps:
            ch = name_of(gname)
            if len(ch) == 1:
                cp = ord(ch)
                if cp not in cmap_table.cmap:
                    cmap_table.cmap[cp] = gname

    gsub = main_font["GSUB"].table
    target_subtable = None
    for fr in gsub.FeatureList.FeatureRecord:
        if fr.FeatureTag not in ("rlig", "liga"):
            continue
        for li in fr.Feature.LookupListIndex:
            lookup = gsub.LookupList.Lookup[li]
            for st in lookup.SubTable:
                while hasattr(st, "ExtSubTable"):
                    st = st.ExtSubTable
                if hasattr(st, "ligatures"):
                    target_subtable = st
                    break
            if target_subtable:
                break
        if target_subtable:
            break
    if target_subtable is None:
        raise SystemExit("no ligature subtable in main font")

    added = 0
    for _name, (comps, lig_glyph) in found.items():
        first = comps[0]
        rest = comps[1:]
        existing = target_subtable.ligatures.get(first, [])
        dup = any(list(e.Component) == list(rest) and e.LigGlyph == lig_glyph for e in existing)
        if dup:
            continue
        lig = Ligature()
        lig.Component = list(rest)
        lig.LigGlyph = lig_glyph
        target_subtable.ligatures.setdefault(first, []).append(lig)
        added += 1
    print("added ligatures", added)

    # Longest first: "edit" listed before "edit_note" would match and leave "_note" as text.
    for ligs in target_subtable.ligatures.values():
        ligs.sort(key=lambda lig: -len(lig.Component))

    order = list(main_font.getGlyphOrder())
    for g in copied:
        if g not in order:
            order.append(g)
    for _name, (_comps, lig_glyph) in found.items():
        if lig_glyph not in order:
            order.append(lig_glyph)
    main_font.setGlyphOrder(order)

    main_font.save(MAIN_PATH)
    print("saved", MAIN_PATH, "size", os.path.getsize(MAIN_PATH))

    verified = find_ligatures(TTFont(MAIN_PATH), WANTED)
    print("verified", sorted(verified.keys()))


if __name__ == "__main__":
    main()
