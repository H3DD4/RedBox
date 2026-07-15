import requests
base = 'http://wily-courier.picoctf.net:49463'

# Get detailed diff between baseline and with x parameter
r0 = requests.get(base)
r = requests.get(base, params={'x': '<b>test</b>'})

# Find exact difference
for i in range(len(r.text)):
    if i >= len(r0.text):
        print(f'Extra at {i}: {r.text[i:i+100]!r}')
        break
    elif r0.text[i] != r.text[i]:
        # Show hundreds of chars around the difference
        start = max(0, i-50)
        end = min(len(r.text), i+200)
        print(f'First diff at {i}:')
        print(f'Baseline: ...{r0.text[start:end]!r}...')
        print(f'Payload:  ...{r.text[start:end]!r}...')
        break
else:
    print('Texts are identical')
    
print(f'\nBaseline length: {len(r0.text)}, Payload length: {len(r.text)}')