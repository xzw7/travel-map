import React, { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Fix default marker icon paths for webpack/vite
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

const CHINA_GEOJSON_URL = `${import.meta.env.BASE_URL}china-cities.geojson`;
const GD_DISTRICT_GEOJSON_URL = `${import.meta.env.BASE_URL}maps/440000_districts.json`;
const DISTRICT_ZOOM_THRESHOLD = 8;

// Guangdong bounds for auto-switching
const GD_BOUNDS = L.latLngBounds([20.2, 109.5], [25.5, 117.3]);

function hexToRgb(hex) {
  const n = hex.replace("#", "");
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
}

function getProvinceColor(province, provinceColors) {
  return provinceColors[province] || "#ee8f76";
}

function mixColor(color, ratio) {
  const from = hexToRgb(color);
  const to = [255, 244, 219];
  const r = Math.round(from[0] * (1 - ratio) + to[0] * ratio);
  const g = Math.round(from[1] * (1 - ratio) + to[1] * ratio);
  const b = Math.round(from[2] * (1 - ratio) + to[2] * ratio);
  return `rgb(${r},${g},${b})`;
}

function createPulseIcon(color) {
  return L.divIcon({
    className: "pulse-marker",
    html: `<div class="pulse-dot" style="background:${color};box-shadow:0 0 12px ${color}"></div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -14],
  });
}

function MapView({ allTrips, provinceColors, selectedTripId, onTripSelect }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const cityLayerRef = useRef(null);
  const districtLayerRef = useRef(null);
  const markersRef = useRef([]);

  const modeRef = useRef("city");

  // Pre-build trip lookup Map for O(1) access
  const tripByCity = useRef(new Map());
  useEffect(() => {
    const map = new Map();
    for (const trip of allTrips) {
      map.set(trip.city, trip);
    }
    tripByCity.current = map;
  }, [allTrips]);

  // Pre-build Guangdong district lookup
  const tripByDistrict = useRef(new Map());
  useEffect(() => {
    const map = new Map();
    for (const trip of allTrips) {
      if (trip.province === "广东省" && trip.district) {
        map.set(trip.district, trip);
      }
      if (trip.province === "广东省") {
        map.set(trip.city, trip);
      }
    }
    tripByDistrict.current = map;
  }, [allTrips]);

  function styleCityFeature(feature) {
    const trip = tripByCity.current.get(feature.properties?.name);
    if (!trip) {
      return {
        fillColor: "#dbd8d1",
        color: "#c4bfb6",
        weight: 0.8,
        fillOpacity: 0.7,
      };
    }
    const color = getProvinceColor(trip.province, provinceColors);
    return {
      fillColor: mixColor(color, 0.15),
      color: mixColor(color, 0.05),
      weight: 1.2,
      fillOpacity: 0.8,
    };
  }

  function styleDistrictFeature(feature) {
    const name = feature.properties?.name;
    const trip = tripByDistrict.current.get(name);
    if (!trip) {
      return {
        fillColor: "#dbd8d1",
        color: "#c4bfb6",
        weight: 0.5,
        fillOpacity: 0.5,
      };
    }
    const color = getProvinceColor("广东省", provinceColors);
    return {
      fillColor: mixColor(color, 0.12),
      color: mixColor(color, 0.05),
      weight: 1,
      fillOpacity: 0.75,
    };
  }

  function addCityLayer(map, geoJson) {
    if (cityLayerRef.current) {
      map.removeLayer(cityLayerRef.current);
    }
    const layer = L.geoJSON(geoJson, {
      style: styleCityFeature,
      onEachFeature: (feature, lyr) => {
        const trip = tripByCity.current.get(feature.properties?.name);
        if (trip) {
          const loc = trip.district
            ? `${trip.district}, ${trip.city}`
            : trip.city;
          lyr.bindTooltip(`${loc}<br/>${trip.province}`, {
            sticky: true,
            className: "map-tooltip",
          });
        }
      },
    });
    layer.addTo(map);
    cityLayerRef.current = layer;
  }

  function addDistrictLayer(map, geoJson) {
    if (districtLayerRef.current) {
      map.removeLayer(districtLayerRef.current);
    }
    const layer = L.geoJSON(geoJson, {
      style: styleDistrictFeature,
      onEachFeature: (feature, lyr) => {
        const name = feature.properties?.name;
        const trip = tripByDistrict.current.get(name);
        if (trip) {
          lyr.bindTooltip(name, { sticky: true, className: "map-tooltip" });
        }
      },
    });
    layer.addTo(map);
    districtLayerRef.current = layer;
  }

  function updateMarkers(map) {
    // Remove old markers
    markersRef.current.forEach((m) => map.removeLayer(m));
    markersRef.current = [];

    allTrips.forEach((trip) => {
      const color = getProvinceColor(trip.province, provinceColors);
      const icon = createPulseIcon(color);
      const marker = L.marker([trip.coords[1], trip.coords[0]], {
        icon,
        zIndexOffset: trip.id === selectedTripId ? 1000 : 100,
      });

      const loc = trip.district ? `${trip.district}, ${trip.city}` : trip.city;
      marker.bindTooltip(`${loc}<br/>${trip.province}`, {
        permanent: false,
        className: "map-tooltip",
      });

      marker.on("click", () => {
        if (onTripSelect) onTripSelect(trip.id);
      });

      marker.addTo(map);
      markersRef.current.push(marker);
    });
  }

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [35.86, 104.19],
      zoom: 5,
      zoomControl: true,
      attributionControl: false,
      maxZoom: 18,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
    }).addTo(map);

    mapRef.current = map;

    // Click on map background deselects trip
    map.on("click", (e) => {
      // Only deselect if clicking directly on the map, not on a marker/geo layer
      if (e.originalEvent.target === containerRef.current || e.originalEvent.target.classList.contains("leaflet-container")) {
        if (onTripSelect) onTripSelect(null);
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
      cityLayerRef.current = null;
      districtLayerRef.current = null;
    };
  }, []);

  // Load GeoJSON and markers when trips change
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    let cancelled = false;

    async function load() {
      try {
        const [cityRes, districtRes] = await Promise.all([
          fetch(CHINA_GEOJSON_URL),
          fetch(GD_DISTRICT_GEOJSON_URL),
        ]);
        const [cityGeoJson, districtGeoJson] = await Promise.all([
          cityRes.json(),
          districtRes.json(),
        ]);
        if (cancelled) return;

        addCityLayer(map, cityGeoJson);
        updateMarkers(map);

        // Zoom-based layer switching
        function onZoomEnd() {
          const zoom = map.getZoom();
          const center = map.getCenter();
          const inGD = GD_BOUNDS.contains(center);
          const shouldShowDistrict = inGD && zoom >= DISTRICT_ZOOM_THRESHOLD;

          if (shouldShowDistrict && modeRef.current !== "district") {
            modeRef.current = "district";
            if (cityLayerRef.current) {
              map.removeLayer(cityLayerRef.current);
              cityLayerRef.current = null;
            }
            addDistrictLayer(map, districtGeoJson);
          } else if (!shouldShowDistrict && modeRef.current !== "city") {
            modeRef.current = "city";
            if (districtLayerRef.current) {
              map.removeLayer(districtLayerRef.current);
              districtLayerRef.current = null;
            }
            addCityLayer(map, cityGeoJson);
          }
        }

        map.on("zoomend", onZoomEnd);
        map.on("moveend", onZoomEnd);

        return () => {
          map.off("zoomend", onZoomEnd);
          map.off("moveend", onZoomEnd);
        };
      } catch (err) {
        console.error("Failed to load map data:", err);
      }
    }

    const cleanup = load();

    return () => {
      cancelled = true;
      if (typeof cleanup?.then === "function") {
        cleanup.then((fn) => fn?.());
      }
    };
  }, [allTrips]);

  // Update markers when selected trip or trips change
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    updateMarkers(map);
  }, [allTrips, selectedTripId, onTripSelect]);

  return <div ref={containerRef} className="leaflet-map-container" />;
}

export default React.memo(MapView);
