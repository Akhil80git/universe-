import * as THREE from 'three';

const NOISE_GLSL = `
  vec4 permute(vec4 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

  float snoise(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod(i, 289.0);
    vec4 p = permute(permute(permute(
              i.z + vec4(0.0, i1.z, i2.z, 1.0))
            + i.y + vec4(0.0, i1.y, i2.y, 1.0))
            + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 1.0 / 7.0;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
  }

  float fbm3(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * snoise(p);
      p *= 2.05;
      a *= 0.5;
    }
    return v;
  }
`;

export function createSunMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vPos;
      varying vec3 vViewPos;
      void main() {
        vPos = normalize(position);
        vNormal = normalize(normalMatrix * normal);
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        vViewPos = -mvPos.xyz;
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      varying vec3 vNormal;
      varying vec3 vPos;
      varying vec3 vViewPos;
      ${NOISE_GLSL}
      void main() {
        vec3 p = vPos * 4.2 + vec3(uTime * 0.08, uTime * 0.05, -uTime * 0.06);
        float n1 = fbm3(p);
        float n2 = fbm3(p * 2.3 - vec3(uTime * 0.14));
        float plasma = clamp(0.55 + n1 * 0.5 + n2 * 0.25, 0.0, 1.0);

        vec3 darkSpot = vec3(0.75, 0.22, 0.02);
        vec3 midOrange = vec3(1.0, 0.56, 0.10);
        vec3 hotGold = vec3(1.0, 0.90, 0.55);
        vec3 coreWhite = vec3(1.0, 0.98, 0.92);

        vec3 col = mix(darkSpot, midOrange, smoothstep(0.15, 0.55, plasma));
        col = mix(col, hotGold, smoothstep(0.55, 0.82, plasma));
        col = mix(col, coreWhite, smoothstep(0.82, 0.98, plasma));

        vec3 viewDir = normalize(vViewPos);
        float fresnel = 1.0 - max(0.0, dot(viewDir, vNormal));
        col = mix(col, vec3(1.0, 0.42, 0.08), pow(fresnel, 2.5) * 0.55);
        gl_FragColor = vec4(col * 1.15, 1.0);
      }
    `,
  });
}

export function createAtmosphereMaterial(
  colorHex: number,
  intensity = 0.85,
  power = 3.2,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(colorHex) },
      uIntensity: { value: intensity },
      uPower: { value: power },
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vViewDir;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vViewDir = normalize(-mvPosition.xyz);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uIntensity;
      uniform float uPower;
      varying vec3 vNormal;
      varying vec3 vViewDir;
      void main() {
        // Rendered on BackSide sphere slightly larger than planet
        float dotNV = dot(vNormal, vViewDir);
        float rim = pow(clamp(0.65 - dotNV, 0.0, 1.0), uPower);
        gl_FragColor = vec4(uColor, rim * uIntensity);
      }
    `,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
}

export function createEarthSurfaceMaterial(
  dayMap: THREE.Texture,
  nightMap: THREE.Texture,
  specularMap: THREE.Texture,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uDayMap: { value: dayMap },
      uNightMap: { value: nightMap },
      uSpecularMap: { value: specularMap },
      uSunWorldPos: { value: new THREE.Vector3(0, 0, 0) },
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vWorldNormal;
      varying vec3 vWorldPos;
      void main() {
        vUv = uv;
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPos = worldPos.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: `
      uniform sampler2D uDayMap;
      uniform sampler2D uNightMap;
      uniform sampler2D uSpecularMap;
      uniform vec3 uSunWorldPos;
      varying vec2 vUv;
      varying vec3 vWorldNormal;
      varying vec3 vWorldPos;

      void main() {
        vec3 N = normalize(vWorldNormal);
        vec3 L = normalize(uSunWorldPos - vWorldPos);
        vec3 V = normalize(cameraPosition - vWorldPos);

        float ndotl = dot(N, L);
        float dayFactor = smoothstep(-0.18, 0.28, ndotl);
        float diffuse = max(ndotl, 0.0);

        vec3 dayColor = texture2D(uDayMap, vUv).rgb;
        vec3 nightLights = texture2D(uNightMap, vUv).rgb;
        float oceanMask = texture2D(uSpecularMap, vUv).r;

        // Ocean sun specular glint
        vec3 H = normalize(L + V);
        float spec = pow(max(dot(N, H), 0.0), 42.0) * oceanMask * 0.45 * step(0.0, ndotl);

        // Ambient starlight on night side so continents remain subtly legible
        vec3 litDay = dayColor * (0.14 + diffuse * 1.12) + vec3(0.95, 0.97, 1.0) * spec;
        vec3 darkSide = dayColor * 0.14 + nightLights * (1.0 - dayFactor) * 1.35;

        // Twilight atmospheric scatter tint along terminator
        float terminator = exp(-pow(ndotl * 6.5, 2.0));
        vec3 twilight = vec3(0.95, 0.42, 0.18) * terminator * 0.14;

        // Rayleigh rim scatter on front limb
        float fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.6);
        vec3 scatter = vec3(0.28, 0.64, 1.0) * fresnel * (0.25 + 0.55 * dayFactor);

        vec3 finalColor = mix(darkSide, litDay, dayFactor) + twilight + scatter;
        gl_FragColor = vec4(finalColor, 1.0);
      }
    `,
  });
}

export function createAccretionDiskMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vPos;
      void main() {
        vUv = uv;
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      varying vec2 vUv;
      varying vec3 vPos;
      ${NOISE_GLSL}
      void main() {
        float r = length(vPos.xy);
        float normR = clamp((r - 1.0) / 3.4, 0.0, 1.0);
        float angle = atan(vPos.y, vPos.x);
        float spiral = angle + 4.5 / (normR + 0.25) - uTime * 1.6;
        float n = fbm3(vec3(cos(spiral) * 2.5, sin(spiral) * 2.5, normR * 5.0 - uTime * 0.4));

        float ringBand = smoothstep(0.0, 0.12, normR) * (1.0 - smoothstep(0.55, 1.0, normR));
        float streaks = 0.55 + 0.45 * sin(spiral * 3.0 + n * 4.0);

        // Relativistic Doppler beaming (brighter on approaching left side)
        float doppler = 0.78 + 0.35 * cos(angle - 0.6);

        vec3 innerHot = vec3(1.0, 0.94, 0.78);
        vec3 midAmber = vec3(1.0, 0.48, 0.12);
        vec3 outerCrimson = vec3(0.65, 0.12, 0.08);

        vec3 col = mix(innerHot, midAmber, smoothstep(0.05, 0.45, normR));
        col = mix(col, outerCrimson, smoothstep(0.45, 0.95, normR));

        float alpha = ringBand * streaks * (0.65 + 0.35 * n) * doppler;
        gl_FragColor = vec4(col * 1.35 * doppler, clamp(alpha, 0.0, 0.95));
      }
    `,
    transparent: true,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

export function createStarfieldMaterial(baseSize = 1.0): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uPixelRatio: { value: 1 },
      uBaseSize: { value: baseSize },
    },
    vertexShader: `
      attribute float aSize;
      attribute vec3 aColor;
      varying vec3 vColor;
      uniform float uPixelRatio;
      uniform float uBaseSize;
      void main() {
        vColor = aColor;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        float dist = max(1.0, -mvPosition.z);
        gl_PointSize = clamp(aSize * uBaseSize * uPixelRatio * (340.0 / dist), 1.2, 22.0);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      void main() {
        vec2 c = gl_PointCoord - vec2(0.5);
        float d = length(c) * 2.0;
        if (d > 1.0) discard;
        float core = exp(-d * d * 5.2);
        float halo = exp(-d * 2.4) * 0.45;
        float alpha = clamp(core + halo, 0.0, 1.0);
        gl_FragColor = vec4(vColor * (0.85 + core * 0.65), alpha);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

export function createAuroraMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vNormal;
      void main() {
        vUv = uv;
        vNormal = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      varying vec2 vUv;
      varying vec3 vNormal;
      void main() {
        // Focus aurora ovals around +/- 65 to 78 degrees latitude
        float lat = (vUv.y - 0.5) * 3.14159265;
        float absLat = abs(lat);
        float ring = exp(-pow((absLat - 1.24) * 9.5, 2.0));
        float wave = sin(vUv.x * 38.0 + uTime * 1.4) * 0.5 + 0.5;
        float shimmer = sin(vUv.x * 76.0 - uTime * 2.3) * 0.5 + 0.5;
        float curtain = ring * (0.35 + 0.65 * wave * shimmer);

        vec3 emerald = vec3(0.18, 0.96, 0.58);
        vec3 violet = vec3(0.55, 0.28, 0.95);
        vec3 col = mix(emerald, violet, shimmer * 0.45);
        gl_FragColor = vec4(col, curtain * 0.52);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

export function createCometTailMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        // vUv.y = 1 at tip (nucleus), 0 at base (far end)
        float along = pow(vUv.y, 1.6);
        float streak = 0.72 + 0.28 * sin(vUv.x * 24.0 + uTime * 3.0);
        vec3 col = mix(vec3(0.22, 0.68, 1.0), vec3(0.92, 0.98, 1.0), vUv.y);
        gl_FragColor = vec4(col, along * streak * 0.68);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}
