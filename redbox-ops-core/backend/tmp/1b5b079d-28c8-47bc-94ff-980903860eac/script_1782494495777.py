import base64, json
s='eyJ1c2VybmFtZSI6InRlc3R1c2VyMSJ9'
padded = s + '=' * (4 - len(s) % 4) if len(s) % 4 else s
decoded = base64.urlsafe_b64decode(padded)
print(decoded)