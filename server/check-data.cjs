const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");

const VALID_TYPES = new Set([
  "zone_residential",
  "zone_commercial",
  "zone_industrial",
  "road_dirt",
  "road_street",
  "road_avenue",
  "road_highway",
  "park",
]);

async function checkData() {
  try {
    const files = await fs.promises.readdir(DATA_DIR);
    console.log(`Checking ${files.length} files in ${DATA_DIR}...`);

    for (const file of files) {
      if (!file.endsWith(".json") || file.startsWith("world_")) continue;

      const content = await fs.promises.readFile(
        path.join(DATA_DIR, file),
        "utf-8",
      );
      try {
        const city = JSON.parse(content);

        if (!city.buildings) continue;

        let errorCount = 0;
        for (const b of city.buildings) {
          if (!VALID_TYPES.has(b.type)) {
            console.error(
              `ERROR in ${file}: Building "${b.id}" has invalid type "${b.type}"`,
            );
            errorCount++;
          }
        }
        if (errorCount > 0) {
          console.log(`Found ${errorCount} errors in ${file}`);
        }
      } catch (e) {
        console.error(`Error parsing ${file}:`, e.message);
      }
    }
    console.log("Check complete.");
  } catch (e) {
    console.error("Fatal error:", e);
  }
}

checkData();
