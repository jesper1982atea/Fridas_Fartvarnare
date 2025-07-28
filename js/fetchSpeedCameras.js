const statusDiv = document.getElementById("status");
let map = L.map('map').setView([59.33, 18.06], 10);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 18
}).addTo(map);

const TTS = (text) => window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
let cameras = [];

async function fetchCamerasWithZones() {
  const cacheKey = "cameraCacheV1";
  const cacheTimeKey = "cameraCacheTime";
  const oneDay = 24 * 60 * 60 * 1000;
  const now = Date.now();

  const cachedData = localStorage.getItem(cacheKey);
  const cachedTime = localStorage.getItem(cacheTimeKey);

  if (cachedData && cachedTime && now - cachedTime < oneDay) {
    console.log("Loaded cameras from cache");
    return JSON.parse(cachedData);
  }

  const query = `
    [out:json][timeout:60];
    (
      node["highway"="speed_camera"](45.0,-10.0,72.0,30.0);
    );
    out body;
  `;

  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    body: query,
  });
  const json = await res.json();

  const rawNodes = json.elements;
  const speedCameras = [];

  let zoneCounter = 1;
  const zoneMap = {};

  for (let node of rawNodes) {
    const isAverage = node.tags?.["speed_camera:type"] === "average";
    const maxspeed = node.tags?.["maxspeed"] || "okänd";

    const cam = {
      lat: node.lat,
      lon: node.lon,
      name: isAverage ? "Medelhastighetskamera" : "Fartkamera",
      maxspeed,
      id: node.id
    };

    if (isAverage) {
      const zoneKey = `${Math.round(node.lat * 10) / 10},${Math.round(node.lon * 10) / 10}`;
      if (!zoneMap[zoneKey]) {
        zoneMap[zoneKey] = { start: cam };
      } else {
        zoneMap[zoneKey].end = cam;
        zoneMap[zoneKey].zoneId = zoneCounter++;
      }
    }

    speedCameras.push(cam);
  }

  for (const key in zoneMap) {
    const z = zoneMap[key];
    if (z.start && z.end) {
      z.start.type = "start";
      z.start.zoneId = z.zoneId;
      z.end.type = "end";
      z.end.zoneId = z.zoneId;
    }
  }

  localStorage.setItem(cacheKey, JSON.stringify(speedCameras));
  localStorage.setItem(cacheTimeKey, now.toString());

  return speedCameras;
}

function renderCameras(cams) {
  cams.forEach(cam => {
    const marker = L.marker([cam.lat, cam.lon]).addTo(map);
    const label = cam.name + (cam.maxspeed ? ` (${cam.maxspeed} km/h)` : "");
    marker.bindPopup(label);

    if (cam.type === "start") {
      marker.setIcon(new L.Icon.Default({ className: "start-zone" }));
    }
  });
}

navigator.geolocation.getCurrentPosition(pos => {
  const { latitude, longitude } = pos.coords;
  map.setView([latitude, longitude], 14);
}, () => {});

fetchCamerasWithZones().then(data => {
  cameras = data;
  renderCameras(cameras);
  statusDiv.innerText = "✅ Kameror laddade: " + cameras.length;
});
