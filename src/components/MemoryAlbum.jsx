import React, { useMemo } from "react";

function resolveAssetPath(assetPath) {
  if (!assetPath) return assetPath;
  if (/^(https?:|data:|blob:)/.test(assetPath)) return assetPath;
  return `${import.meta.env.BASE_URL}${assetPath.replace(/^\/+/, "")}`;
}

export default React.memo(function MemoryAlbum({ allTrips, onClose, onPhotoClick }) {
  const citiesWithPhotos = useMemo(() => {
    return [...allTrips]
      .filter((trip) => trip.photos.length > 0)
      .sort((a, b) => {
        const dateA = a.startDate || "";
        const dateB = b.startDate || "";
        return dateB.localeCompare(dateA);
      });
  }, [allTrips]);

  const totalPhotos = useMemo(
    () => allTrips.reduce((sum, trip) => sum + trip.photos.length, 0),
    [allTrips],
  );

  const handleOverlayClick = (event) => {
    if (event.target === event.currentTarget) onClose();
  };

  return (
    <div className="memory-album-overlay" onClick={handleOverlayClick}>
      <article className="memory-album" onClick={(e) => e.stopPropagation()}>
        <header className="memory-album-header">
          <div>
            <p className="eyebrow">回忆相册</p>
            <h2>按城市整理我们的足迹</h2>
            <span className="memory-album-stats">
              {totalPhotos} 张照片 · {citiesWithPhotos.length} 座城市
            </span>
          </div>
          <button className="memory-album-close" type="button" onClick={onClose} title="关闭">
            关闭
          </button>
        </header>

        {citiesWithPhotos.length === 0 ? (
          <div className="memory-album-empty">
            <p>还没有回忆记录</p>
            <span>
              回到地图，点开一座城市，添加日期、照片和一句话回忆。保存后这里会自动按城市和时间整理。
            </span>
          </div>
        ) : (
          <div className="memory-album-list">
            {citiesWithPhotos.map((trip) => (
              <section key={trip.id} className="memory-city-section">
                <div className="memory-city-head">
                  <div className="memory-city-badge">
                    <strong>
                      {trip.city}
                      {trip.district ? ` · ${trip.district}` : ""}
                    </strong>
                    <span>
                      {trip.province} · {trip.startDate || "待补充"}
                      {trip.endDate && trip.endDate !== trip.startDate
                        ? ` 至 ${trip.endDate}`
                        : ""}
                    </span>
                  </div>
                  <span className="memory-city-count">{trip.photos.length} 张</span>
                </div>

                <div className="memory-photo-grid">
                  {trip.photos.map((photo, idx) => (
                    <figure
                      key={photo.id || idx}
                      className="memory-photo-card"
                      onClick={() => onPhotoClick?.(photo, trip)}
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") onPhotoClick?.(photo, trip);
                      }}
                    >
                      <div className="memory-photo-wrap">
                        <img
                          src={resolveAssetPath(photo.src)}
                          alt={`${trip.city} - ${photo.caption}`}
                          loading="lazy"
                        />
                      </div>
                      <figcaption>
                        <strong>{photo.caption}</strong>
                        <span>{photo.takenAt || trip.startDate || ""}</span>
                      </figcaption>
                    </figure>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </article>
    </div>
  );
});
