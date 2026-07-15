import requests, itertools, sys

base = 'https://web-random-cheese.tracebash.xyz'

# Try common Flask patterns
paths = [
    '/static/', '/static/css/', '/static/js/', '/static/images/',
    '/templates/', '/app/', '/src/', '/config.py', '/app.py',
    '/server.py', '/main.py', '/requirements.txt', '/Dockerfile',
    '/.env', '/.git/HEAD', '/.git/config', '/admin', '/debug',
    '/api', '/api/spin', '/api/users', '/api/score',
    '/robots.txt', '/sitemap.xml', '/reverse', '/source'
]

for path in paths:
    try:
        r = requests.get(f'{base}{path}', timeout=3)
        if r.status_code not in [404, 405]:
            print(f'FOUND {path}: {r.status_code}')
            print(r.text[:300])
    except Exception as e:
        print(f'{path}: {e}')
    break  # just check first for now