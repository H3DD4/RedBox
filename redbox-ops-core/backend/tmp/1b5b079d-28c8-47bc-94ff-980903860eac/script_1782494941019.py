import re
with open('C:\\Users\\MSI\\AppData\\Local\\Temp\\tmpx08zruhf.txt', 'rb') as f:
    data = f.read()
# Find all href and action attributes
urls = set(re.findall(rb'"([^"]+)"', data))
for u in sorted(urls):
    print(u.decode('utf-8', errors='replace'))