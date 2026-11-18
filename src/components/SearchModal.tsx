import React, { useEffect, useState } from 'react';
import { Globe, MapPin, Search, Sparkles, X } from 'lucide-react';
import { CELESTIAL_BODIES, EARTH_LANDMARKS } from '../universe/celestialData';
import type { CelestialBodyId, GeocodeResult } from '../types';

interface SearchModalProps {
  open: boolean;
  onClose: () => void;
  onSelectBody: (id: CelestialBodyId) => void;
  onSelectEarthLocation: (lat: number, lng: number, zoom: number, label: string) => void;
}

export const SearchModal: React.FC<SearchModalProps> = ({
  open,
  onClose,
  onSelectBody,
  onSelectEarthLocation,
}) => {
  const [query, setQuery] = useState('');
  const [earthResults, setEarthResults] = useState<GeocodeResult[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!open || trimmed.length < 2) {
      setEarthResults([]);
      return;
    }

    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/geocode?q=${encodeURIComponent(trimmed)}`);
        if (res.ok) {
          const data = (await res.json()) as { results?: GeocodeResult[] };
          setEarthResults(data.results ?? []);
        }
      } catch {
        setEarthResults([]);
      } finally {
        setLoading(false);
      }
    }, 280);

    return () => window.clearTimeout(timer);
  }, [query, open]);

  if (!open) return null;

  const qLower = query.trim().toLowerCase();
  const matchedBodies = CELESTIAL_BODIES.filter(
    (b) =>
      !qLower ||
      b.name.toLowerCase().includes(qLower) ||
      b.hindiName.toLowerCase().includes(qLower) ||
      b.category.toLowerCase().includes(qLower),
  );

  const matchedLandmarks = EARTH_LANDMARKS.filter(
    (l) =>
      !qLower ||
      l.name.toLowerCase().includes(qLower) ||
      l.region.toLowerCase().includes(qLower),
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-16 px-4 bg-black/70"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-[#0B101E] border border-white/15 rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Input Row */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10">
          <Search className="w-4 h-4 text-cyan-400 shrink-0" />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search planet, galaxy, city, village, or street address..."
            className="w-full bg-transparent text-sm text-white placeholder:text-slate-400 focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close search"
            className="p-1 text-slate-400 hover:text-white rounded cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Results */}
        <div className="max-h-[65vh] overflow-y-auto cosmic-scroll p-3 space-y-4">
          {/* Live Earth Address / Place Results */}
          {qLower.length >= 2 && (
            <div>
              <div className="flex items-center justify-between px-2 pb-1.5 text-[11px] font-medium text-slate-400">
                <span>Earth Locations &amp; Streets</span>
                {loading && <span className="text-cyan-400">Searching...</span>}
              </div>
              {earthResults.length > 0 ? (
                <div className="space-y-1">
                  {earthResults.map((place, idx) => (
                    <button
                      key={`${place.lat}-${place.lng}-${idx}`}
                      type="button"
                      onClick={() => {
                        onSelectEarthLocation(place.lat, place.lng, place.zoomHint, place.name);
                        onClose();
                      }}
                      className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/6 flex items-start gap-2.5 transition-colors cursor-pointer"
                    >
                      <MapPin className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-slate-100 truncate">{place.name}</div>
                        <div className="text-xs text-slate-400 truncate">{place.displayName}</div>
                      </div>
                      <span className="text-[11px] font-mono text-slate-500 shrink-0">
                        {place.lat.toFixed(2)}, {place.lng.toFixed(2)}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                !loading && (
                  <p className="px-3 py-1.5 text-xs text-slate-500">
                    No matching street results found — select a landmark or celestial body below.
                  </p>
                )
              )}
            </div>
          )}

          {/* Celestial Bodies */}
          {matchedBodies.length > 0 && (
            <div>
              <div className="px-2 pb-1.5 text-[11px] font-medium text-slate-400">
                Universe, Galaxies &amp; Solar System
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {matchedBodies.slice(0, 10).map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => {
                      onSelectBody(b.id);
                      onClose();
                    }}
                    className="px-3 py-2 rounded-lg bg-slate-900/75 border border-white/8 hover:border-cyan-400/45 text-left flex items-center justify-between gap-2 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <Sparkles className="w-3.5 h-3.5 shrink-0" style={{ color: b.accentColor }} />
                      <div className="truncate">
                        <div className="text-xs font-medium text-slate-100 truncate">
                          {b.name} · <span className="text-slate-400">{b.hindiName}</span>
                        </div>
                        <div className="text-[11px] text-slate-400">{b.category}</div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Famous Earth Landmarks */}
          {matchedLandmarks.length > 0 && (
            <div>
              <div className="px-2 pb-1.5 text-[11px] font-medium text-slate-400">
                Earth Surface Landmarks (House-Level Zoom)
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {matchedLandmarks.map((lm) => (
                  <button
                    key={lm.id}
                    type="button"
                    onClick={() => {
                      onSelectEarthLocation(lm.lat, lm.lng, lm.zoom, lm.name);
                      onClose();
                    }}
                    className="px-3 py-2 rounded-lg bg-slate-900/75 border border-white/8 hover:border-cyan-400/45 text-left flex items-center gap-2 transition-colors cursor-pointer"
                  >
                    <Globe className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-slate-100 truncate">{lm.name}</div>
                      <div className="text-[11px] text-slate-400">{lm.region}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
