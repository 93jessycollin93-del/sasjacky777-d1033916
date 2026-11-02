import "@testing-library/jest-dom";

// A test that asks for the node environment (sockets, a real server) has no window.
if (typeof window !== "undefined") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => {},
    }),
  });
}

// jsdom's Blob has no `arrayBuffer()`. It is standard in every browser and in
// Node's own implementation, so code that reads bytes out of a Blob — the Vault
// hands one to ffmpeg — is correct and only fails here. Polyfilled rather than
// worked around at each call site, which would mean shaping production code
// around a gap in the test environment.
if (typeof Blob !== "undefined" && !Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}
