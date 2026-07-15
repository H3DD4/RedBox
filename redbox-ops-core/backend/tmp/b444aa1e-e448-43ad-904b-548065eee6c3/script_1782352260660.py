import requests
base = 'http://wily-courier.picoctf.net:49463'

# Get raw bytes
r = requests.get(base)
raw = r.content
print('Raw length:', len(raw))
# Search for picoCTF or flag in hex
import re
# Find all non-ASCII bytes and their positions
for i, b in enumerate(raw):
    if b > 127:
        context = raw[max(0,i-10):min(len(raw),i+10)]
        print(f'Position {i}: byte {b:02x} context: {context}')
# Also try with x parameter
r2 = requests.get(base, params={'x': 'test'})
print('\nWith ?x=test')
print('Length:', len(r2.text))
if 'picoCTF' in r2.text or 'flag' in r2.text.lower():
    print('FOUND!')
print(r2.text[:500])