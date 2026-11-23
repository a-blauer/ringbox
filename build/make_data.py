import json, glob, os, sys
src = sys.argv[1]; out = sys.argv[2]
sets = json.load(open(os.path.join(src, 'sets.json')))
cards = []
def clean(d): return {k: v for k, v in d.items() if not (v is None or v is False or v == '' or v == [])}
for f in sorted(glob.glob(os.path.join(src, 'cards', '*.json'))):
    for c in json.load(open(f))['cards']:
        img = c['image']
        img = img.replace('https://cdn.lotrtcgpc.net/cards/', '@').replace('https://play.lotrtcgpc.net/gemp-lotr/images/', '#')
        s = int(c['set'])
        st = c.get('subtypes')
        r = {
            'id': c['id'], 's': s, 'n': c['number'], 'ci': c.get('collInfo'), 'r': c.get('rarity'),
            'cu': c.get('culture'), 'sd': {'Free Peoples': 'F', 'Shadow': 'S'}.get(c.get('side')),
            'ty': c['type'], 't': c['title'], 'st': c.get('subtitle'), 'u': c.get('unique'),
            'tw': c.get('twilight'), 'str': c.get('strength'), 'vit': c.get('vitality'), 'res': c.get('resistance'),
            'si': c.get('siteNumber'), 'sh': c.get('shadowNumber'), 'sg': c.get('signet'), 'b': c.get('block'),
            'k': st, 'gt': c.get('gameText'), 'lo': c.get('lore'), 'im': img, 'rb': c.get('canBearRing'),
            'sm': c.get('strengthMod'), 'vm': c.get('vitalityMod'), 'rm': c.get('resistanceMod'), 'sim': c.get('siteNumberMod'),
            'hs': c.get('homeSites'), 'eo': c.get('errataOf'), 'ei': c.get('errataId'), 'al': c.get('alternates'),
            'ar': c.get('arrowDirection'),
        }
        if r['tw'] == 0: r['tw0'] = True
        for z in ('str','vit','res','si','sh'):
            if c.get({'str':'strength','vit':'vitality','res':'resistance','si':'siteNumber','sh':'shadowNumber'}[z]) == 0: r[z] = 0
        rr = clean(r)
        for z in ('str','vit','res','si','sh'):
            if r.get(z) == 0: rr[z] = 0
        rr.pop('tw0', None)
        if r['tw'] == 0: rr['tw'] = 0
        cards.append(rr)
os.makedirs(out, exist_ok=True)
with open(os.path.join(out, 'cards.json'), 'w') as fh:
    fh.write('[\n' + ',\n'.join(json.dumps(c, ensure_ascii=False, separators=(',', ':')) for c in cards) + '\n]')
json.dump([{'s': int(x['set']), 'name': x['name'], 'ab': x.get('abbreviation'), 'date': x.get('releaseDate'), 'kind': x['kind']} for x in sets],
          open(os.path.join(out, 'sets.json'), 'w'), ensure_ascii=False)
tl = json.load(open(os.path.join(src, 'format-timeline.json')))
last = {}
for m in tl['microformats']: last[m['format']] = m
fm = []
for f in tl['formats']:
    m = last.get(f['id'])
    if not m: continue
    xl, rl = [], []
    for name, v in m['lists'].items():
        (rl if ('restricted' in name or 'rlist' in name) else xl).extend(v['cards'])
    sites = m['sites'] or ''
    if 'Multipath' in sites: sm = 'multipath'
    elif 'Shadows' in sites: sm = 'shadows'
    elif 'Fellowship' in sites: sm = 'Fellowship'
    elif 'Towers' in sites: sm = 'Towers'
    elif 'King' in sites: sm = 'King'
    else: sm = 'any'
    fm.append({'id': f['id'], 'name': f['name'], 'pc': f['pc'], 'sets': [int(s) for s in m['sets']],
               'extra': [e['card'] for e in m['extraCards']], 'x': xl, 'rl': rl, 'sites': sm, 'sitesText': sites,
               'active': f['end'] is None})
json.dump(fm, open(os.path.join(out, 'formats.json'), 'w'), ensure_ascii=False, indent=0)
print(len(cards), 'cards;', len(fm), 'formats')
