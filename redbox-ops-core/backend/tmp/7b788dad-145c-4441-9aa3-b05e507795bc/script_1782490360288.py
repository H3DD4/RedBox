import requests, string, random

base = 'https://web-random-cheese.tracebash.xyz'

def create_user():
    s = requests.Session()
    name = ''.join(random.choices(string.ascii_lowercase, k=8))
    r1 = s.post(f'{base}/register', data={'username': name, 'password': name}, allow_redirects=False)
    r2 = s.post(f'{base}/login', data={'username': name, 'password': name}, allow_redirects=False)
    print(f'Created user: {name}, cookie: {s.cookies.get("session")[:50] if s.cookies.get("session") else "NONE"}')
    return s, name

# Create user and check dashboard
s, name = create_user()
r = s.get(f'{base}/')
print(f'Dashboard status: {r.status_code}')
print('Dashboard start:', r.text[:500].encode('ascii', errors='replace').decode('ascii'))

# Check settings page
r = s.get(f'{base}/settings')
print(f'Settings status: {r.status_code}')
print('Settings:', r.text[:1000].encode('ascii', errors='replace').decode('ascii'))

# Spin a few times
for i in range(10):
    r = s.post(f'{base}/spin', json={})
    j = r.json()
    print(f'Spin {i+1}: val={j["val"]}, score={j["score"]}')

# Claim
r = s.post(f'{base}/claim')
print('\nClaim response (full):')
print(r.text.encode('ascii', errors='replace').decode('ascii'))