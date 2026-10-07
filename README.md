# 🌐 Super Simple Domain Checker Pro

A lightweight, cross-platform domain availability checker with **zero external dependencies**. Built with Python's standard library and a modern, high-performance web interface.

---

## ✨ Features

- **🚀 100% Free & Zero Config:** No paid API keys, no subscriptions, no `pip install` required.
- **🏛️ Authoritative RDAP Registry:** Queries official ICANN-mandated RDAP servers directly (not guessed via DNS).
- **📅 Expiration Dates & Registrars:** When a domain is taken, displays exact expiration dates (e.g. `Expires: 2027-05-12`) and registrar details.
- **🔤 Smart Input Parser:** Paste keywords in any format:
  - Comma-separated: `startup, mybrand, flux`
  - Space-separated: `startup mybrand flux`
  - Multi-line list:
    ```
    startup
    mybrand
    flux
    ```
  - Mixed formats with or without extensions.
- **🏷️ TLD Categories & Custom Extensions:** Quick presets for Popular, Tech/Dev, and Modern TLDs, plus an instant adder for custom TLDs (e.g. `.tr`, `.de`, `.uk`, `.gg`).
- **🛡️ Rate-Limit Safe-Mode:** Adjustable speeds (⚡ Fast, ⚖️ Balanced, 🛡️ Safe) with automatic 429 backoff handling to prevent IP blocking.
- **🛒 1-Click Live Registrar Links:** Instant links to Porkbun, Namecheap, and Cloudflare to view live pricing and register available domains.
- **⭐ Save & Export:** Star favorite domains (saved in browser `localStorage`), export to **JSON**, **CSV**, or copy to clipboard.
- **🌓 Dark & Light Modes:** Clean, responsive design.

---

## 💻 Quick Start (macOS / Linux / Windows)

Open your terminal, navigate to the folder, and run:

```bash
python app.py
```
*(or `python3 app.py` on macOS/Linux)*

The server will start and automatically open your default browser at:
👉 **`http://localhost:8080`**

To stop the server anytime, press `Ctrl + C` in the terminal.

---

## 📁 Project Structure

```
domain-checker/
├── app.py              # Zero-dependency Python server & RDAP proxy
├── README.md           # Documentation
└── public/             # Modern frontend web app
    ├── index.html      # UI structure & controls
    ├── style.css       # Clean Dark/Light styling
    └── app.js          # Input parser, RDAP queue & export engine
```

---

## 📜 License

MIT License - 100% Free and Open Source.
