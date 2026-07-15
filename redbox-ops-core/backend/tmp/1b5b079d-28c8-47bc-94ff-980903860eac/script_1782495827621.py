import base64, zlib
s = 'eyJfZmxhc2hlcyI6W3siIHQiOlsic3VjY2VzcyIsIkx1Y2t5IG51bWJlciB1cGRhdGVkISBQcm9ncmVzcyByZXNldC4iXX1dLCJ1c2VybmFtZSI6ImhhY2tlcjk5In0'
padded = s + '=' * (4 - len(s) % 4) if len(s) % 4 else s
decoded = base64.urlsafe_b64decode(padded)
try:
    decompressed = zlib.decompress(decoded)
    print(decompressed)
except:
    print('raw:', decoded)