# Flickr Follow Gallery

An unpacked Chrome/Brave extension that turns Flickr feed pages into a full-width gallery of photos from people you follow.

## What it does

- Adds an **Open gallery** button on Flickr pages.
- Automatically opens on likely feed pages such as `/photos/friends` and `/activity`.
- Collects large Flickr photo images that are already loaded in your signed-in browser tab.
- Displays them in a dark, full-width masonry gallery with hover captions, camera/EXIF details when Flickr exposes them, and direct photo links.
- Opens a lightbox viewer with a photo detail sidebar when you click a gallery image.
- Watches the page as you scroll so newly loaded feed photos are added to the gallery.
- Keeps your Flickr API keys, password, and account tokens out of the extension. It only reads the signed-in page you already opened.

## Install in Chrome or Brave

1. Open `chrome://extensions` in Chrome or `brave://extensions` in Brave.
2. Turn on **Developer mode**.
3. Choose **Load unpacked**.
4. Select this folder: `C:\Users\Cory Claxon\Documents\Chromium Extensions\Flickr Follow Gallery`.
5. Open your Flickr following/friends feed and refresh the tab.

## Use

- Click **Open gallery** if it does not open automatically.
- Use **Compact**, **Balanced**, or **Spacious** to change the column size.
- Use **Metadata** to keep captions visible.
- Click a photo to open the lightbox viewer.
- Use `←` and `→` in the lightbox to move between photos.
- Press `Esc` to close the gallery.
- Press `M` while the gallery is open to toggle metadata.

## Notes

- This extension depends on Flickr's current page markup and image URLs. If Flickr changes its feed HTML, the image detector may need an update.
- The gallery can only show photos that Flickr has loaded into the page. Scroll near the bottom of the gallery to nudge Flickr to load more.
- This extension runs only on `flickr.com` and `www.flickr.com`.
