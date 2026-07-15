import subprocess, sys
result = subprocess.run(['curl', '-s', '-b', 'session=eyJ1c2VybmFtZSI6InRlc3R1c2VyMSJ9.aj61Dw.YpGomJCF5SZ8f542b3RoT36tqvM', 'https://web-random-cheese.tracebash.xyz/'], capture_output=True, text=True)
print(result.stdout[:5000])