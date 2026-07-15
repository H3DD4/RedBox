import requests
base = 'http://wily-courier.picoctf.net:49463'

r0 = requests.get(base)
r1 = requests.get(base, params={'x': 'test'})

b0 = r0.content
b1 = r1.content

print('Baseline bytes:', len(b0))
print('With x=test bytes:', len(b1))

# Find byte differences
if b0 != b1:
    for i in range(max(len(b0), len(b1))):
        if i >= len(b0):
            print(f'Extra bytes at end: {b1[i:i+50]}')
            break
        elif i >= len(b1):
            print(f'Missing bytes at end: {b0[i:i+50]}')
            break
        elif b0[i] != b1[i]:
            start = max(0, i-50)
            end = min(i+100, len(b0), len(b1))
            print(f'First byte diff at position {i}:')
            print(f'Baseline [{start}:{end}]: {b0[start:end]}')
            print(f'x=test   [{start}:{end}]: {b1[start:end]}')
            break
else:
    print('Identical content')

# Also compare the exact full bodies
print('FULL BASELINE:')
print(b0.decode('utf-8', errors='replace'))
print('='*80)
print('FULL WITH x=test')
print(b1.decode('utf-8', errors='replace'))