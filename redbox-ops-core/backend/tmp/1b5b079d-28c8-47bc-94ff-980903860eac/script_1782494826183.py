import requests
r = requests.get('https://web-random-cheese.tracebash.xyz/', cookies={'session': 'eyJ1c2VybmFtZSI6InRlc3R1c2VyMSJ9.aj61Dw.YpGomJCF5SZ8f542b3RoT36tqvM'})
import tempfile, os
with tempfile.NamedTemporaryFile(delete=False, suffix='.html', mode='wb') as f:
    f.write(r.content)
    print(f.name)