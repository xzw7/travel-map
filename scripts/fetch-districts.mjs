import { writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = resolve(__dirname, "..", "public", "maps");

// 广东省 21 个地级市的 adcode
const GUANGDONG_CITIES = [
  { name: "广州市", adcode: 440100 },
  { name: "韶关市", adcode: 440200 },
  { name: "深圳市", adcode: 440300 },
  { name: "珠海市", adcode: 440400 },
  { name: "汕头市", adcode: 440500 },
  { name: "佛山市", adcode: 440600 },
  { name: "江门市", adcode: 440700 },
  { name: "湛江市", adcode: 440800 },
  { name: "茂名市", adcode: 440900 },
  { name: "肇庆市", adcode: 441200 },
  { name: "惠州市", adcode: 441300 },
  { name: "梅州市", adcode: 441400 },
  { name: "汕尾市", adcode: 441500 },
  { name: "河源市", adcode: 441600 },
  { name: "阳江市", adcode: 441700 },
  { name: "清远市", adcode: 441800 },
  { name: "东莞市", adcode: 441900 },
  { name: "中山市", adcode: 442000 },
  { name: "潮州市", adcode: 445100 },
  { name: "揭阳市", adcode: 445200 },
  { name: "云浮市", adcode: 445300 },
];

// 其他省份如需扩展，在此添加
const PROVINCE_CONFIG = {
  "440000": { name: "广东省", cities: GUANGDONG_CITIES },
};

const DATA_V_BASE = "https://geo.datav.aliyun.com/areas_v3/bound";

async function fetchJson(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
  return resp.json();
}

function formatFeature(feature, provinceAdcode) {
  const props = feature.properties;
  return {
    type: "Feature",
    properties: {
      adcode: props.adcode,
      name: props.name,
      level: props.level || "district",
      parent: { adcode: props.parent?.adcode },
      province: props.name,
      provinceAdcode: provinceAdcode,
    },
    geometry: feature.geometry,
  };
}

async function fetchProvinceDistricts(provinceAdcode, cities) {
  console.log(`\nFetching district data for province ${provinceAdcode} (${cities.length} cities)...`);

  const allFeatures = [];
  let successCount = 0;

  for (const city of cities) {
    const url = `${DATA_V_BASE}/${city.adcode}_full.json`;
    try {
      console.log(`  ${city.name} (${city.adcode})...`);
      const geojson = await fetchJson(url);
      const features = geojson.features || [];
      for (const f of features) {
        allFeatures.push(formatFeature(f, provinceAdcode));
      }
      console.log(`    ${features.length} districts`);
      successCount++;
    } catch (err) {
      console.warn(`  ${city.name}: FAILED - ${err.message}`);
    }
  }

  return { features: allFeatures, successCount, totalCities: cities.length };
}

async function main() {
  const targetProvince = process.argv[2] || "440000";

  const config = PROVINCE_CONFIG[targetProvince];
  if (!config) {
    console.error(`Unknown province adcode: ${targetProvince}`);
    console.log("Available provinces:");
    for (const [code, cfg] of Object.entries(PROVINCE_CONFIG)) {
      console.log(`  ${code} - ${cfg.name}`);
    }
    process.exit(1);
  }

  await mkdir(DIST_DIR, { recursive: true });

  const result = await fetchProvinceDistricts(targetProvince, config.cities);

  const collection = {
    type: "FeatureCollection",
    features: result.features,
  };

  const outFile = `${targetProvince}_districts.json`;
  const outPath = resolve(DIST_DIR, outFile);
  const json = JSON.stringify(collection);
  await writeFile(outPath, json, "utf8");

  const sizeKB = (Buffer.byteLength(json, "utf8") / 1024).toFixed(1);
  console.log(`\nDone! ${result.successCount}/${result.totalCities} cities fetched.`);
  console.log(`Total districts: ${result.features.length}`);
  console.log(`Saved to: public/maps/${outFile} (${sizeKB} KB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
