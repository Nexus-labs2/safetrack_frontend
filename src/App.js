import React, { useEffect, useState, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Circle, useMap } from 'react-leaflet';
import L from 'leaflet';
import io from 'socket.io-client';
import 'leaflet/dist/leaflet.css';
import './App.css';

// Fix Leaflet default icon bug
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: require('leaflet/dist/images/marker-icon-2x.png'),
  iconUrl: require('leaflet/dist/images/marker-icon.png'),
  shadowUrl: require('leaflet/dist/images/marker-shadow.png'),
});

// Live device marker (blue glowing dot)
const deviceIcon = L.divIcon({
  html: `<div style="
    width:16px;height:16px;background:#00d4ff;
    border-radius:50%;border:3px solid white;
    box-shadow:0 0 12px #00d4ff,0 0 24px #00d4ff44;
  "></div>`,
  className: '',
  iconSize: [16, 16],
  iconAnchor: [8, 8]
});

// SOS marker (red pulsing dot)
const sosIcon = L.divIcon({
  html: `
    <style>@keyframes sos_b{from{box-shadow:0 0 10px #ff2244}to{box-shadow:0 0 30px #ff2244,0 0 60px #ff224488}}</style>
    <div style="
      width:20px;height:20px;background:#ff2244;
      border-radius:50%;border:3px solid white;
      box-shadow:0 0 20px #ff2244;
      animation:sos_b 0.8s ease-in-out infinite alternate;
    "></div>`,
  className: '',
  iconSize: [20, 20],
  iconAnchor: [10, 10]
});

// Auto-pan map when position updates
function MapController({ position }) {
  const map = useMap();
  useEffect(() => {
    if (position) map.setView(position, map.getZoom(), { animate: true });
  }, [position, map]);
  return null;
}

// Use env variable — works for both local and Render
const SOCKET_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:3001';

export default function App() {
  const [connected, setConnected] = useState(false);
  const [position, setPosition] = useState(null);
  const [sos, setSos] = useState(false);
  const [sosLocation, setSosLocation] = useState(null);
  const [lastSeen, setLastSeen] = useState(null);
  const [deviceId, setDeviceId] = useState('--');
  const [sosLog, setSosLog] = useState([]);
  const socketRef = useRef(null);

  const defaultCenter = [18.6298, 73.7997]; // Pimpri, Maharashtra

  useEffect(() => {
    socketRef.current = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
      withCredentials: true
    });

    const socket = socketRef.current;

    socket.on('init_state', (state) => {
      setConnected(state.connected);
      if (state.lat && state.lng) setPosition([state.lat, state.lng]);
      setSos(state.sos);
      setSosLocation(state.sosLocation);
      setLastSeen(state.lastSeen);
      setDeviceId(state.deviceId || '--');
    });

    socket.on('location_update', (data) => {
      setConnected(true);
      setPosition([data.lat, data.lng]);
      setLastSeen(data.lastSeen);
      setDeviceId(data.deviceId);
    });

    socket.on('sos_update', (data) => {
      setSos(data.active);
      if (data.active && data.sosLocation) {
        setSosLocation(data.sosLocation);
        setSosLog(prev => [{
          lat: data.sosLocation.lat,
          lng: data.sosLocation.lng,
          time: data.sosLocation.time
        }, ...prev.slice(0, 19)]);
      }
    });

    socket.on('device_offline', () => setConnected(false));

    return () => socket.disconnect();
  }, []);

  const formatTime = (iso) => {
    if (!iso) return '--';
    return new Date(iso).toLocaleTimeString('en-IN', { hour12: true });
  };

  const fmt = (val) => val != null ? val.toFixed(6) : '--';

  return (
    <div className="app">

      {/* ── HEADER ── */}
      <header className="header">
        <div className="header-left">
          <div className="logo-icon">🛰</div>
          <h1>SafeTrack / GPS Monitor</h1>
        </div>
        <div className="header-right">
          <div className={`status-badge ${connected ? 'online' : 'offline'}`}>
            <div className="status-dot" />
            {connected ? 'DEVICE ONLINE' : 'DEVICE OFFLINE'}
          </div>
        </div>
      </header>

      {/* ── SOS BANNER ── */}
      {sos && (
        <div className="sos-banner">
          🚨 &nbsp; SOS ACTIVE — EMERGENCY ALERT TRIGGERED &nbsp; 🚨
        </div>
      )}

      <div className="main">

        {/* ── SIDEBAR ── */}
        <aside className="sidebar">

          <div className="sidebar-section">
            <h2>Device Info</h2>
            <div className="info-row">
              <span className="info-label">Device ID</span>
              <span className="info-value highlight">{deviceId}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Status</span>
              <span className={`info-value ${connected ? 'highlight' : ''}`}>
                {connected ? 'Online' : 'Offline'}
              </span>
            </div>
            <div className="info-row">
              <span className="info-label">Last Seen</span>
              <span className="info-value">{formatTime(lastSeen)}</span>
            </div>
            <div className="info-row">
              <span className="info-label">SOS State</span>
              <span className={`info-value ${sos ? 'sos-active' : ''}`}>
                {sos ? '⚠ ACTIVE' : 'Normal'}
              </span>
            </div>
          </div>

          <div className="sidebar-section">
            <h2>Live Coordinates</h2>
            <div className="coords-block">
              <span>LAT </span>{fmt(position?.[0])}°N<br />
              <span>LNG </span>{fmt(position?.[1])}°E
            </div>
          </div>

          {sosLocation && (
            <div className="sidebar-section">
              <h2>SOS Location</h2>
              <div className="coords-block">
                <span>LAT </span>{fmt(sosLocation.lat)}°N<br />
                <span>LNG </span>{fmt(sosLocation.lng)}°E<br />
                <span>TIME</span>{formatTime(sosLocation.time)}
              </div>
            </div>
          )}

          <div className="sos-log">
            <h2>Alert History</h2>
            {sosLog.length === 0
              ? <p className="no-events">No alerts recorded</p>
              : sosLog.map((entry, i) => (
                <div key={i} className="log-entry">
                  <div className="log-time">{formatTime(entry.time)}</div>
                  <div>{entry.lat.toFixed(5)}, {entry.lng.toFixed(5)}</div>
                </div>
              ))
            }
          </div>

        </aside>

        {/* ── MAP ── */}
        <div className="map-container">
          <MapContainer
            center={position || defaultCenter}
            zoom={15}
            style={{ width: '100%', height: '100%' }}
          >
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; OpenStreetMap contributors'
            />

            {position && <MapController position={position} />}

            {/* Live device marker */}
            {position && (
              <>
                <Marker position={position} icon={deviceIcon}>
                  <Popup>
                    <b>📍 Live Location</b><br />
                    {position[0].toFixed(6)}, {position[1].toFixed(6)}<br />
                    Last seen: {formatTime(lastSeen)}
                  </Popup>
                </Marker>
                <Circle
                  center={position}
                  radius={15}
                  pathOptions={{ color: '#00d4ff', fillColor: '#00d4ff', fillOpacity: 0.08, weight: 1 }}
                />
              </>
            )}

            {/* SOS marker */}
            {sos && sosLocation && (
              <>
                <Marker position={[sosLocation.lat, sosLocation.lng]} icon={sosIcon}>
                  <Popup>
                    <b>🚨 SOS Location</b><br />
                    {sosLocation.lat.toFixed(6)}, {sosLocation.lng.toFixed(6)}<br />
                    Time: {formatTime(sosLocation.time)}
                  </Popup>
                </Marker>
                <Circle
                  center={[sosLocation.lat, sosLocation.lng]}
                  radius={30}
                  pathOptions={{ color: '#ff2244', fillColor: '#ff2244', fillOpacity: 0.15, weight: 2 }}
                />
              </>
            )}

          </MapContainer>

          {/* Bottom-right overlay */}
          {position && (
            <div className="map-overlay-info">
              <div><span className="label">LIVE  </span>{fmt(position[0])}, {fmt(position[1])}</div>
              {sos && sosLocation && (
                <div style={{ color: '#ff2244' }}>
                  <span className="label">SOS   </span>{fmt(sosLocation.lat)}, {fmt(sosLocation.lng)}
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}