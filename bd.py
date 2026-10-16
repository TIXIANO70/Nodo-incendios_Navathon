import sqlite3
import datetime
from flask import Flask, request, jsonify 
#Humedad de la flora seca = floraHum
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
    return nivel  

app = Flask(__name__)
con = sqlite3.connect(DBincendios) #Conexión la bd
cur = con.cursor() # Cursor hacia la bd 
temperature = #Temperatura 
humidity =  #humedad
wind = # Viento por metros sobre segundo 
nivel = estado()
ALERTAS = ["", "alert1", "alert2", "alert3", "alert4", "alert"]
dt = datetime.datetime.now(datetime.timezone.utc) # Objeto que permite usar datetime 
now = dt.strftime("%Y-%m-%dT%H:%M:%SZ") # Variable de hora actual
datos = [
        ("fire_node_01", now, alerta, temperature, humidity, wind, smoke)
] #Lista que sera ingresada como datos 
query = "INSERT INTO mediciones (node_id, timestamp, alert_level, temperature, humidity, wind_speed, smoke_level) #Formato del insert 
with con: 
    cur.executemany(query, datos)
