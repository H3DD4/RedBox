import requests
base = 'https://web-random-cheese.tracebash.xyz'

# Check static files
files = ['/static/js/script.js', '/static/js/app.js', '/static/js/main.js',
         '/static/css/style.css', '/robots.txt', '/sitemap.xml',
         '/.git/config', '/.env', '/config',
         '/static/images/', '/static/', '/static/js/']

for f in files:
    r = requests.get(f'{base}{f}')
    if r.status_code == 200:
        print(f'\n=== {f} === (len={len(r.text)})')
        # Check for flag patterns in JS
        if 'script' in f or f.endswith('.js'):
            print(r.text[:3000])
        elif f.endswith('.css'):
            # Check for interesting CSS
            if 'flag' in r.text.lower() or 'ctf' in r.text.lower():
                print(r.text[:1500])
        else:
            print(r.text[:500])
    elif r.status_code != 404:
        print(f'{f}: HTTP {r.status_code}')
        print(r.text[:300])