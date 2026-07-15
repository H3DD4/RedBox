import base64
s = 'eyJ1c2VybmFtZSI6ImhhY2tlcjk5In0'
padded = s + '=' * (4 - len(s) % 4) if len(s) % 4 else s
print(base64.urlsafe_b64decode(padded))