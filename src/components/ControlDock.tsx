import React, { useEffect, useState } from 'react';
import {
  Activity,
  Camera,
  ChevronUp,
  Compass,
  Eye,
  EyeOff,
  Gauge,
  Globe,
  Home,
  Layers,
  Orbit,
  Pause,
  Play,
  Rocket,
  RotateCcw,
  RotateCw,
  SlidersHorizontal,
  Sparkles,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { CELESTIAL_BODIES, EARTH_LANDMARKS } from '../universe/celestialData';
import { MISSION_MAP, SPACE_MISSIONS } from '../universe/missionsData';
import type {
  CelestialBodyId,
  CelestialBodyInfo,
  EarthMapLayer,
  MissionAgency,
  MissionId,
  MissionTelemetry,
  TelemetrySnapshot,
} from '../types';

export type NavTabId = 'cosmos' | 'launch' | 'speed' | 'view' | 'telemetry' | 'earth' | null;

interface ControlDockProps {
  activeTab: NavTabId;
  onChangeTab: (tab: NavTabId) => void;
  zenMode: boolean;
  onToggleZen: () => void;
  focusedId: CelestialBodyId;
  activeBody: CelestialBodyInfo;
  telemetry: TelemetrySnapshot;
  surfacePlaceName: string;
  isSurfaceMode: boolean;
  isPlaying: boolean;
  timeScale: number;
  showOrbits: boolean;
  showLabels: boolean;
  showConstellations: boolean;
  autoOrbit: boolean;
  tourActive: boolean;
  layerMode: EarthMapLayer;
  is3DBuildings: boolean;
  surfaceAutoOrbit: boolean;
  activeMissionId: MissionId | null;
  missionTelemetry: MissionTelemetry | null;
  missionSpeed: number;
  missionPaused: boolean;
  onSelectBody: (id: CelestialBodyId) => void;
  onTogglePlay: () => void;
  onChangeTimeScale: (scale: number) => void;
  onToggleOrbits: () => void;
  onToggleLabels: () => void;
  onToggleConstellations: () => void;
  onToggleAutoOrbit: () => void;
  onToggleTour: () => void;
  onScreenshot: () => void;
  onZoomStep: (dir: 'in' | 'out') => void;
  onZoomToHouses: () => void;
  onReturnToSpace: () => void;
  onChangeLayerMode: (mode: EarthMapLayer) => void;
  onToggle3DBuildings: () => void;
  onSetSurfacePitch: (pitch: number) => void;
  onRotateSurface: (bearingDelta: number) => void;
  onToggleSurfaceOrbit: () => void;
  onResetNorth: () => void;
  onJumpLandmark: (lat: number, lng: number, zoom: number, name: string) => void;
  onLaunchMission: (id: MissionId) => void;
  onStopMission: () => void;
  onToggleMissionPause: () => void;
  onChangeMissionSpeed: (speed: number) => void;
  onSeekMission: (progress: number) => void;
  onFocusMission: () => void;
  onRestartMission: () => void;
}

const SPEED_OPTIONS = [
  { label: '-10x', value: -0.6 },
  { label: 'Real', value: 0.08 },
  { label: '10x', value: 0.6 },
  { label: '100x', value: 2.5 },
  { label: '1000x', value: 12 },
];

const MISSION_SPEED_OPTIONS = [1, 2, 5, 12];

const GROUPS: Array<CelestialBodyInfo['group']> = [
  'Deep Cosmos',
  'Inner System',
  'Outer System',
  'Missions & Comets',
];

function formatCoord(val: number, posChar: string, negChar: string): string {
  return `${Math.abs(val).toFixed(4)}° ${val >= 0 ? posChar : negChar}`;
}

export const ControlDock: React.FC<ControlDockProps> = ({
  activeTab,
  onChangeTab,
  zenMode,
  onToggleZen,
  focusedId,
  activeBody,
  telemetry,
  surfacePlaceName,
  isSurfaceMode,
  isPlaying,
  timeScale,
  showOrbits,
  showLabels,
  showConstellations,
  autoOrbit,
  tourActive,
  layerMode,
  is3DBuildings,
  surfaceAutoOrbit,
  activeMissionId,
  missionTelemetry,
  missionSpeed,
  missionPaused,
  onSelectBody,
  onTogglePlay,
  onChangeTimeScale,
  onToggleOrbits,
  onToggleLabels,
  onToggleConstellations,
  onToggleAutoOrbit,
  onToggleTour,
  onScreenshot,
  onZoomStep,
  onZoomToHouses,
  onReturnToSpace,
  onChangeLayerMode,
  onToggle3DBuildings,
  onSetSurfacePitch,
  onRotateSurface,
  onToggleSurfaceOrbit,
  onResetNorth,
  onJumpLandmark,
  onLaunchMission,
  onStopMission,
  onToggleMissionPause,
  onChangeMissionSpeed,
  onSeekMission,
  onFocusMission,
  onRestartMission,
}) => {
  const [agencyFilter, setAgencyFilter] = useState<'ALL' | MissionAgency>('ALL');

  useEffect(() => {
    if (!activeTab) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onChangeTab(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeTab, onChangeTab]);

  const toggleTab = (tab: Exclude<NavTabId, null>) => {
    onChangeTab(activeTab === tab ? null : tab);
  };

  const currentSpeedLabel = !isPlaying
    ? 'Paused'
    : SPEED_OPTIONS.find((o) => Math.abs(o.value - timeScale) < 0.02)?.label ?? 'Custom';

  if (zenMode) {
    return (
      <div className="fixed bottom-3 left-1/2 -translate-x-1/2 z-30">
        <button
          type="button"
          onClick={onToggleZen}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium text-slate-200 bg-[#070B14]/92 border border-white/15 hover:border-cyan-400/50 hover:text-cyan-200 transition-colors shadow-xl cursor-pointer whitespace-nowrap"
        >
          <ChevronUp className="w-3.5 h-3.5 text-cyan-400" />
          <span>Show Nav Bar (H)</span>
        </button>
      </div>
    );
  }

  const popoverPositionClass = (() => {
    switch (activeTab) {
      case 'cosmos':
        return 'left-1/2 -translate-x-1/2 sm:left-0 sm:translate-x-0 w-[min(640px,94vw)]';
      case 'launch':
        return 'left-1/2 -translate-x-1/2 sm:left-8 sm:translate-x-0 w-[min(580px,94vw)]';
      case 'speed':
        return 'left-1/2 -translate-x-1/2 sm:left-24 sm:translate-x-0 w-[min(390px,94vw)]';
      case 'view':
        return 'left-1/2 -translate-x-1/2 w-[min(430px,94vw)]';
      case 'telemetry':
        return 'left-1/2 -translate-x-1/2 sm:left-auto sm:right-14 sm:translate-x-0 w-[min(450px,94vw)]';
      case 'earth':
        return 'left-1/2 -translate-x-1/2 sm:left-auto sm:right-0 sm:translate-x-0 w-[min(540px,94vw)]';
      default:
        return '';
    }
  })();

  const activeMissionDef = activeMissionId ? MISSION_MAP[activeMissionId] : null;
  const filteredMissions =
    agencyFilter === 'ALL'
      ? SPACE_MISSIONS
      : SPACE_MISSIONS.filter((m) => m.agency === agencyFilter);

  const showCountdownBadge =
    Boolean(activeMissionDef && missionTelemetry && !isSurfaceMode) &&
    (missionTelemetry!.isCountdown || missionTelemetry!.progress < 0.045);
  const countDigit = missionTelemetry?.isCountdown
    ? Math.max(1, Math.ceil(missionTelemetry.countdownSec))
    : 0;

  return (
    <>
      {/* Dismiss layer when a nav popover is open */}
      {activeTab && (
        <div
          className="fixed inset-0 z-20"
          onClick={() => onChangeTab(null)}
          aria-hidden="true"
        />
      )}

      {/* Pad Launch Countdown & Lift-Off HUD */}
      {showCountdownBadge && activeMissionDef && missionTelemetry && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-20 pointer-events-none flex flex-col items-center text-center px-4">
          <div className="bg-[#070B14]/92 border border-amber-400/45 rounded-2xl px-6 py-3 shadow-2xl">
            <div className="text-[11px] font-medium text-amber-300 tracking-wide">
              {activeMissionDef.agency} · {activeMissionDef.launchSiteName}
            </div>
            <div className="text-3xl sm:text-4xl font-display font-bold font-mono tabular-nums text-white mt-0.5">
              {missionTelemetry.isCountdown
                ? countDigit === 1 && missionTelemetry.countdownSec < 1.2
                  ? 'IGNITION · 1'
                  : `T - ${countDigit}`
                : 'LIFT-OFF!'}
            </div>
            <div className="text-xs text-slate-300 mt-0.5 max-w-sm">
              {missionTelemetry.actionCaption}
            </div>
          </div>
        </div>
      )}

      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30 max-w-[96vw] flex flex-col items-center gap-2">
        {/* Compact Live Mission Flight Strip (shown cleanly above navbar only during an active ISRO/NASA launch) */}
        {activeMissionDef && missionTelemetry && !activeTab && !isSurfaceMode && (
          <div className="w-[min(700px,94vw)] bg-[#070B14]/94 border border-white/15 rounded-2xl px-3.5 py-2.5 shadow-2xl text-slate-100">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider text-slate-950 shrink-0"
                  style={{ backgroundColor: activeMissionDef.accentColor }}
                >
                  {activeMissionDef.agency}
                </span>
                <span className="text-xs font-semibold text-white truncate">
                  {activeMissionDef.name} ·{' '}
                  <span className="text-cyan-300 font-normal">{missionTelemetry.phaseName}</span>
                </span>
              </div>

              <div className="flex items-center gap-3 text-[11px] font-mono tabular-nums text-slate-300 shrink-0">
                <span className="text-amber-300">{missionTelemetry.velocityKmS.toFixed(2)} km/s</span>
                <span className="hidden sm:inline text-slate-400">{missionTelemetry.altitudeText}</span>
                <span className="text-cyan-300">{missionTelemetry.elapsedText}</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="range"
                min={0}
                max={1000}
                value={Math.round(missionTelemetry.progress * 1000)}
                onChange={(e) => onSeekMission(Number(e.target.value) / 1000)}
                aria-label="Mission flight progress"
                className="flex-1 accent-cyan-400 h-1.5 cursor-pointer"
              />
              <span className="text-[11px] font-mono tabular-nums text-slate-300 w-9 text-right">
                {Math.round(missionTelemetry.progress * 100)}%
              </span>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 mt-2">
              <p className="text-[11px] text-cyan-200/95 font-medium truncate max-w-full sm:max-w-[54%]">
                {missionTelemetry.actionCaption}
              </p>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={onToggleMissionPause}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-slate-900 text-slate-200 border border-white/12 hover:border-cyan-400/50 cursor-pointer"
                >
                  {missionPaused ? (
                    <Play className="w-3 h-3 text-cyan-400" />
                  ) : (
                    <Pause className="w-3 h-3 text-amber-400" />
                  )}
                  <span>{missionPaused ? 'Resume' : 'Pause'}</span>
                </button>

                <div className="flex items-center bg-slate-900 border border-white/10 rounded-md p-0.5">
                  {MISSION_SPEED_OPTIONS.map((spd) => (
                    <button
                      key={spd}
                      type="button"
                      onClick={() => onChangeMissionSpeed(spd)}
                      className={`px-1.5 py-0.5 text-[10px] font-mono rounded cursor-pointer ${
                        missionSpeed === spd
                          ? 'bg-cyan-500/25 text-cyan-200'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {spd}x
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={onFocusMission}
                  title="Track Rocket"
                  className="px-2 py-1 rounded-md text-[11px] font-medium bg-slate-900 text-cyan-200 border border-cyan-400/35 hover:border-cyan-400 cursor-pointer"
                >
                  Track
                </button>

                <button
                  type="button"
                  onClick={onRestartMission}
                  title="Replay from Launchpad"
                  className="p-1 rounded-md bg-slate-900 text-slate-300 border border-white/12 hover:text-white cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                </button>

                <button
                  type="button"
                  onClick={onStopMission}
                  title="End Mission"
                  className="p-1 rounded-md bg-slate-900 text-slate-400 border border-white/12 hover:text-rose-300 cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="relative">
          {/* Contextual Popover Directly Above Clicked Nav Tab */}
          {activeTab && (
            <div
              className={`absolute bottom-full mb-3 ${popoverPositionClass} bg-[#070B14]/96 border border-white/16 rounded-2xl shadow-2xl overflow-hidden text-slate-100`}
            >
              {/* Popover Header */}
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/10">
                <div className="text-xs font-semibold text-cyan-300">
                  {activeTab === 'cosmos' && 'Cosmic Directory · Navigate Universe & Planets'}
                  {activeTab === 'launch' && 'ISRO & NASA Launchpad · Real Trajectory Simulator'}
                  {activeTab === 'speed' && 'Time Simulation · Orbital & Rotational Speed'}
                  {activeTab === 'view' && 'Observatory Visuals · Overlays & Camera'}
                  {activeTab === 'telemetry' &&
                    (isSurfaceMode
                      ? `Earth Telemetry · ${surfacePlaceName}`
                      : `${activeBody.name} (${activeBody.hindiName})`)}
                  {activeTab === 'earth' &&
                    (isSurfaceMode
                      ? 'Free OpenStreetMap & 2D/3D House Angles'
                      : 'Earth Deep-Zoom · OpenStreetMap & Houses')}
                </div>
                <button
                  type="button"
                  onClick={() => onChangeTab(null)}
                  aria-label="Close menu"
                  className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-white/8 transition-colors cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Popover Content */}
              <div className="max-h-[60vh] overflow-y-auto cosmic-scroll p-3.5">
                {activeTab === 'cosmos' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    {GROUPS.map((group) => {
                      const items = CELESTIAL_BODIES.filter((b) => b.group === group);
                      return (
                        <div key={group} className="space-y-1">
                          <div className="px-1.5 text-[11px] font-medium text-slate-400">
                            {group}
                          </div>
                          <div className="space-y-1">
                            {items.map((b) => {
                              const active = !isSurfaceMode && focusedId === b.id;
                              return (
                                <button
                                  key={b.id}
                                  type="button"
                                  onClick={() => {
                                    onSelectBody(b.id);
                                    onChangeTab(null);
                                  }}
                                  className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-left text-xs transition-colors cursor-pointer border ${
                                    active
                                      ? 'bg-cyan-500/20 text-cyan-100 border-cyan-400/50'
                                      : 'bg-slate-900/75 text-slate-200 border-white/8 hover:border-cyan-400/40 hover:text-white'
                                  }`}
                                >
                                  <span className="flex items-center gap-2 min-w-0">
                                    <span
                                      className="w-2 h-2 rounded-full shrink-0"
                                      style={{ backgroundColor: b.accentColor }}
                                      aria-hidden="true"
                                    />
                                    <span className="truncate font-medium">{b.name}</span>
                                  </span>
                                  <span className="text-[11px] text-slate-400 shrink-0">
                                    {b.hindiName}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {activeTab === 'launch' && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1 bg-slate-900 border border-white/10 rounded-lg p-0.5">
                        {(['ALL', 'ISRO', 'NASA'] as const).map((ag) => (
                          <button
                            key={ag}
                            type="button"
                            onClick={() => setAgencyFilter(ag)}
                            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                              agencyFilter === ag
                                ? 'bg-cyan-500/22 text-cyan-200'
                                : 'text-slate-400 hover:text-white'
                            }`}
                          >
                            {ag === 'ALL' ? 'All Missions' : ag}
                          </button>
                        ))}
                      </div>
                      <span className="text-[11px] text-slate-400">
                        Follows exact launchpad → orbit → target path
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {filteredMissions.map((m) => {
                        const isRunning = activeMissionId === m.id;
                        return (
                          <div
                            key={m.id}
                            className={`p-3 rounded-xl border transition-colors flex flex-col justify-between gap-2 ${
                              isRunning
                                ? 'bg-cyan-500/12 border-cyan-400/55'
                                : 'bg-slate-900/80 border-white/10'
                            }`}
                          >
                            <div>
                              <div className="flex items-center justify-between gap-2">
                                <span
                                  className="px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider text-slate-950"
                                  style={{ backgroundColor: m.accentColor }}
                                >
                                  {m.agency}
                                </span>
                                <span className="text-[10px] font-mono text-slate-400">
                                  {m.vehicle}
                                </span>
                              </div>
                              <div className="text-sm font-display font-semibold text-white mt-1.5">
                                {m.name} · <span className="text-slate-300 text-xs">{m.hindiName}</span>
                              </div>
                              <div className="text-[11px] text-cyan-300/90 mt-0.5">
                                {m.launchSiteName}
                              </div>
                              <p className="text-[11px] text-slate-400 leading-relaxed mt-1.5">
                                {m.summary}
                              </p>
                            </div>

                            <button
                              type="button"
                              onClick={() => {
                                onLaunchMission(m.id);
                                onChangeTab(null);
                              }}
                              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-cyan-500 text-slate-950 hover:bg-cyan-400 transition-colors cursor-pointer"
                            >
                              <Rocket className="w-3.5 h-3.5" />
                              <span>{isRunning ? 'Re-Launch Mission' : 'Launch Now'}</span>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {activeTab === 'speed' && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-slate-300">Simulation Playback</span>
                      <button
                        type="button"
                        onClick={onTogglePlay}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-900 text-slate-100 border border-white/15 hover:border-cyan-400/50 transition-colors cursor-pointer"
                      >
                        {isPlaying ? (
                          <Pause className="w-3.5 h-3.5 text-amber-400" />
                        ) : (
                          <Play className="w-3.5 h-3.5 text-cyan-400" />
                        )}
                        <span>{isPlaying ? 'Pause Motion' : 'Resume Motion'}</span>
                      </button>
                    </div>

                    <div className="grid grid-cols-5 gap-1.5">
                      {SPEED_OPTIONS.map((opt) => {
                        const selected = Math.abs(timeScale - opt.value) < 0.02;
                        return (
                          <button
                            key={opt.label}
                            type="button"
                            onClick={() => {
                              if (!isPlaying) onTogglePlay();
                              onChangeTimeScale(opt.value);
                            }}
                            className={`py-2 px-1 rounded-lg text-xs font-mono tabular-nums border transition-colors cursor-pointer ${
                              selected
                                ? 'bg-cyan-500/22 text-cyan-200 border-cyan-400/55 font-semibold'
                                : 'bg-slate-900/80 text-slate-300 border-white/10 hover:text-white'
                            }`}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>

                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      Opens at Real natural astronomical speed. Select 10x–1000x to watch full planetary revolutions or -10x to rewind orbits.
                    </p>
                  </div>
                )}

                {activeTab === 'view' && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={onToggleOrbits}
                        className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                          showOrbits
                            ? 'bg-cyan-500/18 text-cyan-200 border-cyan-400/50'
                            : 'bg-slate-900 text-slate-300 border-white/10 hover:text-white'
                        }`}
                      >
                        <Orbit className="w-3.5 h-3.5" />
                        <span>Orbital Paths</span>
                      </button>

                      <button
                        type="button"
                        onClick={onToggleLabels}
                        className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                          showLabels
                            ? 'bg-cyan-500/18 text-cyan-200 border-cyan-400/50'
                            : 'bg-slate-900 text-slate-300 border-white/10 hover:text-white'
                        }`}
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Space Labels</span>
                      </button>

                      <button
                        type="button"
                        onClick={onToggleConstellations}
                        className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                          showConstellations
                            ? 'bg-cyan-500/18 text-cyan-200 border-cyan-400/50'
                            : 'bg-slate-900 text-slate-300 border-white/10 hover:text-white'
                        }`}
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>Constellations</span>
                      </button>

                      <button
                        type="button"
                        onClick={onToggleAutoOrbit}
                        className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                          autoOrbit
                            ? 'bg-cyan-500/18 text-cyan-200 border-cyan-400/50'
                            : 'bg-slate-900 text-slate-300 border-white/10 hover:text-white'
                        }`}
                      >
                        <RotateCw className="w-3.5 h-3.5" />
                        <span>Auto-Orbit Cam</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          onToggleTour();
                          onChangeTab(null);
                        }}
                        className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                          tourActive
                            ? 'bg-amber-500/20 text-amber-200 border-amber-400/55'
                            : 'bg-slate-900 text-slate-300 border-white/10 hover:text-white'
                        }`}
                      >
                        <Compass className="w-3.5 h-3.5" />
                        <span>{tourActive ? 'Stop Cosmic Tour' : 'Guided Cosmic Tour'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          onScreenshot();
                          onChangeTab(null);
                        }}
                        disabled={isSurfaceMode}
                        className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium bg-slate-900 text-slate-300 border border-white/10 hover:text-white disabled:opacity-40 transition-colors cursor-pointer"
                      >
                        <Camera className="w-3.5 h-3.5" />
                        <span>Save Snapshot</span>
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        onChangeTab(null);
                        onToggleZen();
                      }}
                      className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium bg-slate-900 text-slate-300 border border-white/12 hover:text-cyan-200 hover:border-cyan-400/45 transition-colors cursor-pointer"
                    >
                      <EyeOff className="w-3.5 h-3.5" />
                      <span>Hide Nav Bar for Cinema Zen View (H)</span>
                    </button>
                  </div>
                )}

                {activeTab === 'telemetry' && (
                  <div className="space-y-3.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-xs text-slate-400">Camera Distance</span>
                      <span className="text-sm font-mono font-semibold tabular-nums text-cyan-300">
                        {telemetry.altitudeText}
                      </span>
                    </div>

                    <div>
                      <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-cyan-400 transition-all duration-200"
                          style={{
                            width: `${Math.max(3, Math.min(100, telemetry.scaleMeterPct))}%`,
                          }}
                        />
                      </div>
                      <div className="flex justify-between text-[10px] font-mono text-slate-500 mt-1">
                        <span>10m Houses</span>
                        <span>Solar Sys</span>
                        <span>93B ly</span>
                      </div>
                    </div>

                    {(isSurfaceMode || activeBody.id === 'earth' || activeBody.id === 'iss') && (
                      <div className="flex items-center justify-between text-xs font-mono tabular-nums text-slate-300">
                        <span className="text-slate-400">Coordinates</span>
                        <span>
                          {formatCoord(telemetry.cameraLat, 'N', 'S')} ·{' '}
                          {formatCoord(telemetry.cameraLng, 'E', 'W')}
                        </span>
                      </div>
                    )}

                    {!isSurfaceMode ? (
                      <>
                        <p className="text-xs leading-relaxed text-slate-300 pt-2.5 border-t border-white/10">
                          {activeBody.summary}
                        </p>

                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 pt-2.5 border-t border-white/10 text-xs">
                          <div>
                            <div className="text-[10px] text-slate-400">Diameter / Span</div>
                            <div className="font-mono tabular-nums text-white mt-0.5">
                              {activeBody.realDiameterKm}
                            </div>
                          </div>
                          <div>
                            <div className="text-[10px] text-slate-400">Orbital Speed</div>
                            <div className="font-mono tabular-nums text-white mt-0.5">
                              {activeBody.orbitalVelocityKmS}
                            </div>
                          </div>
                          <div>
                            <div className="text-[10px] text-slate-400">Orbit Period</div>
                            <div className="font-mono tabular-nums text-white mt-0.5">
                              {activeBody.orbitalPeriodLabel}
                            </div>
                          </div>
                          <div>
                            <div className="text-[10px] text-slate-400">Day / Spin</div>
                            <div className="font-mono tabular-nums text-white mt-0.5">
                              {activeBody.dayLengthLabel}
                            </div>
                          </div>
                          <div>
                            <div className="text-[10px] text-slate-400">Gravity / Mass</div>
                            <div className="font-mono tabular-nums text-white mt-0.5">
                              {activeBody.gravityLabel}
                            </div>
                          </div>
                          <div>
                            <div className="text-[10px] text-slate-400">Temperature</div>
                            <div className="font-mono tabular-nums text-white mt-0.5">
                              {activeBody.temperatureLabel}
                            </div>
                          </div>
                        </div>

                        <div className="pt-2 border-t border-white/10 space-y-1 text-xs text-slate-300">
                          {activeBody.facts.map((fact, idx) => (
                            <p key={idx} className="leading-relaxed">
                              · {fact}
                            </p>
                          ))}
                        </div>
                      </>
                    ) : (
                      <div className="grid grid-cols-3 gap-2 pt-2.5 border-t border-white/10 text-xs">
                        <div>
                          <div className="text-[10px] text-slate-400">Map Zoom</div>
                          <div className="font-mono tabular-nums text-white mt-0.5">
                            z{(telemetry.mapZoom ?? 6).toFixed(1)}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] text-slate-400">Tilt Angle</div>
                          <div className="font-mono tabular-nums text-white mt-0.5">
                            {Math.round(telemetry.mapPitch ?? 0)}°
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] text-slate-400">Heading</div>
                          <div className="font-mono tabular-nums text-white mt-0.5">
                            {Math.round(telemetry.mapBearing ?? 0)}°
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {activeTab === 'earth' && (
                  <div className="space-y-3.5">
                    {isSurfaceMode ? (
                      <>
                        {/* Free Open Maps (Zero API Key) */}
                        <div>
                          <div className="text-[11px] font-medium text-slate-400 mb-1.5">
                            Free Open Maps (Zero API Key)
                          </div>
                          <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
                            {(
                              [
                                { id: 'osm', label: 'OpenStreetMap' },
                                { id: 'hybrid', label: 'OSM Hybrid' },
                                { id: 'satellite', label: 'Satellite' },
                                { id: 'topo', label: 'OpenTopo' },
                                { id: 'dark', label: 'Night Grid' },
                              ] as Array<{ id: EarthMapLayer; label: string }>
                            ).map((item) => (
                              <button
                                key={item.id}
                                type="button"
                                onClick={() => onChangeLayerMode(item.id)}
                                className={`px-2 py-1.5 rounded-lg text-[11px] font-medium border transition-colors cursor-pointer whitespace-nowrap ${
                                  layerMode === item.id
                                    ? 'bg-cyan-500/20 text-cyan-200 border-cyan-400/55'
                                    : 'bg-slate-900/80 text-slate-300 border-white/10 hover:text-white'
                                }`}
                              >
                                {item.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* 2D / 3D Camera Angles & Smooth 360° Fly-Around */}
                        <div>
                          <div className="text-[11px] font-medium text-slate-400 mb-1.5">
                            Camera Angle · 2D / 3D Houses &amp; 360° Rotate
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 mb-1.5">
                            <button
                              type="button"
                              onClick={() => onSetSurfacePitch(0)}
                              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                                (telemetry.mapPitch ?? 0) < 12
                                  ? 'bg-cyan-500/20 text-cyan-200 border-cyan-400/55'
                                  : 'bg-slate-900 text-slate-300 border-white/12 hover:text-white'
                              }`}
                            >
                              2D Top (0°)
                            </button>
                            <button
                              type="button"
                              onClick={() => onSetSurfacePitch(45)}
                              className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-900 text-slate-300 border border-white/12 hover:text-white transition-colors cursor-pointer"
                            >
                              3D Tilt (45°)
                            </button>
                            <button
                              type="button"
                              onClick={() => onSetSurfacePitch(68)}
                              className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-900 text-slate-300 border border-white/12 hover:text-white transition-colors cursor-pointer"
                            >
                              Street 3D (68°)
                            </button>
                            <button
                              type="button"
                              onClick={onToggle3DBuildings}
                              className={`inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                                is3DBuildings
                                  ? 'bg-amber-500/20 text-amber-200 border-amber-400/55'
                                  : 'bg-slate-900 text-slate-300 border-white/12 hover:text-white'
                              }`}
                            >
                              <Layers className="w-3.5 h-3.5" />
                              <span>3D Houses</span>
                            </button>
                          </div>

                          <div className="grid grid-cols-4 gap-1.5">
                            <button
                              type="button"
                              onClick={() => onRotateSurface(-45)}
                              className="px-2 py-1.5 rounded-lg text-xs font-medium bg-slate-900 text-slate-300 border border-white/12 hover:text-white cursor-pointer"
                            >
                              ⟲ -45°
                            </button>
                            <button
                              type="button"
                              onClick={onResetNorth}
                              className="px-2 py-1.5 rounded-lg text-xs font-medium bg-slate-900 text-slate-300 border border-white/12 hover:text-white cursor-pointer"
                            >
                              North 0°
                            </button>
                            <button
                              type="button"
                              onClick={() => onRotateSurface(45)}
                              className="px-2 py-1.5 rounded-lg text-xs font-medium bg-slate-900 text-slate-300 border border-white/12 hover:text-white cursor-pointer"
                            >
                              +45° ⟳
                            </button>
                            <button
                              type="button"
                              onClick={onToggleSurfaceOrbit}
                              className={`inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                                surfaceAutoOrbit
                                  ? 'bg-cyan-500/20 text-cyan-200 border-cyan-400/55'
                                  : 'bg-slate-900 text-slate-300 border-white/12 hover:text-white'
                              }`}
                            >
                              <RotateCw className="w-3 h-3" />
                              <span>360°</span>
                            </button>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            onSelectBody('earth');
                            onChangeTab(null);
                          }}
                          className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold bg-slate-900 text-slate-100 border border-white/15 hover:border-cyan-400/50 transition-colors cursor-pointer"
                        >
                          <Globe className="w-3.5 h-3.5 text-cyan-400" />
                          <span>View Earth in Orbit</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            onZoomToHouses();
                            onChangeTab(null);
                          }}
                          className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold bg-cyan-500 text-slate-950 hover:bg-cyan-400 transition-colors cursor-pointer"
                        >
                          <Home className="w-3.5 h-3.5" />
                          <span>OpenStreetMap &amp; 3D Houses</span>
                        </button>
                      </div>
                    )}

                    <div>
                      <div className="text-[11px] font-medium text-slate-400 mb-1.5">
                        Jump Directly to Cities &amp; Houses
                      </div>
                      <div className="grid grid-cols-2 gap-1.5">
                        {EARTH_LANDMARKS.map((lm) => (
                          <button
                            key={lm.id}
                            type="button"
                            onClick={() => {
                              onJumpLandmark(lm.lat, lm.lng, lm.zoom, lm.name);
                              onChangeTab(null);
                            }}
                            className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-left text-xs bg-slate-900/75 text-slate-200 border border-white/8 hover:border-cyan-400/50 hover:text-cyan-200 transition-colors cursor-pointer"
                          >
                            <span className="truncate font-medium">{lm.name}</span>
                            <span className="text-[10px] text-slate-500 shrink-0">{lm.region}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    {isSurfaceMode && (
                      <button
                        type="button"
                        onClick={() => {
                          onReturnToSpace();
                          onChangeTab(null);
                        }}
                        className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold bg-slate-100 text-slate-950 hover:bg-white transition-colors cursor-pointer"
                      >
                        <Globe className="w-3.5 h-3.5" />
                        <span>Return to Space Orbit</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Clean Single-Row Bottom Navigation Bar */}
          <nav
            aria-label="Observatory Navigation"
            className="flex items-center gap-1 sm:gap-1.5 px-2 py-1.5 bg-[#070B14]/94 border border-white/14 rounded-2xl shadow-2xl overflow-x-auto cosmic-scroll"
          >
            <button
              type="button"
              onClick={() => toggleTab('cosmos')}
              className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === 'cosmos'
                  ? 'bg-cyan-500/22 text-cyan-200 border border-cyan-400/55'
                  : 'text-slate-300 border border-transparent hover:bg-white/6 hover:text-white'
              }`}
            >
              <Compass className="w-3.5 h-3.5 text-cyan-400" />
              <span>Cosmos</span>
            </button>

            <button
              type="button"
              onClick={() => toggleTab('launch')}
              className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === 'launch' || activeMissionId
                  ? 'bg-amber-500/22 text-amber-200 border border-amber-400/55'
                  : 'text-slate-300 border border-transparent hover:bg-white/6 hover:text-white'
              }`}
            >
              <Rocket className="w-3.5 h-3.5 text-amber-400" />
              <span>Launch</span>
            </button>

            <button
              type="button"
              onClick={() => toggleTab('speed')}
              className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === 'speed'
                  ? 'bg-cyan-500/22 text-cyan-200 border border-cyan-400/55'
                  : 'text-slate-300 border border-transparent hover:bg-white/6 hover:text-white'
              }`}
            >
              <Gauge className="w-3.5 h-3.5 text-amber-400" />
              <span>Speed</span>
              <span className="hidden md:inline font-mono text-[10px] text-slate-400">
                · {currentSpeedLabel}
              </span>
            </button>

            <button
              type="button"
              onClick={() => toggleTab('view')}
              className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === 'view'
                  ? 'bg-cyan-500/22 text-cyan-200 border border-cyan-400/55'
                  : 'text-slate-300 border border-transparent hover:bg-white/6 hover:text-white'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-400" />
              <span>View</span>
            </button>

            <button
              type="button"
              onClick={() => toggleTab('telemetry')}
              className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === 'telemetry'
                  ? 'bg-cyan-500/22 text-cyan-200 border border-cyan-400/55'
                  : 'text-slate-300 border border-transparent hover:bg-white/6 hover:text-white'
              }`}
            >
              <Activity className="w-3.5 h-3.5 text-emerald-400" />
              <span>Details</span>
            </button>

            <button
              type="button"
              onClick={() => toggleTab('earth')}
              className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === 'earth' || isSurfaceMode
                  ? 'bg-cyan-500/22 text-cyan-200 border border-cyan-400/55'
                  : 'text-slate-300 border border-transparent hover:bg-white/6 hover:text-white'
              }`}
            >
              <Home className="w-3.5 h-3.5 text-cyan-300" />
              <span>{isSurfaceMode ? 'Map & 3D' : 'Earth & Houses'}</span>
            </button>

            <div className="h-5 w-px bg-white/12 mx-0.5 shrink-0" aria-hidden="true" />

            <button
              type="button"
              onClick={() => onZoomStep('out')}
              aria-label="Zoom out"
              title="Zoom Out"
              className="p-1.5 rounded-xl text-slate-300 hover:text-white hover:bg-white/8 transition-colors cursor-pointer shrink-0"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => onZoomStep('in')}
              aria-label="Zoom in"
              title="Zoom In"
              className="p-1.5 rounded-xl text-slate-300 hover:text-white hover:bg-white/8 transition-colors cursor-pointer shrink-0"
            >
              <ZoomIn className="w-4 h-4" />
            </button>

            {isSurfaceMode && (
              <button
                type="button"
                onClick={onReturnToSpace}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-slate-100 text-slate-950 hover:bg-white transition-colors cursor-pointer whitespace-nowrap shrink-0 ml-0.5"
              >
                <Globe className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Orbit</span>
              </button>
            )}
          </nav>
        </div>
      </div>
    </>
  );
};
