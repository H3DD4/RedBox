import requests, sys, re, time
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')

base = 'https://web-random-cheese.tracebash.xyz'

def try_seed(seed_val):
    s = requests.Session()
    name = f'ts{seed_val}'
    s.post(f'{base}/register', data={'username': name, 'password': name})
    s.post(f'{base}/login', data={'username': name, 'password': name})
    r = s.post(f'{base}/update_lucky', data={'lucky_number': str(seed_val)})
    if r.status_code == 429:
        return None, 'ratelimited'
    vals = []
    for i in range(10):
        r = s.post(f'{base}/spin')
        try:
            j = r.json()
            vals.append(j['val'])
        except:
            break
    if len(vals) == 10:
        return sum(vals), vals
    return len(vals), 'error'

# Try a few seeds with delay
for seed in [1, 500, 777, 999, 1000]:
    result = try_seed(seed)
    if result[0] is None:
        print(f'Seed {seed}: RATE LIMITED, waiting 30s...')
        time.sleep(30)
        result = try_seed(seed)
    print(f'Seed {seed}: sum={result[0]}, vals={result[1]}')
    if result[0] and result[0] >= 85:
        print(f'FOUND IT!')
        break
    time.sleep(2)  # Brief delay between attempts