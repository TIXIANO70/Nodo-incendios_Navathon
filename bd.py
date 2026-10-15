import sqlite3
import datetime

con = sqlite3.connect(BDincendios)
cur = con.cursor()

mediciones = [
        ("")
]
query = "INSERT INTO mediciones (idMediciones, idNodo, timestamp, temperature, humidity, alert_level)
with con: 
    cur.executemany(query, mediciones)
