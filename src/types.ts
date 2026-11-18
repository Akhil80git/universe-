export type CelestialBodyId =
  | 'universe'
  | 'milky-way'
  | 'sagittarius-a'
  | 'sun'
  | 'mercury'
  | 'venus'
  | 'earth'
  | 'iss'
  | 'moon'
  | 'mars'
  | 'jupiter'
  | 'saturn'
  | 'uranus'
  | 'neptune'
  | 'pluto'
  | 'halley'
  | 'voyager-1';

export type CosmicScale =
  | 'universe'
  | 'galaxy'
  | 'solar-system'
  | 'planet'
  | 'earth-surface';

export type EarthMapLayer = 'osm' | 'hybrid' | 'satellite' | 'topo' | 'dark';

export type MissionAgency = 'ISRO' | 'NASA';

export type MissionId =
  | 'chandrayaan-3'
  | 'mangalyaan'
  | 'aditya-l1'
  | 'apollo-11'
  | 'perseverance'
  | 'voyager-launch';

export interface MissionPhase {
  name: string;
  detail: string;
  startPct: number;
  endPct: number;
  velocityKmS: [number, number];
  altitudeLabel: string;
  thrustActive: boolean;
}

export interface MissionDefinition {
  id: MissionId;
  name: string;
  hindiName: string;
  agency: MissionAgency;
  vehicle: string;
  launchSiteName: string;
  launchLat: number;
  launchLng: number;
  targetBodyId: CelestialBodyId;
  accentColor: string;
  year: string;
  summary: string;
  phases: MissionPhase[];
}

export interface MissionTelemetry {
  missionId: MissionId;
  progress: number; // 0..1
  countdownSec: number; // > 0 on launchpad before T-0 lift-off
  isCountdown: boolean;
  phaseName: string;
  phaseDetail: string;
  actionCaption: string;
  velocityKmS: number;
  altitudeText: string;
  elapsedText: string;
  thrustActive: boolean;
  completed: boolean;
}

export interface CelestialBodyInfo {
  id: CelestialBodyId;
  name: string;
  hindiName: string;
  category:
    | 'Universe'
    | 'Galaxy'
    | 'Black Hole'
    | 'Star'
    | 'Planet'
    | 'Moon'
    | 'Dwarf Planet'
    | 'Comet'
    | 'Spacecraft';
  group: 'Deep Cosmos' | 'Inner System' | 'Outer System' | 'Missions & Comets';
  radiusUnits: number;
  orbitRadius: number;
  orbitSpeed: number;
  rotationSpeed: number;
  axialTiltDeg: number;
  orbitInclinationDeg: number;
  parentId?: CelestialBodyId;
  accentColor: string;
  defaultZoomMultiplier: number;
  minZoomMultiplier: number;
  realDiameterKm: string;
  realDistanceLabel: string;
  orbitalPeriodLabel: string;
  dayLengthLabel: string;
  temperatureLabel: string;
  gravityLabel: string;
  orbitalVelocityKmS: string;
  moonsCount: string;
  summary: string;
  facts: string[];
}

export interface EarthLandmark {
  id: string;
  name: string;
  region: string;
  lat: number;
  lng: number;
  zoom: number;
}

export interface GeocodeResult {
  name: string;
  displayName: string;
  lat: number;
  lng: number;
  type: string;
  zoomHint: number;
}

export interface TelemetrySnapshot {
  focusedId: CelestialBodyId;
  scaleLabel: string;
  altitudeText: string;
  scaleMeterPct: number; // 0 = 10m House level, 100 = 93B ly Observable Universe
  lat?: number;
  lng?: number;
  isSurfaceMode: boolean;
  cameraLat: number;
  cameraLng: number;
  mapZoom?: number;
  mapPitch?: number;
  mapBearing?: number;
}
