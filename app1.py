from datetime import datetime, timezone
from threading import Lock

from flask import Flask, request, jsonify

app = Flask(__name__)

# Últimas lecturas recibidas, protegidas con lock (Flask puede atender en hilos)
latest = {
    "temperature": None,
    "humidity": None,
    "wind_speed": None,
}
latest_lock = Lock()

# Límites razonables para descartar lecturas erróneas
LIMITS = {
    "temperature": (-40.0, 80.0),  # °C, rango del DHT22
    "humidity": (0.0, 100.0),  # %
    "wind_speed": (0.0, 75.0),  # m/s (75 m/s ≈ huracán categoría 5)
}
UNITS = {
    "temperature": "°C",
    "humidity": "%",
    "wind_speed": "m/s",
}


def parse_value(payload, key):
    """Extrae y valida el campo 'value' del JSON recibido."""
    if not payload or "value" not in payload:
        return None, "Falta el campo 'value'"

    try:
        value = float(payload["value"])
    except (TypeError, ValueError):
        return None, "'value' no es numérico"

    low, high = LIMITS[key]
    if not (low <= value <= high):
        return None, f"'value' fuera de rango ({low} a {high} {UNITS[key]})"

    return value, None


def handle_measurement(key):
    payload = request.get_json(silent=True)
    value, error = parse_value(payload, key)
    if error:
        return jsonify({"error": error}), 400

    timestamp = datetime.now(timezone.utc).isoformat()
    with latest_lock:
        latest[key] = {"value": value, "timestamp": timestamp}

    print(f"[{timestamp}] {key}: {value:.2f} {UNITS[key]}")
    return "", 200


@app.route("/temperature", methods=["POST"])
def temperature():
    return handle_measurement("temperature")


@app.route("/humidity", methods=["POST"])
def humidity():
    return handle_measurement("humidity")


@app.route("/wind_speed", methods=["POST"])
def wind_speed():
    return handle_measurement("wind_speed")


@app.route("/latest", methods=["GET"])
def get_latest():
    """Devuelve la última lectura de cada variable."""
    with latest_lock:
        return jsonify(latest)

s
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080)
