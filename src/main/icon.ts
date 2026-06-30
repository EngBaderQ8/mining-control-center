import { nativeImage, type NativeImage } from "electron";

// Embedded 32×32 app/tray icon (blue rounded square + white bar-chart mark), so
// the tray works in the packaged app without shipping a separate icon file.
const ICON_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAABMklEQVR42s3Xx1KDMQwE4DwehN7LiRpK6BDqu1JD74R6Wm7yRJLt2PHvyc58F43H2qNdKnV6pk/+0I64pce/KEJLy6eOflAk9/LDb+SgLp88+EJOosDE/idykgVqDaTAYzvXtHy81kAqPK6zVGBs7wOp8LjOmgK770hFFHCcpQKjO29Ihcd11hTYfkUoscgz11CBka0XhOLxzTVUYHjzGaF4fHONKbDxhFBikWeuoQJD648IxeOba6jA4NoDbHhi5xpToHoPG3Fh5FxDBQZW72DDEzvXmAIrt7ARF0bONVSgf/kGNjyxcw0V6Fu6hg1P7FxjClTqsBEXRs41TW+C3kodOYkXUc/iFXKSBRYukZP6Mi7PXyAH59+gPHeOIrX0O+qePUMRov6JXTOnaEfH/77/Afi/UiBT9BaTAAAAAElFTkSuQmCC";

let cached: NativeImage | null = null;

/** The app icon as a NativeImage (used for the tray and the window). */
export function appIcon(): NativeImage {
  if (!cached) cached = nativeImage.createFromDataURL(`data:image/png;base64,${ICON_PNG_BASE64}`);
  return cached;
}
