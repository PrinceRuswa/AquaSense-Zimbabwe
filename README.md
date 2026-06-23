# AquaSense Zimbabwe – Smart Agricultural IoT Dashboard

## Project Overview
- **Name**: AquaSense Zimbabwe
- **Goal**: Smart precision agriculture platform for Zimbabwean farmers using IoT sensor data
- **Initiative**: Uncommon Builders Club Partnership – Prince Ruswa
- **Tech Stack**: Hono + TypeScript + TailwindCSS + Chart.js + Cloudflare Pages

## Features Implemented

### ✅ Dashboard
- Real-time overview of all 4 field sensor nodes
- Stat cards: average soil moisture, temperature, active alerts, sensor uptime
- Animated soil moisture gauge rings with colour-coded status
- Live alerts panel with irrigation recommendations
- 24-hour soil moisture/temperature/humidity trend charts
- Mini weather widget

### ✅ My Fields
- Detailed field cards for Maize, Tobacco, Soya Beans & Wheat
- Per-field soil moisture gauges, temperature, humidity, battery level
- Crop-specific irrigation thresholds and recommendations
- Field detail modal with 24-hour history chart
- Crop icons and zone/area metadata

### ✅ Irrigation Alerts
- Automated alerts: IRRIGATE / LOW / EXCESS / OPTIMAL statuses
- Filterable by: All / Critical / Warning / Info
- Shows soil moisture %, field, crop, zone, and time

### ✅ Weather & Climate
- Current conditions: temperature, humidity, wind speed, UV index
- 5-day forecast with icons
- Farming impact advice (evapotranspiration, rainfall, wind effect)
- Zimbabwe planting calendar (Maize, Tobacco, Soya Beans, Wheat)

### ✅ Farm Analytics
- Water saved, yield increase, cost reduction, sensor uptime KPIs
- Weekly water usage vs rainfall bar chart
- Field efficiency radar chart

### ✅ IoT Devices
- Node status cards (ESP32-WROOM-32, ESP32-S3, Arduino Mega, ESP32-C3)
- Battery level, signal strength (dBm), communication type
- Online/Warning/Offline status with colour rings
- Network architecture diagram: Nodes → LoRa Gateway → Cloud → Dashboard

### ✅ Field Guide & Settings
- Built-in soil moisture interpretation guide
- Device status legend
- Sensor specs reference (ESP32, DHT22, Capacitive v1.2)
- Settings panel for farm name, SMS alerts, refresh interval

## API Endpoints
| Endpoint | Description |
|----------|-------------|
| `GET /api/dashboard` | Full dashboard data with all field sensors + alerts |
| `GET /api/fields` | All field sensor readings |
| `GET /api/fields/:id` | Single field with 24h history |
| `GET /api/alerts` | Active irrigation alerts |
| `GET /api/weather` | Weather data for Harare region |
| `GET /api/analytics` | KPIs and weekly performance data |

## IoT Sensor Specs (from documentation)
- **Microcontroller**: ESP32 / Arduino (deep-sleep, wakes every 15 min)
- **Soil Sensor**: Capacitive Soil Moisture Sensor v1.2 (corrosion-resistant)
- **Climate Sensor**: DHT22 (temperature + humidity)
- **Power**: 5V Solar Panel + 18650 Li-ion battery
- **Connectivity**: LoRaWAN (up to 10km) / GSM 2G fallback

## Crop Moisture Thresholds
| Crop | Min% | Max% | Optimal% |
|------|-------|-------|----------|
| Maize | 30 | 70 | 55 |
| Tobacco | 25 | 65 | 50 |
| Soya Beans | 35 | 75 | 60 |
| Wheat | 28 | 68 | 52 |

## Colours (Brand Identity)
- **Deep Forest Green**: `#1a4731` / `#2d6a4f`
- **Vibrant Yellow**: `#f4a61d`
- **Clean White**: `#ffffff`

## Deployment
- **Platform**: Cloudflare Pages (Hono backend)
- **Status**: Development build running
- **Last Updated**: 2026-06-23

## Features Not Yet Implemented
- Real IoT device data ingestion (WebSocket / MQTT)
- SMS/WhatsApp alert delivery (Twilio integration)
- User authentication / multi-farmer accounts
- Map view with GPS field locations
- Historical data persistence (Cloudflare D1)
- Offline/PWA mode for low-connectivity areas

## Recommended Next Steps
1. Deploy to Cloudflare Pages for production access
2. Integrate real ESP32 data via MQTT → Cloudflare Worker pipeline
3. Add Cloudflare D1 for persistent historical data
4. Add SMS alerts via Africa's Talking API (popular in Zimbabwe)
5. Add PWA support for offline farm use
