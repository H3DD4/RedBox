import requests
r = requests.get('https://web-random-cheese.tracebash.xyz/', cookies={'session': 'eyJ1c2VybmFtZSI6ImhhY2tlcjk5In0.aj64cw.XlxKyaRYfuZEkPTci5k50VSLSW4'})
import tempfile, os
with tempfile.NamedTemporaryFile(delete=False, suffix='.html', mode='wb') as f:
    f.write(r.content)
    print(f.name)