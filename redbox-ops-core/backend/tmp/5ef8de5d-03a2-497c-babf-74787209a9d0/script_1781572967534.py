import requests
from bs4 import BeautifulSoup

r = requests.get('http://saturn.picoctf.net:58885/')
soup = BeautifulSoup(r.text, 'html.parser')
forms = soup.find_all('form')
for form in forms:
    inputs = form.find_all('input')
    for inp in inputs:
        if inp.get('name') == 'ID':
            print(f"ID value: {inp.get('value')}")
print("\nFull HTML:")
print(r.text)