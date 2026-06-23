import { Hono } from 'hono'
import { serveStatic } from 'hono/cloudflare-workers'
import { cors } from 'hono/cors'

const app = new Hono()

app.use('/api/*', cors())
app.use('/static/*', serveStatic({ root: './' }))

// ─── Mock IoT Sensor Data ─────────────────────────────────────────────────────
function generateSensorData(fieldId: string, time: number) {
  const seed = time + fieldId.charCodeAt(0)
  const rand = (min: number, max: number, s: number) =>
    min + ((Math.sin(s) * 0.5 + 0.5) * (max - min))
  return {
    fieldId,
    timestamp: new Date(time).toISOString(),
    soilMoisture: Math.round(rand(22, 78, seed * 0.001)),
    temperature: Math.round(rand(18, 38, seed * 0.002) * 10) / 10,
    humidity: Math.round(rand(35, 85, seed * 0.003)),
    batteryLevel: Math.round(rand(60, 100, seed * 0.004)),
    signalStrength: Math.round(rand(-100, -40, seed * 0.005)),
  }
}

const fields = [
  { id: 'F1', name: 'Field 1 – Maize', crop: 'Maize', area: '2.4 ha', zone: 'North Block', lat: -17.8252, lng: 31.0335 },
  { id: 'F2', name: 'Field 2 – Tobacco', crop: 'Tobacco', area: '1.8 ha', zone: 'South Block', lat: -17.8280, lng: 31.0360 },
  { id: 'F3', name: 'Field 3 – Soya Beans', crop: 'Soya Beans', area: '3.1 ha', zone: 'East Block', lat: -17.8230, lng: 31.0390 },
  { id: 'F4', name: 'Field 4 – Wheat', crop: 'Wheat', area: '1.5 ha', zone: 'West Block', lat: -17.8260, lng: 31.0310 },
]

const cropThresholds: Record<string, { min: number; max: number; optimal: number }> = {
  Maize: { min: 30, max: 70, optimal: 55 },
  Tobacco: { min: 25, max: 65, optimal: 50 },
  'Soya Beans': { min: 35, max: 75, optimal: 60 },
  Wheat: { min: 28, max: 68, optimal: 52 },
  Cotton: { min: 20, max: 60, optimal: 45 },
  Sunflower: { min: 22, max: 62, optimal: 48 },
}

function getIrrigationStatus(moisture: number, crop: string) {
  const threshold = cropThresholds[crop] || { min: 30, max: 70, optimal: 55 }
  if (moisture < threshold.min) return { status: 'IRRIGATE', color: 'red', action: `Irrigate for ${Math.round((threshold.optimal - moisture) * 0.6)} minutes` }
  if (moisture > threshold.max) return { status: 'EXCESS', color: 'blue', action: 'Reduce irrigation – waterlogged risk' }
  if (moisture < threshold.min + 10) return { status: 'LOW', color: 'orange', action: 'Monitor closely – consider irrigating soon' }
  return { status: 'OPTIMAL', color: 'green', action: 'No action required' }
}

// ─── API Routes ───────────────────────────────────────────────────────────────
app.get('/api/dashboard', (c) => {
  const now = Date.now()
  const summary = fields.map(f => {
    const sensor = generateSensorData(f.id, now)
    const irr = getIrrigationStatus(sensor.soilMoisture, f.crop)
    return { ...f, sensor, irrigation: irr }
  })
  const alerts = summary
    .filter(f => f.irrigation.status === 'IRRIGATE' || f.irrigation.status === 'LOW')
    .map(f => ({
      id: f.id,
      field: f.name,
      message: f.irrigation.action,
      level: f.irrigation.status === 'IRRIGATE' ? 'critical' : 'warning',
      time: new Date().toLocaleTimeString('en-GB')
    }))
  return c.json({ fields: summary, alerts, lastUpdated: new Date().toISOString() })
})

app.get('/api/fields', (c) => {
  const now = Date.now()
  const data = fields.map(f => {
    const sensor = generateSensorData(f.id, now)
    const irr = getIrrigationStatus(sensor.soilMoisture, f.crop)
    return { ...f, sensor, irrigation: irr }
  })
  return c.json(data)
})

app.get('/api/fields/:id', (c) => {
  const id = c.req.param('id')
  const field = fields.find(f => f.id === id)
  if (!field) return c.json({ error: 'Field not found' }, 404)
  const now = Date.now()
  const history = Array.from({ length: 24 }, (_, i) => generateSensorData(id, now - i * 3600000))
  const current = generateSensorData(id, now)
  const irr = getIrrigationStatus(current.soilMoisture, field.crop)
  return c.json({ ...field, current, history, irrigation: irr, threshold: cropThresholds[field.crop] })
})

app.get('/api/alerts', (c) => {
  const now = Date.now()
  const alerts = fields.flatMap(f => {
    const sensor = generateSensorData(f.id, now)
    const irr = getIrrigationStatus(sensor.soilMoisture, f.crop)
    if (irr.status !== 'OPTIMAL') {
      return [{
        id: `ALT-${f.id}-${now}`,
        fieldId: f.id,
        field: f.name,
        crop: f.crop,
        zone: f.zone,
        message: irr.action,
        soilMoisture: sensor.soilMoisture,
        level: irr.status === 'IRRIGATE' ? 'critical' : irr.status === 'LOW' ? 'warning' : 'info',
        status: irr.status,
        time: new Date().toISOString()
      }]
    }
    return []
  })
  return c.json({ alerts, count: alerts.length })
})

app.get('/api/weather', (c) => {
  const conditions = ['Sunny', 'Partly Cloudy', 'Overcast', 'Light Rain']
  const now = Date.now()
  const rand = (min: number, max: number) => min + (Math.sin(now * 0.0001) * 0.5 + 0.5) * (max - min)
  return c.json({
    location: 'Harare, Zimbabwe',
    condition: conditions[Math.floor(rand(0, 3.99))],
    temperature: Math.round(rand(20, 34)),
    humidity: Math.round(rand(40, 75)),
    windSpeed: Math.round(rand(5, 25)),
    uvIndex: Math.round(rand(4, 11)),
    rainfall7d: Math.round(rand(0, 35) * 10) / 10,
    forecast: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((day, i) => ({
      day,
      high: Math.round(rand(22, 36) + i),
      low: Math.round(rand(14, 22) + i * 0.5),
      condition: conditions[Math.floor(rand(0, 3.99))]
    }))
  })
})

app.get('/api/analytics', (c) => {
  const now = Date.now()
  const weeks = Array.from({ length: 8 }, (_, i) => {
    const week = `W${8 - i}`
    return {
      week,
      waterUsed: Math.round(100 + Math.sin(i * 0.8) * 40),
      efficiency: Math.round(70 + Math.sin(i * 0.5) * 20),
      rainfall: Math.round(5 + Math.sin(i * 0.6) * 15)
    }
  })
  return c.json({
    waterSaved: '34%',
    yieldIncrease: '22%',
    costReduction: '18%',
    sensorUptime: '97.4%',
    weeklyData: weeks,
    fieldPerformance: fields.map(f => {
      const s = generateSensorData(f.id, now)
      return { field: f.name, crop: f.crop, efficiency: Math.round(65 + Math.sin(f.id.charCodeAt(1)) * 25), moisture: s.soilMoisture }
    })
  })
})

// ─── Main HTML Page ───────────────────────────────────────────────────────────
app.get('/', (c) => c.html(getMainHTML()))
app.get('/fields', (c) => c.html(getMainHTML()))
app.get('/alerts', (c) => c.html(getMainHTML()))
app.get('/weather', (c) => c.html(getMainHTML()))
app.get('/analytics', (c) => c.html(getMainHTML()))
app.get('/devices', (c) => c.html(getMainHTML()))

function getMainHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>AquaSense Zimbabwe – Smart Farm Dashboard</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css"/>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet"/>
  <style>
    :root {
      --green-dark: #1a4731;
      --green-mid: #2d6a4f;
      --green-light: #40916c;
      --yellow: #f4a61d;
      --yellow-light: #ffd166;
      --bg: #f0f4f0;
      --card: #ffffff;
      --text: #1a2e1a;
      --text-muted: #6b7c6b;
    }
    * { font-family: 'Inter', sans-serif; }
    body { background: var(--bg); color: var(--text); }

    /* Sidebar */
    #sidebar {
      background: linear-gradient(180deg, var(--green-dark) 0%, #0d2b1e 100%);
      width: 260px; min-height: 100vh; position: fixed; top: 0; left: 0; z-index: 50;
      transition: transform 0.3s ease;
    }
    #sidebar.collapsed { transform: translateX(-260px); }
    .nav-item {
      display: flex; align-items: center; gap: 12px; padding: 12px 20px;
      color: rgba(255,255,255,0.7); border-radius: 10px; margin: 2px 12px;
      cursor: pointer; transition: all 0.2s; font-size: 14px; font-weight: 500;
      text-decoration: none;
    }
    .nav-item:hover, .nav-item.active {
      background: rgba(244,166,29,0.15); color: var(--yellow-light);
      transform: translateX(4px);
    }
    .nav-item.active { border-left: 3px solid var(--yellow); }
    .nav-item i { width: 20px; text-align: center; font-size: 16px; }

    /* Main content */
    #main { margin-left: 260px; transition: margin-left 0.3s ease; }
    #main.expanded { margin-left: 0; }

    /* Topbar */
    #topbar {
      background: white; border-bottom: 1px solid #e8f0e8;
      padding: 0 24px; height: 64px;
      display: flex; align-items: center; justify-content: space-between;
      position: sticky; top: 0; z-index: 40; box-shadow: 0 1px 4px rgba(0,0,0,0.06);
    }

    /* Cards */
    .card {
      background: white; border-radius: 16px; padding: 20px;
      box-shadow: 0 1px 8px rgba(0,0,0,0.06); border: 1px solid #eef4ee;
    }
    .stat-card {
      border-radius: 16px; padding: 20px; color: white; position: relative; overflow: hidden;
    }
    .stat-card::after {
      content: ''; position: absolute; top: -20px; right: -20px;
      width: 100px; height: 100px; border-radius: 50%;
      background: rgba(255,255,255,0.08);
    }

    /* Moisture gauge */
    .gauge-ring { transform: rotate(-90deg); transform-origin: 50% 50%; }
    .gauge-bg { fill: none; stroke: #e8f0e8; }
    .gauge-fill { fill: none; stroke-linecap: round; transition: stroke-dashoffset 1s ease; }

    /* Status badges */
    .badge { padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 700; letter-spacing: 0.5px; }
    .badge-green { background: #d1fae5; color: #065f46; }
    .badge-red { background: #fee2e2; color: #991b1b; }
    .badge-orange { background: #ffedd5; color: #9a3412; }
    .badge-blue { background: #dbeafe; color: #1e40af; }

    /* Alert items */
    .alert-item {
      border-left: 4px solid; border-radius: 0 12px 12px 0;
      padding: 14px 16px; margin-bottom: 10px; background: white;
    }
    .alert-critical { border-color: #ef4444; background: #fff5f5; }
    .alert-warning { border-color: #f59e0b; background: #fffbeb; }
    .alert-info { border-color: #3b82f6; background: #eff6ff; }

    /* Field card */
    .field-card {
      background: white; border-radius: 16px; overflow: hidden;
      box-shadow: 0 2px 10px rgba(0,0,0,0.07); border: 1px solid #eef4ee;
      transition: transform 0.2s, box-shadow 0.2s; cursor: pointer;
    }
    .field-card:hover { transform: translateY(-3px); box-shadow: 0 8px 24px rgba(0,0,0,0.12); }
    .field-card-header { padding: 16px 20px; }
    .field-card-body { padding: 16px 20px; border-top: 1px solid #f0f4f0; }

    /* Device card */
    .device-online { box-shadow: 0 0 0 2px #22c55e; }
    .device-offline { box-shadow: 0 0 0 2px #ef4444; }
    .device-warning { box-shadow: 0 0 0 2px #f59e0b; }

    /* Pulse animation for live indicator */
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
    .pulse { animation: pulse 2s infinite; }

    /* Tabs */
    .tab-btn {
      padding: 8px 16px; border-radius: 8px; font-size: 13px; font-weight: 500;
      cursor: pointer; transition: all 0.2s; color: #6b7c6b;
    }
    .tab-btn.active { background: var(--green-dark); color: white; }

    /* Page sections */
    .page { display: none; }
    .page.active { display: block; }

    /* Scrollbar */
    ::-webkit-scrollbar { width: 6px; }
    ::-webkit-scrollbar-track { background: #f0f4f0; }
    ::-webkit-scrollbar-thumb { background: #40916c; border-radius: 3px; }

    /* Mobile responsive */
    @media (max-width: 768px) {
      #sidebar { transform: translateX(-260px); }
      #sidebar.mobile-open { transform: translateX(0); }
      #main { margin-left: 0 !important; }
    }

    /* Spinner */
    .spinner { border: 3px solid #e8f0e8; border-top-color: var(--green-light); border-radius: 50%; width: 28px; height: 28px; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>

<!-- ═══ SIDEBAR ═══ -->
<nav id="sidebar">
  <div class="px-5 py-5 border-b border-white/10">
    <div class="flex items-center gap-3">
      <div class="w-10 h-10 rounded-xl flex items-center justify-center" style="background:rgba(244,166,29,0.2)">
        <i class="fas fa-tint" style="color:var(--yellow);font-size:18px"></i>
      </div>
      <div>
        <div class="text-white font-bold text-base leading-tight">AquaSense</div>
        <div class="text-xs" style="color:var(--yellow)">ZIMBABWE</div>
      </div>
    </div>
  </div>

  <div class="px-3 py-4 text-xs font-semibold uppercase tracking-widest px-5 mb-1" style="color:rgba(255,255,255,0.35);padding-left:20px">Main Menu</div>

  <a class="nav-item active" data-page="dashboard" onclick="showPage('dashboard');return false;" href="#">
    <i class="fas fa-chart-line"></i> Dashboard
  </a>
  <a class="nav-item" data-page="fields" onclick="showPage('fields');return false;" href="#">
    <i class="fas fa-seedling"></i> My Fields
  </a>
  <a class="nav-item" data-page="alerts" onclick="showPage('alerts');return false;" href="#">
    <i class="fas fa-bell"></i> Alerts
    <span id="alertBadge" class="ml-auto text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center" style="background:var(--yellow);color:#000">0</span>
  </a>
  <a class="nav-item" data-page="weather" onclick="showPage('weather');return false;" href="#">
    <i class="fas fa-cloud-sun"></i> Weather
  </a>
  <a class="nav-item" data-page="analytics" onclick="showPage('analytics');return false;" href="#">
    <i class="fas fa-chart-bar"></i> Analytics
  </a>
  <a class="nav-item" data-page="devices" onclick="showPage('devices');return false;" href="#">
    <i class="fas fa-microchip"></i> Devices
  </a>

  <div class="px-3 py-2 mt-4 text-xs font-semibold uppercase tracking-widest" style="color:rgba(255,255,255,0.35);padding-left:20px">Support</div>
  <a class="nav-item" href="#" onclick="showGuide();return false;">
    <i class="fas fa-book"></i> Field Guide
  </a>
  <a class="nav-item" href="#" onclick="showSettings();return false;">
    <i class="fas fa-cog"></i> Settings
  </a>

  <div class="absolute bottom-0 left-0 right-0 p-4 border-t border-white/10">
    <div class="flex items-center gap-3">
      <div class="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold" style="background:var(--yellow);color:#000">PR</div>
      <div>
        <div class="text-white text-sm font-medium">Prince Ruswa</div>
        <div class="text-xs" style="color:rgba(255,255,255,0.5)">Farm Manager</div>
      </div>
      <div class="ml-auto w-2 h-2 rounded-full bg-green-400 pulse"></div>
    </div>
  </div>
</nav>

<!-- ═══ MAIN CONTENT ═══ -->
<div id="main">

  <!-- TOPBAR -->
  <header id="topbar">
    <div class="flex items-center gap-3">
      <button onclick="toggleSidebar()" class="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-gray-100 transition">
        <i class="fas fa-bars text-gray-600"></i>
      </button>
      <div>
        <h1 id="pageTitle" class="text-base font-bold" style="color:var(--green-dark)">Dashboard</h1>
        <p class="text-xs text-gray-500">AquaSense Zimbabwe – Smart Precision Agriculture</p>
      </div>
    </div>
    <div class="flex items-center gap-3">
      <div class="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full" style="background:#d1fae5;color:#065f46">
        <div class="w-1.5 h-1.5 rounded-full bg-green-500 pulse"></div>
        <span id="liveStatus">Live</span>
      </div>
      <div class="text-xs text-gray-500" id="lastUpdate">Loading...</div>
      <button onclick="refreshData()" class="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-gray-100 transition" title="Refresh">
        <i class="fas fa-sync-alt text-gray-600" id="refreshIcon"></i>
      </button>
      <button class="relative w-9 h-9 rounded-lg flex items-center justify-center hover:bg-gray-100 transition" onclick="showPage('alerts')">
        <i class="fas fa-bell text-gray-600"></i>
        <span id="notifDot" class="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full hidden"></span>
      </button>
    </div>
  </header>

  <!-- ═══ PAGE: DASHBOARD ═══ -->
  <section id="page-dashboard" class="page active p-6">
    <div class="mb-5 flex items-center justify-between">
      <div>
        <h2 class="text-xl font-bold" style="color:var(--green-dark)">Farm Overview</h2>
        <p class="text-sm text-gray-500">Real-time soil monitoring across all fields</p>
      </div>
      <div class="text-sm text-gray-400"><i class="fas fa-map-marker-alt mr-1" style="color:var(--green-light)"></i>Harare Region, Zimbabwe</div>
    </div>

    <!-- STAT CARDS -->
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6" id="statCards">
      <div class="stat-card" style="background:linear-gradient(135deg,#1a4731,#2d6a4f)">
        <div class="text-xs font-semibold uppercase tracking-wide text-green-300 mb-2">Avg Soil Moisture</div>
        <div class="text-3xl font-bold mb-1" id="avgMoisture">--<span class="text-lg">%</span></div>
        <div class="text-xs text-green-200" id="moistureStatus">Calculating...</div>
        <i class="fas fa-tint absolute bottom-3 right-4 text-4xl opacity-10"></i>
      </div>
      <div class="stat-card" style="background:linear-gradient(135deg,#b45309,#d97706)">
        <div class="text-xs font-semibold uppercase tracking-wide text-yellow-200 mb-2">Avg Temperature</div>
        <div class="text-3xl font-bold mb-1" id="avgTemp">--<span class="text-lg">°C</span></div>
        <div class="text-xs text-yellow-100" id="tempStatus">Calculating...</div>
        <i class="fas fa-thermometer-half absolute bottom-3 right-4 text-4xl opacity-10"></i>
      </div>
      <div class="stat-card" style="background:linear-gradient(135deg,#1e40af,#2563eb)">
        <div class="text-xs font-semibold uppercase tracking-wide text-blue-200 mb-2">Active Alerts</div>
        <div class="text-3xl font-bold mb-1" id="activeAlerts">--</div>
        <div class="text-xs text-blue-100" id="alertsStatus">Fields needing attention</div>
        <i class="fas fa-exclamation-triangle absolute bottom-3 right-4 text-4xl opacity-10"></i>
      </div>
      <div class="stat-card" style="background:linear-gradient(135deg,#065f46,#059669)">
        <div class="text-xs font-semibold uppercase tracking-wide text-emerald-200 mb-2">Sensor Network</div>
        <div class="text-3xl font-bold mb-1" id="sensorUptime">4<span class="text-lg">/4</span></div>
        <div class="text-xs text-emerald-100">Nodes online</div>
        <i class="fas fa-satellite-dish absolute bottom-3 right-4 text-4xl opacity-10"></i>
      </div>
    </div>

    <!-- FIELD GRID + ALERTS SIDE -->
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <!-- Field Cards -->
      <div class="lg:col-span-2">
        <div class="flex items-center justify-between mb-3">
          <h3 class="font-semibold" style="color:var(--green-dark)">Field Sensors</h3>
          <button onclick="showPage('fields')" class="text-xs font-medium" style="color:var(--green-light)">View All <i class="fas fa-arrow-right ml-1"></i></button>
        </div>
        <div id="fieldGrid" class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div class="card flex items-center justify-center h-32"><div class="spinner"></div></div>
        </div>
      </div>

      <!-- Alerts Panel -->
      <div>
        <div class="flex items-center justify-between mb-3">
          <h3 class="font-semibold" style="color:var(--green-dark)">Live Alerts</h3>
          <button onclick="showPage('alerts')" class="text-xs font-medium" style="color:var(--green-light)">All Alerts <i class="fas fa-arrow-right ml-1"></i></button>
        </div>
        <div id="alertsPanel">
          <div class="card flex items-center justify-center h-24"><div class="spinner"></div></div>
        </div>

        <!-- Weather Mini Card -->
        <div class="card mt-4" id="weatherMini">
          <div class="flex items-center justify-between mb-2">
            <span class="text-sm font-semibold" style="color:var(--green-dark)"><i class="fas fa-cloud-sun mr-2" style="color:var(--yellow)"></i>Weather</span>
            <span class="text-xs text-gray-400">Harare</span>
          </div>
          <div class="flex items-center gap-3">
            <div class="text-3xl font-bold" style="color:var(--green-dark)" id="wTemp">--°C</div>
            <div>
              <div class="text-sm text-gray-600" id="wCondition">Loading...</div>
              <div class="text-xs text-gray-400"><i class="fas fa-tint mr-1 text-blue-400"></i><span id="wHumidity">--%</span> humidity</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Moisture Trend Chart -->
    <div class="card mt-5">
      <div class="flex items-center justify-between mb-4">
        <h3 class="font-semibold" style="color:var(--green-dark)"><i class="fas fa-chart-area mr-2" style="color:var(--green-light)"></i>Soil Moisture Trends (24h)</h3>
        <div class="flex gap-2" id="trendTabs">
          <button class="tab-btn active" onclick="switchTrendChart('moisture',this)">Moisture</button>
          <button class="tab-btn" onclick="switchTrendChart('temperature',this)">Temp</button>
          <button class="tab-btn" onclick="switchTrendChart('humidity',this)">Humidity</button>
        </div>
      </div>
      <canvas id="trendChart" height="120"></canvas>
    </div>
  </section>

  <!-- ═══ PAGE: FIELDS ═══ -->
  <section id="page-fields" class="page p-6">
    <div class="mb-5 flex items-center justify-between flex-wrap gap-3">
      <div>
        <h2 class="text-xl font-bold" style="color:var(--green-dark)">My Fields</h2>
        <p class="text-sm text-gray-500">Monitor each field's soil health in real-time</p>
      </div>
      <button class="px-4 py-2 rounded-xl text-sm font-semibold text-white flex items-center gap-2" style="background:var(--green-dark)" onclick="addFieldModal()">
        <i class="fas fa-plus"></i> Add Field
      </button>
    </div>

    <div id="fieldsPage" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-2 gap-5">
      <div class="card flex items-center justify-center h-32"><div class="spinner"></div></div>
    </div>

    <!-- Field Detail Modal -->
    <div id="fieldModal" class="fixed inset-0 z-50 hidden">
      <div class="absolute inset-0 bg-black/50 backdrop-blur-sm" onclick="closeModal()"></div>
      <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
        <div class="p-6" id="fieldModalContent">Loading...</div>
      </div>
    </div>
  </section>

  <!-- ═══ PAGE: ALERTS ═══ -->
  <section id="page-alerts" class="page p-6">
    <div class="mb-5">
      <h2 class="text-xl font-bold" style="color:var(--green-dark)">Irrigation Alerts</h2>
      <p class="text-sm text-gray-500">Automated crop-specific water management notifications</p>
    </div>

    <!-- Alert filters -->
    <div class="flex gap-2 mb-5 flex-wrap">
      <button class="tab-btn active" onclick="filterAlerts('all',this)">All</button>
      <button class="tab-btn" onclick="filterAlerts('critical',this)">Critical</button>
      <button class="tab-btn" onclick="filterAlerts('warning',this)">Warning</button>
      <button class="tab-btn" onclick="filterAlerts('info',this)">Info</button>
    </div>

    <div id="alertsPage">
      <div class="card flex items-center justify-center h-32"><div class="spinner"></div></div>
    </div>
  </section>

  <!-- ═══ PAGE: WEATHER ═══ -->
  <section id="page-weather" class="page p-6">
    <div class="mb-5">
      <h2 class="text-xl font-bold" style="color:var(--green-dark)">Weather & Climate</h2>
      <p class="text-sm text-gray-500">Harare Region – affects evapotranspiration & irrigation planning</p>
    </div>
    <div id="weatherPage">
      <div class="card flex items-center justify-center h-32"><div class="spinner"></div></div>
    </div>
  </section>

  <!-- ═══ PAGE: ANALYTICS ═══ -->
  <section id="page-analytics" class="page p-6">
    <div class="mb-5">
      <h2 class="text-xl font-bold" style="color:var(--green-dark)">Farm Analytics</h2>
      <p class="text-sm text-gray-500">Water efficiency, yield impact & performance insights</p>
    </div>
    <div id="analyticsPage">
      <div class="card flex items-center justify-center h-32"><div class="spinner"></div></div>
    </div>
  </section>

  <!-- ═══ PAGE: DEVICES ═══ -->
  <section id="page-devices" class="page p-6">
    <div class="mb-5 flex items-center justify-between">
      <div>
        <h2 class="text-xl font-bold" style="color:var(--green-dark)">IoT Sensor Devices</h2>
        <p class="text-sm text-gray-500">ESP32 nodes with LoRaWAN/GSM connectivity</p>
      </div>
    </div>
    <div id="devicesPage">
      <div class="card flex items-center justify-center h-32"><div class="spinner"></div></div>
    </div>
  </section>

</div><!-- end #main -->

<!-- Guide Modal -->
<div id="guideModal" class="fixed inset-0 z-50 hidden">
  <div class="absolute inset-0 bg-black/50 backdrop-blur-sm" onclick="document.getElementById('guideModal').classList.add('hidden')"></div>
  <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-2xl w-full max-w-lg shadow-2xl p-6 max-h-[85vh] overflow-y-auto">
    <h3 class="text-lg font-bold mb-3" style="color:var(--green-dark)"><i class="fas fa-book mr-2" style="color:var(--yellow)"></i>AquaSense Field Guide</h3>
    <div class="space-y-3 text-sm text-gray-700">
      <div class="p-3 rounded-xl" style="background:#f0fdf4">
        <div class="font-semibold text-green-800 mb-1">🌱 Soil Moisture Levels</div>
        <ul class="space-y-1 text-green-700">
          <li><span class="font-bold text-red-600">Critical (&lt;25%):</span> Irrigate immediately</li>
          <li><span class="font-bold text-orange-600">Low (25–35%):</span> Plan irrigation within 24h</li>
          <li><span class="font-bold text-green-600">Optimal (35–70%):</span> No action needed</li>
          <li><span class="font-bold text-blue-600">Excess (&gt;80%):</span> Risk of root rot – stop irrigating</li>
        </ul>
      </div>
      <div class="p-3 rounded-xl" style="background:#fffbeb">
        <div class="font-semibold text-yellow-800 mb-1">⚡ Device Status Guide</div>
        <ul class="space-y-1 text-yellow-700">
          <li><span class="font-bold">Green ring:</span> Online & transmitting normally</li>
          <li><span class="font-bold">Yellow ring:</span> Low battery or weak signal (&lt;60%)</li>
          <li><span class="font-bold">Red ring:</span> Offline – check device power & connectivity</li>
        </ul>
      </div>
      <div class="p-3 rounded-xl" style="background:#eff6ff">
        <div class="font-semibold text-blue-800 mb-1">📡 Sensor Specs</div>
        <ul class="space-y-1 text-blue-700">
          <li><span class="font-bold">Microcontroller:</span> ESP32 (deep-sleep, wakes every 15 min)</li>
          <li><span class="font-bold">Soil sensor:</span> Capacitive v1.2 – corrosion resistant</li>
          <li><span class="font-bold">Climate sensor:</span> DHT22 – temp & humidity</li>
          <li><span class="font-bold">Power:</span> 5V Solar + 18650 Li-ion battery</li>
          <li><span class="font-bold">Range:</span> LoRaWAN up to 10km / GSM fallback</li>
        </ul>
      </div>
    </div>
    <button onclick="document.getElementById('guideModal').classList.add('hidden')" class="mt-4 w-full py-2 rounded-xl text-white font-semibold" style="background:var(--green-dark)">Close</button>
  </div>
</div>

<!-- Settings Modal -->
<div id="settingsModal" class="fixed inset-0 z-50 hidden">
  <div class="absolute inset-0 bg-black/50 backdrop-blur-sm" onclick="document.getElementById('settingsModal').classList.add('hidden')"></div>
  <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-2xl w-full max-w-md shadow-2xl p-6">
    <h3 class="text-lg font-bold mb-4" style="color:var(--green-dark)"><i class="fas fa-cog mr-2" style="color:var(--yellow)"></i>Settings</h3>
    <div class="space-y-4">
      <div>
        <label class="text-sm font-medium text-gray-700 block mb-1">Farm Name</label>
        <input value="Prince Ruswa Farm" class="w-full border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2" style="border-color:#c0d9c0;--tw-ring-color:var(--green-light)"/>
      </div>
      <div>
        <label class="text-sm font-medium text-gray-700 block mb-1">Alert SMS Number</label>
        <input value="+263 7X XXX XXXX" class="w-full border rounded-xl px-3 py-2 text-sm focus:outline-none"/>
      </div>
      <div>
        <label class="text-sm font-medium text-gray-700 block mb-1">Data Refresh Interval</label>
        <select class="w-full border rounded-xl px-3 py-2 text-sm focus:outline-none">
          <option>15 minutes (sensor cycle)</option>
          <option>30 minutes</option>
          <option>1 hour</option>
        </select>
      </div>
      <div class="flex items-center justify-between">
        <span class="text-sm font-medium text-gray-700">SMS Alerts</span>
        <div class="w-12 h-6 rounded-full cursor-pointer flex items-center px-1" style="background:var(--green-light)" onclick="this.style.background=this.style.background==''?'var(--green-light)':'#ccc'">
          <div class="w-4 h-4 bg-white rounded-full shadow transition ml-auto"></div>
        </div>
      </div>
    </div>
    <button onclick="document.getElementById('settingsModal').classList.add('hidden')" class="mt-5 w-full py-2 rounded-xl text-white font-semibold" style="background:var(--green-dark)">Save Settings</button>
  </div>
</div>

<script>
// ═══ APP STATE ═══
let currentPage = 'dashboard';
let dashData = null;
let trendChart = null;
let analyticsChart = null;
let allAlerts = [];
let refreshInterval = null;

// ═══ PAGE NAVIGATION ═══
function showPage(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  document.querySelector('[data-page="' + page + '"]').classList.add('active');
  const titles = { dashboard: 'Dashboard', fields: 'My Fields', alerts: 'Irrigation Alerts', weather: 'Weather & Climate', analytics: 'Farm Analytics', devices: 'IoT Devices' };
  document.getElementById('pageTitle').textContent = titles[page] || page;
  currentPage = page;
  if (window.innerWidth <= 768) document.getElementById('sidebar').classList.remove('mobile-open');
  loadPage(page);
}

function loadPage(page) {
  if (page === 'dashboard') loadDashboard();
  else if (page === 'fields') loadFields();
  else if (page === 'alerts') loadAlertsPage();
  else if (page === 'weather') loadWeatherPage();
  else if (page === 'analytics') loadAnalytics();
  else if (page === 'devices') loadDevices();
}

function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  if (window.innerWidth <= 768) sb.classList.toggle('mobile-open');
  else {
    sb.classList.toggle('collapsed');
    document.getElementById('main').classList.toggle('expanded');
  }
}

// ═══ DATA LOADING ═══
async function loadDashboard() {
  try {
    const [dash, weather] = await Promise.all([
      fetch('/api/dashboard').then(r => r.json()),
      fetch('/api/weather').then(r => r.json())
    ]);
    dashData = dash;

    // Update stats
    const avgMoist = Math.round(dash.fields.reduce((s,f) => s + f.sensor.soilMoisture, 0) / dash.fields.length);
    const avgTemp = (dash.fields.reduce((s,f) => s + f.sensor.temperature, 0) / dash.fields.length).toFixed(1);
    document.getElementById('avgMoisture').innerHTML = avgMoist + '<span class="text-lg">%</span>';
    document.getElementById('avgTemp').innerHTML = avgTemp + '<span class="text-lg">°C</span>';
    document.getElementById('activeAlerts').textContent = dash.alerts.length;
    document.getElementById('moistureStatus').textContent = avgMoist < 35 ? '⚠ Below optimal' : avgMoist > 70 ? '↑ Above optimal' : '✓ Optimal range';
    document.getElementById('tempStatus').textContent = avgTemp > 32 ? '↑ High – monitor crops' : '✓ Normal range';
    document.getElementById('lastUpdate').textContent = new Date(dash.lastUpdated).toLocaleTimeString('en-GB');

    // Alert badge
    const alertCount = dash.alerts.length;
    document.getElementById('alertBadge').textContent = alertCount;
    if (alertCount > 0) document.getElementById('notifDot').classList.remove('hidden');

    // Field grid
    renderFieldGrid(dash.fields);

    // Alerts panel
    renderAlertsPanel(dash.alerts);

    // Weather mini
    document.getElementById('wTemp').textContent = weather.temperature + '°C';
    document.getElementById('wCondition').textContent = weather.condition;
    document.getElementById('wHumidity').textContent = weather.humidity + '%';

    // Trend chart
    buildTrendChart(dash.fields, 'moisture');

  } catch(e) {
    console.error(e);
  }
}

function renderFieldGrid(fields) {
  const icons = { Maize: '🌽', Tobacco: '🍃', 'Soya Beans': '🫘', Wheat: '🌾', Cotton: '🌸', Sunflower: '🌻' };
  document.getElementById('fieldGrid').innerHTML = fields.map(f => {
    const pct = f.sensor.soilMoisture;
    const color = f.irrigation.color === 'green' ? '#22c55e' : f.irrigation.color === 'red' ? '#ef4444' : f.irrigation.color === 'orange' ? '#f59e0b' : '#3b82f6';
    const circumference = 2 * Math.PI * 28;
    const dash = circumference - (pct / 100) * circumference;
    return \`<div class="field-card" onclick="openFieldDetail('\${f.id}')">
      <div class="field-card-header flex items-start justify-between">
        <div>
          <div class="text-base font-bold" style="color:var(--green-dark)">\${icons[f.crop] || '🌿'} \${f.name}</div>
          <div class="text-xs text-gray-500 mt-0.5"><i class="fas fa-map-marker-alt mr-1" style="color:var(--green-light)"></i>\${f.zone} · \${f.area}</div>
        </div>
        <span class="badge badge-\${f.irrigation.color === 'green' ? 'green' : f.irrigation.color === 'red' ? 'red' : f.irrigation.color === 'orange' ? 'orange' : 'blue'}">\${f.irrigation.status}</span>
      </div>
      <div class="field-card-body flex items-center gap-4">
        <div class="relative flex-shrink-0">
          <svg width="72" height="72">
            <circle class="gauge-bg" cx="36" cy="36" r="28" stroke-width="6"/>
            <circle class="gauge-fill gauge-ring" cx="36" cy="36" r="28" stroke-width="6"
              stroke="\${color}" stroke-dasharray="\${circumference}" stroke-dashoffset="\${dash}"/>
          </svg>
          <div class="absolute inset-0 flex items-center justify-center">
            <span class="text-sm font-bold" style="color:\${color}">\${pct}%</span>
          </div>
        </div>
        <div class="flex-1 min-w-0">
          <div class="grid grid-cols-2 gap-y-1 text-xs">
            <span class="text-gray-500"><i class="fas fa-thermometer-half mr-1 text-orange-400"></i>\${f.sensor.temperature}°C</span>
            <span class="text-gray-500"><i class="fas fa-wind mr-1 text-blue-400"></i>\${f.sensor.humidity}% hum</span>
            <span class="text-gray-500"><i class="fas fa-battery-three-quarters mr-1 text-green-400"></i>\${f.sensor.batteryLevel}%</span>
            <span class="text-gray-500"><i class="fas fa-signal mr-1 text-purple-400"></i>LoRa</span>
          </div>
          <div class="text-xs mt-2 font-medium text-gray-600 truncate">📋 \${f.irrigation.action}</div>
        </div>
      </div>
    </div>\`;
  }).join('');
}

function renderAlertsPanel(alerts) {
  if (!alerts.length) {
    document.getElementById('alertsPanel').innerHTML = \`<div class="card text-center py-6">
      <i class="fas fa-check-circle text-3xl mb-2" style="color:var(--green-light)"></i>
      <div class="text-sm font-medium text-gray-700">All fields optimal</div>
      <div class="text-xs text-gray-400 mt-1">No irrigation needed</div>
    </div>\`;
    return;
  }
  document.getElementById('alertsPanel').innerHTML = alerts.map(a => \`
    <div class="alert-item alert-\${a.level}">
      <div class="flex items-start justify-between">
        <div class="font-semibold text-sm text-gray-800">\${a.field}</div>
        <span class="text-xs text-gray-400">\${a.time}</span>
      </div>
      <div class="text-xs text-gray-600 mt-1">📋 \${a.message}</div>
    </div>
  \`).join('');
}

function buildTrendChart(fields, metric) {
  const ctx = document.getElementById('trendChart').getContext('2d');
  const labels = Array.from({length:24},(_,i) => \`\${23-i}h\`).reverse();
  const colors = ['#2d6a4f','#f4a61d','#3b82f6','#ec4899'];
  const datasets = fields.map((f,i) => {
    const data = Array.from({length:24},(_,h) => {
      const base = f.sensor[metric === 'moisture' ? 'soilMoisture' : metric === 'temperature' ? 'temperature' : 'humidity'];
      return Math.round(base + Math.sin((h + i) * 0.6) * 8);
    });
    return { label: f.name.split('–')[1]?.trim() || f.name, data, borderColor: colors[i], backgroundColor: colors[i]+'22', tension:0.4, borderWidth:2, pointRadius:2, fill: i===0 };
  });
  if (trendChart) trendChart.destroy();
  trendChart = new Chart(ctx, {
    type: 'line', data: { labels, datasets },
    options: { responsive:true, interaction:{mode:'index',intersect:false}, plugins:{legend:{labels:{font:{size:11},boxWidth:12}}}, scales:{y:{beginAtZero:false,ticks:{font:{size:11}},grid:{color:'#f0f4f0'}},x:{ticks:{maxTicksLimit:8,font:{size:11}},grid:{display:false}}} }
  });
}

function switchTrendChart(metric, btn) {
  document.querySelectorAll('#trendTabs .tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  if (dashData) buildTrendChart(dashData.fields, metric);
}

// ═══ FIELDS PAGE ═══
async function loadFields() {
  const data = await fetch('/api/fields').then(r => r.json());
  const icons = { Maize: '🌽', Tobacco: '🍃', 'Soya Beans': '🫘', Wheat: '🌾' };
  document.getElementById('fieldsPage').innerHTML = data.map(f => {
    const pct = f.sensor.soilMoisture;
    const color = f.irrigation.color === 'green' ? '#22c55e' : f.irrigation.color === 'red' ? '#ef4444' : f.irrigation.color === 'orange' ? '#f59e0b' : '#3b82f6';
    const circumference = 2 * Math.PI * 36;
    const dashOffset = circumference - (pct / 100) * circumference;
    return \`<div class="field-card" onclick="openFieldDetail('\${f.id}')">
      <div class="p-5" style="background:linear-gradient(135deg,#1a4731,#2d6a4f)">
        <div class="flex items-center justify-between">
          <div>
            <div class="text-white font-bold text-lg">\${icons[f.crop] || '🌿'} \${f.name}</div>
            <div class="text-green-200 text-xs mt-0.5">\${f.zone} · \${f.area} · \${f.crop}</div>
          </div>
          <span class="badge" style="background:rgba(244,166,29,0.25);color:#ffd166">\${f.irrigation.status}</span>
        </div>
      </div>
      <div class="p-5">
        <div class="flex items-center gap-5 mb-4">
          <div class="relative flex-shrink-0">
            <svg width="90" height="90">
              <circle fill="none" stroke="#e8f0e8" cx="45" cy="45" r="36" stroke-width="7"/>
              <circle fill="none" stroke="\${color}" cx="45" cy="45" r="36" stroke-width="7"
                stroke-linecap="round" stroke-dasharray="\${circumference}" stroke-dashoffset="\${dashOffset}"
                transform="rotate(-90 45 45)"/>
            </svg>
            <div class="absolute inset-0 flex flex-col items-center justify-center">
              <span class="text-xl font-bold" style="color:\${color}">\${pct}%</span>
              <span class="text-xs text-gray-400">moisture</span>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-3 flex-1">
            <div class="p-2.5 rounded-xl" style="background:#f0fdf4">
              <div class="text-xs text-gray-500 mb-0.5">Temperature</div>
              <div class="text-sm font-bold text-gray-800">\${f.sensor.temperature}°C</div>
            </div>
            <div class="p-2.5 rounded-xl" style="background:#eff6ff">
              <div class="text-xs text-gray-500 mb-0.5">Humidity</div>
              <div class="text-sm font-bold text-gray-800">\${f.sensor.humidity}%</div>
            </div>
            <div class="p-2.5 rounded-xl" style="background:#fffbeb">
              <div class="text-xs text-gray-500 mb-0.5">Battery</div>
              <div class="text-sm font-bold text-gray-800">\${f.sensor.batteryLevel}%</div>
            </div>
            <div class="p-2.5 rounded-xl" style="background:#fdf4ff">
              <div class="text-xs text-gray-500 mb-0.5">Network</div>
              <div class="text-sm font-bold text-gray-800">LoRa</div>
            </div>
          </div>
        </div>
        <div class="p-3 rounded-xl border flex items-start gap-2 \${f.irrigation.color === 'red' ? 'border-red-200 bg-red-50' : f.irrigation.color === 'orange' ? 'border-orange-200 bg-orange-50' : 'border-green-200 bg-green-50'}">
          <i class="fas \${f.irrigation.color === 'green' ? 'fa-check-circle text-green-500' : 'fa-exclamation-circle text-orange-500'} mt-0.5 flex-shrink-0"></i>
          <span class="text-sm text-gray-700">\${f.irrigation.action}</span>
        </div>
        <button class="mt-3 w-full text-sm font-medium py-2 rounded-xl border" style="border-color:var(--green-light);color:var(--green-dark)" onclick="event.stopPropagation();openFieldDetail('\${f.id}')">
          View Sensor History <i class="fas fa-arrow-right ml-1"></i>
        </button>
      </div>
    </div>\`;
  }).join('');
}

async function openFieldDetail(id) {
  document.getElementById('fieldModal').classList.remove('hidden');
  document.getElementById('fieldModalContent').innerHTML = '<div class="flex justify-center py-10"><div class="spinner"></div></div>';
  const data = await fetch('/api/fields/' + id).then(r => r.json());
  const icons = { Maize: '🌽', Tobacco: '🍃', 'Soya Beans': '🫘', Wheat: '🌾' };
  const pct = data.current.soilMoisture;
  const color = data.irrigation.color === 'green' ? '#22c55e' : data.irrigation.color === 'red' ? '#ef4444' : data.irrigation.color === 'orange' ? '#f59e0b' : '#3b82f6';
  document.getElementById('fieldModalContent').innerHTML = \`
    <div class="flex items-center justify-between mb-4">
      <h3 class="text-xl font-bold" style="color:var(--green-dark)">\${icons[data.crop] || '🌿'} \${data.name}</h3>
      <button onclick="closeModal()" class="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 hover:bg-gray-200"><i class="fas fa-times"></i></button>
    </div>
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
      <div class="p-3 rounded-xl text-center" style="background:#f0fdf4"><div class="text-2xl font-bold" style="color:\${color}">\${pct}%</div><div class="text-xs text-gray-500">Soil Moisture</div></div>
      <div class="p-3 rounded-xl text-center" style="background:#fff7ed"><div class="text-2xl font-bold text-orange-600">\${data.current.temperature}°C</div><div class="text-xs text-gray-500">Temperature</div></div>
      <div class="p-3 rounded-xl text-center" style="background:#eff6ff"><div class="text-2xl font-bold text-blue-600">\${data.current.humidity}%</div><div class="text-xs text-gray-500">Humidity</div></div>
      <div class="p-3 rounded-xl text-center" style="background:#f5f3ff"><div class="text-2xl font-bold text-purple-600">\${data.current.batteryLevel}%</div><div class="text-xs text-gray-500">Battery</div></div>
    </div>
    <div class="p-3 mb-4 rounded-xl border \${data.irrigation.color === 'red' ? 'border-red-200 bg-red-50' : data.irrigation.color === 'orange' ? 'border-orange-200 bg-orange-50' : 'border-green-200 bg-green-50'}">
      <div class="font-semibold text-sm mb-1">Irrigation Recommendation</div>
      <div class="text-sm text-gray-700">📋 \${data.irrigation.action}</div>
      <div class="text-xs text-gray-400 mt-1">Optimal range for \${data.crop}: \${data.threshold?.min}–\${data.threshold?.max}% (target \${data.threshold?.optimal}%)</div>
    </div>
    <div class="text-sm font-semibold mb-2" style="color:var(--green-dark)">24-Hour Soil Moisture History</div>
    <canvas id="modalChart" height="120"></canvas>
  \`;
  const labels = data.history.map((_,i) => i % 4 === 0 ? (24-i) + 'h' : '').reverse();
  const mData = data.history.map(h => h.soilMoisture).reverse();
  const ctx = document.getElementById('modalChart').getContext('2d');
  new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: [{ label: 'Soil Moisture %', data: mData, borderColor: color, backgroundColor: color + '22', tension:0.4, fill:true, borderWidth:2, pointRadius:2 }] },
    options: { responsive:true, plugins:{legend:{display:false}}, scales:{y:{beginAtZero:false,ticks:{font:{size:11}}},x:{ticks:{font:{size:10}},grid:{display:false}}} }
  });
}

function closeModal() { document.getElementById('fieldModal').classList.add('hidden'); }
function addFieldModal() { alert('Field registration feature coming soon!\\nConnect your ESP32 device to add new sensor nodes.'); }

// ═══ ALERTS PAGE ═══
async function loadAlertsPage() {
  const data = await fetch('/api/alerts').then(r => r.json());
  allAlerts = data.alerts;
  renderAlertsPageData(allAlerts);
}

function renderAlertsPageData(alerts) {
  if (!alerts.length) {
    document.getElementById('alertsPage').innerHTML = \`<div class="card text-center py-12">
      <i class="fas fa-check-circle text-5xl mb-3" style="color:var(--green-light)"></i>
      <div class="text-lg font-bold text-gray-700">All Fields Optimal</div>
      <div class="text-sm text-gray-400 mt-1">No irrigation alerts at this time. Your crops are healthy!</div>
    </div>\`;
    return;
  }
  document.getElementById('alertsPage').innerHTML = alerts.map(a => {
    const levelIcon = a.level === 'critical' ? 'fa-exclamation-circle text-red-500' : a.level === 'warning' ? 'fa-exclamation-triangle text-yellow-500' : 'fa-info-circle text-blue-500';
    return \`<div class="alert-item alert-\${a.level} mb-3">
      <div class="flex items-start gap-3">
        <i class="fas \${levelIcon} text-xl mt-0.5 flex-shrink-0"></i>
        <div class="flex-1">
          <div class="flex items-start justify-between">
            <div>
              <div class="font-bold text-gray-800">\${a.field}</div>
              <div class="text-xs text-gray-500 mt-0.5">\${a.crop} · \${a.zone}</div>
            </div>
            <span class="badge \${a.level === 'critical' ? 'badge-red' : a.level === 'warning' ? 'badge-orange' : 'badge-blue'} ml-2 flex-shrink-0">\${a.status}</span>
          </div>
          <div class="mt-2 text-sm text-gray-700">📋 \${a.message}</div>
          <div class="mt-1.5 flex items-center gap-3 text-xs text-gray-400">
            <span><i class="fas fa-tint mr-1"></i>\${a.soilMoisture}% moisture</span>
            <span><i class="fas fa-clock mr-1"></i>\${new Date(a.time).toLocaleTimeString('en-GB')}</span>
          </div>
        </div>
      </div>
    </div>\`;
  }).join('');
}

function filterAlerts(level, btn) {
  document.querySelectorAll('#page-alerts .tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const filtered = level === 'all' ? allAlerts : allAlerts.filter(a => a.level === level);
  renderAlertsPageData(filtered);
}

// ═══ WEATHER PAGE ═══
async function loadWeatherPage() {
  const w = await fetch('/api/weather').then(r => r.json());
  const condIcons = { Sunny: 'fa-sun text-yellow-400', 'Partly Cloudy': 'fa-cloud-sun text-yellow-300', Overcast: 'fa-cloud text-gray-400', 'Light Rain': 'fa-cloud-rain text-blue-400' };
  document.getElementById('weatherPage').innerHTML = \`
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <div class="lg:col-span-2">
        <div class="card mb-5" style="background:linear-gradient(135deg,#1a4731,#2d6a4f);color:white">
          <div class="flex items-center justify-between">
            <div>
              <div class="text-green-200 text-sm"><i class="fas fa-map-marker-alt mr-1"></i>\${w.location}</div>
              <div class="text-6xl font-bold my-3">\${w.temperature}°C</div>
              <div class="text-xl text-green-100">\${w.condition}</div>
            </div>
            <i class="fas \${condIcons[w.condition] || 'fa-sun text-yellow-300'} text-6xl opacity-80"></i>
          </div>
          <div class="grid grid-cols-3 gap-4 mt-5 pt-4 border-t border-white/20 text-center">
            <div><div class="text-green-300 text-xs">Humidity</div><div class="text-xl font-bold">\${w.humidity}%</div></div>
            <div><div class="text-green-300 text-xs">Wind</div><div class="text-xl font-bold">\${w.windSpeed} km/h</div></div>
            <div><div class="text-green-300 text-xs">UV Index</div><div class="text-xl font-bold">\${w.uvIndex}</div></div>
          </div>
        </div>
        <div class="card">
          <h3 class="font-semibold mb-4" style="color:var(--green-dark)">5-Day Forecast</h3>
          <div class="grid grid-cols-5 gap-2">
            \${w.forecast.map(d => \`<div class="text-center p-2 rounded-xl" style="background:#f7faf7">
              <div class="text-xs font-medium text-gray-500">\${d.day}</div>
              <i class="fas \${condIcons[d.condition] || 'fa-sun text-yellow-300'} text-xl my-2 block"></i>
              <div class="text-sm font-bold text-gray-800">\${d.high}°</div>
              <div class="text-xs text-gray-400">\${d.low}°</div>
            </div>\`).join('')}
          </div>
        </div>
      </div>
      <div>
        <div class="card mb-4">
          <h3 class="font-semibold mb-3" style="color:var(--green-dark)"><i class="fas fa-leaf mr-2 text-green-500"></i>Farming Impact</h3>
          <div class="space-y-3">
            <div class="flex items-start gap-2 p-3 rounded-xl" style="background:#f0fdf4">
              <i class="fas fa-tint text-blue-500 mt-0.5"></i>
              <div><div class="text-sm font-medium">7-Day Rainfall</div><div class="text-xs text-gray-500">\${w.rainfall7d}mm received – adjust irrigation plan</div></div>
            </div>
            <div class="flex items-start gap-2 p-3 rounded-xl" style="background:#fffbeb">
              <i class="fas fa-sun text-yellow-500 mt-0.5"></i>
              <div><div class="text-sm font-medium">Evapotranspiration</div><div class="text-xs text-gray-500">High UV (\${w.uvIndex}) increases crop water demand</div></div>
            </div>
            <div class="flex items-start gap-2 p-3 rounded-xl" style="background:#eff6ff">
              <i class="fas fa-wind text-blue-400 mt-0.5"></i>
              <div><div class="text-sm font-medium">Wind Effect</div><div class="text-xs text-gray-500">\${w.windSpeed > 20 ? 'Strong winds – increase irrigation frequency' : 'Moderate wind – normal irrigation schedule'}</div></div>
            </div>
          </div>
        </div>
        <div class="card">
          <h3 class="font-semibold mb-3" style="color:var(--green-dark)"><i class="fas fa-calendar-alt mr-2 text-green-500"></i>Planting Calendar</h3>
          <div class="space-y-2 text-sm">
            <div class="flex justify-between py-1.5 border-b border-gray-50"><span>🌽 Maize</span><span class="text-xs text-gray-500 font-medium">Nov–Jan</span></div>
            <div class="flex justify-between py-1.5 border-b border-gray-50"><span>🍃 Tobacco</span><span class="text-xs text-gray-500 font-medium">Nov–Dec</span></div>
            <div class="flex justify-between py-1.5 border-b border-gray-50"><span>🫘 Soya Beans</span><span class="text-xs text-gray-500 font-medium">Nov–Dec</span></div>
            <div class="flex justify-between py-1.5"><span>🌾 Wheat</span><span class="text-xs text-gray-500 font-medium">Apr–Jun</span></div>
          </div>
        </div>
      </div>
    </div>
  \`;
}

// ═══ ANALYTICS PAGE ═══
async function loadAnalytics() {
  const data = await fetch('/api/analytics').then(r => r.json());
  document.getElementById('analyticsPage').innerHTML = \`
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      <div class="card text-center"><div class="text-3xl font-bold" style="color:var(--green-dark)">\${data.waterSaved}</div><div class="text-xs text-gray-500 mt-1">Water Saved</div><div class="text-xs font-medium text-green-600 mt-1">↓ vs manual</div></div>
      <div class="card text-center"><div class="text-3xl font-bold" style="color:var(--yellow)">\${data.yieldIncrease}</div><div class="text-xs text-gray-500 mt-1">Yield Increase</div><div class="text-xs font-medium text-yellow-600 mt-1">↑ vs last season</div></div>
      <div class="card text-center"><div class="text-3xl font-bold text-blue-600">\${data.costReduction}</div><div class="text-xs text-gray-500 mt-1">Cost Reduction</div><div class="text-xs font-medium text-blue-600 mt-1">↓ irrigation costs</div></div>
      <div class="card text-center"><div class="text-3xl font-bold text-purple-600">\${data.sensorUptime}</div><div class="text-xs text-gray-500 mt-1">Sensor Uptime</div><div class="text-xs font-medium text-purple-600 mt-1">Network health</div></div>
    </div>
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <div class="card">
        <h3 class="font-semibold mb-4" style="color:var(--green-dark)"><i class="fas fa-chart-bar mr-2" style="color:var(--green-light)"></i>Weekly Water Usage vs Rainfall</h3>
        <canvas id="waterChart" height="200"></canvas>
      </div>
      <div class="card">
        <h3 class="font-semibold mb-4" style="color:var(--green-dark)"><i class="fas fa-seedling mr-2" style="color:var(--green-light)"></i>Field Efficiency Score</h3>
        <canvas id="effChart" height="200"></canvas>
      </div>
    </div>
  \`;
  // Water usage chart
  const ctx1 = document.getElementById('waterChart').getContext('2d');
  new Chart(ctx1, {
    type: 'bar',
    data: {
      labels: data.weeklyData.map(d => d.week),
      datasets: [
        { label: 'Water Used (L)', data: data.weeklyData.map(d => d.waterUsed), backgroundColor: '#2d6a4f99', borderColor: '#2d6a4f', borderWidth: 1.5, borderRadius: 6 },
        { label: 'Rainfall (mm)', data: data.weeklyData.map(d => d.rainfall), backgroundColor: '#3b82f666', borderColor: '#3b82f6', borderWidth: 1.5, borderRadius: 6 }
      ]
    },
    options: { responsive:true, plugins:{legend:{labels:{font:{size:11},boxWidth:12}}}, scales:{y:{beginAtZero:true,ticks:{font:{size:10}}},x:{ticks:{font:{size:11}},grid:{display:false}}} }
  });
  // Efficiency chart
  const ctx2 = document.getElementById('effChart').getContext('2d');
  new Chart(ctx2, {
    type: 'radar',
    data: {
      labels: data.fieldPerformance.map(f => f.field.split('–')[1]?.trim() || f.field),
      datasets: [{
        label: 'Efficiency %', data: data.fieldPerformance.map(f => f.efficiency),
        backgroundColor: 'rgba(45,106,79,0.25)', borderColor: '#2d6a4f', borderWidth: 2, pointBackgroundColor: '#f4a61d'
      }]
    },
    options: { responsive:true, plugins:{legend:{labels:{font:{size:11}}}}, scales:{r:{beginAtZero:true,max:100,ticks:{font:{size:9}},grid:{color:'#e8f0e8'}}} }
  });
}

// ═══ DEVICES PAGE ═══
async function loadDevices() {
  const data = await fetch('/api/fields').then(r => r.json());
  const deviceModels = ['ESP32-WROOM-32', 'ESP32-S3', 'Arduino Mega 2560', 'ESP32-C3 Mini'];
  const comms = ['LoRaWAN 915MHz', 'GSM/GPRS 2G', 'LoRaWAN 868MHz', 'LoRaWAN + GSM'];
  document.getElementById('devicesPage').innerHTML = \`
    <div class="grid grid-cols-1 md:grid-cols-2 gap-5 mb-6">
      \${data.map((f,i) => {
        const online = f.sensor.batteryLevel > 20;
        const warn = f.sensor.batteryLevel < 60;
        const ringClass = !online ? 'device-offline' : warn ? 'device-warning' : 'device-online';
        const statusColor = !online ? '#ef4444' : warn ? '#f59e0b' : '#22c55e';
        const statusLabel = !online ? 'Offline' : warn ? 'Low Battery' : 'Online';
        return \`<div class="card \${ringClass}">
          <div class="flex items-start justify-between mb-4">
            <div>
              <div class="font-bold text-gray-800">Node \${f.id} – \${f.zone}</div>
              <div class="text-xs text-gray-500 mt-0.5">\${deviceModels[i]} · \${comms[i]}</div>
            </div>
            <span class="badge flex items-center gap-1.5" style="background:\${statusColor}22;color:\${statusColor}">
              <div class="w-1.5 h-1.5 rounded-full" style="background:\${statusColor}"></div>\${statusLabel}
            </span>
          </div>
          <div class="grid grid-cols-3 gap-3 mb-4">
            <div class="p-2.5 rounded-xl text-center" style="background:#f8faf8">
              <i class="fas fa-battery-three-quarters text-lg mb-1" style="color:\${warn ? '#f59e0b' : '#22c55e'}"></i>
              <div class="text-xs font-bold">\${f.sensor.batteryLevel}%</div>
              <div class="text-xs text-gray-400">Battery</div>
            </div>
            <div class="p-2.5 rounded-xl text-center" style="background:#f8faf8">
              <i class="fas fa-signal text-lg mb-1 text-purple-500"></i>
              <div class="text-xs font-bold">\${f.sensor.signalStrength} dBm</div>
              <div class="text-xs text-gray-400">Signal</div>
            </div>
            <div class="p-2.5 rounded-xl text-center" style="background:#f8faf8">
              <i class="fas fa-clock text-lg mb-1 text-blue-500"></i>
              <div class="text-xs font-bold">15 min</div>
              <div class="text-xs text-gray-400">Cycle</div>
            </div>
          </div>
          <div class="space-y-1.5 text-xs text-gray-600">
            <div class="flex justify-between"><span>Sensor:</span><span class="font-medium">Capacitive Soil v1.2 + DHT22</span></div>
            <div class="flex justify-between"><span>Power:</span><span class="font-medium">5V Solar + 18650 Li-ion</span></div>
            <div class="flex justify-between"><span>Field:</span><span class="font-medium">\${f.name}</span></div>
            <div class="flex justify-between"><span>Last ping:</span><span class="font-medium">\${f.sensor.timestamp.split('T')[1].slice(0,8)} UTC</span></div>
          </div>
          <div class="mt-3 flex gap-2">
            <button class="flex-1 text-xs py-1.5 rounded-lg border text-center" style="border-color:var(--green-light);color:var(--green-dark)" onclick="alert('Pinging node \${f.id}...')">Ping Device</button>
            <button class="flex-1 text-xs py-1.5 rounded-lg border text-center border-gray-200 text-gray-500" onclick="alert('Configuration panel for Node \${f.id}')">Configure</button>
          </div>
        </div>\`;
      }).join('')}
    </div>
    <!-- Sensor Diagram -->
    <div class="card">
      <h3 class="font-semibold mb-4" style="color:var(--green-dark)"><i class="fas fa-project-diagram mr-2" style="color:var(--yellow)"></i>Network Architecture</h3>
      <div class="flex items-center justify-center flex-wrap gap-4 py-4">
        <div class="text-center">
          <div class="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-2 text-2xl" style="background:#e8f5e9">🌱</div>
          <div class="text-xs font-medium">Soil Nodes</div>
          <div class="text-xs text-gray-400">ESP32 + Sensors</div>
        </div>
        <div class="text-gray-300 text-2xl">→</div>
        <div class="text-center">
          <div class="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-2 text-2xl" style="background:#e3f2fd">📡</div>
          <div class="text-xs font-medium">LoRa Gateway</div>
          <div class="text-xs text-gray-400">Up to 10km range</div>
        </div>
        <div class="text-gray-300 text-2xl">→</div>
        <div class="text-center">
          <div class="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-2 text-2xl" style="background:#fce4ec">☁️</div>
          <div class="text-xs font-medium">Cloud Server</div>
          <div class="text-xs text-gray-400">Data processing</div>
        </div>
        <div class="text-gray-300 text-2xl">→</div>
        <div class="text-center">
          <div class="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-2 text-2xl" style="background:#fff8e1">📱</div>
          <div class="text-xs font-medium">Dashboard</div>
          <div class="text-xs text-gray-400">Farmer alerts</div>
        </div>
      </div>
    </div>
  \`;
}

// ═══ MODALS & UTILITIES ═══
function showGuide() { document.getElementById('guideModal').classList.remove('hidden'); }
function showSettings() { document.getElementById('settingsModal').classList.remove('hidden'); }

async function refreshData() {
  const icon = document.getElementById('refreshIcon');
  icon.classList.add('fa-spin');
  await loadPage(currentPage);
  icon.classList.remove('fa-spin');
}

// ═══ INIT & AUTO-REFRESH ═══
document.addEventListener('DOMContentLoaded', () => {
  loadDashboard();
  // Auto-refresh every 15 minutes (matches sensor cycle)
  refreshInterval = setInterval(() => {
    if (currentPage === 'dashboard') loadDashboard();
    else loadPage(currentPage);
  }, 15 * 60 * 1000);
});
</script>
</body>
</html>`
}

export default app
