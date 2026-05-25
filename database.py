"""
database.py — persistência de métricas em SQLite.

Responsabilidade única: gravar e consultar snapshots históricos.
Usa WAL (Write-Ahead Logging) para suportar leituras concorrentes
sem bloquear o thread de broadcast durante escritas.
"""
import json
import logging
import sqlite3
import time
from pathlib import Path

log = logging.getLogger(__name__)

DB_PATH       = Path(__file__).parent / "metrics.db"
_RETENTION_MS = 24 * 3_600_000  # 24 h em milissegundos


def init_db() -> None:
    """Cria o schema e índices se ainda não existirem."""
    with sqlite3.connect(DB_PATH) as conn:
        # WAL: leituras não bloqueiam escritas (útil com threads simultâneas)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS metrics (
                id   INTEGER PRIMARY KEY AUTOINCREMENT,
                ts   INTEGER NOT NULL,
                data TEXT    NOT NULL
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_ts ON metrics(ts)")
    log.info("Banco de dados inicializado em %s", DB_PATH)


def save_metric(metrics: dict) -> None:
    """Persiste um snapshot e remove registros mais antigos que 24 h."""
    cutoff = int(time.time() * 1000) - _RETENTION_MS
    try:
        with sqlite3.connect(DB_PATH) as conn:
            conn.execute(
                "INSERT INTO metrics (ts, data) VALUES (?, ?)",
                (metrics["timestamp"], json.dumps(metrics, separators=(",", ":")))
            )
            conn.execute("DELETE FROM metrics WHERE ts < ?", (cutoff,))
    except sqlite3.Error:
        log.exception("Falha ao salvar métrica no banco")


def get_history(minutes: int = 5) -> list[dict]:
    """Retorna snapshots dos últimos `minutes` minutos, em ordem cronológica."""
    cutoff = int(time.time() * 1000) - minutes * 60_000
    try:
        with sqlite3.connect(DB_PATH) as conn:
            rows = conn.execute(
                "SELECT data FROM metrics WHERE ts > ? ORDER BY ts",
                (cutoff,)
            ).fetchall()
        return [json.loads(row[0]) for row in rows]
    except sqlite3.Error:
        log.exception("Falha ao consultar histórico")
        return []
