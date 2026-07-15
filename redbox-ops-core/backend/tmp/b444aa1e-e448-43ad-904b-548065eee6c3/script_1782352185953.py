import requests
base = 'http://wily-courier.picoctf.net:49463'
r = requests.get(base)
full = r.text
# Search for any flag pattern or hidden content
import re
# Find all comments
comments = re.findall(r'<!--(.*?)-->', full, re.DOTALL)
print('Comments:', comments)
# Look for hidden inputs
hidden = re.findall(r'<input[^>]*type=[\'"]hidden[\'"][^>]*>', full)
print('Hidden inputs:', hidden)
# Search for picoCTF or flag pattern
if 'picoCTF' in full or 'flag' in full.lower():
    print('FLAG FOUND!')
# Print the entire source
print('FULL SOURCE:')
print(full)
print('END SOURCE')