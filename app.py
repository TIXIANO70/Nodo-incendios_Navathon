from flask import Flask, request, jsonify
import datetime

app = Flask(__name__)

# Segundos sin novedades para pasar a OFFLINE
TIMEOUT_SEGUNDOS = 30

ACTIVO = "ACTIVO"
OFFLINE = "OFFLINE"
ERROR = "ERROR"

registro = {
    "ultimo_dato": None,  # datetime del último dato válido
    "ultimo_error": None,  # datetime del último error
    "detalle_error": None,  # descripción del último error
}


def ahora():
    return datetime.datetime.now(datetime.timezone.utc)


def formato(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ") if dt else None


def reciente(dt):
    return dt is not None and (ahora() - dt).total_seconds() <= TIMEOUT_SEGUNDOS


def obtener_estado():
    """
    ERROR   -> el último evento reciente fue un error
    ACTIVO  -> llegaron datos válidos en los últimos TIMEOUT_SEGUNDOS
    OFFLINE -> no llegó nada en los últimos TIMEOUT_SEGUNDOS
    """
    ult_dato, ult_error = registro["ultimo_dato"], registro["ultimo_error"]

    if reciente(ult_error) and (ult_dato is None or ult_error > ult_dato):
        return ERROR
    if reciente(ult_dato):
        return ACTIVO
    return OFFLINE


def procesar(nombre):
    datos = request.get_json(silent=True)
    if datos is None:
        registro["ultimo_error"] = ahora()
        registro["detalle_error"] = f"{nombre}: JSON inválido o vacío"
        print(formato(registro["ultimo_error"]), "ERROR:", registro["detalle_error"])
        return "JSON inválido", 400

    registro["ultimo_dato"] = ahora()
    print(formato(registro["ultimo_dato"]), f"{nombre}:", datos)
    return "", 200


@app.route("/temperature", methods=["POST"])
def temperature():
    return procesar("Temperatura")


@app.route("/humidity", methods=["POST"])
def humidity():
    return procesar("Humedad")


@app.errorhandler(Exception)
def error_inesperado(e):
    registro["ultimo_error"] = ahora()
    registro["detalle_error"] = str(e)
    print(formato(registro["ultimo_error"]), "ERROR:", e)
    return "Error interno", 500


@app.route("/status", methods=["GET"])
def status():
    return jsonify(
        {
            "estado": obtener_estado(),
            "ultimo_dato": formato(registro["ultimo_dato"]),
            "ultimo_error": formato(registro["ultimo_error"]),
            "detalle_error": registro["detalle_error"],
        }
    )


if __name__ == "__main__":
    print("Servidor iniciado:", formato(ahora()))
    app.run(host="0.0.0.0", port=8080)
