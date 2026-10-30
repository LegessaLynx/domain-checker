#!/usr/bin/env python3
"""
🌐 Super Simple Domain Checker
Cross-platform, zero-dependency local server & authoritative RDAP domain checker.
Works on macOS, Linux, and Windows.
"""

import contextlib
import hashlib
import http.server
import itertools
import random
import socketserver
import sqlite3
import urllib.request
import urllib.error
import urllib.parse
import json
import webbrowser
import threading
import time
import sys
import os
import re
import socket
import struct
import collections

DEFAULT_PORT = 8080
# Set DOMAIN_CHECKER_HOST=0.0.0.0 to reach the app from other devices on the network
HOST = os.environ.get("DOMAIN_CHECKER_HOST", "127.0.0.1")
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PUBLIC_DIR = os.path.join(BASE_DIR, "public")
DB_PATH = os.environ.get("DOMAIN_CHECKER_DB", os.path.join(BASE_DIR, "alarms.db"))

# Alarm watcher pacing: one registry query at a time, far below any rate limit
WATCHER_DELAY = 10
WATCHER_BACKOFF_START = 60
WATCHER_BACKOFF_MAX = 3600
HOUR = 3600
CHECK_INTERVALS = {
    "available": 6 * HOUR,
    "pending_delete": HOUR,
    "redemption": 6 * HOUR,
    "expired": 6 * HOUR,
    "registered": 7 * 24 * HOUR,
}
FAILED_CHECK_RETRY = HOUR
DOMAIN_PATTERN = re.compile(r"^[a-z0-9-]+(\.[a-z0-9-]+)+$")

# Discover scanner: walks word pairs through public DNS, best names first
SCAN_TLD = "com"
SCAN_DELAY = float(os.environ.get("DOMAIN_CHECKER_SCAN_DELAY", "1"))
SCAN_RETRY_MAX = 300
# The .com zone's own servers. A name in the zone is registered and a free name can't be in it, so
# unlike a caching resolver these can't report a free name as registered.
SCAN_SERVERS = (("a.gtld-servers.net", "192.5.6.30"), ("b.gtld-servers.net", "192.33.14.30"))
SCAN_RESULT_LIMIT = 200
# A "taken" verdict goes stale: names leave DNS weeks before they drop, so they must come back for another look
TAKEN_RECHECK_AFTER = 7 * 24 * HOUR
JOINT_PENALTY = 100
LENGTH_PENALTY = 25
IDEAL_LENGTH = 8
DNS_NOERROR = 0
DNS_NXDOMAIN = 3
SINGLE_RANK_DIVISOR = 50
# Scan order. Each section is a list of whole words, or every pairing of two lists.
SCAN_SECTIONS = (
    {"name": "Classic words", "words": "classic", "view": "classic"},
    {"name": "Single words", "words": "single", "view": "single"},
    {"name": "Other words", "words": "extended", "view": "single"},
    {"name": "Tech pairs", "first": "tech_first", "second": "tech_second", "view": "tech"},
    {"name": "Elegant words", "words": "elegant", "view": "elegant"},
    {"name": "Easy names", "words": "easy", "view": "easy"},
    {"name": "Elegant pairs", "first": "elegant", "second": "elegant", "view": "elegant"},
    {"name": "Tech + things", "first": "tech_first", "second": "second", "view": "tech"},
    {"name": "Adjective + tech", "first": "first", "second": "tech_second", "view": "tech"},
    {"name": "Word pairs", "first": "first", "second": "second", "view": None},
)
# Easy names like tuta: letters are listed softest sounding first, so the nicest names are tried first
EASY_CONSONANTS = "lmnrstvdkbpfgzh"
EASY_VOWELS = "aoieu"
EASY_ENDINGS = "lmnrst"
EASY_PATTERNS = (
    (EASY_CONSONANTS, EASY_VOWELS, EASY_CONSONANTS, EASY_VOWELS),
    (EASY_CONSONANTS, EASY_VOWELS, EASY_CONSONANTS, EASY_VOWELS, EASY_ENDINGS),
    (EASY_VOWELS, EASY_CONSONANTS, EASY_VOWELS, EASY_CONSONANTS, EASY_VOWELS),
    (EASY_CONSONANTS[:10], EASY_VOWELS[:4]) * 3,
)


def easy_names():
    """Every name the patterns allow, shortest first, then softest sounding."""
    names = []
    for pattern in EASY_PATTERNS:
        ranked = [
            (sum(pool.index(letter) for pool, letter in zip(pattern, name)), "".join(name))
            for name in itertools.product(*pattern)
        ]
        names.extend(name for rank, name in sorted(ranked))
    return list(dict.fromkeys(names))


WORDS_SEED_PATH = os.path.join(PUBLIC_DIR, "words.json")
WORD_PATTERN = re.compile(r"^[a-z0-9-]{2,20}$")
ADDED_WORDS_SHOWN = 50
EDITABLE_WORD_LISTS = ("tech_first", "tech_second", "elegant", "classic", "first", "second", "single")


def find_available_port(start_port=DEFAULT_PORT, max_attempts=20):
    """Find an open port starting from start_port."""
    for port in range(start_port, start_port + max_attempts):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            # Without this, recently closed connections make the port look busy (Windows semantics differ)
            if os.name != "nt":
                s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                s.bind((HOST, port))
                return port
            except OSError:
                continue
    return start_port


DIRECT_RDAP_SERVERS = {
    # Verisign (.com, .net, .cc, .tv)
    "com": "https://rdap.verisign.com/com/v1/domain/",
    "net": "https://rdap.verisign.com/net/v1/domain/",
    "cc": "https://tld-rdap.verisign.com/cc/v1/domain/",
    "tv": "https://rdap.nic.tv/domain/",
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
    # Identity Digital (.io, .ai, .sh, .ac, .me, .agency, .info)
    "io": "https://rdap.identitydigital.services/rdap/domain/",
    "ai": "https://rdap.identitydigital.services/rdap/domain/",
    "sh": "https://rdap.identitydigital.services/rdap/domain/",
    "ac": "https://rdap.identitydigital.services/rdap/domain/",
    "agency": "https://rdap.identitydigital.services/rdap/domain/",
    "me": "https://rdap.identitydigital.services/rdap/domain/",
    "info": "https://rdap.identitydigital.services/rdap/domain/",
    # Other registries
    "cloud": "https://rdap.registry.cloud/rdap/domain/",
    "biz": "https://rdap.nic.biz/domain/",
}

# Fallback for TLDs without public RDAP (.co, .de, .tr, ...)
WHOIS_TAKEN = re.compile(
    r"^\W*(domain name:|domain status:|registrar:|creation date:|created:|status:\s*connect)",
    re.IGNORECASE | re.MULTILINE,
)
WHOIS_NOT_FOUND = re.compile(
    r"not found|no match|no data found|no entries found|does not exist|status:\s*free",
    re.IGNORECASE,
)
whois_servers = {}


def whois_query(server, query):
    """Send a query to a WHOIS server (port 43) and return the raw response."""
    with socket.create_connection((server, 43), timeout=7) as s:
        s.settimeout(7)
        s.sendall(f"{query}\r\n".encode("utf-8"))
        chunks = []
        while True:
            chunk = s.recv(4096)
            if not chunk:
                break
            chunks.append(chunk)
    return b"".join(chunks).decode("utf-8", "replace")


def find_whois_server(tld):
    """Look up (and cache) the WHOIS server of a TLD via IANA."""
    if tld not in whois_servers:
        match = re.search(r"^whois:\s*(\S+)", whois_query("whois.iana.org", tld), re.MULTILINE)
        if not match:
            return None
        whois_servers[tld] = match.group(1)
    return whois_servers[tld]


def check_whois(domain):
    """Return True if available, False if taken, None if WHOIS gave no clear answer."""
    try:
        server = find_whois_server(domain.split(".")[-1])
        if not server:
            return None
        response = whois_query(server, domain)
    except OSError:
        return None

    if WHOIS_TAKEN.search(response):
        return False
    if WHOIS_NOT_FOUND.search(response):
        return True
    return None


def format_rdap_response(domain, data, available=False):
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


def lookup_domain(domain):
    """Query official RDAP servers with fallback to rdap.org, then WHOIS. Returns (http_status, result)."""
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
                return 200, format_rdap_response(domain, data, available=False)

        except urllib.error.HTTPError as e:
            # rdap.org answers 404 itself for TLDs it has no server for, which says nothing about the domain
            if e.code == 404 and urllib.parse.urlparse(e.url).hostname == "rdap.org":
                last_error = "No RDAP service for this TLD."
                continue
            elif e.code == 404:
                return 200, {
                    "domain": domain,
                    "available": True,
                    "status_code": 404,
                    "status_text": "Available (Unregistered)",
                    "message": "Domain is not registered."
                }
            elif e.code in (403, 429):
                retry_after = e.headers.get("Retry-After", "")
                return 429, {
                    "domain": domain,
                    "error": f"Rate limit reached (HTTP {e.code}).",
                    "status_code": 429,
                    "retry_after": int(retry_after) if retry_after.isdigit() else None
                }
            else:
                last_error = f"HTTP {e.code}"
                time.sleep(0.3)
                continue

        except (urllib.error.URLError, Exception) as e:
            last_error = str(e)
            time.sleep(0.3)
            continue

    whois_available = check_whois(domain)
    if whois_available is not None:
        return 200, {
            "domain": domain,
            "available": whois_available,
            "status_code": 200,
            "status_text": "Available (Unregistered)" if whois_available else "Taken (Registered)",
            "registrar": "Unknown"
        }

    # If all fallback attempts fail
    return 200, {
        "domain": domain,
        "available": None,
        "error": last_error or "RDAP query failed across all servers."
    }


def open_db():
    conn = sqlite3.connect(DB_PATH, timeout=60)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with contextlib.closing(open_db()) as conn, conn:
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS alarms (
                domain TEXT PRIMARY KEY,
                phase TEXT NOT NULL DEFAULT 'pending',
                expiration_date TEXT,
                available_since REAL,
                last_checked REAL,
                next_check REAL NOT NULL DEFAULT 0,
                failed INTEGER NOT NULL DEFAULT 0
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS scan_state (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                enabled INTEGER NOT NULL DEFAULT 0,
                checked_total INTEGER NOT NULL DEFAULT 0,
                errors INTEGER NOT NULL DEFAULT 0,
                last_checked REAL,
                words_hash TEXT
            )
        """)
        conn.execute("INSERT OR IGNORE INTO scan_state (id) VALUES (1)")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS words (
                list TEXT NOT NULL,
                word TEXT NOT NULL,
                rank INTEGER NOT NULL,
                added_at REAL,
                PRIMARY KEY (list, word)
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS names (
                domain TEXT PRIMARY KEY,
                section_order INTEGER NOT NULL,
                section TEXT NOT NULL,
                first_word TEXT NOT NULL,
                second_word TEXT NOT NULL,
                first_rank INTEGER NOT NULL,
                second_rank INTEGER NOT NULL,
                penalty INTEGER NOT NULL,
                score INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                last_checked REAL,
                found_at REAL,
                verdict TEXT NOT NULL DEFAULT 'unverified',
                verified_at REAL,
                priority INTEGER NOT NULL DEFAULT 0
            )
        """)
        if "added_at" not in [row["name"] for row in conn.execute("PRAGMA table_info(words)")]:
            conn.execute("ALTER TABLE words ADD COLUMN added_at REAL")
        if "priority" not in [row["name"] for row in conn.execute("PRAGMA table_info(names)")]:
            conn.execute("ALTER TABLE names ADD COLUMN priority INTEGER NOT NULL DEFAULT 0")

        # This index is the scan queue: names sent to the front, then never-checked names, then the oldest check
        conn.execute("DROP INDEX IF EXISTS names_queue")
        conn.execute("CREATE INDEX names_queue ON names (priority DESC, last_checked, section_order, score)")
        conn.execute("CREATE INDEX IF NOT EXISTS names_status ON names (status, score)")

        columns = [row["name"] for row in conn.execute("PRAGMA table_info(scan_state)")]
        for column in ("round", "rank_sum", "first_index", "checked_round", "single_index", "section"):
            if column in columns:
                conn.execute(f"ALTER TABLE scan_state DROP COLUMN {column}")

        seed_words(conn)
        migrate_discoveries(conn)
        for order, section in enumerate(SCAN_SECTIONS):
            conn.execute(
                "UPDATE names SET section_order = ? WHERE section = ? AND section_order != ?",
                (order, section["name"], order)
            )
    refresh_section_sizes()


def insert_words(conn, list_name, words, added_at=None):
    """Add words to the end of a list and return how many were new. Existing words keep their rank."""
    rank = conn.execute("SELECT COALESCE(MAX(rank) + 1, 0) FROM words WHERE list = ?", (list_name,)).fetchone()[0]
    before = conn.total_changes
    conn.executemany(
        "INSERT OR IGNORE INTO words (list, word, rank, added_at) VALUES (?, ?, ?, ?)",
        ((list_name, word, rank + i, added_at) for i, word in enumerate(words))
    )
    return conn.total_changes - before


def seed_words(conn):
    """Load words.json and the easy name patterns. Only ever adds, so nothing checked so far is lost."""
    with open(WORDS_SEED_PATH, "rb") as f:
        words_file = f.read()
    words_hash = hashlib.sha256(words_file + repr(EASY_PATTERNS).encode("utf-8")).hexdigest()
    is_seeded = conn.execute("SELECT 1 FROM names LIMIT 1").fetchone()
    if is_seeded and conn.execute("SELECT words_hash FROM scan_state").fetchone()[0] == words_hash:
        return

    for list_name, words in json.loads(words_file).items():
        insert_words(conn, list_name, words)
    insert_words(conn, "easy", easy_names())
    build_names(conn)
    conn.execute("UPDATE scan_state SET words_hash = ?", (words_hash,))


def section_names(conn, order, section):
    """Every name a section makes from the current word lists, as rows for the names table."""
    def read_list(key):
        return conn.execute("SELECT word, rank FROM words WHERE list = ? ORDER BY rank", (section[key],)).fetchall()

    if "words" in section:
        for word, rank in read_list("words"):
            yield (f"{word}.{SCAN_TLD}", order, section["name"], word, "", rank, 0, 0, rank // SINGLE_RANK_DIVISOR)
        return

    seconds = read_list("second")
    for first, first_rank in read_list("first"):
        for second, second_rank in seconds:
            if first != second:
                penalty = name_penalty(first, second)
                yield (f"{first}{second}.{SCAN_TLD}", order, section["name"], first, second, first_rank,
                       second_rank, penalty, first_rank + second_rank + penalty)


def build_names(conn):
    """Create any names missing from the table. Names that already exist keep their results."""
    for order, section in enumerate(SCAN_SECTIONS):
        conn.executemany(
            """
            INSERT OR IGNORE INTO names (domain, section_order, section, first_word, second_word,
                first_rank, second_rank, penalty, score)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            section_names(conn, order, section)
        )


def migrate_discoveries(conn):
    """Move results from the old discoveries table into names, then drop it."""
    if not conn.execute("SELECT 1 FROM sqlite_master WHERE name = 'discoveries'").fetchone():
        return
    for old in conn.execute("SELECT * FROM discoveries").fetchall():
        conn.execute(
            """
            INSERT INTO names (domain, section_order, section, first_word, second_word, first_rank, second_rank,
                penalty, score, status, last_checked, found_at, verdict, verified_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'free', ?, ?, ?, ?)
            ON CONFLICT (domain) DO UPDATE SET status = 'free', last_checked = excluded.last_checked,
                found_at = excluded.found_at, verdict = excluded.verdict, verified_at = excluded.verified_at
            """,
            (old["domain"], len(SCAN_SECTIONS) - 1, SCAN_SECTIONS[-1]["name"], old["first_word"], old["second_word"],
             old["first_rank"], old["second_rank"], old["penalty"], old["score"], old["last_seen"], old["found_at"],
             old["verdict"], old["verified_at"])
        )
    conn.execute("DROP TABLE discoveries")


section_sizes = {}


def refresh_section_sizes():
    with contextlib.closing(open_db()) as conn:
        sizes = dict(conn.execute("SELECT section, COUNT(*) FROM names GROUP BY section").fetchall())
    section_sizes.clear()
    section_sizes.update({s["name"]: sizes.get(s["name"], 0) for s in SCAN_SECTIONS})


def send_to_front(conn, words):
    """Queue every name made from these words ahead of everything else. Returns how many were moved."""
    before = conn.total_changes
    for word in words:
        conn.execute("UPDATE names SET priority = 1 WHERE first_word = ? OR second_word = ?", (word, word))
    return conn.total_changes - before


def add_words(list_name, words, to_front=True):
    """Add words to a list and queue the names they make. Returns (new words, new names, names at the front)."""
    valid = [w for w in words if isinstance(w, str) and WORD_PATTERN.match(w)]
    with contextlib.closing(open_db()) as conn, conn:
        added = insert_words(conn, list_name, valid, added_at=time.time())
        before = conn.execute("SELECT COUNT(*) FROM names").fetchone()[0]
        build_names(conn)
        created = conn.execute("SELECT COUNT(*) FROM names").fetchone()[0] - before
        moved = send_to_front(conn, valid) if to_front else 0
    refresh_section_sizes()
    return added, created, moved


def move_word_to_front(word):
    with contextlib.closing(open_db()) as conn, conn:
        return send_to_front(conn, [word])


def list_mix_words():
    """The word lists Word Mix picks from."""
    with contextlib.closing(open_db()) as conn:
        return {
            key: [row[0] for row in conn.execute("SELECT word FROM words WHERE list = ? ORDER BY rank", (key,))]
            for key in ("first", "second")
        }


def add_alarms(domains):
    """Add domains to the watch list and return how many were new."""
    valid = [(d,) for d in domains if isinstance(d, str) and DOMAIN_PATTERN.match(d)]
    with contextlib.closing(open_db()) as conn, conn:
        before = conn.total_changes
        conn.executemany("INSERT OR IGNORE INTO alarms (domain) VALUES (?)", valid)
        return conn.total_changes - before


def remove_alarms(domain=None):
    """Remove one domain from the watch list, or all of them."""
    with contextlib.closing(open_db()) as conn, conn:
        if domain:
            conn.execute("DELETE FROM alarms WHERE domain = ?", (domain,))
        else:
            conn.execute("DELETE FROM alarms")


def list_alarms():
    with contextlib.closing(open_db()) as conn:
        return [dict(row) for row in conn.execute("SELECT * FROM alarms ORDER BY domain")]


def next_due_alarm():
    with contextlib.closing(open_db()) as conn:
        row = conn.execute(
            "SELECT domain FROM alarms WHERE next_check <= ? ORDER BY next_check LIMIT 1", (time.time(),)
        ).fetchone()
    return row["domain"] if row else None


def classify_alarm(result):
    """Map a lookup result to a stage of the domain's expiry lifecycle."""
    if result["available"]:
        return "available"

    flags = {flag.lower().replace(" ", "") for flag in result.get("status_flags", [])}
    if "pendingdelete" in flags:
        return "pending_delete"
    if flags & {"redemptionperiod", "pendingrestore"}:
        return "redemption"
    if "autorenewperiod" in flags:
        return "expired"

    expiration = result.get("expiration_date")
    if expiration and expiration[:19] < time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()):
        return "expired"
    return "registered"


def record_alarm_result(domain, result):
    now = time.time()
    phase = classify_alarm(result)
    # Jitter spreads rechecks out so the list doesn't all come due at once
    interval = CHECK_INTERVALS[phase]
    next_check = now + interval + random.uniform(0, interval * 0.1)
    with contextlib.closing(open_db()) as conn, conn:
        conn.execute(
            """
            UPDATE alarms SET phase = ?, expiration_date = ?, last_checked = ?, next_check = ?, failed = 0,
                available_since = CASE WHEN ? = 'available' THEN COALESCE(available_since, ?) END
            WHERE domain = ?
            """,
            (phase, result.get("expiration_date"), now, next_check, phase, now, domain)
        )


def delay_alarm(domain, delay, failed):
    with contextlib.closing(open_db()) as conn, conn:
        conn.execute(
            "UPDATE alarms SET next_check = ?, failed = ? WHERE domain = ?",
            (time.time() + delay, int(failed), domain)
        )


watcher_state = {"blocked_until": 0}


def watch_alarms():
    """Check due alarms one at a time, backing off as soon as a registry pushes back."""
    backoff = WATCHER_BACKOFF_START
    while True:
        domain = next_due_alarm()
        if not domain:
            time.sleep(WATCHER_DELAY)
            continue

        try:
            status, result = lookup_domain(domain)
        except Exception as e:
            status, result = 200, {"domain": domain, "available": None, "error": str(e)}

        if status == 429:
            wait = result.get("retry_after") or backoff
            backoff = min(backoff * 2, WATCHER_BACKOFF_MAX)
            watcher_state["blocked_until"] = time.time() + wait
            delay_alarm(domain, wait, failed=False)
            time.sleep(wait)
            continue

        backoff = WATCHER_BACKOFF_START
        watcher_state["blocked_until"] = 0
        if result.get("available") is None:
            delay_alarm(domain, FAILED_CHECK_RETRY, failed=True)
        else:
            record_alarm_result(domain, result)
        time.sleep(WATCHER_DELAY)


scan_live = {"current": None, "recent": collections.deque(maxlen=30)}


def dns_lookup(domain, resolver):
    """Ask a DNS server for a domain's NS records. Returns the response code, or None without an answer."""
    query_id = random.randrange(65536)
    name = b"".join(bytes([len(label)]) + label.encode("ascii") for label in domain.split("."))
    packet = struct.pack(">HHHHHH", query_id, 0, 1, 0, 0, 0) + name + b"\0" + struct.pack(">HH", 2, 1)

    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        s.settimeout(3)
        try:
            s.sendto(packet, (resolver, 53))
            response = s.recv(4096)
        except OSError:
            return None

    if len(response) < 12 or struct.unpack(">H", response[:2])[0] != query_id:
        return None
    return response[3] & 0x0F


def check_dns(domain):
    """Return ('registered' | 'free' | None, answers). None means no clear answer, so the name must be retried."""
    answers = []
    for label, server in SCAN_SERVERS:
        code = dns_lookup(domain, server)
        name = {DNS_NOERROR: "NOERROR", DNS_NXDOMAIN: "NXDOMAIN", None: "no answer"}.get(code, f"error {code}")
        answers.append({"resolver": label, "answer": name})
        if code == DNS_NOERROR:
            return "registered", answers
        if code == DNS_NXDOMAIN:
            return "free", answers
    return None, answers


def name_penalty(first, second):
    penalty = JOINT_PENALTY if first[-1] == second[0] else 0
    return penalty + max(0, len(first) + len(second) - IDEAL_LENGTH) * LENGTH_PENALTY


def get_scan_state():
    with contextlib.closing(open_db()) as conn:
        return dict(conn.execute("SELECT * FROM scan_state WHERE id = 1").fetchone())


def set_scan_enabled(enabled):
    with contextlib.closing(open_db()) as conn, conn:
        conn.execute("UPDATE scan_state SET enabled = ? WHERE id = 1", (int(enabled),))


def next_scan_name():
    """The next name to check: the front of the queue, then never-checked names, then the oldest check."""
    with contextlib.closing(open_db()) as conn:
        row = conn.execute(
            "SELECT * FROM names ORDER BY priority DESC, last_checked, section_order, score LIMIT 1"
        ).fetchone()
    return dict(row) if row else None


def save_scan_result(domain, verdict):
    """Store a definite answer. A name without one keeps its place in the queue, so none are skipped."""
    now = time.time()
    with contextlib.closing(open_db()) as conn, conn:
        if verdict == "free":
            conn.execute(
                """
                UPDATE names SET found_at = CASE WHEN status = 'free' THEN found_at ELSE ? END,
                    status = 'free', last_checked = ?, priority = 0,
                    verdict = CASE WHEN verdict = 'taken' AND verified_at < ? THEN 'unverified' ELSE verdict END
                WHERE domain = ?
                """,
                (now, now, now - TAKEN_RECHECK_AFTER, domain)
            )
        else:
            conn.execute(
                """
                UPDATE names SET status = 'registered', last_checked = ?, found_at = NULL, priority = 0,
                    verdict = CASE WHEN verdict = 'hidden' THEN 'hidden' ELSE 'unverified' END
                WHERE domain = ?
                """,
                (now, domain)
            )
        conn.execute("UPDATE scan_state SET checked_total = checked_total + 1, last_checked = ? WHERE id = 1", (now,))


def scan_names():
    """Check names forever, one per SCAN_DELAY. A name stays next until DNS answers clearly."""
    retry_delay = SCAN_DELAY
    while True:
        state = get_scan_state()
        name = next_scan_name() if state["enabled"] else None
        if not name:
            scan_live["current"] = None
            time.sleep(2)
            continue

        check = {"domain": name["domain"], "section": name["section"], "first": name["first_word"],
                 "second": name["second_word"], "first_rank": name["first_rank"], "second_rank": name["second_rank"]}
        scan_live["current"] = check
        verdict, answers = check_dns(name["domain"])
        scan_live["recent"].appendleft(dict(check, verdict=verdict, answers=answers, at=time.time()))

        if verdict is None:
            with contextlib.closing(open_db()) as conn, conn:
                conn.execute("UPDATE scan_state SET errors = errors + 1 WHERE id = 1")
            retry_delay = min(retry_delay * 2, SCAN_RETRY_MAX)
            time.sleep(retry_delay)
            continue

        retry_delay = SCAN_DELAY
        save_scan_result(name["domain"], verdict)
        time.sleep(SCAN_DELAY)


def scan_report(limit=SCAN_RESULT_LIMIT, view=None):
    """Everything the Discover tab shows: progress, live checks and the best names found."""
    state = get_scan_state()
    visible = "status = 'free' AND verdict NOT IN ('taken', 'hidden')"

    def in_view(name):
        names = [s["name"] for s in SCAN_SECTIONS if s["view"] == name]
        return f"section IN ({', '.join(repr(n) for n in names)})"

    with contextlib.closing(open_db()) as conn:
        count = lambda where: conn.execute(f"SELECT COUNT(*) FROM names WHERE {where}").fetchone()[0]
        found = count(visible)
        views = {name: count(f"{visible} AND {in_view(name)}") for name in ("classic", "tech", "elegant", "easy", "single")}
        shown = f"{visible} AND {in_view(view)}" if view in views else visible
        best = conn.execute(
            f"SELECT * FROM names WHERE {shown} ORDER BY verdict = 'available' DESC, score LIMIT ?",
            (limit,)
        ).fetchall()
        checked, oldest = conn.execute("SELECT COUNT(last_checked), MIN(last_checked) FROM names").fetchone()
        at_front = count("priority > 0")
        added_words = conn.execute(
            "SELECT word, list FROM words WHERE added_at IS NOT NULL ORDER BY added_at DESC, rank LIMIT ?",
            (ADDED_WORDS_SHOWN,)
        ).fetchall()
    return dict(
        state,
        found=found,
        views=views,
        best=[dict(row) for row in best],
        checked=checked,
        at_front=at_front,
        added_words=[dict(row) for row in added_words],
        oldest_check=oldest,
        current=scan_live["current"],
        recent=list(scan_live["recent"]),
        sections=[{"name": s["name"], "size": section_sizes[s["name"]]} for s in SCAN_SECTIONS],
        total_names=sum(section_sizes.values()),
        servers=[label for label, server in SCAN_SERVERS],
        delay=SCAN_DELAY,
        single_divisor=SINGLE_RANK_DIVISOR,
        joint_penalty=JOINT_PENALTY,
        length_penalty=LENGTH_PENALTY,
        ideal_length=IDEAL_LENGTH
    )


def set_name_verdict(domain, verdict):
    with contextlib.closing(open_db()) as conn, conn:
        conn.execute("UPDATE names SET verdict = ?, verified_at = ? WHERE domain = ?", (verdict, time.time(), domain))


def verify_name(domain):
    """Confirm one found name against the registry, for the Verify button. Returns (http_status, verdict)."""
    status, result = lookup_domain(domain)
    if status == 429 or result.get("available") is None:
        return 503, None
    verdict = "available" if result["available"] else "taken"
    set_name_verdict(domain, verdict)
    # On its way out of the registry: alarms track the exact stage from here
    if classify_alarm(result) in ("pending_delete", "redemption", "expired"):
        add_alarms([domain])
    return 200, verdict


def keep_running(worker):
    """Restart a background worker after an unexpected error, so scanning never stops silently."""
    while True:
        try:
            worker()
        except Exception as e:
            print(f"{worker.__name__} failed, restarting in 30s: {e}", file=sys.stderr)
            time.sleep(30)


class DomainCheckerHandler(http.server.SimpleHTTPRequestHandler):
    """Custom HTTP handler serving the web UI and providing an RDAP proxy."""

    # Browsers keep idle spare connections open; don't let them hold a thread forever
    timeout = 30

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PUBLIC_DIR, **kwargs)

    def end_headers(self):
        # Enable CORS and disable aggressive caching for local dev
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        super().end_headers()

    def send_json(self, payload, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.end_headers()
        self.wfile.write(json.dumps(payload).encode("utf-8"))

    def is_same_origin(self):
        """Stop other websites open in the browser from changing the watch list."""
        origin = self.headers.get("Origin")
        return not origin or urllib.parse.urlparse(origin).netloc == self.headers.get("Host")

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/api/rdap":
            self.handle_rdap_proxy(parsed)
        elif path == "/api/alarms":
            self.send_json({
                "alarms": list_alarms(),
                "blocked_until": watcher_state["blocked_until"],
                "delay": WATCHER_DELAY
            })
        elif path == "/api/words":
            self.send_json(list_mix_words())
        elif path == "/api/scan":
            params = urllib.parse.parse_qs(parsed.query)
            limit = params.get("limit", [""])[0]
            self.send_json(scan_report(
                int(limit) if limit.isdigit() else SCAN_RESULT_LIMIT,
                view=params.get("kind", [""])[0]
            ))
        elif path == "/api/health":
            self.send_json({"status": "ok"})
        else:
            # Serve static files from public directory
            super().do_GET()

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        if path not in ("/api/alarms", "/api/scan", "/api/scan/verify", "/api/words", "/api/words/front"):
            self.send_json({"error": "Not found."}, 404)
        elif not self.is_same_origin():
            self.send_json({"error": "Cross-origin request refused."}, 403)
        else:
            try:
                body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))).decode("utf-8"))
                if path == "/api/alarms":
                    self.send_json({"added": add_alarms(body["domains"])})
                elif path == "/api/scan":
                    set_scan_enabled(bool(body["enabled"]))
                    self.send_json({"enabled": bool(body["enabled"])})
                elif path == "/api/words":
                    if body["list"] not in EDITABLE_WORD_LISTS:
                        raise ValueError(body["list"])
                    added, created, moved = add_words(body["list"], body["words"], bool(body.get("to_front", True)))
                    self.send_json({"added": added, "names": created, "moved": moved})
                elif path == "/api/words/front":
                    self.send_json({"moved": move_word_to_front(str(body["word"]))})
                else:
                    status, verdict = verify_name(body["domain"])
                    self.send_json({"verdict": verdict}, status)
            except (ValueError, KeyError, TypeError):
                self.send_json({"error": "Invalid JSON body."}, 400)

    def do_DELETE(self):
        parsed = urllib.parse.urlparse(self.path)
        domain = urllib.parse.parse_qs(parsed.query).get("domain", [None])[0]
        if parsed.path not in ("/api/alarms", "/api/scan"):
            self.send_json({"error": "Not found."}, 404)
        elif not self.is_same_origin():
            self.send_json({"error": "Cross-origin request refused."}, 403)
        elif parsed.path == "/api/alarms":
            remove_alarms(domain)
            self.send_json({"status": "ok"})
        elif domain:
            set_name_verdict(domain, "hidden")
            self.send_json({"status": "ok"})
        else:
            self.send_json({"error": "Missing domain parameter."}, 400)

    def handle_rdap_proxy(self, parsed):
        """Check a domain for the web UI."""
        params = urllib.parse.parse_qs(parsed.query)
        domain = params.get("domain", [""])[0].strip().lower()

        if not domain or "." not in domain:
            self.send_json({"error": "Invalid or missing domain parameter."}, 400)
            return

        status, result = lookup_domain(domain)
        self.send_json(result, status)


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
    server_address = (HOST, port)
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

    init_db()
    threading.Thread(target=keep_running, args=(watch_alarms,), daemon=True).start()
    threading.Thread(target=keep_running, args=(scan_names,), daemon=True).start()

    # Launch browser automatically
    open_browser_delayed(url)

    # Allow fast restart without port lock
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    socketserver.ThreadingTCPServer.daemon_threads = True

    try:
        with socketserver.ThreadingTCPServer(server_address, DomainCheckerHandler) as httpd:
            httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n👋 Domain Checker server stopped. Goodbye!\n")
        sys.exit(0)


if __name__ == "__main__":
    main()
