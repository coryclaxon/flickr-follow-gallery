(function () {
  "use strict";

  const STORAGE_KEY = "ffgOptions";
  const DEFAULTS = {
    enabled: true,
    autoOpen: true,
    showMeta: false,
    density: "balanced"
  };

  const fields = {
    autoOpen: document.getElementById("autoOpen"),
    showMeta: document.getElementById("showMeta"),
    density: document.getElementById("density"),
    saved: document.getElementById("saved")
  };

  load();

  fields.autoOpen.addEventListener("change", save);
  fields.showMeta.addEventListener("change", save);
  fields.density.addEventListener("change", save);

  function load() {
    chrome.storage.sync.get([STORAGE_KEY], (result) => {
      const options = { ...DEFAULTS, ...(result[STORAGE_KEY] || {}) };
      fields.autoOpen.checked = Boolean(options.autoOpen);
      fields.showMeta.checked = Boolean(options.showMeta);
      fields.density.value = options.density || DEFAULTS.density;
    });
  }

  function save() {
    const options = {
      enabled: true,
      autoOpen: fields.autoOpen.checked,
      showMeta: fields.showMeta.checked,
      density: fields.density.value
    };

    chrome.storage.sync.set({ [STORAGE_KEY]: options }, () => {
      fields.saved.textContent = "Saved";
      clearTimeout(save.timer);
      save.timer = setTimeout(() => {
        fields.saved.textContent = "";
      }, 1500);
    });
  }
})();
