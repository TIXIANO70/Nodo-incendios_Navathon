/**
 * ESTACIÓN COPAHUE - CONTROLADOR DE TELEMETRÍA Y VISUALIZACIÓN BIOCLIMÁTICA
 * Grupo 1 • Navathon III (2026)
 *
 * Implementa:
 * - Algoritmo de Humedad de Combustible Fino Muerto (HCFM) Nelson-Simard
 * - Clasificador de Riesgo Cordillerano 25-25-30
 * - Conexión reactiva a API Flask (puerto 8081) con fallback de simulación en vivo
 * - Gestión de gráficos Chart.js con paleta botánica andina
 * - Navegación SPA por pestañas
 */

// Estado centralizado de la aplicación
const state = {
    activeTab: 'tab-monitor',
    activeMetricFilter: 'all',
    simulationMode: false,
    isConnected: false,
    pollingIntervalMs: 5000,
    pollingTimer: null,
    
    currentReading: {
        timestamp: new Date().toISOString(),
        nodeId: 'fire_node_01',
        temperature: 28.5,
        humidity: 24.0,
        windSpeed: 31.0,
        smokeLevel: 0.0,
        recordId: 'init-seed',
        alertLevel: 'medium'
    },
    
    history: []
};

// Instancias de Chart.js
let mainChart = null;
const sparkCharts = {
    temp: null,
    hum: null,
    wind: null,
    smoke: null
};

// ==============================================================================
// 1. ALGORITMOS CIENTÍFICOS Y MODELOS DE RIESGO
// ==============================================================================

/**
 * Calcula la Humedad de Combustible Fino Muerto (HCFM %) según Nelson-Simard.
 * Modela el agua contenida en acículas de Pehuén y hojarasca fina (< 6mm).
 */
function calcularHCFM(temperatura, humedad) {
    const hr = Math.max(1.0, Math.min(100.0, Number(temperatura !== null ? humedad : 30)));
    const t = Number(temperatura !== null ? temperatura : 15);
    let hcfm;

    if (hr < 10.0) {
        hcfm = 0.03229 + 0.281073 * hr - 0.000578 * hr * t;
    } else if (hr < 50.0) {
        hcfm = 2.22749 + 0.160107 * hr - 0.01478 * t;
    } else {
        hcfm = 21.0606 + 0.005565 * Math.pow(hr, 2) - 0.00035 * hr * t - 0.483199 * hr;
    }

    return Math.max(1.0, parseFloat(hcfm.toFixed(1)));
}

/**
 * Evalúa los parámetros meteorológicos según la Regla Cordillerana 25-25-30
 * adaptada para Caviahue-Copahue (1.600 m s. n. m.).
 */
function evaluarRiesgoCopahue(temp, hum, wind, smoke) {
    const t = Number(temp || 0);
    const h = Number(hum || 100);
    const v = Number(wind || 0);
    const s = Number(smoke || 0);
    const hcfm = calcularHCFM(t, h);

    // Activación de la Regla Cordillerana 25-25-30
    const cordilleranRuleActive = (t >= 25.0 && h <= 25.0 && v >= 30.0);

    let nivel = 1;
    let etiqueta = "BAJO / SEGURO";
    let color = "#10b981";
    let alertClass = "normal";
    let diagnostico = "Condiciones estables en Caviahue. Humedad foliar adecuada para contención de chispas en sotobosque.";

    // Factores de escalamiento inmediato por humo
    if (s >= 10.0 || (t >= 35.0 && h <= 15.0) || hcfm <= 5.0) {
        nivel = 5;
        etiqueta = "EXTREMO";
        color = "#a855f7";
        alertClass = "critical";
        diagnostico = "Alerta Extrema. Comportamiento explosivo del fuego. Amenaza inminente para araucarias y área urbana.";
    } else if (s >= 8.0 || (t >= 31.0 && h <= 20.0) || (cordilleranRuleActive && t >= 27.0) || hcfm <= 9.0) {
        nivel = 4;
        etiqueta = "MUY ALTO / CRÍTICO";
        color = "#ef4444";
        alertClass = "high";
        diagnostico = "Alerta Crítica. Coronamiento inminente en Araucarias y avance violento en sotobosque de Ñire.";
    } else if (cordilleranRuleActive || (t >= 23.0 && h <= 25.0) || hcfm <= 14.0) {
        nivel = 3;
        etiqueta = "ALTO";
        color = "#ea580c";
        alertClass = "medium";
        diagnostico = "Riesgo Alto. Activación de la Regla Cordillerana. La hojarasca de Lenga arde con facilidad ante llama abierta.";
    } else if ((t >= 20.0 && h <= 25.0) || v >= 20.0 || hcfm <= 20.0) {
        nivel = 2;
        etiqueta = "MODERADO";
        color = "#f59e0b";
        alertClass = "low";
        diagnostico = "Riesgo Moderado. Viento y calor diurno reducen la humedad de combustibles finos.";
    }

    return {
        nivel,
        etiqueta,
        color,
        alertClass,
        hcfm,
        cordilleranRuleActive,
        diagnostico
    };
}

// ==============================================================================
// 2. ACTUALIZACIÓN DEL DOM Y COMPONENTES VISUALES
// ==============================================================================

function renderizarTelemetria(data) {
    const t = Number(data.temperature !== null ? data.temperature : 0);
    const h = Number(data.humidity !== null ? data.humidity : 0);
    const v = Number(data.windSpeed !== null ? data.windSpeed : 0);
    const s = Number(data.smokeLevel !== null ? data.smokeLevel : 0);

    const evaluacion = evaluarRiesgoCopahue(t, h, v, s);

    // 1. Tarjeta Hero de Riesgo
    const riskCard = document.getElementById('riskCard');
    const riskNum = document.getElementById('riskLevelNumber');
    const riskBadge = document.getElementById('riskLevelBadge');
    const diagText = document.getElementById('riskDiagnosticText');
    const ruleChip = document.getElementById('cordilleranRuleChip');
    const hcfmValue = document.getElementById('hcfmValue');

    if (riskCard) riskCard.style.borderLeftColor = evaluacion.color;
    if (riskNum) {
        riskNum.innerText = evaluacion.nivel;
        riskNum.style.color = evaluacion.color;
    }
    if (riskBadge) {
        riskBadge.innerText = evaluacion.etiqueta;
        riskBadge.style.color = evaluacion.color;
    }
    if (diagText) diagText.innerText = evaluacion.diagnostico;
    if (hcfmValue) hcfmValue.innerText = evaluacion.hcfm.toFixed(1);

    if (ruleChip) {
        if (evaluacion.cordilleranRuleActive) {
            ruleChip.innerText = "Regla 25-25-30: ACTIVADA";
            ruleChip.style.background = "rgba(234, 88, 12, 0.2)";
            ruleChip.style.borderColor = "var(--alert-b3)";
            ruleChip.style.color = "var(--alert-b3)";
        } else {
            ruleChip.innerText = "Regla 25-25-30: Segura";
            ruleChip.style.background = "rgba(255, 255, 255, 0.05)";
            ruleChip.style.borderColor = "var(--border-subtle)";
            ruleChip.style.color = "var(--text-secondary)";
        }
    }

    // Actualizar segmentos de severidad
    for (let i = 1; i <= 5; i++) {
        const seg = document.querySelector(`.severity-segment.seg-${i}`);
        if (seg) {
            if (i <= evaluacion.nivel) {
                seg.classList.add('active');
            } else {
                seg.classList.remove('active');
            }
        }
    }

    // 2. Tarjetas de Sensores
    const tempDisplay = document.getElementById('tempDisplay');
    const tempDelta = document.getElementById('tempDelta');
    if (tempDisplay) tempDisplay.innerText = t.toFixed(1);
    if (tempDelta) {
        const delta = (t - 13.0).toFixed(1);
        tempDelta.innerText = `${delta >= 0 ? '+' : ''}${delta} °C`;
    }

    const humDisplay = document.getElementById('humDisplay');
    const humStatusBadge = document.getElementById('humStatusBadge');
    if (humDisplay) humDisplay.innerText = Math.round(h);
    if (humStatusBadge) {
        if (h <= 20) {
            humStatusBadge.innerText = "Estrés Extremo";
            humStatusBadge.style.color = "var(--alert-b4)";
        } else if (h <= 25) {
            humStatusBadge.innerText = "Zona de Fuego";
            humStatusBadge.style.color = "var(--alert-b3)";
        } else {
            humStatusBadge.innerText = "Rango Seguro";
            humStatusBadge.style.color = "var(--alert-b1)";
        }
    }

    const windDisplay = document.getElementById('windDisplay');
    const windStatusBadge = document.getElementById('windStatusBadge');
    if (windDisplay) windDisplay.innerText = v.toFixed(1);
    if (windStatusBadge) {
        if (v >= 35) {
            windStatusBadge.innerText = "Ráfagas Críticas";
            windStatusBadge.style.color = "var(--alert-b4)";
        } else if (v >= 25) {
            windStatusBadge.innerText = "Viento Fuerte";
            windStatusBadge.style.color = "var(--alert-b3)";
        } else {
            windStatusBadge.innerText = "Brisa Moderada";
            windStatusBadge.style.color = "var(--alert-b1)";
        }
    }

    const smokeDisplay = document.getElementById('smokeDisplay');
    const smokeStatusBadge = document.getElementById('smokeStatusBadge');
    if (smokeDisplay) smokeDisplay.innerText = s.toFixed(1);
    if (smokeStatusBadge) {
        if (s >= 10) {
            smokeStatusBadge.innerText = "Foco Detectado";
            smokeStatusBadge.style.color = "var(--alert-b5)";
        } else if (s >= 5) {
            smokeStatusBadge.innerText = "Presencia de Humo";
            smokeStatusBadge.style.color = "var(--alert-b3)";
        } else {
            smokeStatusBadge.innerText = "Atmósfera Limpia";
            smokeStatusBadge.style.color = "var(--alert-b1)";
        }
    }

    // 3. Metadata de la cabecera
    const nodeLabel = document.getElementById('nodeLabel');
    const lastTelemetryTime = document.getElementById('lastTelemetryTime');
    if (nodeLabel) nodeLabel.innerText = data.nodeId || 'fire_node_01';
    if (lastTelemetryTime && data.timestamp) {
        const timePart = data.timestamp.includes('T') ? data.timestamp.split('T')[1].replace('Z', '') : data.timestamp;
        lastTelemetryTime.innerText = `${timePart} UTC`;
    }

    // 4. Agregar a tabla de historial
    agregarFilaHistorial(data, evaluacion);
}

function agregarFilaHistorial(data, evaluacion) {
    const tableBody = document.getElementById('telemetryTableBody');
    const logCounter = document.getElementById('logCounter');
    if (!tableBody) return;

    const row = document.createElement('tr');
    const uuidShort = (data.recordId || 'local').substring(0, 8);
    const timeFormatted = data.timestamp ? data.timestamp.replace('T', ' ').replace('Z', '') : '--';

    row.innerHTML = `
        <td>${timeFormatted}</td>
        <td><code>${data.nodeId || 'fire_node_01'}</code></td>
        <td><span class="table-alert-pill ${evaluacion.alertClass}">${evaluacion.etiqueta}</span></td>
        <td>${Number(data.temperature || 0).toFixed(1)}</td>
        <td>${Number(data.humidity || 0).toFixed(1)}</td>
        <td>${Number(data.windSpeed || 0).toFixed(1)}</td>
        <td>${Number(data.smokeLevel || 0).toFixed(1)}</td>
        <td>${evaluacion.hcfm.toFixed(1)}%</td>
        <td title="${data.recordId || ''}"><code>${uuidShort}...</code></td>
    `;

    tableBody.insertBefore(row, tableBody.firstChild);

    // Limitar filas en tabla a 25 para evitar fugas de memoria
    while (tableBody.children.length > 25) {
        tableBody.removeChild(tableBody.lastChild);
    }

    if (logCounter) {
        logCounter.innerText = `${tableBody.children.length} registros`;
    }
}

// ==============================================================================
// 3. GESTIÓN DE GRÁFICOS (CHART.JS)
// ==============================================================================

function inicializarGraficos() {
    const canvasMain = document.getElementById('liveCombinedChart');
    if (!canvasMain) return;

    const ctx = canvasMain.getContext('2d');

    // Gradientes botánicos andinos
    const gradTemp = ctx.createLinearGradient(0, 0, 0, 300);
    gradTemp.addColorStop(0, 'rgba(245, 158, 11, 0.4)');
    gradTemp.addColorStop(1, 'rgba(245, 158, 11, 0.0)');

    const gradHum = ctx.createLinearGradient(0, 0, 0, 300);
    gradHum.addColorStop(0, 'rgba(6, 182, 212, 0.35)');
    gradHum.addColorStop(1, 'rgba(6, 182, 212, 0.0)');

    const gradWind = ctx.createLinearGradient(0, 0, 0, 300);
    gradWind.addColorStop(0, 'rgba(52, 211, 153, 0.35)');
    gradWind.addColorStop(1, 'rgba(52, 211, 153, 0.0)');

    const gradSmoke = ctx.createLinearGradient(0, 0, 0, 300);
    gradSmoke.addColorStop(0, 'rgba(244, 63, 94, 0.4)');
    gradSmoke.addColorStop(1, 'rgba(244, 63, 94, 0.0)');

    mainChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'Temperatura (°C)',
                    data: [],
                    borderColor: '#f59e0b',
                    backgroundColor: gradTemp,
                    fill: true,
                    tension: 0.35,
                    borderWidth: 2,
                    pointRadius: 3,
                    pointHoverRadius: 6,
                    yAxisID: 'y'
                },
                {
                    label: 'Humedad (%)',
                    data: [],
                    borderColor: '#06b6d4',
                    backgroundColor: gradHum,
                    fill: true,
                    tension: 0.35,
                    borderWidth: 2,
                    pointRadius: 3,
                    pointHoverRadius: 6,
                    yAxisID: 'y'
                },
                {
                    label: 'Viento (km/h)',
                    data: [],
                    borderColor: '#34d399',
                    backgroundColor: gradWind,
                    fill: true,
                    tension: 0.35,
                    borderWidth: 2,
                    pointRadius: 3,
                    pointHoverRadius: 6,
                    yAxisID: 'y'
                },
                {
                    label: 'Humo (ppm)',
                    data: [],
                    borderColor: '#f43f5e',
                    backgroundColor: gradSmoke,
                    fill: true,
                    tension: 0.35,
                    borderWidth: 2,
                    pointRadius: 3,
                    pointHoverRadius: 6,
                    yAxisID: 'y'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        color: '#9cb3a5',
                        font: { family: "'Plus Jakarta Sans', sans-serif", size: 12 },
                        usePointStyle: true,
                        boxWidth: 8
                    }
                },
                tooltip: {
                    backgroundColor: '#16201b',
                    titleColor: '#f0fdf4',
                    bodyColor: '#9cb3a5',
                    borderColor: 'rgba(255, 255, 255, 0.1)',
                    borderWidth: 1,
                    padding: 10,
                    titleFont: { family: "'JetBrains Mono', monospace", size: 12 },
                    bodyFont: { family: "'JetBrains Mono', monospace", size: 12 }
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255, 255, 255, 0.04)' },
                    ticks: { color: '#5e7769', font: { family: "'JetBrains Mono', monospace", size: 10 } }
                },
                y: {
                    grid: { color: 'rgba(255, 255, 255, 0.04)' },
                    ticks: { color: '#5e7769', font: { family: "'JetBrains Mono', monospace", size: 10 } },
                    suggestedMin: 0,
                    suggestedMax: 60
                }
            }
        }
    });

    // Inicializar mini-sparklines
    inicializarSparkline('sparkTemp', '#f59e0b', 'temp');
    inicializarSparkline('sparkHum', '#06b6d4', 'hum');
    inicializarSparkline('sparkWind', '#34d399', 'wind');
    inicializarSparkline('sparkSmoke', '#f43f5e', 'smoke');
}

function inicializarSparkline(canvasId, color, key) {
    const el = document.getElementById(canvasId);
    if (!el) return;
    sparkCharts[key] = new Chart(el.getContext('2d'), {
        type: 'line',
        data: {
            labels: ['', '', '', '', ''],
            datasets: [{
                data: [0, 0, 0, 0, 0],
                borderColor: color,
                borderWidth: 2,
                pointRadius: 0,
                tension: 0.3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: { x: { display: false }, y: { display: false } },
            plugins: { legend: { display: false }, tooltip: { enabled: false } }
        }
    });
}

function actualizarGraficos(data) {
    if (!mainChart) return;

    const timeLabel = data.timestamp ? (data.timestamp.split('T')[1] || '').substring(0, 5) : '';

    mainChart.data.labels.push(timeLabel);
    mainChart.data.datasets[0].data.push(data.temperature);
    mainChart.data.datasets[1].data.push(data.humidity);
    mainChart.data.datasets[2].data.push(data.windSpeed);
    mainChart.data.datasets[3].data.push(data.smokeLevel);

    // Mantener ventana móvil de 15 puntos en gráfico principal
    if (mainChart.data.labels.length > 15) {
        mainChart.data.labels.shift();
        mainChart.data.datasets.forEach(ds => ds.data.shift());
    }
    mainChart.update('none');

    // Actualizar sparklines individuales
    actualizarSpark(sparkCharts.temp, data.temperature);
    actualizarSpark(sparkCharts.hum, data.humidity);
    actualizarSpark(sparkCharts.wind, data.windSpeed);
    actualizarSpark(sparkCharts.smoke, data.smokeLevel);
}

function actualizarSpark(chart, val) {
    if (!chart) return;
    chart.data.datasets[0].data.push(val);
    if (chart.data.datasets[0].data.length > 7) {
        chart.data.datasets[0].data.shift();
    }
    chart.update('none');
}

// ==============================================================================
// 4. CONECTOR CON API FLASK Y GENERADOR DE SIMULACIÓN
// ==============================================================================

/**
 * Determina la URL de la API del Gateway (puerto 8081).
 * Detecta si se está ejecutando desde localhost, un servidor web o file://.
 */
function resolverUrlApi() {
    if (window.location.protocol === 'file:') {
        return 'http://localhost:8081/api/incendios';
    }
    const host = window.location.hostname || 'localhost';
    return `http://${host}:8081/api/incendios`;
}

async function consultarApiEnVivo() {
    if (state.simulationMode) {
        ejecutarPasoSimulado();
        return;
    }

    const apiUrl = resolverUrlApi();
    const pulse = document.getElementById('connectionPulse');
    const modeLabel = document.getElementById('connectionModeLabel');

    try {
        const response = await fetch(apiUrl, {
            method: 'GET',
            headers: { 'Accept': 'application/json' },
            cache: 'no-store'
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const json = await response.json();

        // Mapear payload normalizado v1.0.0
        const nuevaLectura = {
            timestamp: json.timestamp || new Date().toISOString(),
            nodeId: json.node_id || 'fire_node_01',
            temperature: json.data?.temperature !== undefined ? json.data.temperature : 25.0,
            humidity: json.data?.humidity !== undefined ? json.data.humidity : 30.0,
            windSpeed: json.data?.wind_speed !== undefined ? json.data.wind_speed : 15.0,
            smokeLevel: json.data?.smoke_level !== undefined ? json.data.smokeLevel : 0.0,
            recordId: json.record_id || String(Date.now()),
            alertLevel: json.alert_level || 'normal'
        };

        state.isConnected = true;
        if (pulse) {
            pulse.style.backgroundColor = 'var(--alert-b1)';
            pulse.classList.add('pulsing');
        }
        if (modeLabel) modeLabel.innerText = 'En vivo (API 8081)';

        state.currentReading = nuevaLectura;
        renderizarTelemetria(nuevaLectura);
        actualizarGraficos(nuevaLectura);

    } catch (err) {
        // En caso de que la API esté apagada o bloqueada por CORS local, activar simulación suave
        state.isConnected = false;
        if (pulse) {
            pulse.style.backgroundColor = 'var(--lenga-amber)';
            pulse.classList.remove('pulsing');
        }
        if (modeLabel) modeLabel.innerText = 'Modo Demo (API Offline)';

        ejecutarPasoSimulado();
    }
}

/**
 * Genera variaciones estocásticas realistas basadas en el clima estival de Copahue.
 */
function ejecutarPasoSimulado() {
    const cur = state.currentReading;
    const now = new Date();
    const timeStr = now.toISOString().replace(/\.\d+Z$/, 'Z');

    // Deriva suave de valores meteorológicos
    const dTemp = (Math.random() - 0.45) * 0.8;
    const dHum = (Math.random() - 0.52) * 1.5;
    const dWind = (Math.random() - 0.48) * 1.8;
    const dSmoke = Math.random() > 0.85 ? Math.random() * 2.5 : 0.0;

    const newTemp = Math.max(12.0, Math.min(36.5, parseFloat((cur.temperature + dTemp).toFixed(1))));
    const newHum = Math.max(12.0, Math.min(85.0, parseFloat((cur.humidity + dHum).toFixed(1))));
    const newWind = Math.max(0.0, Math.min(55.0, parseFloat((cur.windSpeed + dWind).toFixed(1))));
    const newSmoke = parseFloat(dSmoke.toFixed(1));

    const simRecord = {
        timestamp: timeStr,
        nodeId: 'fire_node_01',
        temperature: newTemp,
        humidity: newHum,
        windSpeed: newWind,
        smokeLevel: newSmoke,
        recordId: `sim-${Math.random().toString(36).substring(2, 10)}`,
        alertLevel: 'normal'
    };

    state.currentReading = simRecord;
    renderizarTelemetria(simRecord);
    actualizarGraficos(simRecord);
}

// ==============================================================================
// 5. NAVEGACIÓN SPA Y EVENTOS DE INTERFAZ
// ==============================================================================

function configurarPestanias() {
    const tabBtns = document.querySelectorAll('.nav-tab-btn');
    const views = document.querySelectorAll('.station-view');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.getAttribute('data-tab');
            tabBtns.forEach(b => b.classList.remove('active'));
            views.forEach(v => v.classList.remove('active'));

            btn.classList.add('active');
            const targetView = document.getElementById(targetId);
            if (targetView) targetView.classList.add('active');

            state.activeTab = targetId;

            // Re-render de Chart.js si se vuelve a la pestaña de monitoreo
            if (targetId === 'tab-monitor' && mainChart) {
                setTimeout(() => mainChart.resize(), 50);
            }
        });
    });
}

function configurarFiltrosGrafico() {
    const filterBtns = document.querySelectorAll('.filter-btn');
    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            filterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const metric = btn.getAttribute('data-metric');
            state.activeMetricFilter = metric;

            if (!mainChart) return;

            // Índices de datasets: 0=Temp, 1=Hum, 2=Wind, 3=Smoke
            mainChart.data.datasets.forEach((ds, idx) => {
                if (metric === 'all') {
                    ds.hidden = false;
                } else if (metric === 'temp') {
                    ds.hidden = (idx !== 0);
                } else if (metric === 'hum') {
                    ds.hidden = (idx !== 1);
                } else if (metric === 'wind') {
                    ds.hidden = (idx !== 2);
                } else if (metric === 'smoke') {
                    ds.hidden = (idx !== 3);
                }
            });
            mainChart.update();
        });
    });

    // Botón toggle modo simulación
    const btnSim = document.getElementById('btnToggleSim');
    const lblSim = document.getElementById('btnSimLabel');
    if (btnSim && lblSim) {
        btnSim.addEventListener('click', () => {
            state.simulationMode = !state.simulationMode;
            if (state.simulationMode) {
                lblSim.innerText = 'Forzar API';
                btnSim.style.borderColor = 'var(--lenga-amber)';
            } else {
                lblSim.innerText = 'Modo Demo';
                btnSim.style.borderColor = 'var(--border-subtle)';
            }
            consultarApiEnVivo();
        });
    }

    // Botón limpiar tabla de registros
    const btnClear = document.getElementById('btnClearLogs');
    const tableBody = document.getElementById('telemetryTableBody');
    const logCounter = document.getElementById('logCounter');
    if (btnClear && tableBody) {
        btnClear.addEventListener('click', () => {
            tableBody.innerHTML = '';
            if (logCounter) logCounter.innerText = '0 registros';
        });
    }
}

// ==============================================================================
// 6. INICIALIZACIÓN GENERAL
// ==============================================================================

document.addEventListener('DOMContentLoaded', () => {
    configurarPestanias();
    configurarFiltrosGrafico();
    inicializarGraficos();

    // Precargar 5 mediciones sintéticas iniciales para llenar la curva
    const ahora = Date.now();
    for (let i = 4; i >= 0; i--) {
        const timeHistorical = new Date(ahora - i * 60000).toISOString();
        const baseTemp = 26.5 + (4 - i) * 0.5;
        const baseHum = 32.0 - (4 - i) * 1.2;
        const baseWind = 18.0 + (4 - i) * 1.5;
        const baseReading = {
            timestamp: timeHistorical,
            nodeId: 'fire_node_01',
            temperature: parseFloat(baseTemp.toFixed(1)),
            humidity: parseFloat(baseHum.toFixed(1)),
            windSpeed: parseFloat(baseWind.toFixed(1)),
            smokeLevel: 0.0,
            recordId: `init-${i}`
        };
        const evalInit = evaluarRiesgoCopahue(baseReading.temperature, baseReading.humidity, baseReading.windSpeed, 0);
        agregarFilaHistorial(baseReading, evalInit);
        actualizarGraficos(baseReading);
    }

    // Primera consulta
    consultarApiEnVivo();

    // Iniciar polling regular
    state.pollingTimer = setInterval(consultarApiEnVivo, state.pollingIntervalMs);
});
