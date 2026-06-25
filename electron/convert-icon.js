const { app, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

// We use app.whenReady() because Electron APIs require the app to be ready
app.whenReady().then(() => {
  try {
    const srcPath = 'C:\\Users\\Symphonics Co. Ltd\\.gemini\\antigravity-ide\\brain\\3fcb112a-e587-4b80-9294-6399d84a5561\\secure_exam_icon_1782371884093.png';
    const buildDir = path.join(__dirname, 'build');

    if (!fs.existsSync(buildDir)) {
      fs.mkdirSync(buildDir, { recursive: true });
    }

    // 1. Copy source PNG to build/icon.png
    fs.copyFileSync(srcPath, path.join(buildDir, 'icon.png'));
    console.log('Copied PNG to build/icon.png');

    // 2. Load image and generate ICO
    const img = nativeImage.createFromPath(srcPath);
    if (img.isEmpty()) {
      throw new Error('Failed to load source image.');
    }

    const sizes = [256, 48, 32, 16];
    const pngs = sizes.map(size => {
      const resized = img.resize({ width: size, height: size, quality: 'best' });
      return {
        size,
        buffer: resized.toPNG()
      };
    });

    // ICO file format construction
    // Header: 6 bytes
    const header = Buffer.alloc(6);
    header.writeUInt16LE(0, 0); // Reserved
    header.writeUInt16LE(1, 2); // Type (1 for icon)
    header.writeUInt16LE(pngs.length, 4); // Number of images

    // Directory entries: 16 bytes per image
    const entries = [];
    let currentOffset = 6 + pngs.length * 16;

    pngs.forEach(png => {
      const entry = Buffer.alloc(16);
      const w = png.size === 256 ? 0 : png.size;
      const h = png.size === 256 ? 0 : png.size;

      entry.writeUInt8(w, 0); // Width
      entry.writeUInt8(h, 1); // Height
      entry.writeUInt8(0, 2); // Color palette (0 for no palette)
      entry.writeUInt8(0, 3); // Reserved
      entry.writeUInt16LE(1, 4); // Color planes
      entry.writeUInt16LE(32, 6); // Bits per pixel
      entry.writeUInt32LE(png.buffer.length, 8); // Image size
      entry.writeUInt32LE(currentOffset, 12); // Offset

      entries.push(entry);
      currentOffset += png.buffer.length;
    });

    // Write final ICO file
    const icoPath = path.join(buildDir, 'icon.ico');
    const writeStream = fs.createWriteStream(icoPath);
    writeStream.write(header);
    entries.forEach(entry => writeStream.write(entry));
    pngs.forEach(png => writeStream.write(png.buffer));
    writeStream.end();

    console.log(`Successfully generated Windows icon: ${icoPath}`);

    // 3. Create dummy entitlements file to prevent macOS builder complaining if it checks it
    const entitlementsPath = path.join(buildDir, 'entitlements.mac.plist');
    const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>com.apple.security.files.user-selected.read-write</key>
    <true/>
  </dict>
</plist>
`;
    fs.writeFileSync(entitlementsPath, plistContent);
    console.log(`Created Mac entitlements file: ${entitlementsPath}`);

    app.quit();
  } catch (err) {
    console.error('Error during icon generation:', err);
    process.exit(1);
  }
});
