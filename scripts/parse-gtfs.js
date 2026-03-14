#!/usr/bin/env node

const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const AdmZip = require('adm-zip');

// Base URL matches UPSTREAM_API_BASE in lib/config.ts — keep in sync if the API changes.
const UPSTREAM_API_BASE = 'https://data.mobilites-m.fr/api';
const GTFS_URL = `${UPSTREAM_API_BASE}/gtfs/SEM`;
const OUT_DIR = path.join(__dirname, '..', 'public', 'gtfs');
const TMP_ZIP = path.join(os.tmpdir(), 'gtfs.zip');

function download(url, dest) {
  return new Promise((resolve, reject) => {
    console.log(`Downloading ${url}...`);
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', reject);
  });
}

function parseCSVLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      values.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  values.push(current);
  return values;
}

function parseCSV(text) {
  const lines = text.split('\n');
  const headers = parseCSVLine(lines[0].replace(/\r$/, ''));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '');
    if (!line) continue;
    const values = parseCSVLine(line);
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] ?? '';
    }
    rows.push(row);
  }
  return rows;
}

function bearing(a, b) {
  const lat1 = parseFloat(a.lat) * Math.PI / 180;
  const angle = Math.atan2(
    (parseFloat(b.lon) - parseFloat(a.lon)) * Math.cos(lat1),
    parseFloat(b.lat) - parseFloat(a.lat)
  ) * 180 / Math.PI;
  return (angle + 360) % 360;
}

function cleanShape(points, threshold = 120) {
  if (points.length < 3) return points;
  const result = [...points];
  let i = 1;
  while (i < result.length - 1) {
    const bIn  = bearing(result[i - 1], result[i]);
    const bOut = bearing(result[i],     result[i + 1]);
    let diff = Math.abs(bIn - bOut) % 360;
    if (diff > 180) diff = 360 - diff;
    if (diff > threshold) {
      result.splice(i, 1);
    } else {
      i++;
    }
  }
  return result;
}

function haversineMeters(a, b) {
  const R = 6371000;
  const lat1 = parseFloat(a.lat) * Math.PI / 180;
  const lat2 = parseFloat(b.lat) * Math.PI / 180;
  const dlat = (parseFloat(b.lat) - parseFloat(a.lat)) * Math.PI / 180;
  const dlon = (parseFloat(b.lon) - parseFloat(a.lon)) * Math.PI / 180;
  const s = Math.sin(dlat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dlon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

function subdivideShape(points, maxDist = 15) {
  if (points.length < 2) return points;
  const result = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dist = haversineMeters(a, b);
    if (dist > maxDist) {
      const n = Math.ceil(dist / maxDist);
      for (let j = 1; j < n; j++) {
        const t = j / n;
        result.push({
          lat: String(parseFloat(a.lat) + t * (parseFloat(b.lat) - parseFloat(a.lat))),
          lon: String(parseFloat(a.lon) + t * (parseFloat(b.lon) - parseFloat(a.lon))),
          sequence: a.sequence,
        });
      }
    }
    result.push(b);
  }
  return result;
}

function smoothShape(points, iterations = 3) {
  if (points.length < 3) return points;
  let pts = points;
  for (let iter = 0; iter < iterations; iter++) {
    const next = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      next.push({
        lat: String(0.25 * parseFloat(pts[i - 1].lat) + 0.5 * parseFloat(pts[i].lat) + 0.25 * parseFloat(pts[i + 1].lat)),
        lon: String(0.25 * parseFloat(pts[i - 1].lon) + 0.5 * parseFloat(pts[i].lon) + 0.25 * parseFloat(pts[i + 1].lon)),
        sequence: pts[i].sequence,
      });
    }
    next.push(pts[pts.length - 1]);
    pts = next;
  }
  return pts;
}

function writeJSON(filename, data) {
  const outPath = path.join(OUT_DIR, filename);
  fs.writeFileSync(outPath, JSON.stringify(data));
  console.log(`Wrote ${outPath} (${Array.isArray(data) ? data.length + ' records' : Object.keys(data).length + ' keys'})`);
}

async function main() {
  try {
    fs.mkdirSync(OUT_DIR, { recursive: true });

    await download(GTFS_URL, TMP_ZIP);
    console.log('Extracting zip...');
    const zip = new AdmZip(TMP_ZIP);

    // routes.txt → filter tram (route_type === "0")
    console.log('Parsing routes.txt...');
    const routesText = zip.readAsText('routes.txt');
    const routes = parseCSV(routesText).filter(r => r.route_type === '0');
    writeJSON('routes.json', routes);

    const tramRouteIds = new Set(routes.map(r => r.route_id));

    // stops.txt → pick 4 fields
    console.log('Parsing stops.txt...');
    const stopsText = zip.readAsText('stops.txt');
    const stops = parseCSV(stopsText).map(r => ({
      stop_id: r.stop_id,
      stop_name: r.stop_name,
      stop_lat: r.stop_lat,
      stop_lon: r.stop_lon,
      parent_station: r.parent_station ?? '',
    }));
    writeJSON('stops.json', stops);

    // trips.txt → filter to tram route_ids
    console.log('Parsing trips.txt...');
    const tripsText = zip.readAsText('trips.txt');
    const trips = parseCSV(tripsText)
      .filter(r => tramRouteIds.has(r.route_id))
      .map(r => ({
        trip_id: r.trip_id,
        route_id: r.route_id,
        shape_id: r.shape_id,
        service_id: r.service_id,
        direction_id: r.direction_id,
      }));
    writeJSON('trips.json', trips);

    const tramTripIds = new Set(trips.map(t => t.trip_id));

    // stop_times.txt → stream line-by-line, filter to tram trip_ids
    console.log('Parsing stop_times.txt...');
    const stopTimesBuffer = zip.readFile('stop_times.txt').toString('utf8');
    const stLines = stopTimesBuffer.split('\n');
    const stHeaders = stLines[0].replace(/\r$/, '').split(',');
    const idxTripId = stHeaders.indexOf('trip_id');
    const idxStopId = stHeaders.indexOf('stop_id');
    const idxStopSeq = stHeaders.indexOf('stop_sequence');
    const idxArrival = stHeaders.indexOf('arrival_time');
    const idxDeparture = stHeaders.indexOf('departure_time');

    const stopTimes = [];
    for (let i = 1; i < stLines.length; i++) {
      const line = stLines[i].replace(/\r$/, '');
      if (!line) continue;
      const vals = line.split(',');
      const tripId = vals[idxTripId];
      if (!tramTripIds.has(tripId)) continue;
      stopTimes.push({
        trip_id: tripId,
        stop_id: vals[idxStopId],
        stop_sequence: vals[idxStopSeq],
        arrival_time: vals[idxArrival],
        departure_time: vals[idxDeparture],
      });
    }
    writeJSON('stop_times.json', stopTimes);

    // shapes.txt → group by shape_id, sort by sequence
    console.log('Parsing shapes.txt...');
    const shapesText = zip.readAsText('shapes.txt');
    const shapesRaw = parseCSV(shapesText);
    const shapes = {};
    for (const r of shapesRaw) {
      if (!shapes[r.shape_id]) shapes[r.shape_id] = [];
      shapes[r.shape_id].push({
        lat: r.shape_pt_lat,
        lon: r.shape_pt_lon,
        sequence: parseInt(r.shape_pt_sequence, 10),
      });
    }
    let totalRemoved = 0;
    for (const id of Object.keys(shapes)) {
      shapes[id].sort((a, b) => a.sequence - b.sequence);
      const before = shapes[id].length;
      shapes[id] = cleanShape(shapes[id]);
      totalRemoved += before - shapes[id].length;
      shapes[id] = subdivideShape(shapes[id]);
      shapes[id] = smoothShape(shapes[id]);
    }
    console.log(`cleanShape removed ${totalRemoved} points across all shapes`);
    writeJSON('shapes.json', shapes);

    // segment-paths.json — pre-compute all unique stop-pair shape segments
    console.log('Building segment paths...');

    function makeSegKey(a, b) {
      return [a, b].sort().join('__').replace(/[^a-zA-Z0-9]/g, '-');
    }

    function extractSegPath(shape, stopALat, stopALon, stopBLat, stopBLon) {
      const a = { lat: parseFloat(stopALat), lng: parseFloat(stopALon) };
      const b = { lat: parseFloat(stopBLat), lng: parseFloat(stopBLon) };
      if (!shape || shape.length < 2) return [a, b];

      const SNAP_THRESHOLD_DEG = 0.001; // ~100m à 45°N

      function cosLatDist(p, q) {
        const cosLat = Math.cos(p.lat * Math.PI / 180);
        return Math.hypot(parseFloat(p.lat) - q.lat, (parseFloat(p.lon ?? p.lng) - q.lng) * cosLat);
      }

      // First pass: find iA across the full shape
      let iA = 0, dA = Infinity;
      for (let i = 0; i < shape.length; i++) {
        const d = cosLatDist(shape[i], a);
        if (d < dA) { dA = d; iA = i; }
      }

      // Second pass: find iB only forward from iA + 1
      let iB = -1, dB = Infinity;
      for (let i = iA + 1; i < shape.length; i++) {
        const d = cosLatDist(shape[i], b);
        if (d < dB) { dB = d; iB = i; }
      }

      if (iB === -1) return [a, b];

      const slice = shape.slice(iA, iB + 1).map(p => ({
        lat: parseFloat(p.lat),
        lng: parseFloat(p.lon ?? p.lng),
      }));

      // N'injecter a/b comme ancres que s'ils sont suffisamment éloignés
      // du premier/dernier point du slice — sinon ils créent un micro U-turn
      const result = [];
      if (cosLatDist(shape[iA], a) > SNAP_THRESHOLD_DEG) result.push(a);
      result.push(...slice);
      if (cosLatDist(shape[iB], b) > SNAP_THRESHOLD_DEG) result.push(b);

      return result.length >= 2 ? result : [a, b];
    }

    const stopById = {};
    for (const stop of stops) stopById[stop.stop_id] = stop;

    const stopTimesByTrip = {};
    for (const st of stopTimes) {
      if (!stopTimesByTrip[st.trip_id]) stopTimesByTrip[st.trip_id] = [];
      stopTimesByTrip[st.trip_id].push(st);
    }
    for (const arr of Object.values(stopTimesByTrip)) {
      arr.sort((a, b) => parseInt(a.stop_sequence, 10) - parseInt(b.stop_sequence, 10));
    }

    // === OSM tram route geometry ===
    const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
    const OVERPASS_QUERY = `[out:json][timeout:60];
relation["route"="tram"]["network"="TAG"](44.95,5.45,45.45,6.05);
(._;>;);
out body;`;
    const OSM_MATCH_DEG = 0.00045; // ~50 m

    const osmSegments = {};
    try {
      console.log('Fetching OSM tram route geometry from Overpass...');
      const osmRes = await fetch(OVERPASS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(OVERPASS_QUERY),
      });
      if (!osmRes.ok) throw new Error(`Overpass HTTP ${osmRes.status}`);
      const osmData = await osmRes.json();

      // Build lookup maps
      const nodeById = {};
      const wayNodesById = {};
      for (const el of osmData.elements) {
        if (el.type === 'node') nodeById[el.id] = el;
        if (el.type === 'way') wayNodesById[el.id] = el.nodes;
      }

      const relations = osmData.elements.filter(e => e.type === 'relation');
      let osmSegCount = 0;

      for (const rel of relations) {
        // a. Reconstruct ordered polyline by chaining way members
        const wayMembers = rel.members.filter(m => m.type === 'way');
        let polyline = null;
        for (const wm of wayMembers) {
          const nodeIds = wayNodesById[wm.ref];
          if (!nodeIds) continue;
          const wayPts = nodeIds.map(id => nodeById[id]).filter(Boolean).map(n => ({ lat: n.lat, lng: n.lon }));
          if (!wayPts.length) continue;

          if (!polyline) {
            polyline = [...wayPts];
          } else {
            const lastPt = polyline[polyline.length - 1];
            const distForward = Math.hypot(lastPt.lat - wayPts[0].lat, lastPt.lng - wayPts[0].lng);
            const distReverse = Math.hypot(lastPt.lat - wayPts[wayPts.length - 1].lat, lastPt.lng - wayPts[wayPts.length - 1].lng);
            if (distReverse < distForward) wayPts.reverse();
            polyline.push(...wayPts.slice(1));
          }
        }
        if (!polyline || polyline.length < 2) continue;

        // b. Extract stop_position members in order
        const stopMembers = rel.members.filter(m => m.type === 'node' && (m.role === 'stop' || m.role === 'stop_position'));

        // c. Match each stop_position to a GTFS stop by nearest neighbour
        const matchedStops = [];
        for (const sm of stopMembers) {
          const osmNode = nodeById[sm.ref];
          if (!osmNode) continue;

          let bestStop = null, bestDist = Infinity;
          for (const stop of stops) {
            const d = Math.hypot(parseFloat(stop.stop_lat) - osmNode.lat, parseFloat(stop.stop_lon) - osmNode.lon);
            if (d < bestDist) { bestDist = d; bestStop = stop; }
          }

          if (bestStop && bestDist <= OSM_MATCH_DEG) {
            matchedStops.push({ stop: bestStop, osmNode });
          } else {
            console.warn(`[OSM] Unmatched stop_position node ${sm.ref} at (${osmNode.lat}, ${osmNode.lon})`);
          }
        }

        // d. Find nearest polyline index for each matched stop, then slice
        const stopIndices = matchedStops.map(({ osmNode }) => {
          let bestIdx = 0, bestDist = Infinity;
          for (let i = 0; i < polyline.length; i++) {
            const d = Math.hypot(polyline[i].lat - osmNode.lat, polyline[i].lng - osmNode.lng);
            if (d < bestDist) { bestDist = d; bestIdx = i; }
          }
          return bestIdx;
        });

        for (let i = 1; i < matchedStops.length; i++) {
          const idxA = stopIndices[i - 1];
          const idxB = stopIndices[i];
          if (idxA >= idxB) continue;
          const key = makeSegKey(matchedStops[i - 1].stop.stop_id, matchedStops[i].stop.stop_id);
          osmSegments[key] = polyline.slice(idxA, idxB + 1);
          osmSegCount++;
        }
      }

      console.log(`[OSM] Built ${osmSegCount} segments from ${relations.length} relations`);
    } catch (osmErr) {
      console.warn('[OSM] Failed to fetch OSM data, will use GTFS fallback for all segments:', osmErr.message);
    }

    // Build final segment-paths: prefer OSM geometry, fall back to GTFS shape
    const segmentPaths = {};
    for (const trip of trips) {
      const tripStops = stopTimesByTrip[trip.trip_id];
      if (!tripStops) continue;
      const shape = shapes[trip.shape_id];

      for (let i = 1; i < tripStops.length; i++) {
        const stA = tripStops[i - 1];
        const stB = tripStops[i];
        const stopA = stopById[stA.stop_id];
        const stopB = stopById[stB.stop_id];
        if (!stopA || !stopB) continue;

        const key = makeSegKey(stA.stop_id, stB.stop_id);
        if (segmentPaths[key]) continue;

        if (osmSegments[key]) {
          segmentPaths[key] = osmSegments[key];
          console.log(`[OSM] ${stA.stop_id} → ${stB.stop_id}`);
        } else {
          segmentPaths[key] = extractSegPath(shape, stopA.stop_lat, stopA.stop_lon, stopB.stop_lat, stopB.stop_lon);
          console.log(`[GTFS fallback] ${stA.stop_id} → ${stB.stop_id}`);
        }
      }
    }
    writeJSON('segment-paths.json', segmentPaths);

    console.log('Done.');
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
