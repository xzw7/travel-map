import { supabase } from "./supabase";

const TABLE = "travel_photos";

/**
 * Fetch only metadata (no photo_data) — fast, ~10KB
 * @returns {Array|null} array of metadata rows, or null on error
 */
export async function fetchRemotePhotoMetadata() {
  const { data, error } = await supabase
    .from(TABLE)
    .select("id, province, city, district, caption, taken_at")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("fetchRemotePhotoMetadata failed:", {
      message: error.message,
      details: error.details,
      code: error.code,
    });
    return null;
  }
  return data || [];
}

/**
 * Fetch photo_data (base64) for specific IDs only — only for missing photos.
 * @param {string[]} ids
 * @param {function} [onProgress] - callback: ({done, total}) => void
 * @returns {Promise<Record<string, string>>} map of id → photo_data
 */
export async function fetchPhotoDataByIds(ids, onProgress) {
  if (!ids || ids.length === 0) return {};

  const CHUNK = 20;
  const total = ids.length;
  const result = {};
  let done = 0;

  onProgress?.({ done: 0, total });

  for (let i = 0; i < total; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from(TABLE)
      .select("id, photo_data")
      .in("id", chunk);

    if (error) {
      console.error("fetchPhotoDataByIds failed:", error.message);
      continue;
    }
    for (const row of data || []) {
      result[row.id] = row.photo_data;
    }
    done += chunk.length;
    onProgress?.({ done, total });
  }
  return result;
}

/**
 * Upload a single photo to Supabase DB (stores base64 directly).
 * @returns {string|null} base64 src on success, null on failure
 */
export async function uploadPhotoToRemote(photoId, base64Src, metadata) {
  const { province, city, district, caption, takenAt } = metadata;

  try {
    const { data: existingRow, error: checkError } = await supabase
      .from(TABLE)
      .select("id")
      .eq("id", photoId)
      .maybeSingle();

    if (checkError) {
      console.error("Check existing failed:", checkError.message);
    }

    if (existingRow) {
      return base64Src;
    }

    const { error: insertError } = await supabase
      .from(TABLE)
      .insert({
        id: photoId,
        province,
        city,
        district: district || "",
        caption: caption || "",
        taken_at: takenAt || "",
        photo_data: base64Src,
      });

    if (insertError) {
      console.error("DB insert failed:", insertError.message, insertError.details);
      return null;
    }

    return base64Src;
  } catch (err) {
    console.error("Upload to remote threw:", err);
    return null;
  }
}

/**
 * Delete a photo from Supabase DB.
 */
export async function deleteRemotePhoto(photoId) {
  const { error } = await supabase.from(TABLE).delete().eq("id", photoId);
  if (error) {
    console.error("Failed to delete remote photo:", error.message);
    return false;
  }
  return true;
}

/**
 * Delete all photos for a specific city/district from remote.
 */
export async function deleteRemoteTrip(province, city, district) {
  let query = supabase.from(TABLE).delete().eq("province", province).eq("city", city);
  if (district) query = query.eq("district", district);

  const { error } = await query;
  if (error) {
    console.error("Failed to delete remote trip photos:", error.message);
    return false;
  }
  return true;
}

/**
 * Build uploadedPhotosByCity structure from metadata rows + photo_data map.
 */
export function buildUploadsFromMeta(metaRows, photoDataMap) {
  const result = {};
  for (const row of metaRows) {
    const src = photoDataMap[row.id];
    if (!src) continue; // skip if we don't have the photo data

    const key = row.district ? `${row.city}||${row.district}` : row.city;
    if (!result[key]) {
      result[key] = {
        province: row.province,
        district: row.district || undefined,
        photos: [],
      };
    }
    result[key].photos.push({
      id: row.id,
      src,
      caption: row.caption || "",
      takenAt: row.taken_at || "",
      isLocalUpload: true,
    });
  }
  return result;
}

/**
 * Merge remote data into local data (remote takes precedence for same ID).
 */
export function mergeRemoteIntoLocal(localData, remoteData) {
  if (!remoteData || Object.keys(remoteData).length === 0) return localData;

  const merged = { ...localData };

  for (const [key, remoteValue] of Object.entries(remoteData)) {
    if (!merged[key]) {
      merged[key] = remoteValue;
    } else {
      const localPhotos = Array.isArray(merged[key])
        ? merged[key]
        : merged[key].photos || [];
      const remotePhotos = remoteValue.photos || [];

      const finalPhotos = [];
      const seenIds = new Set();
      for (const p of remotePhotos) {
        if (!seenIds.has(p.id)) { finalPhotos.push(p); seenIds.add(p.id); }
      }
      for (const p of localPhotos) {
        if (!seenIds.has(p.id)) { finalPhotos.push(p); seenIds.add(p.id); }
      }

      merged[key] = {
        province: merged[key].province || remoteValue.province,
        district: merged[key].district || remoteValue.district,
        photos: finalPhotos,
      };
    }
  }

  return merged;
}
