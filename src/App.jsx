import React, { useCallback, useEffect, useMemo, useState } from "react";
import exifr from "exifr";
import BounceCards from "./components/BounceCards";
import GrainientBackground from "./components/GrainientBackground";
import TextPressure from "./components/TextPressure";
import MapView from "./components/MapView";
import RandomFrame from "./components/RandomFrame";
import MemoryAlbum from "./components/MemoryAlbum";
import cityOptions from "./data/cityOptions.json";
import travels from "./data/travels.json";
import {
  fetchRemotePhotoMetadata,
  fetchPhotoDataByIds,
  buildUploadsFromMeta,
  uploadPhotoToRemote,
  deleteRemotePhoto,
  deleteRemoteTrip,
  mergeRemoteIntoLocal,
} from "./lib/sync";

const UPLOAD_STORAGE_KEY = "travel-map-local-uploads";
const UPLOAD_AUTH_KEY = "travel-map-upload-unlocked";
const DELETED_TRIPS_KEY = "travel-map-deleted-trips";
const TRIP_EDITS_KEY = "travel-map-trip-edits";
const UPLOAD_PASSWORD_HASH = "88343e81a6987590af0c445b235dbb8561a8d46befd16d37bb4b87a503f52932";
const PROVINCE_OPTIONS = cityOptions;

const sortedTravels = [...travels].sort((left, right) =>
  `${right.startDate || ""}${right.endDate || ""}`.localeCompare(
    `${left.startDate || ""}${left.endDate || ""}`,
  ),
);

function formatDateRange(startDate, endDate) {
  if (!startDate) return "待补充";
  if (!endDate || endDate === startDate) return startDate;
  return `${startDate} - ${endDate}`;
}

function formatDisplayDate(dateText) {
  if (!dateText) return "待补充";
  const date = new Date(dateText);
  if (Number.isNaN(date.getTime())) return dateText;

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

function toDateTimeText(date) {
  if (!date) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

function resolveAssetPath(assetPath) {
  if (!assetPath) return assetPath;
  if (/^(https?:|data:|blob:)/.test(assetPath)) return assetPath;
  return `${import.meta.env.BASE_URL}${assetPath.replace(/^\/+/, "")}`;
}

function collectStats(items) {
  const citySet = new Set(items.map((item) => item.city));
  const provinceSet = new Set(items.map((item) => item.province));
  const districtCount = items.filter((item) => item.district).length;
  const totalPhotos = items.reduce((sum, item) => sum + item.photos.length, 0);

  return {
    cities: citySet.size,
    provinces: provinceSet.size,
    districts: districtCount,
    totalTrips: items.length,
    totalPhotos,
  };
}

function readStoredUploads() {
  try {
    return JSON.parse(window.localStorage.getItem(UPLOAD_STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

/* ---- IndexedDB helpers (replaces localStorage for photos) ---- */

const DB_NAME = "travel-map-db";
const DB_VERSION = 1;
const IDB_PHOTOS_KEY = "photos";

function openIdb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(IDB_PHOTOS_KEY)) {
        db.createObjectStore(IDB_PHOTOS_KEY);
      }
    };
    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => reject(event.target.error);
  });
}

async function readUploadsFromIdb() {
  try {
    const db = await openIdb();
    return new Promise((resolve) => {
      const tx = db.transaction(IDB_PHOTOS_KEY, "readonly");
      const store = tx.objectStore(IDB_PHOTOS_KEY);
      const req = store.get(IDB_PHOTOS_KEY);
      req.onsuccess = () => resolve(req.result || {});
      req.onerror = () => resolve({});
      tx.oncomplete = () => db.close();
    });
  } catch {
    return {};
  }
}

async function saveUploadsToIdb(data) {
  try {
    const db = await openIdb();
    return new Promise((resolve) => {
      const tx = db.transaction(IDB_PHOTOS_KEY, "readwrite");
      const store = tx.objectStore(IDB_PHOTOS_KEY);
      const req = store.put(data, IDB_PHOTOS_KEY);
      req.onsuccess = () => resolve("ok");
      req.onerror = () => {
        resolve(req.error?.name === "QuotaExceededError" ? "quota" : "error");
      };
      tx.oncomplete = () => db.close();
    });
  } catch {
    return "error";
  }
}

async function initUploadStorage() {
  // Migrate old localStorage data into IndexedDB
  try {
    const localRaw = window.localStorage.getItem(UPLOAD_STORAGE_KEY);
    if (localRaw) {
      const parsed = JSON.parse(localRaw);
      if (Object.keys(parsed).length > 0) {
        const result = await saveUploadsToIdb(parsed);
        if (result === "ok") {
          // Only delete localStorage AFTER confirming IndexedDB write succeeded
          window.localStorage.removeItem(UPLOAD_STORAGE_KEY);
          return parsed;
        }
        // Migration failed — keep localStorage as fallback
        console.warn("IndexedDB migration failed, keeping localStorage backup");
        return parsed;
      }
    }
  } catch (err) {
    console.warn("Migration error:", err);
  }

  // Fallback: read from IndexedDB, then localStorage
  const idbData = await readUploadsFromIdb();
  if (Object.keys(idbData).length > 0) return idbData;

  // Last resort: read from localStorage
  return readStoredUploads();
}

function readUploadAuth() {
  try {
    return window.sessionStorage.getItem(UPLOAD_AUTH_KEY) === "true";
  } catch {
    return false;
  }
}

function storeUploadAuth() {
  try {
    window.sessionStorage.setItem(UPLOAD_AUTH_KEY, "true");
  } catch {
    return undefined;
  }
  return undefined;
}

function readDeletedTrips() {
  try {
    return JSON.parse(window.localStorage.getItem(DELETED_TRIPS_KEY) || "[]");
  } catch {
    return [];
  }
}

function storeDeletedTrips(ids) {
  try {
    window.localStorage.setItem(DELETED_TRIPS_KEY, JSON.stringify(ids));
  } catch {
    return undefined;
  }
  return undefined;
}

function readTripEdits() {
  try {
    return JSON.parse(window.localStorage.getItem(TRIP_EDITS_KEY) || "{}");
  } catch {
    return {};
  }
}

function storeTripEdits(edits) {
  try {
    window.localStorage.setItem(TRIP_EDITS_KEY, JSON.stringify(edits));
  } catch {
    return undefined;
  }
  return undefined;
}

async function hashText(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await window.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function readPhotoTakenAt(file) {
  const metadata = await exifr.parse(file, ["DateTimeOriginal", "CreateDate"]).catch(() => null);
  const exifDate = metadata?.DateTimeOriginal || metadata?.CreateDate;
  if (exifDate instanceof Date) return toDateTimeText(exifDate);
  if (file.lastModified) return toDateTimeText(new Date(file.lastModified));
  return "本地上传";
}

function fileToPhoto(file, captionOverride, takenAtOverride) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async () => {
      const exifTakenAt = await readPhotoTakenAt(file);
      resolve({
        id: `${Date.now()}-${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`,
        src: reader.result,
        caption: captionOverride || file.name.replace(/\.[^.]+$/, ""),
        takenAt: takenAtOverride || exifTakenAt,
        isLocalUpload: true,
      });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function getTripPhotos(trip, uploadedPhotosByCity) {
  if (!trip) return [];
  const key = tripKeyFromTrip(trip);
  const payload = uploadedPhotosByCity[key];
  const uploadedPhotos = normalizeUploadedPhotos(Array.isArray(payload) ? payload : payload?.photos || []);
  return [...trip.photos, ...uploadedPhotos];
}

function normalizeUploadedPhotos(photos) {
  return photos.map((photo, index) => ({
    ...photo,
    id: photo.id || `legacy-${index}-${photo.src?.slice(0, 24) || photo.caption}`,
    isLocalUpload: true,
  }));
}

function isSamePhoto(left, right) {
  if (left.id && right.id) return left.id === right.id;
  return (
    left.src === right.src &&
    left.caption === right.caption &&
    (left.takenAt || "") === (right.takenAt || "")
  );
}

function getCityOption(province, city) {
  return PROVINCE_OPTIONS[province]?.cities.find((item) => item.name === city);
}

function getDistrictOption(province, city, district) {
  if (!district) return getCityOption(province, city);
  const cityData = PROVINCE_OPTIONS[province]?.cities?.find((c) => c.name === city);
  const districtData = cityData?.districts?.find(
    (d) =>
      d.name === district ||
      d.name === district + "区" ||
      d.name === district + "县" ||
      d.name === district + "市",
  );
  return districtData || getCityOption(province, city);
}

function createUploadTrip({ province, city, district, photos }) {
  const cityOption = district
    ? getDistrictOption(province, city, district)
    : getCityOption(province, city);
  const firstDate = photos[0]?.takenAt?.slice(0, 10) || "";

  return {
    id: `local-${province}-${city}${district ? `-${district}` : ""}`,
    city,
    province,
    district: district || undefined,
    startDate: firstDate,
    endDate: firstDate,
    coords: cityOption?.coords || [0, 0],
    note: "这是一段本地上传的新照片记录，正式发布时可以再补上旅行故事。",
    tags: ["本地上传"],
    photos,
  };
}

function mergeUploadedTrips(baseTrips, uploadedPhotosByCity) {
  const tripsByKey = new Map(
    baseTrips.map((trip) => [tripKeyFromTrip(trip), { ...trip }])
  );

  for (const [uploadKey, payload] of Object.entries(uploadedPhotosByCity)) {
    const photos = normalizeUploadedPhotos(Array.isArray(payload) ? payload : payload.photos || []);
    const province = Array.isArray(payload) ? null : payload.province;
    const district = Array.isArray(payload) ? null : payload.district;
    if (photos.length === 0) continue;

    // Extract city from composite key for new trips
    const cityFromKey = province ? uploadKey.split("||")[0] : uploadKey;

    const existingTrip = tripsByKey.get(uploadKey);
    if (existingTrip) {
      tripsByKey.set(uploadKey, {
        ...existingTrip,
        ...(district ? { district } : {}),
        photos: [...existingTrip.photos, ...photos],
      });
      continue;
    }

    if (!province) continue;
    const city = cityFromKey;
    tripsByKey.set(uploadKey, createUploadTrip({ province, city, district, photos }));
  }

  return [...tripsByKey.values()].sort((left, right) =>
    `${right.startDate || ""}${right.endDate || ""}`.localeCompare(
      `${left.startDate || ""}${left.endDate || ""}`,
    ),
  );
}

function buildMapSubtitle(stats) {
  return `共点亮 ${stats.cities} 个城市${stats.districts > 0 ? ` · ${stats.districts} 个精确区县` : ""} · 放大到广东省可切换街道级地图`;
}

function buildPhotoAlt(photo, city) {
  return `${city} - ${photo.caption}`;
}

function tripKey(city, district) {
  return district ? `${city}||${district}` : city;
}

function tripKeyFromTrip(trip) {
  return tripKey(trip.city, trip.district);
}

function App() {
  const provinceNames = useMemo(() => Object.keys(PROVINCE_OPTIONS), []);
  const provinceColors = useMemo(() => {
    const map = {};
    for (const [province, data] of Object.entries(PROVINCE_OPTIONS)) {
      map[province] = data.color || "#ee8f76";
    }
    return map;
  }, []);
  const [uploadedPhotosByCity, setUploadedPhotosByCity] = useState(readStoredUploads);
  const [backupStatus, setBackupStatus] = useState("idle"); // idle | exporting | done | error
  const importFileRef = React.useRef(null);
  const [syncStatus, setSyncStatus] = useState("idle"); // idle | pulling | pulled | pushing | pushed | error
  const [cloudPhotoCount, setCloudPhotoCount] = useState(null); // number of photos in Supabase
  const [syncErrorMessage, setSyncErrorMessage] = useState(null);
  const isSyncing = syncStatus === "pulling" || syncStatus === "pushing";
  const [lastUploadKey, setLastUploadKey] = useState(null);
  // Refs for IndexedDB integration (keeps latest state for async handlers)
  const uploadedRef = React.useRef(uploadedPhotosByCity);
  React.useEffect(() => { uploadedRef.current = uploadedPhotosByCity; }, [uploadedPhotosByCity]);

  // Load from IndexedDB + migrate old localStorage on mount
  React.useEffect(() => {
    let cancelled = false;
    initUploadStorage().then((data) => {
      if (!cancelled && data && Object.keys(data).length > 0) {
        setUploadedPhotosByCity((prev) => {
          // Prefer IDB data if it has more entries, merge otherwise
          if (Object.keys(data).length >= Object.keys(prev).length) return data;
          return prev;
        });
      }
    });
    return () => { cancelled = true; };
  }, []);

  // Pull photos from Supabase cloud on mount
  // Phase 1: Fetch metadata (fast, ~10KB)
  // Phase 2: Only download photo_data for photos missing locally
  React.useEffect(() => {
    let cancelled = false;
    setSyncStatus("pulling");
    setSyncErrorMessage(null);

    (async () => {
      const remoteMeta = await fetchRemotePhotoMetadata();
      if (cancelled) return;

      if (remoteMeta === null) {
        setSyncStatus("error");
        setSyncErrorMessage("无法连接 Supabase，请检查网络。");
        return;
      }

      const count = remoteMeta.length;
      setCloudPhotoCount(count);

      if (count === 0) {
        setSyncStatus("pulled");
        return;
      }

      // Check which photo IDs we already have in IndexedDB
      const localData = await readUploadsFromIdb();
      const localPhotoIds = new Set();
      for (const [, v] of Object.entries(localData)) {
        const photos = Array.isArray(v) ? v : v.photos || [];
        for (const p of photos) {
          if (p.id) localPhotoIds.add(p.id);
        }
      }

      const remoteIds = remoteMeta.map((r) => r.id);
      const missingIds = remoteIds.filter((id) => !localPhotoIds.has(id));

      if (missingIds.length > 0 && !cancelled) {
        setSyncStatus("pulling");
        // Phase 2: download only missing photos
        const photoDataMap = await fetchPhotoDataByIds(missingIds);

        if (!cancelled && Object.keys(photoDataMap).length > 0) {
          const remoteUploads = buildUploadsFromMeta(
            remoteMeta.filter((r) => missingIds.includes(r.id)),
            photoDataMap,
          );

          if (Object.keys(remoteUploads).length > 0) {
            setUploadedPhotosByCity((prev) => {
              const merged = mergeRemoteIntoLocal(prev, remoteUploads);
              saveUploadsToIdb(merged);
              return merged;
            });
          }
        }
      }

      if (!cancelled) setSyncStatus("pulled");
    })().catch((err) => {
      if (!cancelled) {
        setSyncStatus("error");
        setSyncErrorMessage(err?.message || String(err));
        console.error("Sync fetch threw:", err);
      }
    });

    return () => { cancelled = true; };
  }, []);

  const [deletedTripIds, setDeletedTripIds] = useState(readDeletedTrips);
  const [tripEdits, setTripEdits] = useState(readTripEdits);
  const allTrips = useMemo(
    () =>
      mergeUploadedTrips(sortedTravels, uploadedPhotosByCity)
        .filter((t) => !deletedTripIds.includes(t.id))
        .map((trip) => {
          const edit = tripEdits[trip.id];
          if (!edit) return trip;
          return { ...trip, note: edit.note ?? trip.note, tags: edit.tags ?? trip.tags };
        }),
    [uploadedPhotosByCity, deletedTripIds, tripEdits],
  );

  // Auto-select trip after upload (matches by city/district key)
  React.useEffect(() => {
    if (!lastUploadKey) return;
    const matchingTrip = allTrips.find(
      (trip) => tripKeyFromTrip(trip) === lastUploadKey,
    );
    if (matchingTrip) {
      setSelectedTripId(matchingTrip.id);
    }
    setLastUploadKey(null);
  }, [lastUploadKey, allTrips]);
  const [selectedTripId, setSelectedTripId] = useState(allTrips[0]?.id ?? null);
  const [shareState, setShareState] = useState("idle");
  const [isUploadUnlocked, setIsUploadUnlocked] = useState(readUploadAuth);
  const [uploadPassphrase, setUploadPassphrase] = useState("");
  const [uploadAuthStatus, setUploadAuthStatus] = useState("idle");
  const [selectedUploadProvince, setSelectedUploadProvince] = useState(provinceNames[0] ?? "");
  const [selectedUploadCity, setSelectedUploadCity] = useState(
    PROVINCE_OPTIONS[provinceNames[0]]?.cities[0]?.name ?? "",
  );
  const [selectedUploadDistrict, setSelectedUploadDistrict] = useState("");
  const [customPhotoDate, setCustomPhotoDate] = useState("");
  const [customPhotoCaption, setCustomPhotoCaption] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const [lightboxPhoto, setLightboxPhoto] = useState(null);
  const [showAlbum, setShowAlbum] = useState(false);
  const handleOpenAlbum = useCallback(() => setShowAlbum(true), []);
  const handleCloseAlbum = useCallback(() => setShowAlbum(false), []);
  // Note editing
  const [editingNote, setEditingNote] = useState(false);
  const [editNoteDraft, setEditNoteDraft] = useState("");
  // Tag editing
  const [editingTags, setEditingTags] = useState(false);
  const [editTagsDraft, setEditTagsDraft] = useState([]);
  const [editTagInput, setEditTagInput] = useState("");
  const selectedTrip = allTrips.find((item) => item.id === selectedTripId) ?? allTrips[0] ?? null;
  const selectedTripPhotos = selectedTrip?.photos || [];
  const selectedTripPhotoCards = useMemo(
    () =>
      selectedTripPhotos.map((photo) => ({
        ...photo,
        alt: buildPhotoAlt(photo, selectedTrip?.city || ""),
        city: selectedTrip?.city,
        src: resolveAssetPath(photo.src),
      })),
    [selectedTrip?.city, selectedTripPhotos],
  );
  const selectedProvinceCities = PROVINCE_OPTIONS[selectedUploadProvince]?.cities || [];
  const selectedCityDistricts =
    PROVINCE_OPTIONS[selectedUploadProvince]?.cities?.find(
      (c) => c.name === selectedUploadCity,
    )?.districts || [];
  const stats = useMemo(() => collectStats(allTrips), [allTrips]);
  const mapSubtitle = useMemo(() => buildMapSubtitle(stats), [stats]);

  useEffect(() => {
    if (!allTrips[0]) return;
    if (!selectedTripId || !allTrips.some((item) => item.id === selectedTripId)) {
      setSelectedTripId(allTrips[0].id);
    }
  }, [allTrips, selectedTripId]);

  useEffect(() => {
    const firstCity = PROVINCE_OPTIONS[selectedUploadProvince]?.cities[0]?.name;
    if (firstCity) setSelectedUploadCity(firstCity);
    setSelectedUploadDistrict("");
  }, [selectedUploadProvince]);

  useEffect(() => {
    setSelectedUploadDistrict("");
  }, [selectedUploadCity]);

  const handleShare = useCallback(async () => {
    const shareUrl = window.location.href;

    try {
      if (navigator.share) {
        await navigator.share({
          title: "For Us",
          text: "我们的旅行地图",
          url: shareUrl,
        });
        setShareState("shared");
      } else {
        await navigator.clipboard.writeText(shareUrl);
        setShareState("copied");
      }
    } catch (error) {
      setShareState("error");
    } finally {
      window.setTimeout(() => setShareState("idle"), 2200);
    }
  }, []);

  async function handlePhotoUpload(event) {
    const isDrag = !!event.dataTransfer;
    const fileList = isDrag ? event.dataTransfer.files : event.target.files;
    const files = Array.from(fileList || []);
    if (!isUploadUnlocked) {
      setUploadAuthStatus("error");
      if (event.target) event.target.value = "";
      return;
    }
    if (!selectedUploadProvince || !selectedUploadCity || files.length === 0) return;

    const customDate = customPhotoDate.trim();
    const captionPrefix = customPhotoCaption.trim() || null;

    const uploadedPhotos = [];
    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      try {
        const caption = captionPrefix
          ? files.length > 1
            ? `${captionPrefix}${index + 1}`
            : captionPrefix
          : file.name.replace(/\.[^.]+$/, "");
        const takenAt = customDate || undefined;
        const photo = await fileToPhoto(file, caption, takenAt);
        uploadedPhotos.push(photo);
      } catch (err) {
        console.error("Failed to read photo:", file.name, err);
      }
    }

    if (uploadedPhotos.length === 0) {
      if (event.target) event.target.value = "";
      return;
    }

    setUploadedPhotosByCity((currentUploads) => {
      const key = tripKey(selectedUploadCity, selectedUploadDistrict);
      const currentPayload = currentUploads[key] || {
        province: selectedUploadProvince,
        photos: [],
      };
      const currentPhotos = Array.isArray(currentPayload)
        ? currentPayload
        : currentPayload.photos || [];
      const nextUploads = {
        ...currentUploads,
        [key]: {
          province: selectedUploadProvince,
          district: selectedUploadDistrict || undefined,
          photos: [...currentPhotos, ...uploadedPhotos],
        },
      };

      // Persist to IndexedDB
      saveUploadsToIdb(nextUploads).then((result) => {
        if (result === "quota") {
          window.alert("存储空间不足，请删除一些旧照片后再试。");
        }
      });

      // Auto-select via useEffect (matches by city/district key)
      setLastUploadKey(key);

      // Un-delete if re-uploading to a previously deleted location
      const undoIds = [
        `local-${selectedUploadProvince}-${selectedUploadCity}${selectedUploadDistrict ? `-${selectedUploadDistrict}` : ""}`,
        ...sortedTravels
          .filter((t) => tripKey(t.city, t.district) === key)
          .map((t) => t.id),
      ];
      setDeletedTripIds((prev) => {
        const next = prev.filter((id) => !undoIds.includes(id));
        if (next.length !== prev.length) storeDeletedTrips(next);
        return next;
      });

      return nextUploads;
    });

    // Upload to Supabase cloud in background
    const remoteMetadata = {
      province: selectedUploadProvince,
      city: selectedUploadCity,
      district: selectedUploadDistrict,
    };
    uploadedPhotos.forEach((photo) => {
      uploadPhotoToRemote(photo.id, photo.src, {
        ...remoteMetadata,
        caption: photo.caption,
        takenAt: photo.takenAt,
      }).then((url) => {
        if (url) {
          setCloudPhotoCount((prev) => (prev ?? 0) + 1);
        }
      });
    });

    if (event.target) event.target.value = "";
    setCustomPhotoDate("");
    setCustomPhotoCaption("");
  }

  function handleDragOver(event) {
    event.preventDefault();
    setIsDragOver(true);
  }

  function handleDragLeave(event) {
    event.preventDefault();
    setIsDragOver(false);
  }

  function handleDrop(event) {
    event.preventDefault();
    setIsDragOver(false);
    handlePhotoUpload(event);
  }

  async function handleUnlockUpload(event) {
    event.preventDefault();
    const passwordHash = await hashText(uploadPassphrase.trim()).catch(() => "");
    if (passwordHash !== UPLOAD_PASSWORD_HASH) {
      setUploadAuthStatus("error");
      return;
    }

    storeUploadAuth();
    setIsUploadUnlocked(true);
    setUploadPassphrase("");
    setUploadAuthStatus("ready");
  }

  function handleDeleteUploadedPhoto(trip, photo) {
    if (!photo.isLocalUpload) return;
    const shouldDelete = window.confirm("删除这张本地上传的照片吗？");
    if (!shouldDelete) return;

    const key = tripKeyFromTrip(trip);

    // Delete from remote
    deleteRemotePhoto(photo.id).then((ok) => {
      if (ok) setCloudPhotoCount((prev) => (prev != null ? Math.max(0, prev - 1) : null));
    });

    setUploadedPhotosByCity((currentUploads) => {
      const currentPayload = currentUploads[key];
      if (!currentPayload) return currentUploads;

      const currentPhotos = Array.isArray(currentPayload)
        ? currentPayload
        : currentPayload.photos || [];
      const nextPhotos = currentPhotos.filter((item) => !isSamePhoto(item, photo));
      const nextUploads = { ...currentUploads };

      if (nextPhotos.length === 0) {
        delete nextUploads[key];
      } else {
        nextUploads[key] = Array.isArray(currentPayload)
          ? nextPhotos
          : { ...currentPayload, photos: nextPhotos };
      }

      saveUploadsToIdb(nextUploads);
      return nextUploads;
    });
  }

  function handleStartEditNote() {
    setEditNoteDraft(selectedTrip?.note || "");
    setEditingNote(true);
  }

  function handleSaveNote() {
    if (!selectedTrip) return;
    const id = selectedTrip.id;
    setTripEdits((prev) => {
      const next = { ...prev, [id]: { ...prev[id], note: editNoteDraft } };
      // Remove empty edits for this trip
      const edit = next[id];
      if (!edit.note && (!edit.tags || edit.tags.length === 0)) {
        delete next[id];
      }
      storeTripEdits(next);
      return next;
    });
    setEditingNote(false);
  }

  function handleCancelEditNote() {
    setEditingNote(false);
    setEditNoteDraft("");
  }

  function handleStartEditTags() {
    setEditTagsDraft([...(selectedTrip?.tags || [])]);
    setEditTagInput("");
    setEditingTags(true);
  }

  function handleAddTag() {
    const tag = editTagInput.trim();
    if (!tag) return;
    setEditTagsDraft((prev) => {
      if (prev.includes(tag)) return prev;
      return [...prev, tag];
    });
    setEditTagInput("");
  }

  function handleRemoveTag(target) {
    setEditTagsDraft((prev) => prev.filter((t) => t !== target));
  }

  function handleSaveTags() {
    if (!selectedTrip) return;
    const id = selectedTrip.id;
    setTripEdits((prev) => {
      const next = {
        ...prev,
        [id]: { ...prev[id], tags: editTagsDraft.length > 0 ? editTagsDraft : undefined },
      };
      const edit = next[id];
      if (!edit.note && (!edit.tags || edit.tags.length === 0)) {
        delete next[id];
      }
      storeTripEdits(next);
      return next;
    });
    setEditingTags(false);
  }

  function handleCancelEditTags() {
    setEditingTags(false);
    setEditTagsDraft([]);
    setEditTagInput("");
  }

  async function handleExport() {
    setBackupStatus("exporting");
    try {
      const uploads = await readUploadsFromIdb();
      const exportData = {
        version: 1,
        exportedAt: new Date().toISOString(),
        uploadedPhotosByCity: uploads,
        deletedTripIds: readDeletedTrips(),
        tripEdits: readTripEdits(),
      };
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `travel-map-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setBackupStatus("done");
      setTimeout(() => setBackupStatus("idle"), 2500);
    } catch (err) {
      console.error("Export failed:", err);
      setBackupStatus("error");
      setTimeout(() => setBackupStatus("idle"), 2500);
    }
  }

  function handleImportClick() {
    importFileRef.current?.click();
  }

  async function handleImportFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      if (!data.uploadedPhotosByCity || typeof data.uploadedPhotosByCity !== "object") {
        throw new Error("文件格式不正确，缺少照片数据。");
      }

      const cityCount = Object.keys(data.uploadedPhotosByCity).length;
      let photoCount = 0;
      for (const v of Object.values(data.uploadedPhotosByCity)) {
        photoCount += Array.isArray(v) ? v.length : (v.photos?.length || 0);
      }

      const shouldMerge = window.confirm(
        `即将导入 ${cityCount} 个城市共 ${photoCount} 张照片。\n\n选择"确定"合并到现有数据，"取消"则放弃导入。`
      );
      if (!shouldMerge) {
        event.target.value = "";
        return;
      }

      // Merge with existing IndexedDB data
      const existing = await readUploadsFromIdb();
      const merged = { ...existing };

      for (const [key, value] of Object.entries(data.uploadedPhotosByCity)) {
        if (!merged[key]) {
          merged[key] = value;
        } else {
          // Merge photos, skip duplicates by id
          const existingPhotos = Array.isArray(merged[key])
            ? merged[key]
            : merged[key].photos || [];
          const newPhotos = Array.isArray(value) ? value : value.photos || [];
          const existingIds = new Set(existingPhotos.map((p) => p.id));
          const uniqueNewPhotos = newPhotos.filter((p) => !existingIds.has(p.id));
          merged[key] = {
            province: merged[key].province || value.province,
            district: merged[key].district || value.district,
            photos: [...existingPhotos, ...uniqueNewPhotos],
          };
        }
      }

      // Save to IndexedDB
      const result = await saveUploadsToIdb(merged);
      if (result !== "ok") {
        window.alert("导入失败：存储空间不足，请删除一些旧照片后再试。");
        event.target.value = "";
        return;
      }

      // Restore deletedTripIds
      if (Array.isArray(data.deletedTripIds) && data.deletedTripIds.length > 0) {
        const existingDeleted = readDeletedTrips();
        const mergedDeleted = [...new Set([...existingDeleted, ...data.deletedTripIds])];
        storeDeletedTrips(mergedDeleted);
        setDeletedTripIds(mergedDeleted);
      }

      // Restore tripEdits
      if (data.tripEdits && typeof data.tripEdits === "object") {
        const existingEdits = readTripEdits();
        const mergedEdits = { ...existingEdits, ...data.tripEdits };
        storeTripEdits(mergedEdits);
        setTripEdits(mergedEdits);
      }

      // Update state
      setUploadedPhotosByCity(merged);
      setBackupStatus("done");
      window.alert(`导入成功！${cityCount} 个城市、${photoCount} 张照片已合并。`);
      setTimeout(() => setBackupStatus("idle"), 2500);
    } catch (err) {
      console.error("Import failed:", err);
      window.alert(`导入失败：${err.message}`);
    } finally {
      event.target.value = "";
    }
  }

  function handleDeleteTrip(tripId) {
    const trip = allTrips.find((t) => t.id === tripId);
    if (!trip) return;
    const loc = trip.district ? `${trip.district}, ${trip.city}` : trip.city;
    const shouldDelete = window.confirm(`确定删除「${loc}」的足迹吗？`);
    if (!shouldDelete) return;

    // Delete all photos from remote
    deleteRemoteTrip(trip.province, trip.city, trip.district).then((ok) => {
      if (ok) {
        const deletedCount = trip.photos.filter((p) => p.isLocalUpload).length;
        setCloudPhotoCount((prev) =>
          prev != null ? Math.max(0, prev - deletedCount) : null,
        );
      }
    });

    // Remove from uploaded storage if it's an uploaded trip
    const key = tripKeyFromTrip(trip);
    setUploadedPhotosByCity((currentUploads) => {
      const nextUploads = { ...currentUploads };
      if (nextUploads[key]) {
        delete nextUploads[key];
      }
      saveUploadsToIdb(nextUploads);
      return nextUploads;
    });

    // Add to deleted list
    setDeletedTripIds((prev) => {
      const next = [...prev, tripId];
      storeDeletedTrips(next);
      return next;
    });

    // Select next trip if deleting the current one
    if (selectedTripId === tripId) {
      const remaining = allTrips.filter((t) => t.id !== tripId);
      setSelectedTripId(remaining[0]?.id ?? null);
    }
  }

  async function handleSyncAllToCloud() {
    setSyncStatus("pushing");
    try {
      const allUploads = await readUploadsFromIdb();
      let uploadedCount = 0;
      const totalPhotos = Object.values(allUploads).reduce(
        (sum, v) => sum + (Array.isArray(v) ? v.length : v.photos?.length || 0), 0,
      );

      for (const [, payload] of Object.entries(allUploads)) {
        const photos = Array.isArray(payload) ? payload : payload.photos || [];
        const province = Array.isArray(payload) ? "" : payload.province || "";
        const district = Array.isArray(payload) ? "" : payload.district || "";
        const key = Object.keys(allUploads).find(
          (k) => allUploads[k] === payload,
        );
        const city = key ? (key.includes("||") ? key.split("||")[0] : key) : "";

        for (const photo of photos) {
          const result = await uploadPhotoToRemote(photo.id, photo.src, {
            province,
            city,
            district,
            caption: photo.caption,
            takenAt: photo.takenAt,
          });
          if (result) uploadedCount++;
        }
      }

      setCloudPhotoCount((prev) => (prev ?? 0) + uploadedCount);
      setSyncStatus("pushed");
      if (uploadedCount > 0) {
        const skipped = totalPhotos - uploadedCount;
        alert(
          `同步完成！${uploadedCount} 张已上传云端` +
          (skipped > 0 ? `，${skipped} 张已在云端` : "") +
          "。"
        );
      } else if (totalPhotos > 0) {
        alert(`所有 ${totalPhotos} 张照片已在云端。\n如不确定，请按F12打开控制台查看详细日志。`);
      } else {
        alert("没有需要同步的照片。");
      }
    } catch (err) {
      console.error("Sync all failed:", err);
      setSyncStatus("error");
    }
  }

  useEffect(() => {
    const closeLightbox = (event) => {
      if (event.key === "Escape") setLightboxPhoto(null);
    };

    window.addEventListener("keydown", closeLightbox);
    return () => window.removeEventListener("keydown", closeLightbox);
  }, []);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">For Us</p>
          <h1>我们的旅行地图</h1>
          <p className="sidebar-copy">
            把一起走过的城市、照片和时间，都留在这一张地图里。
          </p>
          <div className="sweetheart-pressure" aria-label="粉色">
            <TextPressure
              alpha
              flex={false}
              italic
              maxFontSize={42}
              minFontSize={24}
              strokeColor="#fff0df"
              text="粉色"
              textColor="#a84435"
              textTransform="none"
              weight
              width
            />
          </div>
        </div>

        <RandomFrame allTrips={allTrips} />

        <div className="stat-grid">
          <article>
            <strong>{stats.cities}</strong>
            <span>去过城市</span>
          </article>
          <article>
            <strong>{stats.provinces}</strong>
            <span>覆盖省份</span>
          </article>
          <article>
            <strong>{stats.districts}</strong>
            <span>精确区县</span>
          </article>
          <article>
            <strong>{stats.totalPhotos}</strong>
            <span>照片数量</span>
          </article>
        </div>

        <section className="timeline">
          <div className="section-head">
            <h2>足迹时间线</h2>
            <span>{allTrips.length} 段回忆</span>
          </div>
          <div className="timeline-list">
            {allTrips.map((item) => (
              <button
                key={item.id}
                className={`timeline-item ${selectedTrip?.id === item.id ? "is-active" : ""}`}
                onClick={() => setSelectedTripId(item.id)}
                type="button"
              >
                <span>{item.district ? (item.district.length > 6 ? item.district.slice(0, 5) + "\u2026" : item.district) : item.city}</span>
                <small>{formatDisplayDate(item.startDate)}</small>
              </button>
            ))}
          </div>
        </section>

        <button
          className="album-entry-btn"
          type="button"
          onClick={handleOpenAlbum}
        >
          回忆相册
          <span className="album-entry-hint">看全部照片</span>
        </button>

        <div className="backup-section">
          <div className="cloud-sync-section">
            <div className="cloud-sync-status">
              <span className={`sync-dot ${syncStatus === "pulled" || syncStatus === "pushed" ? "synced" : syncStatus === "error" ? "error" : isSyncing ? "syncing" : ""}`} />
              <span className="cloud-sync-label">
                {isSyncing
                  ? "云端同步中…"
                  : syncStatus === "pulled" || syncStatus === "pushed"
                    ? `云端 ${cloudPhotoCount ?? "?"} 张`
                    : syncStatus === "error"
                      ? `连接失败${syncErrorMessage ? ": " + syncErrorMessage : ""}`
                      : "云端未同步"}
              </span>
            </div>
            {syncStatus === "error" && (
              <button
                className="backup-btn cloud-sync-btn"
                type="button"
                onClick={() => window.location.reload()}
                style={{ fontSize: 12, minHeight: 30 }}
              >
                重新连接
              </button>
            )}
            <button
              className="backup-btn cloud-sync-btn"
              type="button"
              onClick={handleSyncAllToCloud}
              disabled={isSyncing}
            >
              {syncStatus === "pushing" ? "上传中…" : syncStatus === "pushed" ? "同步完成" : "同步到云端"}
            </button>
          </div>
          <button
            className="backup-btn export-btn"
            type="button"
            onClick={handleExport}
            disabled={backupStatus === "exporting"}
          >
            {backupStatus === "exporting" ? "导出中…" : backupStatus === "done" ? "导出完成" : backupStatus === "error" ? "导出失败" : "导出备份"}
          </button>
          <button
            className="backup-btn import-btn"
            type="button"
            onClick={handleImportClick}
          >
            导入备份
          </button>
        </div>

        <input
          ref={importFileRef}
          type="file"
          accept=".json"
          style={{ display: "none" }}
          onChange={handleImportFile}
        />
      </aside>

      <main className="main-panel">
        <section className="hero-map">
          <GrainientBackground />
          <div className="hero-map-overlay" />
          <div className="section-head">
            <div>
              <p className="eyebrow">China Journey</p>
              <h2>点亮去过的城市</h2>
              <p className="map-subtitle">{mapSubtitle}</p>
            </div>
            <div className="hero-actions">
              <div className="legend">
                <span className="legend-dot" />
                <span>城市足迹</span>
              </div>
              <button className="share-button" onClick={handleShare} type="button">
                {shareState === "copied"
                  ? "链接已复制"
                  : shareState === "shared"
                    ? "已分享"
                    : shareState === "error"
                      ? "分享失败"
                      : "分享链接"}
              </button>
            </div>
          </div>
          <div className="map-scroll-frame" aria-label="可拖拽和放大的中国城市地图">
            <MapView
              allTrips={allTrips}
              provinceColors={provinceColors}
              selectedTripId={selectedTripId}
              onTripSelect={setSelectedTripId}
            />
          </div>
        </section>

        {selectedTrip && (
          <section className="detail-grid">
            <article className="trip-card">
              <div className="section-head">
                <div>
                  <p className="eyebrow">{selectedTrip.province}</p>
                  <h2>{selectedTrip.city}{selectedTrip.district ? ` · ${selectedTrip.district}` : ""}</h2>
                </div>
                <span>{formatDateRange(selectedTrip.startDate, selectedTrip.endDate)}</span>
              </div>

              {editingNote ? (
                <div className="edit-note-area">
                  <textarea
                    className="edit-note-textarea"
                    value={editNoteDraft}
                    onChange={(e) => setEditNoteDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") handleCancelEditNote();
                    }}
                    rows={4}
                    placeholder="写一段旅行故事…"
                    autoFocus
                  />
                  <div className="edit-note-actions">
                    <button className="edit-note-save" type="button" onClick={handleSaveNote}>
                      保存
                    </button>
                    <button className="edit-note-cancel" type="button" onClick={handleCancelEditNote}>
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <p
                  className="trip-note"
                  onClick={handleStartEditNote}
                  title="点击编辑旅行笔记"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleStartEditNote();
                  }}
                >
                  {selectedTrip.note || "点击添加旅行笔记…"}
                  <span className="edit-hint-icon">&#9998;</span>
                </p>
              )}

              <div className="meta-row">
                <span>照片 {selectedTripPhotos.length}</span>
                <span>
                  时间 {formatDisplayDate(selectedTrip.startDate)}
                  {selectedTrip.endDate && selectedTrip.endDate !== selectedTrip.startDate
                    ? ` 至 ${formatDisplayDate(selectedTrip.endDate)}`
                    : ""}
                </span>
              </div>

              {editingTags ? (
                <div className="edit-tags-area">
                  <div className="edit-tags-list">
                    {editTagsDraft.map((tag) => (
                      <span key={tag} className="tag-chip edit-tag-chip">
                        {tag}
                        <button
                          className="tag-remove-btn"
                          type="button"
                          onClick={() => handleRemoveTag(tag)}
                          title="删除标签"
                        >
                          &times;
                        </button>
                      </span>
                    ))}
                    <input
                      className="edit-tag-input"
                      type="text"
                      value={editTagInput}
                      onChange={(e) => setEditTagInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); handleAddTag(); }
                        if (e.key === "Escape") handleCancelEditTags();
                      }}
                      placeholder="输入标签后回车"
                    />
                  </div>
                  <div className="edit-note-actions">
                    <button className="edit-note-save" type="button" onClick={handleSaveTags}>
                      保存
                    </button>
                    <button className="edit-note-cancel" type="button" onClick={handleCancelEditTags}>
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  className="tag-row"
                  onClick={handleStartEditTags}
                  title="点击编辑标签"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleStartEditTags();
                  }}
                >
                  {selectedTrip.tags.length > 0 ? (
                    selectedTrip.tags.map((tag) => (
                      <span key={tag} className="tag-chip">
                        {tag}
                      </span>
                    ))
                  ) : (
                    <span className="tag-chip tag-placeholder">点击添加标签</span>
                  )}
                  <span className="edit-hint-icon">&#9998;</span>
                </div>
              )}

              <button
                className="delete-trip-btn"
                type="button"
                onClick={() => handleDeleteTrip(selectedTrip.id)}
                title="删除此足迹"
              >
                删除足迹
              </button>

              <BounceCards
                cards={selectedTripPhotoCards}
                className="travel-bounce-cards"
                containerHeight={320}
                onDelete={(photo) => handleDeleteUploadedPhoto(selectedTrip, photo)}
                onOpen={(photo) => setLightboxPhoto({ ...photo, city: selectedTrip.city })}
              />
            </article>

            <article className="upload-card">
              <div className="section-head">
                <h2>添加照片</h2>
                <span>本地预览</span>
              </div>

              <label className="upload-label" htmlFor="province-upload-select">
                选择省份
              </label>
              <select
                id="province-upload-select"
                className="upload-select"
                value={selectedUploadProvince}
                onChange={(event) => setSelectedUploadProvince(event.target.value)}
              >
                {provinceNames.map((province) => (
                  <option key={province} value={province}>
                    {province}
                  </option>
                ))}
              </select>

              <label className="upload-label" htmlFor="city-upload-select">
                选择城市
              </label>
              <select
                id="city-upload-select"
                className="upload-select"
                value={selectedUploadCity}
                onChange={(event) => setSelectedUploadCity(event.target.value)}
              >
                {selectedProvinceCities.map((city) => (
                  <option key={city.name} value={city.name}>
                    {city.name}
                  </option>
                ))}
              </select>

              {selectedCityDistricts.length > 0 && (
                <>
                  <label className="upload-label" htmlFor="district-upload-select">
                    选择区县（可选）
                  </label>
                  <select
                    id="district-upload-select"
                    className="upload-select"
                    value={selectedUploadDistrict}
                    onChange={(event) => setSelectedUploadDistrict(event.target.value)}
                  >
                    <option value="">不指定区县</option>
                    {selectedCityDistricts.map((d) => (
                      <option key={d.name} value={d.name}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </>
              )}

              {isUploadUnlocked ? (
                <>
                  <div className="upload-auth-success">已解锁，本次会话可继续上传。</div>

                  <label className="upload-label" htmlFor="custom-photo-date">
                    拍摄日期（可选）
                  </label>
                  <input
                    id="custom-photo-date"
                    className="upload-text-input"
                    type="date"
                    value={customPhotoDate}
                    onChange={(e) => setCustomPhotoDate(e.target.value)}
                  />

                  <label className="upload-label" htmlFor="custom-photo-caption">
                    照片名称（可选，多张自动编号）
                  </label>
                  <input
                    id="custom-photo-caption"
                    className="upload-text-input"
                    type="text"
                    placeholder="留空则使用文件名"
                    value={customPhotoCaption}
                    onChange={(e) => setCustomPhotoCaption(e.target.value)}
                  />

                  <input
                    accept="image/*"
                    className="upload-file-input"
                    id="photo-upload-input"
                    multiple
                    onChange={handlePhotoUpload}
                    type="file"
                  />

                  <label
                    className={`upload-drop-zone${isDragOver ? " is-dragover" : ""}`}
                    htmlFor="photo-upload-input"
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                  >
                    <span className="drop-zone-icon">拖拽照片到此处</span>
                    <span className="drop-zone-hint">或点击选择文件</span>
                  </label>
                </>
              ) : (
                <form className="upload-auth-form" onSubmit={handleUnlockUpload}>
                  <label className="upload-label" htmlFor="upload-passphrase">
                    上传口令
                  </label>
                  <div className="upload-auth-row">
                    <input
                      autoComplete="off"
                      className="upload-passphrase-input"
                      id="upload-passphrase"
                      onChange={(event) => {
                        setUploadPassphrase(event.target.value);
                        if (uploadAuthStatus === "error") setUploadAuthStatus("idle");
                      }}
                      placeholder="输入口令后解锁上传"
                      type="password"
                      value={uploadPassphrase}
                    />
                    <button className="upload-auth-button" type="submit">
                      解锁
                    </button>
                  </div>
                  {uploadAuthStatus === "error" && (
                    <p className="upload-auth-error">口令不对，暂时不能上传照片。</p>
                  )}
                </form>
              )}

              <p className="upload-note">
                支持拖拽上传，可自定义拍摄日期与照片名称，广东省支持精确到区县级。
              </p>
            </article>
          </section>
        )}
      </main>
      {lightboxPhoto && (
        <div className="photo-lightbox" onClick={() => setLightboxPhoto(null)}>
          <figure className="lightbox-frame" onClick={(event) => event.stopPropagation()}>
            <button className="lightbox-close" onClick={() => setLightboxPhoto(null)} type="button">
              关闭
            </button>
            <img
              src={resolveAssetPath(lightboxPhoto.src)}
              alt={buildPhotoAlt(lightboxPhoto, lightboxPhoto.city)}
            />
            <figcaption>
              <strong>{lightboxPhoto.caption}</strong>
              <span>
                {lightboxPhoto.city} · {lightboxPhoto.takenAt || "待补充"}
              </span>
            </figcaption>
          </figure>
        </div>
      )}
      {showAlbum && (
        <MemoryAlbum
          allTrips={allTrips}
          onClose={handleCloseAlbum}
          onPhotoClick={(photo, trip) =>
            setLightboxPhoto({ ...photo, city: trip.city })
          }
        />
      )}
    </div>
  );
}

export default App;
