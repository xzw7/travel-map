import { supabase } from "./supabase";

const BUCKET = "photos";
const TABLE = "travel_photos";

// Convert base64 data URI to Blob
function base64ToBlob(dataUri) {
  const [header, data] = dataUri.split(",");
  const mimeMatch = header.match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : "image/jpeg";
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

// Generate a storage path for a photo
function buildStoragePath(province, city, district, photoId) {
  const folder = district
    ? `${province}/${city}/${district}`
    : `${province}/${city}`;
  return `${folder}/${photoId}.jpg`;
}

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
    console.error("Failed to fetch remote photos:", error);
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
      src: row.photo_url,
      caption: row.caption || "",
      takenAt: row.taken_at || "",
      isLocalUpload: true,
    });
  }
  return result;
}

/**
 * Upload a single photo to Supabase Storage + DB.
 * @param {string} photoId - unique ID for the photo
 * @param {string} base64Src - base64 data URI
 * @param {object} metadata - { province, city, district, caption, takenAt }
 * @returns {string|null} - public URL on success, null on failure
 */
export async function uploadPhotoToRemote(photoId, base64Src, metadata) {
  const { province, city, district, caption, takenAt } = metadata;
  const storagePath = buildStoragePath(province, city, district, photoId);

  let photoUrl = null;

  // Check if already uploaded (skip duplicate uploads)
  const { data: existingRow } = await supabase
    .from(TABLE)
    .select("id")
    .eq("id", photoId)
    .maybeSingle();

  if (existingRow) {
    // Photo already exists remotely, skip upload
    return null; // return null to signal "already exists"
  }

  try {
    const blob = base64ToBlob(base64Src);

    // 1. Upload to Storage
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, blob, {
        contentType: blob.type,
        upsert: true,
      });

    if (uploadError) {
      console.error("Storage upload failed:", uploadError);
      return null;
    }

    // 2. Get public URL
    const { data: urlData } = supabase.storage
      .from(BUCKET)
      .getPublicUrl(storagePath);

    photoUrl = urlData.publicUrl;

    // 3. Insert DB row
    const { error: insertError } = await supabase
      .from(TABLE)
      .insert({
        id: photoId,
        province,
        city,
        district: district || "",
        photo_url: photoUrl,
        caption: caption || "",
        taken_at: takenAt || "",
        storage_path: storagePath,
      });

    if (insertError) {
      console.error("DB insert failed:", insertError);
      // Try to clean up the uploaded file
      await supabase.storage.from(BUCKET).remove([storagePath]);
      return null;
    }

    return photoUrl;
  } catch (err) {
    console.error("Upload failed:", err);
    return null;
  }
}

/**
 * Delete a photo from Supabase Storage + DB.
 */
export async function deleteRemotePhoto(photoId) {
  // 1. Get the storage path from DB
  const { data: row } = await supabase
    .from(TABLE)
    .select("storage_path")
    .eq("id", photoId)
    .maybeSingle();

  if (row?.storage_path) {
    // 2. Delete from Storage
    await supabase.storage.from(BUCKET).remove([row.storage_path]);
  }

  // 3. Delete from DB
  const { error } = await supabase
    .from(TABLE)
    .delete()
    .eq("id", photoId);

  if (error) {
    console.error("Failed to delete remote photo:", error);
    return false;
  }
  return true;
}

/**
 * Delete all photos for a specific city/district from remote.
 */
export async function deleteRemoteTrip(province, city, district) {
  // 1. Get all rows for this trip
  let query = supabase
    .from(TABLE)
    .select("id, storage_path")
    .eq("province", province)
    .eq("city", city);

  if (district) {
    query = query.eq("district", district);
  }

  const { data: rows } = await query;

  if (!rows || rows.length === 0) return true;

  // 2. Delete from Storage (batch)
  const paths = rows.map((r) => r.storage_path).filter(Boolean);
  if (paths.length > 0) {
    await supabase.storage.from(BUCKET).remove(paths);
  }

  // 3. Delete from DB
  const ids = rows.map((r) => r.id);
  const { error } = await supabase
    .from(TABLE)
    .delete()
    .in("id", ids);

  if (error) {
    console.error("Failed to delete remote trip photos:", error);
    return false;
  }
  return true;
}

/**
 * Merge remote data into local data (remote takes precedence for same ID).
 * Returns the merged object.
 */
export function mergeRemoteIntoLocal(localData, remoteData) {
  if (!remoteData || Object.keys(remoteData).length === 0) return localData;

  const merged = { ...localData };

  for (const [key, remoteValue] of Object.entries(remoteData)) {
    if (!merged[key]) {
      // New city/district from remote
      merged[key] = remoteValue;
    } else {
      // Merge photos, remote takes precedence by ID
      const localPhotos = Array.isArray(merged[key])
        ? merged[key]
        : merged[key].photos || [];
      const remotePhotos = remoteValue.photos || [];

      const mergedPhotos = [...localPhotos];
      const localIds = new Set(localPhotos.map((p) => p.id));

      for (const rp of remotePhotos) {
        if (!localIds.has(rp.id)) {
          mergedPhotos.push(rp);
        }
        // If same ID exists in both, keep local (base64) for offline,
        // but the remote URL is also stored in the merged result
        // Actually, let remote URL take precedence since it's accessible cross-device
      }

      // Update: remote photos should take precedence (URL > base64 for cross-device)
      const finalPhotos = [];
      const seenIds = new Set();
      // Remote first (higher priority)
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
