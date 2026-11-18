import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface GeocodeResult {
  name: string;
  displayName: string;
  lat: number;
  lng: number;
  type: string;
  zoomHint: number;
}

const geocodeCache = new Map<string, { ts: number; results: GeocodeResult[] }>();
const buildingsCache = new Map<string, { ts: number; geojson: GeoJSONFeatureCollection }>();

interface GeoJSONFeature {
  type: 'Feature';
  properties: {
    height: number;
    levels: number;
    name?: string;
    buildingType: string;
  };
  geometry: {
    type: 'Polygon';
    coordinates: number[][][];
  };
}

interface GeoJSONFeatureCollection {
  type: 'FeatureCollection';
  features: GeoJSONFeature[];
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  // Geocode any place, city, village, street, or home address on Earth
  app.get('/api/geocode', async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q.length < 2) {
      res.json({ results: [] });
      return;
    }

    const cacheKey = q.toLowerCase();
    const cached = geocodeCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < 1000 * 60 * 30) {
      res.json({ results: cached.results });
      return;
    }

    try {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&addressdetails=1&q=${encodeURIComponent(q)}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'BrahmandUniverseExplorer/1.0 (https://brahmand.space)',
          'Accept-Language': 'en',
        },
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!response.ok) {
        res.json({ results: [], source: 'unavailable' });
        return;
      }

      const raw = (await response.json()) as Array<{
        name?: string;
        display_name?: string;
        lat: string;
        lon: string;
        type?: string;
        addresstype?: string;
      }>;

      const results: GeocodeResult[] = raw
        .map((item) => {
          const lat = Number(item.lat);
          const lng = Number(item.lon);
          const kind = item.addresstype || item.type || 'place';
          const zoomHint =
            kind === 'house' || kind === 'building' || kind === 'residential'
              ? 18.5
              : kind === 'road' || kind === 'neighbourhood' || kind === 'suburb'
                ? 16.8
                : kind === 'village' || kind === 'town'
                  ? 15.2
                  : kind === 'city'
                    ? 13.5
                    : 14.5;
          return {
            name: item.name || (item.display_name ? item.display_name.split(',')[0] : q),
            displayName: item.display_name || q,
            lat,
            lng,
            type: kind,
            zoomHint,
          };
        })
        .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lng));

      geocodeCache.set(cacheKey, { ts: Date.now(), results });
      if (geocodeCache.size > 200) {
        const firstKey = geocodeCache.keys().next().value;
        if (firstKey) geocodeCache.delete(firstKey);
      }

      res.json({ results });
    } catch {
      res.json({ results: [], source: 'offline' });
    }
  });

  const reverseCache = new Map<string, { ts: number; label: string }>();

  app.get('/api/reverse-geocode', async (req, res) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      res.json({ label: 'Earth Surface' });
      return;
    }

    const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
    const cached = reverseCache.get(key);
    if (cached && Date.now() - cached.ts < 1000 * 60 * 30) {
      res.json({ label: cached.label });
      return;
    }

    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=16`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3500);
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'BrahmandUniverseExplorer/1.0 (https://brahmand.space)',
          'Accept-Language': 'en',
        },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!response.ok) {
        res.json({ label: 'Earth Surface' });
        return;
      }
      const data = (await response.json()) as {
        name?: string;
        address?: {
          road?: string;
          neighbourhood?: string;
          suburb?: string;
          city?: string;
          town?: string;
          village?: string;
          state?: string;
          country?: string;
        };
      };
      const a = data.address;
      const parts = [
        data.name || a?.road || a?.neighbourhood || a?.suburb,
        a?.city || a?.town || a?.village || a?.state,
        a?.country,
      ].filter(Boolean);
      const label = parts.length > 0 ? parts.slice(0, 2).join(', ') : 'Ocean / Open Terrain';
      reverseCache.set(key, { ts: Date.now(), label });
      if (reverseCache.size > 300) {
        const firstKey = reverseCache.keys().next().value;
        if (firstKey) reverseCache.delete(firstKey);
      }
      res.json({ label });
    } catch {
      res.json({ label: 'Earth Surface' });
    }
  });

  // Fetch real OpenStreetMap building footprints for 3D house & building extrusions
  app.get('/api/buildings', async (req, res) => {
    const south = Number(req.query.south);
    const west = Number(req.query.west);
    const north = Number(req.query.north);
    const east = Number(req.query.east);

    if (
      !Number.isFinite(south) ||
      !Number.isFinite(west) ||
      !Number.isFinite(north) ||
      !Number.isFinite(east)
    ) {
      res.status(400).json({ type: 'FeatureCollection', features: [] });
      return;
    }

    // Clamp query box to small neighborhood scale so Overpass stays fast
    const latSpan = Math.abs(north - south);
    const lngSpan = Math.abs(east - west);
    if (latSpan > 0.035 || lngSpan > 0.035) {
      res.json({ type: 'FeatureCollection', features: [] });
      return;
    }

    const key = `${south.toFixed(3)},${west.toFixed(3)},${north.toFixed(3)},${east.toFixed(3)}`;
    const cached = buildingsCache.get(key);
    if (cached && Date.now() - cached.ts < 1000 * 60 * 60) {
      res.json(cached.geojson);
      return;
    }

    try {
      const overpassQuery = `[out:json][timeout:6];(way["building"](${south},${west},${north},${east}););out body 450;>;out skel qt;`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5500);

      const response = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'BrahmandUniverseExplorer/1.0',
        },
        body: `data=${encodeURIComponent(overpassQuery)}`,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!response.ok) {
        res.json({ type: 'FeatureCollection', features: [] });
        return;
      }

      const data = (await response.json()) as {
        elements?: Array<{
          type: string;
          id: number;
          lat?: number;
          lon?: number;
          nodes?: number[];
          tags?: Record<string, string>;
        }>;
      };

      const nodes = new Map<number, [number, number]>();
      const features: GeoJSONFeature[] = [];

      for (const el of data.elements ?? []) {
        if (el.type === 'node' && typeof el.lon === 'number' && typeof el.lat === 'number') {
          nodes.set(el.id, [el.lon, el.lat]);
        }
      }

      for (const el of data.elements ?? []) {
        if (el.type !== 'way' || !Array.isArray(el.nodes) || el.nodes.length < 4) continue;
        const ring: number[][] = [];
        for (const nodeId of el.nodes) {
          const coord = nodes.get(nodeId);
          if (coord) ring.push(coord);
        }
        if (ring.length < 4) continue;
        const first = ring[0];
        const last = ring[ring.length - 1];
        if (first[0] !== last[0] || first[1] !== last[1]) {
          ring.push([first[0], first[1]]);
        }

        const tags = el.tags ?? {};
        const parsedHeight = parseFloat(tags.height || '');
        const parsedLevels = parseFloat(tags['building:levels'] || '');
        const levels = Number.isFinite(parsedLevels) && parsedLevels > 0 ? parsedLevels : 2;
        const height =
          Number.isFinite(parsedHeight) && parsedHeight > 0
            ? Math.min(parsedHeight, 320)
            : Math.min(levels * 3.4 + (el.id % 3), 120);

        features.push({
          type: 'Feature',
          properties: {
            height,
            levels,
            name: tags.name,
            buildingType: tags.building || 'yes',
          },
          geometry: {
            type: 'Polygon',
            coordinates: [ring],
          },
        });
      }

      const geojson: GeoJSONFeatureCollection = { type: 'FeatureCollection', features };
      buildingsCache.set(key, { ts: Date.now(), geojson });
      if (buildingsCache.size > 120) {
        const firstKey = buildingsCache.keys().next().value;
        if (firstKey) buildingsCache.delete(firstKey);
      }

      res.json(geojson);
    } catch {
      res.json({ type: 'FeatureCollection', features: [] });
    }
  });

  const isProduction = process.env.NODE_ENV === 'production';
  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distDir, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT) || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Brahmand server running at http://localhost:${PORT}`);
  });
}

startServer();
