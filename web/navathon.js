/* ==============================================================================
 *  APASO - Monitoreo de Incendios Forestales (Navathon III)
 *  Frontend conectado a la API Python (api_sender.py / bd.py)
 * ------------------------------------------------------------------------------
 *  - Hace GET a http://<API_BASE_URL>:8081/api/incendios cada POLL_INTERVAL_MS
 *  - Actualiza tarjetas (Temperatura, Humedad, Viento, Humo)
 *  - Actualiza el panel de alerta segun el campo "alert_level" del JSON
 *  - Mantiene un buffer circular para el gráfico combinado en vivo
 *  - Maneja desconexión / errores mostrando un estado visual "DEGRADADO"
 * ============================================================================== */

// ==============================================================================
// CONFIGURACIÓN  <--  AJUSTAR AQUÍ SEGÚN EL ENTORNO
// ==============================================================================
// Por defecto apunta al servidor local. Si la API corre en otra máquina de la
// red (por ejemplo la Raspberry Pi que hace de AP en 192.168.4.1), cambiá esto:
//   const API_BASE_URL = 'http://192.168.4.1:8081';
//   const API_BASE_URL = 'http://192.168.1.50:8081';
const API_BASE_URL = 'http://localhost:8081';
const API_ENDPOINT = '/api/incendios';
const POLL_INTERVAL_MS = 5000;        // Consulta cada 5 segundos
const MAX_HISTORY_POINTS = 20;        // Puntos máximos en el gráfico combinado

// ==============================================================================
// ESTADO EN MEMORIA
// ==============================================================================
let miniTemp = null;
let miniHum = null;
let miniWind = null;
let miniSmoke = null;
let liveCombined = null;

let ultimoRecordId = null;
let ultimoFetchOk = false;
let ultimoFetchTs = null;

const historial = {
    labels: [],
    temperatures: [],
    humidities: [],
    windSpeeds: [],
    smokeLevels: [],
};

// ==============================================================================
// MAPEO DE NIVELES DE ALERTA
// ------------------------------------------------------------------------------
// En bd.py:  ALERTS = ["", "alert1", "alert2", "alert3", "alert4", "alert"]
// Por lo tanto el campo alert_level puede venir como:
//   "normal" (cuando está vacío) / "alert1" / "alert2" / "alert3" / "alert4" / "alert"
// ==============================================================================
const ALERT_CONFIG = {
    'normal':  { label: 'NORMAL',   color: '#22c55e', title: 'Estado del Sistema: Normal',     desc: 'Parámetros dentro de rangos seguros. Sin riesgo inmediato.' },
    'alert1':  { label: 'BAJO',     color: '#22c55e', title: 'Estado del Sistema: Bajo',        desc: 'Condiciones estables. Monitoreo continuo.' },
    'alert2':  { label: 'MODERADO', color: '#eab308', title: 'Estado del Sistema: Moderado',   desc: 'Atención: parámetros mostrando valores elevados.' },
    'alert3':  { label: 'ALTO',     color: '#f97316', title: 'Estado del Sistema: Alto',       desc: 'Riesgo significativo. Monitoreo continuo recomendado.' },
    'alert4':  { label: 'CRÍTICO',  color: '#ef4444', title: 'Estado del Sistema: Crítico',     desc: 'Condiciones críticas. Acción preventiva necesaria.' },
    'alert':   { label: 'EXTREMO',  color: '#ef4444', title: 'Estado del Sistema: Extremo',     desc: '¡Peligro inminente! Condiciones críticas combinadas de temperatura, humedad, viento y humo.' },
};

function obtenerAlertaConfig(alertLevel) {
    if (!alertLevel) return ALERT_CONFIG['normal'];
    return ALERT_CONFIG[String(alertLevel).toLowerCase()] || ALERT_CONFIG['normal'];
}

// ==============================================================================
// LLAMADA A LA API PYTHON
// ==============================================================================
async function fetchMedicion() {
    const url = `${API_BASE_URL}${API_ENDPOINT}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000); // Timeout 4s

    try {
        const resp = await fetch(url, {
            method: 'GET',
            headers: { 'Accept': 'application/json' },
            cache: 'no-cache',
            mode: 'cors',
            signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!resp.ok) {
            throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
        }
        const data = await resp.json();
        ultimoFetchOk = true;
        ultimoFetchTs = new Date();
        return { ok: true, data };
    } catch (err) {
        clearTimeout(timeout);
        ultimoFetchOk = false;
        console.error('[API] Error al obtener medición:', err.message);
        return { ok: false, error: err.message };
    }
}

// ==============================================================================
// ACTUALIZACIÓN DE TARJETAS DE MÉTRICAS
// ==============================================================================
function actualizarTarjetas(data) {
    const temp  = data?.data?.temperature ?? null;
    const hum   = data?.data?.humidity    ?? null;
    const wind  = data?.data?.wind_speed  ?? null;
    const smoke = data?.data?.smoke_level ?? null;

    if (temp !== null) {
        document.getElementById('tempValue').innerText = `${Number(temp).toFixed(1)} °C`;
    }
    if (hum !== null) {
        document.getElementById('humValue').innerText = `${Math.round(hum)} %`;
    }
    if (wind !== null) {
        document.getElementById('windValue').innerText = `${Number(wind).toFixed(1)} km/h`;
    }
    const smokeEl = document.getElementById('smokeValue');
    if (smokeEl && smoke !== null) {
        smokeEl.innerText = `${Number(smoke).toFixed(1)} ppm`;
    } else if (smokeEl) {
        smokeEl.innerText = '— ppm';
    }
}

// ==============================================================================
// ACTUALIZACIÓN DEL PANEL DE ALERTA
// ==============================================================================
function actualizarAlerta(alertLevel) {
    const cfg = obtenerAlertaConfig(alertLevel);

    const alertCard  = document.getElementById('alertCard');
    const alertBadge = document.getElementById('alertBadge');
    const alertTitle = document.getElementById('alertTitle');
    const alertDesc  = document.getElementById('alertDesc');

    if (!alertCard) return;

    alertCard.style.borderLeftColor = cfg.color;
    alertBadge.innerText = cfg.label;
    alertBadge.style.color = cfg.color;
    // 33 ≈ 20% opacidad en hex
    alertBadge.style.backgroundColor = `${cfg.color}33`;
    alertBadge.style.borderColor = cfg.color;
    alertTitle.innerText = cfg.title;
    alertDesc.innerText = cfg.desc;
}

// ==============================================================================
// ACTUALIZACIÓN DEL ESTADO DE CONEXIÓN (header)
// ==============================================================================
function actualizarEstadoConexion() {
    const statusDot  = document.querySelector('.status-dot');
    const statusText = document.getElementById('nodeStatusText');
    if (!statusDot || !statusText) return;

    if (ultimoFetchOk) {
        statusDot.style.background = '#22c55e';
        statusDot.style.boxShadow  = '0 0 8px #22c55e';
        const hora = ultimoFetchTs
            ? ultimoFetchTs.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
            : '--:--:--';
        statusText.innerText = `Nodo: fire_node_01 (Activo) · Última lectura: ${hora}`;
    } else {
        statusDot.style.background = '#ef4444';
        statusDot.style.boxShadow  = '0 0 8px #ef4444';
        statusText.innerText = `Nodo: fire_node_01 (Sin conexión a ${API_BASE_URL})`;
    }
}

// ==============================================================================
// GESTIÓN DEL HISTORIAL ROLLING (buffer circular)
// ==============================================================================
function agregarAlHistorial(data) {
    const recordId = data?.record_id;
    // Si la API no trajo un record nuevo, no agregamos punto (evita duplicados)
    if (recordId && recordId === ultimoRecordId) return false;
    ultimoRecordId = recordId;

    let tsLabel;
    if (data?.timestamp) {
        const dt = new Date(data.timestamp);
        if (!isNaN(dt.getTime())) {
            tsLabel = dt.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        }
    }
    if (!tsLabel) tsLabel = new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    historial.labels.push(tsLabel);
    historial.temperatures.push(data?.data?.temperature ?? null);
    historial.humidities.push(data?.data?.humidity ?? null);
    historial.windSpeeds.push(data?.data?.wind_speed ?? null);
    historial.smokeLevels.push(data?.data?.smoke_level ?? null);

    if (historial.labels.length > MAX_HISTORY_POINTS) {
        historial.labels.shift();
        historial.temperatures.shift();
        historial.humidities.shift();
        historial.windSpeeds.shift();
        historial.smokeLevels.shift();
    }
    return true;
}

// ==============================================================================
// CONFIGURACIÓN DE CHART.JS
// ==============================================================================
function opcionesMini(color) {
    return {
        responsive: true,
        maintainAspectRatio: false,
        scales: { x: { display: false }, y: { display: false } },
        plugins: { legend: { display: false } },
        elements: { point: { radius: 0 } },
    };
}

function opcionesGenerales() {
    return {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
            x: { grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#94a3b8', maxRotation: 0, autoSkip: true } },
            y: { grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#94a3b8' } },
        },
        plugins: {
            legend: { labels: { color: '#f8fafc' } },
            tooltip: {
                backgroundColor: 'rgba(15, 23, 42, 0.95)',
                titleColor: '#f8fafc',
                bodyColor: '#94a3b8',
                borderColor: 'rgba(255, 255, 255, 0.1)',
                borderWidth: 1,
            },
        },
    };
}

// ==============================================================================
// INICIALIZACIÓN DE GRÁFICOS (una sola vez)
// ==============================================================================
function inicializarGraficosVacios() {
    if (miniTemp) miniTemp.destroy();
    miniTemp = new Chart(document.getElementById('miniTempChart').getContext('2d'), {
        type: 'line',
        data: { labels: [...historial.labels], datasets: [{ data: [...historial.temperatures], borderColor: '#f97316', borderWidth: 2, tension: 0.3, pointRadius: 0, fill: false }] },
        options: opcionesMini('#f97316'),
    });

    if (miniHum) miniHum.destroy();
    miniHum = new Chart(document.getElementById('miniHumChart').getContext('2d'), {
        type: 'line',
        data: { labels: [...historial.labels], datasets: [{ data: [...historial.humidities], borderColor: '#3b82f6', borderWidth: 2, tension: 0.3, pointRadius: 0, fill: false }] },
        options: opcionesMini('#3b82f6'),
    });

    if (miniWind) miniWind.destroy();
    miniWind = new Chart(document.getElementById('miniWindChart').getContext('2d'), {
        type: 'line',
        data: { labels: [...historial.labels], datasets: [{ data: [...historial.windSpeeds], borderColor: '#a855f7', borderWidth: 2, tension: 0.3, pointRadius: 0, fill: false }] },
        options: opcionesMini('#a855f7'),
    });

    if (miniSmoke) miniSmoke.destroy();
    const smokeCanvas = document.getElementById('miniSmokeChart');
    if (smokeCanvas) {
        miniSmoke = new Chart(smokeCanvas.getContext('2d'), {
            type: 'line',
            data: { labels: [...historial.labels], datasets: [{ data: [...historial.smokeLevels], borderColor: '#9ca3af', borderWidth: 2, tension: 0.3, pointRadius: 0, fill: false }] },
            options: opcionesMini('#9ca3af'),
        });
    }

    if (liveCombined) liveCombined.destroy();
    liveCombined = new Chart(document.getElementById('liveCombinedChart').getContext('2d'), {
        type: 'line',
        data: {
            labels: [...historial.labels],
            datasets: [
                { label: 'Temperatura (°C)', data: [...historial.temperatures], borderColor: '#f97316', borderWidth: 2, tension: 0.3, pointRadius: 2, fill: false },
                { label: 'Humedad (%)',     data: [...historial.humidities],   borderColor: '#3b82f6', borderWidth: 2, tension: 0.3, pointRadius: 2, fill: false },
                { label: 'Viento (km/h)',   data: [...historial.windSpeeds],   borderColor: '#a855f7', borderWidth: 2, tension: 0.3, pointRadius: 2, fill: false },
                { label: 'Humo (ppm)',       data: [...historial.smokeLevels],  borderColor: '#9ca3af', borderWidth: 2, tension: 0.3, pointRadius: 2, fill: false, hidden: false },
            ],
        },
        options: opcionesGenerales(),
    });
}

// ==============================================================================
// REFRESCAR GRÁFICOS CON EL HISTORIAL ACTUAL
// ==============================================================================
function refrescarGraficos() {
    if (miniTemp) {
        miniTemp.data.labels = [...historial.labels];
        miniTemp.data.datasets[0].data = [...historial.temperatures];
        miniTemp.update('none');
    }
    if (miniHum) {
        miniHum.data.labels = [...historial.labels];
        miniHum.data.datasets[0].data = [...historial.humidities];
        miniHum.update('none');
    }
    if (miniWind) {
        miniWind.data.labels = [...historial.labels];
        miniWind.data.datasets[0].data = [...historial.windSpeeds];
        miniWind.update('none');
    }
    if (miniSmoke) {
        miniSmoke.data.labels = [...historial.labels];
        miniSmoke.data.datasets[0].data = [...historial.smokeLevels];
        miniSmoke.update('none');
    }
    if (liveCombined) {
        liveCombined.data.labels = [...historial.labels];
        liveCombined.data.datasets[0].data = [...historial.temperatures];
        liveCombined.data.datasets[1].data = [...historial.humidities];
        liveCombined.data.datasets[2].data = [...historial.windSpeeds];
        liveCombined.data.datasets[3].data = [...historial.smokeLevels];
        liveCombined.update('none');
    }
}

// ==============================================================================
// MANEJO DE ERRORES: PANEL DEGRADADO
// ==============================================================================
function mostrarEstadoDegradado() {
    const alertCard  = document.getElementById('alertCard');
    const alertBadge = document.getElementById('alertBadge');
    const alertTitle = document.getElementById('alertTitle');
    const alertDesc  = document.getElementById('alertDesc');
    if (!alertCard) return;

    alertCard.style.borderLeftColor = '#6b7280';
    alertBadge.innerText = 'SIN DATOS';
    alertBadge.style.color = '#6b7280';
    alertBadge.style.backgroundColor = 'rgba(107, 114, 128, 0.2)';
    alertBadge.style.borderColor = '#6b7280';
    alertTitle.innerText = 'Sin conexión con la API';
    alertDesc.innerText = `No se pudo obtener datos de ${API_BASE_URL}${API_ENDPOINT}. Verificá que api_sender.py esté corriendo.`;
}

// ==============================================================================
// CICLO PRINCIPAL
// ==============================================================================
async function cicloPolling() {
    const resultado = await fetchMedicion();
    actualizarEstadoConexion();

    if (!resultado.ok) {
        mostrarEstadoDegradado();
        return;
    }

    const data = resultado.data;
    actualizarTarjetas(data);
    actualizarAlerta(data?.alert_level);
    agregarAlHistorial(data);
    refrescarGraficos();
}

// ==============================================================================
// ARRANQUE
// ==============================================================================
async function iniciar() {
    // 1) Crear gráficos vacíos (con historial vacío)
    inicializarGraficosVacios();

    // 2) Hacer la primera petición inmediatamente
    await cicloPolling();

    // 3) Programar el polling
    setInterval(cicloPolling, POLL_INTERVAL_MS);
}

// Arrancar cuando el DOM esté listo
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar);
} else {
    iniciar();
}
