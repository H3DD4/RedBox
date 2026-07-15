import requests, base64, json, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.stderr.reconfigure(encoding='utf-8', errors='replace')

# Decode Flask session payload
cookie = 'eyJ1c2VybmFtZSI6InRlc3RmbGFnIn0.aj6oZA.cfem_XpT2XjaIBxwUKuJ8hKD9Vw'
payload_b64 = cookie.split('.')[0]
# Add padding
padding = 4 - len(payload_b64) % 4
if padding != 4:
    payload_b64 += '=' * padding
payload = base64.urlsafe_b64decode(payload_b64)
print('Decoded payload:', payload)
print('JSON:', json.loads(payload))

# The flask-tool might be available
print('\nFlask-unsign can crack the secret')
print('Try: flask-unsign --unsign --cookie <cookie>')
