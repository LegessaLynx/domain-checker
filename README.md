# Domain Checker

A lightweight, zero-dependency domain availability checker with an authoritative RDAP lookup engine.

---

## How It Works

1. **Zero Dependencies:** Built entirely with Python's standard library and vanilla web technologies. No `pip install` or external packages required.
2. **Authoritative RDAP Queries:** Directly queries official ICANN and registry RDAP endpoints (Verisign, Google Registry, PIR, CentralNic, Identity Digital, Radix, etc.) instead of guessing via DNS.
3. **Accurate Availability:** Identifies whether a domain is available (HTTP 404) or registered (HTTP 200) with registrar names and expiration dates.
4. **Self-Healing Rate Limits:** Automatically handles HTTP 429 rate limits with live backoff cooldowns and background retries.

---

## Features

- **Bulk Search:** Enter keywords or domains in any format (comma, space, or line-by-line).
- **Domain Hacks:** Detects word-ending extensions across 120+ TLDs (e.g. `radio` -> `rad.io`, `focus` -> `foc.us`, `studio` -> `stud.io`).
- **Prefix & Suffix Generator:** Generates startup brand variations using popular prefixes (`get`, `try`, `use`, `open`, `join`) and suffixes (`app`, `lab`, `labs`, `ai`, `hub`, `ify`).
- **Custom TLDs:** Add any custom extension (e.g. `.tr`, `.de`, `.uk`, `.gg`).
- **Registrar Links:** Direct search links for Porkbun, Namecheap, and Cloudflare.
- **Clean Export:** Download available domains as simple JSON, plain TXT, or copy directly to clipboard.
- **Persistent Favorites:** Save favorite domains to browser localStorage.
- **Dark Mode:** Default high-contrast dark theme with an instant toggle.

---

## Quick Start

1. Clone the repository and navigate into the directory:

```bash
git clone https://github.com/LegessaLynx/domain-checker.git
cd domain-checker
```

2. Run the application:

```bash
python app.py
```

*(or `python3 app.py` on macOS/Linux)*

The server starts locally and automatically opens your default browser at:
`http://localhost:8080`

To stop the server, press `Ctrl + C` in the terminal.

---

## Project Structure

```
domain-checker/
├── app.py          # Python HTTP server and direct RDAP proxy
├── README.md       # Documentation
└── public/         # Frontend web application
    ├── index.html  # Application layout
    ├── style.css   # Stylesheet (dark default)
    └── app.js      # Parser, queue engine, and UI controller
```

---

## License

MIT License. Free and open source.
