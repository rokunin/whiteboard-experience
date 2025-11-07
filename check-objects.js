// Browser console code to check objects in DB
// Copy and paste this into the browser console

(async function checkObjects() {
  const MODID = "whiteboard-experience";
  const FLAG_KEY_TEXTS = "texts";
  const FLAG_KEY_IMAGES = "images";
  
  // Get objects from database
  const dbTexts = await canvas.scene?.getFlag(MODID, FLAG_KEY_TEXTS) || {};
  const dbImages = await canvas.scene?.getFlag(MODID, FLAG_KEY_IMAGES) || {};
  
  // Get fate cards - try multiple sources
  // Note: FLAG_KEY was deleted, but cards should be under "cards" flag (see main.mjs:1791)
  let dbCards = {};
  
  // Try 1: Direct flag access (based on comment: scene.flags[MODID].cards)
  try {
    dbCards = await canvas.scene?.getFlag(MODID, "cards") || {};
  } catch (e) {
    console.warn("Could not retrieve cards from flags:", e);
  }
  
  // Try 2: Check if cards exist in memory (FateTableCardApp.instances)
  // This is a fallback if cards are loaded but flag access fails
  if (Object.keys(dbCards).length === 0 && window.FateTableCardApp?.instances) {
    const instances = window.FateTableCardApp.instances;
    if (instances && instances.size > 0) {
      console.log("Found cards in memory (FateTableCardApp.instances), but not in flags");
      // Convert instances to object format for display
      dbCards = {};
      instances.forEach((app, id) => {
        if (app.cardData) {
          dbCards[id] = app.cardData;
        }
      });
    }
  }
  
  // Count objects
  const textCount = Object.keys(dbTexts).length;
  const imageCount = Object.keys(dbImages).length;
  const cardCount = Object.keys(dbCards).length;
  
  // Display results
  console.log('\n=== OBJECTS IN DATABASE ===\n');
  console.log(`📝 Texts: ${textCount}`);
  if (textCount > 0) {
    Object.keys(dbTexts).forEach(id => {
      const text = dbTexts[id]?.text?.substring(0, 50) || '(empty)';
      console.log(`   - ${id}: "${text}"`);
    });
  }
  
  console.log(`\n🖼️  Images: ${imageCount}`);
  if (imageCount > 0) {
    Object.keys(dbImages).forEach(id => {
      const src = dbImages[id]?.src || '(no src)';
      const fileName = src.split('/').pop() || src;
      console.log(`   - ${id}: ${fileName}`);
    });
  }
  
  console.log(`\n🃏 Fate Cards: ${cardCount}`);
  if (cardCount > 0) {
    Object.keys(dbCards).forEach(id => {
      const name = dbCards[id]?.name || '(unnamed)';
      console.log(`   - ${id}: "${name}"`);
    });
  }
  
  console.log(`\n📊 Total: ${textCount + imageCount + cardCount} objects\n`);
  
  // Return data for further inspection
  return {
    texts: dbTexts,
    images: dbImages,
    cards: dbCards,
    counts: {
      texts: textCount,
      images: imageCount,
      cards: cardCount,
      total: textCount + imageCount + cardCount
    }
  };
})();

