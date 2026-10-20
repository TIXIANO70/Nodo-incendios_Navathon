let miniTemp = null;
let miniHum = null;
let miniWind = null;
let liveCombined = null;

function inicializarGraficosInicio() {
    const tempVal = 30.7;
    const humVal = 26;
    const windVal = 24;

    document.getElementById('tempValue').innerText = `${tempVal} °C`;
    document.getElementById('humValue').innerText = `${humVal} %`;
    document.getElementById('windValue').innerText = `${windVal} km/h`;

    const alertCard = document.getElementById('alertCard');
    const alertBadge = document.getElementById('alertBadge');
    const alertTitle = document.getElementById('alertTitle');
    const alertDesc = document.getElementById('alertDesc');

    if (tempVal > 30 || humVal < 30 || windVal > 20) {
        alertCard.style.borderLeftColor = "#ef4444";
        alertBadge.innerText = "GRAVE";
        alertBadge.style.color = "#ef4444";
        alertBadge.style.backgroundColor = "rgba(239, 68, 68, 0.2)";
        alertBadge.style.borderColor = "#ef4444";
        alertTitle.innerText = "Estado del Sistema: Grave (Alerta Alta)";
        alertDesc.innerText = "¡Atención! Condiciones críticas combinadas de temperatura, humedad y viento.";
    } else {
        alertCard.style.borderLeftColor = "#22c55e";
        alertBadge.innerText = "NORMAL";
        alertBadge.style.color = "#22c55e";
        alertBadge.style.backgroundColor = "rgba(34, 197, 94, 0.2)";
        alertBadge.style.borderColor = "#22c55e";
        alertTitle.innerText = "Estado del Sistema: Normal (Tranqui)";
        alertDesc.innerText = "Parámetros dentro de rangos seguros.";
    }

    if (miniTemp) miniTemp.destroy();
    miniTemp = new Chart(document.getElementById('miniTempChart').getContext('2d'), {
        type: 'line',
        data: {
            labels: ['10:00', '11:00', '12:00', '13:00'],
            datasets: [{ data: [25, 27, 29, tempVal], borderColor: '#f97316', borderWidth: 2, pointRadius: 0, tension: 0.3 }]
        },
        options: opcionesMini()
    });

    if (miniHum) miniHum.destroy();
    miniHum = new Chart(document.getElementById('miniHumChart').getContext('2d'), {
        type: 'line',
        data: {
            labels: ['10:00', '11:00', '12:00', '13:00'],
            datasets: [{ data: [45, 38, 32, humVal], borderColor: '#3b82f6', borderWidth: 2, pointRadius: 0, tension: 0.3 }]
        },
        options: opcionesMini()
    });

    if (miniWind) miniWind.destroy();
    miniWind = new Chart(document.getElementById('miniWindChart').getContext('2d'), {
        type: 'line',
        data: {
            labels: ['10:00', '11:00', '12:00', '13:00'],
            datasets: [{ data: [12, 15, 19, windVal], borderColor: '#a855f7', borderWidth: 2, pointRadius: 0, tension: 0.3 }]
        },
        options: opcionesMini()
    });

    if (liveCombined) liveCombined.destroy();
    liveCombined = new Chart(document.getElementById('liveCombinedChart').getContext('2d'), {
        type: 'line',
        data: {
            labels: ['10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00'],
            datasets: [
                { label: 'Temperatura (°C)', data: [24, 25, 27, 28, 29, 30, 30.7], borderColor: '#f97316', borderWidth: 2, tension: 0.3 },
                { label: 'Humedad (%)', data: [50, 46, 40, 35, 32, 28, 26], borderColor: '#3b82f6', borderWidth: 2, tension: 0.3 },
                { label: 'Viento (km/h)', data: [10, 12, 15, 18, 20, 22, 24], borderColor: '#a855f7', borderWidth: 2, tension: 0.3 }
            ]
        },
        options: opcionesGenerales()
    });
}

function opcionesMini() {
    return {
        responsive: true,
        maintainAspectRatio: false,
        scales: { x: { display: false }, y: { display: false } },
        plugins: { legend: { display: false } }
    };
}

function opcionesGenerales() {
    return {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
            x: { grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#94a3b8' } },
            y: { grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#94a3b8' } }
        },
        plugins: { legend: { labels: { color: '#f8fafc' } } }
    };
}

inicializarGraficosInicio();