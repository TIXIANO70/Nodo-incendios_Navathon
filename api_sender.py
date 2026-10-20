"""
API Sender y Normalización para Apaso (Monitoreo de Incendios Forestales).

Esta API:
1. Extrae la última medición de DBincendios.db (SQLite) combinándola con la tabla nodos.
2. Normaliza el JSON al estándar del subsistema "Monitoreo de incendios forestales".
3. Expone el endpoint HTTP GET /api/incendios accesible tanto localmente como por nodos externos (ej: 192.168.4.1).
4. Opcionalmente ejecuta una tarea en segundo plano que envía la medición normalizada cada 30 segundos.
5. Imprime al iniciar la IP y URL accesible exacta para que los dispositivos externos puedan consultarla.
"""

import datetime
import json
import os
import socket
import sqlite3
import sys
import threading
import time
import urllib.error
import urllib.request

# Si se ejecuta fuera del entorno virtual como script directo, auto-cargar .venv local
_venv_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".venv")
_venv_python = os.path.join(_venv_path, "bin", "python3")
if os.path.exists(_venv_python) and sys.executable != _venv_python:
    if any(os.path.basename(__file__) in arg for arg in sys.argv):
        os.execv(_venv_python, [_venv_python] + sys.argv)

from flask import Flask, jsonify, request


# ==============================================================================
# CARGA DE VARIABLES DE ENTORNO (.env)
# ==============================================================================
def cargar_env(ruta=".env"):
    """Carga variables desde un archivo .env si existe en el directorio."""
    if os.path.exists(ruta):
        try:
            with open(ruta, "r", encoding="utf-8") as f:
                for linea in f:
                    linea = linea.strip()
                    if not linea or linea.startswith("#") or "=" not in linea:
                        continue
                    clave, valor = linea.split("=", 1)
                    clave = clave.strip()
                    valor = valor.strip().strip("\"'")
                    if clave and clave not in os.environ:
                        os.environ[clave] = valor
        except Exception as e:
            print(f"[CONFIG] Advertencia al leer {ruta}: {e}")


cargar_env()

# ==============================================================================
# CONFIGURACIÓN GENERAL
# ==============================================================================
TARGET_WEBHOOK_URL = os.environ.get("TARGET_WEBHOOK_URL", "")
ENABLE_WORKER = os.environ.get(
    "ENABLE_WORKER", "true" if TARGET_WEBHOOK_URL else "false"
).lower() in ("true", "1", "yes")
INTERVAL_SECONDS = int(os.environ.get("INTERVAL_SECONDS", "2"))
PORT = int(os.environ.get("PORT", "8081"))
HOST = os.environ.get("HOST", "0.0.0.0")
DB_PATH = os.environ.get("DB_PATH", "DBincendios.db")

app = Flask(__name__)

# ==============================================================================
# CORS  --  Permite que el frontend estático (index.html) consulte esta API
# ==============================================================================
# El navegador bloquea por defecto los pedidos cross-origin. Como el frontend
# se abre desde file:// o desde otro puerto/host, agregamos estas cabeceras
# en TODAS las respuestas. No requiere la librería flask-cors.
ALLOWED_ORIGINS = os.environ.get(
    "ALLOWED_ORIGINS", "*"
)  # ej: "http://localhost:8000,http://192.168.4.1"


@app.after_request
def _add_cors_headers(response):
    origin = request.headers.get("Origin")
    if ALLOWED_ORIGINS.strip() == "*":
        response.headers["Access-Control-Allow-Origin"] = "*"
    elif origin and origin in ALLOWED_ORIGINS.split(","):
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Vary"] = "Origin"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = (
        "Content-Type, Accept, User-Agent"
    )
    response.headers["Access-Control-Max-Age"] = "600"
    return response


@app.before_request
def _handle_preflight():
    """Responde 204 automáticamente a las peticiones OPTIONS preflight."""
    if request.method == "OPTIONS":
        return "", 204


# ==============================================================================
# ESTADO Y MÉTRICAS DE TELEMETRÍA (THREAD-SAFE)
# ==============================================================================
metrics_lock = threading.Lock()
stop_event = threading.Event()

metrics = {
    "worker_active": False,
    "target_webhook_url": TARGET_WEBHOOK_URL,
    "interval_seconds": INTERVAL_SECONDS,
    "db_path": DB_PATH,
    "last_attempt_at": None,
    "last_success_at": None,
    "last_http_status": None,
    "last_error": None,
    "total_dispatched": 0,
    "total_errors": 0,
    "last_record_id": None,
}


def ahora_utc():
    """Devuelve la fecha/hora actual en formato ISO 8601 UTC."""
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ==============================================================================
# DETECCIÓN DE IPS LOCALES Y DE RED (AP 192.168.4.1)
# ==============================================================================
def obtener_ips_locales():
    """Detecta las direcciones IP locales para mostrar la URL accesible."""
    ips = []
    # 1. Intentar descubrir la IP en la interfaz conectada al AP (192.168.4.1)
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("192.168.4.1", 80))
        ip_ap = s.getsockname()[0]
        s.close()
        if ip_ap and ip_ap not in ips and not ip_ap.startswith("127."):
            ips.append(ip_ap)
    except Exception:
        pass

    # 2. Intentar descubrir la IP de salida estándar (LAN / WiFi)
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip_out = s.getsockname()[0]
        s.close()
        if ip_out and ip_out not in ips and not ip_out.startswith("127."):
            ips.append(ip_out)
    except Exception:
        pass

    # 3. Fallback por hostname
    try:
        hostname = socket.gethostname()
        for ip in socket.gethostbyname_ex(hostname)[2]:
            if ip not in ips and not ip.startswith("127."):
                ips.append(ip)
    except Exception:
        pass

    return ips


# ==============================================================================
# NORMALIZACIÓN DE DATOS (ESQUEMA MANEJO DE INCENDIOS FORESTALES)
# ==============================================================================
def normalizar_medicion(fila_dict):
    """
    Transforma la fila leída de SQLite al esquema JSON normalizado del grupo:
    {
      "schema_version": "1.0.0",
      "record_id": "...",
      "record_type": "reading",
      "node_id": "fire_node_01",
      "group": 1,
      "subsystem": "Monitoreo de incendios forestales",
      "timestamp": "2026-10-14T13:30:00Z",
      "status": "active",
      "alert_level": "medium",
      "data": {
        "temperature": 31.5,
        "humidity": 28,
        "wind_speed": 5.2
      },
      "metadata": {
        "environment": "operational",
        "source_type": "real",
        "alert_evaluated": true,
        "clock_synced": true,
        "units": { ... },
        "quality": { ... }
      }
    }
    """
    if not fila_dict:
        return None

    temp = fila_dict.get("temperature")
    hum = fila_dict.get("humidity")
    wind = fila_dict.get("wind_speed")
    smoke = fila_dict.get("smoke_level")

    data = {
        "temperature": temp,
        "humidity": hum,
        "wind_speed": wind,
    }
    if smoke is not None:
        data["smoke_level"] = smoke

    units = {
        "temperature": "degC",
        "humidity": "%",
        "wind_speed": "m/s",
    }
    if smoke is not None:
        units["smoke_level"] = "ppm"

    quality = {
        "temperature": "valid" if temp is not None else "missing",
        "humidity": "valid" if hum is not None else "missing",
        "wind_speed": "valid" if wind is not None else "missing",
    }
    if smoke is not None:
        quality["smoke_level"] = "valid"

    # SQLite guarda booleanos como 0 o 1
    alert_eval = bool(fila_dict.get("alert_evaluated", 1))
    clock_sync = bool(fila_dict.get("clock_synced", 1))

    # Número de grupo (por defecto 1)
    raw_group = fila_dict.get("node_group") or fila_dict.get("group")
    try:
        group_val = int(raw_group) if raw_group is not None else 1
    except (ValueError, TypeError):
        group_val = 1

    return {
        "schema_version": fila_dict.get("schema_version") or "1.0.0",
        "record_id": fila_dict.get("record_id"),
        "record_type": fila_dict.get("record_type") or "reading",
        "node_id": fila_dict.get("node_id") or "fire_node_01",
        "group": group_val,
        "subsystem": fila_dict.get("subsystem") or "Monitoreo de incendios forestales",
        "timestamp": fila_dict.get("timestamp"),
        "status": fila_dict.get("status") or "active",
        "alert_level": fila_dict.get("alert_level") or "normal",
        "data": data,
        "metadata": {
            "environment": fila_dict.get("environment") or "test",
            "source_type": fila_dict.get("source_type") or "simulated",
            "alert_evaluated": alert_eval,
            "clock_synced": clock_sync,
            "units": units,
            "quality": quality,
        },
    }


# ==============================================================================
# LECTURA DE BASE DE DATOS
# ==============================================================================
def obtener_ultima_medicion(db_path=None):
    """
    Lee la última fila de la tabla 'mediciones' haciendo JOIN con 'nodos'
    y la retorna en formato normalizado.
    Retorna una tupla (registro_normalizado_dict, error_str).
    """
    path = db_path or DB_PATH
    if not os.path.exists(path):
        return None, f"Base de datos no encontrada en ruta: {path}"

    query = """
        SELECT 
            m.record_id,
            m.schema_version,
            m.record_type,
            m.node_id,
            n."group" AS node_group,
            n.subsystem,
            m.timestamp,
            m.status,
            m.alert_level,
            m.temperature,
            m.humidity,
            m.wind_speed,
            m.smoke_level,
            m.environment,
            m.source_type,
            m.alert_evaluated,
            m.clock_synced
        FROM mediciones m
        LEFT JOIN nodos n ON m.node_id = n.node_id
        ORDER BY m.timestamp DESC
        LIMIT 1;
    """

    con = None
    try:
        con = sqlite3.connect(path, timeout=5.0)
        con.row_factory = sqlite3.Row
        cur = con.cursor()
        cur.execute(query)
        fila = cur.fetchone()
        if fila is None:
            return None, None
        return normalizar_medicion(dict(fila)), None
    except sqlite3.Error as e:
        return None, f"Error SQLite: {str(e)}"
    finally:
        if con:
            con.close()


# ==============================================================================
# CLIENTE HTTP WEBHOOK (OPCIONAL)
# ==============================================================================
def enviar_json_webhook(url, payload, timeout=10):
    """
    Envía el payload normalizado vía HTTP POST.
    Retorna (exito, http_status, response_text, error_str).
    """
    if not url:
        return False, None, None, "URL de webhook no configurada"

    try:
        data_bytes = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=data_bytes,
            headers={
                "Content-Type": "application/json",
                "User-Agent": "Apaso-Sender-API/1.0",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            status_code = resp.getcode()
            response_body = resp.read().decode("utf-8", errors="replace")
            return True, status_code, response_body[:200], None
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace") if hasattr(e, "read") else ""
        return False, e.code, body[:200], f"Error HTTP {e.code}: {e.reason}"
    except urllib.error.URLError as e:
        return False, None, None, f"Error de conexión: {e.reason}"
    except TimeoutError:
        return False, None, None, f"Timeout ({timeout}s) agotado al contactar {url}"
    except Exception as e:
        return False, None, None, f"Excepción general: {str(e)}"


# ==============================================================================
# DISPATCHER CENTRAL
# ==============================================================================
def ejecutar_ciclo_envio():
    """Ejecuta un ciclo de extracción y envío POST al webhook."""
    timestamp_inicio = ahora_utc()
    registro, err_db = obtener_ultima_medicion()

    if err_db:
        with metrics_lock:
            metrics["last_attempt_at"] = timestamp_inicio
            metrics["last_error"] = err_db
            metrics["total_errors"] += 1
        print(f"[{timestamp_inicio}] [ERROR BD] {err_db}")
        return {"status": "error", "error": err_db, "stage": "database"}

    if not registro:
        with metrics_lock:
            metrics["last_attempt_at"] = timestamp_inicio
            metrics["last_error"] = "Sin mediciones en la tabla"
        print(f"[{timestamp_inicio}] [WORKER] La tabla mediciones se encuentra vacía.")
        return {
            "status": "empty",
            "message": "No hay mediciones registradas en la base de datos",
        }

    if not TARGET_WEBHOOK_URL:
        return {"status": "skipped", "message": "TARGET_WEBHOOK_URL no configurada"}

    exito, http_code, body, err_http = enviar_json_webhook(TARGET_WEBHOOK_URL, registro)

    with metrics_lock:
        metrics["last_attempt_at"] = timestamp_inicio
        metrics["last_http_status"] = http_code
        metrics["last_record_id"] = registro.get("record_id")
        if exito:
            metrics["last_success_at"] = timestamp_inicio
            metrics["last_error"] = None
            metrics["total_dispatched"] += 1
            print(
                f"[{timestamp_inicio}] [ENVÍO EXITOSO] Record {registro.get('record_id')} -> HTTP {http_code}"
            )
        else:
            metrics["last_error"] = err_http
            metrics["total_errors"] += 1
            print(
                f"[{timestamp_inicio}] [FALLO ENVÍO] HTTP {http_code} | Detalle: {err_http}"
            )

    return {
        "status": "success" if exito else "failed",
        "record_id": registro.get("record_id"),
        "http_status": http_code,
        "error": err_http,
        "sent_at": timestamp_inicio,
    }


# ==============================================================================
# TAREA EN SEGUNDO PLANO (DAEMON THREAD)
# ==============================================================================
def worker_loop():
    """Bucle del worker si ENABLE_WORKER está activo."""
    with metrics_lock:
        metrics["worker_active"] = True

    print(
        f"[{ahora_utc()}] [WORKER] Iniciado. Enviando a {TARGET_WEBHOOK_URL} cada {INTERVAL_SECONDS}s."
    )

    while not stop_event.is_set():
        try:
            ejecutar_ciclo_envio()
        except Exception as e:
            print(f"[{ahora_utc()}] [WORKER EXCEPCIÓN] {e}")

        stop_event.wait(timeout=INTERVAL_SECONDS)

    with metrics_lock:
        metrics["worker_active"] = False


# ==============================================================================
# ENDPOINTS HTTP FLASK
# ==============================================================================
@app.route("/api/incendios", methods=["GET"])
@app.route("/api_incendios", methods=["GET"])
@app.route("/incendios", methods=["GET"])
def api_incendios():
    """
    Endpoint principal de extracción de datos normalizados.
    Es el endpoint al que consultará el nodo en 192.168.4.1 o cualquier cliente local/externo vía GET.
    """
    registro, err_db = obtener_ultima_medicion()
    if err_db:
        return jsonify({"error": err_db}), 500
    if not registro:
        return jsonify(
            {"error": "No hay mediciones registradas en la base de datos"}
        ), 404
    return jsonify(registro), 200


@app.route("/latest", methods=["GET"])
def get_latest():
    """Devuelve la última medición en formato normalizado."""
    return api_incendios()


@app.route("/health", methods=["GET"])
def health():
    """Verifica salud y conectividad a SQLite."""
    _, err_db = obtener_ultima_medicion()
    if err_db and "no encontrada" in err_db.lower():
        return jsonify(
            {"status": "degraded", "database": "not_found", "detail": err_db}
        ), 503
    if err_db:
        return jsonify(
            {"status": "degraded", "database": "error", "detail": err_db}
        ), 500
    return jsonify(
        {"status": "healthy", "database": "connected", "timestamp": ahora_utc()}
    ), 200


@app.route("/status", methods=["GET"])
def get_status():
    """Devuelve métricas de ejecución y configuración."""
    with metrics_lock:
        estado_copia = dict(metrics)
    estado_copia["current_time"] = ahora_utc()
    return jsonify(estado_copia), 200


@app.route("/send-now", methods=["POST"])
def send_now():
    """Fuerza un ciclo de envío inmediato al webhook."""
    resultado = ejecutar_ciclo_envio()
    codigo_http = 200 if resultado.get("status") == "success" else 502
    return jsonify(resultado), codigo_http


# ==============================================================================
# PUNTO DE ENTRADA PRINCIPAL
# ==============================================================================
def iniciar_worker_daemon():
    """Inicia el worker si está habilitado."""
    if ENABLE_WORKER and TARGET_WEBHOOK_URL:
        hilo = threading.Thread(
            target=worker_loop, daemon=True, name="WorkerSenderThread"
        )
        hilo.start()
        return hilo
    return None


if __name__ == "__main__":
    ips = obtener_ips_locales()

    print("\n======================================================================")
    print("APASO - API DE MONITOREO DE INCENDIOS FORESTALES")
    print("======================================================================")
    print(f"Base de datos   : {DB_PATH}")
    print(
        f" Worker periódico: {'ACTIVO (' + TARGET_WEBHOOK_URL + ' cada ' + str(INTERVAL_SECONDS) + 's)' if (ENABLE_WORKER and TARGET_WEBHOOK_URL) else 'DESACTIVADO (solo modo servidor GET)'}"
    )
    print("----------------------------------------------------------------------")

    if ips:
        print(
            "📡 ENDPOINT ACCESIBLE PARA EL NODO EN 192.168.4.1 (Y DISPOSITIVOS EXTERNOS):"
        )
        for ip in ips:
            print(f" http://{ip}:{PORT}/api/incendios")
    else:
        print("📡 ENDPOINT ACCESIBLE PARA EL NODO EN 192.168.4.1:")
        print(f"   👉 http://<TU_IP_LOCAL>:{PORT}/api/incendios")

    print("\n💻 ENDPOINTS LOCALES PARA PRUEBAS (En esta máquina):")
    print(f" http://localhost:{PORT}/api/incendios")
    print(f"http://10.160.8.56:{PORT}/api/incendios")
    print(f"http://10.160.8.56:{PORT}/status")
    print(f"http://10.160.8.56:{PORT}/health")
    print("======================================================================\n")

    iniciar_worker_daemon()
    app.run(host=HOST, port=PORT, debug=False)
