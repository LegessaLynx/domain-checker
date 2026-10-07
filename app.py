#!/usr/bin/env python3
"""
🌐 Super Simple Domain Checker
Cross-platform, zero-dependency local server & authoritative RDAP domain checker.
Works on macOS, Linux, and Windows.
"""

import http.server
import socketserver
import urllib.request
import urllib.error
import urllib.parse
import json
import webbrowser
import threading
import time
import sys
import os
import socket

DEFAULT_PORT = 8080
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PUBLIC_DIR = os.path.join(BASE_DIR, "public")


def find_available_port(start_port=DEFAULT_PORT, max_attempts=20):
    """Find an open port starting from start_port."""
    for port in range(start_port, start_port + max_attempts):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    return start_port


DIRECT_RDAP_SERVERS = {
    # Verisign (.com, .net, .cc, .tv)
    "com": "https://rdap.verisign.com/com/v1/domain/",
    "net": "https://rdap.verisign.com/net/v1/domain/",
    "cc": "https://rdap.verisign.com/cc/v1/domain/",
    "tv": "https://rdap.verisign.com/tv/v1/domain/",
    # Google Registry (.dev, .app, .page)
    "dev": "https://pubapi.registry.google/rdap/domain/",
    "app": "https://pubapi.registry.google/rdap/domain/",
    "page": "https://pubapi.registry.google/rdap/domain/",
    "how": "https://pubapi.registry.google/rdap/domain/",
    # PIR (.org)
    "org": "https://rdap.publicinterestregistry.org/rdap/domain/",
    # CentralNic (.xyz)
    "xyz": "https://rdap.centralnic.com/xyz/domain/",
    # Radix (.tech, .online, .site, .store, .space, .fun, .host, .website)
    "tech": "https://rdap.radix.host/rdap/domain/",
    "online": "https://rdap.radix.host/rdap/domain/",
    "site": "https://rdap.radix.host/rdap/domain/",
    "store": "https://rdap.radix.host/rdap/domain/",
    "space": "https://rdap.radix.host/rdap/domain/",
    "fun": "https://rdap.radix.host/rdap/domain/",
    "host": "https://rdap.radix.host/rdap/domain/",
    "website": "https://rdap.radix.host/rdap/domain/",
    # Identity Digital (.io, .ai, .sh, .ac, .agency, .cloud, .info)
    "io": "https://rdap.identitydigital.services/rdap/domain/",
    "ai": "https://rdap.identitydigital.services/rdap/domain/",
    "sh": "https://rdap.identitydigital.services/rdap/domain/",
    "ac": "https://rdap.identitydigital.services/rdap/domain/",
    "agency": "https://rdap.identitydigital.services/rdap/domain/",
    "cloud": "https://rdap.identitydigital.services/rdap/domain/",
    "info": "https://rdap.identitydigital.services/rdap/domain/",
    # ccTLDs
    "co": "https://rdap.nic.co/domain/",
    "me": "https://rdap.nic.me/domain/",
    "biz": "https://rdap.nic.biz/domain/",
}


class DomainCheckerHandler(http.server.SimpleHTTPRequestHandler):
    """Custom HTTP handler serving the web UI and providing an RDAP proxy."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PUBLIC_DIR, **kwargs)

    def end_headers(self):
        # Enable CORS and disable aggressive caching for local dev
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/api/rdap":
            self.handle_rdap_proxy(parsed)
        elif path == "/api/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(b'{"status":"ok"}')
        else:
            # Serve static files from public directory
            super().do_GET()

    def handle_rdap_proxy(self, parsed):
        """Query official RDAP servers directly with automatic fallback to rdap.org."""
        params = urllib.parse.parse_qs(parsed.query)
        domain = params.get("domain", [""])[0].strip().lower()

        if not domain or "." not in domain:
            self.send_response(400)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(json.dumps({"error": "Invalid or missing domain parameter."}).encode("utf-8"))
            return

        tld = domain.split(".")[-1]
        base_endpoint = DIRECT_RDAP_SERVERS.get(tld)

        urls_to_try = []
        if base_endpoint:
            urls_to_try.append(f"{base_endpoint}{urllib.parse.quote(domain)}")
        urls_to_try.append(f"https://rdap.org/domain/{urllib.parse.quote(domain)}")

        headers = {
            "User-Agent": "DomainCheckerApp/1.0 (https://github.com/domain-checker)",
            "Accept": "application/rdap+json, application/json"
        }

        last_error = None
        for attempt, url in enumerate(urls_to_try):
            req = urllib.request.Request(url, headers=headers)
            try:
                with urllib.request.urlopen(req, timeout=7) as response:
                    content = response.read()
                    data = json.loads(content.decode("utf-8"))
                    formatted = self.format_rdap_response(domain, data, available=False)
                    
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json; charset=utf-8")
                    self.end_headers()
                    self.wfile.write(json.dumps(formatted).encode("utf-8"))
                    return

            except urllib.error.HTTPError as e:
                if e.code == 404:
                    formatted = {
                        "domain": domain,
                        "available": True,
                        "status_code": 404,
                        "status_text": "Available (Unregistered)",
                        "message": "Domain is not registered."
                    }
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json; charset=utf-8")
                    self.end_headers()
                    self.wfile.write(json.dumps(formatted).encode("utf-8"))
                    return
                elif e.code == 429:
                    self.send_response(429)
                    self.send_header("Content-Type", "application/json; charset=utf-8")
                    self.end_headers()
                    self.wfile.write(json.dumps({
                        "domain": domain,
                        "error": "Rate limit reached (HTTP 429).",
                        "status_code": 429
                    }).encode("utf-8"))
                    return
                else:
                    last_error = f"HTTP {e.code}"
                    time.sleep(0.3)
                    continue

            except (urllib.error.URLError, Exception) as e:
                last_error = str(e)
                time.sleep(0.3)
                continue

        # If all fallback attempts fail
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.end_headers()
        self.wfile.write(json.dumps({
            "domain": domain,
            "available": None,
            "error": last_error or "RDAP query failed across all servers."
        }).encode("utf-8"))

    def format_rdap_response(self, domain, data, available=False):
        """Format RDAP response into a clean structure with dates & registrar."""
        events = data.get("events", [])
        expiration_date = None
        registration_date = None
        last_changed = None

        for event in events:
            action = event.get("eventAction", "").lower()
            date_val = event.get("eventDate", "")
            if "expiration" in action:
                expiration_date = date_val
            elif "registration" in action:
                registration_date = date_val
            elif "last changed" in action or "last update" in action:
                last_changed = date_val

        # Extract Registrar Name from entities
        registrar = "Unknown"
        for entity in data.get("entities", []):
            roles = entity.get("roles", [])
            if "registrar" in roles:
                vcard = entity.get("vcardArray", [])
                if len(vcard) > 1 and isinstance(vcard[1], list):
                    for item in vcard[1]:
                        if len(item) > 3 and item[0] == "fn":
                            registrar = item[3]
                            break
                if registrar == "Unknown" and "handle" in entity:
                    registrar = entity["handle"]

        status_list = data.get("status", [])

        return {
            "domain": domain,
            "available": available,
            "status_code": 200,
            "status_text": "Taken (Registered)",
            "expiration_date": expiration_date,
            "registration_date": registration_date,
            "last_changed": last_changed,
            "registrar": registrar,
            "status_flags": status_list
        }


def open_browser_delayed(url, delay=0.6):
    """Open browser in a separate thread after server starts."""
    def _open():
        time.sleep(delay)
        try:
            webbrowser.open(url)
        except Exception:
            pass
    t = threading.Thread(target=_open, daemon=True)
    t.start()


def main():
    if not os.path.exists(PUBLIC_DIR):
        os.makedirs(PUBLIC_DIR, exist_ok=True)

    port = find_available_port(DEFAULT_PORT)
    server_address = ("127.0.0.1", port)
    url = f"http://localhost:{port}"

    banner = f"""
======================================================================
  🌐  SUPER SIMPLE DOMAIN CHECKER
======================================================================
  Platform : macOS | Linux | Windows
  Backend  : Python Zero-Dependency Local Server (HTTP & RDAP Proxy)
  Status   : Server running successfully!

  👉 URL : {url}
======================================================================
  Press Ctrl+C in terminal to stop the server anytime.
"""
    print(banner)

    # Launch browser automatically
    open_browser_delayed(url)

    # Allow fast restart without port lock
    socketserver.TCPServer.allow_reuse_address = True

    try:
        with socketserver.TCPServer(server_address, DomainCheckerHandler) as httpd:
            httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n👋 Domain Checker server stopped. Goodbye!\n")
        sys.exit(0)


if __name__ == "__main__":
    main()
