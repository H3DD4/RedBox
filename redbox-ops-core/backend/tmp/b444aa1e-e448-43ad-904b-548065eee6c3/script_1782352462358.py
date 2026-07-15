import requests
base = 'http://wily-courier.picoctf.net:49463'

# Get baseline
r0 = requests.get(base)
print('BASELINE length:', len(r0.content))

# Get with x=flag
r = requests.get(base, params={'x': 'flag'})
print('x=flag length:', len(r.content))
print('x=flag content:')
print(r.text)
print('\n\nDIFF from baseline:')
# Show where they differ
for i in range(min(len(r0.text), len(r.text))):
    if r0.text[i] != r.text[i]:
        print(f'Position {i}: baseline={r0.text[i:i+20]!r}, x=flag={r.text[i:i+20]!r}')
        break
if len(r0.text) != len(r.text):
    print(f'Length diff: baseline={len(r0.text)}, x=flag={len(r.text)}')