from dotenv import load_dotenv
load_dotenv()
from google import genai
import os
import json

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


@app.route("/")
def home():
    return render_template("Rules.html")


@app.route("/index")
def index():
    return render_template("index.html")


@app.route("/calendar")
def calendar():
    return render_template("Calendar.html")

@app.route("/chart")
def chart():
    return render_template("Chart.html")

@app.route("/contract")
def contract():
    return render_template("Contract.html")


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

        top_15 = sorted_products[:15]
        cleaned = []

        for p in top_15:
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