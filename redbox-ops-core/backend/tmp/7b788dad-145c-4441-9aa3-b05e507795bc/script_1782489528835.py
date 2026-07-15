import requests

base = 'https://web-random-cheese.tracebash.xyz'
s = requests.Session()
s.post(f'{base}/register', data={'username':'hacker400','password':'pass400'}, allow_redirects=False)
s.post(f'{base}/login', data={'username':'hacker400','password':'pass400'}, allow_redirects=False)

# Let's check for various endpoints
for path in ['/admin', '/console', '/source', '/debug', '/flag', '/reset', '/prize', '/grandmeal', '/win', '/api', '/api/flag', '/api/spin', '/api/score', '/leaderboard', '/scores', '/static/app.py', '/static/../app.py', '/static/flag.txt', '/.git/config', '/robots.txt', '/sitemap.xml', '/secret', '/cheat', '/tom', '/jerry']:
    r = s.get(f'{base}{path}')
    print(f'{path}: {r.status_code} {len(r.text)} bytes')
    if r.status_code == 200 and 'flag' in r.text.lower():
        print('CONTENT:', r.text[:500])