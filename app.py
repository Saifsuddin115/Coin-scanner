from dotenv import load_dotenv
load_dotenv()
from google import genai
import json
import os
from functools import wraps
from datetime import datetime
from flask import Flask, request, jsonify, session, redirect
from models import db, Trade, MonthlySummary





client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
MODEL_NAME = "gemini-3.1-flash-lite"

from flask import Flask, render_template
import requests


CACHE_FILE = "halal_cache.json"
BLACKLIST = {"PIRATE", "THQ"}
REQUEST_TIMEOUT = 10  # seconds — prevents a stalled Coinbase call from hanging the server


def load_cache():
    try:
        with open(CACHE_FILE, "r") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def save_cache(cache):
    with open(CACHE_FILE, "w") as f:
        json.dump(cache, f, indent=2)


def safe_float(val):
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def check_halal(symbol, name):
    cache = load_cache()

    if symbol in cache:
        return cache[symbol]

    prompt = f"""
You are screening a cryptocurrency project for Islamic finance compliance.

Project Name: {name}
Ticker: {symbol}

Determine whether the PRIMARY purpose of this project is:

- halal
- haram
- unclear

A project should only be "haram" if its primary utility revolves around:
- interest or lending
- perpetual futures or leveraged derivatives
- gambling or betting
- meme coin

Do NOT classify a project as haram simply because it can be traded.

Respond ONLY as valid JSON.

{{
    "status": "halal",
    "confidence score":"number",
    "reason": "One short sentence explaining why."
}}
"""

    try:
        response = client.models.generate_content(
            model=MODEL_NAME,
            contents=prompt,
        )
        text = response.text.strip()

        # Gemini sometimes wraps JSON in markdown fences ```json ... ```
        if text.startswith("```"):
            text = text.strip("`")
            if text.startswith("json"):
                text = text[4:]
            text = text.strip()

        result = json.loads(text)

    except Exception as e:
        print(f"Halal check failed for {symbol}: {e}")
        result = {
            "status": "unclear",
            "confidence score": 0,
            "reason": "Screening unavailable right now."
        }

    cache[symbol] = result
    save_cache(cache)

    return result


app = Flask(__name__)

app.secret_key = os.environ["SECRET_KEY"]
db_url = os.environ["DATABASE_URL"]
if db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql://", 1)
app.config["SQLALCHEMY_DATABASE_URI"] = db_url
db.init_app(app)

with app.app_context():
    db.create_all()

def require_login(f):
    @wraps(f)
    def wrapper(*a, **kw):
        if not session.get("authed"):
            if request.path.startswith("/api/"):
                return jsonify({"error": "unauthorized"}), 401
            return redirect("/login")
        return f(*a, **kw)
    return wrapper

ALLOWED_TRADE_FIELDS = {
    "session", "coin", "direction", "setup", "sl", "tp", "rr", "pnl",
    "rules_followed", "reason", "confluences", "thesis",
    "what_happened", "better", "lesson", "entry_type", "notes"
}

@app.post("/login")
def login():
    if request.form.get("password") == os.environ["APP_PASSWORD"]:
        session["authed"] = True
        session.permanent = True  # stays logged in across visits
        return redirect("/")
    return "wrong password", 401

@app.get("/api/trades")
@require_login
def list_trades():
    q = Trade.query
    if request.args.get("year") and request.args.get("month"):
        y, m = int(request.args["year"]), int(request.args["month"])
        q = q.filter(db.extract('year', Trade.date) == y,
                     db.extract('month', Trade.date) == m)
    trades = q.order_by(Trade.date.desc()).all()
    return jsonify([t.to_dict() for t in trades])

@app.post("/api/trades")
@require_login
def create_trade():
    data = request.json
    fields = {k: v for k, v in data.items() if k in ALLOWED_TRADE_FIELDS}
    trade = Trade(date=datetime.fromisoformat(data["date"]).date(), **fields)
    db.session.add(trade)
    db.session.commit()
    return jsonify(trade.to_dict()), 201

@app.put("/api/trades/<int:id>")
@require_login
def update_trade(id):
    trade = Trade.query.get_or_404(id)
    for k, v in request.json.items():
        if k == "date":
            setattr(trade, "date", datetime.fromisoformat(v).date())
        elif k in ALLOWED_TRADE_FIELDS:
            setattr(trade, k, v)
    db.session.commit()
    return jsonify(trade.to_dict())

@app.delete("/api/trades/<int:id>")
@require_login
def delete_trade(id):
    Trade.query.filter_by(id=id).delete()
    db.session.commit()
    return "", 204

@app.route("/")
@require_login
def home():
    return render_template("Rules.html")


@app.route("/index")
@require_login
def index():
    return render_template("index.html")


@app.route("/calendar")
@require_login
def calendar():
    return render_template("Calendar.html")

@app.route("/chart")
@require_login
def chart():
    return render_template("Chart.html")

@app.route("/contract")
@require_login
def contract():
    return render_template("Contract.html")

@app.route("/journal")
@require_login
def journal():
    return render_template("sheets.html")

@app.get("/login")
def login_page():
    return render_template("login.html")


@app.route("/api/sparkline/<symbol>")
def sparkline(symbol):
    try:
        resp = requests.get(
            f"https://api.exchange.coinbase.com/products/{symbol}-USD/candles",
            params={"granularity": 3600},  # 1 candle per hour
            headers={"User-Agent": "TC-App"},
            timeout=REQUEST_TIMEOUT
        )
        candles = resp.json()  # newest-first: [time, low, high, open, close, volume]
        closes = [c[4] for c in reversed(candles[:24])]  # last 24h, oldest→newest
        return {"symbol": symbol, "closes": closes}
    except Exception as e:
        print(f"Sparkline fetch failed for {symbol}: {e}")
        return {"symbol": symbol, "closes": []}

@app.route("/api/gainers")
def gainers():
    try:
        response = requests.get(
            "https://api.coinbase.com/api/v3/brokerage/market/products",
            timeout=REQUEST_TIMEOUT
        )
        data = response.json()
        products = data["products"]

        filtered = [
            p for p in products
            if p["product_type"] == "SPOT"
            and p["quote_currency_id"] == "USD"
            and p["trading_disabled"] == False
            and p["is_disabled"] == False
            and p["base_currency_id"] not in BLACKLIST
            and safe_float(p.get("price_percentage_change_24h")) is not None
        ]

        sorted_products = sorted(
            filtered,
            key=lambda p: float(p["price_percentage_change_24h"]),
            reverse=True
        )

        top_20 = sorted_products[:20]
        cleaned = []

        for p in top_20:
            symbol = p["base_currency_id"]
            name = p["base_name"]

            cleaned.append({
                "name": name,
                "symbol": symbol,
                "price": p["price"],
                "change_24h": round(float(p["price_percentage_change_24h"]), 2),
                "volume_24h": round(safe_float(p.get("volume_24h")) or 0, 2),
                "halal_status": check_halal(symbol, name)
            })

        return cleaned

    except Exception as e:
        print(f"Gainers fetch failed: {e}")
        return []


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    debug_mode = os.getenv("FLASK_DEBUG", "false").lower() == "true"
    app.run(host="0.0.0.0", port=port, debug=debug_mode)