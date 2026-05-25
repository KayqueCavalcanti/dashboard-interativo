"""
telemetry.py — coleta de métricas do sistema.

Responsabilidade única: ler hardware e retornar snapshots serializáveis.
Encapsulado em MetricsCollector para thread-safety dos contadores incrementais,
que são lidos concorrentemente pelo loop de broadcast e pelo handler on_connect.
"""
import os
import time
import threading
import psutil

_DISK_PATH      = "C:\\" if os.name == "nt" else "/"
_PROCESS_LIMIT  = 6


class MetricsCollector:
    """Coleta métricas do sistema de forma thread-safe.

    Os contadores de rede e disco são incrementais: precisam do valor
    da leitura anterior para calcular a taxa (delta/dt). O Lock garante
    que duas chamadas simultâneas não corrompam esses contadores.
    """

    def __init__(self) -> None:
        self._lock         = threading.Lock()
        self._prev_net     = None
        self._prev_net_t   = 0.0
        self._prev_disk    = None
        self._prev_disk_t  = 0.0
        # Warm-up: psutil precisa de uma leitura anterior para calcular %.
        # Descartamos esses primeiros valores aqui para não poluir o primeiro snapshot.
        psutil.cpu_percent(interval=None)
        psutil.cpu_percent(percpu=True, interval=None)

    def collect(self) -> dict:
        """Retorna um snapshot completo e serializável das métricas."""
        with self._lock:
            return self._build_snapshot()

    # ── Internos ─────────────────────────────────────────────────────────

    def _build_snapshot(self) -> dict:
        now        = time.time()
        mem        = psutil.virtual_memory()
        disk       = psutil.disk_usage(_DISK_PATH)
        cpu_cores  = psutil.cpu_percent(percpu=True, interval=None)

        return {
            "timestamp": int(now * 1000),
            "cpu": {
                "percent": round(sum(cpu_cores) / len(cpu_cores), 1),
                "cores":   [round(c, 1) for c in cpu_cores],
            },
            "memory": {
                "percent":  mem.percent,
                "used_gb":  round(mem.used  / 1024 ** 3, 2),
                "total_gb": round(mem.total / 1024 ** 3, 2),
            },
            "disk": {
                "percent":  disk.percent,
                "used_gb":  round(disk.used  / 1024 ** 3, 1),
                "total_gb": round(disk.total / 1024 ** 3, 1),
            },
            "network":   self._net_rates(now),
            "disk_io":   self._disk_io_rates(now),
            "processes": _top_processes(),
            "uptime":    _format_uptime(int(now - psutil.boot_time())),
        }

    def _net_rates(self, now: float) -> dict:
        current = psutil.net_io_counters()
        send_kbps = recv_kbps = 0.0
        if self._prev_net is not None:
            dt = now - self._prev_net_t
            if dt > 0:
                send_kbps = (current.bytes_sent - self._prev_net.bytes_sent) / dt / 1024
                recv_kbps = (current.bytes_recv - self._prev_net.bytes_recv) / dt / 1024
        self._prev_net  = current
        self._prev_net_t = now
        return {
            "send_kbps": round(max(0.0, send_kbps), 2),
            "recv_kbps": round(max(0.0, recv_kbps), 2),
        }

    def _disk_io_rates(self, now: float) -> dict:
        try:
            current = psutil.disk_io_counters()
        except Exception:
            current = None

        read_kbps = write_kbps = 0.0
        if current is not None and self._prev_disk is not None:
            dt = now - self._prev_disk_t
            if dt > 0:
                read_kbps  = (current.read_bytes  - self._prev_disk.read_bytes)  / dt / 1024
                write_kbps = (current.write_bytes - self._prev_disk.write_bytes) / dt / 1024

        if current is not None:
            self._prev_disk  = current
            self._prev_disk_t = now

        return {
            "read_kbps":  round(max(0.0, read_kbps), 2),
            "write_kbps": round(max(0.0, write_kbps), 2),
        }


# ── Funções puras (sem estado) ────────────────────────────────────────────

def _top_processes(limit: int = _PROCESS_LIMIT) -> list[dict]:
    """Retorna os `limit` processos com maior uso de CPU no momento."""
    procs: list[dict] = []
    for proc in psutil.process_iter(["pid", "name", "cpu_percent", "memory_percent"]):
        try:
            info = proc.info
            procs.append({
                "pid":  info["pid"],
                "name": (info["name"] or "?")[:28],
                "cpu":  round(info["cpu_percent"] or 0.0, 1),
                "mem":  round(info["memory_percent"] or 0.0, 1),
            })
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass
    return sorted(procs, key=lambda p: p["cpu"], reverse=True)[:limit]


def _format_uptime(seconds: int) -> str:
    h, rem = divmod(seconds, 3600)
    m, s   = divmod(rem, 60)
    return f"{h:02d}:{m:02d}:{s:02d}"


# Instância singleton — importada pelos módulos que precisam de métricas
_collector    = MetricsCollector()
collect_metrics = _collector.collect
