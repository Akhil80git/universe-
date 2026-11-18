import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { BODY_MAP, EARTH_LANDMARKS } from './celestialData';
import {
  createCrateredTexture,
  createEarthTextures,
  createGasGiantTexture,
  createMarsTexture,
  createRadialGlowTexture,
  createSaturnRingTexture,
} from './proceduralTextures';
import {
  createAccretionDiskMaterial,
  createAtmosphereMaterial,
  createAuroraMaterial,
  createCometTailMaterial,
  createEarthSurfaceMaterial,
  createStarfieldMaterial,
  createSunMaterial,
} from './shaders';
import {
  createLaunchpadAssembly,
  createRocketAssembly,
  sampleMissionPosition,
  type MissionSceneContext,
} from './missionTrajectory';
import { MISSION_MAP } from './missionsData';
import type {
  CelestialBodyId,
  MissionId,
  MissionTelemetry,
  TelemetrySnapshot,
} from '../types';

export interface UniverseCommand {
  type: 'focus' | 'zoom-step' | 'fly-earth-latlng' | 'screenshot' | 'focus-mission' | 'restart-mission';
  bodyId?: CelestialBodyId;
  zoomDirection?: 'in' | 'out';
  distanceMultiplier?: number;
  lat?: number;
  lng?: number;
  nonce: number;
}

interface UniverseCanvasProps {
  focusedId: CelestialBodyId;
  timeScale: number;
  isPlaying: boolean;
  showOrbits: boolean;
  showLabels: boolean;
  showConstellations: boolean;
  autoOrbit: boolean;
  isSurfaceMode: boolean;
  activeMissionId: MissionId | null;
  missionSpeed: number;
  missionPaused: boolean;
  missionSeekProgress?: { progress: number; nonce: number } | null;
  command: UniverseCommand | null;
  onSelectBody: (id: CelestialBodyId) => void;
  onTelemetry: (snapshot: TelemetrySnapshot) => void;
  onMissionTelemetry?: (telemetry: MissionTelemetry | null) => void;
  onEnterEarthSurface: (lat: number, lng: number, zoom?: number, label?: string) => void;
}

interface BodyRuntime {
  id: CelestialBodyId;
  anchor: THREE.Group;
  orbitPivot?: THREE.Group;
  spinMesh: THREE.Object3D;
  radius: number;
  orbitSpeed: number;
  rotationSpeed: number;
  orbitAngle: number;
  isElliptical?: boolean;
  semiMajor?: number;
  eccentricity?: number;
}

interface LabelBinding {
  id: CelestialBodyId;
  name: string;
  hindi: string;
  anchor: THREE.Object3D;
  radius: number;
  minDist: number;
  maxDist: number;
}

// Pre-allocated scratch vectors (zero per-frame allocations)
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _proj = new THREE.Vector3();

function latLngToLocalVec(lat: number, lng: number, radius: number, out: THREE.Vector3): THREE.Vector3 {
  const phi = ((lng + 180) / 360) * Math.PI * 2;
  const theta = ((90 - lat) / 180) * Math.PI;
  out.set(
    -radius * Math.cos(phi) * Math.sin(theta),
    radius * Math.cos(theta),
    radius * Math.sin(phi) * Math.sin(theta),
  );
  return out;
}

function localVecToLatLng(localPos: THREE.Vector3): { lat: number; lng: number } {
  const r = localPos.length() || 1;
  const lat = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(localPos.y / r, -1, 1)));
  let phi = Math.atan2(localPos.z, -localPos.x);
  if (phi < 0) phi += Math.PI * 2;
  const lng = (phi / (Math.PI * 2)) * 360 - 180;
  return { lat, lng };
}

function formatCosmicDistance(
  dist: number,
  focusedId: CelestialBodyId,
  radius: number,
): {
  scaleLabel: string;
  altitudeText: string;
  scaleMeterPct: number;
} {
  // Log scale meter: 0 = 10m house, 25 = Earth orbit, 50 = Solar System, 78 = Milky Way, 100 = Observable Universe
  const meter = THREE.MathUtils.clamp(22 + (Math.log10(Math.max(1, dist)) / Math.log10(100000)) * 78, 18, 100);

  if (focusedId === 'earth') {
    const ratio = dist / radius;
    const altKm = Math.max(120, (ratio - 1) * 6371);
    if (altKm < 10000) {
      return {
        scaleLabel: 'Low to High Earth Orbit',
        altitudeText: `${Math.round(altKm).toLocaleString()} km alt`,
        scaleMeterPct: THREE.MathUtils.clamp(16 + (altKm / 10000) * 14, 16, 30),
      };
    }
    return {
      scaleLabel: 'Earth–Moon System',
      altitudeText: `${(altKm / 1000).toFixed(1)}k km alt`,
      scaleMeterPct: 34,
    };
  }
  if (dist < 480) {
    const au = (dist / 62).toFixed(2);
    return {
      scaleLabel: 'Solar System',
      altitudeText: `${au} AU view`,
      scaleMeterPct: meter,
    };
  }
  if (dist < 14000) {
    const ly = Math.round((dist / 4200) * 52850);
    return {
      scaleLabel: 'Milky Way Galaxy',
      altitudeText: `${ly.toLocaleString()} ly`,
      scaleMeterPct: meter,
    };
  }
  const mly = ((dist / 4200) * 0.053).toFixed(1);
  return {
    scaleLabel: 'Observable Universe',
    altitudeText: `${mly} Mly`,
    scaleMeterPct: meter,
  };
}

export const UniverseCanvas: React.FC<UniverseCanvasProps> = ({
  focusedId,
  timeScale,
  isPlaying,
  showOrbits,
  showLabels,
  showConstellations,
  autoOrbit,
  isSurfaceMode,
  activeMissionId,
  missionSpeed,
  missionPaused,
  missionSeekProgress,
  command,
  onSelectBody,
  onTelemetry,
  onMissionTelemetry,
  onEnterEarthSurface,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const labelsContainerRef = useRef<HTMLDivElement | null>(null);
  const labelElementsRef = useRef<Map<CelestialBodyId, HTMLButtonElement>>(new Map());

  const stateRef = useRef({
    focusedId,
    timeScale,
    isPlaying,
    showOrbits,
    showLabels,
    showConstellations,
    autoOrbit,
    isSurfaceMode,
    activeMissionId,
    missionSpeed,
    missionPaused,
  });
  stateRef.current = {
    focusedId,
    timeScale,
    isPlaying,
    showOrbits,
    showLabels,
    showConstellations,
    autoOrbit,
    isSurfaceMode,
    activeMissionId,
    missionSpeed,
    missionPaused,
  };

  const callbacksRef = useRef({
    onSelectBody,
    onTelemetry,
    onMissionTelemetry,
    onEnterEarthSurface,
  });
  callbacksRef.current = {
    onSelectBody,
    onTelemetry,
    onMissionTelemetry,
    onEnterEarthSurface,
  };

  const pendingCommandRef = useRef<UniverseCommand | null>(null);
  useEffect(() => {
    if (command) {
      pendingCommandRef.current = command;
    }
  }, [command]);

  const pendingSeekRef = useRef<{ progress: number; nonce: number } | null>(null);
  useEffect(() => {
    if (missionSeekProgress) {
      pendingSeekRef.current = missionSeekProgress;
    }
  }, [missionSeekProgress]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = (() => {
      const probe = document.createElement('canvas').getContext('webgl2');
      if (!probe) return true;
      const ext = probe.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : probe.RENDERER;
      const gpu = String(probe.getParameter(param));
      probe.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
      logarithmicDepthBuffer: true,
      preserveDrawingBuffer: false,
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.06;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    container.appendChild(renderer.domElement);

    const maxAniso = isSoftwareGl ? 1 : Math.min(8, renderer.capabilities.getMaxAnisotropy());

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x03050a);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    const camera = new THREE.PerspectiveCamera(48, width / height, 0.05, 300000);
    camera.position.set(70, 26, 92);

    // GPU Post-Processing Bloom (skipped cleanly on Software WebGL)
    let composer: EffectComposer | null = null;
    let bloomPass: UnrealBloomPass | null = null;
    if (!isSoftwareGl) {
      composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), 0.44, 0.45, 0.78);
      composer.addPass(bloomPass);
    }

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.06;
    controls.rotateSpeed = 0.72;
    controls.zoomSpeed = 1.18;
    controls.panSpeed = 0.75;
    controls.minDistance = 0.05;
    controls.maxDistance = 110000;

    const hemiLight = new THREE.HemisphereLight(0x88b4ff, 0x161926, 0.25);
    scene.add(hemiLight);

    const sunLight = new THREE.PointLight(0xfff4df, 3.2, 0, 0);
    sunLight.position.set(0, 0, 0);
    scene.add(sunLight);

    const disposables: Array<{ dispose: () => void }> = [];
    const track = <T extends { dispose: () => void }>(item: T): T => {
      disposables.push(item);
      return item;
    };

    const glowTex = track(createRadialGlowTexture());

    // ------------------------------------------------------------------
    // 1. DEEP BACKGROUND STAR SPHERE + CONSTELLATIONS (Nakshatra)
    // ------------------------------------------------------------------
    {
      const count = 5200;
      const pos = new Float32Array(count * 3);
      const col = new Float32Array(count * 3);
      const sizes = new Float32Array(count);
      const spectral = [
        new THREE.Color(0x9bbcff),
        new THREE.Color(0xcad8ff),
        new THREE.Color(0xf8f7ff),
        new THREE.Color(0xfff2d6),
        new THREE.Color(0xffcc99),
      ];
      for (let i = 0; i < count; i++) {
        const r = 120000 + Math.random() * 60000;
        const u = Math.random() * 2 - 1;
        const theta = Math.random() * Math.PI * 2;
        const s = Math.sqrt(1 - u * u);
        pos[i * 3] = r * s * Math.cos(theta);
        pos[i * 3 + 1] = r * u;
        pos[i * 3 + 2] = r * s * Math.sin(theta);
        const c = spectral[i % spectral.length];
        const bright = 0.45 + Math.random() * 0.55;
        col[i * 3] = c.r * bright;
        col[i * 3 + 1] = c.g * bright;
        col[i * 3 + 2] = c.b * bright;
        sizes[i] = 1.6 + Math.pow(Math.random(), 2.2) * 4.5;
      }
      const bgGeo = track(new THREE.BufferGeometry());
      bgGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      bgGeo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
      bgGeo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
      const bgMat = track(createStarfieldMaterial(2.2));
      bgMat.uniforms.uPixelRatio.value = renderer.getPixelRatio();
      const bgStars = new THREE.Points(bgGeo, bgMat);
      bgStars.frustumCulled = false;
      scene.add(bgStars);
    }

    // Constellations wireframe on distant celestial sky sphere
    const constellationsGroup = new THREE.Group();
    scene.add(constellationsGroup);
    {
      const R = 115000;
      const toSky = (raDeg: number, decDeg: number) => {
        const ra = THREE.MathUtils.degToRad(raDeg);
        const dec = THREE.MathUtils.degToRad(decDeg);
        return new THREE.Vector3(
          R * Math.cos(dec) * Math.cos(ra),
          R * Math.sin(dec),
          R * Math.cos(dec) * Math.sin(ra),
        );
      };

      const constellationDefs: Array<Array<[number, number]>> = [
        // Orion
        [[88, 7], [81, 6], [85, -1], [83, -1.2], [81, -1.9], [78, -8], [86, -9], [88, 7]],
        // Ursa Major / Saptarishi Big Dipper
        [[165, 61], [165, 56], [178, 53], [183, 57], [193, 55], [200, 54], [206, 49]],
        // Cassiopeia W
        [[2, 59], [10, 56], [14, 60], [21, 60], [28, 63]],
        // Scorpius
        [[240, -22], [247, -26], [252, -34], [256, -42], [263, -37], [266, -37]],
        // Cygnus Northern Cross
        [[310, 45], [305, 40], [292, 27], [305, 40], [296, 45], [311, 33]],
        // Leo
        [[152, 12], [154, 19], [155, 23], [148, 26], [146, 23], [168, 20], [177, 14], [152, 12]],
      ];

      const lineMat = track(
        new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.24 }),
      );
      const starNodeMat = track(
        new THREE.SpriteMaterial({
          map: glowTex,
          color: 0xbae6fd,
          transparent: true,
          opacity: 0.85,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );

      for (const poly of constellationDefs) {
        const pts = poly.map(([ra, dec]) => toSky(ra, dec));
        const geo = track(new THREE.BufferGeometry().setFromPoints(pts));
        const line = new THREE.Line(geo, lineMat);
        line.frustumCulled = false;
        constellationsGroup.add(line);

        for (const pt of pts) {
          const sp = new THREE.Sprite(starNodeMat);
          sp.position.copy(pt);
          sp.scale.set(1600, 1600, 1);
          constellationsGroup.add(sp);
        }
      }
    }

    // ------------------------------------------------------------------
    // 2. MILKY WAY GALAXY (Aakashganga), H-II NEBULAE & SAGITTARIUS A*
    // ------------------------------------------------------------------
    const MILKY_WAY_CORE_OFFSET = new THREE.Vector3(-2350, -40, -1080);
    const milkyWayAnchor = new THREE.Group();
    milkyWayAnchor.position.copy(MILKY_WAY_CORE_OFFSET);
    milkyWayAnchor.rotation.z = THREE.MathUtils.degToRad(14);
    milkyWayAnchor.rotation.x = THREE.MathUtils.degToRad(10);
    scene.add(milkyWayAnchor);

    const milkyWaySpinner = new THREE.Group();
    milkyWayAnchor.add(milkyWaySpinner);

    {
      const starCount = 52000;
      const positions = new Float32Array(starCount * 3);
      const colors = new Float32Array(starCount * 3);
      const sizes = new Float32Array(starCount);

      const coreColor = new THREE.Color(0xffdda6);
      const midArmColor = new THREE.Color(0x9bd0ff);
      const outerArmColor = new THREE.Color(0x6366f1);
      const pinkNebula = new THREE.Color(0xf472b6);
      const tmpColor = new THREE.Color();

      const arms = 4;
      const galaxyRadius = 4600;

      for (let i = 0; i < starCount; i++) {
        let r: number;
        let angle: number;
        let ySpread: number;

        if (i < starCount * 0.18) {
          r = Math.pow(Math.random(), 1.6) * 850;
          angle = Math.random() * Math.PI * 2;
          const barX = Math.cos(angle) * r * 1.45;
          const barZ = Math.sin(angle) * r * 0.62;
          const rotBar = 0.45;
          positions[i * 3] = barX * Math.cos(rotBar) - barZ * Math.sin(rotBar);
          positions[i * 3 + 1] = (Math.random() - 0.5) * 260 * Math.exp(-r / 650);
          positions[i * 3 + 2] = barX * Math.sin(rotBar) + barZ * Math.cos(rotBar);
          tmpColor.copy(coreColor);
          sizes[i] = 2.0 + Math.random() * 2.8;
        } else {
          r = 280 + Math.pow(Math.random(), 0.85) * (galaxyRadius - 280);
          const armIdx = i % arms;
          const baseAngle = (armIdx / arms) * Math.PI * 2;
          const spiralTwist = (r / galaxyRadius) * Math.PI * 3.1;
          const scatter = (Math.random() - 0.5) * (0.35 + (r / galaxyRadius) * 0.65);
          angle = baseAngle + spiralTwist + scatter;
          ySpread = (Math.random() - 0.5) * (160 * Math.exp(-r / 2400) + 32);

          positions[i * 3] = Math.cos(angle) * r;
          positions[i * 3 + 1] = ySpread;
          positions[i * 3 + 2] = Math.sin(angle) * r;

          const t = r / galaxyRadius;
          tmpColor.copy(coreColor).lerp(midArmColor, Math.min(1, t * 1.3));
          if (t > 0.55) {
            tmpColor.lerp(outerArmColor, (t - 0.55) * 1.1);
          }
          if (Math.random() < 0.05 && r > 700) {
            tmpColor.lerp(pinkNebula, 0.72);
            sizes[i] = 3.8 + Math.random() * 4.5;
          } else {
            sizes[i] = 1.4 + Math.random() * 2.6;
          }
        }

        const dim = 0.65 + Math.random() * 0.45;
        colors[i * 3] = tmpColor.r * dim;
        colors[i * 3 + 1] = tmpColor.g * dim;
        colors[i * 3 + 2] = tmpColor.b * dim;
      }

      const galGeo = track(new THREE.BufferGeometry());
      galGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      galGeo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
      galGeo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

      const galMat = track(createStarfieldMaterial(2.6));
      galMat.uniforms.uPixelRatio.value = renderer.getPixelRatio();
      const galPoints = new THREE.Points(galGeo, galMat);
      galPoints.frustumCulled = false;
      milkyWaySpinner.add(galPoints);

      // Galactic Core soft warm glow sprite
      const coreSprite = new THREE.Sprite(
        track(
          new THREE.SpriteMaterial({
            map: glowTex,
            color: 0xffd599,
            transparent: true,
            opacity: 0.75,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          }),
        ),
      );
      coreSprite.scale.set(1650, 950, 1);
      milkyWaySpinner.add(coreSprite);

      // Volumetric Emission Nebulae Clouds along spiral arms
      const nebColors = [0xec4899, 0x38bdf8, 0xa855f7];
      for (let n = 0; n < 24; n++) {
        const nr = 950 + (n / 24) * 3100;
        const arm = n % 4;
        const na = (arm / 4) * Math.PI * 2 + (nr / galaxyRadius) * Math.PI * 3.1;
        const nebSprite = new THREE.Sprite(
          track(
            new THREE.SpriteMaterial({
              map: glowTex,
              color: nebColors[n % nebColors.length],
              transparent: true,
              opacity: 0.16,
              blending: THREE.AdditiveBlending,
              depthWrite: false,
            }),
          ),
        );
        nebSprite.position.set(Math.cos(na) * nr, (Math.random() - 0.5) * 45, Math.sin(na) * nr);
        const ns = 380 + Math.random() * 440;
        nebSprite.scale.set(ns, ns * 0.65, 1);
        milkyWaySpinner.add(nebSprite);
      }
    }

    // Sagittarius A* Supermassive Black Hole
    const bhGroup = new THREE.Group();
    milkyWayAnchor.add(bhGroup);
    const bhHorizon = new THREE.Mesh(
      track(new THREE.SphereGeometry(18, 36, 36)),
      track(new THREE.MeshBasicMaterial({ color: 0x000000 })),
    );
    bhHorizon.userData.bodyId = 'sagittarius-a';
    bhGroup.add(bhHorizon);

    const accretionMat = track(createAccretionDiskMaterial());
    const accretionDisk = new THREE.Mesh(track(new THREE.RingGeometry(20, 88, 96, 2)), accretionMat);
    accretionDisk.rotation.x = Math.PI / 2 - 0.18;
    bhGroup.add(accretionDisk);

    const photonRing = new THREE.Mesh(
      track(new THREE.TorusGeometry(21, 1.4, 16, 80)),
      track(new THREE.MeshBasicMaterial({ color: 0xffb36b, transparent: true, opacity: 0.85 })),
    );
    bhGroup.add(photonRing);

    // ------------------------------------------------------------------
    // 3. DEEP OBSERVABLE UNIVERSE (Neighboring Galaxies & Cosmic Web)
    // ------------------------------------------------------------------
    const universeAnchor = new THREE.Group();
    universeAnchor.position.copy(MILKY_WAY_CORE_OFFSET);
    scene.add(universeAnchor);

    {
      const totalUniStars = 15000;
      const uPos = new Float32Array(totalUniStars * 3);
      const uCol = new Float32Array(totalUniStars * 3);
      const uSize = new Float32Array(totalUniStars);

      const neighbors = [
        { pos: new THREE.Vector3(14500, 4200, -11000), radius: 3800, color: 0x93c5fd, tilt: 0.5 },
        { pos: new THREE.Vector3(17200, 2100, -7800), radius: 1900, color: 0xc4b5fd, tilt: 1.1 },
        { pos: new THREE.Vector3(-4200, -2800, 5600), radius: 1200, color: 0xfde68a, tilt: 0.3 },
        { pos: new THREE.Vector3(-21000, 7500, 14000), radius: 3200, color: 0xfdba74, tilt: 0.8 },
        { pos: new THREE.Vector3(8000, -12000, 22000), radius: 3500, color: 0x67e8f9, tilt: 1.4 },
      ];

      let cursor = 0;
      const starsPerNeighbor = 1200;
      const tmpC = new THREE.Color();

      for (const gal of neighbors) {
        tmpC.setHex(gal.color);
        for (let j = 0; j < starsPerNeighbor; j++) {
          const r = Math.pow(Math.random(), 1.1) * gal.radius;
          const arm = j % 2;
          const ang = arm * Math.PI + (r / gal.radius) * 4.2 + (Math.random() - 0.5) * 0.7;
          const lx = Math.cos(ang) * r;
          const ly = (Math.random() - 0.5) * 260 * Math.exp(-r / (gal.radius * 0.5));
          const lz = Math.sin(ang) * r;
          const ry = ly * Math.cos(gal.tilt) - lz * Math.sin(gal.tilt);
          const rz = ly * Math.sin(gal.tilt) + lz * Math.cos(gal.tilt);

          uPos[cursor * 3] = gal.pos.x + lx;
          uPos[cursor * 3 + 1] = gal.pos.y + ry;
          uPos[cursor * 3 + 2] = gal.pos.z + rz;

          const f = 0.65 + Math.random() * 0.35;
          uCol[cursor * 3] = tmpC.r * f;
          uCol[cursor * 3 + 1] = tmpC.g * f;
          uCol[cursor * 3 + 2] = tmpC.b * f;
          uSize[cursor] = 3.2 + Math.random() * 4.0;
          cursor++;
        }
      }

      const hubs: THREE.Vector3[] = [];
      for (let h = 0; h < 28; h++) {
        const rad = 16000 + Math.random() * 46000;
        const th = Math.random() * Math.PI * 2;
        const ph = Math.acos(2 * Math.random() - 1);
        hubs.push(
          new THREE.Vector3(
            rad * Math.sin(ph) * Math.cos(th),
            rad * Math.cos(ph),
            rad * Math.sin(ph) * Math.sin(th),
          ),
        );
      }
      const webColors = [0x818cf8, 0x38bdf8, 0xfbbf24, 0xe879f9];
      for (; cursor < totalUniStars; cursor++) {
        const h1 = hubs[cursor % hubs.length];
        const h2 = hubs[(cursor + 3) % hubs.length];
        const t = Math.random();
        const jitter = 1800 + Math.random() * 2200;
        uPos[cursor * 3] = THREE.MathUtils.lerp(h1.x, h2.x, t) + (Math.random() - 0.5) * jitter;
        uPos[cursor * 3 + 1] = THREE.MathUtils.lerp(h1.y, h2.y, t) + (Math.random() - 0.5) * jitter;
        uPos[cursor * 3 + 2] = THREE.MathUtils.lerp(h1.z, h2.z, t) + (Math.random() - 0.5) * jitter;

        tmpC.setHex(webColors[cursor % webColors.length]);
        uCol[cursor * 3] = tmpC.r * 0.8;
        uCol[cursor * 3 + 1] = tmpC.g * 0.8;
        uCol[cursor * 3 + 2] = tmpC.b * 0.8;
        uSize[cursor] = 4.5 + Math.random() * 6.5;
      }

      const uniGeo = track(new THREE.BufferGeometry());
      uniGeo.setAttribute('position', new THREE.BufferAttribute(uPos, 3));
      uniGeo.setAttribute('aColor', new THREE.BufferAttribute(uCol, 3));
      uniGeo.setAttribute('aSize', new THREE.BufferAttribute(uSize, 1));
      const uniMat = track(createStarfieldMaterial(4.5));
      uniMat.uniforms.uPixelRatio.value = renderer.getPixelRatio();
      const uniPoints = new THREE.Points(uniGeo, uniMat);
      uniPoints.frustumCulled = false;
      universeAnchor.add(uniPoints);
    }

    // ------------------------------------------------------------------
    // 4. SOLAR SYSTEM (Sun, 8 Planets, Pluto, Moons, ISS, Comet, Voyager 1)
    // ------------------------------------------------------------------
    const solarSystemGroup = new THREE.Group();
    scene.add(solarSystemGroup);

    const orbitLines: THREE.LineLoop[] = [];
    const clickableMeshes: THREE.Object3D[] = [];
    const earthPinMeshes: THREE.Mesh[] = [];
    const bodyMapRuntime = new Map<CelestialBodyId, BodyRuntime>();
    const labelBindings: LabelBinding[] = [];

    bodyMapRuntime.set('universe', {
      id: 'universe',
      anchor: universeAnchor,
      spinMesh: universeAnchor,
      radius: 40000,
      orbitSpeed: 0,
      rotationSpeed: 0.002,
      orbitAngle: 0,
    });
    bodyMapRuntime.set('milky-way', {
      id: 'milky-way',
      anchor: milkyWayAnchor,
      spinMesh: milkyWaySpinner,
      radius: 4200,
      orbitSpeed: 0,
      rotationSpeed: 0.012,
      orbitAngle: 0,
    });
    bodyMapRuntime.set('sagittarius-a', {
      id: 'sagittarius-a',
      anchor: bhGroup,
      spinMesh: bhGroup,
      radius: 28,
      orbitSpeed: 0,
      rotationSpeed: 0.45,
      orbitAngle: 0,
    });
    clickableMeshes.push(bhHorizon);

    // Sun
    const sunInfo = BODY_MAP.sun;
    const sunAnchor = new THREE.Group();
    solarSystemGroup.add(sunAnchor);
    const sunMat = track(createSunMaterial());
    const sunMesh = new THREE.Mesh(track(new THREE.SphereGeometry(sunInfo.radiusUnits, 64, 64)), sunMat);
    sunMesh.userData.bodyId = 'sun';
    sunAnchor.add(sunMesh);
    clickableMeshes.push(sunMesh);

    const sunCorona = new THREE.Sprite(
      track(
        new THREE.SpriteMaterial({
          map: glowTex,
          color: 0xffaa33,
          transparent: true,
          opacity: 0.72,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      ),
    );
    sunCorona.scale.set(sunInfo.radiusUnits * 4.4, sunInfo.radiusUnits * 4.4, 1);
    sunAnchor.add(sunCorona);

    bodyMapRuntime.set('sun', {
      id: 'sun',
      anchor: sunAnchor,
      spinMesh: sunMesh,
      radius: sunInfo.radiusUnits,
      orbitSpeed: 0,
      rotationSpeed: sunInfo.rotationSpeed,
      orbitAngle: 0,
    });
    labelBindings.push(
      {
        id: 'milky-way',
        name: 'Milky Way',
        hindi: 'Aakashganga',
        anchor: milkyWayAnchor,
        radius: 900,
        minDist: 15000,
        maxDist: 95000,
      },
      {
        id: 'sagittarius-a',
        name: 'Sagittarius A*',
        hindi: 'Black Hole Core',
        anchor: bhGroup,
        radius: 40,
        minDist: 120,
        maxDist: 16000,
      },
      {
        id: 'sun',
        name: 'Solar System · Sun',
        hindi: sunInfo.hindiName,
        anchor: sunAnchor,
        radius: sunInfo.radiusUnits,
        minDist: 20,
        maxDist: 22000,
      },
    );

    const createOrbitLine = (radius: number, colorHex: number, opacity = 0.24): THREE.LineLoop => {
      const segs = 144;
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i < segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, Math.sin(a) * radius));
      }
      const geo = track(new THREE.BufferGeometry().setFromPoints(pts));
      const mat = track(new THREE.LineBasicMaterial({ color: colorHex, transparent: true, opacity }));
      const loop = new THREE.LineLoop(geo, mat);
      orbitLines.push(loop);
      return loop;
    };

    const earthTex = createEarthTextures(maxAniso);
    track(earthTex.dayMap);
    track(earthTex.nightMap);
    track(earthTex.specularMap);
    track(earthTex.cloudMap);

    let earthMeshRef: THREE.Mesh | null = null;
    let earthCloudMeshRef: THREE.Mesh | null = null;
    let earthMatShaderRef: THREE.ShaderMaterial | null = null;
    let auroraMatRef: THREE.ShaderMaterial | null = null;

    const initialAngles: Partial<Record<CelestialBodyId, number>> = {
      mercury: 1.1,
      venus: 2.35,
      earth: 0.72,
      iss: 0.4,
      moon: 0.9,
      mars: 5.1,
      jupiter: 3.4,
      saturn: 0.18,
      uranus: 4.2,
      neptune: 2.8,
      pluto: 5.8,
      halley: 0.85,
      'voyager-1': 1.9,
    };

    const planetIds: CelestialBodyId[] = [
      'mercury',
      'venus',
      'earth',
      'mars',
      'jupiter',
      'saturn',
      'uranus',
      'neptune',
      'pluto',
    ];

    const minorMoons: Array<{ pivot: THREE.Group; speed: number }> = [];

    for (const id of planetIds) {
      const info = BODY_MAP[id];
      const orbitTilt = new THREE.Group();
      orbitTilt.rotation.z = THREE.MathUtils.degToRad(info.orbitInclinationDeg);
      solarSystemGroup.add(orbitTilt);

      orbitTilt.add(createOrbitLine(info.orbitRadius, new THREE.Color(info.accentColor).getHex(), 0.24));

      const orbitPivot = new THREE.Group();
      const startAngle = initialAngles[id] ?? Math.random() * Math.PI * 2;
      orbitPivot.rotation.y = startAngle;
      orbitTilt.add(orbitPivot);

      const planetAnchor = new THREE.Group();
      planetAnchor.position.set(info.orbitRadius, 0, 0);
      orbitPivot.add(planetAnchor);

      const tiltGroup = new THREE.Group();
      tiltGroup.rotation.z = THREE.MathUtils.degToRad(info.axialTiltDeg);
      planetAnchor.add(tiltGroup);

      let planetMesh: THREE.Mesh;

      if (id === 'earth') {
        const earthGeo = track(new THREE.SphereGeometry(info.radiusUnits, 64, 64));
        const earthShaderMat = track(
          createEarthSurfaceMaterial(earthTex.dayMap, earthTex.nightMap, earthTex.specularMap),
        );
        earthMatShaderRef = earthShaderMat;
        planetMesh = new THREE.Mesh(earthGeo, earthShaderMat);
        planetMesh.rotation.y = -0.5;
        earthMeshRef = planetMesh;

        // Clickable City Landmark Pins mounted directly onto the rotating Earth surface!
        const pinGeo = track(new THREE.SphereGeometry(0.055, 12, 12));
        const pinMat = track(new THREE.MeshBasicMaterial({ color: 0x22d3ee }));
        const pinPos = new THREE.Vector3();
        for (const lm of EARTH_LANDMARKS.slice(0, 8)) {
          latLngToLocalVec(lm.lat, lm.lng, info.radiusUnits * 1.022, pinPos);
          const pin = new THREE.Mesh(pinGeo, pinMat);
          pin.position.copy(pinPos);
          pin.userData.earthLandmark = lm;
          planetMesh.add(pin);
          earthPinMeshes.push(pin);
        }

        // Cloud layer
        const cloudMesh = new THREE.Mesh(
          track(new THREE.SphereGeometry(info.radiusUnits * 1.015, 64, 64)),
          track(
            new THREE.MeshStandardMaterial({
              map: earthTex.cloudMap,
              transparent: true,
              opacity: 0.72,
              depthWrite: false,
              roughness: 0.9,
            }),
          ),
        );
        tiltGroup.add(cloudMesh);
        earthCloudMeshRef = cloudMesh;

        // Polar Aurora Borealis / Australis glowing shell
        const auroraMat = track(createAuroraMaterial());
        auroraMatRef = auroraMat;
        const auroraMesh = new THREE.Mesh(
          track(new THREE.SphereGeometry(info.radiusUnits * 1.032, 48, 48)),
          auroraMat,
        );
        tiltGroup.add(auroraMesh);

        // Rayleigh atmospheric scattering rim
        const atmo = new THREE.Mesh(
          track(new THREE.SphereGeometry(info.radiusUnits * 1.08, 48, 48)),
          track(createAtmosphereMaterial(0x4ea8ff, 0.92, 3.0)),
        );
        tiltGroup.add(atmo);

        // Multi-part procedural International Space Station (ISS) registered as focusable body!
        const issInfo = BODY_MAP.iss;
        const issOrbitTilt = new THREE.Group();
        issOrbitTilt.rotation.z = THREE.MathUtils.degToRad(issInfo.orbitInclinationDeg);
        planetAnchor.add(issOrbitTilt);
        issOrbitTilt.add(createOrbitLine(issInfo.orbitRadius, 0x38bdf8, 0.16));

        const issPivot = new THREE.Group();
        issPivot.rotation.y = initialAngles.iss ?? 0.4;
        issOrbitTilt.add(issPivot);

        const issAnchor = new THREE.Group();
        issAnchor.position.set(issInfo.orbitRadius, 0, 0);
        issPivot.add(issAnchor);

        const issGroup = new THREE.Group();
        const issMetal = track(new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.85, roughness: 0.28 }));
        const issGold = track(new THREE.MeshStandardMaterial({ color: 0xd97706, metalness: 0.82, roughness: 0.32 }));
        const issSolar = track(new THREE.MeshStandardMaterial({ color: 0x1d4ed8, metalness: 0.65, roughness: 0.25 }));
        const truss = new THREE.Mesh(track(new THREE.CylinderGeometry(0.015, 0.015, 0.24, 10)), issMetal);
        truss.rotation.z = Math.PI / 2;
        const hub = new THREE.Mesh(track(new THREE.BoxGeometry(0.04, 0.042, 0.09)), issGold);
        const cupola = new THREE.Mesh(track(new THREE.CylinderGeometry(0.014, 0.02, 0.03, 8)), issMetal);
        cupola.position.set(0, -0.025, 0);
        const wingL1 = new THREE.Mesh(track(new THREE.BoxGeometry(0.055, 0.003, 0.19)), issSolar);
        wingL1.position.set(-0.08, 0, 0.02);
        const wingR1 = wingL1.clone();
        wingR1.position.set(0.08, 0, 0.02);
        const wingL2 = wingL1.clone();
        wingL2.position.set(-0.08, 0, -0.02);
        const wingR2 = wingL1.clone();
        wingR2.position.set(0.08, 0, -0.02);
        issGroup.add(truss, hub, cupola, wingL1, wingR1, wingL2, wingR2);
        issAnchor.add(issGroup);

        // Invisible clickable proxy sphere for easy raycast picking
        const issHit = new THREE.Mesh(
          track(new THREE.SphereGeometry(0.18, 12, 12)),
          track(new THREE.MeshBasicMaterial({ visible: false })),
        );
        issHit.userData.bodyId = 'iss';
        issAnchor.add(issHit);
        clickableMeshes.push(issHit);

        bodyMapRuntime.set('iss', {
          id: 'iss',
          anchor: issAnchor,
          orbitPivot: issPivot,
          spinMesh: issGroup,
          radius: issInfo.radiusUnits,
          orbitSpeed: issInfo.orbitSpeed,
          rotationSpeed: issInfo.rotationSpeed,
          orbitAngle: initialAngles.iss ?? 0.4,
        });
        labelBindings.push({
          id: 'iss',
          name: 'ISS',
          hindi: issInfo.hindiName,
          anchor: issAnchor,
          radius: 0.25,
          minDist: 0.4,
          maxDist: 16,
        });
      } else {
        let tex: THREE.CanvasTexture;
        let roughness = 0.85;
        if (id === 'mercury') {
          tex = track(createCrateredTexture([165, 160, 155], [95, 90, 88], 101, maxAniso, 260));
          roughness = 0.94;
        } else if (id === 'venus') {
          tex = track(
            createGasGiantTexture(
              [
                [226, 188, 120],
                [206, 160, 92],
                [238, 210, 152],
                [188, 142, 78],
              ],
              202,
              maxAniso,
            ),
          );
          roughness = 0.65;
        } else if (id === 'mars') {
          tex = track(createMarsTexture(maxAniso));
          roughness = 0.92;
        } else if (id === 'jupiter') {
          tex = track(
            createGasGiantTexture(
              [
                [214, 184, 148],
                [182, 126, 86],
                [234, 218, 196],
                [166, 108, 72],
                [205, 166, 125],
              ],
              303,
              maxAniso,
              true,
            ),
          );
          roughness = 0.68;
        } else if (id === 'saturn') {
          tex = track(
            createGasGiantTexture(
              [
                [228, 206, 162],
                [205, 180, 134],
                [240, 224, 184],
                [186, 160, 118],
              ],
              404,
              maxAniso,
            ),
          );
          roughness = 0.68;
        } else if (id === 'uranus') {
          tex = track(
            createGasGiantTexture(
              [
                [148, 224, 232],
                [128, 206, 218],
                [168, 234, 240],
              ],
              505,
              maxAniso,
            ),
          );
          roughness = 0.55;
        } else if (id === 'neptune') {
          tex = track(
            createGasGiantTexture(
              [
                [56, 104, 220],
                [42, 78, 188],
                [84, 138, 242],
                [35, 65, 165],
              ],
              606,
              maxAniso,
            ),
          );
          roughness = 0.55;
        } else {
          tex = track(createCrateredTexture([215, 198, 182], [132, 110, 96], 707, maxAniso, 140));
          roughness = 0.9;
        }

        const geo = track(new THREE.SphereGeometry(info.radiusUnits, 48, 48));
        const mat = track(new THREE.MeshStandardMaterial({ map: tex, roughness, metalness: 0.04 }));
        planetMesh = new THREE.Mesh(geo, mat);

        if (id === 'venus') {
          tiltGroup.add(
            new THREE.Mesh(
              track(new THREE.SphereGeometry(info.radiusUnits * 1.07, 36, 36)),
              track(createAtmosphereMaterial(0xffcf70, 0.65, 3.2)),
            ),
          );
        } else if (id === 'mars') {
          tiltGroup.add(
            new THREE.Mesh(
              track(new THREE.SphereGeometry(info.radiusUnits * 1.06, 36, 36)),
              track(createAtmosphereMaterial(0xff7b54, 0.45, 3.4)),
            ),
          );
        } else if (id === 'neptune' || id === 'uranus') {
          tiltGroup.add(
            new THREE.Mesh(
              track(new THREE.SphereGeometry(info.radiusUnits * 1.06, 36, 36)),
              track(createAtmosphereMaterial(id === 'neptune' ? 0x3b82f6 : 0x67e8f9, 0.55, 3.2)),
            ),
          );
        }
      }

      planetMesh.userData.bodyId = id;
      tiltGroup.add(planetMesh);
      clickableMeshes.push(planetMesh);

      if (id === 'saturn' || id === 'uranus') {
        const innerR = id === 'saturn' ? info.radiusUnits * 1.32 : info.radiusUnits * 1.5;
        const outerR = id === 'saturn' ? info.radiusUnits * 2.45 : info.radiusUnits * 1.95;
        const ringGeo = track(new THREE.RingGeometry(innerR, outerR, 128));
        const posAttr = ringGeo.attributes.position;
        const uvAttr = ringGeo.attributes.uv;
        for (let vi = 0; vi < posAttr.count; vi++) {
          const vx = posAttr.getX(vi);
          const vy = posAttr.getY(vi);
          const vr = Math.sqrt(vx * vx + vy * vy);
          const u = (vr - innerR) / (outerR - innerR);
          uvAttr.setXY(vi, u, 0.5);
        }
        const ringTex = track(createSaturnRingTexture(maxAniso, id === 'uranus'));
        const ringMat = track(
          new THREE.MeshStandardMaterial({
            map: ringTex,
            transparent: true,
            side: THREE.DoubleSide,
            roughness: 0.75,
            depthWrite: false,
          }),
        );
        const ringMesh = new THREE.Mesh(ringGeo, ringMat);
        ringMesh.rotation.x = Math.PI / 2;
        tiltGroup.add(ringMesh);
      }

      bodyMapRuntime.set(id, {
        id,
        anchor: planetAnchor,
        orbitPivot,
        spinMesh: planetMesh,
        radius: info.radiusUnits,
        orbitSpeed: info.orbitSpeed,
        rotationSpeed: info.rotationSpeed,
        orbitAngle: startAngle,
      });

      labelBindings.push({
        id,
        name: info.name,
        hindi: info.hindiName,
        anchor: planetAnchor,
        radius: info.radiusUnits,
        minDist: info.radiusUnits * 2.2,
        maxDist: 850,
      });

      if (id === 'earth') {
        const moonInfo = BODY_MAP.moon;
        const moonTilt = new THREE.Group();
        moonTilt.rotation.z = THREE.MathUtils.degToRad(moonInfo.orbitInclinationDeg);
        planetAnchor.add(moonTilt);
        moonTilt.add(createOrbitLine(moonInfo.orbitRadius, 0x94a3b8, 0.25));

        const moonPivot = new THREE.Group();
        moonPivot.rotation.y = initialAngles.moon ?? 0.9;
        moonTilt.add(moonPivot);

        const moonAnchor = new THREE.Group();
        moonAnchor.position.set(moonInfo.orbitRadius, 0, 0);
        moonPivot.add(moonAnchor);

        const moonTex = track(createCrateredTexture([206, 208, 212], [118, 120, 126], 808, maxAniso, 240));
        const moonMesh = new THREE.Mesh(
          track(new THREE.SphereGeometry(moonInfo.radiusUnits, 48, 48)),
          track(new THREE.MeshStandardMaterial({ map: moonTex, roughness: 0.95, metalness: 0.02 })),
        );
        moonMesh.userData.bodyId = 'moon';
        moonAnchor.add(moonMesh);
        clickableMeshes.push(moonMesh);

        bodyMapRuntime.set('moon', {
          id: 'moon',
          anchor: moonAnchor,
          orbitPivot: moonPivot,
          spinMesh: moonMesh,
          radius: moonInfo.radiusUnits,
          orbitSpeed: moonInfo.orbitSpeed,
          rotationSpeed: moonInfo.rotationSpeed,
          orbitAngle: initialAngles.moon ?? 0.9,
        });

        labelBindings.push({
          id: 'moon',
          name: moonInfo.name,
          hindi: moonInfo.hindiName,
          anchor: moonAnchor,
          radius: moonInfo.radiusUnits,
          minDist: 1.5,
          maxDist: 110,
        });
      }

      const addMinorMoon = (mRadius: number, mDist: number, mSpeed: number, mColor: number, mTiltDeg: number) => {
        const tilt = new THREE.Group();
        tilt.rotation.z = THREE.MathUtils.degToRad(mTiltDeg);
        planetAnchor.add(tilt);
        const pivot = new THREE.Group();
        pivot.rotation.y = Math.random() * Math.PI * 2;
        tilt.add(pivot);
        const mMesh = new THREE.Mesh(
          track(new THREE.SphereGeometry(mRadius, 20, 20)),
          track(new THREE.MeshStandardMaterial({ color: mColor, roughness: 0.9 })),
        );
        mMesh.position.set(mDist, 0, 0);
        pivot.add(mMesh);
        minorMoons.push({ pivot, speed: mSpeed });
      };

      if (id === 'mars') {
        addMinorMoon(0.14, 2.8, 1.8, 0xa89f91, 2);
        addMinorMoon(0.09, 3.8, 1.1, 0x9ca3af, 4);
      } else if (id === 'jupiter') {
        addMinorMoon(0.32, 8.8, 1.6, 0xfacc15, 0.5);
        addMinorMoon(0.28, 10.6, 1.15, 0xe2e8f0, 0.8);
        addMinorMoon(0.45, 13.0, 0.78, 0x94a3b8, 1.2);
        addMinorMoon(0.41, 15.8, 0.48, 0x64748b, 1.5);
      } else if (id === 'saturn') {
        addMinorMoon(0.2, 13.6, 1.2, 0xf8fafc, 1);
        addMinorMoon(0.48, 16.5, 0.55, 0xf59e0b, 2);
      } else if (id === 'uranus') {
        addMinorMoon(0.22, 6.2, 0.9, 0xcbd5e1, 97);
      } else if (id === 'neptune') {
        addMinorMoon(0.34, 6.5, -0.75, 0xdbeafe, 23);
      } else if (id === 'pluto') {
        addMinorMoon(0.42, 2.4, 0.9, 0x94a3b8, 12);
      }
    }

    // ------------------------------------------------------------------
    // 4B. HALLEY'S COMET (Elliptical Orbit + Anti-Solar Ion Tail)
    // ------------------------------------------------------------------
    const halleyInfo = BODY_MAP.halley;
    const halleyOrbitGroup = new THREE.Group();
    halleyOrbitGroup.rotation.z = THREE.MathUtils.degToRad(18);
    halleyOrbitGroup.rotation.x = THREE.MathUtils.degToRad(22);
    solarSystemGroup.add(halleyOrbitGroup);

    const halleyA = 135;
    const halleyE = 0.72;
    const halleyB = halleyA * Math.sqrt(1 - halleyE * halleyE);
    const halleyC = halleyA * halleyE;

    {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i < 160; i++) {
        const t = (i / 160) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(t) * halleyA - halleyC, 0, Math.sin(t) * halleyB));
      }
      const hOrbit = new THREE.LineLoop(
        track(new THREE.BufferGeometry().setFromPoints(pts)),
        track(new THREE.LineBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.22 })),
      );
      orbitLines.push(hOrbit);
      halleyOrbitGroup.add(hOrbit);
    }

    const halleyAnchor = new THREE.Group();
    halleyOrbitGroup.add(halleyAnchor);
    const halleyNucleus = new THREE.Mesh(
      track(new THREE.DodecahedronGeometry(0.42, 1)),
      track(new THREE.MeshStandardMaterial({ color: 0xcffafe, roughness: 0.85 })),
    );
    halleyNucleus.userData.bodyId = 'halley';
    halleyAnchor.add(halleyNucleus);
    clickableMeshes.push(halleyNucleus);

    const halleyComa = new THREE.Sprite(
      track(
        new THREE.SpriteMaterial({
          map: glowTex,
          color: 0x67e8f9,
          transparent: true,
          opacity: 0.88,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      ),
    );
    halleyComa.scale.set(4.5, 4.5, 1);
    halleyAnchor.add(halleyComa);

    const cometTailMat = track(createCometTailMaterial());
    const cometTailGeo = track(new THREE.ConeGeometry(1.8, 16, 24, 1, true));
    // Shift cone so tip sits at nucleus (0,0,0) and opens outward along +Z when oriented
    cometTailGeo.translate(0, -8, 0);
    cometTailGeo.rotateX(Math.PI / 2);
    const cometTailMesh = new THREE.Mesh(cometTailGeo, cometTailMat);
    halleyAnchor.add(cometTailMesh);

    bodyMapRuntime.set('halley', {
      id: 'halley',
      anchor: halleyAnchor,
      spinMesh: halleyNucleus,
      radius: halleyInfo.radiusUnits,
      orbitSpeed: halleyInfo.orbitSpeed,
      rotationSpeed: halleyInfo.rotationSpeed,
      orbitAngle: initialAngles.halley ?? 0.85,
      isElliptical: true,
      semiMajor: halleyA,
      eccentricity: halleyE,
    });
    labelBindings.push({
      id: 'halley',
      name: "Halley's Comet",
      hindi: halleyInfo.hindiName,
      anchor: halleyAnchor,
      radius: 1.2,
      minDist: 4,
      maxDist: 600,
    });

    // ------------------------------------------------------------------
    // 4C. VOYAGER 1 INTERSTELLAR PROBE (Composite 3D Spacecraft)
    // ------------------------------------------------------------------
    const voyagerInfo = BODY_MAP['voyager-1'];
    const voyagerTilt = new THREE.Group();
    voyagerTilt.rotation.z = THREE.MathUtils.degToRad(voyagerInfo.orbitInclinationDeg);
    solarSystemGroup.add(voyagerTilt);

    const voyagerPivot = new THREE.Group();
    voyagerPivot.rotation.y = initialAngles['voyager-1'] ?? 1.9;
    voyagerTilt.add(voyagerPivot);

    const voyagerAnchor = new THREE.Group();
    voyagerAnchor.position.set(voyagerInfo.orbitRadius, 0, 0);
    voyagerPivot.add(voyagerAnchor);

    const voyagerGroup = new THREE.Group();
    const vDishMat = track(new THREE.MeshStandardMaterial({ color: 0xf8fafc, metalness: 0.4, roughness: 0.35, side: THREE.DoubleSide }));
    const vGoldMat = track(new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.92, roughness: 0.22 }));
    const vDarkMat = track(new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.75, roughness: 0.35 }));

    const dishPts = [
      new THREE.Vector2(0.01, 0),
      new THREE.Vector2(0.18, 0.03),
      new THREE.Vector2(0.36, 0.12),
    ];
    const vDish = new THREE.Mesh(track(new THREE.LatheGeometry(dishPts, 28)), vDishMat);
    const vBus = new THREE.Mesh(track(new THREE.CylinderGeometry(0.14, 0.14, 0.1, 10)), vGoldMat);
    vBus.position.y = -0.06;
    const vRtgBoom = new THREE.Mesh(track(new THREE.CylinderGeometry(0.014, 0.018, 0.52, 8)), vDarkMat);
    vRtgBoom.rotation.z = Math.PI / 2;
    vRtgBoom.position.set(0.28, -0.06, 0);
    const vMagBoom = new THREE.Mesh(track(new THREE.CylinderGeometry(0.008, 0.008, 0.95, 6)), vDarkMat);
    vMagBoom.rotation.z = -Math.PI / 2.2;
    vMagBoom.position.set(-0.46, -0.1, 0);
    const vRecord = new THREE.Mesh(track(new THREE.CylinderGeometry(0.045, 0.045, 0.01, 18)), vGoldMat);
    vRecord.rotation.x = Math.PI / 2;
    vRecord.position.set(0, -0.06, 0.145);

    voyagerGroup.add(vDish, vBus, vRtgBoom, vMagBoom, vRecord);
    voyagerAnchor.add(voyagerGroup);

    const vHit = new THREE.Mesh(
      track(new THREE.SphereGeometry(0.55, 12, 12)),
      track(new THREE.MeshBasicMaterial({ visible: false })),
    );
    vHit.userData.bodyId = 'voyager-1';
    voyagerAnchor.add(vHit);
    clickableMeshes.push(vHit);

    bodyMapRuntime.set('voyager-1', {
      id: 'voyager-1',
      anchor: voyagerAnchor,
      orbitPivot: voyagerPivot,
      spinMesh: voyagerGroup,
      radius: voyagerInfo.radiusUnits,
      orbitSpeed: voyagerInfo.orbitSpeed,
      rotationSpeed: voyagerInfo.rotationSpeed,
      orbitAngle: initialAngles['voyager-1'] ?? 1.9,
    });
    labelBindings.push({
      id: 'voyager-1',
      name: 'Voyager 1',
      hindi: voyagerInfo.hindiName,
      anchor: voyagerAnchor,
      radius: 0.6,
      minDist: 1.5,
      maxDist: 700,
    });

    // ------------------------------------------------------------------
    // 5. ASTEROID BELT & KUIPER BELT
    // ------------------------------------------------------------------
    const createInstancedBelt = (
      count: number,
      innerR: number,
      outerR: number,
      ySpread: number,
      baseScale: number,
      colorHex: number,
    ) => {
      const geo = track(new THREE.DodecahedronGeometry(1, 0));
      const mat = track(new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.92, metalness: 0.08 }));
      const inst = new THREE.InstancedMesh(geo, mat, count);
      const dummy = new THREE.Object3D();
      const tint = new THREE.Color();

      for (let i = 0; i < count; i++) {
        const r = innerR + Math.random() * (outerR - innerR);
        const a = Math.random() * Math.PI * 2;
        dummy.position.set(Math.cos(a) * r, (Math.random() - 0.5) * ySpread, Math.sin(a) * r);
        dummy.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
        const s = baseScale * (0.4 + Math.random() * 1.1);
        dummy.scale.set(s * (0.8 + Math.random() * 0.5), s * (0.7 + Math.random() * 0.5), s);
        dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);

        tint.setHex(colorHex).offsetHSL(0, 0, (Math.random() - 0.5) * 0.22);
        inst.setColorAt(i, tint);
      }
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      inst.computeBoundingSphere();
      return inst;
    };

    const asteroidBelt = createInstancedBelt(1800, 96, 112, 3.2, 0.24, 0x8b7e74);
    solarSystemGroup.add(asteroidBelt);

    const kuiperBelt = createInstancedBelt(1200, 276, 330, 14, 0.34, 0x94a3b8);
    solarSystemGroup.add(kuiperBelt);

    // ------------------------------------------------------------------
    // 5B. ISRO / NASA LIVE SPACE MISSION ROCKET & TRAJECTORY LINES
    // ------------------------------------------------------------------
    const missionGroup = new THREE.Group();
    missionGroup.visible = false;
    scene.add(missionGroup);

    const rocketAssembly = createRocketAssembly(track);
    const launchpadAssembly = createLaunchpadAssembly(track);
    launchpadAssembly.root.visible = false;
    if (earthMeshRef) {
      earthMeshRef.add(launchpadAssembly.root);
    } else {
      scene.add(launchpadAssembly.root);
    }

    const missionAnchor = new THREE.Group();
    missionAnchor.add(rocketAssembly.root);
    const missionGlow = new THREE.Sprite(
      track(
        new THREE.SpriteMaterial({
          map: glowTex,
          color: 0x38bdf8,
          transparent: true,
          opacity: 0.72,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      ),
    );
    missionGlow.scale.set(1.4, 1.4, 1);
    missionAnchor.add(missionGlow);
    missionGroup.add(missionAnchor);

    const MISSION_SAMPLE_COUNT = 220;
    const guidePositions = new Float32Array(MISSION_SAMPLE_COUNT * 3);
    const guideGeo = track(new THREE.BufferGeometry());
    guideGeo.setAttribute('position', new THREE.BufferAttribute(guidePositions, 3));
    const guideMat = track(
      new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.34 }),
    );
    const missionGuideLine = new THREE.Line(guideGeo, guideMat);
    missionGuideLine.frustumCulled = false;
    missionGroup.add(missionGuideLine);

    const trailPositions = new Float32Array(MISSION_SAMPLE_COUNT * 3);
    const trailGeo = track(new THREE.BufferGeometry());
    trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
    const trailMat = track(
      new THREE.LineBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.92 }),
    );
    const missionTrailLine = new THREE.Line(trailGeo, trailMat);
    missionTrailLine.frustumCulled = false;
    missionGroup.add(missionTrailLine);

    const missionCtx: MissionSceneContext = {
      earthPos: new THREE.Vector3(),
      earthRadius: BODY_MAP.earth.radiusUnits,
      moonPos: new THREE.Vector3(),
      moonRadius: BODY_MAP.moon.radiusUnits,
      sunPos: new THREE.Vector3(),
      marsPos: new THREE.Vector3(),
      marsRadius: BODY_MAP.mars.radiusUnits,
      jupiterPos: new THREE.Vector3(),
      jupiterRadius: BODY_MAP.jupiter.radiusUnits,
      saturnPos: new THREE.Vector3(),
      saturnRadius: BODY_MAP.saturn.radiusUnits,
      padNormal: new THREE.Vector3(0, 1, 0),
    };
    const _missionSample = new THREE.Vector3();
    const _missionLook = new THREE.Vector3();
    const _prevMissionPos = new THREE.Vector3();
    const _padLocal = new THREE.Vector3();
    const _padLook = new THREE.Vector3();
    const _tanEast = new THREE.Vector3();
    let currentMissionId: MissionId | null = null;
    let missionProgress = 0;
    let countdownSec = 0;
    let missionElapsedSec = 0;
    let followRocket = false;
    let lastMissionTelemetryTime = 0;
    let autoPulledBack = false;
    let autoMoonZoomed = false;

    // Floating HTML labels
    const labelsRoot = labelsContainerRef.current;
    if (labelsRoot) {
      labelsRoot.innerHTML = '';
      labelElementsRef.current.clear();
      for (const item of labelBindings) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className =
          'absolute -translate-x-1/2 -translate-y-full pointer-events-auto px-2 py-0.5 text-[11px] font-medium tracking-wide text-slate-200 bg-[#070B14]/85 border border-white/15 rounded hover:border-cyan-400/70 hover:text-cyan-200 transition-colors whitespace-nowrap select-none cursor-pointer';
        btn.style.willChange = 'transform, opacity';
        btn.innerHTML = `${item.name} <span class="text-slate-400 font-normal">· ${item.hindi}</span>`;
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          callbacksRef.current.onSelectBody(item.id);
        });
        labelsRoot.appendChild(btn);
        labelElementsRef.current.set(item.id, btn);
      }
    }

    // ------------------------------------------------------------------
    // 6. CAMERA FLY-TO & INTERACTION
    // ------------------------------------------------------------------
    let flyActive = false;
    let flyTargetDist = 11.5;
    let flyCustomOffsetDir: THREE.Vector3 | null = null;
    const prevFocusedPos = new THREE.Vector3();
    let lastFocusedId: CelestialBodyId = stateRef.current.focusedId;
    let surfaceTransitionCooldown = 0;

    const initialBody = bodyMapRuntime.get(lastFocusedId);
    const initialInfo = BODY_MAP[lastFocusedId];
    if (initialBody && initialInfo) {
      initialBody.anchor.getWorldPosition(prevFocusedPos);
      controls.target.copy(prevFocusedPos);
      const initDist = initialInfo.radiusUnits * initialInfo.defaultZoomMultiplier;
      const initDir =
        lastFocusedId === 'milky-way'
          ? new THREE.Vector3(0.45, 0.72, 0.52).normalize()
          : lastFocusedId === 'universe'
            ? new THREE.Vector3(0.55, 0.45, 0.7).normalize()
            : new THREE.Vector3(0.66, 0.24, 0.71).normalize();
      camera.position.copy(prevFocusedPos).addScaledVector(initDir, initDist);
      camera.near = THREE.MathUtils.clamp(initDist * 0.004, 0.04, 250);
      camera.far = Math.max(240000, initDist * 28);
      camera.updateProjectionMatrix();
      controls.update();
    }

    const cancelFly = () => {
      flyActive = false;
      flyCustomOffsetDir = null;
    };
    controls.addEventListener('start', cancelFly);

    const raycaster = new THREE.Raycaster();
    const pointerNdc = new THREE.Vector2();
    let pointerDownPos = { x: 0, y: 0 };

    const onPointerDown = (e: PointerEvent) => {
      pointerDownPos = { x: e.clientX, y: e.clientY };
    };
    const onPointerUp = (e: PointerEvent) => {
      const dx = e.clientX - pointerDownPos.x;
      const dy = e.clientY - pointerDownPos.y;
      if (dx * dx + dy * dy > 36) return;

      const rect = renderer.domElement.getBoundingClientRect();
      pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointerNdc, camera);

      // Check Earth surface city pins first when zoomed near Earth
      if (earthPinMeshes.length > 0 && lastFocusedId === 'earth') {
        const pinHits = raycaster.intersectObjects(earthPinMeshes, false);
        if (pinHits.length > 0) {
          const lm = pinHits[0].object.userData.earthLandmark as
            | { lat: number; lng: number; zoom: number; name: string }
            | undefined;
          if (lm) {
            callbacksRef.current.onEnterEarthSurface(lm.lat, lm.lng, lm.zoom, lm.name);
            return;
          }
        }
      }

      const hits = raycaster.intersectObjects(clickableMeshes, false);
      if (hits.length > 0) {
        const hitId = hits[0].object.userData.bodyId as CelestialBodyId | undefined;
        if (hitId) {
          callbacksRef.current.onSelectBody(hitId);
        }
      }
    };
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

    const handleResize = () => {
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      if (composer) composer.setSize(w, h);
      if (bloomPass) bloomPass.resolution.set(w, h);
    };
    window.addEventListener('resize', handleResize);

    const onContextLost = (e: Event) => {
      e.preventDefault();
    };
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    // ------------------------------------------------------------------
    // 7. ANIMATION LOOP
    // ------------------------------------------------------------------
    const clock = new THREE.Clock();
    let frameId = 0;
    let lastTelemetryTime = 0;
    let disposed = false;

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) {
          if (sync) gl.deleteSync(sync);
          return;
        }
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function tick() {
      if (disposed) return;

      const delta = Math.min(clock.getDelta(), 0.08);
      const elapsed = clock.getElapsedTime();
      const {
        focusedId: curFocus,
        timeScale: speedMul,
        isPlaying: playing,
        showOrbits: orbitsVis,
        showLabels: labelsVis,
        showConstellations: constVis,
        autoOrbit: doAutoOrbit,
        isSurfaceMode: inSurface,
        activeMissionId: curMissionId,
        missionSpeed: mSpeed,
        missionPaused: mPaused,
      } = stateRef.current;

      // Helper to populate missionCtx from current live planetary positions
      const syncMissionCtx = (mId: MissionId) => {
        const missionDef = MISSION_MAP[mId];
        bodyMapRuntime.get('earth')?.anchor.getWorldPosition(missionCtx.earthPos);
        bodyMapRuntime.get('moon')?.anchor.getWorldPosition(missionCtx.moonPos);
        bodyMapRuntime.get('sun')?.anchor.getWorldPosition(missionCtx.sunPos);
        bodyMapRuntime.get('mars')?.anchor.getWorldPosition(missionCtx.marsPos);
        bodyMapRuntime.get('jupiter')?.anchor.getWorldPosition(missionCtx.jupiterPos);
        bodyMapRuntime.get('saturn')?.anchor.getWorldPosition(missionCtx.saturnPos);
        if (earthMeshRef) {
          latLngToLocalVec(missionDef.launchLat, missionDef.launchLng, 1, missionCtx.padNormal);
          earthMeshRef.localToWorld(missionCtx.padNormal);
          missionCtx.padNormal.sub(missionCtx.earthPos).normalize();
        }
      };

      const setupMissionLaunchpadView = (mId: MissionId) => {
        const mDef = MISSION_MAP[mId];
        missionProgress = 0;
        countdownSec = 3.8;
        missionElapsedSec = 0;
        followRocket = true;
        autoPulledBack = false;
        autoMoonZoomed = false;
        missionGroup.visible = true;

        const accent = new THREE.Color(mDef.accentColor);
        rocketAssembly.accentBandMat.color.copy(accent);
        trailMat.color.copy(accent);
        missionGlow.material.color.copy(accent);

        if (earthMeshRef) {
          latLngToLocalVec(mDef.launchLat, mDef.launchLng, BODY_MAP.earth.radiusUnits * 1.001, _padLocal);
          launchpadAssembly.root.position.copy(_padLocal);
          _padLook.copy(_padLocal).multiplyScalar(2);
          earthMeshRef.localToWorld(_padLook);
          launchpadAssembly.root.lookAt(_padLook);
          launchpadAssembly.root.visible = true;
        }

        syncMissionCtx(mId);
        sampleMissionPosition(mId, 0, missionCtx, missionAnchor.position);
        _prevMissionPos.copy(missionAnchor.position);

        // Tight cinematic camera beside the Sriharikota/Kennedy launchpad tower!
        _tanEast.crossVectors(new THREE.Vector3(0, 1, 0), missionCtx.padNormal).normalize();
        flyActive = true;
        flyTargetDist = 0.62;
        flyCustomOffsetDir = missionCtx.padNormal
          .clone()
          .multiplyScalar(0.32)
          .addScaledVector(_tanEast, 0.92)
          .normalize();
        surfaceTransitionCooldown = 2.5;
      };

      // Handle mission launch / switch / stop
      if (curMissionId !== currentMissionId) {
        currentMissionId = curMissionId;
        if (curMissionId) {
          setupMissionLaunchpadView(curMissionId);
        } else {
          missionGroup.visible = false;
          launchpadAssembly.root.visible = false;
          followRocket = false;
          callbacksRef.current.onMissionTelemetry?.(null);
        }
      }

      // Apply pending mission seek/scrub
      const seekCmd = pendingSeekRef.current;
      if (seekCmd && currentMissionId) {
        pendingSeekRef.current = null;
        missionProgress = THREE.MathUtils.clamp(seekCmd.progress, 0, 1);
        countdownSec = missionProgress <= 0.001 ? 3.8 : 0;
      }

      // Apply pending imperative command
      const cmd = pendingCommandRef.current;
      if (cmd) {
        pendingCommandRef.current = null;
        if (cmd.type === 'screenshot') {
          if (composer && !isSoftwareGl) composer.render();
          else renderer.render(scene, camera);
          const url = renderer.domElement.toDataURL('image/png');
          const a = document.createElement('a');
          a.href = url;
          a.download = `brahmand-${lastFocusedId}.png`;
          a.click();
        } else if (cmd.type === 'restart-mission' && currentMissionId) {
          setupMissionLaunchpadView(currentMissionId);
        } else if (cmd.type === 'focus-mission' && currentMissionId) {
          followRocket = true;
          flyActive = true;
          flyTargetDist =
            missionProgress < 0.06
              ? 0.72
              : missionProgress > 0.85
                ? 0.85
                : currentMissionId === 'chandrayaan-3' || currentMissionId === 'apollo-11'
                  ? 3.8
                  : 8.5;
          flyCustomOffsetDir = new THREE.Vector3(0.55, 0.42, 0.72).normalize();
        } else if (cmd.type === 'focus' && cmd.bodyId) {
          followRocket = false;
          const info = BODY_MAP[cmd.bodyId];
          const runtime = bodyMapRuntime.get(cmd.bodyId);
          if (info && runtime) {
            lastFocusedId = cmd.bodyId;
            runtime.anchor.getWorldPosition(prevFocusedPos);
            flyActive = true;
            flyTargetDist = info.radiusUnits * (cmd.distanceMultiplier ?? info.defaultZoomMultiplier);
            if (cmd.bodyId === 'milky-way') {
              flyCustomOffsetDir = new THREE.Vector3(0.45, 0.72, 0.52).normalize();
            } else if (cmd.bodyId === 'universe') {
              flyCustomOffsetDir = new THREE.Vector3(0.55, 0.45, 0.7).normalize();
            } else if (cmd.bodyId === 'sun') {
              flyCustomOffsetDir = new THREE.Vector3(0.5, 0.42, 0.75).normalize();
            } else {
              flyCustomOffsetDir = null;
            }
          }
        } else if (cmd.type === 'zoom-step') {
          _v1.subVectors(camera.position, controls.target);
          const curDist = _v1.length();
          const factor = cmd.zoomDirection === 'in' ? 0.52 : 1.85;
          const info = BODY_MAP[curFocus];
          const minD = followRocket
            ? 0.9
            : curFocus === 'earth'
              ? info.radiusUnits * 1.15
              : info.radiusUnits * info.minZoomMultiplier;
          flyTargetDist = THREE.MathUtils.clamp(curDist * factor, minD, 95000);
          flyActive = true;
          flyCustomOffsetDir = _v1.normalize().clone();
        } else if (cmd.type === 'fly-earth-latlng' && typeof cmd.lat === 'number' && typeof cmd.lng === 'number') {
          followRocket = false;
          const eRuntime = bodyMapRuntime.get('earth');
          if (eRuntime && earthMeshRef) {
            lastFocusedId = 'earth';
            eRuntime.anchor.getWorldPosition(prevFocusedPos);
            latLngToLocalVec(cmd.lat, cmd.lng, 1, _v2);
            earthMeshRef.localToWorld(_v2);
            _v2.sub(prevFocusedPos).normalize();
            flyCustomOffsetDir = _v2.clone();
            flyTargetDist = BODY_MAP.earth.radiusUnits * (cmd.distanceMultiplier ?? 3.1);
            flyActive = true;
            surfaceTransitionCooldown = 1.4;
          }
        }
      }

      if (curFocus !== lastFocusedId) {
        followRocket = false;
        const info = BODY_MAP[curFocus];
        const runtime = bodyMapRuntime.get(curFocus);
        if (info && runtime) {
          lastFocusedId = curFocus;
          runtime.anchor.getWorldPosition(prevFocusedPos);
          flyActive = true;
          flyTargetDist = info.radiusUnits * info.defaultZoomMultiplier;
          flyCustomOffsetDir =
            curFocus === 'milky-way'
              ? new THREE.Vector3(0.45, 0.72, 0.52).normalize()
              : curFocus === 'universe'
                ? new THREE.Vector3(0.55, 0.45, 0.7).normalize()
                : null;
        }
      }

      for (let i = 0; i < orbitLines.length; i++) {
        orbitLines[i].visible = orbitsVis;
      }
      constellationsGroup.visible = constVis;

      const tracked = bodyMapRuntime.get(lastFocusedId);
      if (tracked && !followRocket) {
        tracked.anchor.getWorldPosition(_v1);
      }

      if (playing && !inSurface) {
        const simDt = delta * speedMul;

        bodyMapRuntime.forEach((b) => {
          if (b.isElliptical) {
            b.orbitAngle += b.orbitSpeed * simDt;
            const ex = Math.cos(b.orbitAngle) * halleyA - halleyC;
            const ez = Math.sin(b.orbitAngle) * halleyB;
            b.anchor.position.set(ex, 0, ez);
          } else if (b.orbitPivot && b.orbitSpeed !== 0) {
            b.orbitAngle += b.orbitSpeed * simDt;
            b.orbitPivot.rotation.y = b.orbitAngle;
          }
          if (b.rotationSpeed !== 0) {
            b.spinMesh.rotation.y += b.rotationSpeed * simDt;
          }
        });

        if (earthCloudMeshRef) {
          earthCloudMeshRef.rotation.y += 0.38 * simDt;
        }
        for (let i = 0; i < minorMoons.length; i++) {
          minorMoons[i].pivot.rotation.y += minorMoons[i].speed * simDt;
        }
        asteroidBelt.rotation.y += 0.045 * simDt;
        kuiperBelt.rotation.y += 0.012 * simDt;
      }

      // Orient Comet tail strictly away from the Sun
      halleyAnchor.getWorldPosition(_v2);
      sunAnchor.getWorldPosition(_v3);
      _v4.subVectors(_v2, _v3).normalize();
      _v2.add(_v4);
      cometTailMesh.lookAt(_v2);

      sunMat.uniforms.uTime.value = elapsed;
      accretionMat.uniforms.uTime.value = elapsed;
      cometTailMat.uniforms.uTime.value = elapsed;
      if (auroraMatRef) auroraMatRef.uniforms.uTime.value = elapsed;

      if (earthMatShaderRef) {
        sunAnchor.getWorldPosition(earthMatShaderRef.uniforms.uSunWorldPos.value);
      }

      // Advance & render active ISRO/NASA space mission
      if (currentMissionId) {
        syncMissionCtx(currentMissionId);
        const mDef = MISSION_MAP[currentMissionId];

        const inCountdown = countdownSec > 0;
        if (!mPaused && !inSurface) {
          if (countdownSec > 0) {
            countdownSec = Math.max(0, countdownSec - delta);
          } else if (missionProgress < 1) {
            // Slower dramatic ascent at lift-off, accelerating smoothly in space!
            const rateMul = missionProgress < 0.08 ? 0.015 : 0.028;
            missionProgress = Math.min(1, missionProgress + delta * rateMul * mSpeed);
            missionElapsedSec += delta * mSpeed * 3600;
          }
        }

        // Smooth camera pull-back after tower clearance & close-up zoom on Lunar Landing!
        if (followRocket && !inCountdown) {
          if (!autoPulledBack && missionProgress > 0.13) {
            autoPulledBack = true;
            flyActive = true;
            flyTargetDist =
              currentMissionId === 'chandrayaan-3' || currentMissionId === 'apollo-11' ? 5.4 : 8.2;
          }
          if (
            !autoMoonZoomed &&
            (currentMissionId === 'chandrayaan-3' || currentMissionId === 'apollo-11') &&
            missionProgress > 0.85
          ) {
            autoMoonZoomed = true;
            flyActive = true;
            flyTargetDist = 0.82;
          }
        }

        // Launchpad animations: keep oriented at Sriharikota/KSC, swing arms, billow smoke!
        if (earthMeshRef && launchpadAssembly.root.visible) {
          _padLook.copy(launchpadAssembly.root.position).multiplyScalar(2);
          earthMeshRef.localToWorld(_padLook);
          launchpadAssembly.root.lookAt(_padLook);

          const armSwing =
            countdownSec > 2.3 ? 0 : countdownSec > 0 ? THREE.MathUtils.clamp((2.3 - countdownSec) * 1.1, 0, 1.35) : 1.35;
          launchpadAssembly.umbilicalArm1.rotation.y = armSwing;
          launchpadAssembly.umbilicalArm2.rotation.y = -armSwing;

          const padFireActive = (inCountdown && countdownSec < 1.7) || (!inCountdown && missionProgress < 0.05);
          launchpadAssembly.smokeCloud.visible = padFireActive;
          if (padFireActive) {
            const billow = inCountdown ? 0.7 + (1.7 - countdownSec) * 0.65 : 1.8 + missionProgress * 22;
            for (let i = 0; i < launchpadAssembly.smokePuffs.length; i++) {
              const puff = launchpadAssembly.smokePuffs[i];
              const pulse = billow * (0.85 + Math.sin(elapsed * 18 + i) * 0.25);
              puff.scale.setScalar(Math.min(3.4, pulse));
            }
          }
        }

        const activePhase =
          mDef.phases.find(
            (p) => missionProgress >= p.startPct && missionProgress <= p.endPct,
          ) ?? mDef.phases[mDef.phases.length - 1];

        sampleMissionPosition(currentMissionId, missionProgress, missionCtx, _v4);
        sampleMissionPosition(
          currentMissionId,
          Math.min(1, missionProgress + 0.004),
          missionCtx,
          _missionLook,
        );
        missionAnchor.position.copy(_v4);

        // Rocket Orientation:
        // - Upright on pad & vertical climb: nose along padNormal
        // - Powered landing descent / landed on Moon or Mars: landing legs DOWN toward planet center!
        // - Mid-flight cruise/orbit: nose forward along trajectory tangent
        const isLunarLanding =
          (currentMissionId === 'chandrayaan-3' && missionProgress >= 0.87) ||
          (currentMissionId === 'apollo-11' && missionProgress >= 0.84);
        const isMarsLanding = currentMissionId === 'perseverance' && missionProgress >= 0.78;

        if (isLunarLanding) {
          _missionLook.subVectors(_v4, missionCtx.moonPos).normalize().add(_v4);
          rocketAssembly.root.lookAt(_missionLook);
        } else if (isMarsLanding) {
          _missionLook.subVectors(_v4, missionCtx.marsPos).normalize().add(_v4);
          rocketAssembly.root.lookAt(_missionLook);
        } else if (missionProgress < 0.045) {
          _missionLook.copy(_v4).add(missionCtx.padNormal);
          rocketAssembly.root.lookAt(_missionLook);
        } else if (missionProgress < 0.996 && _missionLook.distanceToSquared(_v4) > 1e-8) {
          rocketAssembly.root.lookAt(_missionLook);
        }

        // Detailed Multi-Stage Rocket & Spacecraft Animation
        // 1. Strap-on Boosters separate & tumble sideways at t ~ 0.065 -> 0.11
        if (missionProgress < 0.065) {
          rocketAssembly.boosterL.visible = true;
          rocketAssembly.boosterR.visible = true;
          rocketAssembly.boosterL.position.set(-0.078, -0.055, 0);
          rocketAssembly.boosterR.position.set(0.078, -0.055, 0);
          rocketAssembly.boosterL.rotation.z = 0;
          rocketAssembly.boosterR.rotation.z = 0;
        } else if (missionProgress < 0.11) {
          const sep = (missionProgress - 0.065) / 0.045;
          rocketAssembly.boosterL.position.set(-0.078 - sep * 0.28, -0.055 - sep * 0.45, 0);
          rocketAssembly.boosterR.position.set(0.078 + sep * 0.28, -0.055 - sep * 0.45, 0);
          rocketAssembly.boosterL.rotation.z = sep * 0.7;
          rocketAssembly.boosterR.rotation.z = -sep * 0.7;
        } else {
          rocketAssembly.boosterL.visible = false;
          rocketAssembly.boosterR.visible = false;
        }

        // 2. Payload Fairing opens cleanly left/right at t ~ 0.105 -> 0.145
        if (missionProgress < 0.105) {
          rocketAssembly.fairingL.visible = true;
          rocketAssembly.fairingR.visible = true;
          rocketAssembly.fairingL.position.set(0, 0.185, 0);
          rocketAssembly.fairingR.position.set(0, 0.185, 0);
          rocketAssembly.fairingL.rotation.z = 0;
          rocketAssembly.fairingR.rotation.z = 0;
        } else if (missionProgress < 0.145) {
          const fSep = (missionProgress - 0.105) / 0.04;
          rocketAssembly.fairingL.position.set(-fSep * 0.24, 0.185 - fSep * 0.12, 0);
          rocketAssembly.fairingR.position.set(fSep * 0.24, 0.185 - fSep * 0.12, 0);
          rocketAssembly.fairingL.rotation.z = fSep * 0.85;
          rocketAssembly.fairingR.rotation.z = -fSep * 0.85;
        } else {
          rocketAssembly.fairingL.visible = false;
          rocketAssembly.fairingR.visible = false;
        }

        // 3. Core Stage sheds for final landing/spacecraft phases & lander legs + rover deploy!
        const landedThreshold =
          currentMissionId === 'chandrayaan-3'
            ? 0.965
            : currentMissionId === 'apollo-11'
              ? 0.955
              : currentMissionId === 'perseverance'
                ? 0.94
                : 1.01;
        const landed = missionProgress >= landedThreshold;
        const landingStage = isLunarLanding || isMarsLanding;

        rocketAssembly.coreStageGroup.visible = !landingStage;
        rocketAssembly.solarWings.visible = missionProgress > 0.13 && !landingStage;
        rocketAssembly.landerLegs.visible = landingStage;
        rocketAssembly.roverMesh.visible = landed;
        if (landed) {
          const rollU = THREE.MathUtils.clamp((missionProgress - landedThreshold) / (1 - landedThreshold), 0, 1);
          rocketAssembly.roverMesh.position.set(0, -0.045, 0.045 + rollU * 0.085);
        }

        const dustWindow =
          landingStage && !landed && missionProgress > landedThreshold - 0.035;
        rocketAssembly.dustRing.visible = dustWindow;
        if (dustWindow) {
          const dPulse = 1 + Math.sin(elapsed * 26) * 0.25;
          rocketAssembly.dustRing.scale.setScalar(dPulse);
        }

        // Plume active during pre-launch ignition (T < 1.6s), burns, & powered descent before touchdown!
        const firing =
          (inCountdown && countdownSec < 1.6) ||
          (!inCountdown && activePhase.thrustActive && !landed && missionProgress < 0.995);
        rocketAssembly.plume.visible = firing;
        if (firing) {
          const pulse = 0.86 + Math.sin(elapsed * 44) * 0.18;
          rocketAssembly.plume.scale.set(1, pulse, 1);
        }

        // Keep rocket sized properly: 0.42 on Earth launchpad -> scales cleanly in deep space!
        const dToCam = Math.max(0.4, camera.position.distanceTo(missionAnchor.position));
        const rocketScale = THREE.MathUtils.clamp(dToCam * 0.13, 0.36, 5.2);
        rocketAssembly.root.scale.setScalar(rocketScale);
        missionGlow.scale.setScalar(inCountdown || missionProgress < 0.05 ? 0.25 : rocketScale * 1.9);

        // Update dynamic trajectory guide & traveled trail
        const gAttr = guideGeo.getAttribute('position') as THREE.BufferAttribute;
        const tAttr = trailGeo.getAttribute('position') as THREE.BufferAttribute;
        for (let i = 0; i < MISSION_SAMPLE_COUNT; i++) {
          const u = i / (MISSION_SAMPLE_COUNT - 1);
          sampleMissionPosition(currentMissionId, u, missionCtx, _missionSample);
          gAttr.setXYZ(i, _missionSample.x, _missionSample.y, _missionSample.z);

          const ut = u * missionProgress;
          sampleMissionPosition(currentMissionId, ut, missionCtx, _missionSample);
          tAttr.setXYZ(i, _missionSample.x, _missionSample.y, _missionSample.z);
        }
        gAttr.needsUpdate = true;
        tAttr.needsUpdate = true;

        if (followRocket) {
          _v3.subVectors(missionAnchor.position, _prevMissionPos);
          camera.position.add(_v3);
          controls.target.add(_v3);
          prevFocusedPos.copy(missionAnchor.position);
        }
        _prevMissionPos.copy(missionAnchor.position);

        // Determine rich action caption for user
        let actionCaption = activePhase.detail;
        if (inCountdown) {
          actionCaption =
            countdownSec > 2.2
              ? `Rocket Ready on ${mDef.launchSiteName} — Guidance Locked`
              : countdownSec > 1.3
                ? 'Umbilical Arms Retracting — Cryogenic Main Engine Chill'
                : 'MAIN ENGINE IGNITION! Boosters Building Full Thrust!';
        } else if (missionProgress < 0.045) {
          actionCaption = `LIFT-OFF from ${mDef.launchSiteName}! Clearing Launch Tower`;
        } else if (missionProgress >= 0.065 && missionProgress < 0.11) {
          actionCaption = 'Strap-on Boosters Separated — Core Stage Accelerating!';
        } else if (missionProgress >= 0.11 && missionProgress < 0.145) {
          actionCaption = 'Payload Fairing Separated — Spacecraft Solar Arrays Deploying';
        } else if (landed) {
          actionCaption =
            currentMissionId === 'chandrayaan-3'
              ? 'TOUCHDOWN! Vikram Landed at Moon South Pole — Pragyan Rover Rolling Out!'
              : currentMissionId === 'apollo-11'
                ? 'THE EAGLE HAS LANDED! Sea of Tranquility Mission Accomplished!'
                : 'TOUCHDOWN CONFIRMED! Mars Surface Operations Active!';
        }

        if (!inSurface && elapsed - lastMissionTelemetryTime > 0.1) {
          lastMissionTelemetryTime = elapsed;
          const phaseSpan = Math.max(0.001, activePhase.endPct - activePhase.startPct);
          const phaseLocalU = THREE.MathUtils.clamp(
            (missionProgress - activePhase.startPct) / phaseSpan,
            0,
            1,
          );
          const vel = inCountdown
            ? 0
            : landed
              ? 0
              : THREE.MathUtils.lerp(
                  activePhase.velocityKmS[0],
                  activePhase.velocityKmS[1],
                  phaseLocalU,
                );
          const hrs = Math.floor(missionElapsedSec / 3600);
          const mins = Math.floor((missionElapsedSec % 3600) / 60);
          callbacksRef.current.onMissionTelemetry?.({
            missionId: currentMissionId,
            progress: missionProgress,
            countdownSec,
            isCountdown: inCountdown,
            phaseName: inCountdown
              ? `T-${Math.ceil(countdownSec)}s Pre-Launch Countdown`
              : activePhase.name,
            phaseDetail: activePhase.detail,
            actionCaption,
            velocityKmS: vel,
            altitudeText: inCountdown ? mDef.launchSiteName : activePhase.altitudeLabel,
            elapsedText: inCountdown
              ? `T-00:0${Math.ceil(countdownSec)}`
              : `T+${hrs.toString().padStart(2, '0')}h ${mins.toString().padStart(2, '0')}m`,
            thrustActive: firing,
            completed: missionProgress >= 0.999,
          });
        }
      }

      if (tracked && !followRocket) {
        tracked.anchor.getWorldPosition(_v2);
        _v3.subVectors(_v2, _v1);
        camera.position.add(_v3);
        controls.target.add(_v3);
        prevFocusedPos.copy(_v2);
      }

      if (flyActive && (tracked || followRocket)) {
        const targetPos = prevFocusedPos;
        const dampAlpha = 1 - Math.exp(-5.4 * delta);
        controls.target.lerp(targetPos, dampAlpha);

        _v4.subVectors(camera.position, controls.target);
        const curLen = Math.max(0.05, _v4.length());
        const dir = flyCustomOffsetDir ? flyCustomOffsetDir : _v4.normalize();
        const nextLen = THREE.MathUtils.lerp(curLen, flyTargetDist, dampAlpha);
        camera.position.copy(controls.target).addScaledVector(dir, nextLen);

        if (Math.abs(nextLen - flyTargetDist) < flyTargetDist * 0.015 && controls.target.distanceTo(targetPos) < 0.05) {
          flyActive = false;
          flyCustomOffsetDir = null;
        }
      }

      controls.autoRotate = !isSoftwareGl && doAutoOrbit && !flyActive && !inSurface;
      controls.autoRotateSpeed = 0.65;

      if (followRocket) {
        controls.minDistance = 0.25;
      } else if (tracked) {
        const minSurfaceDist =
          lastFocusedId === 'earth'
            ? tracked.radius * 1.18
            : lastFocusedId === 'universe' || lastFocusedId === 'milky-way'
              ? 18
              : tracked.radius * 1.42;
        controls.minDistance = minSurfaceDist;
      }

      controls.update();

      const camDist = camera.position.distanceTo(controls.target);
      camera.near = THREE.MathUtils.clamp(camDist * 0.004, 0.006, 250);
      camera.far = Math.max(240000, camDist * 28);
      camera.updateProjectionMatrix();

      let camLat = 28.6139;
      let camLng = 77.209;
      if (earthMeshRef) {
        const eRuntime = bodyMapRuntime.get('earth');
        if (eRuntime) {
          eRuntime.anchor.getWorldPosition(_v1);
          const distToEarth = camera.position.distanceTo(_v1);
          if (lastFocusedId === 'earth' || distToEarth < eRuntime.radius * 10) {
            _v2.copy(camera.position);
            earthMeshRef.worldToLocal(_v2);
            const coords = localVecToLatLng(_v2);
            camLat = coords.lat;
            camLng = coords.lng;

            if (surfaceTransitionCooldown > 0) {
              surfaceTransitionCooldown -= delta;
            } else if (!inSurface && !followRocket && distToEarth < eRuntime.radius * 1.29 && !flyActive) {
              surfaceTransitionCooldown = 2.0;
              callbacksRef.current.onEnterEarthSurface(camLat, camLng);
            }
          }
        }
      }

      if (labelsRoot) {
        const vw = renderer.domElement.clientWidth;
        const vh = renderer.domElement.clientHeight;
        labelBindings.forEach((lbl) => {
          const el = labelElementsRef.current.get(lbl.id);
          if (!el) return;
          if (!labelsVis || inSurface) {
            el.style.opacity = '0';
            el.style.pointerEvents = 'none';
            return;
          }
          lbl.anchor.getWorldPosition(_proj);
          const dCam = camera.position.distanceTo(_proj);
          if (dCam < lbl.minDist || dCam > lbl.maxDist || (lbl.id === lastFocusedId && dCam < lbl.radius * 5)) {
            el.style.opacity = '0';
            el.style.pointerEvents = 'none';
            return;
          }
          _proj.y += lbl.radius * 1.25;
          _proj.project(camera);
          if (_proj.z > 1 || _proj.x < -1.05 || _proj.x > 1.05 || _proj.y < -1.05 || _proj.y > 1.05) {
            el.style.opacity = '0';
            el.style.pointerEvents = 'none';
            return;
          }
          const sx = ((_proj.x + 1) * 0.5) * vw;
          const sy = ((-_proj.y + 1) * 0.5) * vh;
          el.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0) translate(-50%, -100%)`;
          el.style.opacity = '1';
          el.style.pointerEvents = 'auto';
        });
      }

      if (!inSurface && elapsed - lastTelemetryTime > 0.16) {
        lastTelemetryTime = elapsed;
        const focusedBody = BODY_MAP[lastFocusedId];
        const fmt = formatCosmicDistance(camDist, lastFocusedId, focusedBody.radiusUnits);
        callbacksRef.current.onTelemetry({
          focusedId: lastFocusedId,
          scaleLabel: fmt.scaleLabel,
          altitudeText: fmt.altitudeText,
          scaleMeterPct: fmt.scaleMeterPct,
          isSurfaceMode: false,
          cameraLat: camLat,
          cameraLng: camLng,
        });
      }

      if (!inSurface) {
        if (composer && !isSoftwareGl) composer.render();
        else renderer.render(scene, camera);
      }

      if (isSoftwareGl) afterDraw(tick);
      else frameId = requestAnimationFrame(tick);
    }

    if (isSoftwareGl) afterDraw(tick);
    else frameId = requestAnimationFrame(tick);

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      controls.removeEventListener('start', cancelFly);
      controls.dispose();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      window.removeEventListener('resize', handleResize);
      composer?.dispose();
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div className="relative w-full h-full overflow-hidden">
      <div ref={mountRef} className="w-full h-full cursor-grab active:cursor-grabbing" />
      <div
        ref={labelsContainerRef}
        className="pointer-events-none absolute inset-0 overflow-hidden z-10"
        aria-hidden="true"
      />
    </div>
  );
};
