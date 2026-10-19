import sqlite3
import datetime
import uuid
from flask import Flask, request, jsonify 

app = Flask(__name__)

#Humedad de la flora seca = floraHum (Puede que no la usemos o hagamos un claculo de sequia unicamente)
def calcularPeligro ():
    humRe = max(1.0, min(100.0, humidity)) # Humedad relativa
    if humRe < 15.0:
        floraHum = 0.25 * humRe - 0.05 * temperature + 1.5
    elif humRe < 50.0:
        floraHum = 0.18 * humRe - 0.04 * temperature + 3.0 
    else:
        floraHum = 0.22 * humRe - 0.02 * temperature + 5.0
    return floraHum

# tempF = (temperature * 1.8) + 32.0  # Conversión a Fahrenheit requerida por la fórmula    
def estado (): #Funcion que devuelve el estado de alerta segun las condiciones  
    smoke = 0 
    # hcfm = calcularPeligro(temperature, humidity)  # Variable que representa el nivel de humedad y peligro
    """
    if (temp >= 35.0 and humidity <= 15.0) or smoke <= 10.0:                           
            nivel = 5  # Extremo                                          
        elif (temp >= 31.0 and humidity <= 20.0) or (smoke<= 8.0) :                           
            nivel = 4  # Muy Alto / Crítico                               
        elif (temp >= 23.0 and humidity <= 25.0) or smoke <= 5.0:                                      
            nivel = 3  # Alto                                             
        elif (temp >= 20.0 and humidity <= 25.0) or smoke <= 2.0:         
            nivel = 2  # Moderado                                         
        else:                                                             
            nivel = 1  # Bajo   
    """
    t = mediciones_actuales["temperature"] or 0.0
    h = mediciones_actuales["humidity"] or 30.0
    s = mediciones_actuales["smoke_level"] or 0.0
    if (t >= 35.0 and h <= 15.0) or s >= 10.0:
        nivel = 5  # Extremo
    elif (t >= 31.0 and h <= 20.0) or s >= 8.0:
        nivel = 4  # Muy Alto / Crítico
    elif (t >= 23.0 and h <= 25.0) or s >= 5.0:
        nivel = 3  # Alto
    elif (t >= 20.0 and h <= 25.0) or s >= 2.0:
        nivel = 2  # Moderado
    else:
        nivel = 1  # Bajo
    return nivel  





def reloj():
    return datetime.datetime.now(datetime.timezone.utc)

def formato(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ") if dt else None

def extraer_float(request_obj):
    datos = request_obj.get_json(silent=True)
    if datos is None:
        # Si no vino JSON, intentamos leer el texto crudo del body (por si enviaron texto plano)
        datos = request_obj.get_data(as_text=True)

    # Si es un diccionario, buscamos el valor adentro
    if isinstance(datos, dict):
        # Toma el primer valor numérico que encuentre o claves típicas
        for clave in ("value", "valor", "temperature", "humidity", "wind_speed", "smoke_level"):
            if clave in datos:
                datos = datos[clave]
                break
        else:
            # Si tiene un solo elemento (ej: {"temp": "25"}), toma ese único valor
            if len(datos) == 1:
                datos = next(iter(datos.values()))

    # Intentamos convertir lo que haya quedado a float
    try:
        return float(str(datos).strip()), None
    except (ValueError, TypeError):
        return None, f"No se pudo convertir '{datos}' a número"


mediciones_actuales = {
    "temperature": None,
    "humidity": None,
    "wind_speed": None,
    "smoke_level": None,
}

def insercion ():
    #temperature = # Temperatura 
    #humidity =  # humedad
    #wind_level = # Viento por metros sobre segundo 
    #smoke = # humo
    record_id = str(uuid.uuid4()) 
    nivel = estado()
    
    ALERTS = ["", "alert1", "alert2", "alert3", "alert4", "alert"]
    alert = ALERTS[nivel]
    #dt = datetime.datetime.now(datetime.timezone.utc) # Objeto que permite usar datetime 
    now = formato(reloj()) # Variable de hora actual
    datos = (
                record_id,
                "fire_node_01",
                now,
                alert,
                mediciones_actuales["temperature"],
                mediciones_actuales["humidity"],
                mediciones_actuales["wind_speed"],
                mediciones_actuales["smoke_level"]
     ) #Lista que sera ingresada como datos 
    query = "INSERT INTO mediciones (record_id, node_id, timestamp, alert_level, temperature, humidity, wind_speed, smoke_level) VALUES (?, ?, ?, ?, ?, ?, ?, ?)" #Formato del insert 

    with sqlite3.connect("DBincendios.db") as con: 
        cur = con.cursor() # Cursor hacia la bd 
        cur.execute (query, datos)
    return alert

def procesar(nombre_sensor, campo_bd):
    valor, error = extraer_float(request)
    if error:
        print(f"[{formato(reloj())}] ERROR en {nombre_sensor}: {error}")
        return jsonify({"error": error}), 400
    # Actualizamos el valor recibido en memoria
    mediciones_actuales[campo_bd] = valor
    # Evaluamos la alerta
    #nivel = estado()
    #alerta = ALERTS[nivel]
    # Guardamos en la base de datos
    try:
        alert = insercion()
        print(f"[{formato(reloj())}] {nombre_sensor}: {valor} -> Guardado en BD con alerta '{alert}'")
        return jsonify({"status": "ok", "sensor": nombre_sensor, "valor": valor, "alerta": alert}), 200
    except Exception as e:
        print(f"[{formato(reloj())}] Error al escribir en BD: {e}")
        return jsonify({"error": "Error interno al guardar en BD"}), 500
           
#Endpoints
@app.route("/temperature", methods=["POST"])
def temperature():
    return procesar("Temperatura", "temperature")


@app.route("/humidity", methods=["POST"])
def humidity():
    return procesar("Humedad", "humidity")

@app.route("/wind_level", methods=["POST"])
def wind_level():
    return procesar("Nivel de viento", "wind_speed")

@app.route("/smoke", methods=["POST"])
def smoke():
    return procesar("Humo", "smoke_level")

if __name__ == "__main__":
    print("Servidor iniciado:", formato(reloj()))
    app.run(host="0.0.0.0", port=8080)