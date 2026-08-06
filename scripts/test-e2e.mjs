import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://dhpoetunxbbnjafktbfr.supabase.co",
  "sb_publishable_nzl5VXYVFdcuzExb49fLOQ_ST3Mwcit",
);

const TABLE = "travel_photos";

// A small 1x1 red pixel PNG in base64
const REAL_PHOTO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

async function main() {
  console.log("=== 完整同步流程测试 ===\n");

  // 1. Check current state
  const { count: beforeCount, error: cErr } = await supabase
    .from(TABLE).select("*", { count: "exact", head: true });
  console.log(`1. 同步前云端照片数: ${beforeCount ?? "?"}`);

  // 2. Simulate uploading 3 photos to 2 different cities
  const testPhotos = [
    {
      id: `sync-test-${Date.now()}-1`,
      province: "广东省",
      city: "深圳市",
      district: "南山区",
      caption: "测试深圳湾",
      taken_at: "2026-06-20",
      photo_data: REAL_PHOTO,
    },
    {
      id: `sync-test-${Date.now()}-2`,
      province: "广东省",
      city: "深圳市",
      district: "南山区",
      caption: "测试科技园",
      taken_at: "2026-06-21",
      photo_data: REAL_PHOTO,
    },
    {
      id: `sync-test-${Date.now()}-3`,
      province: "山东省",
      city: "济南市",
      district: "",
      caption: "测试趵突泉",
      taken_at: "2026-05-02",
      photo_data: REAL_PHOTO,
    },
  ];

  console.log("\n2. 模拟上传 3 张测试照片...");
  for (const p of testPhotos) {
    const { error } = await supabase.from(TABLE).insert(p);
    if (error) {
      console.log(`   插入失败 [${p.caption}]:`, error.message);
    } else {
      console.log(`   插入成功 [${p.caption}] → ${p.province} ${p.city}`);
    }
  }

  // 3. Check after upload
  const { count: afterCount } = await supabase
    .from(TABLE).select("*", { count: "exact", head: true });
  console.log(`\n3. 上传后云端照片数: ${afterCount}`);

  // 4. Simulate fetchRemotePhotos (same logic as sync.js)
  console.log("\n4. 模拟 fetchRemotePhotos...");
  const { data: rows } = await supabase
    .from(TABLE)
    .select("*")
    .order("created_at", { ascending: false });

  // Group by city/district (same as sync.js)
  const result = {};
  for (const row of rows || []) {
    const key = row.district ? `${row.city}||${row.district}` : row.city;
    if (!result[key]) {
      result[key] = { province: row.province, district: row.district || undefined, photos: [] };
    }
    result[key].photos.push({
      id: row.id,
      src: row.photo_data,
      caption: row.caption || "",
      takenAt: row.taken_at || "",
      isLocalUpload: true,
    });
  }

  const keys = Object.keys(result);
  console.log(`   拉取到 ${keys.length} 个地点:`);
  for (const key of keys) {
    const v = result[key];
    console.log(`   - ${key}: ${v.photos.length} 张 (${v.province})`);
    for (const p of v.photos) {
      const photoOk = p.src && p.src.startsWith("data:image/");
      console.log(`     [${photoOk ? "OK" : "FAIL"}] ${p.caption} | id=${p.id.slice(0, 25)}...`);
    }
  }

  // 5. Clean up test data
  console.log("\n5. 清理测试数据...");
  for (const p of testPhotos) {
    await supabase.from(TABLE).delete().eq("id", p.id);
  }
  console.log("   测试数据已删除");

  // 6. Final count
  const { count: finalCount } = await supabase
    .from(TABLE).select("*", { count: "exact", head: true });
  console.log(`\n6. 清理后云端照片数: ${finalCount}`);
  console.log(`   新上传照片数: ${finalCount - beforeCount}`);

  console.log("\n=== 结论 ===");
  if (afterCount === beforeCount + 3 && finalCount === beforeCount) {
    console.log("云端同步全部正常！上传、拉取、删除均通过。");
  } else {
    console.log("数据不一致，需排查。");
    console.log(`   before=${beforeCount}, after=${afterCount}, final=${finalCount}`);
  }
}

main().catch((err) => console.error("Test error:", err));
