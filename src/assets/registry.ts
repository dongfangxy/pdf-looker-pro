/**
 * Resource-pack loading.
 *
 * Reads the ARPK container that `tools/pack-resources.mjs` produces and turns it
 * into things the interface can use: a registered font face, and object URLs for
 * the icons. Nothing here reads from the filesystem beyond the one pack, which is
 * what lets a packaged build render its icons and font with no external files.
 */
import { openContainer, ArpkError, type Container } from './arpk.mjs';

const DEFAULT_URL = `${import.meta.env.BASE_URL}assets/ui.arpk`;

export interface ResourcePack {
  /** Directory of everything in the pack, for diagnostics. */
  readonly container: Container;
  /** Family name the embedded font was registered under. */
  readonly fontFamily: string;
  /** Object URL for an icon, or null when the pack has no such asset. */
  iconUrl(name: string): string | null;
  /** Releases every object URL created for this pack. */
  dispose(): void;
}

const FONT_ASSET = 'font/ui-sans.ttf';
export const PACK_FONT_FAMILY = 'ARPK Sans';

export async function loadResourcePack(url: string = DEFAULT_URL): Promise<ResourcePack> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new ArpkError('not-found' as never, `resource pack ${url} returned HTTP ${response.status}`);
  }
  const container = openContainer(new Uint8Array(await response.arrayBuffer()));

  // Register the embedded font. `FontFace` takes the raw bytes, so no file or URL
  // for the font ever has to exist.
  let fontFamily = PACK_FONT_FAMILY;
  if (container.has(FONT_ASSET)) {
    const face = new FontFace(fontFamily, await container.read(FONT_ASSET), { style: 'normal', weight: '400' });
    await face.load();
    document.fonts.add(face);
  } else {
    fontFamily = '';
  }

  // Icons are small and needed at startup, so they are materialised up front;
  // `iconUrl` then stays a synchronous lookup.
  const urls = new Map<string, string>();
  for (const asset of container.inLayer(0)) {
    const raw = await container.read(asset.name);
    urls.set(asset.name, URL.createObjectURL(new Blob([raw], { type: 'image/svg+xml' })));
  }

  return {
    container,
    fontFamily,
    iconUrl: (name: string) => urls.get(`ui/${name}.svg`) ?? null,
    dispose: () => {
      for (const value of urls.values()) URL.revokeObjectURL(value);
      urls.clear();
    },
  };
}
