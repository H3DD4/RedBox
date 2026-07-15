import base64, json; s='eyJfZmxhc2hlcyI6W3siIHQiOlsic3VjY2VzcyIsIlJlZ2lzdHJhdGlvbiBzdWNjZXNzZnVsISBQbGVhc2UgbG9naW4uIl19XX0'; # add padding if needed
padded = s + '=' * (4 - len(s) % 4) if len(s) % 4 else s
decoded = base64.urlsafe_b64decode(padded)
print(decoded)