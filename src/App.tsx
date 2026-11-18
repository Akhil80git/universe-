import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { ControlDock, type NavTabId } from './components/ControlDock';
import { EarthSurfaceExplorer, type SurfaceCommand } from './components/EarthSurfaceExplorer';
import { SearchModal } from './components/SearchModal';
import { BODY_MAP } from './universe/celestialData';
import { UniverseCanvas, type UniverseCommand } from './universe/UniverseCanvas';
import type {
  CelestialBodyId,
  EarthMapLayer,
  MissionId,
  MissionTelemetry,
  TelemetrySnapshot,
} from './types';

const TOUR_STOPS: Array<{ id: CelestialBodyId; dist?: number }> = [
  { id: 'universe' },
  { id: 'milky-way' },
  { id: 'sagittarius-a' },
  { id: 'sun', dist: 8.8 },
  { id: 'mercury' },
  { id: 'venus' },
  { id: 'earth' },
  { id: 'iss' },
  { id: 'moon' },
  { id: 'mars' },
  { id: 'jupiter' },
  { id: 'saturn' },
  { id: 'halley' },
  { id: 'voyager-1' },
];

export function App() {
  // Start on full Milky Way Galaxy (Aakashganga) & surrounding Cosmos at Real natural pace
  const [focusedId, setFocusedId] = useState<CelestialBodyId>('milky-way');
  const [timeScale, setTimeScale] = useState<number>(0.08);
  const [isPlaying, setIsPlaying] = useState<boolean>(true);
  const [showOrbits, setShowOrbits] = useState<boolean>(true);
  const [showLabels, setShowLabels] = useState<boolean>(true);
  const [showConstellations, setShowConstellations] = useState<boolean>(true);
  const [autoOrbit, setAutoOrbit] = useState<boolean>(false);
  const [tourActive, setTourActive] = useState<boolean>(false);
  const [zenMode, setZenMode] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<NavTabId>(null);
  const [searchOpen, setSearchOpen] = useState<boolean>(false);

  // Earth Surface Deep-Zoom state (Free OpenStreetMap + Open Map Tiles)
  const [isSurfaceMode, setIsSurfaceMode] = useState<boolean>(false);
  const [surfaceOrigin, setSurfaceOrigin] = useState<{ lat: number; lng: number; zoom: number }>({
    lat: 28.6129,
    lng: 77.2295,
    zoom: 6.2,
  });
  const [surfacePlaceName, setSurfacePlaceName] = useState<string>('Earth Surface');
  const [layerMode, setLayerMode] = useState<EarthMapLayer>('osm');
  const [is3DBuildings, setIs3DBuildings] = useState<boolean>(true);
  const [surfaceAutoOrbit, setSurfaceAutoOrbit] = useState<boolean>(false);

  // ISRO & NASA Mission Launch Simulator state
  const [activeMissionId, setActiveMissionId] = useState<MissionId | null>(null);
  const [missionSpeed, setMissionSpeed] = useState<number>(1);
  const [missionPaused, setMissionPaused] = useState<boolean>(false);
  const [missionTelemetry, setMissionTelemetry] = useState<MissionTelemetry | null>(null);
  const [missionSeekProgress, setMissionSeekProgress] = useState<{
    progress: number;
    nonce: number;
  } | null>(null);

  const [telemetry, setTelemetry] = useState<TelemetrySnapshot>({
    focusedId: 'milky-way',
    scaleLabel: 'Milky Way Galaxy',
    altitudeText: '97,770 ly',
    scaleMeterPct: 78,
    isSurfaceMode: false,
    cameraLat: 28.6129,
    cameraLng: 77.2295,
  });

  const nonceRef = useRef(1);
  const tourIndexRef = useRef(0);
  const [universeCmd, setUniverseCmd] = useState<UniverseCommand | null>(null);
  const [surfaceCmd, setSurfaceCmd] = useState<SurfaceCommand | null>(null);

  const nextNonce = () => {
    nonceRef.current += 1;
    return nonceRef.current;
  };

  const focusBodyInternal = useCallback((id: CelestialBodyId, distanceMultiplier?: number) => {
    setIsSurfaceMode(false);
    setSurfaceAutoOrbit(false);
    setFocusedId(id);
    setUniverseCmd({
      type: 'focus',
      bodyId: id,
      distanceMultiplier,
      nonce: nextNonce(),
    });
  }, []);

  const handleSelectBody = useCallback(
    (id: CelestialBodyId, distanceMultiplier?: number) => {
      setTourActive(false);
      setActiveTab(null);
      focusBodyInternal(id, distanceMultiplier);
    },
    [focusBodyInternal],
  );

  // Guided Cosmic Tour sequencer
  useEffect(() => {
    if (!tourActive) return;

    const currentIdx = TOUR_STOPS.findIndex((s) => s.id === focusedId);
    tourIndexRef.current = currentIdx >= 0 ? (currentIdx + 1) % TOUR_STOPS.length : 0;

    const firstStop = TOUR_STOPS[tourIndexRef.current];
    focusBodyInternal(firstStop.id, firstStop.dist);

    const timer = window.setInterval(() => {
      tourIndexRef.current = (tourIndexRef.current + 1) % TOUR_STOPS.length;
      const stop = TOUR_STOPS[tourIndexRef.current];
      focusBodyInternal(stop.id, stop.dist);
    }, 6500);

    return () => window.clearInterval(timer);
  }, [tourActive, focusBodyInternal]);

  const handleEnterEarthSurface = useCallback(
    (lat: number, lng: number, zoom?: number, label?: string) => {
      setTourActive(false);
      setActiveTab(null);
      setFocusedId('earth');
      setSurfaceOrigin({ lat, lng, zoom: zoom ?? 6.2 });
      setSurfacePlaceName(label ?? 'Earth Surface');
      setIsSurfaceMode(true);
    },
    [],
  );

  const handleZoomToHouses = useCallback(() => {
    setTourActive(false);
    setActiveTab(null);
    const lat = focusedId === 'earth' ? telemetry.cameraLat : 28.6129;
    const lng = focusedId === 'earth' ? telemetry.cameraLng : 77.2295;
    setFocusedId('earth');
    setSurfaceOrigin({ lat, lng, zoom: 17.8 });
    setSurfacePlaceName(focusedId === 'earth' ? 'Earth Surface' : 'New Delhi, India');
    setIsSurfaceMode(true);
    setSurfaceCmd({
      type: 'fly',
      lat,
      lng,
      zoom: 17.8,
      nonce: nextNonce(),
    });
  }, [focusedId, telemetry.cameraLat, telemetry.cameraLng]);

  const handleExitToSpace = useCallback((lat: number, lng: number) => {
    setTourActive(false);
    setActiveTab(null);
    setSurfaceAutoOrbit(false);
    setIsSurfaceMode(false);
    setFocusedId('earth');
    setUniverseCmd({
      type: 'fly-earth-latlng',
      lat,
      lng,
      distanceMultiplier: 3.1,
      nonce: nextNonce(),
    });
  }, []);

  const handleSelectEarthLocation = useCallback(
    (lat: number, lng: number, zoom: number, label: string) => {
      setTourActive(false);
      setActiveTab(null);
      setFocusedId('earth');
      setSurfaceOrigin({ lat, lng, zoom });
      setSurfacePlaceName(label);
      setIsSurfaceMode(true);
      setSurfaceCmd({
        type: 'fly',
        lat,
        lng,
        zoom,
        nonce: nextNonce(),
      });
    },
    [],
  );

  const handleZoomStep = useCallback(
    (dir: 'in' | 'out') => {
      setTourActive(false);
      if (isSurfaceMode) {
        setSurfaceCmd({ type: 'zoom-step', zoomDirection: dir, nonce: nextNonce() });
      } else {
        setUniverseCmd({ type: 'zoom-step', zoomDirection: dir, nonce: nextNonce() });
      }
    },
    [isSurfaceMode],
  );

  const handleScreenshot = useCallback(() => {
    if (!isSurfaceMode) {
      setUniverseCmd({ type: 'screenshot', nonce: nextNonce() });
    }
  }, [isSurfaceMode]);

  const handleResetNorth = useCallback(() => {
    if (isSurfaceMode) {
      setSurfaceAutoOrbit(false);
      setSurfaceCmd({ type: 'reset-bearing', nonce: nextNonce() });
    }
  }, [isSurfaceMode]);

  const handleSetSurfacePitch = useCallback(
    (pitch: number) => {
      if (!isSurfaceMode) return;
      if (pitch === 0) setSurfaceAutoOrbit(false);
      setSurfaceCmd({ type: 'set-pitch', pitch, nonce: nextNonce() });
    },
    [isSurfaceMode],
  );

  const handleRotateSurface = useCallback(
    (bearingDelta: number) => {
      if (!isSurfaceMode) return;
      setSurfaceAutoOrbit(false);
      setSurfaceCmd({ type: 'rotate-step', bearingDelta, nonce: nextNonce() });
    },
    [isSurfaceMode],
  );

  const handleLaunchMission = useCallback((id: MissionId) => {
    setTourActive(false);
    setActiveTab(null);
    setIsSurfaceMode(false);
    setSurfaceAutoOrbit(false);
    setFocusedId('earth');
    setMissionPaused(false);
    setMissionSpeed(1);
    setActiveMissionId(id);
    setUniverseCmd({ type: 'restart-mission', nonce: nextNonce() });
  }, []);

  const handleStopMission = useCallback(() => {
    setActiveMissionId(null);
    setMissionTelemetry(null);
  }, []);

  const handleSeekMission = useCallback((progress: number) => {
    setMissionSeekProgress({ progress, nonce: nextNonce() });
  }, []);

  const handleFocusMission = useCallback(() => {
    setIsSurfaceMode(false);
    setUniverseCmd({ type: 'focus-mission', nonce: nextNonce() });
  }, []);

  const handleRestartMission = useCallback(() => {
    setIsSurfaceMode(false);
    setMissionPaused(false);
    setUniverseCmd({ type: 'restart-mission', nonce: nextNonce() });
  }, []);

  const handleSurfaceTelemetry = useCallback(
    (
      lat: number,
      lng: number,
      zoom: number,
      altitudeText: string,
      pitch: number,
      bearing: number,
    ) => {
      const pct = Math.max(1, Math.min(20, ((20.5 - zoom) / (20.5 - 2.35)) * 20));
      setTelemetry({
        focusedId: 'earth',
        scaleLabel:
          zoom >= 16 ? 'Neighborhood & Houses' : zoom >= 11 ? 'City & Region' : 'Continental Orbit',
        altitudeText,
        scaleMeterPct: pct,
        lat,
        lng,
        isSurfaceMode: true,
        cameraLat: lat,
        cameraLng: lng,
        mapZoom: zoom,
        mapPitch: pitch,
        mapBearing: bearing,
      });
    },
    [],
  );

  // Global keyboard shortcuts (H = toggle Zen HUD, Space = play/pause, / = search)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;

      if (e.key === 'h' || e.key === 'H') {
        setZenMode((z) => !z);
      } else if (e.key === '/') {
        e.preventDefault();
        setSearchOpen(true);
      } else if (e.code === 'Space' && !isSurfaceMode) {
        e.preventDefault();
        if (activeMissionId) {
          setMissionPaused((p) => !p);
        } else {
          setIsPlaying((p) => !p);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isSurfaceMode, activeMissionId]);

  const activeBody = BODY_MAP[focusedId];

  return (
    <div className="relative w-full h-full bg-[#05070C] text-slate-100 select-none overflow-hidden">
      {/* 1. Full-Viewport 3D Universe & ISRO/NASA Mission Canvas */}
      <UniverseCanvas
        focusedId={focusedId}
        timeScale={timeScale}
        isPlaying={isPlaying}
        showOrbits={showOrbits}
        showLabels={showLabels}
        showConstellations={showConstellations}
        autoOrbit={autoOrbit}
        isSurfaceMode={isSurfaceMode}
        activeMissionId={activeMissionId}
        missionSpeed={missionSpeed}
        missionPaused={missionPaused}
        missionSeekProgress={missionSeekProgress}
        command={universeCmd}
        onSelectBody={(id) => handleSelectBody(id)}
        onTelemetry={setTelemetry}
        onMissionTelemetry={setMissionTelemetry}
        onEnterEarthSurface={handleEnterEarthSurface}
      />

      {/* 2. Ultra-Deep Free OpenStreetMap + 2D/3D Houses Explorer */}
      <EarthSurfaceExplorer
        visible={isSurfaceMode}
        initialLat={surfaceOrigin.lat}
        initialLng={surfaceOrigin.lng}
        initialZoom={surfaceOrigin.zoom}
        layerMode={layerMode}
        is3DBuildings={is3DBuildings}
        autoOrbit360={surfaceAutoOrbit}
        command={surfaceCmd}
        onTelemetryUpdate={handleSurfaceTelemetry}
        onPlaceNameResolved={setSurfacePlaceName}
        onStopOrbit360={() => setSurfaceAutoOrbit(false)}
        onExitToSpace={handleExitToSpace}
      />

      {/* 3. Top 3-Zone Header */}
      <header className="fixed top-0 left-0 right-0 z-30 flex items-center justify-between gap-6 px-4 lg:px-6 py-2.5 bg-[#05070C]/88 border-b border-white/10">
        <button
          type="button"
          onClick={() => handleSelectBody('milky-way')}
          className="text-lg font-display font-bold tracking-tight text-white whitespace-nowrap shrink-0 cursor-pointer"
        >
          Brahmand
        </button>

        <nav className="hidden md:flex items-center gap-6 text-xs font-medium text-slate-300">
          <button
            type="button"
            onClick={() => handleSelectBody('universe')}
            className={`whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
              !isSurfaceMode && focusedId === 'universe' ? 'text-cyan-300' : 'hover:text-white'
            }`}
          >
            Universe
          </button>
          <button
            type="button"
            onClick={() => handleSelectBody('milky-way')}
            className={`whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
              !isSurfaceMode && (focusedId === 'milky-way' || focusedId === 'sagittarius-a')
                ? 'text-cyan-300'
                : 'hover:text-white'
            }`}
          >
            Milky Way
          </button>
          <button
            type="button"
            onClick={() => handleSelectBody('sun', 9.2)}
            className={`whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
              !isSurfaceMode && focusedId === 'sun' ? 'text-cyan-300' : 'hover:text-white'
            }`}
          >
            Solar System
          </button>
          <button
            type="button"
            onClick={() => handleSelectBody('earth')}
            className={`whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
              !isSurfaceMode && focusedId === 'earth' ? 'text-cyan-300' : 'hover:text-white'
            }`}
          >
            Earth
          </button>
          <button
            type="button"
            onClick={() =>
              handleSelectEarthLocation(28.6129, 77.2295, 17.8, 'New Delhi, India')
            }
            className={`whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
              isSurfaceMode ? 'text-cyan-300' : 'hover:text-white'
            }`}
          >
            Earth Houses
          </button>
        </nav>

        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={() => {
              setTourActive(false);
              setActiveTab(null);
              setSearchOpen(true);
            }}
            className="inline-flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium text-slate-100 bg-slate-900 border border-white/15 rounded-lg hover:border-cyan-400/55 hover:text-cyan-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Search className="w-3.5 h-3.5 text-cyan-400" />
            <span className="hidden sm:inline">Search Cosmos or Address</span>
            <span className="sm:hidden">Search</span>
          </button>
        </div>
      </header>

      {/* 4. Minimal Floating Status Pill (Click to toggle Details popover) */}
      {!zenMode && (
        <div className="fixed top-14 left-4 z-20 pointer-events-none">
          <button
            type="button"
            onClick={() => setActiveTab((t) => (t === 'telemetry' ? null : 'telemetry'))}
            className="pointer-events-auto inline-flex flex-col text-left gap-0.5 px-3.5 py-2 rounded-xl bg-[#070B14]/88 border border-white/12 hover:border-cyan-400/45 transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2 text-[11px] text-slate-400">
              <span>{isSurfaceMode ? telemetry.scaleLabel : activeBody.category}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums text-cyan-300">{telemetry.altitudeText}</span>
            </div>
            <div className="text-sm sm:text-base font-display font-semibold text-white truncate max-w-[70vw] sm:max-w-xs">
              {isSurfaceMode ? surfacePlaceName : `${activeBody.name} (${activeBody.hindiName})`}
            </div>
          </button>
        </div>
      )}

      {/* 5. Clean Bottom Navigation Bar with Contextual Popovers Above Each Tab */}
      <ControlDock
        activeTab={activeTab}
        onChangeTab={setActiveTab}
        zenMode={zenMode}
        onToggleZen={() => {
          setActiveTab(null);
          setZenMode((z) => !z);
        }}
        focusedId={focusedId}
        activeBody={activeBody}
        telemetry={telemetry}
        surfacePlaceName={surfacePlaceName}
        isSurfaceMode={isSurfaceMode}
        isPlaying={isPlaying}
        timeScale={timeScale}
        showOrbits={showOrbits}
        showLabels={showLabels}
        showConstellations={showConstellations}
        autoOrbit={autoOrbit}
        tourActive={tourActive}
        layerMode={layerMode}
        is3DBuildings={is3DBuildings}
        surfaceAutoOrbit={surfaceAutoOrbit}
        activeMissionId={activeMissionId}
        missionTelemetry={missionTelemetry}
        missionSpeed={missionSpeed}
        missionPaused={missionPaused}
        onSelectBody={(id) => handleSelectBody(id)}
        onTogglePlay={() => setIsPlaying((p) => !p)}
        onChangeTimeScale={setTimeScale}
        onToggleOrbits={() => setShowOrbits((o) => !o)}
        onToggleLabels={() => setShowLabels((l) => !l)}
        onToggleConstellations={() => setShowConstellations((c) => !c)}
        onToggleAutoOrbit={() => setAutoOrbit((a) => !a)}
        onToggleTour={() => setTourActive((t) => !t)}
        onScreenshot={handleScreenshot}
        onZoomStep={handleZoomStep}
        onZoomToHouses={handleZoomToHouses}
        onReturnToSpace={() =>
          handleExitToSpace(telemetry.cameraLat, telemetry.cameraLng)
        }
        onChangeLayerMode={setLayerMode}
        onToggle3DBuildings={() => setIs3DBuildings((b) => !b)}
        onSetSurfacePitch={handleSetSurfacePitch}
        onRotateSurface={handleRotateSurface}
        onToggleSurfaceOrbit={() => setSurfaceAutoOrbit((s) => !s)}
        onResetNorth={handleResetNorth}
        onJumpLandmark={(lat, lng, zoom, name) =>
          handleSelectEarthLocation(lat, lng, zoom, name)
        }
        onLaunchMission={handleLaunchMission}
        onStopMission={handleStopMission}
        onToggleMissionPause={() => setMissionPaused((p) => !p)}
        onChangeMissionSpeed={setMissionSpeed}
        onSeekMission={handleSeekMission}
        onFocusMission={handleFocusMission}
        onRestartMission={handleRestartMission}
      />

      {/* 6. Global Search Modal (Cosmos + Real Earth Places/Houses) */}
      <SearchModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelectBody={(id) => handleSelectBody(id)}
        onSelectEarthLocation={handleSelectEarthLocation}
      />
    </div>
  );
}

export default App;
