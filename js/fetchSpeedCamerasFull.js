const statusDiv = document.getElementById("status");
const TTS = (text) => window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
let map = L.map('map').setView([59.33, 18.06], 10);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 18
}).addTo(map);

const carIcon = L.icon({
  iconUrl: 'img/car.png',
  iconSize: [32, 32],
  iconAnchor: [16, 16]
});

let userMarker = null;
let lastPosition = null;
let cameras = [];
let avgStart = null;
let avgZoneId = null;
let pathCoords = [];
let pathLine = L.polyline([], { color: 'blue' }).addTo(map);
let lastAnnouncedSpeed = null;

function getDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function renderCameras(cams) {
  cams.forEach(cam => {
    const iconColor = cam.type === "average" ? "red" : cam.type === "mobile" ? "orange" : "black";
    const marker = L.circleMarker([cam.lat, cam.lon], {
      radius: 6,
      color: iconColor,
      fillOpacity: 0.8
    }).addTo(map);
    const label = cam.name + (cam.maxspeed ? ` (${cam.maxspeed} km/h)` : "");
    marker.bindPopup(label);

    if (cam.type === "average") {
      L.circle([cam.lat, cam.lon], {
        color: 'red',
        radius: 150,
        fillOpacity: 0.4
      }).addTo(map).bindPopup("Medelhastighetszon");
    }
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

  if (maxspeed && maxspeed !== lastAnnouncedSpeed) {
    TTS("Tillåten hastighet är " + maxspeed + " kilometer i timmen");
    lastAnnouncedSpeed = maxspeed;
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
    cameras = json.elements.map(node => {
      let type = "stationary";
      if (node.tags?.["speed_camera:type"]) {
        type = node.tags["speed_camera:type"];
      }
      return {
        lat: node.lat,
        lon: node.lon,
        name: type === "average" ? "Medelhastighetskamera" : "Fartkamera",
        maxspeed: node.tags?.maxspeed || "okänd",
        type: type,
        id: node.id
      };
    });
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
      userMarker = L.marker([lat, lon], { icon: carIcon }).addTo(map);
      map.setView([lat, lon], 14);
      loadNearbyCameras(lat, lon);
    } else {
      userMarker.setLatLng([lat, lon]);
    }

    lastPosition = { lat, lon };
    pathCoords.push([lat, lon]);
    pathLine.setLatLngs(pathCoords);

    cameras.forEach(cam => {
      const dist = getDistanceKm(lat, lon, cam.lat, cam.lon);
      if (dist < 0.15 && cam.type === "average") {
        if (!avgStart || avgStart.zoneId !== cam.id) {
          if (!avgStart) {
            avgStart = { lat, lon, time: Date.now(), zoneId: cam.id };
            avgZoneId = cam.id;
            TTS("Du kör nu in i en medelhastighetszon.");
          } else {
            const secs = (Date.now() - avgStart.time) / 1000;
            const dist = getDistanceKm(avgStart.lat, avgStart.lon, lat, lon);
            const avgSpeed = (dist / (secs / 3600)).toFixed(1);
            TTS("Du har lämnat zonen. Din medelhastighet var " + avgSpeed + " kilometer i timmen.");
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
