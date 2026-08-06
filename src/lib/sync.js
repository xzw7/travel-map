import { supabase } from "./supabase";

const TABLE = "travel_photos";

/**
 * Fetch all photos from Supabase DB, group by city/district key.
 * Returns the same shape as uploadedPhotosByCity in App.jsx.
 */
export async function fetchRemotePhotos() {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("fetchRemotePhotos failed:", {
      message: error.message,
      details: error.details,
      hint: error.hint,
      code: error.code,
      status: error.status,
    });
    return null;
  }

  const result = {};
  for (const row of data || []) {
    const key = row.district
      ? `${row.city}||${row.district}`
      : row.city;
    if (!result[key]) {
      result[key] = {
        province: row.province,
        district: row.district || undefined,
        photos: [],
      };
    }
    result[key].photos.push({
      id: row.id,
      src: row.photo_data,
      caption: row.caption || "",
      takenAt: row.taken_at || "",
      isLocalUpload: true,
    });
  }
  return result;
}

/**
 * Upload a single photo to Supabase DB (stores base64 directly).
 * @param {string} photoId
 * @param {string} base64Src - base64 data URI
 * @param {{ province, city, district, caption, takenAt }} metadata
 * @returns {string|null} - the base64 src on success, null on failure
 */
export async function uploadPhotoToRemote(photoId, base64Src, metadata) {
  const { province, city, district, caption, takenAt } = metadata;

  try {
    // Check if already uploaded
    const { data: existingRow, error: checkError } = await supabase
      .from(TABLE)
      .select("id")
      .eq("id", photoId)
      .maybeSingle();

    if (checkError) {
      console.error("Check existing failed:", checkError.message, checkError.details);
    }

    if (existingRow) {
      // Already in DB
      return base64Src;
    }

    // Insert directly into DB (no Storage needed)
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
      console.error(
        "DB insert failed:",
        insertError.message,
        "Details:",
        insertError.details,
        "Hint:",
        insertError.hint,
      );
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
  const { error } = await supabase
    .from(TABLE)
    .delete()
    .eq("id", photoId);

  if (error) {
    console.error("Failed to delete remote photo:", error.message, error.details);
    return false;
  }
  return true;
}

/**
 * Delete all photos for a specific city/district from remote.
 */
export async function deleteRemoteTrip(province, city, district) {
  let query = supabase
    .from(TABLE)
    .delete()
    .eq("province", province)
    .eq("city", city);

  if (district) {
    query = query.eq("district", district);
  }

  const { error } = await query;

  if (error) {
    console.error("Failed to delete remote trip photos:", error.message, error.details);
    return false;
  }
  return true;
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
      // Remote first (higher priority for cross-device sync)
      for (const p of remotePhotos) {
        if (!seenIds.has(p.id)) {
          finalPhotos.push(p);
          seenIds.add(p.id);
        }
      }
      // Local photos that aren't in remote
      for (const p of localPhotos) {
        if (!seenIds.has(p.id)) {
          finalPhotos.push(p);
          seenIds.add(p.id);
        }
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
