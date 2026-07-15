import requests, sys
r = requests.get('https://web-random-cheese.tracebash.xyz/', cookies={'session': 'eyJ1c2VybmFtZSI6InRlc3R1c2VyMSJ9.aj61Dw.YpGomJCF5SZ8f542b3RoT36tqvM'})
text = r.text.encode('utf-8', errors='replace').decode('utf-8')
print(text[:10000])