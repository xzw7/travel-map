import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://dhpoetunxbbnjafktbfr.supabase.co";
const supabaseKey = "sb_publishable_nzl5VXYVFdcuzExb49fLOQ_ST3Mwcit";
const supabase = createClient(supabaseUrl, supabaseKey);

const TABLE = "travel_photos";

async function main() {
  console.log("=== 1. 检查表是否存在 ===\n");

  const { data: rows, error: fetchError } = await supabase
    .from(TABLE)
    .select("*")
    .limit(5);

  if (fetchError) {
    console.log("查询失败:", fetchError.message);
    console.log("详情:", JSON.stringify(fetchError, null, 2));
    return;
  }

  console.log(`当前表中共有 ${rows.length} 条记录（仅显示前 5 条）`);
  if (rows.length === 0) {
    console.log("（表为空，尝试插入测试数据）\n");
  }

  // Show first row summary
  for (const row of rows) {
    console.log(`  - ${row.id.slice(0, 20)}... | ${row.province} ${row.city} ${row.district || ""} | ${row.caption || ""} | photo: ${row.photo_data ? row.photo_data.slice(0, 50) + "..." : "无"}`);
  }

  console.log("\n=== 2. 测试插入 ===");
  const testId = `test-${Date.now()}`;
  const testPhoto = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

  const { error: insertError } = await supabase
    .from(TABLE)
    .insert({
      id: testId,
      province: "测试省",
      city: "测试市",
      district: "",
      caption: "自动验证测试",
      taken_at: "2026-08-06",
      photo_data: testPhoto,
    });

  if (insertError) {
    console.log("插入失败:", insertError.message);
    console.log("错误详情:", insertError.details);
    console.log("提示:", insertError.hint);
    console.log("完整错误:", JSON.stringify(insertError, null, 2));
    return;
  }

  console.log("插入成功:", testId);

  console.log("\n=== 3. 验证插入 ===");
  const { data: check } = await supabase
    .from(TABLE)
    .select("id, province, city")
    .eq("id", testId)
    .maybeSingle();

  if (check) {
    console.log("验证通过: 数据已持久化");
    console.log(`  省份: ${check.province}, 城市: ${check.city}`);
  } else {
    console.log("验证失败: 查询不到刚插入的数据");
    return;
  }

  console.log("\n=== 4. 测试删除 ===");
  const { error: deleteError } = await supabase
    .from(TABLE)
    .delete()
    .eq("id", testId);

  if (deleteError) {
    console.log("删除失败:", deleteError.message);
    return;
  }
  console.log("删除成功: 测试数据已清理");

  console.log("\n=== 5. 结论 ===");
  console.log("Supabase DB 读写删除全部正常！云端同步功能可用。");

  // Count total
  const { count, error: countError } = await supabase
    .from(TABLE)
    .select("*", { count: "exact", head: true });

  if (!countError) {
    console.log(`\n当前云端共有 ${count ?? 0} 张照片。`);
  }
}

main().catch((err) => {
  console.error("脚本异常:", err);
});
