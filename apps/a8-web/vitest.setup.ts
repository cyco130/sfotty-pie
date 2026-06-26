// Install a fake IndexedDB on the Node global so the image-library stores can
// be unit-tested without a browser. Each test file gets a fresh in-memory DB.
import "fake-indexeddb/auto";
