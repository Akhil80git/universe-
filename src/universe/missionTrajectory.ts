import * as THREE from 'three';
import type { MissionId } from '../types';

export interface MissionSceneContext {
  earthPos: THREE.Vector3;
  earthRadius: number;
  moonPos: THREE.Vector3;
  moonRadius: number;
  sunPos: THREE.Vector3;
  marsPos: THREE.Vector3;
  marsRadius: number;
  jupiterPos: THREE.Vector3;
  jupiterRadius: number;
  saturnPos: THREE.Vector3;
  saturnRadius: number;
  padNormal: THREE.Vector3;
}

// Pre-allocated scratch vectors (zero per-frame heap allocations)
const _up = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
const _ortho = new THREE.Vector3();
const _binorm = new THREE.Vector3();
const _p0 = new THREE.Vector3();
const _p1 = new THREE.Vector3();
const _p2 = new THREE.Vector3();
const _p3 = new THREE.Vector3();

function cubicBezier(
  p0: THREE.Vector3,
  p1: THREE.Vector3,
  p2: THREE.Vector3,
  p3: THREE.Vector3,
  t: number,
  out: THREE.Vector3,
): THREE.Vector3 {
  const u = 1 - t;
  const tt = t * t;
  const uu = u * u;
  const uuu = uu * u;
  const ttt = tt * t;
  out.set(0, 0, 0);
  out.addScaledVector(p0, uuu);
  out.addScaledVector(p1, 3 * uu * t);
  out.addScaledVector(p2, 3 * u * tt);
  out.addScaledVector(p3, ttt);
  return out;
}

function buildOrthonormalBasis(
  forward: THREE.Vector3,
  orthoOut: THREE.Vector3,
  binormOut: THREE.Vector3,
) {
  _dir.copy(forward).normalize();
  if (Math.abs(_dir.y) > 0.92) {
    orthoOut.set(1, 0, 0);
  } else {
    orthoOut.crossVectors(_up, _dir).normalize();
  }
  binormOut.crossVectors(_dir, orthoOut).normalize();
}

export function sampleMissionPosition(
  missionId: MissionId,
  rawT: number,
  ctx: MissionSceneContext,
  out: THREE.Vector3,
): THREE.Vector3 {
  const t = THREE.MathUtils.clamp(rawT, 0, 1);

  const launchEnd =
    missionId === 'apollo-11'
      ? 0.18
      : missionId === 'aditya-l1'
        ? 0.16
        : missionId === 'perseverance'
          ? 0.2
          : missionId === 'voyager-launch'
            ? 0.18
            : 0.14;

  // Phase 1A: Vertical tower clearance off Sriharikota / Kennedy Space Center pad
  const verticalEnd = 0.045;
  if (t <= verticalEnd) {
    const u = t / verticalEnd;
    const ease = u * u; // accelerating vertical liftoff!
    const climb = ctx.earthRadius * (1.008 + ease * 0.14);
    out.copy(ctx.earthPos).addScaledVector(ctx.padNormal, climb);
    return out;
  }

  // Phase 1B: Eastward Gravity Turn into Low Earth Orbit
  if (t <= launchEnd) {
    const u = (t - verticalEnd) / (launchEnd - verticalEnd);
    const ease = 1 - Math.pow(1 - u, 1.85);
    buildOrthonormalBasis(ctx.padNormal, _ortho, _binorm);
    const climb = ctx.earthRadius * (1.148 + ease * 0.307);
    const eastDrift = ctx.earthRadius * Math.pow(u, 1.35) * 0.56;
    out
      .copy(ctx.earthPos)
      .addScaledVector(ctx.padNormal, climb)
      .addScaledVector(_ortho, eastDrift);
    return out;
  }

  if (missionId === 'chandrayaan-3') {
    _dir.subVectors(ctx.moonPos, ctx.earthPos).normalize();
    buildOrthonormalBasis(_dir, _ortho, _binorm);

    // Phase 2: 5 Earth-bound apogee-raising elliptical spirals
    if (t <= 0.44) {
      const u = (t - 0.14) / 0.30;
      const loops = 5;
      const ang = u * loops * Math.PI * 2;
      const apogeeBoost = 0.35 + u * 2.15;
      const r = ctx.earthRadius * (1.42 + apogeeBoost * (0.5 - 0.5 * Math.cos(ang)));
      const x = -Math.cos(ang) * r;
      const z = Math.sin(ang) * r * 0.82;
      const y = Math.sin(ang * 0.5) * ctx.earthRadius * 0.18;
      out
        .copy(ctx.earthPos)
        .addScaledVector(_dir, x)
        .addScaledVector(_ortho, z)
        .addScaledVector(_binorm, y);
      return out;
    }

    // Phase 3: Trans-Lunar Injection (TLI) Slingshot Arc
    if (t <= 0.66) {
      const u = (t - 0.44) / 0.22;
      const distEM = ctx.earthPos.distanceTo(ctx.moonPos);
      _p0.copy(ctx.earthPos).addScaledVector(_dir, -ctx.earthRadius * 1.42);
      _p1
        .copy(ctx.earthPos)
        .addScaledVector(_dir, distEM * 0.22)
        .addScaledVector(_ortho, -distEM * 0.36);
      _p2
        .copy(ctx.moonPos)
        .addScaledVector(_dir, -distEM * 0.26)
        .addScaledVector(_ortho, distEM * 0.28)
        .addScaledVector(_binorm, ctx.moonRadius * 1.8);
      _p3.copy(ctx.moonPos).addScaledVector(_ortho, ctx.moonRadius * 2.3);
      return cubicBezier(_p0, _p1, _p2, _p3, u, out);
    }

    // Phase 4: Polar Lunar Capture & De-Boosting Spirals
    if (t <= 0.87) {
      const u = (t - 0.66) / 0.21;
      const ang = u * 3 * Math.PI * 2;
      const r = ctx.moonRadius * THREE.MathUtils.lerp(2.3, 1.24, u);
      out
        .copy(ctx.moonPos)
        .addScaledVector(_ortho, Math.cos(ang) * r)
        .addScaledVector(_up, Math.sin(ang) * r);
      return out;
    }

    // Phase 5A: Vikram Powered Vertical Descent to Shiv Shakti Point (0.87 -> 0.965)
    if (t <= 0.965) {
      const u = (t - 0.87) / 0.095;
      const ease = 1 - Math.pow(1 - u, 2.3);
      const r = ctx.moonRadius * THREE.MathUtils.lerp(1.24, 1.022, ease);
      out.set(
        ctx.moonPos.x + Math.sin(u * Math.PI * 0.5) * ctx.moonRadius * 0.06 * (1 - ease),
        ctx.moonPos.y - r,
        ctx.moonPos.z + ctx.moonRadius * 0.22 * (1 - ease),
      );
      return out;
    }

    // Phase 5B: Landed cleanly at Shiv Shakti Point while Pragyan Rover deploys!
    out.set(ctx.moonPos.x, ctx.moonPos.y - ctx.moonRadius * 1.022, ctx.moonPos.z);
    return out;
  }

  if (missionId === 'apollo-11') {
    _dir.subVectors(ctx.moonPos, ctx.earthPos).normalize();
    buildOrthonormalBasis(_dir, _ortho, _binorm);

    if (t <= 0.62) {
      const u = (t - 0.18) / 0.44;
      const distEM = ctx.earthPos.distanceTo(ctx.moonPos);
      _p0
        .copy(ctx.earthPos)
        .addScaledVector(ctx.padNormal, ctx.earthRadius * 1.455)
        .addScaledVector(_ortho, ctx.earthRadius * 0.56);
      _p1
        .copy(ctx.earthPos)
        .addScaledVector(_dir, distEM * 0.28)
        .addScaledVector(_ortho, distEM * 0.25);
      _p2
        .copy(ctx.moonPos)
        .addScaledVector(_dir, -distEM * 0.24)
        .addScaledVector(_ortho, -distEM * 0.2);
      _p3.copy(ctx.moonPos).addScaledVector(_ortho, ctx.moonRadius * 1.85);
      return cubicBezier(_p0, _p1, _p2, _p3, u, out);
    }

    if (t <= 0.84) {
      const u = (t - 0.62) / 0.22;
      const ang = u * 2.25 * Math.PI * 2;
      const r = ctx.moonRadius * THREE.MathUtils.lerp(1.85, 1.25, u);
      out
        .copy(ctx.moonPos)
        .addScaledVector(_ortho, Math.cos(ang) * r)
        .addScaledVector(_dir, Math.sin(ang) * r);
      return out;
    }

    const u = Math.min(1, (t - 0.84) / 0.12);
    const ease = 1 - Math.pow(1 - u, 2.2);
    const r = ctx.moonRadius * THREE.MathUtils.lerp(1.25, 1.022, ease);
    out.set(ctx.moonPos.x + r * 0.62, ctx.moonPos.y + r * 0.14, ctx.moonPos.z + r * 0.77);
    return out;
  }

  if (missionId === 'mangalyaan') {
    _dir.subVectors(ctx.marsPos, ctx.earthPos).normalize();
    buildOrthonormalBasis(_dir, _ortho, _binorm);

    if (t <= 0.38) {
      const u = (t - 0.14) / 0.24;
      const ang = u * 4 * Math.PI * 2;
      const r = ctx.earthRadius * (1.42 + (0.4 + u * 2.1) * (0.5 - 0.5 * Math.cos(ang)));
      out
        .copy(ctx.earthPos)
        .addScaledVector(_dir, -Math.cos(ang) * r)
        .addScaledVector(_ortho, Math.sin(ang) * r * 0.85);
      return out;
    }

    if (t <= 0.80) {
      const u = (t - 0.38) / 0.42;
      _p0.copy(ctx.earthPos).addScaledVector(_dir, -ctx.earthRadius * 1.42);
      _p1
        .copy(ctx.earthPos)
        .addScaledVector(_dir, 22)
        .addScaledVector(_ortho, 24)
        .addScaledVector(_up, 4.5);
      _p2
        .copy(ctx.marsPos)
        .addScaledVector(_dir, -24)
        .addScaledVector(_ortho, 18)
        .addScaledVector(_up, 3.5);
      _p3.copy(ctx.marsPos).addScaledVector(_ortho, ctx.marsRadius * 2.8);
      return cubicBezier(_p0, _p1, _p2, _p3, u, out);
    }

    const u = (t - 0.80) / 0.20;
    const ang = u * 2.5 * Math.PI * 2;
    const r = ctx.marsRadius * THREE.MathUtils.lerp(2.8, 1.55, u * 0.6);
    out
      .copy(ctx.marsPos)
      .addScaledVector(_ortho, Math.cos(ang) * r)
      .addScaledVector(_dir, Math.sin(ang) * r * 1.25)
      .addScaledVector(_up, Math.sin(ang) * ctx.marsRadius * 0.4);
    return out;
  }

  if (missionId === 'aditya-l1') {
    _dir.subVectors(ctx.sunPos, ctx.earthPos).normalize();
    buildOrthonormalBasis(_dir, _ortho, _binorm);
    const l1Center = _p3.copy(ctx.earthPos).lerp(ctx.sunPos, 0.24);

    if (t <= 0.42) {
      const u = (t - 0.16) / 0.26;
      const ang = u * 3 * Math.PI * 2;
      const r = ctx.earthRadius * (1.42 + (0.35 + u * 1.65) * (0.5 - 0.5 * Math.cos(ang)));
      out
        .copy(ctx.earthPos)
        .addScaledVector(_dir, -Math.cos(ang) * r)
        .addScaledVector(_ortho, Math.sin(ang) * r * 0.85);
      return out;
    }

    if (t <= 0.78) {
      const u = (t - 0.42) / 0.36;
      _p0.copy(ctx.earthPos).addScaledVector(_dir, ctx.earthRadius * 1.45);
      _p1.copy(ctx.earthPos).lerp(l1Center, 0.35).addScaledVector(_ortho, 3.2);
      _p2.copy(ctx.earthPos).lerp(l1Center, 0.78).addScaledVector(_binorm, 2.2);
      _p3.copy(l1Center).addScaledVector(_ortho, 2.4);
      return cubicBezier(_p0, _p1, _p2, _p3, u, out);
    }

    const u = (t - 0.78) / 0.22;
    const ang = u * 1.6 * Math.PI * 2;
    out
      .copy(l1Center)
      .addScaledVector(_ortho, Math.cos(ang) * 2.4)
      .addScaledVector(_binorm, Math.sin(ang) * 1.8);
    return out;
  }

  if (missionId === 'perseverance') {
    _dir.subVectors(ctx.marsPos, ctx.earthPos).normalize();
    buildOrthonormalBasis(_dir, _ortho, _binorm);

    if (t <= 0.78) {
      const u = (t - 0.20) / 0.58;
      _p0.copy(ctx.earthPos).addScaledVector(ctx.padNormal, ctx.earthRadius * 1.455);
      _p1.copy(ctx.earthPos).addScaledVector(_dir, 24).addScaledVector(_ortho, -22);
      _p2.copy(ctx.marsPos).addScaledVector(_dir, -22).addScaledVector(_ortho, -15);
      _p3.copy(ctx.marsPos).addScaledVector(_ortho, ctx.marsRadius * 2.1);
      return cubicBezier(_p0, _p1, _p2, _p3, u, out);
    }

    const u = Math.min(1, (t - 0.78) / 0.16);
    const ease = 1 - Math.pow(1 - u, 2.2);
    const r = ctx.marsRadius * THREE.MathUtils.lerp(2.1, 1.025, ease);
    out.set(
      ctx.marsPos.x + r * 0.78,
      ctx.marsPos.y + r * 0.42,
      ctx.marsPos.z + r * 0.46,
    );
    return out;
  }

  // Voyager Grand Tour
  if (t <= 0.52) {
    const u = (t - 0.18) / 0.34;
    _dir.subVectors(ctx.jupiterPos, ctx.earthPos).normalize();
    buildOrthonormalBasis(_dir, _ortho, _binorm);
    _p0.copy(ctx.earthPos).addScaledVector(ctx.padNormal, ctx.earthRadius * 1.455);
    _p1.copy(ctx.earthPos).addScaledVector(_dir, 32).addScaledVector(_ortho, 28);
    _p2.copy(ctx.jupiterPos).addScaledVector(_dir, -28).addScaledVector(_ortho, -18);
    _p3.copy(ctx.jupiterPos).addScaledVector(_ortho, ctx.jupiterRadius * 1.85);
    return cubicBezier(_p0, _p1, _p2, _p3, u, out);
  }

  if (t <= 0.82) {
    const u = (t - 0.52) / 0.30;
    _dir.subVectors(ctx.saturnPos, ctx.jupiterPos).normalize();
    buildOrthonormalBasis(_dir, _ortho, _binorm);
    _p0.copy(ctx.jupiterPos).addScaledVector(_ortho, ctx.jupiterRadius * 1.85);
    _p1.copy(ctx.jupiterPos).addScaledVector(_dir, 36).addScaledVector(_ortho, -26);
    _p2.copy(ctx.saturnPos).addScaledVector(_dir, -34).addScaledVector(_ortho, 24);
    _p3
      .copy(ctx.saturnPos)
      .addScaledVector(_ortho, ctx.saturnRadius * 2.55)
      .addScaledVector(_up, ctx.saturnRadius * 0.7);
    return cubicBezier(_p0, _p1, _p2, _p3, u, out);
  }

  const u = (t - 0.82) / 0.18;
  _dir.subVectors(ctx.saturnPos, ctx.sunPos).normalize();
  buildOrthonormalBasis(_dir, _ortho, _binorm);
  out
    .copy(ctx.saturnPos)
    .addScaledVector(_ortho, ctx.saturnRadius * 2.55)
    .addScaledVector(_dir, u * 115)
    .addScaledVector(_up, ctx.saturnRadius * 0.7 + u * 48);
  return out;
}

export interface LaunchpadAssembly {
  root: THREE.Group;
  umbilicalArm1: THREE.Mesh;
  umbilicalArm2: THREE.Mesh;
  smokeCloud: THREE.Group;
  smokePuffs: THREE.Mesh[];
  padBeacon: THREE.Mesh;
}

export function createLaunchpadAssembly(
  track: <T extends { dispose: () => void }>(r: T) => T,
): LaunchpadAssembly {
  const root = new THREE.Group();

  // Orient pad tower along +Z so root.lookAt(outwardNormal) points tower UP from Earth's surface
  const padLocal = new THREE.Group();
  padLocal.rotation.x = Math.PI / 2;
  root.add(padLocal);

  const concreteMat = track(
    new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.9, metalness: 0.1 }),
  );
  const darkTrenchMat = track(
    new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.95, metalness: 0.2 }),
  );
  const towerMat = track(
    new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.5, metalness: 0.65 }),
  );
  const armMat = track(
    new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.4, metalness: 0.75 }),
  );

  // Concrete Launch Complex Apron & Flame Deflector
  const apron = new THREE.Mesh(track(new THREE.CylinderGeometry(0.11, 0.13, 0.012, 24)), concreteMat);
  apron.position.y = 0.004;
  const pedestal = new THREE.Mesh(track(new THREE.BoxGeometry(0.055, 0.018, 0.055)), darkTrenchMat);
  pedestal.position.y = 0.014;
  padLocal.add(apron, pedestal);

  // Tall Red/Steel Umbilical Service Tower beside the Rocket
  const towerBase = new THREE.Mesh(track(new THREE.BoxGeometry(0.032, 0.2, 0.032)), towerMat);
  towerBase.position.set(-0.048, 0.105, 0);
  const towerMast = new THREE.Mesh(track(new THREE.BoxGeometry(0.014, 0.05, 0.014)), armMat);
  towerMast.position.set(-0.048, 0.225, 0);
  padLocal.add(towerBase, towerMast);

  // Two animated umbilical swing arms connecting tower -> rocket
  const armGeo = track(new THREE.BoxGeometry(0.046, 0.008, 0.008));
  armGeo.translate(0.023, 0, 0); // pivot from tower side!
  const umbilicalArm1 = new THREE.Mesh(armGeo, armMat);
  umbilicalArm1.position.set(-0.036, 0.145, 0);
  const umbilicalArm2 = new THREE.Mesh(armGeo, armMat);
  umbilicalArm2.position.set(-0.036, 0.095, 0);
  padLocal.add(umbilicalArm1, umbilicalArm2);

  // Glowing Cyan/Amber Launchpad Floodlight Ring
  const padBeacon = new THREE.Mesh(
    track(new THREE.RingGeometry(0.045, 0.075, 24)),
    track(
      new THREE.MeshBasicMaterial({
        color: 0xf59e0b,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.78,
      }),
    ),
  );
  padBeacon.rotation.x = Math.PI / 2;
  padBeacon.position.y = 0.012;
  padLocal.add(padBeacon);

  // Ignition Exhaust Fire & Smoke Cloud Ring (expands at T-2s -> Lift-Off!)
  const smokeCloud = new THREE.Group();
  smokeCloud.position.y = 0.016;
  const smokePuffs: THREE.Mesh[] = [];
  const puffGeo = track(new THREE.SphereGeometry(0.028, 12, 12));
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const puffMat = track(
      new THREE.MeshBasicMaterial({
        color: i % 2 === 0 ? 0xfbbf24 : 0xe2e8f0,
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
      }),
    );
    const puff = new THREE.Mesh(puffGeo, puffMat);
    puff.position.set(Math.cos(a) * 0.032, 0, Math.sin(a) * 0.032);
    smokeCloud.add(puff);
    smokePuffs.push(puff);
  }
  smokeCloud.visible = false;
  padLocal.add(smokeCloud);

  return { root, umbilicalArm1, umbilicalArm2, smokeCloud, smokePuffs, padBeacon };
}

export interface RocketAssembly {
  root: THREE.Group;
  coreStageGroup: THREE.Group;
  boosterL: THREE.Group;
  boosterR: THREE.Group;
  fairingL: THREE.Mesh;
  fairingR: THREE.Mesh;
  spacecraftGroup: THREE.Group;
  solarWings: THREE.Group;
  landerLegs: THREE.Group;
  roverMesh: THREE.Group;
  plume: THREE.Group;
  dustRing: THREE.Mesh;
  accentBandMat: THREE.MeshStandardMaterial;
}

export function createRocketAssembly(
  track: <T extends { dispose: () => void }>(r: T) => T,
): RocketAssembly {
  const root = new THREE.Group();
  const body = new THREE.Group();
  // Orient nose along +Z so rocket.lookAt(nextPos) points nose forward along velocity!
  body.rotation.x = Math.PI / 2;
  root.add(body);

  const whiteMat = track(
    new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.3, metalness: 0.35 }),
  );
  const cryoMat = track(
    new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.42, metalness: 0.45 }),
  );
  const goldFoilMat = track(
    new THREE.MeshStandardMaterial({ color: 0xfbbf24, roughness: 0.28, metalness: 0.88 }),
  );
  const accentBandMat = track(
    new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.35, metalness: 0.5 }),
  );
  const darkMetal = track(
    new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.4, metalness: 0.85 }),
  );
  const solarMat = track(
    new THREE.MeshStandardMaterial({ color: 0x1d4ed8, roughness: 0.25, metalness: 0.65 }),
  );

  // Core Rocket Stage (sheds once entering lunar/interplanetary final stage!)
  const coreStageGroup = new THREE.Group();
  const coreTank = new THREE.Mesh(
    track(new THREE.CylinderGeometry(0.048, 0.054, 0.28, 18)),
    whiteMat,
  );
  coreTank.position.y = -0.02;
  const tankBand = new THREE.Mesh(
    track(new THREE.CylinderGeometry(0.049, 0.049, 0.08, 18)),
    accentBandMat,
  );
  tankBand.position.y = 0.03;
  const nozzle = new THREE.Mesh(
    track(new THREE.CylinderGeometry(0.022, 0.042, 0.055, 14)),
    darkMetal,
  );
  nozzle.position.y = -0.185;
  coreStageGroup.add(coreTank, tankBand, nozzle);
  body.add(coreStageGroup);

  // Separable Left & Right Solid Strap-on Boosters (S200 / SRBs)
  const makeBooster = (side: number) => {
    const g = new THREE.Group();
    const cyl = new THREE.Mesh(
      track(new THREE.CylinderGeometry(0.024, 0.026, 0.21, 14)),
      whiteMat,
    );
    const cap = new THREE.Mesh(track(new THREE.ConeGeometry(0.024, 0.05, 14)), accentBandMat);
    cap.position.y = 0.13;
    const bNoz = new THREE.Mesh(
      track(new THREE.CylinderGeometry(0.014, 0.022, 0.03, 12)),
      darkMetal,
    );
    bNoz.position.y = -0.115;
    g.add(cyl, cap, bNoz);
    g.position.set(side * 0.078, -0.055, 0);
    return g;
  };
  const boosterL = makeBooster(-1);
  const boosterR = makeBooster(1);
  body.add(boosterL, boosterR);

  // Separable Two-Half Payload Fairing (splits open once above atmosphere!)
  const fairingGeoL = track(
    new THREE.ConeGeometry(0.052, 0.145, 16, 1, false, Math.PI * 0.5, Math.PI),
  );
  const fairingGeoR = track(
    new THREE.ConeGeometry(0.052, 0.145, 16, 1, false, -Math.PI * 0.5, Math.PI),
  );
  const fairingL = new THREE.Mesh(fairingGeoL, whiteMat);
  fairingL.position.y = 0.185;
  const fairingR = new THREE.Mesh(fairingGeoR, whiteMat);
  fairingR.position.y = 0.185;
  body.add(fairingL, fairingR);

  // Inner Spacecraft / Gold Foil Lander (Vikram / Eagle / Perseverance / Probe)
  const spacecraftGroup = new THREE.Group();
  spacecraftGroup.position.y = 0.155;
  const goldBus = new THREE.Mesh(track(new THREE.BoxGeometry(0.056, 0.058, 0.056)), goldFoilMat);
  const dishGeo = track(
    new THREE.SphereGeometry(0.026, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.45),
  );
  const dish = new THREE.Mesh(dishGeo, cryoMat);
  dish.rotation.x = Math.PI;
  dish.position.y = 0.044;
  spacecraftGroup.add(goldBus, dish);

  // Deployable Solar Arrays
  const solarWings = new THREE.Group();
  const wingGeo = track(new THREE.BoxGeometry(0.22, 0.005, 0.058));
  const wingL = new THREE.Mesh(wingGeo, solarMat);
  wingL.position.set(-0.145, 0, 0);
  const wingR = new THREE.Mesh(wingGeo, solarMat);
  wingR.position.set(0.145, 0, 0);
  solarWings.add(wingL, wingR);
  spacecraftGroup.add(solarWings);

  // 4 Unfolding Landing Legs (for Moon / Mars touchdown!)
  const landerLegs = new THREE.Group();
  const legGeo = track(new THREE.CylinderGeometry(0.004, 0.004, 0.055, 8));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI * 0.25;
    const leg = new THREE.Mesh(legGeo, darkMetal);
    leg.position.set(Math.cos(a) * 0.042, -0.036, Math.sin(a) * 0.042);
    leg.rotation.z = Math.cos(a) * 0.48;
    leg.rotation.x = -Math.sin(a) * 0.48;
    landerLegs.add(leg);
  }
  landerLegs.visible = false;
  spacecraftGroup.add(landerLegs);

  // Pragyan / Mars Rover that rolls out after touchdown!
  const roverMesh = new THREE.Group();
  const rBody = new THREE.Mesh(track(new THREE.BoxGeometry(0.032, 0.014, 0.024)), goldFoilMat);
  const rSolar = new THREE.Mesh(track(new THREE.BoxGeometry(0.036, 0.003, 0.028)), solarMat);
  rSolar.position.y = 0.01;
  const wheelGeo = track(new THREE.CylinderGeometry(0.006, 0.006, 0.004, 10));
  for (const wx of [-0.012, 0, 0.012]) {
    for (const wz of [-0.014, 0.014]) {
      const w = new THREE.Mesh(wheelGeo, darkMetal);
      w.rotation.x = Math.PI / 2;
      w.position.set(wx, -0.009, wz);
      roverMesh.add(w);
    }
  }
  roverMesh.add(rBody, rSolar);
  roverMesh.position.set(0, -0.045, 0.08);
  roverMesh.visible = false;
  spacecraftGroup.add(roverMesh);

  body.add(spacecraftGroup);

  // Exhaust Plume
  const plume = new THREE.Group();
  plume.position.y = -0.21;
  const innerPlume = new THREE.Mesh(
    track(new THREE.ConeGeometry(0.038, 0.34, 14)),
    track(
      new THREE.MeshBasicMaterial({
        color: 0xe0f2fe,
        transparent: true,
        opacity: 0.94,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    ),
  );
  innerPlume.rotation.x = Math.PI;
  innerPlume.position.y = -0.17;

  const outerPlume = new THREE.Mesh(
    track(new THREE.ConeGeometry(0.072, 0.54, 14)),
    track(
      new THREE.MeshBasicMaterial({
        color: 0xf97316,
        transparent: true,
        opacity: 0.62,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    ),
  );
  outerPlume.rotation.x = Math.PI;
  outerPlume.position.y = -0.27;
  plume.add(innerPlume, outerPlume);
  body.add(plume);

  // Touchdown Lunar Dust Plume Ring
  const dustRing = new THREE.Mesh(
    track(new THREE.RingGeometry(0.04, 0.14, 24)),
    track(
      new THREE.MeshBasicMaterial({
        color: 0xe2e8f0,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      }),
    ),
  );
  dustRing.rotation.x = Math.PI / 2;
  dustRing.position.y = 0.08;
  dustRing.visible = false;
  body.add(dustRing);

  return {
    root,
    coreStageGroup,
    boosterL,
    boosterR,
    fairingL,
    fairingR,
    spacecraftGroup,
    solarWings,
    landerLegs,
    roverMesh,
    plume,
    dustRing,
    accentBandMat,
  };
}
