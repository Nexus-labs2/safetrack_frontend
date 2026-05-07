import React, { useEffect, useState, useRef } from 'react';
import { MapContainer, TileLayer, WMSTileLayer, Marker, Popup, Circle, useMap, FeatureGroup } from 'react-leaflet';
import { EditControl } from 'react-leaflet-draw';
import centroid from '@turf/centroid';
import L from 'leaflet';
import io from 'socket.io-client';
import axios from 'axios';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw/dist/leaflet.draw.css';
import './App.css';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: require('leaflet/dist/images/marker-icon-2x.png'),
  iconUrl: require('leaflet/dist/images/marker-icon.png'),
  shadowUrl: require('leaflet/dist/images/marker-shadow.png'),
});

const BACKEND = process.env.REACT_APP_BACKEND_URL || 'http://localhost:3001';

const deviceIcon = L.divIcon({
  html: `<div style="width:16px;height:16px;background:#00d4ff;border-radius:50%;border:3px solid white;box-shadow:0 0 12px #00d4ff,0 0 24px #00d4ff44;"></div>`,
  className: '', iconSize: [16, 16], iconAnchor: [8, 8]
});

const sosIcon = L.divIcon({
  html: `<style>@keyframes sb{from{box-shadow:0 0 10px #ff2244}to{box-shadow:0 0 30px #ff2244,0 0 60px #ff224488}}</style>
         <div style="width:20px;height:20px;background:#ff2244;border-radius:50%;border:3px solid white;animation:sb 0.8s ease-in-out infinite alternate;"></div>`,
  className: '', iconSize: [20, 20], iconAnchor: [10, 10]
});

function MapController({ position }) {
  const map = useMap();
  useEffect(() => { if (position) map.setView(position, map.getZoom(), { animate: true }); }, [position, map]);
  return null;
}

// ── ADMIN LOGIN MODAL ─────────────────────────────────────
function LoginModal({ onLogin, onClose }) {
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setLoading(true); setErr('');
    try {
      const res = await axios.post(`${BACKEND}/api/admin/login`, { username: user, password: pass });
      localStorage.setItem('safetrack_token', res.data.token);
      onLogin(res.data.token, res.data.username);
    } catch {
      setErr('Invalid username or password');
    }
    setLoading(false);
  };

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <span>🔐 Admin Login</span>
          <button onClick={onClose} className="modal-close">✕</button>
        </div>
        <div className="modal-body">
          <input className="modal-input" placeholder="Username" value={user}
            onChange={e => setUser(e.target.value)} />
          <input className="modal-input" type="password" placeholder="Password" value={pass}
            onChange={e => setPass(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && submit()} />
          {err && <div className="modal-error">{err}</div>}
          <button className="modal-btn" onClick={submit} disabled={loading}>
            {loading ? 'Logging in...' : 'Login'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── GEOFENCE PANEL ────────────────────────────────────────
function GeofencePanel({ token, deviceId, geofences, onUpdate, onDelete }) {
  return (
    <div className="geofence-panel">
      <div className="sidebar-section">
        <h2>Safe Zones</h2>
        {geofences.length === 0
          ? <p className="no-events">Draw a zone on the map</p>
          : geofences.map(f => (
            <div key={f.id} className={`fence-item ${f.active ? 'active' : 'inactive'}`}>
              <div className="fence-name">{f.name}</div>
              <div className="fence-actions">
                <button className="fence-btn toggle"
                  onClick={() => onUpdate(f.id, { active: !f.active }, token)}>
                  {f.active ? 'Disable' : 'Enable'}
                </button>
                <button className="fence-btn delete"
                  onClick={() => onDelete(f.id, token)}>
                  Delete
                </button>
              </div>
            </div>
          ))
        }
      </div>
    </div>
  );
}

// ── MAIN APP ──────────────────────────────────────────────
export default function App() {
  const [connected, setConnected] = useState(false);
  const [position, setPosition] = useState(null);
  const [sos, setSos] = useState(false);
  const [sosLocation, setSosLocation] = useState(null);
  const [lastSeen, setLastSeen] = useState(null);
  const [deviceId, setDeviceId] = useState('DEVICE_01');
  const [sosLog, setSosLog] = useState([]);
  const [mode, setMode] = useState('tracking'); // 'tracking' | 'child'
  const [showLogin, setShowLogin] = useState(false);
  const [adminToken, setAdminToken] = useState(localStorage.getItem('safetrack_token'));
  const [adminUser, setAdminUser] = useState('');
  const [geofences, setGeofences] = useState([]);
  const [breachLog, setBreachLog] = useState([]);
  const [mapLayer, setMapLayer] = useState('osm'); // 'osm' | 'bhuvan' | 'satellite'
  const [notifications, setNotifications] = useState([]);
  const socketRef = useRef(null);
  const defaultCenter = [18.6298, 73.7997];

  // ── Socket setup ────────────────────────────────────────
  useEffect(() => {
    socketRef.current = io(BACKEND, { transports: ['websocket', 'polling'], withCredentials: true });
    const s = socketRef.current;

    s.on('init_state', state => {
      setConnected(state.connected);
      if (state.lat && state.lng) setPosition([state.lat, state.lng]);
      setSos(state.sos);
      setSosLocation(state.sosLocation);
      setLastSeen(state.lastSeen);
      if (state.deviceId) setDeviceId(state.deviceId);
    });

    s.on('location_update', d => {
      setConnected(true);
      setPosition([d.lat, d.lng]);
      setLastSeen(d.lastSeen);
      setDeviceId(d.deviceId);
    });

    s.on('sos_update', d => {
      setSos(d.active);
      if (d.active && d.sosLocation) {
        setSosLocation(d.sosLocation);
        setSosLog(p => [{ ...d.sosLocation }, ...p.slice(0, 19)]);
      }
    });

    s.on('device_offline', () => setConnected(false));

    s.on('geofence_breach', data => {
      setBreachLog(p => [data, ...p.slice(0, 49)]);
      pushNotification(data.message, 'breach');
    });

    s.on('geofence_updated', fence => {
      setGeofences(p => {
        const exists = p.find(f => f.id === fence.id);
        return exists ? p.map(f => f.id === fence.id ? fence : f) : [...p, fence];
      });
    });

    s.on('geofence_deleted', ({ id }) => setGeofences(p => p.filter(f => f.id !== id)));

    return () => s.disconnect();
  }, []);

  // ── Load geofences when switching to child mode ──────────
  useEffect(() => {
    if (mode === 'child' && adminToken) loadGeofences();
  }, [mode, adminToken]);

  const loadGeofences = async () => {
    try {
      const res = await axios.get(`${BACKEND}/api/geofences/${deviceId}`,
        { headers: { Authorization: `Bearer ${adminToken}` } });
      setGeofences(res.data);
    } catch (e) {
      if (e.response?.status === 401) setAdminToken(null);
    }
  };

  const pushNotification = (msg, type) => {
    const id = Date.now();
    setNotifications(p => [{ id, msg, type }, ...p.slice(0, 4)]);
    setTimeout(() => setNotifications(p => p.filter(n => n.id !== id)), 6000);
  };

  // ── Draw zone on map ─────────────────────────────────────
  const onZoneCreated = async (e) => {
    const layer = e.layer;
    const geoJson = layer.toGeoJSON();
    const center = centroid(geoJson).geometry.coordinates;
    const name = prompt('Name this safe zone (e.g. "Home", "School"):') || 'Safe Zone';

    try {
      await axios.post(`${BACKEND}/api/geofences`,
        {
          name, deviceId,
          zone: geoJson.geometry,
          centerLat: center[1], centerLng: center[0]
        },
        { headers: { Authorization: `Bearer ${adminToken}` } }
      );
      loadGeofences();
      pushNotification(`✅ Zone "${name}" created`, 'success');
    } catch { pushNotification('❌ Failed to save zone', 'error'); }
  };

  const updateFence = async (id, updates, token) => {
    const fence = geofences.find(f => f.id === id);
    await axios.put(`${BACKEND}/api/geofences/${id}`,
      { ...fence, ...updates, zone: fence.zone },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    loadGeofences();
  };

  const deleteFence = async (id, token) => {
    if (!window.confirm('Delete this safe zone?')) return;
    await axios.delete(`${BACKEND}/api/geofences/${id}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
  };

  const handleLogin = (token, username) => {
    setAdminToken(token);
    setAdminUser(username);
    setShowLogin(false);
    setMode('child');
  };

  const handleModeSwitch = (newMode) => {
    if (newMode === 'child' && !adminToken) {
      setShowLogin(true);
    } else {
      setMode(newMode);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('safetrack_token');
    setAdminToken(null);
    setAdminUser('');
    setMode('tracking');
  };

  const fmt = v => v != null ? v.toFixed(6) : '--';
  const formatTime = iso => iso ? new Date(iso).toLocaleTimeString('en-IN', { hour12: true }) : '--';

  // ── Map tile selector ────────────────────────────────────
  const MapTiles = () => {
    const proxyBhuvan = `${BACKEND}/api/bhuvan-proxy`;
    if (mapLayer === 'bhuvan') {
      return (
        <>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution="&copy; OpenStreetMap" opacity={0.3} />
          <WMSTileLayer
            url={proxyBhuvan}
            layers="india_boundary,india_state"
            format="image/png"
            transparent={true}
            version="1.1.1"
            attribution="&copy; ISRO Bhuvan"
            opacity={0.9}
          />
        </>
      );
    }
    if (mapLayer === 'satellite') {
      return <TileLayer
        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        attribution="&copy; Esri Satellite" />;
    }
    return <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      attribution="&copy; OpenStreetMap" />;
  };

  return (
    <div className="app">

      {/* ── HEADER ── */}
      <header className="header">
        <div className="header-left">
          <div className="logo-icon">🛰</div>
          <h1>SafeTrack</h1>
        </div>
        <div className="header-center">
          <button className={`mode-btn ${mode === 'tracking' ? 'active' : ''}`}
            onClick={() => handleModeSwitch('tracking')}>
            📡 Tracking
          </button>
          <button className={`mode-btn child ${mode === 'child' ? 'active' : ''}`}
            onClick={() => handleModeSwitch('child')}>
            👶 Child Safety {!adminToken && <span className="lock">🔒</span>}
          </button>
        </div>
        <div className="header-right">
          <div className="map-layer-select">
            <button className={mapLayer === 'osm' ? 'active' : ''} onClick={() => setMapLayer('osm')}>OSM</button>
            <button className={mapLayer === 'bhuvan' ? 'active' : ''} onClick={() => setMapLayer('bhuvan')}>🇮🇳 Bhuvan</button>
            <button className={mapLayer === 'satellite' ? 'active' : ''} onClick={() => setMapLayer('satellite')}>🛰 Satellite</button>
          </div>
          {adminToken
            ? <div className="admin-badge" onClick={handleLogout}>👤 {adminUser} <span>Logout</span></div>
            : <button className="login-btn" onClick={() => setShowLogin(true)}>Admin Login</button>
          }
          <div className={`status-badge ${connected ? 'online' : 'offline'}`}>
            <div className="status-dot" />
            {connected ? 'ONLINE' : 'OFFLINE'}
          </div>
        </div>
      </header>

      {/* ── SOS BANNER ── */}
      {sos && <div className="sos-banner">🚨 &nbsp; SOS ACTIVE — EMERGENCY ALERT TRIGGERED &nbsp; 🚨</div>}

      {/* ── NOTIFICATIONS ── */}
      <div className="notifications">
        {notifications.map(n => (
          <div key={n.id} className={`notif notif-${n.type}`}>{n.msg}</div>
        ))}
      </div>

      <div className="main">

        {/* ── SIDEBAR ── */}
        <aside className="sidebar">
          <div className="sidebar-section">
            <h2>Device Info</h2>
            <div className="info-row"><span className="info-label">Device ID</span><span className="info-value highlight">{deviceId}</span></div>
            <div className="info-row"><span className="info-label">Status</span><span className={`info-value ${connected ? 'highlight' : ''}`}>{connected ? 'Online' : 'Offline'}</span></div>
            <div className="info-row"><span className="info-label">Last Seen</span><span className="info-value">{formatTime(lastSeen)}</span></div>
            <div className="info-row"><span className="info-label">Mode</span><span className="info-value highlight">{mode === 'child' ? '👶 Child Safety' : '📡 Tracking'}</span></div>
            <div className="info-row"><span className="info-label">SOS</span><span className={`info-value ${sos ? 'sos-active' : ''}`}>{sos ? '⚠ ACTIVE' : 'Normal'}</span></div>
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

          {/* Child Safety Mode Sidebar */}
          {mode === 'child' && adminToken && (
            <>
              <GeofencePanel
                token={adminToken} deviceId={deviceId}
                geofences={geofences}
                onUpdate={updateFence} onDelete={deleteFence}
              />
              <div className="sidebar-section">
                <h2 style={{ color: 'var(--sos)' }}>Breach Log</h2>
                {breachLog.length === 0
                  ? <p className="no-events">No breaches recorded</p>
                  : breachLog.map((b, i) => (
                    <div key={i} className="log-entry">
                      <div className="log-time">{formatTime(b.time)}</div>
                      <div>{b.fenceName} — left zone</div>
                      <div>{b.lat?.toFixed(5)}, {b.lng?.toFixed(5)}</div>
                    </div>
                  ))
                }
              </div>
            </>
          )}

          {/* Tracking Mode Sidebar */}
          {mode === 'tracking' && (
            <div className="sos-log">
              <h2>Alert History</h2>
              {sosLog.length === 0
                ? <p className="no-events">No alerts recorded</p>
                : sosLog.map((e, i) => (
                  <div key={i} className="log-entry">
                    <div className="log-time">{formatTime(e.time)}</div>
                    <div>{e.lat?.toFixed(5)}, {e.lng?.toFixed(5)}</div>
                  </div>
                ))
              }
            </div>
          )}
        </aside>

        {/* ── MAP ── */}
        <div className="map-container">
          <MapContainer center={position || defaultCenter} zoom={15} style={{ width: '100%', height: '100%' }}>
            <MapTiles />
            {position && <MapController position={position} />}

            {/* Device marker */}
            {position && (
              <>
                <Marker position={position} icon={deviceIcon}>
                  <Popup><b>📍 Live Location</b><br />{position[0].toFixed(6)}, {position[1].toFixed(6)}<br />Last seen: {formatTime(lastSeen)}</Popup>
                </Marker>
                <Circle center={position} radius={15}
                  pathOptions={{ color: '#00d4ff', fillColor: '#00d4ff', fillOpacity: 0.08, weight: 1 }} />
              </>
            )}

            {/* SOS marker */}
            {sos && sosLocation && (
              <>
                <Marker position={[sosLocation.lat, sosLocation.lng]} icon={sosIcon}>
                  <Popup><b>🚨 SOS Location</b><br />{sosLocation.lat.toFixed(6)}, {sosLocation.lng.toFixed(6)}</Popup>
                </Marker>
                <Circle center={[sosLocation.lat, sosLocation.lng]} radius={30}
                  pathOptions={{ color: '#ff2244', fillColor: '#ff2244', fillOpacity: 0.15, weight: 2 }} />
              </>
            )}

            {/* Geofence zones — child mode */}
            {mode === 'child' && geofences.map(fence => fence.active && (
              <React.Fragment key={fence.id}>
                {fence.zone && (
                  <Circle
                    center={[fence.center_lat, fence.center_lng]}
                    radius={fence.radius_meters || 100}
                    pathOptions={{ color: '#00ff88', fillColor: '#00ff88', fillOpacity: 0.1, weight: 2, dashArray: '8' }}
                  />
                )}
              </React.Fragment>
            ))}

            {/* Draw tools — child mode + admin only */}
            {mode === 'child' && adminToken && (
              <FeatureGroup>
                <EditControl
                  position="topright"
                  onCreated={onZoneCreated}
                  draw={{
                    rectangle: false,
                    polyline: false,
                    marker: false,
                    circlemarker: false,
                    polygon: { shapeOptions: { color: '#00ff88', fillOpacity: 0.15 } },
                    circle: { shapeOptions: { color: '#00ff88', fillOpacity: 0.15 } }
                  }}
                  edit={{ edit: true, remove: true }}
                />
              </FeatureGroup>
            )}
          </MapContainer>

          {/* Coordinate overlay */}
          {position && (
            <div className="map-overlay-info">
              <div><span className="label">LIVE  </span>{fmt(position[0])}, {fmt(position[1])}</div>
              {mode === 'child' && geofences.length > 0 && (
                <div style={{ color: '#00ff88' }}>
                  <span className="label">ZONES </span>{geofences.filter(f => f.active).length} active
                </div>
              )}
              {sos && sosLocation && (
                <div style={{ color: '#ff2244' }}>
                  <span className="label">SOS   </span>{fmt(sosLocation.lat)}, {fmt(sosLocation.lng)}
                </div>
              )}
            </div>
          )}

          {/* Child mode hint */}
          {mode === 'child' && adminToken && (
            <div className="map-hint">
              🖊 Use the draw tools (top-right of map) to draw a safe zone polygon or circle
            </div>
          )}
        </div>
      </div>

      {/* ── LOGIN MODAL ── */}
      {showLogin && <LoginModal onLogin={handleLogin} onClose={() => setShowLogin(false)} />}
    </div>
  );
}