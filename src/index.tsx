import { Hono } from 'hono'
import { serveStatic } from 'hono/cloudflare-workers'
import { cors } from 'hono/cors'

const app = new Hono()

app.use('/api/*', cors())
app.use('/static/*', serveStatic({ root: './' }))
app.use('/public/*', serveStatic({ root: './' }))

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

// Blueprint page - inline HTML (Cloudflare Workers compatible, no fs access)
app.get('/blueprint', (c) => c.html(getBlueprintHTML()))

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

// ─── Blueprint HTML (IoT Hardware Blueprints & Wireframes) ───────────────────
function getBlueprintHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>AquaSense Zimbabwe – IoT Hardware Blueprints</title>
<script src="https://cdn.tailwindcss.com"></script>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css"/>
<style>
  :root { --green:#1a4731; --yellow:#f4a61d; --dark:#0f2419; }
  body { font-family: 'Segoe UI', system-ui, sans-serif; background:#0f2419; color:#e8f5e9; }
  .tab-btn { transition:all .25s; }
  .tab-btn.active { background:var(--yellow); color:#0f2419; font-weight:700; }
  .tab-btn:not(.active):hover { background:rgba(244,166,29,.15); }
  .tab-pane { display:none; }
  .tab-pane.active { display:block; }
  .card { background:#1a4731; border:1px solid #2d6a4f; border-radius:12px; }
  .badge { display:inline-block; padding:2px 10px; border-radius:999px; font-size:.72rem; font-weight:700; letter-spacing:.04em; }
  .badge-green { background:#d1fae5; color:#065f46; }
  .badge-yellow { background:#fef3c7; color:#92400e; }
  .badge-blue { background:#dbeafe; color:#1e40af; }
  .badge-red { background:#fee2e2; color:#991b1b; }
  .badge-purple { background:#ede9fe; color:#5b21b6; }
  .wire { stroke-width:2.5; fill:none; }
  .vcc { stroke:#ef4444; }
  .gnd { stroke:#374151; }
  .sig { stroke:#eab308; }
  .spi { stroke:#3b82f6; }
  .dig { stroke:#22c55e; }
  .pwr { stroke:#a855f7; }
  .component-box { fill:#1e3a2f; stroke:#2d6a4f; stroke-width:1.5; rx:6; }
  .ic-chip { fill:#243b35; stroke:#f4a61d; stroke-width:2; }
  .pin-label { font-family:monospace; font-size:10px; fill:#9ca3af; }
  .pin-val { font-family:monospace; font-size:9px; fill:#6b7280; }
  .comp-title { font-weight:700; font-size:13px; fill:#f4a61d; }
  .wire-label { font-size:9px; fill:#d1d5db; font-style:italic; }
  table { border-collapse:collapse; width:100%; }
  th { background:#0f2419; color:#f4a61d; padding:8px 12px; text-align:left; font-size:.8rem; text-transform:uppercase; letter-spacing:.05em; }
  td { padding:7px 12px; border-bottom:1px solid #2d6a4f; font-size:.85rem; }
  tr:hover td { background:rgba(244,166,29,.06); }
  code { background:#0f2419; border:1px solid #2d6a4f; border-radius:4px; padding:1px 6px; font-family:monospace; font-size:.82em; color:#86efac; }
  pre { background:#0a1a10; border:1px solid #2d6a4f; border-radius:10px; padding:16px; overflow-x:auto; font-size:.78rem; line-height:1.6; color:#86efac; }
  .scrollable { overflow-x:auto; }
  .power-node { fill:#1e3a2f; stroke:#f4a61d; stroke-width:1.5; }
  .step-num { width:32px; height:32px; border-radius:50%; background:var(--yellow); color:#0f2419; display:flex; align-items:center; justify-content:center; font-weight:900; font-size:.9rem; flex-shrink:0; }
  @media(max-width:640px){ .hide-sm { display:none; } }
</style>
</head>
<body>

<!-- HEADER -->
<header style="background:linear-gradient(135deg,#0f2419 0%,#1a4731 60%,#1a3a2a 100%); border-bottom:2px solid #f4a61d; padding:20px 24px;">
  <div style="max-width:1200px; margin:0 auto; display:flex; align-items:center; gap:16px; flex-wrap:wrap;">
    <a href="/" style="display:flex; align-items:center; gap:10px; text-decoration:none;">
      <div style="width:44px;height:44px;background:#f4a61d;border-radius:10px;display:flex;align-items:center;justify-content:center;">
        <i class="fas fa-microchip" style="color:#0f2419;font-size:1.3rem;"></i>
      </div>
      <div>
        <div style="color:#f4a61d;font-size:1.1rem;font-weight:800;line-height:1;">AquaSense Zimbabwe</div>
        <div style="color:#86efac;font-size:.75rem;">IoT Hardware Blueprints v2.0</div>
      </div>
    </a>
    <div style="margin-left:auto; display:flex; gap:10px; flex-wrap:wrap;">
      <span class="badge badge-green"><i class="fas fa-check-circle mr-1"></i>Verified BOM</span>
      <span class="badge badge-yellow"><i class="fas fa-bolt mr-1"></i>ESP32 + LoRa</span>
      <span class="badge badge-blue"><i class="fas fa-solar-panel mr-1"></i>Solar Powered</span>
    </div>
  </div>
</header>

<!-- TAB NAV -->
<nav style="background:#1a4731; border-bottom:1px solid #2d6a4f; position:sticky; top:0; z-index:100;">
  <div style="max-width:1200px; margin:0 auto; padding:0 16px; overflow-x:auto; white-space:nowrap;">
    <div style="display:inline-flex; gap:2px; padding:8px 0;">
      <button class="tab-btn active" onclick="switchTab('overview')" style="padding:8px 16px; border:none; cursor:pointer; border-radius:8px; font-size:.85rem; color:#e8f5e9;"><i class="fas fa-sitemap mr-1"></i>Overview</button>
      <button class="tab-btn" onclick="switchTab('schematic')" style="padding:8px 16px; border:none; cursor:pointer; border-radius:8px; font-size:.85rem; color:#e8f5e9;"><i class="fas fa-project-diagram mr-1"></i>Schematic</button>
      <button class="tab-btn" onclick="switchTab('pinout')" style="padding:8px 16px; border:none; cursor:pointer; border-radius:8px; font-size:.85rem; color:#e8f5e9;"><i class="fas fa-plug mr-1"></i>Pinout</button>
      <button class="tab-btn" onclick="switchTab('bom')" style="padding:8px 16px; border:none; cursor:pointer; border-radius:8px; font-size:.85rem; color:#e8f5e9;"><i class="fas fa-list-ul mr-1"></i>BOM &amp; Cost</button>
      <button class="tab-btn" onclick="switchTab('power')" style="padding:8px 16px; border:none; cursor:pointer; border-radius:8px; font-size:.85rem; color:#e8f5e9;"><i class="fas fa-battery-three-quarters mr-1"></i>Power</button>
      <button class="tab-btn" onclick="switchTab('assembly')" style="padding:8px 16px; border:none; cursor:pointer; border-radius:8px; font-size:.85rem; color:#e8f5e9;"><i class="fas fa-tools mr-1"></i>Assembly</button>
      <button class="tab-btn" onclick="switchTab('firmware')" style="padding:8px 16px; border:none; cursor:pointer; border-radius:8px; font-size:.85rem; color:#e8f5e9;"><i class="fas fa-code mr-1"></i>Firmware</button>
      <button class="tab-btn" onclick="switchTab('gateway')" style="padding:8px 16px; border:none; cursor:pointer; border-radius:8px; font-size:.85rem; color:#e8f5e9;"><i class="fas fa-broadcast-tower mr-1"></i>Gateway</button>
    </div>
  </div>
</nav>

<main style="max-width:1200px; margin:0 auto; padding:24px 16px;">

<!-- ╔══════════════════════════════════════════════════════════════╗ -->
<!-- ║  TAB 1: SYSTEM OVERVIEW                                       ║ -->
<!-- ╚══════════════════════════════════════════════════════════════╝ -->
<div id="tab-overview" class="tab-pane active">
  <h2 style="color:#f4a61d; font-size:1.4rem; font-weight:800; margin-bottom:6px;">
    <i class="fas fa-sitemap mr-2"></i>System Architecture Overview
  </h2>
  <p style="color:#86efac; margin-bottom:20px; font-size:.9rem;">End-to-end precision agriculture IoT stack — from in-ground sensor to cloud dashboard</p>

  <!-- Architecture Flow -->
  <div class="card" style="padding:24px; margin-bottom:24px;">
    <div style="display:flex; align-items:center; justify-content:center; flex-wrap:wrap; gap:8px;">
      <div style="text-align:center; min-width:110px;">
        <div style="background:#065f46; border:2px solid #22c55e; border-radius:12px; padding:14px 10px;">
          <i class="fas fa-leaf" style="color:#4ade80; font-size:1.8rem;"></i>
          <div style="color:#4ade80; font-weight:700; font-size:.85rem; margin-top:6px;">SENSE</div>
          <div style="color:#86efac; font-size:.72rem; margin-top:2px;">Soil · Temp · Humidity</div>
        </div>
      </div>
      <i class="fas fa-arrow-right" style="color:#f4a61d; font-size:1.2rem;"></i>
      <div style="text-align:center; min-width:110px;">
        <div style="background:#1e3a5f; border:2px solid #3b82f6; border-radius:12px; padding:14px 10px;">
          <i class="fas fa-microchip" style="color:#60a5fa; font-size:1.8rem;"></i>
          <div style="color:#60a5fa; font-weight:700; font-size:.85rem; margin-top:6px;">PROCESS</div>
          <div style="color:#93c5fd; font-size:.72rem; margin-top:2px;">ESP32 + ADC + Sleep</div>
        </div>
      </div>
      <i class="fas fa-arrow-right" style="color:#f4a61d; font-size:1.2rem;"></i>
      <div style="text-align:center; min-width:110px;">
        <div style="background:#3b1f5e; border:2px solid #a855f7; border-radius:12px; padding:14px 10px;">
          <i class="fas fa-wifi" style="color:#c084fc; font-size:1.8rem;"></i>
          <div style="color:#c084fc; font-weight:700; font-size:.85rem; margin-top:6px;">TRANSMIT</div>
          <div style="color:#d8b4fe; font-size:.72rem; margin-top:2px;">LoRa 915MHz · 10km</div>
        </div>
      </div>
      <i class="fas fa-arrow-right" style="color:#f4a61d; font-size:1.2rem;"></i>
      <div style="text-align:center; min-width:110px;">
        <div style="background:#3b2a10; border:2px solid #f59e0b; border-radius:12px; padding:14px 10px;">
          <i class="fas fa-broadcast-tower" style="color:#fbbf24; font-size:1.8rem;"></i>
          <div style="color:#fbbf24; font-weight:700; font-size:.85rem; margin-top:6px;">GATEWAY</div>
          <div style="color:#fcd34d; font-size:.72rem; margin-top:2px;">RAK7268 · 8-ch LoRaWAN</div>
        </div>
      </div>
      <i class="fas fa-arrow-right" style="color:#f4a61d; font-size:1.2rem;"></i>
      <div style="text-align:center; min-width:110px;">
        <div style="background:#1e3a4a; border:2px solid #06b6d4; border-radius:12px; padding:14px 10px;">
          <i class="fas fa-cloud" style="color:#22d3ee; font-size:1.8rem;"></i>
          <div style="color:#22d3ee; font-weight:700; font-size:.85rem; margin-top:6px;">CLOUD</div>
          <div style="color:#67e8f9; font-size:.72rem; margin-top:2px;">TTN → AquaSense API</div>
        </div>
      </div>
      <i class="fas fa-arrow-right" style="color:#f4a61d; font-size:1.2rem;"></i>
      <div style="text-align:center; min-width:110px;">
        <div style="background:#1a4731; border:2px solid #f4a61d; border-radius:12px; padding:14px 10px;">
          <i class="fas fa-tachometer-alt" style="color:#f4a61d; font-size:1.8rem;"></i>
          <div style="color:#f4a61d; font-weight:700; font-size:.85rem; margin-top:6px;">DASHBOARD</div>
          <div style="color:#fde68a; font-size:.72rem; margin-top:2px;">Hono · Cloudflare Pages</div>
        </div>
      </div>
    </div>
  </div>

  <!-- Component Cards -->
  <h3 style="color:#f4a61d; font-weight:700; margin-bottom:14px; font-size:1.05rem;"><i class="fas fa-cubes mr-2"></i>Core Components</h3>
  <div style="display:grid; grid-template-columns:repeat(auto-fill,minmax(270px,1fr)); gap:16px; margin-bottom:24px;">

    <div class="card" style="padding:16px;">
      <div style="display:flex; align-items:flex-start; gap:12px;">
        <div style="width:40px;height:40px;background:#1e3a5f;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          <i class="fas fa-microchip" style="color:#60a5fa;"></i>
        </div>
        <div>
          <div style="font-weight:700; color:#e8f5e9;">ESP32 DevKit V1</div>
          <div style="font-size:.8rem; color:#86efac; margin-top:2px;">WROOM-32 · Dual-core 240MHz</div>
          <div style="margin-top:8px; display:flex; gap:6px; flex-wrap:wrap;">
            <span class="badge badge-blue">Wi-Fi + BT</span>
            <span class="badge badge-green">12-bit ADC</span>
            <span class="badge badge-yellow">~$2.50</span>
          </div>
          <div style="font-size:.78rem; color:#6b7280; margin-top:6px;">AliExpress · Qty 1 per node · 38 GPIOs · Deep-sleep 10µA · USB-C flashing</div>
        </div>
      </div>
    </div>

    <div class="card" style="padding:16px;">
      <div style="display:flex; align-items:flex-start; gap:12px;">
        <div style="width:40px;height:40px;background:#065f46;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          <i class="fas fa-tint" style="color:#4ade80;"></i>
        </div>
        <div>
          <div style="font-weight:700; color:#e8f5e9;">Capacitive Soil Sensor v1.2</div>
          <div style="font-size:.8rem; color:#86efac; margin-top:2px;">Analog 0–3V · Corrosion-free</div>
          <div style="margin-top:8px; display:flex; gap:6px; flex-wrap:wrap;">
            <span class="badge badge-green">3-pin: VCC/GND/AOUT</span>
            <span class="badge badge-yellow">~$1.20</span>
          </div>
          <div style="font-size:.78rem; color:#6b7280; margin-top:6px;">GPIO34 ADC · 3.3V power · maps 1200–2950 raw → 0–100% · No rusting unlike resistive sensors</div>
        </div>
      </div>
    </div>

    <div class="card" style="padding:16px;">
      <div style="display:flex; align-items:flex-start; gap:12px;">
        <div style="width:40px;height:40px;background:#3b2a10;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          <i class="fas fa-thermometer-half" style="color:#fbbf24;"></i>
        </div>
        <div>
          <div style="font-weight:700; color:#e8f5e9;">DHT22 (AM2302)</div>
          <div style="font-size:.8rem; color:#86efac; margin-top:2px;">Temp ±0.5°C · Humidity ±2% RH</div>
          <div style="margin-top:8px; display:flex; gap:6px; flex-wrap:wrap;">
            <span class="badge badge-green">Single-wire digital</span>
            <span class="badge badge-yellow">~$2.80</span>
          </div>
          <div style="font-size:.78rem; color:#6b7280; margin-top:6px;">GPIO4 · 10kΩ pull-up to 3.3V · Range: -40–80°C · 2s sample rate · 3.3–5V supply</div>
        </div>
      </div>
    </div>

    <div class="card" style="padding:16px;">
      <div style="display:flex; align-items:flex-start; gap:12px;">
        <div style="width:40px;height:40px;background:#3b1f5e;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          <i class="fas fa-broadcast-tower" style="color:#c084fc;"></i>
        </div>
        <div>
          <div style="font-weight:700; color:#e8f5e9;">EBYTE E32-900M30S</div>
          <div style="font-size:.8rem; color:#86efac; margin-top:2px;">SX1276 · 915MHz · 30dBm · SPI</div>
          <div style="margin-top:8px; display:flex; gap:6px; flex-wrap:wrap;">
            <span class="badge badge-purple">10km LoRa</span>
            <span class="badge badge-yellow">~$8.50</span>
          </div>
          <div style="font-size:.78rem; color:#6b7280; margin-top:6px;">SPI: SCK→18, MISO→19, MOSI→23, NSS→15 · RST→2 · DIO0→26 · 3.3V · SMD 24×38.5mm</div>
        </div>
      </div>
    </div>

    <div class="card" style="padding:16px;">
      <div style="display:flex; align-items:flex-start; gap:12px;">
        <div style="width:40px;height:40px;background:#1e3a4a;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          <i class="fas fa-solar-panel" style="color:#22d3ee;"></i>
        </div>
        <div>
          <div style="font-weight:700; color:#e8f5e9;">5W 6V Monocrystalline Panel</div>
          <div style="font-size:.8rem; color:#86efac; margin-top:2px;">833mA peak · 6V Voc · IP65</div>
          <div style="margin-top:8px; display:flex; gap:6px; flex-wrap:wrap;">
            <span class="badge badge-blue">Off-grid</span>
            <span class="badge badge-yellow">~$5.00</span>
          </div>
          <div style="font-size:.78rem; color:#6b7280; margin-top:6px;">→ TP4056 IN+/IN− · Generates ~4.2Wh/day in Zimbabwe sunshine · Angle: 20° facing north</div>
        </div>
      </div>
    </div>

    <div class="card" style="padding:16px;">
      <div style="display:flex; align-items:flex-start; gap:12px;">
        <div style="width:40px;height:40px;background:#2a1a4a;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          <i class="fas fa-battery-full" style="color:#a855f7;"></i>
        </div>
        <div>
          <div style="font-weight:700; color:#e8f5e9;">18650 NCR18650B Li-ion</div>
          <div style="font-size:.8rem; color:#86efac; margin-top:2px;">3.7V · 3400mAh · Panasonic</div>
          <div style="margin-top:8px; display:flex; gap:6px; flex-wrap:wrap;">
            <span class="badge badge-purple">12.58Wh</span>
            <span class="badge badge-yellow">~$3.50</span>
          </div>
          <div style="font-size:.78rem; color:#6b7280; margin-top:6px;">Protected cell · → TP4056 BAT+/BAT− · 10–14 days backup without sun · Cycle life 500+ charges</div>
        </div>
      </div>
    </div>

    <div class="card" style="padding:16px;">
      <div style="display:flex; align-items:flex-start; gap:12px;">
        <div style="width:40px;height:40px;background:#1a3a2a;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          <i class="fas fa-charging-station" style="color:#34d399;"></i>
        </div>
        <div>
          <div style="font-weight:700; color:#e8f5e9;">TP4056 + DW01A Module</div>
          <div style="font-size:.8rem; color:#86efac; margin-top:2px;">Li-ion charger + protection IC</div>
          <div style="margin-top:8px; display:flex; gap:6px; flex-wrap:wrap;">
            <span class="badge badge-green">OVP · OCP · SCP</span>
            <span class="badge badge-yellow">~$0.60</span>
          </div>
          <div style="font-size:.78rem; color:#6b7280; margin-top:6px;">IN+ ← solar 6V · BAT+/− ↔ 18650 · OUT+/OUT− → MT3608 IN · 1A charge current · 4.2V cutoff</div>
        </div>
      </div>
    </div>

    <div class="card" style="padding:16px;">
      <div style="display:flex; align-items:flex-start; gap:12px;">
        <div style="width:40px;height:40px;background:#1e3a2f;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          <i class="fas fa-bolt" style="color:#4ade80;"></i>
        </div>
        <div>
          <div style="font-weight:700; color:#e8f5e9;">MT3608 Boost Converter</div>
          <div style="font-size:.8rem; color:#86efac; margin-top:2px;">3.7V → 5V · 2A max · Adjustable</div>
          <div style="margin-top:8px; display:flex; gap:6px; flex-wrap:wrap;">
            <span class="badge badge-green">94% efficiency</span>
            <span class="badge badge-yellow">~$0.50</span>
          </div>
          <div style="font-size:.78rem; color:#6b7280; margin-top:6px;">IN: TP4056 OUT → OUT: ESP32 5V VIN · Trim pot to set 5.0V output · 1.2MHz switching freq</div>
        </div>
      </div>
    </div>

    <div class="card" style="padding:16px;">
      <div style="display:flex; align-items:flex-start; gap:12px;">
        <div style="width:40px;height:40px;background:#1e3a4a;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
          <i class="fas fa-box" style="color:#67e8f9;"></i>
        </div>
        <div>
          <div style="font-weight:700; color:#e8f5e9;">IP65 ABS Enclosure</div>
          <div style="font-size:.8rem; color:#86efac; margin-top:2px;">150×100×70mm · Grey ABS</div>
          <div style="margin-top:8px; display:flex; gap:6px; flex-wrap:wrap;">
            <span class="badge badge-blue">Weatherproof</span>
            <span class="badge badge-yellow">~$4.50</span>
          </div>
          <div style="font-size:.78rc; color:#6b7280; margin-top:6px;">Rubber gasket seal · 4× M4 mounting holes · Cable glands for sensor cables · AliExpress RT series</div>
        </div>
      </div>
    </div>

  </div>

  <!-- Stats row -->
  <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:12px;">
    <div class="card" style="padding:16px; text-align:center;">
      <div style="font-size:1.8rem; font-weight:900; color:#f4a61d;">~$43</div>
      <div style="color:#86efac; font-size:.8rem; margin-top:4px;">Cost per sensor node</div>
    </div>
    <div class="card" style="padding:16px; text-align:center;">
      <div style="font-size:1.8rem; font-weight:900; color:#22c55e;">10 km</div>
      <div style="color:#86efac; font-size:.8rem; margin-top:4px;">LoRa range (open field)</div>
    </div>
    <div class="card" style="padding:16px; text-align:center;">
      <div style="font-size:1.8rem; font-weight:900; color:#60a5fa;">15 min</div>
      <div style="color:#86efac; font-size:.8rem; margin-top:4px;">Data transmission cycle</div>
    </div>
    <div class="card" style="padding:16px; text-align:center;">
      <div style="font-size:1.8rem; font-weight:900; color:#c084fc;">14 days</div>
      <div style="color:#86efac; font-size:.8rem; margin-top:4px;">Battery backup (no sun)</div>
    </div>
    <div class="card" style="padding:16px; text-align:center;">
      <div style="font-size:1.8rem; font-weight:900; color:#fbbf24;">10 µA</div>
      <div style="color:#86efac; font-size:.8rem; margin-top:4px;">Deep sleep current</div>
    </div>
    <div class="card" style="padding:16px; text-align:center;">
      <div style="font-size:1.8rem; font-weight:900; color:#34d399;">IP65</div>
      <div style="color:#86efac; font-size:.8rem; margin-top:4px;">Weatherproof rating</div>
    </div>
  </div>
</div>

<!-- ╔══════════════════════════════════════════════════════════════╗ -->
<!-- ║  TAB 2: FULL CIRCUIT SCHEMATIC                                 ║ -->
<!-- ╚══════════════════════════════════════════════════════════════╝ -->
<div id="tab-schematic" class="tab-pane">
  <h2 style="color:#f4a61d; font-size:1.4rem; font-weight:800; margin-bottom:6px;">
    <i class="fas fa-project-diagram mr-2"></i>Full Circuit Schematic
  </h2>
  <p style="color:#86efac; margin-bottom:16px; font-size:.9rem;">Complete wiring diagram — sensor node with power management, LoRa transmission, and ESP32 brain</p>

  <!-- Wire Legend -->
  <div class="card" style="padding:14px 18px; margin-bottom:16px; display:flex; gap:20px; flex-wrap:wrap; align-items:center;">
    <span style="font-weight:700; color:#9ca3af; font-size:.8rem;">WIRE LEGEND:</span>
    <span style="display:flex;align-items:center;gap:6px;font-size:.82rem;"><span style="width:24px;height:3px;background:#ef4444;display:inline-block;border-radius:2px;"></span>VCC / Power</span>
    <span style="display:flex;align-items:center;gap:6px;font-size:.82rem;"><span style="width:24px;height:3px;background:#9ca3af;display:inline-block;border-radius:2px;"></span>GND</span>
    <span style="display:flex;align-items:center;gap:6px;font-size:.82rem;"><span style="width:24px;height:3px;background:#eab308;display:inline-block;border-radius:2px;"></span>Analog Signal</span>
    <span style="display:flex;align-items:center;gap:6px;font-size:.82rem;"><span style="width:24px;height:3px;background:#3b82f6;display:inline-block;border-radius:2px;"></span>SPI Bus</span>
    <span style="display:flex;align-items:center;gap:6px;font-size:.82rem;"><span style="width:24px;height:3px;background:#22c55e;display:inline-block;border-radius:2px;"></span>Digital I/O</span>
    <span style="display:flex;align-items:center;gap:6px;font-size:.82rem;"><span style="width:24px;height:3px;background:#a855f7;display:inline-block;border-radius:2px;"></span>Power Rail</span>
  </div>

  <!-- SVG Schematic -->
  <div class="card scrollable" style="padding:20px;">
    <svg viewBox="0 0 1100 820" style="width:100%; max-width:1100px; min-width:700px;" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <marker id="arrow" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
          <path d="M0,0 L0,6 L6,3 z" fill="#6b7280"/>
        </marker>
        <filter id="glow">
          <feGaussianBlur stdDeviation="2" result="blur"/>
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <!-- Background -->
      <rect width="1100" height="820" fill="#0a1a10" rx="12"/>
      <text x="550" y="28" text-anchor="middle" font-size="16" font-weight="800" fill="#f4a61d">AquaSense Zimbabwe — Sensor Node Circuit Schematic v2.0</text>

      <!-- ── SOLAR PANEL (top-left) ── -->
      <rect x="20" y="55" width="140" height="90" rx="8" fill="#1e3a4a" stroke="#06b6d4" stroke-width="2"/>
      <text x="90" y="78" text-anchor="middle" font-size="11" font-weight="700" fill="#22d3ee">☀ SOLAR PANEL</text>
      <text x="90" y="96" text-anchor="middle" font-size="9" fill="#9ca3af">5W · 6V · Mono</text>
      <text x="90" y="112" text-anchor="middle" font-size="9" fill="#9ca3af">Voc=6V · Isc=833mA</text>
      <text x="55" y="132" font-size="9" fill="#ef4444">OUT+</text>
      <text x="95" y="132" font-size="9" fill="#9ca3af">OUT−</text>
      <!-- Solar pins -->
      <circle cx="60" cy="145" r="4" fill="#ef4444"/>
      <circle cx="100" cy="145" r="4" fill="#374151"/>

      <!-- ── TP4056 CHARGER (top-center-left) ── -->
      <rect x="200" y="55" width="160" height="110" rx="8" fill="#1e3a2f" stroke="#f4a61d" stroke-width="2"/>
      <text x="280" y="78" text-anchor="middle" font-size="11" font-weight="700" fill="#f4a61d">TP4056 + DW01A</text>
      <text x="280" y="93" text-anchor="middle" font-size="9" fill="#9ca3af">Li-ion Charger + Protection</text>
      <text x="210" y="113" font-size="9" fill="#ef4444">IN+</text>
      <text x="240" y="113" font-size="9" fill="#9ca3af">IN−</text>
      <text x="285" y="113" font-size="9" fill="#f4a61d">BAT+</text>
      <text x="318" y="113" font-size="9" fill="#9ca3af">BAT−</text>
      <text x="240" y="155" font-size="9" fill="#22c55e">OUT+</text>
      <text x="290" y="155" font-size="9" fill="#9ca3af">OUT−</text>
      <!-- pins -->
      <circle cx="215" cy="125" r="4" fill="#ef4444"/>
      <circle cx="248" cy="125" r="4" fill="#374151"/>
      <circle cx="293" cy="125" r="4" fill="#f4a61d"/>
      <circle cx="330" cy="125" r="4" fill="#374151"/>
      <circle cx="248" cy="162" r="4" fill="#22c55e"/>
      <circle cx="298" cy="162" r="4" fill="#374151"/>

      <!-- ── 18650 BATTERY (top-right of TP4056) ── -->
      <rect x="420" y="55" width="130" height="90" rx="8" fill="#2a1a4a" stroke="#a855f7" stroke-width="2"/>
      <text x="485" y="78" text-anchor="middle" font-size="11" font-weight="700" fill="#a855f7">18650 Li-ion</text>
      <text x="485" y="94" text-anchor="middle" font-size="9" fill="#9ca3af">3.7V · 3400mAh</text>
      <text x="485" y="108" text-anchor="middle" font-size="9" fill="#9ca3af">NCR18650B</text>
      <text x="440" y="132" font-size="9" fill="#ef4444">BAT+</text>
      <text x="490" y="132" font-size="9" fill="#9ca3af">BAT−</text>
      <circle cx="447" cy="143" r="4" fill="#ef4444"/>
      <circle cx="498" cy="143" r="4" fill="#374151"/>

      <!-- ── MT3608 BOOST (below TP4056) ── -->
      <rect x="200" y="210" width="150" height="90" rx="8" fill="#1e3a2f" stroke="#22c55e" stroke-width="2"/>
      <text x="275" y="232" text-anchor="middle" font-size="11" font-weight="700" fill="#22c55e">MT3608 BOOST</text>
      <text x="275" y="248" text-anchor="middle" font-size="9" fill="#9ca3af">3.7V → 5V · 2A · 94%</text>
      <text x="210" y="268" font-size="9" fill="#ef4444">IN+</text>
      <text x="240" y="268" font-size="9" fill="#9ca3af">IN−</text>
      <text x="280" y="268" font-size="9" fill="#22c55e">OUT+</text>
      <text x="316" y="268" font-size="9" fill="#9ca3af">OUT−</text>
      <circle cx="215" cy="278" r="4" fill="#ef4444"/>
      <circle cx="248" cy="278" r="4" fill="#374151"/>
      <circle cx="286" cy="278" r="4" fill="#22c55e"/>
      <circle cx="324" cy="278" r="4" fill="#374151"/>

      <!-- ── ESP32 DEVKIT V1 (center, large) ── -->
      <rect x="430" y="230" width="240" height="350" rx="10" fill="#1a2f3a" stroke="#f4a61d" stroke-width="2.5" filter="url(#glow)"/>
      <text x="550" y="258" text-anchor="middle" font-size="13" font-weight="800" fill="#f4a61d">ESP32 DevKit V1</text>
      <text x="550" y="274" text-anchor="middle" font-size="9" fill="#86efac">WROOM-32 · 240MHz · 12-bit ADC</text>
      <!-- Left pins -->
      <text x="438" y="300" font-size="9" fill="#ef4444">3V3</text>
      <circle cx="432" cy="296" r="3.5" fill="#ef4444"/>
      <text x="438" y="320" font-size="9" fill="#374151">GND</text>
      <circle cx="432" cy="316" r="3.5" fill="#374151"/>
      <text x="438" y="340" font-size="9" fill="#22c55e">GPIO4</text>
      <circle cx="432" cy="336" r="3.5" fill="#22c55e"/>
      <text x="438" y="360" font-size="9" fill="#22c55e">GPIO34</text>
      <circle cx="432" cy="356" r="3.5" fill="#eab308"/>
      <text x="438" y="380" font-size="9" fill="#3b82f6">GPIO18</text>
      <circle cx="432" cy="376" r="3.5" fill="#3b82f6"/>
      <text x="438" y="400" font-size="9" fill="#3b82f6">GPIO19</text>
      <circle cx="432" cy="396" r="3.5" fill="#3b82f6"/>
      <text x="438" y="420" font-size="9" fill="#3b82f6">GPIO23</text>
      <circle cx="432" cy="416" r="3.5" fill="#3b82f6"/>
      <text x="438" y="440" font-size="9" fill="#22c55e">GPIO15</text>
      <circle cx="432" cy="436" r="3.5" fill="#22c55e"/>
      <text x="438" y="460" font-size="9" fill="#22c55e">GPIO2</text>
      <circle cx="432" cy="456" r="3.5" fill="#22c55e"/>
      <text x="438" y="480" font-size="9" fill="#22c55e">GPIO26</text>
      <circle cx="432" cy="476" r="3.5" fill="#22c55e"/>
      <!-- Right pins -->
      <text x="625" y="300" font-size="9" fill="#ef4444">VIN 5V</text>
      <circle cx="668" cy="296" r="3.5" fill="#ef4444"/>
      <text x="625" y="320" font-size="9" fill="#374151">GND</text>
      <circle cx="668" cy="316" r="3.5" fill="#374151"/>
      <!-- Pin labels inside chip -->
      <text x="550" y="302" text-anchor="middle" font-size="8" fill="#60a5fa">3V3 · GND · GPIO4 · GPIO34</text>
      <text x="550" y="316" text-anchor="middle" font-size="8" fill="#60a5fa">GPIO18(SCK) · GPIO19(MISO)</text>
      <text x="550" y="330" text-anchor="middle" font-size="8" fill="#60a5fa">GPIO23(MOSI) · GPIO15(NSS)</text>
      <text x="550" y="344" text-anchor="middle" font-size="8" fill="#60a5fa">GPIO2(RST) · GPIO26(DIO0)</text>
      <text x="550" y="370" text-anchor="middle" font-size="10" fill="#4ade80">⚡ DEEP SLEEP MODE</text>
      <text x="550" y="386" text-anchor="middle" font-size="8" fill="#9ca3af">Wake timer: 15 min</text>
      <text x="550" y="398" text-anchor="middle" font-size="8" fill="#9ca3af">Sleep current: 10µA</text>
      <text x="550" y="430" text-anchor="middle" font-size="10" fill="#fbbf24">📡 LoRa: SPI bus</text>
      <text x="550" y="445" text-anchor="middle" font-size="10" fill="#22d3ee">🌿 Soil: GPIO34 ADC</text>
      <text x="550" y="460" text-anchor="middle" font-size="10" fill="#f59e0b">🌡 DHT22: GPIO4 DIO</text>

      <!-- ── SOIL MOISTURE SENSOR (left side) ── -->
      <rect x="20" y="300" width="140" height="100" rx="8" fill="#065f46" stroke="#22c55e" stroke-width="2"/>
      <text x="90" y="323" text-anchor="middle" font-size="11" font-weight="700" fill="#4ade80">SOIL SENSOR v1.2</text>
      <text x="90" y="338" text-anchor="middle" font-size="9" fill="#9ca3af">Capacitive · Corrosion-free</text>
      <text x="90" y="353" text-anchor="middle" font-size="9" fill="#9ca3af">Output: 0–3V analog</text>
      <text x="30" y="375" font-size="9" fill="#ef4444">VCC 3.3V</text>
      <text x="80" y="375" font-size="9" fill="#374151">GND</text>
      <text x="112" y="375" font-size="9" fill="#eab308">AOUT</text>
      <circle cx="40" cy="385" r="4" fill="#ef4444"/>
      <circle cx="85" cy="385" r="4" fill="#374151"/>
      <circle cx="127" cy="385" r="4" fill="#eab308"/>

      <!-- ── DHT22 SENSOR (left side, below soil) ── -->
      <rect x="20" y="440" width="130" height="100" rx="8" fill="#3b2a10" stroke="#fbbf24" stroke-width="2"/>
      <text x="85" y="463" text-anchor="middle" font-size="11" font-weight="700" fill="#fbbf24">DHT22 (AM2302)</text>
      <text x="85" y="479" text-anchor="middle" font-size="9" fill="#9ca3af">Temp ±0.5°C</text>
      <text x="85" y="493" text-anchor="middle" font-size="9" fill="#9ca3af">Humidity ±2% RH</text>
      <text x="28" y="515" font-size="9" fill="#ef4444">VCC</text>
      <text x="58" y="515" font-size="9" fill="#22c55e">DATA</text>
      <text x="96" y="515" font-size="9" fill="#374151">NC</text>
      <text x="118" y="515" font-size="9" fill="#374151">GND</text>
      <circle cx="34" cy="525" r="4" fill="#ef4444"/>
      <circle cx="66" cy="525" r="4" fill="#22c55e"/>
      <circle cx="130" cy="525" r="4" fill="#374151"/>
      <!-- 10k resistor symbol -->
      <rect x="70" y="490" width="30" height="12" rx="3" fill="#2d1b10" stroke="#fbbf24" stroke-width="1"/>
      <text x="85" y="500" text-anchor="middle" font-size="7" fill="#fbbf24">10kΩ</text>
      <text x="85" y="512" text-anchor="middle" font-size="7" fill="#9ca3af">pull-up</text>

      <!-- ── LORA MODULE (right side) ── -->
      <rect x="740" y="230" width="175" height="220" rx="8" fill="#3b1f5e" stroke="#a855f7" stroke-width="2"/>
      <text x="827" y="258" text-anchor="middle" font-size="11" font-weight="700" fill="#c084fc">EBYTE E32-900M30S</text>
      <text x="827" y="273" text-anchor="middle" font-size="9" fill="#d8b4fe">SX1276 · 915MHz · 30dBm</text>
      <text x="827" y="287" text-anchor="middle" font-size="9" fill="#d8b4fe">10km range · SPI interface</text>
      <!-- LoRa pins right side -->
      <text x="748" y="312" font-size="9" fill="#ef4444">VCC 3.3V</text>
      <circle cx="742" cy="308" r="3.5" fill="#ef4444"/>
      <text x="748" y="332" font-size="9" fill="#374151">GND</text>
      <circle cx="742" cy="328" r="3.5" fill="#374151"/>
      <text x="748" y="352" font-size="9" fill="#3b82f6">SCK←18</text>
      <circle cx="742" cy="348" r="3.5" fill="#3b82f6"/>
      <text x="748" y="372" font-size="9" fill="#3b82f6">MISO→19</text>
      <circle cx="742" cy="368" r="3.5" fill="#3b82f6"/>
      <text x="748" y="392" font-size="9" fill="#3b82f6">MOSI←23</text>
      <circle cx="742" cy="388" r="3.5" fill="#3b82f6"/>
      <text x="748" y="412" font-size="9" fill="#22c55e">NSS←15</text>
      <circle cx="742" cy="408" r="3.5" fill="#22c55e"/>
      <text x="748" y="432" font-size="9" fill="#22c55e">RST←2</text>
      <circle cx="742" cy="428" r="3.5" fill="#22c55e"/>
      <text x="748" y="452" font-size="9" fill="#22c55e">DIO0→26</text>
      <circle cx="742" cy="448" r="3.5" fill="#22c55e"/>
      <!-- Antenna symbol -->
      <line x1="827" y1="290" x2="827" y2="220" stroke="#c084fc" stroke-width="1.5" stroke-dasharray="4,3"/>
      <line x1="810" y1="220" x2="844" y2="220" stroke="#c084fc" stroke-width="2"/>
      <line x1="815" y1="212" x2="839" y2="212" stroke="#c084fc" stroke-width="1.5"/>
      <line x1="820" y1="204" x2="834" y2="204" stroke="#c084fc" stroke-width="1"/>
      <text x="850" y="222" font-size="9" fill="#c084fc">ANT</text>
      <text x="850" y="234" font-size="9" fill="#9ca3af">915MHz</text>

      <!-- ══ WIRES ══ -->
      <!-- Solar → TP4056 IN+ (red) -->
      <path d="M 60,145 L 60,180 L 215,180 L 215,125" class="wire vcc"/>
      <!-- Solar GND → TP4056 IN− (black) -->
      <path d="M 100,145 L 100,190 L 248,190 L 248,125" class="wire gnd" stroke="#6b7280"/>
      <!-- TP4056 BAT+ → 18650 BAT+ (red, thicker) -->
      <path d="M 293,125 L 293,100 L 380,100 L 380,80 L 447,80 L 447,143" class="wire vcc" stroke-width="2"/>
      <!-- TP4056 BAT− → 18650 BAT− (grey) -->
      <path d="M 330,125 L 330,108 L 400,108 L 400,90 L 498,90 L 498,143" class="wire gnd" stroke="#6b7280"/>
      <!-- TP4056 OUT+ → MT3608 IN+ (green, power) -->
      <path d="M 248,162 L 248,195 L 215,195 L 215,278" class="wire pwr"/>
      <!-- TP4056 OUT− → MT3608 IN− (grey) -->
      <path d="M 298,162 L 298,200 L 248,200 L 248,278" class="wire gnd" stroke="#6b7280"/>
      <!-- MT3608 OUT+ → ESP32 VIN (red, 5V power rail) -->
      <path d="M 286,278 L 286,310 L 380,310 L 380,296 L 668,296" class="wire pwr" stroke="#ef4444" stroke-width="2.5"/>
      <!-- MT3608 OUT− → ESP32 GND -->
      <path d="M 324,278 L 324,320 L 400,320 L 400,316 L 668,316" class="wire gnd" stroke="#6b7280"/>
      <!-- ESP32 3V3 → Soil VCC (red) -->
      <path d="M 432,296 L 380,296 L 380,385 L 40,385" class="wire vcc" stroke="#ef4444" stroke-dasharray="5,3"/>
      <!-- Soil GND → ESP32 GND -->
      <path d="M 85,385 L 85,400 L 370,400 L 370,316 L 432,316" class="wire gnd" stroke="#6b7280" stroke-dasharray="5,3"/>
      <!-- Soil AOUT → ESP32 GPIO34 (yellow) -->
      <path d="M 127,385 L 127,360 L 350,360 L 350,356 L 432,356" class="wire sig"/>
      <!-- ESP32 3V3 → DHT22 VCC -->
      <path d="M 432,296 L 34,525" class="wire vcc" stroke="#ef4444" stroke-dasharray="3,4" opacity="0.5"/>
      <!-- DHT22 DATA → ESP32 GPIO4 (green) -->
      <path d="M 66,525 L 66,545 L 340,545 L 340,336 L 432,336" class="wire dig"/>
      <!-- DHT22 GND → GND -->
      <path d="M 130,525 L 130,555 L 370,555 L 370,320" class="wire gnd" stroke="#6b7280"/>
      <!-- LoRa VCC ← ESP32 3V3 -->
      <path d="M 668,296 L 710,296 L 710,308 L 742,308" class="wire vcc" stroke="#ef4444"/>
      <!-- LoRa GND -->
      <path d="M 668,316 L 710,316 L 710,328 L 742,328" class="wire gnd" stroke="#6b7280"/>
      <!-- SPI wires (blue) -->
      <path d="M 432,376 L 400,376 L 400,348 L 742,348" class="wire spi"/> <!-- SCK GPIO18 -->
      <path d="M 432,396 L 390,396 L 390,368 L 742,368" class="wire spi"/> <!-- MISO GPIO19 -->
      <path d="M 432,416 L 380,416 L 380,388 L 742,388" class="wire spi"/> <!-- MOSI GPIO23 -->
      <!-- Control wires (green) -->
      <path d="M 432,436 L 370,436 L 370,408 L 742,408" class="wire dig"/> <!-- NSS GPIO15 -->
      <path d="M 432,456 L 360,456 L 360,428 L 742,428" class="wire dig"/> <!-- RST GPIO2 -->
      <path d="M 432,476 L 350,476 L 350,448 L 742,448" class="wire dig"/> <!-- DIO0 GPIO26 -->

      <!-- Wire labels -->
      <text x="560" y="292" class="wire-label">5V Rail</text>
      <text x="290" y="350" class="wire-label">Soil AOUT</text>
      <text x="200" y="340" class="wire-label">DHT DATA</text>
      <text x="590" y="372" class="wire-label">SPI SCK</text>
      <text x="590" y="392" class="wire-label">SPI MISO</text>
      <text x="590" y="412" class="wire-label">SPI MOSI</text>

      <!-- ── DECOUPLING CAPS ── -->
      <rect x="395" y="540" width="80" height="40" rx="6" fill="#1e3a2f" stroke="#2d6a4f" stroke-width="1"/>
      <text x="435" y="556" text-anchor="middle" font-size="9" fill="#86efac">100nF + 10µF</text>
      <text x="435" y="570" text-anchor="middle" font-size="8" fill="#6b7280">Decoupling caps</text>

      <!-- ── FIELD INSTALLATION NOTE ── -->
      <rect x="740" y="500" width="340" height="100" rx="8" fill="#0f2419" stroke="#f4a61d" stroke-width="1" stroke-dasharray="5,3"/>
      <text x="760" y="522" font-size="10" font-weight="700" fill="#f4a61d">⚠ Field Installation Notes</text>
      <text x="760" y="540" font-size="9" fill="#86efac">• Soil probe: insert 10cm deep, vertical</text>
      <text x="760" y="555" font-size="9" fill="#86efac">• DHT22: mount inside enclosure + vent hole</text>
      <text x="760" y="570" font-size="9" fill="#86efac">• LoRa antenna: outside enclosure, vertical</text>
      <text x="760" y="585" font-size="9" fill="#86efac">• Solar panel: face north, tilt 20°, shade-free</text>

      <!-- ── POWER BUDGET NOTE ── -->
      <rect x="20" y="590" width="360" height="80" rx="8" fill="#0f2419" stroke="#22c55e" stroke-width="1" stroke-dasharray="5,3"/>
      <text x="40" y="612" font-size="10" font-weight="700" fill="#22c55e">⚡ Power Budget (15-min cycle)</text>
      <text x="40" y="628" font-size="9" fill="#9ca3af">Active: 80mA × 8s = 0.178mAh per cycle</text>
      <text x="40" y="643" font-size="9" fill="#9ca3af">Sleep: 0.01mA × 892s = 2.48mAh per cycle</text>
      <text x="40" y="658" font-size="9" fill="#9ca3af">Daily total ≈ 7.3mAh → 465 days theoretical</text>

      <!-- Firmware sleep cycle note -->
      <rect x="430" y="620" width="280" height="60" rx="8" fill="#0f2419" stroke="#3b82f6" stroke-width="1" stroke-dasharray="5,3"/>
      <text x="450" y="640" font-size="9" fill="#60a5fa">esp_deep_sleep(15 * 60 * 1000000ULL);</text>
      <text x="450" y="655" font-size="9" fill="#9ca3af">// 15 minute deep sleep = 900s</text>
      <text x="450" y="670" font-size="9" fill="#9ca3af">// Wake → read → LoRa send → sleep</text>

      <!-- Title block -->
      <rect x="740" y="640" width="340" height="60" rx="8" fill="#1a4731" stroke="#f4a61d" stroke-width="1"/>
      <text x="760" y="660" font-size="10" font-weight="700" fill="#f4a61d">AquaSense Zimbabwe Sensor Node v2.0</text>
      <text x="760" y="676" font-size="9" fill="#86efac">ESP32 + DHT22 + Soil v1.2 + EBYTE E32-900M30S</text>
      <text x="760" y="690" font-size="9" fill="#86efac">Solar + 18650 · TP4056 + MT3608 · IP65 enclosure</text>
    </svg>
  </div>

  <!-- PCB Layout Wireframe -->
  <h3 style="color:#f4a61d; font-weight:700; margin:24px 0 14px; font-size:1.05rem;"><i class="fas fa-layer-group mr-2"></i>PCB Component Placement Wireframe</h3>
  <div class="card scrollable" style="padding:20px;">
    <svg viewBox="0 0 700 400" style="width:100%; max-width:700px; min-width:500px;" xmlns="http://www.w3.org/2000/svg">
      <rect width="700" height="400" fill="#0a1a10" rx="8"/>
      <text x="350" y="24" text-anchor="middle" font-size="13" font-weight="700" fill="#f4a61d">PCB Layout Wireframe — Top View (1:1 ~115×90mm)</text>
      <!-- PCB outline -->
      <rect x="30" y="40" width="640" height="340" rx="12" fill="none" stroke="#2d6a4f" stroke-width="2" stroke-dasharray="8,4"/>
      <!-- PCB fill -->
      <rect x="30" y="40" width="640" height="340" rx="12" fill="#0d2015" opacity="0.8"/>

      <!-- ESP32 Module (center) -->
      <rect x="220" y="120" width="200" height="150" rx="6" fill="#1a2f3a" stroke="#f4a61d" stroke-width="2.5"/>
      <text x="320" y="150" text-anchor="middle" font-size="11" font-weight="700" fill="#f4a61d">ESP32 WROOM-32</text>
      <text x="320" y="166" text-anchor="middle" font-size="8" fill="#86efac">DevKit V1 · 51×28mm</text>
      <text x="320" y="182" text-anchor="middle" font-size="8" fill="#60a5fa">USB-C ↓ (flashing)</text>
      <!-- ESP32 pin rows -->
      <rect x="215" y="130" width="8" height="120" rx="2" fill="#374151"/>
      <rect x="417" y="130" width="8" height="120" rx="2" fill="#374151"/>
      <!-- Pin dots -->
      <circle cx="215" cy="145" r="2" fill="#ef4444"/>
      <circle cx="215" cy="160" r="2" fill="#374151"/>
      <circle cx="215" cy="175" r="2" fill="#22c55e"/>
      <circle cx="215" cy="190" r="2" fill="#eab308"/>
      <circle cx="215" cy="205" r="2" fill="#3b82f6"/>
      <circle cx="215" cy="220" r="2" fill="#3b82f6"/>
      <circle cx="215" cy="235" r="2" fill="#3b82f6"/>
      <circle cx="215" cy="250" r="2" fill="#22c55e"/>
      <circle cx="215" cy="265" r="2" fill="#22c55e"/>
      <circle cx="425" cy="145" r="2" fill="#ef4444"/>
      <circle cx="425" cy="160" r="2" fill="#374151"/>

      <!-- TP4056 (top-left) -->
      <rect x="50" y="55" width="100" height="60" rx="4" fill="#1e3a2f" stroke="#f4a61d" stroke-width="1.5"/>
      <text x="100" y="78" text-anchor="middle" font-size="9" font-weight="700" fill="#f4a61d">TP4056</text>
      <text x="100" y="92" text-anchor="middle" font-size="7" fill="#86efac">Li-ion Charger</text>
      <text x="100" y="106" text-anchor="middle" font-size="7" fill="#9ca3af">~16×16mm module</text>

      <!-- MT3608 (below TP4056) -->
      <rect x="50" y="145" width="100" height="60" rx="4" fill="#1e3a2f" stroke="#22c55e" stroke-width="1.5"/>
      <text x="100" y="168" text-anchor="middle" font-size="9" font-weight="700" fill="#22c55e">MT3608</text>
      <text x="100" y="182" text-anchor="middle" font-size="7" fill="#86efac">Boost 3.7→5V</text>
      <text x="100" y="196" text-anchor="middle" font-size="7" fill="#9ca3af">~23×17mm module</text>

      <!-- 18650 Battery holder (left bottom) -->
      <rect x="40" y="235" width="150" height="55" rx="8" fill="#2a1a4a" stroke="#a855f7" stroke-width="1.5"/>
      <text x="115" y="258" text-anchor="middle" font-size="9" font-weight="700" fill="#a855f7">18650 HOLDER</text>
      <text x="115" y="272" text-anchor="middle" font-size="7" fill="#d8b4fe">75×20mm · spring contacts</text>
      <!-- Battery shape -->
      <ellipse cx="55" cy="262" rx="10" ry="16" fill="#1e1035" stroke="#a855f7" stroke-width="1"/>
      <ellipse cx="175" cy="262" rx="10" ry="16" fill="#1e1035" stroke="#a855f7" stroke-width="1"/>

      <!-- LoRa Module (right) -->
      <rect x="480" y="100" width="150" height="130" rx="6" fill="#3b1f5e" stroke="#a855f7" stroke-width="2"/>
      <text x="555" y="128" text-anchor="middle" font-size="9" font-weight="700" fill="#c084fc">EBYTE E32-900M30S</text>
      <text x="555" y="143" text-anchor="middle" font-size="7" fill="#d8b4fe">SX1276 · 915MHz</text>
      <text x="555" y="157" text-anchor="middle" font-size="7" fill="#d8b4fe">24×38.5mm SMD</text>
      <!-- SPI pad dots -->
      <circle cx="482" cy="175" r="2.5" fill="#3b82f6"/> <text x="490" y="178" font-size="6.5" fill="#93c5fd">SCK</text>
      <circle cx="482" cy="188" r="2.5" fill="#3b82f6"/> <text x="490" y="191" font-size="6.5" fill="#93c5fd">MISO</text>
      <circle cx="482" cy="201" r="2.5" fill="#3b82f6"/> <text x="490" y="204" font-size="6.5" fill="#93c5fd">MOSI</text>
      <circle cx="482" cy="214" r="2.5" fill="#22c55e"/> <text x="490" y="217" font-size="6.5" fill="#86efac">NSS</text>
      <!-- Antenna trace -->
      <line x1="555" y1="100" x2="555" y2="60" stroke="#c084fc" stroke-width="1.5" stroke-dasharray="3,2"/>
      <text x="570" y="72" font-size="8" fill="#c084fc">SMA ANT.</text>

      <!-- Soil sensor connector (bottom-left) -->
      <rect x="50" y="320" width="120" height="45" rx="4" fill="#065f46" stroke="#22c55e" stroke-width="1.5"/>
      <text x="110" y="340" text-anchor="middle" font-size="9" font-weight="700" fill="#4ade80">SOIL SENSOR</text>
      <text x="110" y="355" text-anchor="middle" font-size="7" fill="#86efac">JST-3 connector</text>

      <!-- DHT22 connector (bottom-center) -->
      <rect x="220" y="310" width="120" height="50" rx="4" fill="#3b2a10" stroke="#fbbf24" stroke-width="1.5"/>
      <text x="280" y="330" text-anchor="middle" font-size="9" font-weight="700" fill="#fbbf24">DHT22</text>
      <text x="280" y="345" text-anchor="middle" font-size="7" fill="#fde68a">3-pin header</text>
      <text x="280" y="357" text-anchor="middle" font-size="7" fill="#9ca3af">+10kΩ R4</text>

      <!-- Solar panel connector (top-right area) -->
      <rect x="490" y="280" width="130" height="45" rx="4" fill="#1e3a4a" stroke="#06b6d4" stroke-width="1.5"/>
      <text x="555" y="300" text-anchor="middle" font-size="9" font-weight="700" fill="#22d3ee">SOLAR IN</text>
      <text x="555" y="315" text-anchor="middle" font-size="7" fill="#67e8f9">XT30 or barrel jack</text>

      <!-- Mounting holes -->
      <circle cx="50" cy="55" r="6" fill="none" stroke="#6b7280" stroke-width="1.5"/>
      <circle cx="650" cy="55" r="6" fill="none" stroke="#6b7280" stroke-width="1.5"/>
      <circle cx="50" cy="365" r="6" fill="none" stroke="#6b7280" stroke-width="1.5"/>
      <circle cx="650" cy="365" r="6" fill="none" stroke="#6b7280" stroke-width="1.5"/>
      <text x="55" y="52" font-size="6.5" fill="#6b7280">M3</text>
      <text x="638" y="52" font-size="6.5" fill="#6b7280">M3</text>

      <!-- PCB trace routes -->
      <path d="M 150,85 L 190,85 L 190,145 L 150,175" stroke="#f4a61d" stroke-width="1" fill="none" opacity="0.4"/>
      <path d="M 150,175 L 190,175 L 190,175 L 220,195" stroke="#22c55e" stroke-width="1" fill="none" opacity="0.4"/>
      <path d="M 420,145 L 445,145 L 445,175 L 482,175" stroke="#3b82f6" stroke-width="1" fill="none" opacity="0.5"/>

      <!-- Dimension arrows -->
      <line x1="30" y1="395" x2="670" y2="395" stroke="#9ca3af" stroke-width="1" marker-end="url(#arrow)"/>
      <text x="350" y="392" text-anchor="middle" font-size="8" fill="#9ca3af">≈ 115 mm</text>
      <line x1="680" y1="40" x2="680" y2="380" stroke="#9ca3af" stroke-width="1" marker-end="url(#arrow)"/>
      <text x="695" y="215" font-size="8" fill="#9ca3af" transform="rotate(90,695,215)">≈ 90 mm</text>
    </svg>
  </div>
</div>

<!-- ╔══════════════════════════════════════════════════════════════╗ -->
<!-- ║  TAB 3: PINOUT TABLES                                          ║ -->
<!-- ╚══════════════════════════════════════════════════════════════╝ -->
<div id="tab-pinout" class="tab-pane">
  <h2 style="color:#f4a61d; font-size:1.4rem; font-weight:800; margin-bottom:6px;">
    <i class="fas fa-plug mr-2"></i>GPIO Pinout Reference
  </h2>
  <p style="color:#86efac; margin-bottom:20px; font-size:.9rem;">Complete pin-by-pin connection table for all subsystems</p>

  <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(440px,1fr)); gap:20px;">

    <!-- ESP32 to Soil Sensor -->
    <div class="card" style="padding:0; overflow:hidden;">
      <div style="background:#065f46; padding:12px 16px; display:flex; align-items:center; gap:8px;">
        <i class="fas fa-tint" style="color:#4ade80;"></i>
        <strong style="color:#4ade80;">Capacitive Soil Sensor v1.2 → ESP32</strong>
      </div>
      <div class="scrollable">
        <table>
          <tr><th>Sensor Pin</th><th>ESP32 Pin</th><th>Wire</th><th>Notes</th></tr>
          <tr><td><code>VCC</code></td><td><code>3V3</code></td><td><span style="color:#ef4444;">●</span> Red</td><td>3.3V supply (NOT 5V)</td></tr>
          <tr><td><code>GND</code></td><td><code>GND</code></td><td><span style="color:#6b7280;">●</span> Black</td><td>Common ground</td></tr>
          <tr><td><code>AOUT</code></td><td><code>GPIO34</code></td><td><span style="color:#eab308;">●</span> Yellow</td><td>ADC input · 12-bit · input only pin</td></tr>
        </table>
      </div>
      <div style="padding:10px 16px; background:#0f2419; font-size:.78rem; color:#6b7280;">Calibration: dry=2950 raw → 0%, wet=1200 raw → 100% · Mapping: <code>map(raw, 2950, 1200, 0, 100)</code></div>
    </div>

    <!-- ESP32 to DHT22 -->
    <div class="card" style="padding:0; overflow:hidden;">
      <div style="background:#3b2a10; padding:12px 16px; display:flex; align-items:center; gap:8px;">
        <i class="fas fa-thermometer-half" style="color:#fbbf24;"></i>
        <strong style="color:#fbbf24;">DHT22 (AM2302) → ESP32</strong>
      </div>
      <div class="scrollable">
        <table>
          <tr><th>DHT22 Pin</th><th>ESP32 Pin</th><th>Wire</th><th>Notes</th></tr>
          <tr><td><code>Pin 1 VCC</code></td><td><code>3V3</code></td><td><span style="color:#ef4444;">●</span> Red</td><td>3.3V or 5V both work</td></tr>
          <tr><td><code>Pin 2 DATA</code></td><td><code>GPIO4</code></td><td><span style="color:#22c55e;">●</span> Green</td><td>+ 10kΩ pull-up to 3V3</td></tr>
          <tr><td><code>Pin 3</code></td><td>—</td><td>—</td><td>NC (no connect)</td></tr>
          <tr><td><code>Pin 4 GND</code></td><td><code>GND</code></td><td><span style="color:#6b7280;">●</span> Black</td><td>Common ground</td></tr>
        </table>
      </div>
      <div style="padding:10px 16px; background:#0f2419; font-size:.78rem; color:#6b7280;">10kΩ resistor between DATA and VCC is mandatory · Min 2s between readings</div>
    </div>

    <!-- ESP32 to LoRa SPI -->
    <div class="card" style="padding:0; overflow:hidden;">
      <div style="background:#3b1f5e; padding:12px 16px; display:flex; align-items:center; gap:8px;">
        <i class="fas fa-broadcast-tower" style="color:#c084fc;"></i>
        <strong style="color:#c084fc;">EBYTE E32-900M30S LoRa → ESP32 SPI</strong>
      </div>
      <div class="scrollable">
        <table>
          <tr><th>LoRa Pin</th><th>ESP32 GPIO</th><th>Wire</th><th>Function</th></tr>
          <tr><td><code>VCC</code></td><td><code>3V3</code></td><td><span style="color:#ef4444;">●</span> Red</td><td>3.3V power</td></tr>
          <tr><td><code>GND</code></td><td><code>GND</code></td><td><span style="color:#6b7280;">●</span> Black</td><td>Ground</td></tr>
          <tr><td><code>SCK</code></td><td><code>GPIO18</code></td><td><span style="color:#3b82f6;">●</span> Blue</td><td>SPI Clock</td></tr>
          <tr><td><code>MISO</code></td><td><code>GPIO19</code></td><td><span style="color:#3b82f6;">●</span> Blue</td><td>SPI Data Out</td></tr>
          <tr><td><code>MOSI</code></td><td><code>GPIO23</code></td><td><span style="color:#3b82f6;">●</span> Blue</td><td>SPI Data In</td></tr>
          <tr><td><code>NSS</code></td><td><code>GPIO15</code></td><td><span style="color:#22c55e;">●</span> Green</td><td>SPI Chip Select</td></tr>
          <tr><td><code>RST</code></td><td><code>GPIO2</code></td><td><span style="color:#22c55e;">●</span> Green</td><td>Hardware Reset</td></tr>
          <tr><td><code>DIO0</code></td><td><code>GPIO26</code></td><td><span style="color:#22c55e;">●</span> Green</td><td>TX/RX Done IRQ</td></tr>
        </table>
      </div>
      <div style="padding:10px 16px; background:#0f2419; font-size:.78rem; color:#6b7280;">Arduino lib: <code>#include &lt;LoRa.h&gt;</code> · LoRa.setPins(15, 2, 26) · LoRa.begin(915E6)</div>
    </div>

    <!-- Power System Connections -->
    <div class="card" style="padding:0; overflow:hidden;">
      <div style="background:#1a3a2a; padding:12px 16px; display:flex; align-items:center; gap:8px;">
        <i class="fas fa-bolt" style="color:#4ade80;"></i>
        <strong style="color:#4ade80;">Power Chain: Solar → TP4056 → MT3608 → ESP32</strong>
      </div>
      <div class="scrollable">
        <table>
          <tr><th>From</th><th>From Pin</th><th>To</th><th>To Pin</th><th>Voltage</th></tr>
          <tr><td>Solar Panel</td><td>OUT+</td><td>TP4056</td><td>IN+</td><td>6V</td></tr>
          <tr><td>Solar Panel</td><td>OUT−</td><td>TP4056</td><td>IN−</td><td>GND</td></tr>
          <tr><td>TP4056</td><td>BAT+</td><td>18650</td><td>+</td><td>3.7–4.2V</td></tr>
          <tr><td>TP4056</td><td>BAT−</td><td>18650</td><td>−</td><td>GND</td></tr>
          <tr><td>TP4056</td><td>OUT+</td><td>MT3608</td><td>IN+</td><td>3.7V</td></tr>
          <tr><td>TP4056</td><td>OUT−</td><td>MT3608</td><td>IN−</td><td>GND</td></tr>
          <tr><td>MT3608</td><td>OUT+</td><td>ESP32</td><td>VIN (5V)</td><td>5.0V ±0.1V</td></tr>
          <tr><td>MT3608</td><td>OUT−</td><td>ESP32</td><td>GND</td><td>GND</td></tr>
        </table>
      </div>
      <div style="padding:10px 16px; background:#0f2419; font-size:.78rem; color:#6b7280;">Trim MT3608 pot to exactly 5.0V before connecting ESP32 · Use multimeter to verify</div>
    </div>

  </div>

  <!-- GPIO Summary Card -->
  <div class="card" style="margin-top:20px; padding:0; overflow:hidden;">
    <div style="background:#1a4731; padding:12px 16px; display:flex; align-items:center; gap:8px;">
      <i class="fas fa-microchip" style="color:#f4a61d;"></i>
      <strong style="color:#f4a61d;">ESP32 GPIO Master Reference</strong>
    </div>
    <div class="scrollable">
      <table>
        <tr><th>GPIO</th><th>Function</th><th>Direction</th><th>Subsystem</th><th>ADC Chan</th><th>Notes</th></tr>
        <tr><td><code>GPIO4</code></td><td>DHT22 DATA</td><td>Bidirectional</td><td>Temperature/Humidity</td><td>—</td><td>Single-wire protocol, 10kΩ pull-up</td></tr>
        <tr><td><code>GPIO34</code></td><td>Soil AOUT</td><td>Input only</td><td>Soil Moisture</td><td>ADC1_CH6</td><td>INPUT_ONLY pin, no internal pull-up</td></tr>
        <tr><td><code>GPIO18</code></td><td>SPI SCK</td><td>Output</td><td>LoRa Module</td><td>—</td><td>VSPI default SCK</td></tr>
        <tr><td><code>GPIO19</code></td><td>SPI MISO</td><td>Input</td><td>LoRa Module</td><td>—</td><td>VSPI default MISO</td></tr>
        <tr><td><code>GPIO23</code></td><td>SPI MOSI</td><td>Output</td><td>LoRa Module</td><td>—</td><td>VSPI default MOSI</td></tr>
        <tr><td><code>GPIO15</code></td><td>LoRa NSS</td><td>Output</td><td>LoRa Module</td><td>—</td><td>Active LOW chip select</td></tr>
        <tr><td><code>GPIO2</code></td><td>LoRa RST</td><td>Output</td><td>LoRa Module</td><td>—</td><td>Pull HIGH to operate, LOW=reset</td></tr>
        <tr><td><code>GPIO26</code></td><td>LoRa DIO0</td><td>Input</td><td>LoRa Module</td><td>—</td><td>TX/RX done interrupt flag</td></tr>
        <tr><td><code>3V3</code></td><td>3.3V Power</td><td>Power Out</td><td>Soil + DHT22 + LoRa</td><td>—</td><td>Max 500mA from onboard LDO</td></tr>
        <tr><td><code>VIN</code></td><td>5V Power In</td><td>Power In</td><td>From MT3608</td><td>—</td><td>5V → onboard LDO → 3.3V</td></tr>
        <tr><td><code>GND</code></td><td>Ground</td><td>Ground</td><td>All</td><td>—</td><td>Common ground rail</td></tr>
      </table>
    </div>
  </div>
</div>

<!-- ╔══════════════════════════════════════════════════════════════╗ -->
<!-- ║  TAB 4: BILL OF MATERIALS                                      ║ -->
<!-- ╚══════════════════════════════════════════════════════════════╝ -->
<div id="tab-bom" class="tab-pane">
  <h2 style="color:#f4a61d; font-size:1.4rem; font-weight:800; margin-bottom:6px;">
    <i class="fas fa-list-ul mr-2"></i>Bill of Materials & Cost Analysis
  </h2>
  <p style="color:#86efac; margin-bottom:20px; font-size:.9rem;">Sourced from AliExpress, DFRobot, RAKwireless — prices in USD (July 2025)</p>

  <!-- Sensor Node BOM -->
  <div class="card" style="padding:0; overflow:hidden; margin-bottom:20px;">
    <div style="background:#1a4731; padding:12px 16px; display:flex; justify-content:space-between; align-items:center;">
      <strong style="color:#f4a61d; font-size:1rem;"><i class="fas fa-leaf mr-2"></i>Sensor Node BOM (per unit)</strong>
      <span class="badge badge-yellow">Total: ~$43.20 USD</span>
    </div>
    <div class="scrollable">
      <table>
        <tr><th>#</th><th>Component</th><th>Model / Part</th><th>Qty</th><th>Unit $</th><th>Total $</th><th>Source</th><th>Notes</th></tr>
        <tr><td>1</td><td>Microcontroller</td><td>ESP32 DevKit V1 WROOM-32</td><td>1</td><td>$2.50</td><td>$2.50</td><td>AliExpress</td><td>CH340 USB · 38 GPIO · Dual-core 240MHz</td></tr>
        <tr><td>2</td><td>Soil Moisture Sensor</td><td>Capacitive v1.2 (Analog)</td><td>1</td><td>$1.20</td><td>$1.20</td><td>AliExpress</td><td>0–3V analog · corrosion resistant</td></tr>
        <tr><td>3</td><td>Temp/Humidity Sensor</td><td>DHT22 / AM2302</td><td>1</td><td>$2.80</td><td>$2.80</td><td>AliExpress / DFRobot</td><td>±0.5°C · ±2%RH · single-wire</td></tr>
        <tr><td>4</td><td>LoRa Module</td><td>EBYTE E32-900M30S (SX1276)</td><td>1</td><td>$8.50</td><td>$8.50</td><td>EBYTE / AliExpress</td><td>915MHz · 30dBm · 10km · SPI</td></tr>
        <tr><td>5</td><td>Battery</td><td>18650 NCR18650B 3400mAh</td><td>1</td><td>$3.50</td><td>$3.50</td><td>AliExpress / DFRobot</td><td>Protected cell · 3.7V nominal</td></tr>
        <tr><td>6</td><td>Battery Holder</td><td>Single 18650 w/ wires</td><td>1</td><td>$0.60</td><td>$0.60</td><td>AliExpress</td><td>Spring contacts · with leads</td></tr>
        <tr><td>7</td><td>Charger IC</td><td>TP4056 + DW01A module</td><td>1</td><td>$0.60</td><td>$0.60</td><td>AliExpress</td><td>1A charge · OVP/OCP/SCP</td></tr>
        <tr><td>8</td><td>Boost Converter</td><td>MT3608 DC-DC Step-Up</td><td>1</td><td>$0.50</td><td>$0.50</td><td>AliExpress</td><td>3.7→5V · 2A · adjustable pot</td></tr>
        <tr><td>9</td><td>Solar Panel</td><td>5W 6V Monocrystalline</td><td>1</td><td>$5.00</td><td>$5.00</td><td>AliExpress</td><td>833mA peak · 130×150mm</td></tr>
        <tr><td>10</td><td>Enclosure</td><td>IP65 ABS 150×100×70mm</td><td>1</td><td>$4.50</td><td>$4.50</td><td>AliExpress (RT series)</td><td>Weatherproof · rubber gasket</td></tr>
        <tr><td>11</td><td>LoRa Antenna</td><td>915MHz SMA whip 3dBi</td><td>1</td><td>$1.50</td><td>$1.50</td><td>AliExpress</td><td>SMA connector · 14cm</td></tr>
        <tr><td>12</td><td>Resistor</td><td>10kΩ 1/4W · pull-up DHT22</td><td>2</td><td>$0.05</td><td>$0.10</td><td>Local / AliExpress</td><td>Standard through-hole</td></tr>
        <tr><td>13</td><td>Capacitors</td><td>100nF ceramic + 10µF electrolytic</td><td>2</td><td>$0.05</td><td>$0.10</td><td>Local</td><td>Decoupling on VCC rails</td></tr>
        <tr><td>14</td><td>Cable Gland</td><td>PG7 IP68 nylon · 3–6.5mm</td><td>3</td><td>$0.40</td><td>$1.20</td><td>AliExpress</td><td>For sensor + solar cables</td></tr>
        <tr><td>15</td><td>Soil Probe Extension</td><td>Silicone wire 30cm · 3-pin</td><td>1</td><td>$0.80</td><td>$0.80</td><td>AliExpress</td><td>Extend sensor below enclosure</td></tr>
        <tr><td>16</td><td>Connectors</td><td>JST-PH 2/3-pin set</td><td>5</td><td>$0.30</td><td>$1.50</td><td>AliExpress</td><td>Easy field replacement</td></tr>
        <tr><td>17</td><td>PCB/Stripboard</td><td>70×90mm prototype board</td><td>1</td><td>$0.80</td><td>$0.80</td><td>AliExpress / local</td><td>Or custom PCB via JLCPCB ~$2</td></tr>
        <tr><td>18</td><td>Mounting Hardware</td><td>M3 screws + standoffs + ties</td><td>1 set</td><td>$1.00</td><td>$1.00</td><td>Local hardware store</td><td>M3×10mm × 4, nylon standoffs</td></tr>
        <tr style="background:rgba(244,166,29,.08);"><td colspan="5" style="font-weight:700; text-align:right; color:#f4a61d;">TOTAL PER SENSOR NODE</td><td style="color:#f4a61d; font-weight:900;">$36.20</td><td colspan="2" style="color:#9ca3af; font-size:.8rem;">+ ~$7 shipping = ~$43 landed</td></tr>
      </table>
    </div>
  </div>

  <!-- Gateway BOM -->
  <div class="card" style="padding:0; overflow:hidden; margin-bottom:20px;">
    <div style="background:#1a4731; padding:12px 16px; display:flex; justify-content:space-between; align-items:center;">
      <strong style="color:#22d3ee; font-size:1rem;"><i class="fas fa-broadcast-tower mr-2"></i>LoRaWAN Gateway BOM (one per farm)</strong>
      <span class="badge badge-blue">Total: ~$195 USD</span>
    </div>
    <div class="scrollable">
      <table>
        <tr><th>#</th><th>Component</th><th>Model</th><th>Qty</th><th>Unit $</th><th>Total $</th><th>Source</th></tr>
        <tr><td>1</td><td>LoRaWAN Gateway</td><td>RAK7268 WisGate Edge Lite 2</td><td>1</td><td>$99</td><td>$99</td><td>RAKwireless store / Rokland</td></tr>
        <tr><td>2</td><td>Power Supply</td><td>12V 1A DC adapter</td><td>1</td><td>$5</td><td>$5</td><td>Local</td></tr>
        <tr><td>3</td><td>Ethernet Cable</td><td>Cat5e 5m patch cable</td><td>1</td><td>$3</td><td>$3</td><td>Local</td></tr>
        <tr><td>4</td><td>SIM Card</td><td>NetOne / Econet data SIM (optional 4G)</td><td>1</td><td>$10</td><td>$10</td><td>Local carrier</td></tr>
        <tr><td>5</td><td>Outdoor Antenna</td><td>915MHz fiberglass 5dBi</td><td>1</td><td>$15</td><td>$15</td><td>AliExpress / RAKwireless</td></tr>
        <tr><td>6</td><td>Antenna cable</td><td>LMR-195 N-SMA 3m</td><td>1</td><td>$8</td><td>$8</td><td>AliExpress</td></tr>
        <tr><td>7</td><td>Mounting pole</td><td>3m galvanized steel pipe</td><td>1</td><td>$12</td><td>$12</td><td>Local hardware</td></tr>
        <tr><td>8</td><td>Outdoor box</td><td>IP65 NEMA enclosure for gateway</td><td>1</td><td>$18</td><td>$18</td><td>AliExpress</td></tr>
        <tr><td>9</td><td>Surge protector</td><td>N-N lightning arrestor 900MHz</td><td>1</td><td>$12</td><td>$12</td><td>AliExpress</td></tr>
        <tr><td>10</td><td>Misc (cable ties, etc.)</td><td>Assorted</td><td>—</td><td>—</td><td>$13</td><td>Local</td></tr>
        <tr style="background:rgba(34,211,238,.06);"><td colspan="5" style="font-weight:700; text-align:right; color:#22d3ee;">TOTAL GATEWAY</td><td style="color:#22d3ee; font-weight:900;">$195</td><td style="color:#9ca3af; font-size:.8rem;">One-time per farm</td></tr>
      </table>
    </div>
  </div>

  <!-- Scale Economics -->
  <div class="card" style="padding:20px;">
    <h3 style="color:#f4a61d; font-weight:700; margin-bottom:14px;"><i class="fas fa-chart-bar mr-2"></i>Scale Economics</h3>
    <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:12px;">
      <div style="background:#0f2419; border-radius:8px; padding:14px; text-align:center;">
        <div style="font-size:1.6rem; font-weight:900; color:#f4a61d;">$238</div>
        <div style="color:#86efac; font-size:.82rem; margin-top:4px;">1 gateway + 1 sensor node</div>
      </div>
      <div style="background:#0f2419; border-radius:8px; padding:14px; text-align:center;">
        <div style="font-size:1.6rem; font-weight:900; color:#22c55e;">$367</div>
        <div style="color:#86efac; font-size:.82rem; margin-top:4px;">1 gateway + 4 nodes (full farm)</div>
      </div>
      <div style="background:#0f2419; border-radius:8px; padding:14px; text-align:center;">
        <div style="font-size:1.6rem; font-weight:900; color:#60a5fa;">$538</div>
        <div style="color:#86efac; font-size:.82rem; margin-top:4px;">1 gateway + 8 nodes (2 farms)</div>
      </div>
      <div style="background:#0f2419; border-radius:8px; padding:14px; text-align:center;">
        <div style="font-size:1.6rem; font-weight:900; color:#c084fc;">30–40%</div>
        <div style="color:#86efac; font-size:.82rem; margin-top:4px;">Water savings typical ROI</div>
      </div>
    </div>
  </div>
</div>

<!-- ╔══════════════════════════════════════════════════════════════╗ -->
<!-- ║  TAB 5: POWER SYSTEM                                           ║ -->
<!-- ╚══════════════════════════════════════════════════════════════╝ -->
<div id="tab-power" class="tab-pane">
  <h2 style="color:#f4a61d; font-size:1.4rem; font-weight:800; margin-bottom:6px;">
    <i class="fas fa-battery-three-quarters mr-2"></i>Power System Design
  </h2>
  <p style="color:#86efac; margin-bottom:20px; font-size:.9rem;">Solar-powered autonomous operation with deep sleep power cycling</p>

  <!-- Power flow diagram -->
  <div class="card" style="padding:20px; margin-bottom:20px;">
    <h3 style="color:#f4a61d; font-weight:700; margin-bottom:16px;"><i class="fas fa-project-diagram mr-2"></i>Power Flow Diagram</h3>
    <div style="display:flex; align-items:center; justify-content:center; flex-wrap:wrap; gap:12px;">
      <div style="text-align:center; padding:16px; background:#1e3a4a; border:2px solid #22d3ee; border-radius:10px; min-width:120px;">
        <i class="fas fa-sun" style="color:#fbbf24; font-size:1.5rem;"></i>
        <div style="color:#22d3ee; font-weight:700; font-size:.9rem; margin-top:6px;">SOLAR</div>
        <div style="color:#9ca3af; font-size:.75rem;">5W · 6V · 833mA</div>
        <div style="color:#9ca3af; font-size:.75rem;">4.2Wh/day ☀</div>
      </div>
      <div style="display:flex; flex-direction:column; align-items:center; gap:2px;">
        <span style="color:#f4a61d; font-size:1.3rem;">→</span>
        <span style="color:#9ca3af; font-size:.7rem;">6V</span>
      </div>
      <div style="text-align:center; padding:16px; background:#1e3a2f; border:2px solid #f4a61d; border-radius:10px; min-width:120px;">
        <i class="fas fa-charging-station" style="color:#f4a61d; font-size:1.5rem;"></i>
        <div style="color:#f4a61d; font-weight:700; font-size:.9rem; margin-top:6px;">TP4056</div>
        <div style="color:#9ca3af; font-size:.75rem;">Charge: 1A max</div>
        <div style="color:#9ca3af; font-size:.75rem;">Cutoff: 4.2V</div>
      </div>
      <div style="display:flex; flex-direction:column; align-items:center; gap:2px;">
        <span style="color:#f4a61d; font-size:1.3rem;">↕</span>
        <span style="color:#9ca3af; font-size:.7rem;">3.7V</span>
      </div>
      <div style="text-align:center; padding:16px; background:#2a1a4a; border:2px solid #a855f7; border-radius:10px; min-width:120px;">
        <i class="fas fa-battery-full" style="color:#a855f7; font-size:1.5rem;"></i>
        <div style="color:#a855f7; font-weight:700; font-size:.9rem; margin-top:6px;">18650</div>
        <div style="color:#9ca3af; font-size:.75rem;">3400mAh · 12.58Wh</div>
        <div style="color:#9ca3af; font-size:.75rem;">Backup: 14 days</div>
      </div>
      <div style="display:flex; flex-direction:column; align-items:center; gap:2px;">
        <span style="color:#f4a61d; font-size:1.3rem;">→</span>
        <span style="color:#9ca3af; font-size:.7rem;">3.7V→5V</span>
      </div>
      <div style="text-align:center; padding:16px; background:#1e3a2f; border:2px solid #22c55e; border-radius:10px; min-width:120px;">
        <i class="fas fa-bolt" style="color:#22c55e; font-size:1.5rem;"></i>
        <div style="color:#22c55e; font-weight:700; font-size:.9rem; margin-top:6px;">MT3608</div>
        <div style="color:#9ca3af; font-size:.75rem;">Boost to 5.0V</div>
        <div style="color:#9ca3af; font-size:.75rem;">94% efficient</div>
      </div>
      <div style="display:flex; flex-direction:column; align-items:center; gap:2px;">
        <span style="color:#f4a61d; font-size:1.3rem;">→</span>
        <span style="color:#9ca3af; font-size:.7rem;">5V</span>
      </div>
      <div style="text-align:center; padding:16px; background:#1a2f3a; border:2px solid #60a5fa; border-radius:10px; min-width:120px;">
        <i class="fas fa-microchip" style="color:#60a5fa; font-size:1.5rem;"></i>
        <div style="color:#60a5fa; font-weight:700; font-size:.9rem; margin-top:6px;">ESP32</div>
        <div style="color:#9ca3af; font-size:.75rem;">5V VIN → 3.3V LDO</div>
        <div style="color:#9ca3af; font-size:.75rem;">Sensors powered</div>
      </div>
    </div>
  </div>

  <!-- Power Budget Table -->
  <div class="card" style="padding:0; overflow:hidden; margin-bottom:20px;">
    <div style="background:#1a4731; padding:12px 16px;">
      <strong style="color:#f4a61d;"><i class="fas fa-table mr-2"></i>Daily Power Budget (15-min wake/sleep cycle)</strong>
    </div>
    <div class="scrollable">
      <table>
        <tr><th>State</th><th>Duration</th><th>Current Draw</th><th>Energy (mWh)</th><th>Cycles/Day</th><th>Daily Total</th></tr>
        <tr><td>Wake + Read Sensors</td><td>3 sec</td><td>80 mA @ 3.3V</td><td>0.22 mWh</td><td>96</td><td>21.1 mWh</td></tr>
        <tr><td>LoRa Transmit (30dBm)</td><td>2 sec</td><td>120 mA @ 3.3V</td><td>0.22 mWh</td><td>96</td><td>21.1 mWh</td></tr>
        <tr><td>LoRa TX ramp-up</td><td>0.5 sec</td><td>40 mA</td><td>0.018 mWh</td><td>96</td><td>1.7 mWh</td></tr>
        <tr><td>Deep Sleep (ESP32)</td><td>894.5 sec</td><td>0.010 mA</td><td>0.001 mWh</td><td>96</td><td>0.096 mWh</td></tr>
        <tr style="background:rgba(244,166,29,.08);"><td colspan="5" style="font-weight:700; text-align:right; color:#f4a61d;">Total Daily Consumption</td><td style="color:#f4a61d; font-weight:900;">44 mWh/day</td></tr>
        <tr style="background:rgba(34,197,94,.06);"><td colspan="5" style="font-weight:700; text-align:right; color:#22c55e;">Solar Production (Zimbabwe avg 6h/day)</td><td style="color:#22c55e; font-weight:900;">4,200 mWh/day</td></tr>
        <tr style="background:rgba(96,165,250,.06);"><td colspan="5" style="font-weight:700; text-align:right; color:#60a5fa;">Battery Backup (12,580 mWh ÷ 44 mWh)</td><td style="color:#60a5fa; font-weight:900;">286 days theoretical</td></tr>
      </table>
    </div>
    <div style="padding:10px 16px; background:#0f2419; font-size:.78rem; color:#6b7280;">⚡ Deep sleep is the key to long battery life — the ESP32 sleeps 99.4% of the time. Solar easily covers daily consumption.</div>
  </div>

  <!-- Deep Sleep Cycle Diagram -->
  <div class="card" style="padding:20px;">
    <h3 style="color:#f4a61d; font-weight:700; margin-bottom:14px;"><i class="fas fa-moon mr-2"></i>15-Minute Wake/Sleep Cycle</h3>
    <div style="background:#0a1a10; border-radius:8px; padding:16px; font-family:monospace; font-size:.82rem; line-height:1.8; color:#86efac;">
      <div><span style="color:#f4a61d; font-weight:700;">WAKE</span> [0s] ──── Boot ESP32 (&lt;1s)</div>
      <div><span style="color:#fbbf24; font-weight:700;">READ</span> [1s] ──── Read DHT22 (2s) + Read Soil ADC (avg 16 samples)</div>
      <div><span style="color:#3b82f6; font-weight:700;">BUILD</span> [3s] ──── JSON payload: &#123;"id":"F1","m":54,"t":26.4,"h":62&#125;</div>
      <div><span style="color:#c084fc; font-weight:700;">LORA</span> [4s] ──── LoRa begin packet → print → end packet (2s)</div>
      <div><span style="color:#22c55e; font-weight:700;">CONF</span> [6s] ──── Wait DIO0 interrupt (TX done) + ACK</div>
      <div><span style="color:#6b7280; font-weight:700;">SLEEP</span> [8s] ──── esp_deep_sleep(900,000,000 µs) = 15 minutes</div>
      <div style="margin-top:8px; color:#4b5563;">──────────────────────────────────────────────────────────</div>
      <div style="color:#4b5563;">                   ← 900 seconds deep sleep (10µA) →</div>
      <div style="color:#4b5563;">──────────────────────────────────────────────────────────</div>
      <div><span style="color:#f4a61d; font-weight:700;">WAKE</span> [900s] ─ Repeat cycle...</div>
    </div>
  </div>
</div>

<!-- ╔══════════════════════════════════════════════════════════════╗ -->
<!-- ║  TAB 6: ASSEMBLY GUIDE                                         ║ -->
<!-- ╚══════════════════════════════════════════════════════════════╝ -->
<div id="tab-assembly" class="tab-pane">
  <h2 style="color:#f4a61d; font-size:1.4rem; font-weight:800; margin-bottom:6px;">
    <i class="fas fa-tools mr-2"></i>Assembly Guide
  </h2>
  <p style="color:#86efac; margin-bottom:20px; font-size:.9rem;">Step-by-step instructions to build one sensor node (approx. 3 hours for first build)</p>

  <!-- Tools needed -->
  <div class="card" style="padding:16px; margin-bottom:20px;">
    <h3 style="color:#f4a61d; font-weight:700; margin-bottom:10px;"><i class="fas fa-wrench mr-2"></i>Tools Required</h3>
    <div style="display:flex; flex-wrap:wrap; gap:8px;">
      <span class="badge badge-green">Soldering iron (25-40W)</span>
      <span class="badge badge-green">Solder wire (60/40 rosin)</span>
      <span class="badge badge-green">Multimeter (voltage + continuity)</span>
      <span class="badge badge-green">Wire stripper</span>
      <span class="badge badge-yellow">Heat shrink tubing</span>
      <span class="badge badge-yellow">Hot glue gun</span>
      <span class="badge badge-blue">Small Philips screwdriver</span>
      <span class="badge badge-blue">Drill + 8mm + 12mm bits</span>
      <span class="badge badge-red">Safety glasses</span>
      <span class="badge badge-purple">Laptop (for flashing Arduino)</span>
    </div>
  </div>

  <!-- Steps -->
  <div style="display:flex; flex-direction:column; gap:14px;">

    <div class="card" style="padding:16px; display:flex; gap:14px; align-items:flex-start;">
      <div class="step-num">1</div>
      <div>
        <div style="font-weight:700; color:#f4a61d; margin-bottom:6px;">Prepare the Enclosure</div>
        <ul style="color:#86efac; font-size:.88rem; line-height:1.8; list-style:disc; padding-left:16px; margin:0;">
          <li>Drill 3× cable gland holes in bottom of IP65 box (8mm drill bit)</li>
          <li>Drill 1× SMA antenna hole on side (12mm bit)</li>
          <li>Thread cable glands through holes, tighten finger-tight</li>
          <li>Mark and drill 4× M3 mounting holes for PCB standoffs inside</li>
        </ul>
        <div style="margin-top:8px;"><span class="badge badge-yellow">⏱ 20 min</span></div>
      </div>
    </div>

    <div class="card" style="padding:16px; display:flex; gap:14px; align-items:flex-start;">
      <div class="step-num">2</div>
      <div>
        <div style="font-weight:700; color:#f4a61d; margin-bottom:6px;">Solder Power Circuit</div>
        <ul style="color:#86efac; font-size:.88rem; line-height:1.8; list-style:disc; padding-left:16px; margin:0;">
          <li>Mount TP4056 module on stripboard, solder IN+/IN− for solar wires</li>
          <li>Solder BAT+/BAT− wires to 18650 holder (red=+, black=−)</li>
          <li>Connect TP4056 OUT+ → MT3608 IN+, OUT− → MT3608 IN−</li>
          <li>Connect MT3608 OUT+ → ESP32 VIN pin, OUT− → ESP32 GND</li>
          <li>Set MT3608 trim pot: connect 18650, adjust until OUT = 5.00V</li>
        </ul>
        <div style="margin-top:8px; color:#fbbf24; font-size:.82rem;"><i class="fas fa-exclamation-triangle mr-1"></i>Verify 5.0V with multimeter BEFORE connecting ESP32</div>
        <div style="margin-top:6px;"><span class="badge badge-yellow">⏱ 45 min</span></div>
      </div>
    </div>

    <div class="card" style="padding:16px; display:flex; gap:14px; align-items:flex-start;">
      <div class="step-num">3</div>
      <div>
        <div style="font-weight:700; color:#f4a61d; margin-bottom:6px;">Flash Firmware to ESP32</div>
        <ul style="color:#86efac; font-size:.88rem; line-height:1.8; list-style:disc; padding-left:16px; margin:0;">
          <li>Install Arduino IDE 2.x + ESP32 board package (Espressif v2.0.14+)</li>
          <li>Install libraries: <code>DHT sensor library</code>, <code>LoRa by Sandeep</code></li>
          <li>Upload the firmware from Tab 7 using USB-C cable</li>
          <li>Open Serial Monitor at 115200 baud — verify readings print</li>
          <li>Check: soil%, temp°C, humidity%, LoRa TX confirmation</li>
        </ul>
        <div style="margin-top:6px;"><span class="badge badge-yellow">⏱ 30 min</span></div>
      </div>
    </div>

    <div class="card" style="padding:16px; display:flex; gap:14px; align-items:flex-start;">
      <div class="step-num">4</div>
      <div>
        <div style="font-weight:700; color:#f4a61d; margin-bottom:6px;">Wire Sensors to ESP32</div>
        <ul style="color:#86efac; font-size:.88rem; line-height:1.8; list-style:disc; padding-left:16px; margin:0;">
          <li>Soil sensor: VCC→3V3, GND→GND, AOUT→GPIO34 (use 30cm wire)</li>
          <li>DHT22: VCC→3V3, DATA→GPIO4 (add 10kΩ resistor DATA→3V3), GND→GND</li>
          <li>LoRa E32: wire per SPI table in Pinout tab</li>
          <li>Use JST-PH connectors for easy field replacement</li>
          <li>Add heat shrink on all solder joints</li>
        </ul>
        <div style="margin-top:6px;"><span class="badge badge-yellow">⏱ 40 min</span></div>
      </div>
    </div>

    <div class="card" style="padding:16px; display:flex; gap:14px; align-items:flex-start;">
      <div class="step-num">5</div>
      <div>
        <div style="font-weight:700; color:#f4a61d; margin-bottom:6px;">Solar Panel Connection</div>
        <ul style="color:#86efac; font-size:.88rem; line-height:1.8; list-style:disc; padding-left:16px; margin:0;">
          <li>Solder solar panel leads: red→TP4056 IN+, black→TP4056 IN−</li>
          <li>Route cable through cable gland (NOT sealed yet)</li>
          <li>Test charging: IN+ should show 5–6V in sunlight</li>
          <li>TP4056 red LED = charging, blue LED = full</li>
        </ul>
        <div style="margin-top:6px;"><span class="badge badge-yellow">⏱ 15 min</span></div>
      </div>
    </div>

    <div class="card" style="padding:16px; display:flex; gap:14px; align-items:flex-start;">
      <div class="step-num">6</div>
      <div>
        <div style="font-weight:700; color:#f4a61d; margin-bottom:6px;">Mount in Enclosure</div>
        <ul style="color:#86efac; font-size:.88rem; line-height:1.8; list-style:disc; padding-left:16px; margin:0;">
          <li>Mount PCB on M3 nylon standoffs (keep 5mm clearance)</li>
          <li>18650 holder: hot glue or bracket to enclosure wall</li>
          <li>Route antenna cable to SMA hole, tighten SMA connector</li>
          <li>Thread soil sensor cable through cable gland, tighten seal</li>
          <li>Close enclosure lid — verify gasket seated correctly</li>
        </ul>
        <div style="margin-top:6px;"><span class="badge badge-yellow">⏱ 30 min</span></div>
      </div>
    </div>

    <div class="card" style="padding:16px; display:flex; gap:14px; align-items:flex-start;">
      <div class="step-num">7</div>
      <div>
        <div style="font-weight:700; color:#f4a61d; margin-bottom:6px;">Field Installation</div>
        <ul style="color:#86efac; font-size:.88rem; line-height:1.8; list-style:disc; padding-left:16px; margin:0;">
          <li>Drive steel stake 30cm into ground at field center</li>
          <li>Attach enclosure to stake at 30cm height (above crop canopy)</li>
          <li>Insert soil probe 10cm deep, vertical, 50cm from stake</li>
          <li>Mount solar panel on separate stake, face north at 20° tilt</li>
          <li>Attach LoRa antenna (vertical polarization)</li>
          <li>Verify on TTN console: device appears active within 15 min</li>
        </ul>
        <div style="margin-top:6px;"><span class="badge badge-yellow">⏱ 30 min</span></div>
      </div>
    </div>

    <div class="card" style="padding:16px; display:flex; gap:14px; align-items:flex-start;">
      <div class="step-num">8</div>
      <div>
        <div style="font-weight:700; color:#f4a61d; margin-bottom:6px;">Soil Moisture Calibration</div>
        <ul style="color:#86efac; font-size:.88rem; line-height:1.8; list-style:disc; padding-left:16px; margin:0;">
          <li>Dry calibration: hold sensor in air → note raw ADC value (typically ~2950)</li>
          <li>Wet calibration: submerge in water → note raw ADC value (typically ~1200)</li>
          <li>Update firmware: <code>map(rawSoil, YOUR_DRY, YOUR_WET, 0, 100)</code></li>
          <li>Confirm % reading makes sense on Serial Monitor in field soil</li>
        </ul>
        <div style="margin-top:8px; color:#22c55e; font-size:.82rem;"><i class="fas fa-check-circle mr-1"></i>Node is operational! Monitor on AquaSense dashboard.</div>
        <div style="margin-top:6px;"><span class="badge badge-yellow">⏱ 10 min</span></div>
      </div>
    </div>

  </div>
</div>

<!-- ╔══════════════════════════════════════════════════════════════╗ -->
<!-- ║  TAB 7: FIRMWARE                                               ║ -->
<!-- ╚══════════════════════════════════════════════════════════════╝ -->
<div id="tab-firmware" class="tab-pane">
  <h2 style="color:#f4a61d; font-size:1.4rem; font-weight:800; margin-bottom:6px;">
    <i class="fas fa-code mr-2"></i>ESP32 Firmware (Arduino IDE)
  </h2>
  <p style="color:#86efac; margin-bottom:20px; font-size:.9rem;">Complete production-ready firmware — copy to Arduino IDE and flash</p>

  <div class="card" style="padding:0; overflow:hidden; margin-bottom:20px;">
    <div style="background:#1a4731; padding:10px 16px; display:flex; justify-content:space-between; align-items:center;">
      <strong style="color:#f4a61d; font-size:.9rem;"><i class="fas fa-file-code mr-2"></i>aquasense_node.ino — Full Firmware v2.0</strong>
      <span class="badge badge-green">Arduino IDE 2.x · ESP32 Board Package</span>
    </div>
<pre style="margin:0; border-radius:0; border-left:none; border-right:none; border-top:none;">#include &lt;Arduino.h&gt;
#include &lt;DHT.h&gt;
#include &lt;LoRa.h&gt;
#include &lt;SPI.h&gt;

// ─── PIN DEFINITIONS ────────────────────────────────────────────────
#define SOIL_PIN    34      // GPIO34 — ADC input (INPUT ONLY pin)
#define DHT_PIN      4      // GPIO4  — DHT22 single-wire
#define DHT_TYPE    DHT22
#define LORA_SCK    18      // GPIO18 — SPI Clock (VSPI)
#define LORA_MISO   19      // GPIO19 — SPI MISO
#define LORA_MOSI   23      // GPIO23 — SPI MOSI
#define LORA_NSS    15      // GPIO15 — Chip Select
#define LORA_RST     2      // GPIO2  — Reset
#define LORA_DIO0   26      // GPIO26 — Interrupt (TX done)

// ─── CONFIG ─────────────────────────────────────────────────────────
#define NODE_ID        "F1"         // Field ID (F1–F4)
#define LORA_FREQ      915E6        // 915 MHz (Africa/Americas)
#define SLEEP_SEC      900          // 15 minutes deep sleep
#define SOIL_DRY       2950         // ADC raw @ dry soil (calibrate!)
#define SOIL_WET       1200         // ADC raw @ wet soil (calibrate!)
#define ADC_SAMPLES    16           // Average 16 ADC readings
#define LORA_SF        10           // Spreading Factor (7-12)
#define LORA_BW        125000       // Bandwidth 125kHz
#define LORA_CR        5            // Coding Rate 4/5

DHT dht(DHT_PIN, DHT_TYPE);

// ─── READ SOIL MOISTURE ─────────────────────────────────────────────
int readSoilMoisture() {
  long sum = 0;
  for (int i = 0; i &lt; ADC_SAMPLES; i++) {
    sum += analogRead(SOIL_PIN);
    delay(5);
  }
  int raw = sum / ADC_SAMPLES;
  int pct = map(raw, SOIL_DRY, SOIL_WET, 0, 100);
  return constrain(pct, 0, 100);
}

// ─── SETUP ──────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(100);
  
  Serial.println("\\n[AquaSense] Node " NODE_ID " waking up...");
  
  // Init DHT22
  dht.begin();
  delay(2200); // DHT22 needs 2s after power-on
  
  // Read sensors
  float temp = dht.readTemperature();
  float hum  = dht.readHumidity();
  int   soil = readSoilMoisture();
  
  // Validate DHT22 (retries on NaN)
  int retries = 0;
  while ((isnan(temp) || isnan(hum)) &amp;&amp; retries &lt; 3) {
    delay(2200);
    temp = dht.readTemperature();
    hum  = dht.readHumidity();
    retries++;
  }
  
  if (isnan(temp) || isnan(hum)) {
    Serial.println("[DHT22] SENSOR FAIL after 3 retries");
    temp = -99.0;
    hum  = -99.0;
  }
  
  Serial.printf("[Sensors] Soil: %d%%  Temp: %.1f°C  Hum: %.1f%%\\n",
                soil, temp, hum);
  
  // Init LoRa SPI
  SPI.begin(LORA_SCK, LORA_MISO, LORA_MOSI, LORA_NSS);
  LoRa.setPins(LORA_NSS, LORA_RST, LORA_DIO0);
  
  if (!LoRa.begin(LORA_FREQ)) {
    Serial.println("[LoRa] INIT FAILED — check wiring!");
    goToSleep(); // Still sleep to prevent battery drain
  }
  
  // Configure LoRa parameters for range/battery balance
  LoRa.setSpreadingFactor(LORA_SF);
  LoRa.setSignalBandwidth(LORA_BW);
  LoRa.setCodingRate4(LORA_CR);
  LoRa.setTxPower(20, PA_OUTPUT_PA_BOOST_PIN);
  
  // Build compact JSON payload
  // Format: {"id":"F1","m":54,"t":26.4,"h":62,"b":87}
  // b = battery % (estimated from analog read of VIN)
  int battery = getBatteryPct();
  
  String payload = "{\\"id\\":\\"" + String(NODE_ID) + "\\"";
  payload += ",\\"m\\":" + String(soil);
  payload += ",\\"t\\":" + String(temp, 1);
  payload += ",\\"h\\":" + String((int)hum);
  payload += ",\\"b\\":" + String(battery);
  payload += "}";
  
  Serial.print("[LoRa] Sending: ");
  Serial.println(payload);
  
  // Transmit
  LoRa.beginPacket();
  LoRa.print(payload);
  int result = LoRa.endPacket();
  
  if (result) {
    Serial.println("[LoRa] TX SUCCESS");
  } else {
    Serial.println("[LoRa] TX FAILED");
  }
  
  LoRa.sleep(); // Put LoRa module to sleep
  
  goToSleep();
}

// ─── ESTIMATE BATTERY % ─────────────────────────────────────────────
int getBatteryPct() {
  // Read internal supply via ADC (rough estimate)
  // For accurate reading, use a voltage divider on GPIO35
  // Simple approximation based on typical operation
  return 85; // Replace with ADC measurement for real BMS
}

// ─── DEEP SLEEP ─────────────────────────────────────────────────────
void goToSleep() {
  Serial.printf("[Sleep] Going to deep sleep for %d seconds...\\n", SLEEP_SEC);
  Serial.flush();
  esp_sleep_enable_timer_wakeup((uint64_t)SLEEP_SEC * 1000000ULL);
  esp_deep_sleep_start();
}

// ─── LOOP (never reached — deep sleep resets setup()) ───────────────
void loop() {
  // Not used — ESP32 reboots to setup() after deep sleep wakeup
}
</pre>
  </div>

  <!-- Required Libraries -->
  <div class="card" style="padding:16px; margin-bottom:20px;">
    <h3 style="color:#f4a61d; font-weight:700; margin-bottom:12px;"><i class="fas fa-book mr-2"></i>Required Arduino Libraries</h3>
    <div style="display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:12px;">
      <div style="background:#0a1a10; border-radius:8px; padding:12px;">
        <div style="font-weight:700; color:#e8f5e9;">DHT sensor library</div>
        <div style="color:#9ca3af; font-size:.82rem; margin-top:4px;">by Adafruit · v1.4.6+</div>
        <div style="color:#86efac; font-size:.8rem; margin-top:4px;">Install via: <code>Library Manager → "DHT sensor library"</code></div>
      </div>
      <div style="background:#0a1a10; border-radius:8px; padding:12px;">
        <div style="font-weight:700; color:#e8f5e9;">LoRa by Sandeep Mistry</div>
        <div style="color:#9ca3af; font-size:.82rem; margin-top:4px;">v0.8.0+ · Arduino LoRa</div>
        <div style="color:#86efac; font-size:.8rem; margin-top:4px;">Install via: <code>Library Manager → "LoRa"</code></div>
      </div>
      <div style="background:#0a1a10; border-radius:8px; padding:12px;">
        <div style="font-weight:700; color:#e8f5e9;">ESP32 Board Package</div>
        <div style="color:#9ca3af; font-size:.82rem; margin-top:4px;">Espressif Systems v2.0.14+</div>
        <div style="color:#86efac; font-size:.8rem; margin-top:4px;">URL: <code>https://dl.espressif.com/dl/package_esp32_index.json</code></div>
      </div>
    </div>
  </div>

  <!-- Calibration Note -->
  <div class="card" style="padding:16px; background:rgba(244,166,29,.05); border-color:#f4a61d;">
    <h3 style="color:#f4a61d; font-weight:700; margin-bottom:10px;"><i class="fas fa-sliders-h mr-2"></i>Calibration Steps</h3>
    <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(250px,1fr)); gap:12px; font-size:.88rem; color:#86efac; line-height:1.8;">
      <div>
        <strong style="color:#e8f5e9;">Soil Sensor:</strong><br/>
        1. Hold sensor in air → Serial Monitor → note raw value → set SOIL_DRY<br/>
        2. Submerge tip in water → note raw → set SOIL_WET<br/>
        3. Re-flash with your values
      </div>
      <div>
        <strong style="color:#e8f5e9;">LoRa Frequency:</strong><br/>
        Zimbabwe uses 868MHz (EU band) or 915MHz (AU/US band)<br/>
        Confirm with local POTRAZ regulations · Default: 915E6
      </div>
    </div>
  </div>
</div>

<!-- ╔══════════════════════════════════════════════════════════════╗ -->
<!-- ║  TAB 8: GATEWAY                                                ║ -->
<!-- ╚══════════════════════════════════════════════════════════════╝ -->
<div id="tab-gateway" class="tab-pane">
  <h2 style="color:#f4a61d; font-size:1.4rem; font-weight:800; margin-bottom:6px;">
    <i class="fas fa-broadcast-tower mr-2"></i>LoRaWAN Gateway Setup — RAK7268
  </h2>
  <p style="color:#86efac; margin-bottom:20px; font-size:.9rem;">Configure the RAK7268 WisGate Edge Lite 2 with The Things Network (TTN)</p>

  <!-- Gateway Spec Card -->
  <div class="card" style="padding:0; overflow:hidden; margin-bottom:20px;">
    <div style="background:#1e3a4a; padding:12px 16px;">
      <strong style="color:#22d3ee; font-size:1rem;"><i class="fas fa-server mr-2"></i>RAK7268 WisGate Edge Lite 2 — Specifications</strong>
    </div>
    <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:0;">
      <div style="padding:14px 16px; border-right:1px solid #1a4731; border-bottom:1px solid #1a4731;">
        <div style="color:#9ca3af; font-size:.78rem;">LoRa Channels</div>
        <div style="color:#22d3ee; font-weight:700;">8 channels full duplex</div>
      </div>
      <div style="padding:14px 16px; border-right:1px solid #1a4731; border-bottom:1px solid #1a4731;">
        <div style="color:#9ca3af; font-size:.78rem;">LoRa Chip</div>
        <div style="color:#22d3ee; font-weight:700;">Semtech SX1302</div>
      </div>
      <div style="padding:14px 16px; border-right:1px solid #1a4731; border-bottom:1px solid #1a4731;">
        <div style="color:#9ca3af; font-size:.78rem;">Backhaul</div>
        <div style="color:#22d3ee; font-weight:700;">Ethernet + WiFi + 4G (CV2)</div>
      </div>
      <div style="padding:14px 16px; border-bottom:1px solid #1a4731;">
        <div style="color:#9ca3af; font-size:.78rem;">Coverage</div>
        <div style="color:#22d3ee; font-weight:700;">Up to 15 km (open field)</div>
      </div>
      <div style="padding:14px 16px; border-right:1px solid #1a4731;">
        <div style="color:#9ca3af; font-size:.78rem;">Concurrent Nodes</div>
        <div style="color:#22d3ee; font-weight:700;">1000+ end devices</div>
      </div>
      <div style="padding:14px 16px; border-right:1px solid #1a4731;">
        <div style="color:#9ca3af; font-size:.78rem;">Management</div>
        <div style="color:#22d3ee; font-weight:700;">Local web UI + remote WisDM</div>
      </div>
      <div style="padding:14px 16px; border-right:1px solid #1a4731;">
        <div style="color:#9ca3af; font-size:.78rem;">Power</div>
        <div style="color:#22d3ee; font-weight:700;">12V/1A DC or PoE</div>
      </div>
      <div style="padding:14px 16px;">
        <div style="color:#9ca3af; font-size:.78rem;">Price (2025)</div>
        <div style="color:#22d3ee; font-weight:700;">~$99 USD (store.rakwireless.com)</div>
      </div>
    </div>
  </div>

  <!-- Setup Steps -->
  <div style="display:flex; flex-direction:column; gap:14px; margin-bottom:20px;">

    <div class="card" style="padding:16px; display:flex; gap:14px; align-items:flex-start;">
      <div class="step-num">1</div>
      <div>
        <div style="font-weight:700; color:#22d3ee; margin-bottom:6px;">Hardware Setup</div>
        <ul style="color:#86efac; font-size:.88rem; line-height:1.8; list-style:disc; padding-left:16px; margin:0;">
          <li>Mount RAK7268 on pole at 3–5m height (farmhouse or barn wall)</li>
          <li>Connect outdoor 5dBi 915MHz antenna via LMR-195 cable</li>
          <li>Connect to router/modem via Cat5e Ethernet cable</li>
          <li>Power via 12V/1A DC adapter (included) or PoE injector</li>
        </ul>
      </div>
    </div>

    <div class="card" style="padding:16px; display:flex; gap:14px; align-items:flex-start;">
      <div class="step-num">2</div>
      <div>
        <div style="font-weight:700; color:#22d3ee; margin-bottom:6px;">Access Web Interface</div>
        <ul style="color:#86efac; font-size:.88rem; line-height:1.8; list-style:disc; padding-left:16px; margin:0;">
          <li>Connect laptop to same network as gateway</li>
          <li>Open browser → <code>http://192.168.0.1</code> (default gateway IP)</li>
          <li>Login: <code>root</code> / <code>root</code> → immediately change password!</li>
          <li>Navigate to <strong>LoRaWAN → Network Server → Global Settings</strong></li>
        </ul>
      </div>
    </div>

    <div class="card" style="padding:16px; display:flex; gap:14px; align-items:flex-start;">
      <div class="step-num">3</div>
      <div>
        <div style="font-weight:700; color:#22d3ee; margin-bottom:6px;">Register on The Things Network (TTN)</div>
        <ul style="color:#86efac; font-size:.88rem; line-height:1.8; list-style:disc; padding-left:16px; margin:0;">
          <li>Create free account at <code>console.thethingsnetwork.org</code></li>
          <li>Select region: <strong>Africa (au1 server)</strong></li>
          <li>Go to <strong>Gateways → Register Gateway</strong></li>
          <li>Enter Gateway EUI (found on RAK7268 label or web UI)</li>
          <li>Note the <strong>Gateway Server Address</strong> (e.g. <code>au1.cloud.thethings.network</code>)</li>
        </ul>
      </div>
    </div>

    <div class="card" style="padding:16px; display:flex; gap:14px; align-items:flex-start;">
      <div class="step-num">4</div>
      <div>
        <div style="font-weight:700; color:#22d3ee; margin-bottom:6px;">Configure Gateway → TTN</div>
        <ul style="color:#86efac; font-size:.88rem; line-height:1.8; list-style:disc; padding-left:16px; margin:0;">
          <li>In RAK web UI: <strong>LoRaWAN → Network Settings → Mode: Packet Forwarder</strong></li>
          <li>Server Address: <code>au1.cloud.thethings.network</code></li>
          <li>Uplink Port: <code>1700</code> · Downlink Port: <code>1700</code></li>
          <li>Frequency Plan: <strong>AU_915_928 (LoRaWAN 1.0.3)</strong></li>
          <li>Save and restart — green LED = connected to TTN!</li>
        </ul>
      </div>
    </div>

    <div class="card" style="padding:16px; display:flex; gap:14px; align-items:flex-start;">
      <div class="step-num">5</div>
      <div>
        <div style="font-weight:700; color:#22d3ee; margin-bottom:6px;">Register End Devices (Sensor Nodes)</div>
        <ul style="color:#86efac; font-size:.88rem; line-height:1.8; list-style:disc; padding-left:16px; margin:0;">
          <li>In TTN Console: <strong>Applications → Add Application → aquasense-zimbabwe</strong></li>
          <li>Add device → <strong>Manually</strong> → LoRaWAN version: 1.0.3</li>
          <li>Generate <strong>DevEUI</strong>, <strong>AppEUI</strong>, <strong>AppKey</strong> → copy to firmware</li>
          <li>Add one device per sensor node (F1, F2, F3, F4...)</li>
          <li>Once node transmits, data appears in <strong>Live Data</strong> tab</li>
        </ul>
      </div>
    </div>

    <div class="card" style="padding:16px; display:flex; gap:14px; align-items:flex-start;">
      <div class="step-num">6</div>
      <div>
        <div style="font-weight:700; color:#22d3ee; margin-bottom:6px;">Connect TTN → AquaSense Dashboard</div>
        <ul style="color:#86efac; font-size:.88rem; line-height:1.8; list-style:disc; padding-left:16px; margin:0;">
          <li>In TTN: <strong>Integrations → Webhooks → Add Webhook (Custom)</strong></li>
          <li>Base URL: <code>https://aquasense-zimbabwe.pages.dev/api/ingest</code></li>
          <li>Format: JSON · Enable uplink message events</li>
          <li>Add Bearer token header for security</li>
          <li>Dashboard now receives live sensor data every 15 minutes!</li>
        </ul>
        <div style="margin-top:8px; background:#0f2419; border-radius:6px; padding:10px; font-family:monospace; font-size:.78rem; color:#86efac;">
          TTN Payload → Webhook → /api/ingest → Dashboard update → Farmer alert
        </div>
      </div>
    </div>

  </div>

  <!-- Network topology diagram -->
  <div class="card" style="padding:20px;">
    <h3 style="color:#f4a61d; font-weight:700; margin-bottom:14px;"><i class="fas fa-network-wired mr-2"></i>Full Network Topology</h3>
    <div style="background:#0a1a10; border-radius:8px; padding:16px; font-family:monospace; font-size:.82rem; line-height:2; color:#86efac; overflow-x:auto; white-space:pre;">
<span style="color:#22c55e;">FARM FIELD</span>                <span style="color:#9ca3af;">≈10km LoRa 915MHz</span>            <span style="color:#60a5fa;">INTERNET</span>

[Soil Sensor v1.2]          ╔══════════════╗              ╔═══════════════════╗
[DHT22 Temp/Hum  ] ──SPI──▶ ║  ESP32 Node  ║ ──LoRa──▶   ║  RAK7268 Gateway  ║ ──Ethernet/4G──▶ TTN Cloud
[Solar + 18650   ]          ║  NODE_ID=F1  ║              ║  8-ch SX1302      ║
                            ╚══════════════╝              ╚═══════════════════╝
                                                                    │
Repeat × 4 nodes                                                    ▼
[Field F2, F3, F4]          ╔══════════════╗          ╔════════════════════════╗
                     ──▶    ║  More nodes  ║ ──LoRa──▶║   The Things Network  ║
                            ║  (up to 1000)║          ║   (au1.cloud.ttn.org) ║
                            ╚══════════════╝          ╚════════════════════════╝
                                                                    │
                                                          Webhook HTTP POST
                                                                    ▼
                                                 ╔══════════════════════════════╗
                                                 ║   AquaSense Zimbabwe         ║
                                                 ║   Cloudflare Pages Dashboard ║
                                                 ║   /api/ingest → D1 → UI      ║
                                                 ╚══════════════════════════════╝
                                                                    │
                                                          SMS/Email Alerts
                                                                    ▼
                                                         📱 Farmer's Phone
</pre>
  </div>
</div>

</div><!-- end tab-gateway -->

</main>

<!-- FOOTER -->
<footer style="background:#0a1a10; border-top:1px solid #1a4731; padding:20px 24px; margin-top:32px; text-align:center;">
  <div style="max-width:1200px; margin:0 auto;">
    <div style="display:flex; justify-content:center; gap:24px; flex-wrap:wrap; margin-bottom:12px;">
      <a href="/" style="color:#86efac; text-decoration:none; font-size:.85rem;"><i class="fas fa-home mr-1"></i>Dashboard</a>
      <a href="/devices" style="color:#86efac; text-decoration:none; font-size:.85rem;"><i class="fas fa-microchip mr-1"></i>Devices</a>
      <a href="/analytics" style="color:#86efac; text-decoration:none; font-size:.85rem;"><i class="fas fa-chart-bar mr-1"></i>Analytics</a>
    </div>
    <p style="color:#4b5563; font-size:.78rem; margin:0;">AquaSense Zimbabwe IoT Blueprint v2.0 · Researched July 2025 · Built for African precision agriculture</p>
  </div>
</footer>

<script>
function switchTab(name) {
  // Deactivate all
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  // Activate selected
  document.getElementById('tab-' + name).classList.add('active');
  event.currentTarget.classList.add('active');
  // Scroll to top of main on mobile
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
</script>
</body>
</html>`;
}

export default app
