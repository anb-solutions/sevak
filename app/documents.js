// Documents for organizations, events and profiles (prototype).
// Each document's details are kept in localStorage; the file itself is kept
// in IndexedDB, which has room for larger files. Nothing leaves the browser.
//
// A document belongs to an owner: "org:<id>", "event:<id>" or
// "profile:<email>" (a person's own documents, such as their certificates).
// Older profile documents were owned by "profile"; they move to the person
// whose profile is saved in this browser.
(function () {
  "use strict";

  var KEY = "sevak.documents.v1";
  var PROFILE_KEY = "sevak.profile.v1";
  var DB_NAME = "sevak-files";
  var STORE = "files";
  var MAX_BYTES = 10 * 1024 * 1024;
  var F = window.SevakForms;

  // ---------- Details (localStorage) ----------

  function all() {
    var list = F.load(KEY);
    return Array.isArray(list) ? list : [];
  }

  function forOwner(owner) {
    return all().filter(function (d) { return d.owner === owner; });
  }

  function saveDoc(doc) {
    var list = all();
    var i = list.findIndex(function (d) { return d.id === doc.id; });
    if (i === -1) list.push(doc); else list[i] = doc;
    return F.store(KEY, list);
  }

  // ---------- Files (IndexedDB) ----------

  var dbPromise = null;
  function db() {
    if (!dbPromise) {
      dbPromise = new Promise(function (resolve, reject) {
        try {
          var req = indexedDB.open(DB_NAME, 1);
          req.onupgradeneeded = function () { req.result.createObjectStore(STORE); };
          req.onsuccess = function () { resolve(req.result); };
          req.onerror = function () { reject(req.error); };
        } catch (e) { reject(e); }
      });
    }
    return dbPromise;
  }

  function tx(mode, run) {
    return db().then(function (d) {
      return new Promise(function (resolve, reject) {
        var t = d.transaction(STORE, mode);
        var req = run(t.objectStore(STORE));
        t.oncomplete = function () { resolve(req && req.result); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error); };
      });
    });
  }

  function putFile(id, blob) { return tx("readwrite", function (s) { return s.put(blob, id); }); }
  function getFile(id) { return tx("readonly", function (s) { return s.get(id); }); }
  function deleteFile(id) { return tx("readwrite", function (s) { return s.delete(id); }); }

  // Removes files whose document was deleted elsewhere (for example with
  // its organization or event).
  function sweep() {
    var keep = {};
    all().forEach(function (d) { keep[d.id] = true; });
    return tx("readonly", function (s) { return s.getAllKeys(); }).then(function (keys) {
      return Promise.all((keys || []).filter(function (k) { return !keep[k]; }).map(deleteFile));
    }).catch(function () { /* ignore */ });
  }

  function remove(id) {
    F.store(KEY, all().filter(function (d) { return d.id !== id; }));
    return deleteFile(id).catch(function () { /* ignore */ });
  }

  // Deletes every document of the given owners. Used when a profile is deleted.
  function removeFor(owners) {
    F.store(KEY, all().filter(function (d) { return owners.indexOf(d.owner) === -1; }));
    return sweep();
  }

  // ---------- Owners ----------

  function profileOwner(email) {
    var e = String(email || "").trim().toLowerCase();
    return e ? "profile:" + e : null;
  }

  function moveOwner(from, to) {
    if (!from || !to || from === to) return;
    var list = all();
    if (!list.some(function (d) { return d.owner === from; })) return;
    F.store(KEY, list.map(function (d) { return d.owner === from ? Object.assign({}, d, { owner: to }) : d; }));
  }

  // Documents saved before they belonged to a person: give them to the
  // profile saved in this browser.
  function migrate() {
    var p = F.load(PROFILE_KEY);
    var owner = p && profileOwner(p.email);
    if (owner) moveOwner("profile", owner);
  }

  // Adds a file made by Sevak (for example a certificate) to an owner's
  // documents. With meta.id, replaces that document's file and details.
  function addFile(owner, blob, meta) {
    meta = meta || {};
    var existing = meta.id ? all().filter(function (d) { return d.id === meta.id; })[0] : null;
    var now = new Date().toISOString();
    var doc = Object.assign({}, existing || {}, {
      id: (existing && existing.id) || "doc-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      owner: owner,
      name: meta.name || "Document",
      description: meta.description || "",
      fileName: meta.fileName || "document",
      type: blob.type || "",
      size: blob.size,
      uploadedAt: now,
      uploadedBy: meta.uploadedBy || currentUser(),
      source: meta.source || ""
    });
    if (existing) doc.updatedAt = now;
    return putFile(doc.id, blob).then(function () {
      if (!saveDoc(doc)) throw new Error("storage");
      return doc;
    });
  }

  // ---------- Formatting ----------

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  function formatDate(iso) {
    var d = new Date(iso);
    try { return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }); } catch (e) { return d.toLocaleDateString(); }
  }

  function formatTime(iso) {
    var d = new Date(iso);
    try { return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }); } catch (e) { return d.toLocaleTimeString(); }
  }

  function currentUser() {
    var p = F.load(PROFILE_KEY) || {};
    var name = [p.firstName, p.lastName].filter(Boolean).join(" ");
    return name || p.email || "You (no profile yet)";
  }

  function nameFromFile(fileName) {
    return fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || fileName;
  }

  function el(tag, attrs, text) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    if (text != null) node.textContent = text;
    return node;
  }

  // ---------- View ----------
  // Renders the documents of one owner into `container`: an add/edit form and
  // a grid. Returns { setOwner } so a page can switch owner after saving a new
  // organization or event.

  var counter = 0;

  function mount(container, opts) {
    opts = opts || {};
    var uid = "docs" + (++counter);
    var owner = opts.owner || null;
    var editingId = null;
    var sort = { key: "uploadedAt", dir: "desc" };

    container.classList.add("docs");
    container.innerHTML =
      '<div class="docs-head">' +
        '<div><h2 class="section-title docs-title">Documents</h2>' +
        '<p class="section-help docs-help"></p></div>' +
        '<button type="button" class="btn btn-primary docs-add">+ Add a document</button>' +
      '</div>' +
      '<p class="notice notice-warn docs-blocked" hidden></p>' +
      '<div class="docs-form" hidden>' +
        '<h3 class="docs-form-title">Add a document</h3>' +
        '<div class="grid">' +
          '<div class="field span-2 docs-file-field">' +
            '<label for="' + uid + '-file">File</label>' +
            '<input id="' + uid + '-file" type="file" class="docs-file">' +
            '<p class="hint">Up to 10 MB. PDFs, Word and Excel files, images and text files all work.</p>' +
            '<p class="error docs-file-error"></p>' +
          '</div>' +
          '<div class="field">' +
            '<label for="' + uid + '-name">Document name</label>' +
            '<input id="' + uid + '-name" type="text" class="docs-name" maxlength="120">' +
            '<p class="error docs-name-error"></p>' +
          '</div>' +
          '<div class="field">' +
            '<label for="' + uid + '-desc">Brief description <span class="optional">(optional)</span></label>' +
            '<input id="' + uid + '-desc" type="text" class="docs-desc" maxlength="200" placeholder="e.g. Signed for 2026">' +
          '</div>' +
        '</div>' +
        '<div class="docs-form-actions">' +
          '<button type="button" class="btn btn-secondary docs-cancel">Cancel</button>' +
          '<button type="button" class="btn btn-primary docs-save">Upload</button>' +
        '</div>' +
      '</div>' +
      '<p class="status docs-status" role="status" aria-live="polite"></p>' +
      '<p class="docs-summary hint"></p>' +
      '<div class="docs-grid"></div>';

    var q = function (sel) { return container.querySelector(sel); };
    var help = q(".docs-help"), blocked = q(".docs-blocked"), addBtn = q(".docs-add");
    var formBox = q(".docs-form"), fileInput = q(".docs-file"), nameInput = q(".docs-name"), descInput = q(".docs-desc");
    var fileError = q(".docs-file-error"), nameError = q(".docs-name-error");
    var statusEl = q(".docs-status"), summary = q(".docs-summary"), grid = q(".docs-grid");

    help.textContent = opts.help || "Keep the files you need in one place.";

    function setFieldError(input, errorEl, msg) {
      errorEl.textContent = msg;
      if (msg) {
        input.setAttribute("aria-invalid", "true");
        input.setAttribute("aria-describedby", errorEl.id || (errorEl.id = input.id + "-error"));
      } else {
        input.removeAttribute("aria-invalid");
      }
    }

    function openForm(doc) {
      editingId = doc ? doc.id : null;
      q(".docs-form-title").textContent = doc ? "Edit document details" : "Add a document";
      q(".docs-save").textContent = doc ? "Save changes" : "Upload";
      q(".docs-file-field label").textContent = doc ? "Replace the file (optional)" : "File";
      fileInput.value = "";
      nameInput.value = doc ? doc.name : "";
      descInput.value = doc ? doc.description || "" : "";
      setFieldError(fileInput, fileError, "");
      setFieldError(nameInput, nameError, "");
      formBox.hidden = false;
      addBtn.hidden = true;
      statusEl.textContent = "";
      (doc ? nameInput : fileInput).focus();
    }

    function closeForm() {
      formBox.hidden = true;
      addBtn.hidden = !owner;
      editingId = null;
    }

    fileInput.addEventListener("change", function () {
      var file = fileInput.files[0];
      setFieldError(fileInput, fileError, "");
      if (file && !nameInput.value.trim()) {
        nameInput.value = nameFromFile(file.name);
        setFieldError(nameInput, nameError, "");
      }
    });
    nameInput.addEventListener("input", function () {
      if (nameInput.value.trim()) setFieldError(nameInput, nameError, "");
    });

    addBtn.addEventListener("click", function () { openForm(null); });
    q(".docs-cancel").addEventListener("click", function () { closeForm(); addBtn.focus(); });

    q(".docs-save").addEventListener("click", function () {
      var file = fileInput.files[0];
      var name = nameInput.value.trim();
      var fileMsg = "";
      if (!file && !editingId) fileMsg = "Choose a file to upload.";
      else if (file && file.size > MAX_BYTES) fileMsg = "This file is " + formatSize(file.size) + ". The limit is 10 MB.";
      else if (file && file.size === 0) fileMsg = "This file is empty.";
      setFieldError(fileInput, fileError, fileMsg);
      setFieldError(nameInput, nameError, name ? "" : "Enter a name for the document.");
      if (fileMsg) { fileInput.focus(); return; }
      if (!name) { nameInput.focus(); return; }

      var existing = editingId ? all().find(function (d) { return d.id === editingId; }) : null;
      var now = new Date().toISOString();
      var doc = existing ? Object.assign({}, existing) : { id: "doc-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), owner: owner };
      doc.name = name;
      doc.description = descInput.value.trim();
      if (file) {
        doc.fileName = file.name;
        doc.type = file.type || "";
        doc.size = file.size;
        doc.uploadedAt = now;
        doc.uploadedBy = currentUser();
      }
      if (existing) doc.updatedAt = now;

      var button = q(".docs-save");
      button.disabled = true;
      var stored = file ? putFile(doc.id, file) : Promise.resolve();
      stored.then(function () {
        if (!saveDoc(doc)) throw new Error("storage");
        closeForm();
        render();
        statusEl.textContent = existing ? "Saved changes to " + doc.name + "." : doc.name + " uploaded.";
        addBtn.focus();
      }).catch(function () {
        statusEl.textContent = "Couldn't save the file in this browser. Check that site storage is allowed and there's space.";
      }).then(function () { button.disabled = false; });
    });

    function download(doc) {
      getFile(doc.id).then(function (blob) {
        if (!blob) throw new Error("missing");
        var url = URL.createObjectURL(blob);
        var a = el("a", { href: url, download: doc.fileName || doc.name });
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
      }).catch(function () {
        statusEl.textContent = "The file for " + doc.name + " isn't in this browser any more.";
      });
    }

    function sortDocs(list) {
      var k = sort.key, dir = sort.dir === "asc" ? 1 : -1;
      return list.slice().sort(function (a, b) {
        var x = a[k], y = b[k];
        if (k === "name") return dir * String(x).localeCompare(String(y), undefined, { sensitivity: "base" });
        if (k === "size") return dir * ((x || 0) - (y || 0));
        return dir * String(x || "").localeCompare(String(y || ""));
      });
    }

    function headerCell(key, label) {
      var th = el("th", { scope: "col" });
      if (!key) { th.textContent = label; return th; }
      var active = sort.key === key;
      th.setAttribute("aria-sort", active ? (sort.dir === "asc" ? "ascending" : "descending") : "none");
      var b = el("button", { type: "button", class: "docs-sort" }, label);
      b.appendChild(el("span", { "aria-hidden": "true", class: "docs-sort-icon" }, active ? (sort.dir === "asc" ? " ↑" : " ↓") : ""));
      b.addEventListener("click", function () {
        if (sort.key === key) sort.dir = sort.dir === "asc" ? "desc" : "asc";
        else sort = { key: key, dir: key === "name" ? "asc" : "desc" };
        render();
        container.querySelector('.docs-sort[data-key="' + key + '"]').focus();
      });
      b.dataset.key = key;
      th.appendChild(b);
      return th;
    }

    function cell(label, content, cls) {
      var td = el("td", { "data-label": label });
      if (cls) td.className = cls;
      if (content instanceof Node) td.appendChild(content); else td.textContent = content;
      return td;
    }

    function render() {
      grid.innerHTML = "";
      if (!owner) {
        summary.textContent = "";
        return;
      }
      var docs = sortDocs(forOwner(owner));
      if (!docs.length) {
        summary.textContent = "";
        grid.appendChild(el("p", { class: "empty docs-empty" }, "No documents yet."));
        return;
      }
      var total = docs.reduce(function (s, d) { return s + (d.size || 0); }, 0);
      summary.textContent = docs.length + (docs.length === 1 ? " document" : " documents") + " · " + formatSize(total) + " in all";

      var wrap = el("div", { class: "table-wrap" });
      var table = el("table", { class: "data-table docs-table" });
      table.appendChild(el("caption", { class: "sr-only" }, "Documents"));
      var head = el("thead"), hr = el("tr");
      hr.appendChild(headerCell("name", "Name"));
      hr.appendChild(headerCell(null, "Description"));
      hr.appendChild(headerCell("uploadedAt", "Uploaded"));
      hr.appendChild(headerCell("uploadedBy", "By"));
      var sizeTh = headerCell("size", "Size");
      sizeTh.classList.add("num");
      hr.appendChild(sizeTh);
      head.appendChild(hr);
      table.appendChild(head);

      var body = el("tbody");
      docs.forEach(function (doc) {
        var tr = el("tr");
        var nameBtn = el("button", { type: "button", class: "docs-name-link", title: "Download " + (doc.fileName || doc.name) }, doc.name);
        nameBtn.addEventListener("click", function () { download(doc); });
        var nameWrap = el("div");
        nameWrap.appendChild(nameBtn);
        if (doc.fileName) nameWrap.appendChild(el("span", { class: "hint docs-filename" }, doc.fileName));
        var th = el("th", { scope: "row", "data-label": "Name" });
        th.appendChild(nameWrap);
        tr.appendChild(th);
        tr.appendChild(cell("Description", doc.description || "—", doc.description ? "" : "docs-none"));
        var when = el("div", { class: "docs-when" });
        var time = el("time", { datetime: doc.uploadedAt }, formatDate(doc.uploadedAt));
        when.appendChild(time);
        when.appendChild(el("span", { class: "hint" }, formatTime(doc.uploadedAt)));
        tr.appendChild(cell("Uploaded", when));
        tr.appendChild(cell("By", doc.uploadedBy || "—"));
        tr.appendChild(cell("Size", formatSize(doc.size || 0), "num"));

        var actions = el("div", { class: "docs-actions" });
        var dl = el("button", { type: "button", class: "btn-link", "aria-label": "Download " + doc.name }, "Download");
        dl.addEventListener("click", function () { download(doc); });
        var edit = el("button", { type: "button", class: "btn-link", "aria-label": "Edit " + doc.name }, "Edit");
        edit.addEventListener("click", function () { openForm(doc); formBox.scrollIntoView({ block: "nearest" }); });
        var del = el("button", { type: "button", class: "btn-danger-link", "aria-label": "Delete " + doc.name }, "Delete");
        del.addEventListener("click", function () {
          if (!window.confirm("Delete " + doc.name + "? This can't be undone.")) return;
          if (editingId === doc.id) closeForm();
          remove(doc.id).then(function () {
            render();
            statusEl.textContent = doc.name + " deleted.";
            addBtn.focus();
          });
        });
        [dl, edit, del].forEach(function (b) { b.classList.add("btn"); actions.appendChild(b); });
        nameWrap.appendChild(actions);
        body.appendChild(tr);
      });
      table.appendChild(body);
      wrap.appendChild(table);
      grid.appendChild(wrap);
    }

    function setOwner(next, blockedMessage) {
      owner = next || null;
      blocked.hidden = !!owner;
      blocked.textContent = owner ? "" : (blockedMessage || "Save first, then add documents.");
      closeForm();
      statusEl.textContent = "";
      render();
    }

    setOwner(owner, opts.blockedMessage);
    sweep();
    return { setOwner: setOwner, render: render };
  }

  migrate();

  window.SevakDocs = {
    mount: mount,
    addFile: addFile,
    getFile: getFile,
    profileOwner: profileOwner,
    moveOwner: moveOwner,
    pageTabs: function () { return F.pageTabs.apply(null, arguments); },
    all: all,
    forOwner: forOwner,
    remove: remove,
    removeFor: removeFor,
    formatSize: formatSize
  };
})();
