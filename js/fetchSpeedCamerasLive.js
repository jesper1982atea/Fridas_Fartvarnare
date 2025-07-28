const statusDiv = document.getElementById("status");
let map = L.map('map').setView([59.33, 18.06], 10);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 18
}).addTo(map);

let userMarker = null;
let lastPosition = null;
let lastSpeedCheck = null;
let cameras = [];
let avgStart = null;
let avgZoneId = null;

function toFixed(n) {
  return n ? n.toFixed(1) : "-";
}

function getDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) ** 2 + Math.cos(lat1 * Math.PI/180) *
            Math.cos(lat2 * Math.PI/180) * Math.sin(dLon/2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function renderCameras(cams) {
  cams.forEach(cam => {
    const marker = L.marker([cam.lat, cam.lon]).addTo(map);
    const label = cam.name + (cam.maxspeed ? ` (${cam.maxspeed} km/h)` : "");
    marker.bindPopup(label);
  });
}

function updateStatus(gpsSpeed, maxspeed) {
  const kmh = gpsSpeed ? (gpsSpeed * 3.6).toFixed(1) : "-";
  statusDiv.innerHTML = `🚗 Din hastighet: <b>${kmh} km/h</b><br>`;
  if (maxspeed) {
    statusDiv.innerHTML += `📏 Tillåten hastighet: <b>${maxspeed} km/h</b><br>`;
  }
  if (avgStart) {
    const dist = getDistanceKm(avgStart.lat, avgStart.lon, lastPosition.lat, lastPosition.lon);
    const secs = (Date.now() - avgStart.time) / 1000;
    const avgSpeed = (dist / (secs / 3600)).toFixed(1);
    statusDiv.innerHTML += `🧮 Medelhastighet i zon: <b>${avgSpeed} km/h</b>`;
  }
}

function loadNearbyCameras(lat, lon) {
  const delta = 0.5;
  const bbox = [lat - delta, lon - delta, lat + delta, lon + delta];
  const query = `
    [out:json][timeout:25];
    (
      node["highway"="speed_camera"](${bbox.join(',')});
    );
    out body;
  `;

  fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    body: query
  })
  .then(res => res.json())
  .then(json => {
    cameras = json.elements.map(node => ({
      lat: node.lat,
      lon: node.lon,
      name: node.tags?.["speed_camera:type"] === "average"
        ? "Medelhastighetskamera"
        : "Fartkamera",
      maxspeed: node.tags?.maxspeed || null,
      type: node.tags?.["speed_camera:type"] === "average" ? "average" : null,
      id: node.id
    }));
    renderCameras(cameras);
    statusDiv.innerHTML += `<br>✅ Kameror laddade: ${cameras.length}`;
  });
}

function startLocation() {
  navigator.geolocation.watchPosition(pos => {
    const { latitude, longitude, speed } = pos.coords;
    const lat = latitude;
    const lon = longitude;
    const gpsSpeed = speed;

    if (!userMarker) {
      userMarker = L.marker([lat, lon], { color: "blue" }).addTo(map);
      map.setView([lat, lon], 14);
      loadNearbyCameras(lat, lon);
    } else {
      userMarker.setLatLng([lat, lon]);
    }

    lastPosition = { lat, lon };

    cameras.forEach(cam => {
      const dist = getDistanceKm(lat, lon, cam.lat, cam.lon);
      if (dist < 0.15 && cam.type === "average") {
        if (!avgStart || avgStart.zoneId !== cam.id) {
          if (!avgStart) {
            avgStart = { lat, lon, time: Date.now(), zoneId: cam.id };
            avgZoneId = cam.id;
          } else {
            const secs = (Date.now() - avgStart.time) / 1000;
            const dist = getDistanceKm(avgStart.lat, avgStart.lon, lat, lon);
            const avgSpeed = (dist / (secs / 3600)).toFixed(1);
            alert("Medelhastighetszon avslutad. Din snitthastighet: " + avgSpeed + " km/h");
            avgStart = null;
            avgZoneId = null;
          }
        }
      }
    });

    let nearestSpeed = null;
    let nearestDist = Infinity;
    cameras.forEach(cam => {
      const d = getDistanceKm(lat, lon, cam.lat, cam.lon);
      if (cam.maxspeed && d < 0.3 && d < nearestDist) {
        nearestSpeed = cam.maxspeed;
        nearestDist = d;
      }
    });

    updateStatus(gpsSpeed, nearestSpeed);
  }, err => {
    statusDiv.innerText = "🚫 GPS-fel: " + err.message;
  }, {
    enableHighAccuracy: true,
    maximumAge: 1000,
    timeout: 10000
  });
}
