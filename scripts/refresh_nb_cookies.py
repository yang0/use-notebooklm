import json
import time
import urllib.request
from websocket import create_connection

def get_ws_url(port):
    with urllib.request.urlopen(f"http://127.0.0.1:{port}/json", timeout=5) as r:
        targets = json.loads(r.read())
    for t in targets:
        if t.get("type") == "page":
            return t.get("webSocketDebuggerUrl")
    return None

ws_url = get_ws_url(9223)
if not ws_url:
    print("No page target found")
    exit(1)

ws = create_connection(ws_url, timeout=10)

# Navigate to NotebookLM
ws.send(json.dumps({"id": 1, "method": "Page.navigate", "params": {"url": "https://notebooklm.google.com"}}))
print("Navigating to notebooklm.google.com...")
result = ws.recv()
print(f"Navigation result: {result[:200]}")

time.sleep(5)

# Get cookies for notebooklm domain
ws.send(json.dumps({
    "id": 2,
    "method": "Network.getCookies",
    "params": {"urls": ["https://notebooklm.google.com", "https://.notebooklm.google.com"]}
}))
result = json.loads(ws.recv())
cookies = result.get("result", {}).get("cookies", [])
print(f"Found {len(cookies)} cookies for notebooklm.google.com")

# Also get google.com cookies  
ws.send(json.dumps({
    "id": 3,
    "method": "Network.getCookies",
    "params": {"urls": ["https://www.google.com", "https://.google.com"]}
}))
result = json.loads(ws.recv())
gcookies = result.get("result", {}).get("cookies", [])
print(f"Found {len(gcookies)} cookies for google.com")

ws.close()

# Merge and save to storage_state.json
all_cookies = cookies + gcookies
seen = {}
unique = []
for c in all_cookies:
    key = (c.get("domain", ""), c.get("name", ""))
    if key not in seen:
        seen[key] = c
        unique.append(c)

pw_cookies = []
for c in unique:
    expires = c.get("expires", 0)
    if isinstance(expires, (int, float)):
        if expires > 1e12:
            expires = int(expires)
        elif expires > 0:
            expires = int(time.time() + expires)
        else:
            expires = 0
    else:
        expires = int(expires) if expires else 0
    
    pw_cookies.append({
        "name": c.get("name", ""),
        "value": c.get("value", ""),
        "domain": c.get("domain", ""),
        "path": c.get("path", "/"),
        "expires": expires,
        "httpOnly": c.get("httpOnly", False),
        "secure": c.get("secure", False),
        "sameSite": c.get("sameSite", "None"),
    })

state = {"cookies": pw_cookies, "origins": []}

import os
output = os.path.expanduser("~/.notebooklm/profiles/default/storage_state.json")
os.makedirs(os.path.dirname(output), exist_ok=True)
with open(output, "w", encoding="utf-8") as f:
    json.dump(state, f, indent=2)

sid_cookies = [c for c in pw_cookies if c["name"] == "SID"]
print(f"\nSaved {len(pw_cookies)} cookies to {output}")
print(f"SID cookies: {len(sid_cookies)}")
for s in sid_cookies:
    print(f"  SID on {s['domain']} (expires: {s['expires']})")
