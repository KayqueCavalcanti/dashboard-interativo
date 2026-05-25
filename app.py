"""
app.py — servidor Flask + SocketIO.

Responsabilidade: expor a API WebSocket/HTTP e orquestrar o ciclo de vida.
A coleta de dados é delegada a telemetry; a persistência, a database.
"""
import os
import time
import logging
import threading

from flask import Flask, render_template, jsonify, request
from flask_socketio import SocketIO, emit

from telemetry import collect_metrics
from database import init_db, save_metric, get_history

# ── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

# ── App ───────────────────────────────────────────────────────────────────────
app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-insecure-change-in-prod")

socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    async_mode="threading",
    logger=False,
    engineio_logger=False,
)

EMIT_INTERVAL = 1.0   # segundos entre cada broadcast
SAVE_EVERY    = 5     # persiste no SQLite a cada N emissões (reduz I/O)


# ── Background thread ─────────────────────────────────────────────────────────

def _broadcast_loop() -> None:
    """Coleta métricas e faz broadcast para todos os clientes conectados."""
    counter = 0
    while True:
        try:
            metrics = collect_metrics()
            if counter % SAVE_EVERY == 0:
                save_metric(metrics)
            socketio.emit("metrics", metrics, namespace="/")
            counter += 1
        except Exception:
            log.exception("Erro no ciclo de broadcast — continuando")
        time.sleep(EMIT_INTERVAL)


# ── Rotas HTTP ────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/history")
def history():
    minutes = max(1, min(int(request.args.get("minutes", 5)), 60))
    return jsonify(get_history(minutes))


# ── Eventos SocketIO ──────────────────────────────────────────────────────────

@socketio.on("connect")
def on_connect():
    log.info("Cliente conectado: %s", request.sid)
    # emit() (sem namespace) envia apenas para o cliente que acabou de conectar,
    # ao contrário de socketio.emit() que transmitiria para todos.
    emit("metrics", collect_metrics())


@socketio.on("disconnect")
def on_disconnect():
    log.info("Cliente desconectado: %s", request.sid)


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    init_db()
    threading.Thread(target=_broadcast_loop, daemon=True).start()
    log.info("Servidor iniciado em http://0.0.0.0:5000")
    # allow_unsafe_werkzeug: necessário ao usar async_mode='threading' sem
    # um servidor WSGI externo. Não use em produção — substitua por gunicorn+gevent.
    socketio.run(app, host="0.0.0.0", port=5000, debug=False, allow_unsafe_werkzeug=True)
