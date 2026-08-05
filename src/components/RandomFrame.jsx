import React, { useCallback, useEffect, useMemo, useState } from "react";

function resolveAssetPath(assetPath) {
  if (!assetPath) return assetPath;
  if (/^(https?:|data:|blob:)/.test(assetPath)) return assetPath;
  return `${import.meta.env.BASE_URL}${assetPath.replace(/^\/+/, "")}`;
}

function pickRandomItem(items) {
  if (!items || items.length === 0) return null;
  return items[Math.floor(Math.random() * items.length)];
}

export default React.memo(function RandomFrame({ allTrips }) {
  const allPhotos = useMemo(() => {
    const photos = [];
    for (const trip of allTrips) {
      for (const photo of trip.photos) {
        photos.push({ ...photo, city: trip.city, province: trip.province });
      }
    }
    return photos;
  }, [allTrips]);

  const [selected, setSelected] = useState(null);
  const [isTransitioning, setIsTransitioning] = useState(false);

  const refresh = useCallback(() => {
    if (allPhotos.length === 0) return;
    setIsTransitioning(true);
    setTimeout(() => {
      setSelected(pickRandomItem(allPhotos));
      setIsTransitioning(false);
    }, 300);
  }, [allPhotos]);

  // Pick initial random photo on first load
  useEffect(() => {
    if (allPhotos.length > 0 && !selected) {
      setSelected(pickRandomItem(allPhotos));
    }
  }, [allPhotos, selected]);

  // Auto-refresh every 12 seconds
  useEffect(() => {
    if (allPhotos.length <= 1) return;
    const timer = setInterval(refresh, 12000);
    return () => clearInterval(timer);
  }, [refresh, allPhotos.length]);

  if (allPhotos.length === 0) {
    return (
      <div className="random-frame-card">
        <p className="random-frame-empty">
          点一座城市写回忆后，
          <br />
          这里会随机展示。
        </p>
      </div>
    );
  }

  return (
    <div className="random-frame-card">
      <div className="random-frame-header">
        <span className="random-frame-title">随机相框</span>
        <button
          className="random-frame-refresh"
          type="button"
          onClick={refresh}
          title="换一张"
          disabled={isTransitioning}
        >
          换一张
        </button>
      </div>
      <div className={`random-frame-photo ${isTransitioning ? "is-fading" : ""}`}>
        {selected && (
          <figure>
            <div className="random-frame-img-wrap">
              <img
                src={resolveAssetPath(selected.src)}
                alt={`${selected.city} - ${selected.caption}`}
              />
            </div>
            <figcaption>
              <strong>{selected.city}</strong>
              <span>{selected.takenAt || "待补充"}</span>
              <small>{selected.caption}</small>
            </figcaption>
          </figure>
        )}
      </div>
    </div>
  );
});
