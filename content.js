// Content Script for Smart CORS Bypass
// Runs on document start to set and maintain the extension state attribute on the HTML element

try {
  chrome.storage.local.get(["enabled"], (result) => {
    const isEnabled = result.enabled !== false;
    document.documentElement.setAttribute("data-smart-cors-extension", isEnabled ? "true" : "false");
  });

  // Listen for storage changes to update the DOM attribute in real-time
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.enabled) {
      const isEnabled = changes.enabled.newValue;
      document.documentElement.setAttribute("data-smart-cors-extension", isEnabled ? "true" : "false");
    }
  });
} catch (e) {
  console.error("Smart CORS Bypass extension detection failed:", e);
}
