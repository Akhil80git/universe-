import React, { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { EarthMapLayer } from '../types';

export interface SurfaceCommand {
  type: 'fly' | 'zoom-step' | 'reset-bearing' | 'set-pitch' | 'rotate-step';
  lat?: number;
  lng?: number;
  zoom?: number;
  zoomDirection?: 'in' | 'out';
  pitch?: number;
  bearingDelta?: number;
  nonce: number;
}

interface EarthSurfaceExplorerProps {
  visible: boolean;
  initialLat: number;
  initialLng: number;
  initialZoom?: number;
  layerMode: EarthMapLayer;
  is3DBuildings: boolean;
  autoOrbit360: boolean;
  command: SurfaceCommand | null;
  onTelemetryUpdate: (
    lat: number,
    lng: number,
    zoom: number,
    altitudeText: string,
    pitch: number,
    bearing: number,
  ) => void;
  onPlaceNameResolved: (placeName: string) => void;
  onStopOrbit360: () => void;
  onExitToSpace: (lat: number, lng: number) => void;
}

function zoomToAltitudeText(zoom: number, lat: number): string {
  const metersPerPixel = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
  const altMeters = metersPerPixel * 720;
  if (altMeters >= 1000) {
    const km = altMeters / 1000;
    return km >= 100 ? `${Math.round(km).toLocaleString()} km alt` : `${km.toFixed(1)} km alt`;
  }
  return `${Math.max(8, Math.round(altMeters))} m alt · House View`;
}

const smoothEase = (t: number) => 1 - Math.pow(1 - t, 3);

export const EarthSurfaceExplorer: React.FC<EarthSurfaceExplorerProps> = ({
  visible,
  initialLat,
  initialLng,
  initialZoom = 4.6,
  layerMode,
  is3DBuildings,
  autoOrbit360,
  command,
  onTelemetryUpdate,
  onPlaceNameResolved,
  onStopOrbit360,
  onExitToSpace,
}) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const lastFetchedBoxRef = useRef<string>('');
  const lastReverseKeyRef = useRef<string>('');
  const exitGuardRef = useRef<number>(0);

  const callbacksRef = useRef({
    onTelemetryUpdate,
    onPlaceNameResolved,
    onStopOrbit360,
    onExitToSpace,
  });
  callbacksRef.current = {
    onTelemetryUpdate,
    onPlaceNameResolved,
    onStopOrbit360,
    onExitToSpace,
  };

  const propsRef = useRef({ visible, layerMode, is3DBuildings, autoOrbit360 });
  propsRef.current = { visible, layerMode, is3DBuildings, autoOrbit360 };

  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container) return;

    const map = new maplibregl.Map({
      container,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            maxzoom: 19,
            attribution: '© OpenStreetMap contributors (Free Open Data)',
          },
          satellite: {
            type: 'raster',
            tiles: [
              'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            ],
            tileSize: 256,
            maxzoom: 19,
            attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
          },
          topo: {
            type: 'raster',
            tiles: [
              'https://a.tile.opentopomap.org/{z}/{x}/{y}.png',
              'https://b.tile.opentopomap.org/{z}/{x}/{y}.png',
              'https://c.tile.opentopomap.org/{z}/{x}/{y}.png',
            ],
            tileSize: 256,
            maxzoom: 17,
            attribution: '© OpenTopoMap (SRTM / OSM)',
          },
          darkmap: {
            type: 'raster',
            tiles: ['https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'],
            tileSize: 256,
            maxzoom: 19,
            attribution: '© CARTO · OpenStreetMap',
          },
          labels: {
            type: 'raster',
            tiles: [
              'https://basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}.png',
            ],
            tileSize: 256,
            maxzoom: 19,
          },
          buildings: {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
          },
        },
        layers: [
          {
            id: 'base-osm',
            type: 'raster',
            source: 'osm',
            layout: { visibility: layerMode === 'osm' ? 'visible' : 'none' },
          },
          {
            id: 'base-satellite',
            type: 'raster',
            source: 'satellite',
            layout: {
              visibility:
                layerMode === 'satellite' || layerMode === 'hybrid' ? 'visible' : 'none',
            },
          },
          {
            id: 'base-topo',
            type: 'raster',
            source: 'topo',
            layout: { visibility: layerMode === 'topo' ? 'visible' : 'none' },
          },
          {
            id: 'base-dark',
            type: 'raster',
            source: 'darkmap',
            layout: { visibility: layerMode === 'dark' ? 'visible' : 'none' },
          },
          {
            id: 'overlay-labels',
            type: 'raster',
            source: 'labels',
            layout: { visibility: layerMode === 'hybrid' ? 'visible' : 'none' },
          },
          {
            id: 'buildings-3d',
            type: 'fill-extrusion',
            source: 'buildings',
            minzoom: 14.5,
            paint: {
              'fill-extrusion-color': [
                'interpolate',
                ['linear'],
                ['get', 'height'],
                0,
                '#94a3b8',
                10,
                '#cbd5e1',
                28,
                '#e2e8f0',
                75,
                '#38bdf8',
              ],
              'fill-extrusion-height': ['get', 'height'],
              'fill-extrusion-base': 0,
              'fill-extrusion-opacity': 0.78,
            },
          },
        ],
      },
      center: [initialLng, initialLat],
      zoom: initialZoom,
      minZoom: 1.8,
      maxZoom: 20.5,
      maxPitch: 75,
      pitch: 0,
      bearing: 0,
      dragRotate: true,
      touchPitch: true,
      pitchWithRotate: true,
      fadeDuration: 180,
    });

    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
    map.scrollZoom.setWheelZoomRate(1 / 280);
    map.scrollZoom.setZoomRate(1 / 120);

    const cancelOrbitOnInteract = () => {
      if (propsRef.current.autoOrbit360) {
        callbacksRef.current.onStopOrbit360();
      }
    };
    map.on('dragstart', cancelOrbitOnInteract);
    map.on('wheel', cancelOrbitOnInteract);

    const loadBuildingsIfNeeded = async () => {
      if (!propsRef.current.visible || !propsRef.current.is3DBuildings) return;
      const z = map.getZoom();
      if (z < 15.0) return;

      const bounds = map.getBounds();
      const s = bounds.getSouth();
      const w = bounds.getWest();
      const n = bounds.getNorth();
      const e = bounds.getEast();
      if (Math.abs(n - s) > 0.035 || Math.abs(e - w) > 0.035) return;

      const boxKey = `${s.toFixed(3)},${w.toFixed(3)},${n.toFixed(3)},${e.toFixed(3)}`;
      if (boxKey === lastFetchedBoxRef.current) return;
      lastFetchedBoxRef.current = boxKey;

      try {
        const res = await fetch(`/api/buildings?south=${s}&west=${w}&north=${n}&east=${e}`);
        if (!res.ok) return;
        const geojson = await res.json();
        const src = map.getSource('buildings') as maplibregl.GeoJSONSource | undefined;
        if (src && geojson && Array.isArray(geojson.features)) {
          src.setData(geojson);
        }
      } catch {
        // Silent graceful fallback
      }
    };

    const resolvePlaceName = async () => {
      if (!propsRef.current.visible) return;
      const z = map.getZoom();
      if (z < 6.5) return;
      const c = map.getCenter();
      const key = `${c.lat.toFixed(2)},${c.lng.toFixed(2)}`;
      if (key === lastReverseKeyRef.current) return;
      lastReverseKeyRef.current = key;
      try {
        const res = await fetch(`/api/reverse-geocode?lat=${c.lat}&lng=${c.lng}`);
        if (res.ok) {
          const data = (await res.json()) as { label?: string };
          if (data.label) callbacksRef.current.onPlaceNameResolved(data.label);
        }
      } catch {
        // Silent fallback
      }
    };

    const reportTelemetry = () => {
      if (!propsRef.current.visible) return;
      const c = map.getCenter();
      const z = map.getZoom();
      callbacksRef.current.onTelemetryUpdate(
        c.lat,
        c.lng,
        z,
        zoomToAltitudeText(z, c.lat),
        map.getPitch(),
        map.getBearing(),
      );

      if (z <= 2.35 && performance.now() > exitGuardRef.current) {
        exitGuardRef.current = performance.now() + 1800;
        callbacksRef.current.onExitToSpace(c.lat, c.lng);
      }
    };

    map.on('move', reportTelemetry);
    map.on('moveend', () => {
      reportTelemetry();
      loadBuildingsIfNeeded();
      resolvePlaceName();
    });
    map.on('error', () => {
      // Suppress transient tile errors cleanly
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Continuous 360° Fly-Around Orbit around current house/landmark
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !visible || !autoOrbit360) return;

    let rafId = 0;
    let lastTs = performance.now();

    if (map.getPitch() < 35) {
      map.easeTo({ pitch: 58, duration: 700, easing: smoothEase });
    }

    const spin = (now: number) => {
      const dt = Math.min((now - lastTs) / 1000, 0.1);
      lastTs = now;
      if (propsRef.current.visible && propsRef.current.autoOrbit360) {
        map.setBearing((map.getBearing() + dt * 13) % 360);
        rafId = requestAnimationFrame(spin);
      }
    };
    rafId = requestAnimationFrame(spin);
    return () => cancelAnimationFrame(rafId);
  }, [visible, autoOrbit360]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !visible) return;

    exitGuardRef.current = performance.now() + 1400;
    map.resize();
    map.jumpTo({
      center: [initialLng, initialLat],
      zoom: Math.max(initialZoom, 3.8),
      pitch: is3DBuildings ? 54 : 0,
    });
    map.easeTo({
      center: [initialLng, initialLat],
      zoom: initialZoom >= 10 ? initialZoom : 6.4,
      duration: 1050,
      easing: smoothEase,
    });
  }, [visible, initialLat, initialLng, initialZoom]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    const osmVis = layerMode === 'osm' ? 'visible' : 'none';
    const satVis = layerMode === 'satellite' || layerMode === 'hybrid' ? 'visible' : 'none';
    const topoVis = layerMode === 'topo' ? 'visible' : 'none';
    const darkVis = layerMode === 'dark' ? 'visible' : 'none';
    const lblVis = layerMode === 'hybrid' ? 'visible' : 'none';

    if (map.getLayer('base-osm')) map.setLayoutProperty('base-osm', 'visibility', osmVis);
    if (map.getLayer('base-satellite')) map.setLayoutProperty('base-satellite', 'visibility', satVis);
    if (map.getLayer('base-topo')) map.setLayoutProperty('base-topo', 'visibility', topoVis);
    if (map.getLayer('base-dark')) map.setLayoutProperty('base-dark', 'visibility', darkVis);
    if (map.getLayer('overlay-labels')) map.setLayoutProperty('overlay-labels', 'visibility', lblVis);
  }, [layerMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (map.isStyleLoaded() && map.getLayer('buildings-3d')) {
      map.setLayoutProperty('buildings-3d', 'visibility', is3DBuildings ? 'visible' : 'none');
    }

    if (visible) {
      map.easeTo({
        pitch: is3DBuildings ? 58 : 0,
        duration: 650,
        easing: smoothEase,
      });
    }
  }, [is3DBuildings, visible]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !command || !visible) return;

    if (command.type === 'fly' && typeof command.lat === 'number' && typeof command.lng === 'number') {
      exitGuardRef.current = performance.now() + 1400;
      map.flyTo({
        center: [command.lng, command.lat],
        zoom: command.zoom ?? 17.8,
        pitch: is3DBuildings ? 58 : 0,
        speed: 1.35,
        curve: 1.42,
        easing: smoothEase,
        essential: true,
      });
    } else if (command.type === 'reset-bearing') {
      map.easeTo({
        bearing: 0,
        pitch: is3DBuildings ? 58 : 0,
        duration: 600,
        easing: smoothEase,
      });
    } else if (command.type === 'set-pitch' && typeof command.pitch === 'number') {
      map.easeTo({
        pitch: command.pitch,
        duration: 650,
        easing: smoothEase,
      });
    } else if (command.type === 'rotate-step' && typeof command.bearingDelta === 'number') {
      map.easeTo({
        bearing: map.getBearing() + command.bearingDelta,
        duration: 550,
        easing: smoothEase,
      });
    } else if (command.type === 'zoom-step') {
      const curZoom = map.getZoom();
      if (command.zoomDirection === 'out' && curZoom <= 3.1) {
        const c = map.getCenter();
        exitGuardRef.current = performance.now() + 1800;
        callbacksRef.current.onExitToSpace(c.lat, c.lng);
        return;
      }
      const nextZoom = Math.max(
        2.0,
        Math.min(20.2, curZoom + (command.zoomDirection === 'in' ? 1.8 : -1.8)),
      );
      map.easeTo({ zoom: nextZoom, duration: 520, easing: smoothEase });
    }
  }, [command, visible, is3DBuildings]);

  return (
    <div
      className={`absolute inset-0 z-10 transition-opacity duration-500 ${
        visible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
      }`}
    >
      <div ref={mapContainerRef} className="w-full h-full" />
    </div>
  );
};
