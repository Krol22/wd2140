const fs = require('fs');
const PImage = require('pureimage');

const buffer = fs.readFileSync('./MIX.WD');

function readString(buffer, offset) {
  let position = offset;
  const characters = [];
  while (true) {
    const byte = buffer.readUIntBE(position, 1);
    if (byte === 0) {
      break;
    }
    characters.push(byte);
    position += 1;
  }

  const value = Buffer.from(characters).toString();
  return value;
}

class SmartBuffer {
  constructor (buffer) {
    this.buffer = buffer;
    this.position = 0;
  }

  readInt () {
    const value = this.buffer.readInt32LE(this.position);
    this.position += 4;
    return value;
  }

  readString (length) {
    const value = this.buffer.subarray(this.position, this.position + length);
    this.position += length;

    return value.toString();
  }
  
  readByte () {
    const value = this.buffer.readUIntLE(this.position, 1);
    this.position += 1;
    return value;
  }

  readShort () {
    const value = this.buffer.readUIntLE(this.position, 2);
    this.position += 2;
    return value;
  }

  setPosition (newPosition) {
    this.position = newPosition;
  }
}

class Mix {
  frames = [];
  palettes = [];

  constructor (fileName, buffer) {
    this.fileName = fileName;
    this.buffer = buffer;

    buffer.readString(10); // "MIX FILE  "
    buffer.readInt(); // dataLength

    const dataCount = buffer.readInt();
    const dataOffset = buffer.readInt();
    const paletteCount = buffer.readInt();
    const paletteStartIndex = buffer.readInt();
    buffer.readInt(); // paletteOffset

    buffer.readString(5); // "ENTRY"

    const dataOffsets = [];
    for (let i = 0; i < dataCount; i++) {
      dataOffsets.push(buffer.readInt() + dataOffset);
    }

    buffer.readString(5); // " PAL "

    for (let i = 0; i < paletteCount; i++) {
      this.palettes.push([]);
      for (let j = 0; j < 256; j++) {
        const r = buffer.readByte();
        const g = buffer.readByte();
        const b = buffer.readByte();
        const a = 0xFF;

        if (244 <= j && j <= 247) {
          this.palettes[i].push({
            r: 0,
            g: 0,
            b: 0,
          })
        } else {
          this.palettes[i].push({
            r,
            g,
            b,
            a,
          });
        }

        // 0x00 -> 0xF3 - texture color;
        // 0xF4 -> 0xF7 - light color;
        // 0xF8 -> 0xFD - faction color;
        // 0xFE -> 0xFF - shadow color;
      }
    }

    for (let i = 0; i < dataCount; i++) {
      buffer.setPosition(dataOffsets[i]);
      this.frames.push(this.readFrame(buffer, paletteStartIndex));
    }
  }

  readFrame(buffer, paletteStartIndex) {
    const frame = {};
    frame.width = buffer.readShort();
    frame.height = buffer.readShort();
    frame.pixelsIndexed = new Array(frame.width * frame.height);

    const format = buffer.readByte();
    frame.paletteIndex = buffer.readByte() - paletteStartIndex;

    // #TODO there is also 1 and 2 but for now only 9 is handeled
    if (format === 9) {
      frame.pixelsIndexed = [];

      buffer.readInt(); // width duplicate
      buffer.readInt(); // height duplicate
      buffer.readInt(); // dataBlockLength

      const scanLinesCount = buffer.readInt();
      const segmentBlockLength = buffer.readInt();

      buffer.readInt(); // headerInfoBlockSize
      buffer.readInt(); // height * 2 + 38
      buffer.readInt(); // height * 4 + 40
      buffer.readInt(); // headerBlockLength

      const scanLines = [];
      const dataOffsets = [];

      for (let i = 0; i < scanLinesCount; i++) {
        scanLines.push(buffer.readShort());
      }

      for (let i = 0; i < scanLinesCount; i++) {
        dataOffsets.push(buffer.readShort());
      }

      const segments = [];

      for (let i = 0; i < segmentBlockLength; i++) {
        segments.push(buffer.readByte());
      }

      const dataBlockOffset = buffer.position;
      let writePosition = 0;

      for (let i = 0; i < scanLinesCount; i++) {
        const line = scanLines[i] / 2;

        if (i + 1 < scanLines.length) {
          const nextLine = scanLines[i + 1] / 2;
          buffer.setPosition(dataBlockOffset + dataOffsets[i]);
          let lineSize = 0;

          for (let segmentIndex = line; segmentIndex < nextLine; segmentIndex++) {
            const skip = segments[segmentIndex * 2];
            writePosition += skip;

            const pixels = segments[segmentIndex * 2 + 1];

            for (let j = 0; j < pixels; j++) {
              frame.pixelsIndexed[writePosition] = buffer.readByte();
              writePosition++;
            }

            lineSize += skip + pixels;
          }

          writePosition += frame.width - lineSize;
        }
      }
    }

    return frame;
  }
}

const smartBuffer = new SmartBuffer(buffer);

const numberOfFiles = smartBuffer.readInt();
const fileNamesOffset = smartBuffer.position + numberOfFiles * 24 + 4;

const files = {};

for (let i = 0; i < numberOfFiles; i++) {
  const offset = smartBuffer.readInt();
  const length = smartBuffer.readInt();

  smartBuffer.readInt(); // 0
  smartBuffer.readInt(); // 0
  smartBuffer.readInt(); // unknown

  const fileNameOffset = smartBuffer.readInt();
  const fileName = readString(buffer, fileNamesOffset + fileNameOffset);

  const bufferBlock = buffer.subarray(offset, offset + length);
  files[fileName] = new SmartBuffer(bufferBlock);
}

let mix;

Object.keys(files)
  .filter(key => key === 'SPRB0.MIX') // #TODO just for easy debugging
  .forEach(key => {
    mix = new Mix(key, files[key]);
  });

mix.frames.forEach((frame, index) => {
  const img1 = PImage.make(frame.width, frame.height);
  const ctx = img1.getContext('2d');
  for (let y = 0; y < frame.height; y++) {
    for (let x = 0; x < frame.width; x++) {
      const color = mix.palettes[frame.paletteIndex][frame.pixelsIndexed[x + y * frame.width] & 0xff];
      const { r, g, b } = color;
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.fillRect(x,y,1,1);
    }
  }

  PImage.encodePNGToStream(img1, fs.createWriteStream(`frames/frame${index}.png`));
})

mix.palettes.forEach((palette, index) => {
  const img = PImage.make(16 * 10, 16 * 10);
  const ctx = img.getContext('2d');
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const color = palette[x + y * 16];
      const { r, g, b } = color;
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.fillRect(x * 10, y * 10, 10, 10);
    }
  }

  PImage.encodePNGToStream(img, fs.createWriteStream(`frames/palette${index}.png`));
});
