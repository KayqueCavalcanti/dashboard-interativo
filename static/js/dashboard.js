/**
 * dashboard.js — v2
 * Novidades: alertas por limiar, banner offline, reconexão com backoff,
 * pré-carga de histórico SQLite, CPU por núcleo, I/O de disco, tabela de processos.
 */

// ── Configuração ─────────────────────────────────────────────
const CFG = Object.freeze({
  MAX_POINTS: 60,
  CHART_TENSION: 0.35,
  THRESHOLDS: { cpu: 85, mem: 85, disk: 90 },
  OFFLINE_BANNER_DELAY_MS: 10_000,
  COLORS: {
    blue:   "#3b82f6",
    green:  "#10b981",
    amber:  "#f59e0b",
    red:    "#ef4444",
    purple: "#8b5cf6",
    teal:   "#06b6d4",
    muted:  "rgba(255,255,255,0.07)",
  },
});

// ── Estado das séries temporais ───────────────────────────────
const series = {
  labels:    [],
  cpu:       [],
  netSend:   [],
  netRecv:   [],
  diskRead:  [],
  diskWrite: [],
};

// ── Helpers DOM ───────────────────────────────────────────────
const el = (id)  => document.getElementById(id);

function pushRolling(arr, v) {
  arr.push(v);
  if (arr.length > CFG.MAX_POINTS) arr.shift();
}

function colorFor(pct, threshold = CFG.THRESHOLDS.cpu) {
  if (pct >= threshold) return CFG.COLORS.red;
  if (pct >= 70)        return CFG.COLORS.amber;
  return CFG.COLORS.green;
}

/** Converte #rrggbb → rgba(r,g,b,alpha). Necessário porque Chart.js não
 *  infere transparência a partir de cores hex — o fill ficaria sólido. */
function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function tsLabel(ms) {
  return new Date(ms).toLocaleTimeString("pt-BR", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

// ── Inicialização dos gráficos ────────────────────────────────
let cpuChart, memChart, netChart, diskIoChart;

const _base = {
  responsive: true,
  maintainAspectRatio: false,
  animation: { duration: 200 },
  plugins: { legend: { display: false } },
};

function _lineDataset(data, color, alpha = 0.12) {
  return {
    data,
    borderColor: color,
    backgroundColor: hexToRgba(color, alpha),
    borderWidth: 2,
    pointRadius: 0,
    fill: true,
    tension: CFG.CHART_TENSION,
  };
}

function initCpuChart() {
  cpuChart = new Chart(el("cpu-chart").getContext("2d"), {
    type: "line",
    data: {
      labels: series.labels,
      datasets: [_lineDataset(series.cpu, CFG.COLORS.blue)],
    },
    options: {
      ..._base,
      scales: {
        x: { display: false },
        y: {
          min: 0, max: 100,
          ticks: { color: "#6b7280", callback: v => v + "%" },
          grid:  { color: CFG.COLORS.muted },
        },
      },
    },
  });
}

function initMemChart() {
  memChart = new Chart(el("mem-chart").getContext("2d"), {
    type: "doughnut",
    data: {
      labels: ["Usado", "Livre"],
      datasets: [{
        data: [0, 100],
        backgroundColor: [CFG.COLORS.purple, "rgba(255,255,255,0.06)"],
        borderWidth: 0,
        hoverOffset: 4,
      }],
    },
    options: {
      ..._base,
      cutout: "72%",
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` ${ctx.parsed.toFixed(1)}%` } },
      },
    },
  });
}

function initNetChart() {
  netChart = new Chart(el("net-chart").getContext("2d"), {
    type: "line",
    data: {
      labels: series.labels,
      datasets: [
        { ..._lineDataset(series.netSend, CFG.COLORS.green, 0.10), label: "Envio" },
        { ..._lineDataset(series.netRecv, CFG.COLORS.amber, 0.10), label: "Recepção" },
      ],
    },
    options: {
      ..._base,
      scales: {
        x: { display: false },
        y: {
          min: 0,
          ticks: { color: "#6b7280", callback: v => v + " KB/s" },
          grid:  { color: CFG.COLORS.muted },
        },
      },
      plugins: {
        legend: { display: true, labels: { color: "#9ca3af", boxWidth: 12, font: { size: 11 } } },
      },
    },
  });
}

function initDiskIoChart() {
  diskIoChart = new Chart(el("disk-io-chart").getContext("2d"), {
    type: "line",
    data: {
      labels: series.labels,
      datasets: [
        { ..._lineDataset(series.diskRead,  CFG.COLORS.teal,   0.10), label: "Leitura" },
        { ..._lineDataset(series.diskWrite, CFG.COLORS.purple, 0.10), label: "Escrita" },
      ],
    },
    options: {
      ..._base,
      scales: {
        x: { display: false },
        y: {
          min: 0,
          ticks: { color: "#6b7280", callback: v => v + " KB/s" },
          grid:  { color: CFG.COLORS.muted },
        },
      },
      plugins: {
        legend: { display: true, labels: { color: "#9ca3af", boxWidth: 12, font: { size: 11 } } },
      },
    },
  });
}

function initCharts() {
  initCpuChart();
  initMemChart();
  initNetChart();
  initDiskIoChart();
}

// ── Atualização dos KPIs ──────────────────────────────────────
function updateKPIs(data) {
  const cpuPct  = data.cpu.percent;
  const memPct  = data.memory.percent;
  const diskPct = data.disk.percent;

  el("kpi-cpu-value").textContent = cpuPct.toFixed(1)  + "%";
  el("kpi-mem-value").textContent = memPct.toFixed(1)  + "%";
  el("kpi-mem-sub").textContent   = `${data.memory.used_gb} / ${data.memory.total_gb} GB`;
  el("kpi-disk-value").textContent = diskPct.toFixed(1) + "%";
  el("kpi-disk-sub").textContent  = `${data.disk.used_gb} / ${data.disk.total_gb} GB`;
  el("kpi-uptime-value").textContent = data.uptime;

  _setBar("kpi-cpu-bar",  cpuPct,  CFG.THRESHOLDS.cpu);
  _setBar("kpi-mem-bar",  memPct,  CFG.THRESHOLDS.mem);
  _setBar("kpi-disk-bar", diskPct, CFG.THRESHOLDS.disk);
}

function _setBar(id, pct, threshold) {
  const bar = el(id);
  if (!bar) return;
  bar.style.width      = pct + "%";
  bar.style.background = colorFor(pct, threshold);
}

// ── Atualização dos gráficos ──────────────────────────────────
function updateCharts(data) {
  cpuChart.data.datasets[0].borderColor = colorFor(data.cpu.percent);
  cpuChart.update("none");

  const memPct = data.memory.percent;
  memChart.data.datasets[0].data            = [memPct, 100 - memPct];
  memChart.data.datasets[0].backgroundColor[0] = colorFor(memPct, CFG.THRESHOLDS.mem);
  el("mem-center-label").textContent = memPct.toFixed(0) + "%";
  memChart.update("none");

  netChart.update("none");
  diskIoChart.update("none");
}

// ── CPU por núcleo ────────────────────────────────────────────
function updateCoreGrid(cores) {
  const container = el("core-grid");
  if (!container || !cores?.length) return;

  if (container.children.length !== cores.length) {
    container.innerHTML = cores.map((_, i) => `
      <div class="core-item">
        <span class="core-label">C${i}</span>
        <div class="core-track"><div class="core-fill" id="core-${i}"></div></div>
        <span class="core-pct" id="core-pct-${i}">0%</span>
      </div>`).join("");
  }

  cores.forEach((pct, i) => {
    const fill = el(`core-${i}`);
    const pctEl = el(`core-pct-${i}`);
    if (fill)  { fill.style.width = pct + "%"; fill.style.background = colorFor(pct); }
    if (pctEl) pctEl.textContent = pct.toFixed(0) + "%";
  });
}

// ── Tabela de processos ───────────────────────────────────────
function updateProcessTable(processes) {
  const tbody = el("proc-tbody");
  if (!tbody || !processes?.length) return;
  tbody.innerHTML = processes.map(p => `
    <tr>
      <td class="proc-name" title="${p.name}">${p.name}</td>
      <td class="proc-cpu-cell">
        <div class="proc-bar-wrap">
          <div class="proc-bar-fill" style="width:${Math.min(p.cpu, 100)}%;background:${colorFor(p.cpu)}"></div>
        </div>
        <span class="proc-val">${p.cpu}%</span>
      </td>
      <td class="proc-mem">${p.mem.toFixed(1)}%</td>
    </tr>`).join("");
}

// ── Sistema de alertas ────────────────────────────────────────
const _alerts = new Map();

// Tabela de regras: adicionar novos alertas aqui sem tocar no checkAlerts
const _ALERT_RULES = [
  { key: "cpu",  getValue: d => d.cpu.percent,    threshold: CFG.THRESHOLDS.cpu,  label: "CPU"   },
  { key: "mem",  getValue: d => d.memory.percent, threshold: CFG.THRESHOLDS.mem,  label: "RAM"   },
  { key: "disk", getValue: d => d.disk.percent,   threshold: CFG.THRESHOLDS.disk, label: "Disco" },
];

function checkAlerts(data) {
  _ALERT_RULES.forEach(({ key, getValue, threshold, label }) => {
    const pct = getValue(data);
    _applyAlert(key, pct >= threshold, `${label} ${pct.toFixed(0)}%`);
  });
}

function _applyAlert(key, condition, msg) {
  el(`card-${key}`)?.classList.toggle("card-alert", condition);
  condition ? _alerts.set(key, msg) : _alerts.delete(key);
  _renderAlertBar();
}

function _renderAlertBar() {
  const bar = el("alert-bar");
  if (!bar) return;
  if (_alerts.size === 0) { bar.hidden = true; return; }
  bar.hidden = false;
  bar.innerHTML = [..._alerts.values()]
    .map(m => `<span class="alert-chip">⚠ ${m}</span>`)
    .join("");
}

// ── Banner de conexão perdida ─────────────────────────────────
let _offlineTimer = null;

function setConnectionStatus(connected) {
  el("status-dot").className     = `status-dot ${connected ? "connected" : "disconnected"}`;
  el("status-label").textContent = connected ? "Conectado" : "Reconectando…";

  if (connected) {
    clearTimeout(_offlineTimer);
    el("offline-banner").hidden = true;
  } else {
    _offlineTimer = setTimeout(
      () => { el("offline-banner").hidden = false; },
      CFG.OFFLINE_BANNER_DELAY_MS
    );
  }
}

// ── Pré-carga de histórico SQLite ─────────────────────────────
async function loadHistory() {
  try {
    const res = await fetch("/api/history?minutes=5");
    if (!res.ok) return;
    const snapshots = await res.json();
    if (!snapshots.length) return;

    snapshots.forEach(snap => {
      pushRolling(series.labels,    tsLabel(snap.timestamp));
      pushRolling(series.cpu,       snap.cpu.percent);
      pushRolling(series.netSend,   snap.network.send_kbps);
      pushRolling(series.netRecv,   snap.network.recv_kbps);
      pushRolling(series.diskRead,  snap.disk_io?.read_kbps  ?? 0);
      pushRolling(series.diskWrite, snap.disk_io?.write_kbps ?? 0);
    });

    cpuChart.update("none");
    netChart.update("none");
    diskIoChart.update("none");
    console.log(`[history] ${snapshots.length} snapshots carregados`);
  } catch (e) {
    console.warn("[history] falha ao carregar:", e);
  }
}

// ── Handler principal ─────────────────────────────────────────
function onMetrics(data) {
  pushRolling(series.labels,    tsLabel(data.timestamp));
  pushRolling(series.cpu,       data.cpu.percent);
  pushRolling(series.netSend,   data.network.send_kbps);
  pushRolling(series.netRecv,   data.network.recv_kbps);
  pushRolling(series.diskRead,  data.disk_io?.read_kbps  ?? 0);
  pushRolling(series.diskWrite, data.disk_io?.write_kbps ?? 0);

  updateKPIs(data);
  updateCharts(data);
  updateCoreGrid(data.cpu.cores);
  updateProcessTable(data.processes);
  checkAlerts(data);
}

// ── WebSocket ─────────────────────────────────────────────────
function initSocket() {
  const socket = io({
    transports: ["websocket"],
    reconnectionDelay:    1_000,
    reconnectionDelayMax: 30_000,
    reconnectionAttempts: Infinity,
  });
  socket.on("connect",    () => setConnectionStatus(true));
  socket.on("disconnect", () => setConnectionStatus(false));
  socket.on("metrics",    onMetrics);
}

// ── Bootstrap ─────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  initCharts();
  await loadHistory();
  initSocket();
});
