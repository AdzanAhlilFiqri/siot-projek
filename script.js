const PROTOTYPE_MODE = false; 

const CONF_MQTT = {
    url: "wss://h6c5ea94.ala.asia-southeast1.emqxsl.com:8084/mqtt",
    opts: {
        username: "sofia_esp32",
        password: "sofia123",
        clean: true,
        connectTimeout: 5000,
        reconnectPeriod: 2500,
        clientId: "WEB_SOFIA_COMMANDER_" + Math.random().toString(16).substr(2, 8),
        keepAliveInterval: 30,
        useSSL: true
    },
    subs: "sofia/#"

};

const UI_CONFIG = {
    chartLen: 20,
    colors: {
        temp: 'rgba(255, 150, 50, 1)',
        hum: 'rgba(0, 195, 255, 1)',
        gas: 'rgba(160, 50, 255, 1)',
        warn: 'rgba(255, 65, 85, 1)',
        safe: 'rgba(50, 255, 140, 1)'
    }
};

const DOMElems = {
    sys: {
        connText: document.getElementById('conn-status-text'),
        uptime: document.getElementById('uptime-display'),
        loader: document.getElementById('loading-overlay'),
        loadDet: document.getElementById('loading-detail'),
        logs: document.getElementById('sys-logs'),
        statusBadge: document.getElementById('status-sistem-header')
    },
    cards: {
        temp: { val: document.getElementById('val-temp'), bar: document.getElementById('bar-temp'), box: document.getElementById('card-suhu') },
        hum: { val: document.getElementById('val-hum'), bar: document.getElementById('bar-hum'), box: document.getElementById('card-lembap') },
        gas: { val: document.getElementById('val-gas'), bar: document.getElementById('bar-gas'), badge: document.getElementById('status-gas'), box: document.getElementById('card-gas') },
        motion: { val: document.getElementById('val-motion'), ind: document.getElementById('visual-motion'), box: document.getElementById('card-motion') },
        dist: { val: document.getElementById('val-dist'), bar: document.getElementById('bar-dist'), box: document.getElementById('card-dist') },
        flame: { val: document.getElementById('val-flame'), badge: document.getElementById('box-flame'), box: document.getElementById('card-flame') },
        water: { val: document.getElementById('val-water'), bar: document.getElementById('bar-water'), box: document.getElementById('card-water') },
        ai: { txt: document.getElementById('val-ai'), box: document.getElementById('ai-result-box') },
        sysStat: { val: document.getElementById('val-sys-stat'), bar: document.getElementById('bar-sys'), box: document.getElementById('card-system') },
aiLog: { txt: document.getElementById('val-new-ai'), box: document.getElementById('card-new-ai') }
    }
};

const CoreState = {
    isConnected: false,
    startTime: Date.now(),
    sensors: {
        temp: [], gas: []
    }
};

let mainChartRef = null;

const GlobalUtils = {
    getTime: () => {
        return new Date().toLocaleTimeString('id-ID', { hour12: false });
    },
    rand: (min, max) => {
        return Math.random() * (max - min) + min;
    }
};

const LogSystem = {
    add: (msg, type = 'INFO') => {
        const time = GlobalUtils.getTime();
        let color = '#ccc';
        if(type === 'WARN') color = UI_CONFIG.colors.warn;
        if(type === 'CRIT') color = '#ff0000';
        if(type === 'DATA') color = UI_CONFIG.colors.hum;
        if(type === 'SIM') color = '#fbbf24'; 

        const line = document.createElement('div');
        line.className = 'baris-log';
        line.innerHTML = `<span class="waktu-log">[${time}]</span><span style="color:${color}; font-weight:800; margin-right:8px;">${type}</span><span>${msg}</span>`;
        
        if(DOMElems.sys.logs) {
            DOMElems.sys.logs.prepend(line);
            if (DOMElems.sys.logs.children.length > 30) {
                DOMElems.sys.logs.lastElementChild.remove();
            }
        }
    }
};

const Visualizer = {
    initChart: () => {
        const ctx = document.getElementById('grafik-iot');
        if(!ctx) return;
        mainChartRef = new Chart(ctx, {
            type: 'line',
            data: {
                labels: Array(UI_CONFIG.chartLen).fill(''),
                datasets: [
                    {
                        label: 'Suhu (°C)',
                        borderColor: UI_CONFIG.colors.temp,
                        backgroundColor: 'rgba(255, 150, 50, 0.1)',
                        borderWidth: 2,
                        tension: 0.4,
                        data: Array(UI_CONFIG.chartLen).fill(25),
                        fill: true,
                        yAxisID: 'y'
                    },
                    {
                        label: 'Gas (PPM)',
                        borderColor: UI_CONFIG.colors.gas,
                        backgroundColor: 'transparent',
                        borderWidth: 2,
                        tension: 0.4,
                        data: Array(UI_CONFIG.chartLen).fill(50),
                        yAxisID: 'y1'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { display: false },
                    y: { 
                        display: true, position: 'left',
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        ticks: { color: '#888' }
                    },
                    y1: { display: false, min: 0, max: 1000 }
                }
            }
        });
    },
    updateChart: (tempVal, gasVal) => {
        if(!mainChartRef) return;
        const labels = mainChartRef.data.labels;
        const dsTemp = mainChartRef.data.datasets[0].data;
        const dsGas = mainChartRef.data.datasets[1].data;
        
        labels.shift();
        labels.push(GlobalUtils.getTime());
        
        dsTemp.shift();
        dsTemp.push(parseFloat(tempVal));
        
        dsGas.shift();
        dsGas.push(parseFloat(gasVal));
        
        mainChartRef.update();
    },
    setBar: (el, val, max, isInv = false) => {
        if(!el) return;
        let pct = (val / max) * 100;
        if(pct > 100) pct = 100;
        el.style.width = pct + "%";
        
        let col = UI_CONFIG.colors.safe;
        if(pct > 60) col = 'orange';
        if(pct > 85) col = UI_CONFIG.colors.warn;
        
        el.style.backgroundColor = col;
        el.style.boxShadow = `0 0 10px ${col}`;
    },
    flash: (el, color) => {
        if(!el) return;
        el.style.color = color;
        el.style.textShadow = `0 0 20px ${color}`;
        setTimeout(() => {
            el.style.color = "#fff"; 
            el.style.textShadow = "none";
        }, 500);
    }
};

const DataProcessor = {
    handleTemp: (msg) => {
        const val = parseFloat(msg).toFixed(1);
        if (DOMElems.cards.temp && DOMElems.cards.temp.val) {
            DOMElems.cards.temp.val.innerText = val;
            Visualizer.setBar(DOMElems.cards.temp.bar, val, 50);
            CoreState.sensors.temp = val;
            if(val > 35) LogSystem.add(`ALERT: Suhu Panas ${val}°C`, 'WARN');
        }
    },
    handleGas: (msg) => {
        const val = parseInt(msg);
        DOMElems.cards.gas.val.innerText = val;
        Visualizer.setBar(DOMElems.cards.gas.bar, val, 800);
        
        const badge = DOMElems.cards.gas.badge;
        if(val > 500) {
            badge.innerText = "BAHAYA";
            badge.style.background = "red";
        } else {
            badge.innerText = "AMAN";
            badge.style.background = "var(--color-leaf)";
        }
    },
    handleHum: (msg) => {
        DOMElems.cards.hum.val.innerText = parseFloat(msg).toFixed(0);
        Visualizer.setBar(DOMElems.cards.hum.bar, parseFloat(msg), 100);
    },
    handleDist: (msg) => {
        DOMElems.cards.dist.val.innerText = msg;
        Visualizer.setBar(DOMElems.cards.dist.bar, parseInt(msg), 200);
    },
    handleMotion: (msg) => {
        const el = DOMElems.cards.motion;
        if(msg == '1' || msg === 'TERDETEKSI') {
            el.val.innerText = "ADA GERAKAN";
            el.val.style.color = "red";
            el.ind.style.background = "red";
            el.ind.style.boxShadow = "0 0 15px red";
        } else {
            el.val.innerText = "SEPI";
            el.val.style.color = "#ccc";
            el.ind.style.background = "#333";
            el.ind.style.boxShadow = "none";
        }
    },
    handleFlame: (msg) => {
        const el = DOMElems.cards.flame;
        if(msg == '1' || msg == 'BAHAYA' || msg == 'KEBAKARAN') {
            el.val.innerText = "KEBAKARAN!";
            el.val.style.color = "red";
            el.badge.innerText = "EVAKUASI";
            el.badge.style.background = "red";
            el.box.style.border = "3px solid red";
        } else {
            el.val.innerText = "AMAN";
            el.val.style.color = "lime";
            el.badge.innerText = "NORMAL";
            el.badge.style.background = "transparent";
            el.box.style.border = "2px solid white";
        }
    },
    handleWater: (msg) => {
        const val = parseInt(msg);
        const el = DOMElems.cards.water;
        Visualizer.setBar(el.bar, val, 1024);
        
        if(val > 500) {
            el.val.innerText = "GENANGAN";
            el.val.style.color = "orange";
        } else {
            el.val.innerText = "KERING";
            el.val.style.color = "cyan";
        }
    },
    handleStatus: (msg) => {
        const el = DOMElems.cards.sysStat;
        el.val.innerText = msg.toUpperCase();
        if(msg.toLowerCase().includes('online') || msg.toLowerCase().includes('ready')) {
            el.val.style.color = "lime";
            el.bar.style.background = "lime";
            el.bar.style.boxShadow = "0 0 15px lime";
        } else {
            el.val.style.color = "red";
            el.bar.style.background = "red";
            el.bar.style.boxShadow = "0 0 15px red";
        }
    },
    handleAI: (msg) => {
        const el = DOMElems.cards.aiLog;
        el.txt.innerText = msg;
        
        if(msg.includes('BAHAYA') || msg.includes('WARNING')) {
            el.txt.style.color = "red";
        } else {
            el.txt.style.color = "var(--color-royal-blue)";
        }
    },
    route: (topic, msg) => {
        const key = topic.split('/').pop().toLowerCase();
        
        switch(key) {
            case 'suhu': DataProcessor.handleTemp(msg); break;
            case 'lembap': DataProcessor.handleHum(msg); break;
            case 'gas': DataProcessor.handleGas(msg); break;
            case 'distance': DataProcessor.handleDist(msg); break;
            case 'motion': DataProcessor.handleMotion(msg); break;
            case 'flame': DataProcessor.handleFlame(msg); break;
            case 'water': DataProcessor.handleWater(msg); break;
            case 'status': DataProcessor.handleStatus(msg); break;
            case 'ai': DataProcessor.handleAI(msg); break;
        }
        
        if(CoreState.sensors.temp && CoreState.sensors.gas) {
            Visualizer.updateChart(CoreState.sensors.temp, CoreState.sensors.gas);
        }
    }
};

class SimulationEngine {
    constructor() {
        this.timers = [];
    }
    
    start() {
        LogSystem.add("INITIATING PROTOTYPE SIMULATION MODE...", "SIM");
        DOMElems.sys.connText.innerText = "PROTOTYPE";
        DOMElems.sys.connText.style.color = "#fbbf24"; 
        
        this.emitLoop('sofia/suhu', 26, 32, 2000, 1);
        this.emitLoop('sofia/gas', 40, 150, 1500, 0);
        this.emitLoop('sofia/lembap', 50, 70, 3000, 0);
        this.emitLoop('sofia/distance', 20, 150, 1000, 0);
        
        this.emitFixed('sofia/flame', 0, 8000); 
        this.emitFixed('sofia/water', 100, 5000); 
        this.emitToggle('sofia/motion', 6000);
        this.aiThinking(4000);
    }
    
    emitLoop(topic, min, max, interval, precision) {
        setInterval(() => {
            const val = (Math.random() * (max - min) + min).toFixed(precision);
            DataProcessor.route(topic, val);
        }, interval);
    }
    
    emitFixed(topic, val, interval) {
        setInterval(() => DataProcessor.route(topic, val), interval);
    }
    
    emitToggle(topic, interval) {
        setInterval(() => {
            const val = Math.random() > 0.7 ? "1" : "0";
            DataProcessor.route(topic, val);
        }, interval);
    }
    
    aiThinking(interval) {
        const statuses = ["ANALISIS AMAN", "OPTIMASI ENERGI", "MONITORING AKTIF", "JARINGAN STABIL"];
        setInterval(() => {
            const msg = statuses[Math.floor(Math.random() * statuses.length)];
            DataProcessor.route('sofia/ai', msg);
        }, interval);
    }
}

class MqttHandler {
    constructor() {
        this.client = null;
    }
    
    init() {
        if (PROTOTYPE_MODE) {
            setTimeout(() => {
                DOMElems.sys.loader.style.opacity = '0';
                DOMElems.sys.loader.style.pointerEvents = 'none';
                new SimulationEngine().start();
            }, 1500);
            return;
        }

        const brokerUrl = "broker.emqx.io";
        const brokerPort = 8083;
        
        DOMElems.sys.loadDet.innerText = `Connecting to ${brokerUrl}...`;
        
        this.client = new Paho.MQTT.Client(brokerUrl, Number(brokerPort), "/mqtt", CONF_MQTT.opts.clientId);
        
        this.client.onConnectionLost = (resp) => {
            LogSystem.add("CONNECTION LOST: " + resp.errorMessage, "CRIT");
            DOMElems.sys.connText.innerText = "OFFLINE";
            setTimeout(() => this.connect(), 2000);
        };
        
        this.client.onMessageArrived = (msg) => {
            DataProcessor.route(msg.destinationName, msg.payloadString);
        };
        
        this.connect();
    }
    
    connect() {
        try {
            this.client.connect({
                onSuccess: () => {
                    DOMElems.sys.loader.style.opacity = '0';
                    DOMElems.sys.loader.style.pointerEvents = 'none';
                    DOMElems.sys.connText.innerText = "CONNECTED";
                    DOMElems.sys.connText.style.color = "lime";
                    LogSystem.add("BERHASIL TERHUBUNG KE SERVER SOFIA", "INFO");
                    this.client.subscribe(CONF_MQTT.subs);
                },
                onFailure: (e) => {
                    LogSystem.add("Gagal Konek, retrying...", "WARN");
                    setTimeout(() => this.connect(), 4000);
                },
                keepAliveInterval: 30
            });
        } catch (e) {
            console.log("MQTT Error ignored in strict mode");
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    Visualizer.initChart();
    
    setInterval(() => {
        const now = Date.now();
        const start = CoreState.startTime;
        const diff = new Date(now - start);
        const str = diff.toISOString().substr(11, 8);
        DOMElems.sys.uptime.innerText = str;
    }, 1000);
    
    new MqttHandler().init();

    const themeBtn = document.getElementById('theme-btn');
    themeBtn.addEventListener('click', () => {
        document.body.classList.toggle('dark-mode');
        
        if (document.body.classList.contains('dark-mode')) {
            themeBtn.innerText = "☀️ MODE SIANG";
            themeBtn.style.color = "yellow";
            themeBtn.style.borderColor = "yellow";
        } else {
            themeBtn.innerText = "🌙 MODE MALAM";
            themeBtn.style.color = "var(--color-royal-blue)";
            themeBtn.style.borderColor = "var(--color-royal-blue)";
        }
    });
});
