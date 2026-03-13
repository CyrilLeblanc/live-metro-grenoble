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
    for (const id of Object.keys(shapes)) {
      shapes[id].sort((a, b) => a.sequence - b.sequence);
    }
    writeJSON('shapes.json', shapes);

    console.log('Done.');
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
