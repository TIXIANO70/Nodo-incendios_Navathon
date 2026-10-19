"""
Pruebas automatizadas para api_sender.py
Valida la extracción, normalización de esquema, endpoint GET /api/incendios y webhooks.
"""

import json
import os
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

# Auto-cargar .venv si se ejecuta con el python del sistema
_venv_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".venv")
_venv_python = os.path.join(_venv_path, "bin", "python3")
if os.path.exists(_venv_python) and sys.executable != _venv_python:
    if any(os.path.basename(__file__) in arg for arg in sys.argv):
        os.execv(_venv_python, [_venv_python] + sys.argv)

import api_sender


class DummyWebhookHandler(BaseHTTPRequestHandler):
    received_payloads = []

    def do_POST(self):
        content_length = int(self.headers.get("Content-Length", 0))
        post_data = self.rfile.read(content_length)
        parsed = json.loads(post_data.decode("utf-8"))
        DummyWebhookHandler.received_payloads.append(parsed)

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"status": "received"}')

    def log_message(self, format, *args):
        pass


class TestApiSender(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        DummyWebhookHandler.received_payloads.clear()
        cls.server = HTTPServer(("127.0.0.1", 9876), DummyWebhookHandler)
        cls.server_thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.server_thread.start()

        api_sender.TARGET_WEBHOOK_URL = "http://127.0.0.1:9876/webhook"
        api_sender.metrics["target_webhook_url"] = api_sender.TARGET_WEBHOOK_URL

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def test_01_obtener_ultima_medicion_normalizada(self):
        """Verifica que se extraiga y normalice el JSON según el esquema de incendios forestales."""
        registro, err = api_sender.obtener_ultima_medicion()
        self.assertIsNone(err)
        self.assertIsNotNone(registro)
        self.assertEqual(registro.get("schema_version"), "1.0.0")
        self.assertEqual(registro.get("record_type"), "reading")
        self.assertEqual(registro.get("node_id"), "fire_node_01")
        self.assertEqual(registro.get("group"), 1)
        self.assertEqual(registro.get("subsystem"), "Monitoreo de incendios forestales")
        
        # Validar sección data
        self.assertIn("data", registro)
        data = registro["data"]
        self.assertIn("temperature", data)
        self.assertIn("humidity", data)
        self.assertIn("wind_speed", data)
        
        # Validar sección metadata
        self.assertIn("metadata", registro)
        meta = registro["metadata"]
        self.assertIn("units", meta)
        self.assertEqual(meta["units"]["temperature"], "degC")
        self.assertEqual(meta["units"]["humidity"], "%")
        self.assertIn("quality", meta)
        self.assertEqual(meta["quality"]["temperature"], "valid")

    def test_02_endpoint_api_incendios(self):
        """Verifica que GET /api/incendios retorne el JSON normalizado listo para consumo local o remoto."""
        with api_sender.app.test_client() as client:
            resp = client.get("/api/incendios")
            self.assertEqual(resp.status_code, 200)
            data = resp.get_json()
            self.assertEqual(data.get("subsystem"), "Monitoreo de incendios forestales")
            self.assertIn("data", data)
            self.assertEqual(data["data"]["temperature"], 28.5)
            self.assertEqual(data["data"]["humidity"], 35.0)

    def test_03_endpoint_latest(self):
        """Verifica que GET /latest también responda con el mismo esquema normalizado."""
        with api_sender.app.test_client() as client:
            resp = client.get("/latest")
            self.assertEqual(resp.status_code, 200)
            data = resp.get_json()
            self.assertEqual(data.get("node_id"), "fire_node_01")

    def test_04_endpoint_health(self):
        """Verifica que /health retorne 200 y estado de la base de datos."""
        with api_sender.app.test_client() as client:
            resp = client.get("/health")
            self.assertEqual(resp.status_code, 200)
            data = resp.get_json()
            self.assertEqual(data.get("status"), "healthy")
            self.assertEqual(data.get("database"), "connected")

    def test_05_endpoint_status(self):
        """Verifica que /status reporte métricas."""
        with api_sender.app.test_client() as client:
            resp = client.get("/status")
            self.assertEqual(resp.status_code, 200)
            data = resp.get_json()
            self.assertIn("interval_seconds", data)

    def test_06_ejecutar_ciclo_envio(self):
        """Verifica el envío del JSON normalizado al webhook."""
        prev_count = len(DummyWebhookHandler.received_payloads)
        resultado = api_sender.ejecutar_ciclo_envio()

        self.assertEqual(resultado.get("status"), "success")
        self.assertEqual(resultado.get("http_status"), 200)
        self.assertEqual(len(DummyWebhookHandler.received_payloads), prev_count + 1)

        ultimo = DummyWebhookHandler.received_payloads[-1]
        self.assertEqual(ultimo.get("subsystem"), "Monitoreo de incendios forestales")
        self.assertEqual(ultimo["data"]["temperature"], 28.5)


if __name__ == "__main__":
    unittest.main()
