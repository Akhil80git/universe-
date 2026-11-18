import * as THREE from 'three';
import { CITY_LIGHT_CLUSTERS, EARTH_CONTINENTS } from './earthContinents';

// Fast deterministic 2D/3D hash & value noise
function hash2(x: number, y: number, seed = 1337): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123;
  return n - Math.floor(n);
}

function noise2(x: number, y: number, seed = 1337): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbm2(x: number, y: number, octaves = 5, seed = 1337): number {
  let val = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    val += amp * noise2(x * freq, y * freq, seed + i * 19);
    freq *= 2.02;
    amp *= 0.5;
  }
  return val;
}

function configureColorTexture(canvas: HTMLCanvasElement, maxAniso: number): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = maxAniso;
  tex.needsUpdate = true;
  return tex;
}

function configureLinearTexture(canvas: HTMLCanvasElement, maxAniso: number): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = maxAniso;
  tex.needsUpdate = true;
  return tex;
}

export interface EarthTextureBundle {
  dayMap: THREE.CanvasTexture;
  nightMap: THREE.CanvasTexture;
  specularMap: THREE.CanvasTexture;
  cloudMap: THREE.CanvasTexture;
}

export function createEarthTextures(maxAniso: number): EarthTextureBundle {
  const w = 1024;
  const h = 512;

  // 1. Land mask canvas using accurate continent polygons
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = w;
  maskCanvas.height = h;
  const maskCtx = maskCanvas.getContext('2d')!;
  maskCtx.fillStyle = '#000000';
  maskCtx.fillRect(0, 0, w, h);

  maskCtx.fillStyle = '#ffffff';
  for (const ring of EARTH_CONTINENTS) {
    maskCtx.beginPath();
    ring.forEach(([lng, lat], idx) => {
      const px = ((lng + 180) / 360) * w;
      const py = ((90 - lat) / 180) * h;
      if (idx === 0) maskCtx.moveTo(px, py);
      else maskCtx.lineTo(px, py);
    });
    maskCtx.closePath();
    maskCtx.fill();
  }
  const maskData = maskCtx.getImageData(0, 0, w, h).data;

  // 2. Day, Night, and Specular canvases
  const dayCanvas = document.createElement('canvas');
  dayCanvas.width = w;
  dayCanvas.height = h;
  const dayCtx = dayCanvas.getContext('2d')!;
  const dayImg = dayCtx.createImageData(w, h);

  const specCanvas = document.createElement('canvas');
  specCanvas.width = w;
  specCanvas.height = h;
  const specCtx = specCanvas.getContext('2d')!;
  const specImg = specCtx.createImageData(w, h);

  for (let y = 0; y < h; y++) {
    const lat = 90 - (y / h) * 180;
    const absLat = Math.abs(lat);
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const lng = (x / w) * 360 - 180;
      const rawMask = maskData[idx] / 255;

      // Subtle fractal coastline perturbation for organic coastal bays
      const u = (x / w) * 10;
      const v = (y / h) * 5;
      const coastNoise = fbm2(u * 2.4, v * 2.4, 4, 404) - 0.5;
      const isLand = rawMask > 0.48 || (rawMask > 0.12 && rawMask + coastNoise * 0.45 > 0.5);

      const elev = fbm2(u * 3.1, v * 3.1, 5, 912);
      const moisture = fbm2(u * 1.9 + 12, v * 1.9 + 7, 4, 521);

      let r = 0;
      let g = 0;
      let b = 0;
      let spec = 0;

      if (absLat > 78 + coastNoise * 6) {
        // Polar ice caps
        r = 228 + elev * 22;
        g = 236 + elev * 16;
        b = 245 + elev * 10;
        spec = 40;
      } else if (!isLand) {
        // Deep ocean + continental shelf turquoise tint
        const shelf = Math.max(0, 1 - Math.abs(rawMask - 0.2) * 3) * 0.35;
        const wave = elev * 14;
        r = 8 + shelf * 24 + wave * 0.3;
        g = 34 + shelf * 75 + wave * 0.6;
        b = 88 + shelf * 70 + wave * 0.8;
        spec = 225;
      } else {
        // Land biomes based on latitude (desert belt ~15-33°, tropical forests near equator, Himalayas)
        const isDesertBelt =
          (absLat > 16 && absLat < 33 && lng > -18 && lng < 65) || // Sahara + Arabia + Thar
          (absLat > 20 && absLat < 32 && lng > 114 && lng < 145) || // Outback
          (absLat > 24 && absLat < 38 && lng > -118 && lng < -102); // SW USA/Mexico
        const isHimalaya = lat > 27 && lat < 38 && lng > 70 && lng < 102;

        if (isHimalaya && elev > 0.52) {
          // Snow-capped Himalayas & Tibetan plateau
          r = 205 + elev * 35;
          g = 210 + elev * 32;
          b = 216 + elev * 30;
        } else if (isDesertBelt && moisture < 0.62) {
          r = 178 + elev * 38;
          g = 148 + elev * 32;
          b = 102 + elev * 24;
        } else if (absLat > 58) {
          // Boreal tundra
          r = 88 + elev * 42;
          g = 104 + elev * 40;
          b = 84 + elev * 28;
        } else if (moisture > 0.45 || absLat < 24) {
          // Lush green forests & plains (India Ganga basin, Amazon, Congo, Europe)
          r = 38 + elev * 46;
          g = 94 + elev * 48;
          b = 44 + elev * 24;
        } else {
          // Savanna / steppe
          r = 112 + elev * 45;
          g = 118 + elev * 35;
          b = 68 + elev * 24;
        }
        spec = 15;
      }

      dayImg.data[idx] = Math.min(255, Math.max(0, r));
      dayImg.data[idx + 1] = Math.min(255, Math.max(0, g));
      dayImg.data[idx + 2] = Math.min(255, Math.max(0, b));
      dayImg.data[idx + 3] = 255;

      specImg.data[idx] = spec;
      specImg.data[idx + 1] = spec;
      specImg.data[idx + 2] = spec;
      specImg.data[idx + 3] = 255;
    }
  }
  dayCtx.putImageData(dayImg, 0, 0);
  specCtx.putImageData(specImg, 0, 0);

  // 3. Night City Lights Canvas
  const nightCanvas = document.createElement('canvas');
  nightCanvas.width = w;
  nightCanvas.height = h;
  const nightCtx = nightCanvas.getContext('2d')!;
  nightCtx.fillStyle = '#000000';
  nightCtx.fillRect(0, 0, w, h);

  for (const [lng, lat, radius, intensity] of CITY_LIGHT_CLUSTERS) {
    const cx = ((lng + 180) / 360) * w;
    const cy = ((90 - lat) / 180) * h;
    const grad = nightCtx.createRadialGradient(cx, cy, 0, cx, cy, radius * 3.2);
    grad.addColorStop(0, `rgba(255, 224, 150, ${intensity})`);
    grad.addColorStop(0.35, `rgba(255, 178, 84, ${intensity * 0.55})`);
    grad.addColorStop(1, 'rgba(255, 140, 40, 0)');
    nightCtx.fillStyle = grad;
    nightCtx.beginPath();
    nightCtx.arc(cx, cy, radius * 3.2, 0, Math.PI * 2);
    nightCtx.fill();

    // Crisp pinpoint urban cluster dots
    for (let s = 0; s < 14; s++) {
      const ang = hash2(cx, s, 88) * Math.PI * 2;
      const dist = hash2(s, cy, 99) * radius * 2.2;
      const dx = cx + Math.cos(ang) * dist;
      const dy = cy + Math.sin(ang) * dist * 0.75;
      nightCtx.fillStyle = `rgba(255, 232, 175, ${0.4 + hash2(dx, dy, 12) * 0.55})`;
      nightCtx.fillRect(dx, dy, 1.3, 1.3);
    }
  }

  // 4. Dynamic Cloud Layer Canvas
  const cloudCanvas = document.createElement('canvas');
  cloudCanvas.width = w;
  cloudCanvas.height = h;
  const cloudCtx = cloudCanvas.getContext('2d')!;
  const cloudImg = cloudCtx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const u = (x / w) * 14;
      const v = (y / h) * 7;
      // Swirl distortion
      const swirl = fbm2(u * 0.7, v * 0.7, 3, 777) * 2.2;
      const n = fbm2(u + swirl, v + swirl * 0.4, 5, 314);
      const alpha = Math.max(0, Math.min(255, (n - 0.49) * 620));
      cloudImg.data[idx] = 248;
      cloudImg.data[idx + 1] = 251;
      cloudImg.data[idx + 2] = 255;
      cloudImg.data[idx + 3] = alpha;
    }
  }
  cloudCtx.putImageData(cloudImg, 0, 0);

  return {
    dayMap: configureColorTexture(dayCanvas, maxAniso),
    nightMap: configureColorTexture(nightCanvas, maxAniso),
    specularMap: configureLinearTexture(specCanvas, maxAniso),
    cloudMap: configureColorTexture(cloudCanvas, maxAniso),
  };
}

export function createCrateredTexture(
  baseRgb: [number, number, number],
  darkRgb: [number, number, number],
  seed: number,
  maxAniso: number,
  craterCount = 180,
): THREE.CanvasTexture {
  const w = 512;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(w, h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const u = (x / w) * 9;
      const v = (y / h) * 4.5;
      const n = fbm2(u, v, 5, seed);
      const mare = fbm2(u * 0.45, v * 0.45, 3, seed + 55);
      const mix = Math.max(0, Math.min(1, (mare - 0.35) * 1.9));
      const grain = (n - 0.5) * 40;
      img.data[idx] = Math.min(255, Math.max(0, darkRgb[0] * (1 - mix) + baseRgb[0] * mix + grain));
      img.data[idx + 1] = Math.min(255, Math.max(0, darkRgb[1] * (1 - mix) + baseRgb[1] * mix + grain));
      img.data[idx + 2] = Math.min(255, Math.max(0, darkRgb[2] * (1 - mix) + baseRgb[2] * mix + grain));
      img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // Overlay impact craters with bright ejecta rims
  for (let i = 0; i < craterCount; i++) {
    const cx = hash2(i, 1, seed) * w;
    const cy = (0.1 + hash2(i, 2, seed) * 0.8) * h;
    const r = 2 + Math.pow(hash2(i, 3, seed), 2.4) * 20;

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${darkRgb[0]}, ${darkRgb[1]}, ${darkRgb[2]}, 0.45)`;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.05, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(245, 245, 250, ${0.14 + hash2(i, 4, seed) * 0.16})`;
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  return configureColorTexture(canvas, maxAniso);
}

export function createMarsTexture(maxAniso: number): THREE.CanvasTexture {
  const w = 512;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(w, h);

  for (let y = 0; y < h; y++) {
    const lat = 90 - (y / h) * 180;
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const u = (x / w) * 8;
      const v = (y / h) * 4;
      const n = fbm2(u, v, 5, 616);
      const basalt = fbm2(u * 0.6 + 4, v * 0.6 + 2, 3, 717);

      let r = 198 + (n - 0.5) * 65 - (basalt > 0.55 ? 48 : 0);
      let g = 96 + (n - 0.5) * 40 - (basalt > 0.55 ? 28 : 0);
      let b = 62 + (n - 0.5) * 28 - (basalt > 0.55 ? 18 : 0);

      // Polar CO2 ice caps
      if (Math.abs(lat) > 81 + (n - 0.5) * 6) {
        r = 238;
        g = 232;
        b = 228;
      }

      img.data[idx] = Math.min(255, Math.max(0, r));
      img.data[idx + 1] = Math.min(255, Math.max(0, g));
      img.data[idx + 2] = Math.min(255, Math.max(0, b));
      img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // Valles Marineris canyon scar
  ctx.strokeStyle = 'rgba(84, 34, 22, 0.55)';
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(w * 0.25, h * 0.54);
  ctx.bezierCurveTo(w * 0.31, h * 0.52, w * 0.36, h * 0.56, w * 0.42, h * 0.53);
  ctx.stroke();

  return configureColorTexture(canvas, maxAniso);
}

export function createGasGiantTexture(
  palette: Array<[number, number, number]>,
  seed: number,
  maxAniso: number,
  withGreatRedSpot = false,
): THREE.CanvasTexture {
  const w = 512;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(w, h);

  for (let y = 0; y < h; y++) {
    const vNorm = y / h;
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const u = (x / w) * 6;
      const v = vNorm * 14;
      const turb = fbm2(u * 1.4, v * 0.8, 4, seed) * 0.12;
      const bandCoord = (vNorm + turb * 0.45) * (palette.length - 1) * 2.2;
      const pIdx = Math.floor(Math.abs(bandCoord)) % palette.length;
      const nextIdx = (pIdx + 1) % palette.length;
      const frac = bandCoord - Math.floor(bandCoord);
      const smooth = frac * frac * (3 - 2 * frac);

      const c1 = palette[pIdx];
      const c2 = palette[nextIdx];
      const fine = (fbm2(u * 3.5, v * 2.2, 3, seed + 22) - 0.5) * 24;

      img.data[idx] = Math.min(255, Math.max(0, c1[0] * (1 - smooth) + c2[0] * smooth + fine));
      img.data[idx + 1] = Math.min(255, Math.max(0, c1[1] * (1 - smooth) + c2[1] * smooth + fine));
      img.data[idx + 2] = Math.min(255, Math.max(0, c1[2] * (1 - smooth) + c2[2] * smooth + fine));
      img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  if (withGreatRedSpot) {
    const gx = w * 0.36;
    const gy = h * 0.62;
    const grad = ctx.createRadialGradient(gx, gy, 2, gx, gy, 24);
    grad.addColorStop(0, 'rgba(196, 78, 52, 0.95)');
    grad.addColorStop(0.55, 'rgba(218, 108, 72, 0.8)');
    grad.addColorStop(1, 'rgba(222, 165, 118, 0)');
    ctx.save();
    ctx.translate(gx, gy);
    ctx.scale(1.5, 0.9);
    ctx.translate(-gx, -gy);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(gx, gy, 24, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  return configureColorTexture(canvas, maxAniso);
}

export function createSaturnRingTexture(maxAniso: number, isUranus = false): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = 32;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, 32);

  for (let x = 0; x < size; x++) {
    const t = x / size; // 0 = inner ring edge, 1 = outer ring edge
    let alpha = 0;
    let r = 215;
    let g = 196;
    let b = 158;

    if (isUranus) {
      alpha = (t > 0.25 && t < 0.35) || (t > 0.65 && t < 0.72) ? 90 : 12;
      r = 165;
      g = 215;
      b = 225;
    } else {
      const ripple = Math.sin(t * 240) * 0.5 + 0.5;
      const ripple2 = Math.sin(t * 95 + 1.3) * 0.5 + 0.5;
      if (t > 0.06 && t < 0.22) {
        // C Ring (faint dusky inner ring)
        alpha = 55 + ripple * 35;
        r = 158;
        g = 142;
        b = 118;
      } else if (t >= 0.22 && t < 0.58) {
        // B Ring (bright dense main ring)
        alpha = 185 + ripple * 55;
        r = 228 + ripple2 * 18;
        g = 205 + ripple2 * 14;
        b = 164 + ripple2 * 10;
      } else if (t >= 0.58 && t < 0.64) {
        // Cassini Division (dark gap)
        alpha = 10;
      } else if (t >= 0.64 && t < 0.92) {
        // A Ring
        alpha = 145 + ripple * 40;
        r = 210 + ripple2 * 15;
        g = 190 + ripple2 * 12;
        b = 156 + ripple2 * 10;
        // Encke gap
        if (t > 0.83 && t < 0.845) alpha = 15;
      }
    }

    for (let y = 0; y < 32; y++) {
      const idx = (y * size + x) * 4;
      img.data[idx] = Math.min(255, r);
      img.data[idx + 1] = Math.min(255, g);
      img.data[idx + 2] = Math.min(255, b);
      img.data[idx + 3] = Math.min(255, Math.max(0, alpha));
    }
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  tex.needsUpdate = true;
  return tex;
}

export function createRadialGlowTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
  grad.addColorStop(0.22, 'rgba(255, 255, 255, 0.8)');
  grad.addColorStop(0.55, 'rgba(255, 255, 255, 0.18)');
  grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}
