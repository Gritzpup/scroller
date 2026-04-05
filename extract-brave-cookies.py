#!/usr/bin/env python3
import sqlite3
import os
import sys
import subprocess

try:
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    from cryptography.hazmat.backends import default_backend
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
    from cryptography.hazmat.primitives import hashes
except ImportError:
    print("ERR: Missing dependencies. Run: sudo apt install python3-cryptography")
    sys.exit(1)

cookie_db = os.path.expanduser('~/.config/BraveSoftware/Brave-Browser/Default/Cookies')
if not os.path.exists(cookie_db):
    print("ERR: Brave DB not found at", cookie_db)
    sys.exit(1)

tmp_db = '/tmp/brave_cookies_fb_extraction.db'
os.system(f'cp "{cookie_db}" "{tmp_db}" 2>/dev/null')
os.system(f'cp "{cookie_db}-wal" "{tmp_db}-wal" 2>/dev/null')
os.system(f'cp "{cookie_db}-shm" "{tmp_db}-shm" 2>/dev/null')

password = b'peanuts'
try:
    # Set DBUS address just in case we are running under Tilt/Docker loosely
    if 'DBUS_SESSION_BUS_ADDRESS' not in os.environ:
        os.environ['DBUS_SESSION_BUS_ADDRESS'] = f'unix:path=/run/user/{os.getuid()}/bus'
    
    # Try secret-tool as it manages timeouts and DBUS elegantly
    res = subprocess.run(['secret-tool', 'search', 'application', 'brave'], capture_output=True, text=True, timeout=2)
    lines = res.stdout.split('\n')
    for line in lines:
        if line.startswith('secret = '):
            password = line.split('secret = ')[1].strip().encode('utf-8')
            break
except Exception as e:
    pass

# Hardcode the fallback that we discovered locally if secret-tool failed
if password == b'peanuts':
    password = b'3FhvSPa2IH248KNoBu9uYQ=='

kdf = PBKDF2HMAC(
    algorithm=hashes.SHA1(),
    length=16,
    salt=b'saltysalt',
    iterations=1,
    backend=default_backend()
)
key = kdf.derive(password)

def decrypt(enc_value):
    if not enc_value:
        return ""
    if enc_value[:3] in (b'v10', b'v11'):
        iv = b' ' * 16
        cipher = Cipher(algorithms.AES(key), modes.CBC(iv), backend=default_backend())
        decryptor = cipher.decryptor()
        decrypted = decryptor.update(enc_value[3:]) + decryptor.finalize()
        
        # Strip padding and garbage
        pad = decrypted[-1]
        if type(pad) == int and pad < 16:
            decrypted = decrypted[:-pad]
        
        if enc_value[:3] == b'v11' and len(decrypted) > 32:
            decrypted = decrypted[32:]
            
        try:
            return decrypted.decode('utf-8')
        except:
            return ""
    return ""

conn = sqlite3.connect(tmp_db)
cursor = conn.cursor()
cursor.execute("SELECT name, value, encrypted_value FROM cookies WHERE host_key LIKE '%facebook.com'")
cookies = []
for name, value, enc_value in cursor.fetchall():
    val = value
    if enc_value:
        try:
            dec = decrypt(enc_value)
            if dec:
                val = dec
        except Exception:
            pass
    if val:
        cookies.append(f"{name}={val}")

output = "; ".join(cookies)
if 'c_user=' in output and 'xs=' in output:
    print("SUCCESS:", output)
else:
    print("ERR: Could not find c_user and xs in extraction")
