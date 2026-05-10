#!/usr/bin/env python3
"""
use-notebooklm CDP Login — 从 Chrome DevTools Protocol 提取 NotebookLM 认证状态

完全自包含的认证脚本。不依赖 notebooklm-py 的内部修改。
在 Chrome 已登录 Google/NotebookLM 的情况下，直接提取 cookies 保存为
Playwright storage_state.json，供 notebooklm CLI 使用。

用法:
    python scripts/cdp_login.py                          # 保存到默认路径
    python scripts/cdp_login.py --port 9223              # 指定 CDP 端口
    python scripts/cdp_login.py --output custom.json     # 指定输出路径
    python scripts/cdp_login.py --launch-chrome           # 自动启动 Chrome CDP

前置:
    - websocket-client: pip install websocket-client
    - Chrome 已启动且已登录 Google/NotebookLM（CDP 端口 9223）
"""

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

DEFAULT_CDP_PORT = 9223
DEFAULT_OUTPUT = Path.home() / ".notebooklm" / "profiles" / "default" / "storage_state.json"
CHROME_PATH = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
CHROME_PROFILE = r"G:\chrome_data\remote_debug"

# 需要提取的 Google 域名（按顺序访问以填充 cookie jar）
AUTH_DOMAINS = [
    "notebooklm.google.com",
    "accounts.google.com",
    "www.google.com",
]


def check_cdp(port):
    """验证 CDP 端口是否可访问"""
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=5) as r:
            data = json.loads(r.read())
            return data.get("Browser", "unknown")
    except Exception:
        return None


def launch_chrome(port):
    """启动 Chrome 并开启远程调试"""
    print(f"[cdp] Launching Chrome on port {port}...")
    try:
        subprocess.Popen(
            [
                CHROME_PATH,
                f"--remote-debugging-port={port}",
                f"--user-data-dir={CHROME_PROFILE}",
                "--remote-allow-origins=*",
                "about:blank",
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        time.sleep(5)
    except FileNotFoundError:
        print(f"[cdp] ERROR: Chrome not found at {CHROME_PATH}")
        sys.exit(1)


def ensure_chrome(port, launch):
    """确保 Chrome CDP 可访问，失败时可选择自动启动"""
    browser = check_cdp(port)
    if browser:
        print(f"[cdp] Chrome CDP available: {browser}")
        return True

    if launch:
        launch_chrome(port)
        browser = check_cdp(port)
        if browser:
            print(f"[cdp] Chrome CDP available: {browser}")
            return True

    print(f"[cdp] ERROR: Chrome CDP not reachable on port {port}")
    print(f"  Start Chrome with:")
    print(f'  chrome.exe --remote-debugging-port={port} --user-data-dir="{CHROME_PROFILE}" --remote-allow-origins=*')
    sys.exit(1)


def get_page_ws_url(port):
    """获取第一个 page target 的 WebSocket URL"""
    with urllib.request.urlopen(f"http://127.0.0.1:{port}/json", timeout=5) as r:
        targets = json.loads(r.read())
    for t in targets:
        if t.get("type") == "page":
            return t.get("webSocketDebuggerUrl")
    return None


def extract_all_cookies(port, domains):
    """通过 CDP 提取所有 Google 域名的 cookies"""
    from websocket import create_connection

    ws_url = get_page_ws_url(port)
    if not ws_url:
        print("[cdp] ERROR: No page target found in CDP")
        sys.exit(1)

    ws = create_connection(ws_url, timeout=10)
    all_cookies = []

    for domain in domains:
        print(f"[cdp]   Navigating to {domain}...")
        ws.send(json.dumps({
            "id": 1,
            "method": "Page.navigate",
            "params": {"url": f"https://{domain}"}
        }))
        ws.recv()
        time.sleep(3)

        ws.send(json.dumps({
            "id": 2,
            "method": "Network.getCookies",
            "params": {"urls": [f"https://{domain}", f"https://.{domain}"]}
        }))
        result = json.loads(ws.recv())
        cookies = result.get("result", {}).get("cookies", [])
        print(f"[cdp]     Found {len(cookies)} cookies")
        all_cookies.extend(cookies)

    ws.close()
    return all_cookies


def to_playwright_state(cookies):
    """将 CDP cookie 格式转换为 Playwright storage_state.json 格式"""
    pw_cookies = []
    for c in cookies:
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

    return {"cookies": pw_cookies, "origins": []}


def validate(state):
    """验证 storage state 包含必要的 SID cookie"""
    cookies = state.get("cookies", [])
    sid_cookies = [c for c in cookies if c["name"] == "SID"]
    domains = sorted(set(c["domain"] for c in cookies if "google" in c["domain"]))

    print(f"\n[cdp] Total cookies: {len(cookies)}")
    print(f"[cdp] SID cookies: {len(sid_cookies)}")
    print(f"[cdp] Google domains: {domains}")

    if not sid_cookies:
        print("[cdp] WARNING: No SID cookie found! NotebookLM auth may fail.")
        print("[cdp]   Ensure the Chrome profile is logged into Google/NotebookLM.")
        return False

    for s in sid_cookies:
        print(f"[cdp]   SID on {s['domain']} (expires: {s['expires']})")
    return True


def main():
    parser = argparse.ArgumentParser(
        description="use-notebooklm CDP Login — Extract NotebookLM auth from Chrome"
    )
    parser.add_argument("--port", type=int, default=DEFAULT_CDP_PORT,
                        help=f"Chrome CDP port (default: {DEFAULT_CDP_PORT})")
    parser.add_argument("--output", "-o", type=Path, default=DEFAULT_OUTPUT,
                        help=f"Output path for storage_state.json")
    parser.add_argument("--launch-chrome", action="store_true",
                        help="Auto-launch Chrome if CDP not available")
    parser.add_argument("--chrome-profile", default=CHROME_PROFILE,
                        help="Chrome user data directory")
    args = parser.parse_args()

    print("=" * 60)
    print("use-notebooklm CDP Login")
    print("=" * 60)

    # Step 1: Ensure Chrome CDP
    print(f"\n[1/3] Checking Chrome CDP (port {args.port})...")
    ensure_chrome(args.port, args.launch_chrome)

    # Step 2: Extract cookies
    print(f"\n[2/3] Extracting Google auth cookies...")
    cookies = extract_all_cookies(args.port, AUTH_DOMAINS)

    # Deduplicate
    seen = {}
    for c in cookies:
        key = (c.get("domain", ""), c.get("name", ""))
        if key not in seen:
            seen[key] = c
    cookies = list(seen.values())

    # Convert to Playwright format
    state = to_playwright_state(cookies)

    # Step 3: Validate and save
    print(f"\n[3/3] Validating and saving...")
    ok = validate(state)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2)

    print(f"\n[cdp] Saved to: {args.output}")
    print(f"[cdp] Ready! Run: notebooklm status")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
