// ApexEngineer Dashboard Controller
let activeStream = null;
let telemetryChart = null;
let chartDataPoints = 60; // 15 seconds of history at 4Hz
let isMuted = false;
let spokenWarnings = {}; // Throttle voice triggers
const raceHistoryKey = 'apexEngineerRaceHistory.v1';
const maxRaceHistoryRecords = 1200;
let activeHistorySession = null;
let lastHistorySampleAt = 0;
let lastLapRecordSignature = '';
const engineerPhrases = {
    yellowFlag: [
        "Yellow flag ahead. Bring the pace down and hold position.",
        "Caution zone active. No hero moves here, keep it tidy.",
        "Yellow flags out. Lift early and watch for traffic."
    ],
    redFlag: [
        "Red flag. Back out of it and return to pit lane.",
        "Session stopped. Abort the lap and head for the pits.",
        "Red flag condition. Slow immediately and box when instructed."
    ],
    greenFlag: [
        "Green flag. Track is clear, push now.",
        "We are green again. Build the speed back up.",
        "Track clear. You can get back on the throttle."
    ],
    tyreHeat: [
        "Tyres are running hot. Reduce the sliding and cool them down.",
        "Surface temps are climbing. Smooth the inputs for half a lap.",
        "We are overheating the rubber. Short shift and keep the car settled."
    ],
    tyreWearPit: [
        "Tyre wear is over fifty percent on the {tyre}. Box this lap for fresh rubber.",
        "{tyre} wear has crossed fifty percent. We need to pit before the pace falls away.",
        "The {tyre} is past the wear limit. Pit window is open, come in this lap.",
        "Tyre life is dropping now, {tyre} is beyond fifty percent. Plan to box."
    ],
    lowFuel: [
        "Fuel is critically low. Prepare to box for fuel this lap.",
        "Fuel number is critical. We need fuel, box this lap.",
        "We are short on fuel. Bring it in at the end of this lap."
    ],
    bestLap: [
        "Excellent lap. New personal best: {lap}.",
        "That is your quickest lap so far: {lap}. Keep that rhythm.",
        "Personal best confirmed at {lap}. Strong pace."
    ],
    connected: [
        "Apex Radio link established. Analyzing telemetry feed for {game}.",
        "Comms online. I have telemetry for {game}.",
        "Radio check complete. Telemetry stream is live for {game}."
    ],
    disconnected: [
        "Comms link disconnected.",
        "Radio link closed.",
        "Telemetry link is offline."
    ],
    check: [
        "Comms check. Radio connection is loud and clear.",
        "Radio check received. Audio and telemetry are live.",
        "Engineer channel confirmed. We are connected."
    ],
    unmuted: [
        "Radio unmuted.",
        "Engineer audio is back online.",
        "Comms audio restored."
    ]
};

// Web Audio API Radio Static Sound Generator
let audioCtx = null;

function initAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
}

// Generate an authentic "Radio Click & Static" effect dynamically using Web Audio API
function playRadioClick(duration = 0.15) {
    initAudio();
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    
    // Create oscillator for the walkie-talkie "beep"
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, audioCtx.currentTime); // Pitch
    osc.frequency.exponentialRampToValueAtTime(1200, audioCtx.currentTime + 0.08);
    
    gainNode.gain.setValueAtTime(0.08, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
    
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);

    // Create White Noise buffer for "radio static"
    const bufferSize = audioCtx.sampleRate * 0.25; // 1/4 second static
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
    }
    
    const noise = audioCtx.createBufferSource();
    noise.buffer = buffer;
    
    const noiseGain = audioCtx.createGain();
    noiseGain.gain.setValueAtTime(0.03, audioCtx.currentTime);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.25);
    
    // Add bandpass filter to sound like an old radio transceiver
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1000; // Centered frequency
    filter.Q.value = 1.2;
    
    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(audioCtx.destination);
    
    noise.start();
    noise.stop(audioCtx.currentTime + 0.25);
}

// Virtual AI Engineer Speech Assistant
function speakAlert(text, priority = 'normal') {
    if (isMuted) return;
    
    // Play static comms sound
    playRadioClick(0.12);
    
    // Log message to rolling terminal log
    setTimeout(() => {
        logToTerminal(text, priority);
        
        // Speak using Web Speech API
        if (typeof SpeechSynthesisUtterance === 'undefined' || !window.speechSynthesis) {
            console.warn("Speech synthesis not supported on this device.");
            return;
        }
        const utterance = new SpeechSynthesisUtterance(text);
        
        // Find an English male/female voice that sounds professional
        const voices = window.speechSynthesis.getVoices();
        const idealVoice = voices.find(v => v.lang.startsWith('en') && (v.name.includes('Google') || v.name.includes('Natural') || v.name.includes('Microsoft'))) || voices[0];
        if (idealVoice) {
            utterance.voice = idealVoice;
        }
        
        utterance.rate = 1.05; // Slightly faster to sound crisp
        utterance.pitch = 0.95; // Slightly lower to sound robotic/mature
        window.speechSynthesis.speak(utterance);
    }, 180);
}

function engineerLine(key, replacements = {}) {
    const phrases = engineerPhrases[key] || [key];
    const lastIndex = spokenWarnings.phraseIndex?.[key] ?? -1;
    let nextIndex = Math.floor(Math.random() * phrases.length);
    if (phrases.length > 1 && nextIndex === lastIndex) {
        nextIndex = (nextIndex + 1) % phrases.length;
    }

    spokenWarnings.phraseIndex = spokenWarnings.phraseIndex || {};
    spokenWarnings.phraseIndex[key] = nextIndex;

    return Object.entries(replacements).reduce(
        (line, [token, value]) => line.replaceAll(`{${token}}`, value),
        phrases[nextIndex]
    );
}

function logToTerminal(text, priority = 'normal') {
    const consoleEl = document.getElementById('terminal-console');
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    
    let priorityClass = 'system-msg';
    if (priority === 'warning') priorityClass = 'engineer-warning';
    if (priority === 'critical') priorityClass = 'engineer-critical';
    if (priority === 'radio') priorityClass = 'engineer-speech';
    
    const line = document.createElement('div');
    line.className = `console-line ${priorityClass}`;
    line.innerHTML = `[${time}] <span class="prefix">ENGINEER:</span> ${text.toUpperCase()}`;
    
    consoleEl.appendChild(line);
    consoleEl.scrollTop = consoleEl.scrollHeight;
}

// Format Lap Time (in seconds) to standard mm:ss.SSS
function formatLapTime(seconds) {
    if (!seconds || seconds <= 0) return "--:--.---";
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${min}:${sec.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}

function readRaceHistory() {
    try {
        return JSON.parse(localStorage.getItem(raceHistoryKey) || '[]');
    } catch (e) {
        console.error('Unable to read race history:', e);
        return [];
    }
}

function writeRaceHistory(records) {
    localStorage.setItem(raceHistoryKey, JSON.stringify(records.slice(-maxRaceHistoryRecords)));
}

function getAverageTyreWear(tyres) {
    if (!tyres) return 0;
    const values = ['fl', 'fr', 'rl', 'rr'].map(k => tyres[k]?.wear || 0);
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[char]));
}

function startHistorySession(game, series) {
    activeHistorySession = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        game,
        series: (series || 'Practice').trim() || 'Practice',
        startedAt: new Date().toISOString()
    };
    lastHistorySampleAt = 0;
    lastLapRecordSignature = '';
}

function buildHistoryRecord(t, recordType) {
    const lap = Number.isFinite(Number(t.lap_current)) ? Number(t.lap_current) : 0;
    const fuelPct = t.fuel_capacity > 0 ? (t.fuel_remaining / t.fuel_capacity) * 100 : 0;

    return {
        id: `${Date.now()}-${recordType}-${Math.random().toString(16).slice(2)}`,
        sessionId: activeHistorySession.id,
        timestamp: new Date().toISOString(),
        game: activeHistorySession.game,
        series: activeHistorySession.series,
        type: recordType,
        track: t.track_name || 'DETECTING...',
        weather: t.weather || 'not_reported',
        lap,
        currentLapTime: t.lap_time_current || 0,
        lastLapTime: t.lap_time_last || 0,
        bestLapTime: t.lap_time_best || 0,
        sector: t.sector || 1,
        sectorCount: t.sector_count || 3,
        sectorTimes: t.sector_times || {},
        tyreWearAvg: getAverageTyreWear(t.tyres),
        tyreWear: {
            fl: t.tyres?.fl?.wear || 0,
            fr: t.tyres?.fr?.wear || 0,
            rl: t.tyres?.rl?.wear || 0,
            rr: t.tyres?.rr?.wear || 0
        },
        fuelRemaining: t.fuel_remaining || 0,
        fuelPct,
        speed: t.speed || 0
    };
}

function storeRaceRecord(record) {
    const history = readRaceHistory();
    history.push(record);
    writeRaceHistory(history);
    renderRaceHistory();
}

function recordTelemetryHistory(t) {
    if (!activeHistorySession || !t || t.game === 'none') return;

    const now = Date.now();
    const lap = Number(t.lap_current || 0);
    const lastLap = Number(t.lap_time_last || 0);

    if (lap > 0 && lastLap > 0) {
        const signature = `${activeHistorySession.id}:${lap}:${lastLap.toFixed(3)}`;
        if (signature !== lastLapRecordSignature) {
            storeRaceRecord(buildHistoryRecord(t, 'lap'));
            lastLapRecordSignature = signature;
            lastHistorySampleAt = now;
            return;
        }
    }

    if (now - lastHistorySampleAt > 10000) {
        storeRaceRecord(buildHistoryRecord(t, 'sample'));
        lastHistorySampleAt = now;
    }
}

function renderRaceHistory() {
    const tbody = document.getElementById('history-results');
    const summary = document.getElementById('history-summary');
    if (!tbody || !summary) return;

    const gameFilter = document.getElementById('history-game-filter')?.value || 'all';
    const seriesFilter = (document.getElementById('history-series-filter')?.value || '').trim().toLowerCase();
    const lapMinRaw = document.getElementById('history-lap-min')?.value;
    const lapMaxRaw = document.getElementById('history-lap-max')?.value;
    const lapMin = lapMinRaw === '' ? null : Number(lapMinRaw);
    const lapMax = lapMaxRaw === '' ? null : Number(lapMaxRaw);

    const records = readRaceHistory().filter(record => {
        if (gameFilter !== 'all' && record.game !== gameFilter) return false;
        if (seriesFilter && !record.series.toLowerCase().includes(seriesFilter)) return false;
        if (lapMin !== null && record.lap < lapMin) return false;
        if (lapMax !== null && record.lap > lapMax) return false;
        return true;
    });

    summary.innerText = `${records.length} matching records / ${readRaceHistory().length} stored`;

    if (records.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" class="history-empty">No race data matches the current filters.</td></tr>';
        return;
    }

    tbody.innerHTML = records.slice(-100).reverse().map(record => {
        const time = new Date(record.timestamp).toLocaleString([], {
            month: 'short',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
        const lapTime = record.type === 'lap' ? formatLapTime(record.lastLapTime) : formatLapTime(record.currentLapTime);
        const fuel = record.fuelPct > 0 ? `${record.fuelPct.toFixed(0)}%` : '--';
        return `
            <tr>
                <td>${time}</td>
                <td><span class="history-pill">${record.game.toUpperCase()}</span></td>
                <td>${escapeHtml(record.series)}</td>
                <td>${escapeHtml(record.track)}</td>
                <td>${record.lap || '--'}</td>
                <td>${record.type.toUpperCase()}</td>
                <td>${lapTime}</td>
                <td>${formatLapTime(record.bestLapTime)}</td>
                <td>${record.tyreWearAvg.toFixed(0)}%</td>
                <td>${fuel}</td>
            </tr>
        `;
    }).join('');
}

// Initialize Charts using Chart.js
function initCharts() {
    if (typeof Chart === 'undefined') {
        logToTerminal('Telemetry chart library unavailable. Live gauges remain active.', 'warning');
        return;
    }

    const ctx = document.getElementById('telemetryChart').getContext('2d');
    
    // Custom neon glow plugins for chart lines
    const glowPlugin = {
        id: 'glow',
        beforeDraw: (chart) => {
            const ctx = chart.ctx;
            ctx.shadowColor = 'rgba(0, 176, 255, 0.4)';
            ctx.shadowBlur = 8;
        },
        afterDraw: (chart) => {
            chart.ctx.shadowBlur = 0;
        }
    };

    telemetryChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: Array(chartDataPoints).fill(''),
            datasets: [
                {
                    label: 'Speed (km/h)',
                    data: Array(chartDataPoints).fill(0),
                    borderColor: '#00b0ff',
                    borderWidth: 2.5,
                    pointRadius: 0,
                    tension: 0.1,
                    yAxisID: 'y'
                },
                {
                    label: 'RPM',
                    data: Array(chartDataPoints).fill(0),
                    borderColor: '#ffd600',
                    borderWidth: 1.5,
                    borderDash: [4, 4],
                    pointRadius: 0,
                    tension: 0.1,
                    yAxisID: 'y1'
                },
                {
                    label: 'Throttle (%)',
                    data: Array(chartDataPoints).fill(0),
                    borderColor: '#00e676',
                    borderWidth: 1.5,
                    pointRadius: 0,
                    tension: 0.1,
                    yAxisID: 'y2'
                },
                {
                    label: 'Brake (%)',
                    data: Array(chartDataPoints).fill(0),
                    borderColor: '#ff1744',
                    borderWidth: 1.5,
                    pointRadius: 0,
                    tension: 0.1,
                    yAxisID: 'y2'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        boxWidth: 12,
                        color: '#64748b',
                        font: { family: 'Outfit', size: 10, weight: 'bold' }
                    }
                }
            },
            scales: {
                x: { display: false },
                y: {
                    type: 'linear',
                    position: 'left',
                    min: 0,
                    max: 360,
                    grid: { color: 'rgba(255,255,255,0.02)' },
                    ticks: { color: '#64748b', font: { family: 'Outfit', size: 9 } }
                },
                y1: {
                    type: 'linear',
                    position: 'right',
                    min: 0,
                    max: 15000,
                    display: false
                },
                y2: {
                    type: 'linear',
                    position: 'right',
                    min: 0,
                    max: 100,
                    display: false
                }
            }
        }
    });
}

// Shift Indicator Bar LED logic
function updateShiftLights(rpm, maxRpm) {
    const bar = document.getElementById('shift-bar');
    const leds = document.querySelectorAll('.led');
    
    if (!maxRpm || maxRpm <= 0) return;
    
    const pct = (rpm / maxRpm) * 100;
    
    // Clear flash warning state
    bar.classList.remove('flash-alert');
    
    if (pct >= 96) {
        // Redline shifting flash!
        bar.classList.add('flash-alert');
        leds.forEach(led => led.classList.add('active'));
        document.getElementById('gear-val').classList.add('shift-up');
    } else {
        document.getElementById('gear-val').classList.remove('shift-up');
        
        // F1 pattern: LEDs light up sequentially above 55% RPM
        const startPct = 55;
        const totalSteps = 12;
        let litCount = 0;
        
        if (pct >= startPct) {
            const rangePct = 95 - startPct;
            const currentOffsetPct = pct - startPct;
            litCount = Math.ceil((currentOffsetPct / rangePct) * totalSteps);
            litCount = Math.min(litCount, totalSteps);
        }
        
        leds.forEach((led, i) => {
            if (i < litCount) {
                led.classList.add('active');
            } else {
                led.classList.remove('active');
            }
        });
    }
}

// Steering Rotation Widget
function updateSteering(angle) {
    // Standardize steer angle (e.g. -100 to +100 representing scale)
    // Rotate indicator line based on steering angle
    const line = document.getElementById('steer-marker');
    const rotationDeg = (angle / 100) * 120; // Max 120 degrees turn visual
    line.style.transform = `rotate(${rotationDeg}deg)`;
    line.style.transformOrigin = '50px 50px';
    document.getElementById('steer-val').innerText = `${Math.round(rotationDeg)}°`;
}

// Update individual Tyre Heatmap Cards
function updateTyreCard(cardId, prefix, tyreData) {
    const card = document.getElementById(cardId);
    if (!card || !tyreData) return;
    
    const surfTemp = Math.round(tyreData.temp_surface || 0);
    const coreTemp = Math.round(tyreData.temp_inner || 0);
    const pressure = (tyreData.pressure || 0).toFixed(1);
    const wear = Math.round(tyreData.wear || 0);
    
    document.getElementById(`${prefix}-surf`).innerText = `${surfTemp}°C`;
    document.getElementById(`${prefix}-core`).innerText = `${coreTemp}°C`;
    document.getElementById(`${prefix}-psi`).innerText = `${pressure} PSI`;
    document.getElementById(`${prefix}-wear`).innerText = `WEAR ${wear}%`;
    
    // Thermal classes mapping:
    card.classList.remove('tyre-cold', 'tyre-optimal', 'tyre-warm', 'tyre-hot');
    
    if (surfTemp < 72) {
        card.classList.add('tyre-cold');
    } else if (surfTemp >= 72 && surfTemp <= 95) {
        card.classList.add('tyre-optimal');
    } else if (surfTemp > 95 && surfTemp <= 104) {
        card.classList.add('tyre-warm');
    } else {
        card.classList.add('tyre-hot');
    }
}

function updateTyreWearSummary(tyres) {
    const tyreKeys = ['fl', 'fr', 'rl', 'rr'];
    const wearValues = tyreKeys.map(k => tyres[k]?.wear || 0);
    const avgWear = wearValues.reduce((sum, value) => sum + value, 0) / wearValues.length;
    const roundedWear = Math.round(avgWear);

    document.getElementById('tyre-wear-avg').innerText = `${roundedWear}%`;
    document.getElementById('tyre-wear-bar-fill').style.width = `${Math.min(roundedWear, 100)}%`;

    let status = 'WEAR: STABLE';
    if (roundedWear >= 70) status = 'WEAR: CRITICAL';
    else if (roundedWear >= 45) status = 'WEAR: HIGH';
    else if (roundedWear >= 25) status = 'WEAR: MODERATE';
    document.getElementById('tyre-wear-status').innerText = status;
}

function updateSectorBoxes(sectorTimes, sectorCount, activeSector) {
    const sectorBars = document.getElementById('sector-bars');
    if (!sectorBars || !sectorTimes) return;

    const count = Math.max(1, Math.min(sectorCount || Object.keys(sectorTimes).length || 3, 8));
    if (sectorBars.dataset.count !== String(count)) {
        sectorBars.innerHTML = '';
        for (let i = 1; i <= count; i++) {
            const box = document.createElement('div');
            box.className = 'sector-box';
            box.id = `sector-${i}-box`;
            box.innerHTML = `<span class="sec-title">S${i}</span><span class="sec-val" id="sector-${i}-val">--.---</span>`;
            sectorBars.appendChild(box);
        }
        sectorBars.dataset.count = String(count);
    }

    for (let i = 1; i <= count; i++) {
        const value = sectorTimes[`s${i}`] || 0;
        const valueEl = document.getElementById(`sector-${i}-val`);
        const boxEl = document.getElementById(`sector-${i}-box`);
        valueEl.innerText = value > 0 ? value.toFixed(3) : '--.---';
        boxEl.classList.toggle('sector-active', i === activeSector);
    }
}

// Evaluates telemetry values to trigger Virtual Engineer voiced remarks
function runAIEngineerSafetyAudits(t) {
    // 1. Session flag updates
    if (t.flags && t.flags !== spokenWarnings.lastFlag) {
        if (t.flags === 'yellow') {
            speakAlert(engineerLine('yellowFlag'), "warning");
        } else if (t.flags === 'red') {
            speakAlert(engineerLine('redFlag'), "critical");
        } else if (t.flags === 'green') {
            speakAlert(engineerLine('greenFlag'));
        }
        spokenWarnings.lastFlag = t.flags;
    }

    // 2. Overheating tyres audit (Throttle limit 45s)
    const now = Date.now();
    if (!spokenWarnings.tyreHeatTime || (now - spokenWarnings.tyreHeatTime > 45000)) {
        let overheatingCount = 0;
        const tyreKeys = ['fl', 'fr', 'rl', 'rr'];
        tyreKeys.forEach(k => {
            if (t.tyres && t.tyres[k] && t.tyres[k].temp_surface > 105) overheatingCount++;
        });
        if (overheatingCount >= 2) {
            speakAlert(engineerLine('tyreHeat'), "warning");
            spokenWarnings.tyreHeatTime = now;
        }
    }

    // 3. Tyre wear pit call
    if (t.tyres) {
        const tyreLabels = { fl: 'front left', fr: 'front right', rl: 'rear left', rr: 'rear right' };
        const wornTyre = Object.keys(tyreLabels)
            .map(k => ({ key: k, wear: t.tyres[k]?.wear || 0 }))
            .sort((a, b) => b.wear - a.wear)[0];

        if (
            wornTyre &&
            wornTyre.wear > 50 &&
            (!spokenWarnings.tyreWearPitTime || now - spokenWarnings.tyreWearPitTime > 90000)
        ) {
            speakAlert(engineerLine('tyreWearPit', { tyre: tyreLabels[wornTyre.key] }), "critical");
            spokenWarnings.tyreWearPitTime = now;
            spokenWarnings.tyreWearPitTriggered = true;
        } else if (wornTyre && wornTyre.wear < 40) {
            spokenWarnings.tyreWearPitTriggered = false;
        }
    }

    // 4. Low fuel audit (Trigger once)
    if (t.fuel_remaining !== undefined && t.fuel_capacity > 0) {
        const fuelPct = (t.fuel_remaining / t.fuel_capacity) * 100;
        if (fuelPct < 12 && !spokenWarnings.lowFuelTriggered) {
            speakAlert(engineerLine('lowFuel'), "critical");
            spokenWarnings.lowFuelTriggered = true;
        } else if (fuelPct >= 15) {
            spokenWarnings.lowFuelTriggered = false; // Reset if refuelled
        }
    }

    // 5. Personal best lap audit
    if (t.lap_time_best > 0 && t.lap_time_best !== spokenWarnings.lastBestLap) {
        if (spokenWarnings.lastBestLap !== undefined) {
            speakAlert(engineerLine('bestLap', { lap: formatLapTime(t.lap_time_best) }), "radio");
        }
        spokenWarnings.lastBestLap = t.lap_time_best;
    }
}

// Main WebSocket update controller
function processTelemetryPayload(t) {
    // 1. Session Panel
    document.getElementById('session-game').innerText = (t.game || 'GT7').toUpperCase();
    document.getElementById('session-track').innerText = t.track_name || 'DETECTING...';
    const weatherText = ['not_reported', 'unavailable'].includes(t.weather) ? 'N/A' : (t.weather || 'DRY').toUpperCase();
    document.getElementById('session-weather').innerText = weatherText;
    
    const flagEl = document.getElementById('session-flag');
    flagEl.innerText = (t.flags || 'GREEN').toUpperCase();
    flagEl.className = `value flag-${t.flags || 'none'}`;

    // 2. Cockpit core
    document.getElementById('rpm-value').innerText = Math.round(t.rpm || 0);
    const rpmPct = t.max_rpm > 0 ? (t.rpm / t.max_rpm) * 100 : 0;
    document.getElementById('rpm-bar-fill').style.width = `${Math.min(rpmPct, 100)}%`;

    // Gear indicator: Translate N/R
    let gearText = t.gear;
    if (gearText === 0) gearText = 'N';
    if (gearText === -1) gearText = 'R';
    document.getElementById('gear-val').innerText = gearText;
    document.getElementById('speed-val').innerText = Math.round(t.speed || 0);

    updateShiftLights(t.rpm || 0, t.max_rpm || 0);
    updateSteering(t.steering || 0);

    // 3. Inputs Fills
    document.getElementById('throttle-fill').style.height = `${t.throttle || 0}%`;
    document.getElementById('throttle-val').innerText = `${Math.round(t.throttle || 0)}%`;
    document.getElementById('brake-fill').style.height = `${t.brake || 0}%`;
    document.getElementById('brake-val').innerText = `${Math.round(t.brake || 0)}%`;

    // 4. Tyres & Brakes Heatmaps
    if (t.tyres) {
        updateTyreCard('tyre-fl', 'tyre-fl', t.tyres.fl);
        updateTyreCard('tyre-fr', 'tyre-fr', t.tyres.fr);
        updateTyreCard('tyre-rl', 'tyre-rl', t.tyres.rl);
        updateTyreCard('tyre-rr', 'tyre-rr', t.tyres.rr);
        updateTyreWearSummary(t.tyres);
    }

    // 5. Fuel & Auxiliary
    const fuelVal = t.fuel_remaining || 0;
    document.getElementById('fuel-val').innerText = `${fuelVal.toFixed(1)} L`;
    if (t.fuel_capacity > 0) {
        const fuelBarPct = (fuelVal / t.fuel_capacity) * 100;
        document.getElementById('fuel-bar-fill').style.width = `${Math.min(fuelBarPct, 100)}%`;
    }
    if (t.fuel_laps_remaining > 0) {
        document.getElementById('fuel-laps-est').innerText = `EST. LAPS: ${t.fuel_laps_remaining.toFixed(1)}`;
    } else {
        document.getElementById('fuel-laps-est').innerText = `EST. LAPS: --`;
    }

    // Enable/disable ERS for F1 games
    const ersPanel = document.getElementById('ers-panel');
    if (t.game === 'f1') {
        ersPanel.style.display = 'block';
        document.getElementById('ers-val').innerText = `${Math.round(t.ers_stored || 0)}%`;
        document.getElementById('ers-bar-fill').style.width = `${t.ers_stored || 0}%`;
        document.getElementById('drs-status').innerText = t.drs_active ? 'DRS: ENABLED (ON)' : 'DRS: OFF';
    } else {
        ersPanel.style.display = 'none';
    }

    // 6. Timing Splits & Deltas
    document.getElementById('lap-current').innerText = t.lap_current || 0;
    document.getElementById('lap-time-cur').innerText = formatLapTime(t.lap_time_current);
    document.getElementById('lap-time-last').innerText = formatLapTime(t.lap_time_last);
    document.getElementById('lap-time-best').innerText = formatLapTime(t.lap_time_best);

    // Delta visual coloring
    const deltaEl = document.getElementById('delta-screen');
    const deltaValEl = document.getElementById('delta-val');
    const deltaValue = t.lap_delta || 0;
    
    deltaValEl.innerText = (deltaValue >= 0 ? '+' : '') + deltaValue.toFixed(3);
    deltaEl.className = 'delta-display';
    
    if (deltaValue < 0) {
        deltaEl.classList.add('delta-negative');
    } else if (deltaValue > 0) {
        deltaEl.classList.add('delta-positive');
    } else {
        deltaEl.classList.add('delta-neutral');
    }

    // Sector boxes
    if (t.sector_times) {
        updateSectorBoxes(t.sector_times, t.sector_count, t.sector);
    }

    // 7. Live Charts Feed (4Hz throttle rate for chart data plotting)
    if (telemetryChart) {
        // Shift data values
        const datasets = telemetryChart.data.datasets;
        
        datasets[0].data.shift();
        datasets[0].data.push(t.speed || 0);

        datasets[1].data.shift();
        datasets[1].data.push(t.rpm || 0);

        datasets[2].data.shift();
        datasets[2].data.push(t.throttle || 0);

        datasets[3].data.shift();
        datasets[3].data.push(t.brake || 0);

        // Adjust chart RPM dynamic redline limits
        if (t.max_rpm > 0 && telemetryChart.options.scales.y1.max !== t.max_rpm) {
            telemetryChart.options.scales.y1.max = t.max_rpm;
        }

        telemetryChart.update('none'); // Update fast with no animation lag
    }

    // 8. Safety auditory check
    runAIEngineerSafetyAudits(t);
    recordTelemetryHistory(t);
}

// Connect / Disconnect button flow


// --- Track Maps and Constants ---
const TRACK_MAP_GT7 = {
    10: "Nürburgring Nordschleife",
    12: "Spa-Francorchamps",
    15: "Suzuka Circuit",
    25: "Brands Hatch",
    30: "Mount Panorama",
    40: "Red Bull Ring",
    50: "Monza",
    60: "Circuit de la Sarthe",
    70: "Laguna Seca",
    80: "Deep Forest Raceway",
    90: "Trial Mountain",
    100: "High Speed Ring",
    4: "Daytona Tri-Oval",
    11: "High Speed Ring",
    16: "Fuji International Speedway",
    41: "WeatherTech Raceway Laguna Seca",
    51: "Deep Forest Raceway",
    95: "Nurburgring Nordschleife",
    116: "Mount Panorama Motor Racing Circuit",
    119: "Brands Hatch Grand Prix Circuit",
    348: "Nurburgring 24h",
    349: "Nurburgring GP"
};

const TRACK_MAP_F1 = {
    0: "Melbourne",
    2: "Shanghai",
    3: "Sakhir (Bahrain)",
    4: "Catalunya",
    5: "Monaco",
    6: "Montreal",
    7: "Silverstone",
    9: "Hungaroring",
    10: "Spa",
    11: "Monza",
    12: "Singapore",
    13: "Suzuka",
    14: "Abu Dhabi",
    15: "Texas",
    16: "Brazil",
    17: "Austria",
    19: "Mexico City",
    20: "Baku (Azerbaijan)",
    26: "Zandvoort",
    27: "Imola",
    29: "Jeddah",
    30: "Miami",
    31: "Las Vegas",
    32: "Losail",
    39: "Silverstone (Reverse)",
    40: "Austria (Reverse)",
    41: "Zandvoort (Reverse)"
};

const F1_WEATHER_MAP = {
    0: "clear",
    1: "light_cloud",
    2: "overcast",
    3: "light_rain",
    4: "heavy_rain",
    5: "storm"
};

// Embedded GT7 Track Bounds for position-based track detection
const TRACK_BOUNDS = [{"track": 847, "min_x": -890.281005859375, "min_y": -471.3713684082031, "max_x": -373.0901794433594, "max_y": 581.9259643554688}, {"track": 853, "min_x": -892.7725219726562, "min_y": -471.86175537109375, "max_x": -368.55755615234375, "max_y": 587.4592895507812}, {"track": 11, "min_x": -817.0384521484375, "min_y": -391.3609924316406, "max_x": 738.6958618164062, "max_y": 537.5722045898438}, {"track": 1069, "min_x": -820.3143310546875, "min_y": -391.3370666503906, "max_x": 737.4949951171875, "max_y": 540.3997802734375}, {"track": 356, "min_x": -709.1983642578125, "min_y": -269.86151123046875, "max_x": 607.2481689453125, "max_y": 372.1795654296875}, {"track": 449, "min_x": -709.8977661132812, "min_y": -270.2832336425781, "max_x": 608.4602661132812, "max_y": 372.1741027832031}, {"track": 820, "min_x": -710.9044799804688, "min_y": 12.050761222839355, "max_x": 505.1517639160156, "max_y": 372.1817932128906}, {"track": 822, "min_x": -714.1160888671875, "min_y": 7.226381778717041, "max_x": 506.1298828125, "max_y": 372.17864990234375}, {"track": 819, "min_x": -712.4441528320312, "min_y": -38.178157806396484, "max_x": 505.4984436035156, "max_y": 372.1798095703125}, {"track": 823, "min_x": -709.9923706054688, "min_y": -35.98418426513672, "max_x": 505.1495056152344, "max_y": 372.175537109375}, {"track": 471, "min_x": -326.2855224609375, "min_y": -193.04832458496094, "max_x": 202.80813598632812, "max_y": 193.64749145507812}, {"track": 4, "min_x": -599.60302734375, "min_y": -709.31103515625, "max_x": 601.8079833984375, "max_y": 711.7627563476562}, {"track": 1163, "min_x": -603.1243286132812, "min_y": -708.2428588867188, "max_x": 598.2146606445312, "max_y": 715.4874267578125}, {"track": 365, "min_x": -754.0962524414062, "min_y": -377.3533020019531, "max_x": 857.0406494140625, "max_y": 504.2405090332031}, {"track": 602, "min_x": -758.9012451171875, "min_y": -382.64996337890625, "max_x": 861.8991088867188, "max_y": 510.7942199707031}, {"track": 793, "min_x": -359.6064758300781, "min_y": -275.2018127441406, "max_x": 315.3549499511719, "max_y": 350.99456787109375}, {"track": 791, "min_x": -366.67364501953125, "min_y": -276.5379638671875, "max_x": 318.007080078125, "max_y": 350.53936767578125}, {"track": 795, "min_x": -125.46360778808594, "min_y": -292.6767272949219, "max_x": 856.1309814453125, "max_y": 329.30462646484375}, {"track": 790, "min_x": 265.64190673828125, "min_y": -289.3935546875, "max_x": 861.814453125, "max_y": 336.63055419921875}, {"track": 792, "min_x": -754.343017578125, "min_y": -382.62188720703125, "max_x": -316.46929931640625, "max_y": 504.5417175292969}, {"track": 794, "min_x": -758.4981079101562, "min_y": -381.9871826171875, "max_x": -320.2904052734375, "max_y": 510.6794128417969}, {"track": 1226, "min_x": -370.7461242675781, "min_y": -287.8459167480469, "max_x": 856.692626953125, "max_y": 356.88909912109375}, {"track": 1231, "min_x": -368.9685363769531, "min_y": -288.3043212890625, "max_x": 860.666259765625, "max_y": 353.09039306640625}, {"track": 1232, "min_x": -753.540283203125, "min_y": -376.35504150390625, "max_x": 314.59954833984375, "max_y": 504.29296875}, {"track": 1233, "min_x": -755.3646850585938, "min_y": -382.2472229003906, "max_x": 317.22576904296875, "max_y": 507.53851318359375}, {"track": 470, "min_x": -398.91473388671875, "min_y": -407.4804382324219, "max_x": 856.4234008789062, "max_y": 386.926513671875}, {"track": 846, "min_x": -74.83902740478516, "min_y": -51.26125717163086, "max_x": 852.5809326171875, "max_y": 380.7142028808594}, {"track": 51, "min_x": -473.6750183105469, "min_y": -265.9775085449219, "max_x": 865.086669921875, "max_y": 211.11570739746094}, {"track": 747, "min_x": -477.49371337890625, "min_y": -265.9591064453125, "max_x": 865.8409423828125, "max_y": 210.931396484375}, {"track": 362, "min_x": -461.7701416015625, "min_y": -995.2307739257812, "max_x": 1018.85693359375, "max_y": 867.3760986328125}, {"track": 915, "min_x": -449.46929931640625, "min_y": -977.4636840820312, "max_x": 1018.859130859375, "max_y": 1180.6639404296875}, {"track": 361, "min_x": -1483.53466796875, "min_y": -882.4863891601562, "max_x": 1809.2567138671875, "max_y": 509.41351318359375}, {"track": 451, "min_x": -1480.087158203125, "min_y": -327.9771728515625, "max_x": 1788.6976318359375, "max_y": 499.287353515625}, {"track": 351, "min_x": -639.2418823242188, "min_y": -511.9261169433594, "max_x": 726.3670043945312, "max_y": 843.3070678710938}, {"track": 450, "min_x": -639.0285034179688, "min_y": -501.0704650878906, "max_x": 720.0598754882812, "max_y": 831.6214599609375}, {"track": 1024, "min_x": -963.1570434570312, "min_y": -398.3871154785156, "max_x": 949.6326904296875, "max_y": 367.70257568359375}, {"track": 1034, "min_x": -962.16357421875, "min_y": -400.3914794921875, "max_x": 946.4959106445312, "max_y": 370.7217712402344}, {"track": 41, "min_x": -383.3492431640625, "min_y": -487.629638671875, "max_x": 404.3892822265625, "max_y": 488.69366455078125}, {"track": 376, "min_x": -906.6212158203125, "min_y": -227.25120544433594, "max_x": 404.35540771484375, "max_y": 488.04132080078125}, {"track": 440, "min_x": -653.81103515625, "min_y": 425.6597900390625, "max_x": 51.395050048828125, "max_y": 989.1498413085938}, {"track": 613, "min_x": -906.8475952148438, "min_y": -228.28062438964844, "max_x": 407.43402099609375, "max_y": 488.6058349609375}, {"track": 776, "min_x": -907.4124145507812, "min_y": -227.48065185546875, "max_x": 404.572998046875, "max_y": 997.241943359375}, {"track": 777, "min_x": -913.9970092773438, "min_y": -230.0376739501953, "max_x": 401.6493835449219, "max_y": 988.3462524414062}, {"track": 358, "min_x": -125.5652084350586, "min_y": -954.2604370117188, "max_x": 1030.637451171875, "max_y": 656.7340698242188}, {"track": 439, "min_x": -123.5225830078125, "min_y": -952.3550415039062, "max_x": 1029.809814453125, "max_y": 651.79833984375}, {"track": 1224, "min_x": -123.59052276611328, "min_y": -704.0587768554688, "max_x": 761.4503173828125, "max_y": 649.303955078125}, {"track": 1225, "min_x": -118.5765380859375, "min_y": -63.640560150146484, "max_x": 373.9945068359375, "max_y": 654.4452514648438}, {"track": 372, "min_x": -600.3905639648438, "min_y": -582.6788330078125, "max_x": 352.6335754394531, "max_y": 197.20022583007812}, {"track": 600, "min_x": -597.9296875, "min_y": -604.4385986328125, "max_x": 350.9355163574219, "max_y": 193.063232421875}, {"track": 16, "min_x": -634.9344482421875, "min_y": -645.0808715820312, "max_x": 615.2125244140625, "max_y": 634.3399047851562}, {"track": 837, "min_x": -640.2396850585938, "min_y": -646.14306640625, "max_x": 615.6531372070312, "max_y": 631.3204345703125}, {"track": 921, "min_x": -640.372314453125, "min_y": -797.428955078125, "max_x": 620.7135009765625, "max_y": 813.9354858398438}, {"track": 922, "min_x": -640.8040161132812, "min_y": -799.6031494140625, "max_x": 626.0045166015625, "max_y": 808.9707641601562}, {"track": 841, "min_x": -440.2879943847656, "min_y": -517.4181518554688, "max_x": 96.00666046142578, "max_y": 812.0974731445312}, {"track": 839, "min_x": -437.0045471191406, "min_y": -518.599609375, "max_x": 93.47366333007812, "max_y": 809.7233276367188}, {"track": 838, "min_x": -441.4754943847656, "min_y": -187.8953857421875, "max_x": 178.35133361816406, "max_y": 813.0775146484375}, {"track": 843, "min_x": -438.6310119628906, "min_y": -191.02964782714844, "max_x": 181.0736846923828, "max_y": 808.8318481445312}, {"track": 453, "min_x": -271.52325439453125, "min_y": -724.08056640625, "max_x": 144.531494140625, "max_y": 672.005126953125}, {"track": 599, "min_x": -263.0734558105469, "min_y": -728.1431884765625, "max_x": 145.7529296875, "max_y": 672.9078979492188}, {"track": 123, "min_x": 206.8373565673828, "min_y": -732.6707153320312, "max_x": 694.9609375, "max_y": 54.856056213378906}, {"track": 598, "min_x": 205.8182373046875, "min_y": -734.4424438476562, "max_x": 701.16552734375, "max_y": 70.72554779052734}, {"track": 122, "min_x": -650.592041015625, "min_y": -137.3792266845703, "max_x": 718.1531372070312, "max_y": 660.7261962890625}, {"track": 125, "min_x": -185.01075744628906, "min_y": -530.8831787109375, "max_x": 189.28453063964844, "max_y": -218.5666961669922}, {"track": 452, "min_x": -184.8609161376953, "min_y": -537.3515014648438, "max_x": 170.4611053466797, "max_y": -217.6552276611328}, {"track": 1240, "min_x": -365.4161682128906, "min_y": -876.1976318359375, "max_x": 365.8918151855469, "max_y": 878.7100830078125}, {"track": 1264, "min_x": -365.54595947265625, "min_y": -876.0692749023438, "max_x": 361.8284606933594, "max_y": 677.755615234375}, {"track": 469, "min_x": -552.0929565429688, "min_y": -1264.98388671875, "max_x": 730.7159423828125, "max_y": 906.1421508789062}, {"track": 742, "min_x": -540.0213012695312, "min_y": -1264.9573974609375, "max_x": 730.6227416992188, "max_y": 904.724853515625}, {"track": 9999, "min_x": -474.7970275878906, "min_y": -812.8882446289062, "max_x": 388.6869201660156, "max_y": 816.0532836914062}, {"track": 874, "min_x": -587.7329711914062, "min_y": -500.2098388671875, "max_x": 372.27459716796875, "max_y": 654.5736083984375}, {"track": 1249, "min_x": -593.3724975585938, "min_y": -514.4763793945312, "max_x": 372.30377197265625, "max_y": 655.4268798828125}, {"track": 1250, "min_x": -270.78118896484375, "min_y": -502.07110595703125, "max_x": 371.9106140136719, "max_y": 452.2666015625}, {"track": 1265, "min_x": -27.825218200683594, "min_y": -518.5205078125, "max_x": 216.3842010498047, "max_y": -274.3410339355469}, {"track": 896, "min_x": -751.4319458007812, "min_y": -241.2224578857422, "max_x": 487.9460754394531, "max_y": 634.7183837890625}, {"track": 898, "min_x": -371.3504333496094, "min_y": -195.03192138671875, "max_x": 487.7861022949219, "max_y": 634.760009765625}, {"track": 119, "min_x": -417.1120910644531, "min_y": -464.25146484375, "max_x": 415.276611328125, "max_y": 468.90576171875}, {"track": 346, "min_x": -419.4136047363281, "min_y": -465.5007629394531, "max_x": 158.68885803222656, "max_y": -57.84276580810547}, {"track": 825, "min_x": -953.5664672851562, "min_y": -1324.811767578125, "max_x": 1059.4886474609375, "max_y": 927.22900390625}, {"track": 826, "min_x": -937.5187377929688, "min_y": -1322.3277587890625, "max_x": 1055.15771484375, "max_y": 923.3383178710938}, {"track": 827, "min_x": -935.6709594726562, "min_y": -965.6345825195312, "max_x": 712.5621337890625, "max_y": 1211.6724853515625}, {"track": 828, "min_x": -937.4682006835938, "min_y": -964.236572265625, "max_x": 709.0703125, "max_y": 1209.731689453125}, {"track": 829, "min_x": -1507.2757568359375, "min_y": -1361.7156982421875, "max_x": 806.042724609375, "max_y": 1211.2144775390625}, {"track": 830, "min_x": -1511.0152587890625, "min_y": -1361.39794921875, "max_x": 801.536376953125, "max_y": 1209.9864501953125}, {"track": 10, "min_x": -980.5219116210938, "min_y": -526.0859375, "max_x": 980.1845703125, "max_y": 517.2938842773438}, {"track": 442, "min_x": 321.867919921875, "min_y": -268.32855224609375, "max_x": 979.90869140625, "max_y": 517.2817993164062}, {"track": 152, "min_x": -420.75933837890625, "min_y": -521.3978271484375, "max_x": 231.6879119873047, "max_y": 516.7240600585938}, {"track": 154, "min_x": -691.74755859375, "min_y": -587.3276977539062, "max_x": 428.725830078125, "max_y": 529.9686889648438}, {"track": 353, "min_x": -773.0867309570312, "min_y": -862.09814453125, "max_x": 654.6434936523438, "max_y": 655.7799072265625}, {"track": 1260, "min_x": -5262.9599609375, "min_y": -5263.24658203125, "max_x": 5262.751953125, "max_y": 5263.23876953125}, {"track": 95, "min_x": -3046.011474609375, "min_y": -3170.082763671875, "max_x": 3041.221923828125, "max_y": 1680.3895263671875}, {"track": 348, "min_x": -3046.18310546875, "min_y": -3170.390869140625, "max_x": 3040.780517578125, "max_y": 3162.680908203125}, {"track": 349, "min_x": -2039.7843017578125, "min_y": 1639.9876708984375, "max_x": -914.498046875, "max_y": 3167.545166015625}, {"track": 116, "min_x": -1297.1163330078125, "min_y": -1077.74755859375, "max_x": 624.2740478515625, "max_y": 2071.643798828125}, {"track": 462, "min_x": -766.2285766601562, "min_y": -937.8657836914062, "max_x": 505.0465087890625, "max_y": 1124.3341064453125}, {"track": 1269, "min_x": -769.1748657226562, "min_y": -934.3897705078125, "max_x": 503.9006652832031, "max_y": 1121.0213623046875}, {"track": 454, "min_x": -1354.8602294921875, "min_y": -2574.691650390625, "max_x": 1373.4300537109375, "max_y": 2810.840576171875}, {"track": 854, "min_x": -1353.208984375, "min_y": -2574.607666015625, "max_x": 1369.7281494140625, "max_y": 2808.155029296875}, {"track": 354, "min_x": -181.66070556640625, "min_y": -94.27738952636719, "max_x": 180.81382751464844, "max_y": 99.42002868652344}, {"track": 357, "min_x": -334.5724792480469, "min_y": -192.33396911621094, "max_x": 268.5730285644531, "max_y": 205.98768615722656}, {"track": 444, "min_x": -329.0794677734375, "min_y": -192.56973266601562, "max_x": 268.8076171875, "max_y": 205.97988891601562}, {"track": 363, "min_x": -471.0982666015625, "min_y": -856.7515258789062, "max_x": 911.2103271484375, "max_y": 734.7135009765625}, {"track": 601, "min_x": -473.17254638671875, "min_y": -857.8417358398438, "max_x": 918.973876953125, "max_y": 735.4021606445312}, {"track": 347, "min_x": -3043.234619140625, "min_y": -3170.44921875, "max_x": 3044.92138671875, "max_y": 1678.68212890625}];

// --- Helper Functions ---

// Decode base64 to Uint8Array
function base64ToUint8Array(base64) {
    try {
        const binaryString = atob(base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes;
    } catch (e) {
        console.error("Base64 decoding failed:", e);
        return new Uint8Array(0);
    }
}

// Calculate Bounding Box Intersection over Union
function calculateIoU(a, b) {
    const left = Math.max(a.min_x, b.min_x);
    const right = Math.min(a.max_x, b.max_x);
    const top = Math.max(a.min_y, b.min_y);
    const bottom = Math.min(a.max_y, b.max_y);
    if (left >= right || top >= bottom) return 0.0;

    const intersection = (right - left) * (bottom - top);
    const a_area = (a.max_x - a.min_x) * (a.max_y - a.min_y);
    const b_area = (b.max_x - b.min_x) * (b.max_y - b.min_y);
    const union = a_area + b_area - intersection;
    return union > 0 ? (intersection / union) : 0.0;
}

// --- Streamer Classes ---

// 1. Fully offline, in-browser Telemetry Simulator (25Hz update rate)
class LocalMockStreamer {
    constructor(game) {
        this.game = game;
        this.intervalId = null;
        this.running = false;
    }

    start() {
        this.running = true;
        logToTerminal(`Starting in-browser ${this.game.toUpperCase()} mock telemetry...`, "system-msg");

        let speed = 0.0;
        let rpm = 1000.0;
        let gear = 1;
        let throttle = 100.0;
        let brake = 0.0;
        let steer = 0.0;
        let lap = 1;
        let lapStart = Date.now();
        let bestLap = 0.0;
        let lastLap = 0.0;
        let fuel = 45.0;
        const fuelCapacity = 50.0;
        let weather = "dry";
        let flag = "green";
        let tyreWear = 0.0;

        const maxRpm = this.game === "f1" ? 13500.0 : 9000.0;
        const redline = maxRpm * 0.96;
        const mockSectorSplits = {
            gt7: [10.8, 13.2, 11.6, 14.4, 10.0],
            f1: [19.2, 21.1, 19.7]
        };

        const mockSectorCount = this.game === "gt7" ? 5 : 3;
        const sectorSplits = mockSectorSplits[this.game] || mockSectorSplits.f1;
        const sectorThresholds = [];
        let runningSectorTime = 0.0;
        for (const splitTime of sectorSplits) {
            runningSectorTime += splitTime;
            sectorThresholds.push(runningSectorTime);
        }

        const telemetryCache = {
            game: this.game,
            speed: 0.0,
            rpm: 0.0,
            max_rpm: maxRpm,
            gear: 0,
            throttle: 0.0,
            brake: 0.0,
            clutch: 0.0,
            steering: 0.0,
            lap_current: 0,
            lap_time_current: 0.0,
            lap_time_last: 0.0,
            lap_time_best: 0.0,
            lap_delta: 0.0,
            sector: 1,
            sector_count: mockSectorCount,
            sector_times: {},
            tyres: {
                fl: { temp_surface: 0.0, temp_inner: 0.0, pressure: 0.0, wear: 0.0 },
                fr: { temp_surface: 0.0, temp_inner: 0.0, pressure: 0.0, wear: 0.0 },
                rl: { temp_surface: 0.0, temp_inner: 0.0, pressure: 0.0, wear: 0.0 },
                rr: { temp_surface: 0.0, temp_inner: 0.0, pressure: 0.0, wear: 0.0 }
            },
            fuel_remaining: 0.0,
            fuel_capacity: 0.0,
            fuel_laps_remaining: 0.0,
            ers_stored: 0.0,
            drs_active: false,
            flags: "none",
            track_name: this.game === "f1" ? "SPA-FRANCORCHAMPS" : "NÜRBURGRING",
            track_id: this.game === "f1" ? null : 95,
            track_detection: "detected",
            weather: "dry"
        };

        for (let i = 1; i <= mockSectorCount; i++) {
            telemetryCache.sector_times[`s${i}`] = 0.0;
        }

        this.intervalId = setInterval(() => {
            if (!this.running) return;

            const now = Date.now();
            const elapsed = (now - lapStart) / 1000.0;
            const cycle = elapsed % 60.0;

            // Acceleration phase (0 to 18s)
            if (cycle < 18.0) {
                throttle = 100.0;
                brake = 0.0;
                steer = 0.0;

                rpm += 800.0 * (1.0 / gear);
                if (rpm >= redline) {
                    if (gear < 8) {
                        gear += 1;
                        rpm = maxRpm * 0.65;
                    } else {
                        rpm = redline;
                    }
                }

                speed += 12.0 * (1.0 / gear);
                const maxSpeed = this.game === "f1" ? 340.0 : 280.0;
                if (speed > maxSpeed) speed = maxSpeed;
            }
            // Braking phase (18 to 24s)
            else if (cycle < 24.0) {
                throttle = 0.0;
                brake = 85.0;
                steer = cycle < 21.0 ? -45.0 : 45.0;

                speed -= 40.0 / 25.0 * 10.0;
                if (speed < 60.0) speed = 60.0;

                rpm = speed * 40.0 * (1.0 / gear);
                if (rpm < maxRpm * 0.45 && gear > 2) {
                    gear -= 1;
                    rpm = speed * 40.0 * (1.0 / gear);
                }
            }
            // Mid corner acceleration (24 to 32s)
            else if (cycle < 32.0) {
                throttle = 60.0;
                brake = 0.0;
                steer = 15.0;

                speed += 6.0 / 25.0 * 10.0;
                rpm += 200.0 * (1.0 / gear);
                if (rpm >= redline && gear < 8) {
                    gear += 1;
                    rpm = maxRpm * 0.65;
                }
            }
            // High speed straight (32 to 50s)
            else if (cycle < 50.0) {
                throttle = 100.0;
                brake = 0.0;
                steer = 0.0;

                rpm += 600.0 * (1.0 / gear);
                if (rpm >= redline && gear < 8) {
                    gear += 1;
                    rpm = maxRpm * 0.65;
                }
                speed += 15.0 * (1.0 / gear);
            }
            // Final chicane (50 to 58s)
            else if (cycle < 58.0) {
                throttle = 10.0;
                brake = 50.0;
                steer = -30.0;
                speed -= 25.0 / 25.0 * 10.0;
                if (speed < 80.0) speed = 80.0;
                gear = 3;
                rpm = speed * 35.0;
            }
            // Final straight (58 to 60s)
            else {
                throttle = 100.0;
                brake = 0.0;
                steer = 0.0;
                speed += 20.0 / 25.0 * 10.0;
                rpm += 1000.0;
            }

            fuel -= 0.005;
            if (fuel < 0.0) fuel = 0.0;
            tyreWear = Math.min(100.0, tyreWear + 0.0025);

            const tyreBase = 78.0;
            const heatFactor = (Math.abs(steer) * 0.4) + (brake * 0.15);
            const flTemp = tyreBase + heatFactor + (speed * 0.02);
            const frTemp = tyreBase + (heatFactor * 0.9) + (speed * 0.02);
            const rlTemp = tyreBase + (heatFactor * 0.4) + (speed * 0.015);
            const rrTemp = tyreBase + (heatFactor * 0.4) + (speed * 0.015);

            let currentMockSector = mockSectorCount;
            for (let index = 0; index < sectorThresholds.length; index++) {
                if (cycle < sectorThresholds[index]) {
                    currentMockSector = index + 1;
                    break;
                }
            }

            if (elapsed >= 60.0) {
                lastLap = elapsed;
                if (bestLap === 0.0 || lastLap < bestLap) {
                    bestLap = lastLap;
                }
                lap += 1;
                lapStart = Date.now();
            }

            if (cycle > 35.0 && cycle < 42.0) {
                flag = "yellow";
            } else {
                flag = "green";
            }

            const sectorTimes = {};
            for (let i = 1; i <= mockSectorCount; i++) {
                sectorTimes[`s${i}`] = cycle >= sectorThresholds[i - 1] ? sectorSplits[i - 1] : 0.0;
            }

            Object.assign(telemetryCache, {
                game: this.game,
                speed: speed,
                rpm: rpm,
                max_rpm: maxRpm,
                gear: gear,
                throttle: throttle,
                brake: brake,
                clutch: 0.0,
                steering: steer,
                lap_current: lap,
                lap_time_current: elapsed,
                lap_time_last: lastLap,
                lap_time_best: bestLap,
                lap_delta: bestLap > 0 ? (elapsed - bestLap) : 0.0,
                sector: currentMockSector,
                sector_count: mockSectorCount,
                sector_times: sectorTimes,
                tyres: {
                    fl: { temp_surface: flTemp, temp_inner: flTemp - 4, pressure: 23.4, wear: tyreWear + 1.2 },
                    fr: { temp_surface: frTemp, temp_inner: frTemp - 4, pressure: 23.4, wear: tyreWear + 1.0 },
                    rl: { temp_surface: rlTemp, temp_inner: rlTemp - 3, pressure: 22.8, wear: tyreWear + 0.7 },
                    rr: { temp_surface: rrTemp, temp_inner: rrTemp - 3, pressure: 22.8, wear: tyreWear + 0.8 }
                },
                fuel_remaining: fuel,
                fuel_capacity: fuelCapacity,
                fuel_laps_remaining: fuel / 1.15,
                ers_stored: this.game === "f1" ? (100.0 - (cycle * 1.2)) : 0.0,
                drs_active: this.game === "f1" && cycle > 32.0 && cycle < 35.0,
                flags: flag,
                track_name: this.game === "f1" ? "SPA-FRANCORCHAMPS" : "NÜRBURGRING",
                track_id: this.game === "f1" ? null : 95,
                track_detection: "detected",
                weather: weather
            });

            processTelemetryPayload(telemetryCache);
        }, 40);
    }

    stop() {
        this.running = false;
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        logToTerminal("Mock telemetry stopped.", "system-msg");
    }
}

// 2. Direct On-Device UDP Streamer for F1 25 / Legacy Codemasters UDP feed
class LocalF1Streamer {
    constructor() {
        this.socketId = null;
        this.listenerHandle = null;
        this.running = false;
    }

    async start() {
        this.running = true;
        logToTerminal("Binding local UDP port 20777 for F1 telemetry...", "system-msg");

        const UdpSocket = window.Capacitor.Plugins.UdpSocket;
        try {
            const createResult = await UdpSocket.create({});
            this.socketId = createResult.socketId;

            await UdpSocket.bind({
                socketId: this.socketId,
                address: '0.0.0.0',
                port: 20777
            });
            logToTerminal("F1 UDP Receiver bound. Listening for packets...", "system-msg");

            const telemetryCache = {
                game: "f1",
                speed: 0.0,
                rpm: 0.0,
                max_rpm: 13500.0,
                gear: 0,
                throttle: 0.0,
                brake: 0.0,
                clutch: 0.0,
                steering: 0.0,
                drs_active: false,
                sector_count: 3,
                tyres: {
                    fl: { temp_surface: 0.0, temp_inner: 0.0, pressure: 0.0, wear: 0.0 },
                    fr: { temp_surface: 0.0, temp_inner: 0.0, pressure: 0.0, wear: 0.0 },
                    rl: { temp_surface: 0.0, temp_inner: 0.0, pressure: 0.0, wear: 0.0 },
                    rr: { temp_surface: 0.0, temp_inner: 0.0, pressure: 0.0, wear: 0.0 }
                },
                lap_current: 0,
                lap_time_current: 0.0,
                lap_time_last: 0.0,
                sector: 1,
                sector_times: { s1: 0.0, s2: 0.0, s3: 0.0 },
                weather: "dry",
                temp_track: 30.0,
                temp_air: 25.0,
                track_name: "DETECTING...",
                flags: "none"
            };

            this.listenerHandle = await UdpSocket.addListener('receive', (event) => {
                if (event.socketId !== this.socketId) return;
                try {
                    const bytes = base64ToUint8Array(event.buffer);
                    if (bytes.length < 29) return;

                    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

                    // Unpack F1 UDP Header
                    const packetId = view.getUint8(6);
                    const playerCarIndex = view.getUint8(27);

                    // Packet 6: Car Telemetry
                    if (packetId === 6) {
                        const offset = 29 + playerCarIndex * 60;
                        if (bytes.length >= offset + 60) {
                            const speed = view.getUint16(offset, true);
                            const throttle = view.getFloat32(offset + 2, true);
                            const steer = view.getFloat32(offset + 6, true);
                            const brake = view.getFloat32(offset + 10, true);
                            const clutch = view.getUint8(offset + 14);
                            const gear = view.getInt8(offset + 15);
                            const rpm = view.getUint16(offset + 16, true);
                            const drs = view.getUint8(offset + 18);

                            telemetryCache.speed = speed;
                            telemetryCache.rpm = rpm;
                            telemetryCache.gear = gear;
                            telemetryCache.throttle = throttle * 100.0;
                            telemetryCache.brake = brake * 100.0;
                            telemetryCache.clutch = clutch;
                            telemetryCache.steering = steer * 100.0;
                            telemetryCache.drs_active = drs === 1;

                            telemetryCache.tyres.fl.temp_surface = view.getUint8(offset + 30);
                            telemetryCache.tyres.fr.temp_surface = view.getUint8(offset + 31);
                            telemetryCache.tyres.rl.temp_surface = view.getUint8(offset + 32);
                            telemetryCache.tyres.rr.temp_surface = view.getUint8(offset + 33);

                            telemetryCache.tyres.fl.temp_inner = view.getUint8(offset + 34);
                            telemetryCache.tyres.fr.temp_inner = view.getUint8(offset + 35);
                            telemetryCache.tyres.rl.temp_inner = view.getUint8(offset + 36);
                            telemetryCache.tyres.rr.temp_inner = view.getUint8(offset + 37);

                            telemetryCache.tyres.fl.pressure = view.getFloat32(offset + 40, true);
                            telemetryCache.tyres.fr.pressure = view.getFloat32(offset + 44, true);
                            telemetryCache.tyres.rl.pressure = view.getFloat32(offset + 48, true);
                            telemetryCache.tyres.rr.pressure = view.getFloat32(offset + 52, true);

                            processTelemetryPayload(telemetryCache);
                        }
                    }
                    // Packet 10: Car Damage (tyre wear)
                    else if (packetId === 10) {
                        const offset = 29 + playerCarIndex * 42;
                        if (bytes.length >= offset + 16) {
                            telemetryCache.tyres.rl.wear = view.getFloat32(offset, true);
                            telemetryCache.tyres.rr.wear = view.getFloat32(offset + 4, true);
                            telemetryCache.tyres.fl.wear = view.getFloat32(offset + 8, true);
                            telemetryCache.tyres.fr.wear = view.getFloat32(offset + 12, true);
                            processTelemetryPayload(telemetryCache);
                        }
                    }
                    // Packet 2: Lap Data
                    else if (packetId === 2) {
                        const offset = 29 + playerCarIndex * 51;
                        if (bytes.length >= offset + 51) {
                            const last_lap_ms = view.getUint32(offset, true);
                            const cur_lap_ms = view.getUint32(offset + 4, true);
                            const s1_ms = view.getUint16(offset + 8, true);
                            const s1_min = view.getUint8(offset + 10);
                            const s2_ms = view.getUint16(offset + 11, true);
                            const s2_min = view.getUint8(offset + 13);
                            const cur_lap = view.getUint8(offset + 33);
                            const sector = view.getUint8(offset + 36);

                            const s1_sec = s1_ms > 0 ? (s1_min * 60 + s1_ms / 1000.0) : 0.0;
                            const s2_sec = s2_ms > 0 ? (s2_min * 60 + s2_ms / 1000.0) : 0.0;

                            telemetryCache.lap_current = cur_lap;
                            telemetryCache.lap_time_current = cur_lap_ms / 1000.0;
                            telemetryCache.lap_time_last = last_lap_ms / 1000.0;
                            telemetryCache.sector = sector + 1;
                            telemetryCache.sector_times.s1 = s1_sec;
                            telemetryCache.sector_times.s2 = s2_sec;
                            processTelemetryPayload(telemetryCache);
                        }
                    }
                    // Packet 1: Session Data
                    else if (packetId === 1) {
                        if (bytes.length >= 37) {
                            const weatherVal = view.getUint8(29);
                            const track_temp = view.getInt8(30);
                            const air_temp = view.getInt8(31);
                            const track_id = view.getInt8(36);

                            const weather_str = F1_WEATHER_MAP[weatherVal] || "unknown";
                            const trackName = TRACK_MAP_F1[track_id] || `F1 CIRCUIT ${track_id}`;

                            telemetryCache.weather = weather_str;
                            telemetryCache.temp_track = track_temp;
                            telemetryCache.temp_air = air_temp;
                            telemetryCache.track_name = trackName;
                            processTelemetryPayload(telemetryCache);
                        }
                    }
                } catch (e) {
                    console.error("F1 receiver error:", e);
                }
            });
        } catch (e) {
            console.error("Failed to start F1 UDP receiver:", e);
            logToTerminal("UDP bind error: " + e.message, "critical");
            this.running = false;
        }
    }

    async stop() {
        this.running = false;
        if (this.listenerHandle) {
            this.listenerHandle.remove();
            this.listenerHandle = null;
        }
        if (this.socketId !== null) {
            const UdpSocket = window.Capacitor.Plugins.UdpSocket;
            try {
                await UdpSocket.close({ socketId: this.socketId });
            } catch (e) {
                console.error("Error closing F1 UDP socket:", e);
            }
            this.socketId = null;
        }
        logToTerminal("F1 telemetry stopped.", "system-msg");
    }
}

// 3. Direct On-Device Decrypted UDP Streamer for Gran Turismo 7
class LocalGT7Streamer {
    constructor(ps5Ip) {
        this.ps5Ip = ps5Ip;
        this.socketId = null;
        this.listenerHandle = null;
        this.heartbeatIntervalId = null;
        this.running = false;

        // State variables
        this.track_name = "DETECTING...";
        this.track_id = null;
        this.track_votes = {};
        this.position_samples = 0;
        this.min_x = Infinity;
        this.min_y = Infinity;
        this.max_x = -Infinity;
        this.max_y = -Infinity;
        this.last_packet_time = null;
        this.last_lap_seen = null;
        this.last_lap_time_ms_seen = null;
        this.gt7_lap_start = Date.now();
        this.sector_count = 3;
        this.completed_sector_times = {};
        this.gt7_lap_distance_m = 0.0;
        this.last_gt7_lap_distance_m = 0.0;
        this.last_gt7_sector_update = null;
        this.gt7_active_sector = 1;
        this.gt7_sector_start_lap_time = 0.0;
        this.tyre_wear = { fl: 0.0, fr: 0.0, rl: 0.0, rr: 0.0 };
    }

    async start() {
        this.running = true;
        logToTerminal(`Connecting to GT7 on PS5 IP: ${this.ps5Ip}...`, "system-msg");

        const UdpSocket = window.Capacitor.Plugins.UdpSocket;
        try {
            const createResult = await UdpSocket.create({});
            this.socketId = createResult.socketId;

            await UdpSocket.bind({
                socketId: this.socketId,
                address: '0.0.0.0',
                port: 33740
            });
            logToTerminal("GT7 UDP socket bound. Initiating handshakes...", "system-msg");

            const sendHeartbeat = async () => {
                if (!this.running || this.socketId === null) return;
                try {
                    // Send tilde "~" heartbeat (ASCII code 126, which is Base64 'fg==')
                    await UdpSocket.send({
                        socketId: this.socketId,
                        address: this.ps5Ip,
                        port: 33739,
                        buffer: 'fg=='
                    });
                } catch (e) {
                    console.error("GT7 heartbeat error:", e);
                }
            };

            await sendHeartbeat();
            this.heartbeatIntervalId = setInterval(sendHeartbeat, 8000);

            const telemetryCache = {
                game: "gt7",
                speed: 0.0,
                rpm: 0.0,
                max_rpm: 10000.0,
                gear: 0,
                throttle: 0.0,
                brake: 0.0,
                clutch: 0.0,
                steering: 0.0,
                lap_current: 0,
                lap_time_current: 0.0,
                lap_time_last: 0.0,
                lap_time_best: 0.0,
                lap_delta: 0.0,
                sector: 1,
                sector_count: 3,
                sector_times: { s1: 0.0, s2: 0.0, s3: 0.0 },
                tyres: {
                    fl: { temp_surface: 0.0, temp_inner: 0.0, pressure: 29.5, wear: 0.0 },
                    fr: { temp_surface: 0.0, temp_inner: 0.0, pressure: 29.5, wear: 0.0 },
                    rl: { temp_surface: 0.0, temp_inner: 0.0, pressure: 30.0, wear: 0.0 },
                    rr: { temp_surface: 0.0, temp_inner: 0.0, pressure: 30.0, wear: 0.0 }
                },
                fuel_remaining: 0.0,
                fuel_capacity: 0.0,
                track_name: "DETECTING...",
                track_id: null,
                track_detection: "pending",
                weather: "unavailable",
                flags: "none"
            };

            this.listenerHandle = await UdpSocket.addListener('receive', (event) => {
                if (event.socketId !== this.socketId) return;
                try {
                    const bytes = base64ToUint8Array(event.buffer);
                    if (bytes.length < 68) return;

                    // Decrypt Salsa20
                    const rawView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
                    const seed = rawView.getUint32(64, true);
                    const iv = seed ^ 0x55FABB4F;

                    const nonce = new Uint8Array(8);
                    nonce[0] = iv & 0xff;
                    nonce[1] = (iv >> 8) & 0xff;
                    nonce[2] = (iv >> 16) & 0xff;
                    nonce[3] = (iv >> 24) & 0xff;
                    nonce[4] = seed & 0xff;
                    nonce[5] = (seed >> 8) & 0xff;
                    nonce[6] = (seed >> 16) & 0xff;
                    nonce[7] = (seed >> 24) & 0xff;

                    const keyStr = "Simulator Interface Packet GT7 v";
                    const keyBytes = new Uint8Array(32);
                    for (let i = 0; i < 32; i++) {
                        keyBytes[i] = keyStr.charCodeAt(i);
                    }

                    const dec = new JSSalsa20(keyBytes, nonce);
                    const decrypted = dec.decrypt(bytes);

                    const headerStr = String.fromCharCode(decrypted[0], decrypted[1], decrypted[2], decrypted[3]);
                    if (headerStr !== "0S7G" && headerStr !== "G6S0") return;

                    const isLittleEndian = (headerStr === "0S7G");
                    const view = new DataView(decrypted.buffer, decrypted.byteOffset + 4, decrypted.byteLength - 4);

                    const pos_x = view.getFloat32(0, isLittleEndian);
                    const pos_y = view.getFloat32(4, isLittleEndian);
                    const pos_z = view.getFloat32(8, isLittleEndian);
                    const engine_rpm = view.getFloat32(56, isLittleEndian);
                    const fuel_level = view.getFloat32(64, isLittleEndian);
                    const fuel_capacity = view.getFloat32(68, isLittleEndian);
                    const speed_mps = view.getFloat32(72, isLittleEndian);
                    const t_fl = view.getFloat32(92, isLittleEndian);
                    const t_fr = view.getFloat32(96, isLittleEndian);
                    const t_rl = view.getFloat32(100, isLittleEndian);
                    const t_rr = view.getFloat32(104, isLittleEndian);
                    const packet_id = view.getInt32(108, isLittleEndian);
                    const lap_current = view.getInt16(112, isLittleEndian);
                    const best_lap_ms = view.getInt32(116, isLittleEndian);
                    const last_lap_ms = view.getInt32(120, isLittleEndian);
                    const max_alert_rpm = view.getInt16(134, isLittleEndian);
                    const flags = view.getInt16(138, isLittleEndian);
                    const bits = view.getUint8(140);
                    const throttle = view.getUint8(141);
                    const brake = view.getUint8(142);
                    const clutch_pedal = view.getFloat32(240, isLittleEndian);
                    const ang_vel_y = view.getFloat32(44, isLittleEndian);

                    const isPaused = (flags & (1 << 1)) !== 0;
                    const isLoading = (flags & (1 << 2)) !== 0;

                    let gearVal = bits & 0xF;
                    if (gearVal === 15) gearVal = -1;

                    const speed = speed_mps * 3.6;
                    const steering = ang_vel_y * 100.0;

                    const trackName = this._inferTrackName(pos_x, pos_z, flags);
                    const trackId = this.track_id;
                    const trackDetection = (trackId !== null || trackName !== "DETECTING...") ? "detected" : "pending";

                    // Sector count based on track
                    let newSectorCount = 3;
                    const lowerName = (trackName || "").toLowerCase();
                    if (trackId === 95 || trackId === 347 || trackId === 348 || lowerName.includes("nordschleife") || lowerName.includes("nurburgring 24h")) {
                        newSectorCount = 5;
                    }
                    this.sector_count = newSectorCount;

                    const tyreTemps = { fl: t_fl, fr: t_fr, rl: t_rl, rr: t_rr };
                    const wear = this._updateTyreWear(speed, brake / 255.0 * 100.0, steering, tyreTemps);

                    const best_lap = best_lap_ms > 0 ? (best_lap_ms / 1000.0) : 0.0;
                    const last_lap = last_lap_ms > 0 ? (last_lap_ms / 1000.0) : 0.0;

                    const { currentLapTime, sector, sectorTimes } = this._updateSectors(
                        lap_current,
                        last_lap_ms,
                        best_lap,
                        last_lap,
                        speed_mps
                    );

                    Object.assign(telemetryCache, {
                        game: "gt7",
                        speed: speed,
                        rpm: engine_rpm,
                        max_rpm: max_alert_rpm > 0 ? max_alert_rpm : 10000.0,
                        gear: gearVal,
                        throttle: (throttle / 255.0) * 100.0,
                        brake: (brake / 255.0) * 100.0,
                        clutch: clutch_pedal,
                        steering: steering,
                        lap_current: lap_current,
                        lap_time_current: currentLapTime,
                        lap_time_best: best_lap,
                        lap_time_last: last_lap,
                        sector: sector,
                        sector_count: this.sector_count,
                        sector_times: sectorTimes,
                        tyres: {
                            fl: { temp_surface: t_fl, temp_inner: t_fl, pressure: 29.5, wear: wear.fl },
                            fr: { temp_surface: t_fr, temp_inner: t_fr, pressure: 29.5, wear: wear.fr },
                            rl: { temp_surface: t_rl, temp_inner: t_rl, pressure: 30.0, wear: wear.rl },
                            rr: { temp_surface: t_rr, temp_inner: t_rr, pressure: 30.0, wear: wear.rr }
                        },
                        fuel_remaining: fuel_level,
                        fuel_capacity: fuel_capacity,
                        track_name: trackName,
                        track_id: trackId,
                        track_detection: trackDetection,
                        weather: "unavailable",
                        flags: (isLoading || isPaused) ? "none" : "green"
                    });

                    processTelemetryPayload(telemetryCache);

                } catch (e) {
                    console.error("GT7 receiver error:", e);
                }
            });

        } catch (e) {
            console.error("Failed to start GT7 UDP receiver:", e);
            logToTerminal("UDP bind error: " + e.message, "critical");
            this.running = false;
        }
    }

    _inferTrackName(x, z, flags) {
        const isLoading = (flags & (1 << 2)) !== 0;
        const isPaused = (flags & (1 << 1)) !== 0;
        if (isLoading || isPaused) {
            return this.track_name;
        }

        if (Math.abs(x) < 0.001 && Math.abs(z) < 0.001) {
            return this.track_name;
        }

        this.min_x = Math.min(this.min_x, x);
        this.min_y = Math.min(this.min_y, z);
        this.max_x = Math.max(this.max_x, x);
        this.max_y = Math.max(this.max_y, z);
        this.position_samples += 1;

        const drivenBox = {
            min_x: this.min_x,
            min_y: this.min_y,
            max_x: this.max_x,
            max_y: this.max_y
        };
        const drivenArea = (this.max_x - this.min_x) * (this.max_y - this.min_y);
        if (this.position_samples < 125 || drivenArea < 25000) {
            return this.track_name;
        }

        let bestIoU = 0.0;
        let bestTrackId = null;
        for (const bounds of TRACK_BOUNDS) {
            const iou = calculateIoU(drivenBox, bounds);
            if (iou > bestIoU) {
                bestIoU = iou;
                bestTrackId = bounds.track;
            }
        }

        if (bestIoU < 0.03) {
            return this.track_name;
        }

        this.track_votes[bestTrackId] = (this.track_votes[bestTrackId] || 0) + 1;
        if (this.track_votes[bestTrackId] >= 25) {
            this.track_id = bestTrackId;
            this.track_name = TRACK_MAP_GT7[bestTrackId] || `GT7 TRACK ${bestTrackId}`;
        }

        return this.track_name;
    }

    _updateTyreWear(speed, brake, steering, tyreTemps) {
        const now = Date.now();
        if (this.last_packet_time === null) {
            this.last_packet_time = now;
            return this.tyre_wear;
        }

        const dt = Math.max(0.0, Math.min((now - this.last_packet_time) / 1000.0, 0.2));
        this.last_packet_time = now;

        const distanceKm = Math.max(speed, 0.0) * dt / 3600.0;
        const steeringLoad = Math.min(Math.abs(steering) / 100.0, 1.0);
        const brakeLoad = Math.min(brake / 100.0, 1.0);

        for (const key of ['fl', 'fr', 'rl', 'rr']) {
            const tempLoad = Math.max(0.0, ((tyreTemps[key] || 0.0) - 75.0) / 45.0);
            const frontLoad = (key === 'fl' || key === 'fr') ? 1.2 : 0.85;
            const cornerLoad = ((key === 'fl' || key === 'rr') && steering > 0) ? 1.15 : (((key === 'fr' || key === 'rl') && steering < 0) ? 1.15 : 1.0);
            const wearRate = 0.9 + (steeringLoad * frontLoad * cornerLoad) + (brakeLoad * frontLoad * 0.7) + (tempLoad * 0.35);
            this.tyre_wear[key] = Math.min(100.0, this.tyre_wear[key] + distanceKm * wearRate * 0.55);
        }

        return this.tyre_wear;
    }

    _updateSectors(lap_current, last_lap_ms, best_lap, last_lap, speed_mps) {
        const now = Date.now();
        if (this.last_lap_seen === null) {
            this.last_lap_seen = lap_current;
        }
        if (this.last_gt7_sector_update === null) {
            this.last_gt7_sector_update = now;
        }

        const dt = Math.max(0.0, Math.min((now - this.last_gt7_sector_update) / 1000.0, 0.5));
        this.last_gt7_sector_update = now;

        const lapChanged = lap_current >= 0 && this.last_lap_seen >= 0 && lap_current !== this.last_lap_seen;
        const lastLapChanged = last_lap_ms > 0 && last_lap_ms !== this.last_lap_time_ms_seen;

        if (lapChanged || lastLapChanged) {
            this._resetSectors(now);
        }

        this.last_lap_seen = lap_current;
        if (last_lap_ms > 0) {
            this.last_lap_time_ms_seen = last_lap_ms;
        }

        const currentLapTime = Math.max(0.0, (now - this.gt7_lap_start) / 1000.0);
        const previousLapTime = Math.max(0.0, currentLapTime - dt);
        const previousDistance = this.gt7_lap_distance_m;
        this.gt7_lap_distance_m += Math.max(speed_mps, 0.0) * dt;

        const referenceLap = best_lap > 0 ? best_lap : (last_lap > 0 ? last_lap : 120.0);
        if (this.last_gt7_lap_distance_m > 500.0) {
            const sectorDistance = this.last_gt7_lap_distance_m / this.sector_count;
            while (this.gt7_active_sector < this.sector_count) {
                const threshold = sectorDistance * this.gt7_active_sector;
                if (this.gt7_lap_distance_m < threshold) break;

                const distanceDelta = this.gt7_lap_distance_m - previousDistance;
                let crossingLapTime = currentLapTime;
                if (distanceDelta > 0) {
                    const ratio = Math.max(0.0, Math.min((threshold - previousDistance) / distanceDelta, 1.0));
                    crossingLapTime = previousLapTime + (currentLapTime - previousLapTime) * ratio;
                }

                const key = `s${this.gt7_active_sector}`;
                this.completed_sector_times[key] = Math.max(0.0, crossingLapTime - this.gt7_sector_start_lap_time);
                this.gt7_sector_start_lap_time = crossingLapTime;
                this.gt7_active_sector += 1;
            }
        } else {
            const sectorLen = Math.max(reference_lap / this.sector_count, 1.0);
            while (this.gt7_active_sector < this.sector_count) {
                const threshold = sectorLen * this.gt7_active_sector;
                if (currentLapTime < threshold) break;

                const key = `s${this.gt7_active_sector}`;
                this.completed_sector_times[key] = Math.max(0.0, threshold - this.gt7_sector_start_lap_time);
                this.gt7_sector_start_lap_time = threshold;
                this.gt7_active_sector += 1;
            }
        }

        const sectorTimes = {};
        for (let i = 1; i <= this.sector_count; i++) {
            sectorTimes[`s${i}`] = this.completed_sector_times[`s${i}`] || 0.0;
        }

        return { currentLapTime, sector: this.gt7_active_sector, sectorTimes };
    }

    _resetSectors(now) {
        if (this.gt7_lap_distance_m > 500.0) {
            this.last_gt7_lap_distance_m = this.gt7_lap_distance_m;
        }
        this.gt7_lap_start = now;
        this.completed_sector_times = {};
        this.gt7_lap_distance_m = 0.0;
        this.gt7_active_sector = 1;
        this.gt7_sector_start_lap_time = 0.0;
    }

    async stop() {
        this.running = false;
        if (this.heartbeatIntervalId) {
            clearInterval(this.heartbeatIntervalId);
            this.heartbeatIntervalId = null;
        }
        if (this.listenerHandle) {
            this.listenerHandle.remove();
            this.listenerHandle = null;
        }
        if (this.socketId !== null) {
            const UdpSocket = window.Capacizer || window.Capacitor ? window.Capacitor.Plugins.UdpSocket : null;
            if (UdpSocket) {
                try {
                    await UdpSocket.close({ socketId: this.socketId });
                } catch (e) {
                    console.error("Error closing GT7 UDP socket:", e);
                }
            }
            this.socketId = null;
        }
        logToTerminal("GT7 telemetry stopped.", "system-msg");
    }
}

// --- Local Radio Control Logic ---
async function startRadioConnection({ forceMock = false } = {}) {
    const btn = document.getElementById('connect-btn');
    const statusBadge = document.getElementById('connection-status');
    const game = document.getElementById('game-select').value;
    const series = document.getElementById('series-input').value;
    const ipInput = document.getElementById('ps5-ip');
    const ip = forceMock ? 'mock' : ipInput.value;

    initAudio();

    if (activeStream) {
        btn.innerText = "START RADIO";
        btn.classList.remove('connected-state');
        statusBadge.innerText = "OFF";
        statusBadge.className = "status-badge disconnected";

        await activeStream.stop();
        activeStream = null;

        speakAlert(engineerLine('disconnected'));
        return;
    }

    btn.innerText = "CONNECTING...";
    statusBadge.innerText = "CONN";
    statusBadge.className = "status-badge disconnected";

    startHistorySession(game, series);

    const isCapacitor = window.Capacitor && window.Capacitor.isNativePlatform();

    if (ip.toLowerCase() === 'mock' || ip.toLowerCase() === 'demo' || !isCapacitor) {
        // Use Mock simulation
        activeStream = new LocalMockStreamer(game);
    } else if (game === 'gt7') {
        // Use Native GT7 UDP Socket
        activeStream = new LocalGT7Streamer(ip);
    } else if (game === 'f1') {
        // Use Native F1 UDP Socket
        activeStream = new LocalF1Streamer();
    }

    try {
        await activeStream.start();

        btn.innerText = "STOP RADIO";
        btn.classList.add('connected-state');
        statusBadge.innerText = "ONLINE";
        statusBadge.className = "status-badge connected";

        speakAlert(engineerLine('connected', { game: game === 'gt7' ? 'Gran Turismo' : 'Formula One' }));
    } catch (err) {
        console.error("Error starting telemetry stream:", err);
        btn.innerText = "START RADIO";
        btn.classList.remove('connected-state');
        statusBadge.innerText = "ERROR";
        statusBadge.className = "status-badge disconnected";
        logToTerminal("Failed to initialize telemetry comms.", "critical");
        activeStream = null;
    }
}

document.getElementById('connect-btn').addEventListener('click', () => {
    startRadioConnection();
});

document.getElementById('demo-btn').addEventListener('click', () => {
    document.getElementById('ps5-ip').value = 'mock';
    localStorage.setItem('apex_settings_ip', 'mock');
    startRadioConnection({ forceMock: true });
});

// Comms test button click
document.getElementById('voice-test-btn').addEventListener('click', () => {
    initAudio();
    speakAlert(engineerLine('check'));
});

// Mute button click
document.getElementById('voice-mute-btn').addEventListener('click', () => {
    const btn = document.getElementById('voice-mute-btn');
    isMuted = !isMuted;
    if (isMuted) {
        btn.innerText = "UNMUTE RADIO";
        btn.classList.add('primary-btn');
    } else {
        btn.innerText = "MUTE RADIO";
        btn.classList.remove('primary-btn');
        initAudio();
        speakAlert(engineerLine('unmuted'));
    }
});

['history-game-filter', 'history-series-filter', 'history-lap-min', 'history-lap-max'].forEach(id => {
    document.getElementById(id).addEventListener('input', renderRaceHistory);
    document.getElementById(id).addEventListener('change', renderRaceHistory);
});

document.getElementById('history-filter-reset').addEventListener('click', () => {
    document.getElementById('history-game-filter').value = 'all';
    document.getElementById('history-series-filter').value = '';
    document.getElementById('history-lap-min').value = '';
    document.getElementById('history-lap-max').value = '';
    renderRaceHistory();
});

document.getElementById('history-clear-btn').addEventListener('click', () => {
    localStorage.removeItem(raceHistoryKey);
    renderRaceHistory();
    logToTerminal('Race data archive cleared.', 'warning');
});

document.getElementById('history-export-btn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(readRaceHistory(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `apexengineer-race-history-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
});

// Auto-trigger Speech system load and populate settings
window.addEventListener('load', () => {
    initCharts();
    renderRaceHistory();

    // Load persisted settings
    const savedGame = localStorage.getItem('apex_settings_game') || 'gt7';
    const savedSeries = localStorage.getItem('apex_settings_series') || 'Practice';
    const savedIp = localStorage.getItem('apex_settings_ip') || '192.168.1.';

    document.getElementById('game-select').value = savedGame;
    document.getElementById('series-input').value = savedSeries;
    document.getElementById('ps5-ip').value = savedIp;

    // Persist settings changes
    document.getElementById('game-select').addEventListener('change', (e) => {
        localStorage.setItem('apex_settings_game', e.target.value);
    });
    document.getElementById('series-input').addEventListener('input', (e) => {
        localStorage.setItem('apex_settings_series', e.target.value);
    });
    document.getElementById('ps5-ip').addEventListener('input', (e) => {
        localStorage.setItem('apex_settings_ip', e.target.value);
    });

    // Prime Speech Synthesis so voices load correctly
    if ('speechSynthesis' in window) {
        window.speechSynthesis.getVoices();
    }

    // Tab Navigation Logic
    const tabButtons = document.querySelectorAll('.tab-btn');
    const gridEl = document.querySelector('.dashboard-grid');
    if (tabButtons.length > 0 && gridEl) {
        // Set default active tab class
        gridEl.className = 'dashboard-grid active-tab-hud';
        
        tabButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                tabButtons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                
                const tab = btn.dataset.tab;
                // Remove existing active tab classes and set new one
                gridEl.className = 'dashboard-grid';
                gridEl.classList.add(`active-tab-${tab}`);
            });
        });
    }

    // Segmented Game Toggle Buttons
    const gameToggles = document.querySelectorAll('.game-toggle-btn');
    const gameSelect = document.getElementById('game-select');
    if (gameToggles.length > 0 && gameSelect) {
        const syncToggleFromSelect = () => {
            const val = gameSelect.value;
            gameToggles.forEach(btn => {
                if (btn.dataset.game === val) {
                    btn.classList.add('active');
                } else {
                    btn.classList.remove('active');
                }
            });
        };

        gameToggles.forEach(btn => {
            btn.addEventListener('click', () => {
                gameSelect.value = btn.dataset.game;
                gameSelect.dispatchEvent(new Event('change'));
                syncToggleFromSelect();
            });
        });

        // Initial sync
        syncToggleFromSelect();

        // Sync when loaded from settings
        gameSelect.addEventListener('change', syncToggleFromSelect);
    }

});
