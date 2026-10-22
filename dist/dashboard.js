(() => {
  // src/dashboard/client/model.js
  var D = JSON.parse(document.getElementById("data").textContent);
  var KEY = "kasanome:" + D.range;
  var state = { read: {}, triage: {} };
  try {
    state = JSON.parse(localStorage.getItem(KEY) || localStorage.getItem("structural-review:" + D.range)) || state;
  } catch {
  }
  var save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
    }
  };
  var layers = D.layers;
  var seams = D.seams;
  var findings = D.findings;
  var unitOf = (id) => D.units.find((u) => u.id === id);
  var layerName = (id) => (D.map.layers.find((l) => l.id === id) || {}).name || id;
  var anchorLine = (f) => f.anchor ? f.anchor.line : f.line;
  var triage = (id) => state.triage[id] || "";
  var forUnit = (name) => findings.filter((f) => f.unit === name);
  var forPr = (n) => findings.filter((f) => f.introducedIn === n);
  var ui = {
    mode: "diff",
    query: "",
    layer: "",
    filters: { sev: "", unit: "", pr: "", status: "", triage: "", q: "" }
  };
  var sourceFiles = D.source?.files || [];
  var fileFindings = (path) => findings.filter((f) => f.file === path).sort((a, b) => (anchorLine(a) || a.line) - (anchorLine(b) || b.line));

  // src/dashboard/client/html.js
  var $ = (s) => document.querySelector(s);
  var h = (s) => String(s ?? "").replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]
  );
  var SEV = { high: 0, medium: 1, low: 2 };
  var codeRoute = (file, line, finding) => "#/code/" + encodeURIComponent(file) + (line || finding ? "/" + (line ? Number(line) : 0) : "") + (finding ? "/" + encodeURIComponent(finding) : "");
  var fileLink = (file, line) => '<a class="mono" href="' + codeRoute(file, line) + '" title="Review code in context">' + h(file) + (line ? ":" + h(line) : "") + "</a>";
  var counts = (list2) => '<span class="counts">' + ["high", "medium", "low"].map((s) => {
    const n = list2.filter((f) => f.severity === s).length;
    return n ? '<span class="dot ' + s + '">' + n + "</span>" : "";
  }).join("") + "</span>";
  var inl = (s) => h(s).replace(/\x60([^\x60]+)\x60/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");

  // src/dashboard/client/reading.js
  var readKey = (scope, path) => scope + "|" + path;
  function unitProgress(scope, items) {
    if (!items || !items.length) return 0;
    return items.filter((r) => state.read[readKey(scope, r.path)]).length / items.length;
  }
  function readingSteps(scope, items) {
    if (!items || !items.length) return '<p class="muted">No reading order.</p>';
    return '<ol class="steps">' + items.map((r, i) => {
      const k = readKey(scope, r.path), done = state.read[k];
      return '<li class="step' + (done ? " done" : "") + '"><label class="step-check" title="Mark as read"><input type="checkbox" data-read="' + h(k) + '"' + (done ? " checked" : "") + '><span class="step-n">' + (i + 1) + '</span></label><div class="step-body">' + fileLink(r.path) + '<div class="step-why">' + inl(r.why) + "</div></div></li>";
    }).join("") + "</ol>";
  }

  // src/dashboard/client/findings.js
  function findingCard(f) {
    const t = triage(f.id);
    const pr = f.introducedIn ? '<a class="pill" href="#/pr/' + f.introducedIn + '">PR #' + f.introducedIn + "</a>" : "";
    const st = f.status === "fixed-later" ? '<span class="pill">fixed in #' + f.fixedIn + "</span>" : f.status === "present-at-head" ? '<span class="pill">present at head</span>' : "";
    return '<div class="card finding ' + f.severity + '" id="f-' + f.id + '"><div class="head"><span class="sev ' + f.severity + '">' + f.severity + '</span><span class="mono muted">' + f.id + '</span><span class="title">' + h(f.title) + "</span>" + pr + (f.lifecycle ? '<span class="pill">' + h(f.lifecycle) + "</span>" : "") + st + '</div><div style="margin:6px 0">' + fileLink(f.file, anchorLine(f)) + ' <span class="pill">' + h(f.category) + '</span> <a class="pill" href="#/unit/' + encodeURIComponent(f.unitId) + '">' + h(f.unit) + "</a></div>" + (f.anchor ? '<div class="anchor-note muted">' + (f.anchor.line ? (f.anchor.line !== f.line ? "Location corrected: reported L" + f.line + " → source L" + f.anchor.line + ". " : "") + (f.anchor.status === "exact-excerpt" ? "Exact excerpt match." : "Matched to source evidence.") : "Approximate location: reported L" + f.line + ". " + h(f.anchor.reason)) + "</div>" : "") + "<p>" + h(f.detail) + '</p><details class="finding-evidence"><summary>Evidence &amp; verification</summary><pre>' + h(f.evidence) + "</pre>" + (f.verifyNote ? '<div class="muted">Verifier: ' + h(f.verifyNote) + "</div>" : "") + '</details><div class="btns">' + ["raise", "dismiss", "later"].map(
      (a) => '<button data-triage="' + f.id + '" data-v="' + a + '" class="' + (t === a ? "on" : "") + '">' + a + "</button>"
    ).join("") + "</div></div>";
  }
  function findingRows(fs) {
    if (!fs.length) return '<p class="muted">None survived verification.</p>';
    return '<div class="frows">' + [...fs].sort((a, b) => SEV[a.severity] - SEV[b.severity]).map((f) => {
      const t = triage(f.id);
      return '<a class="frow' + (t ? " done" : "") + '" href="#/finding/' + encodeURIComponent(f.id) + '"><span class="sev ' + f.severity + '">' + f.severity + '</span><span class="frow-main"><span class="frow-title">' + inl(f.title) + '</span><span class="frow-meta mono">' + h(f.file) + ":" + h(anchorLine(f) || f.line) + '</span></span><span class="frow-tags">' + (f.introducedIn ? '<span class="pill">#' + f.introducedIn + "</span>" : "") + (f.status === "fixed-later" ? '<span class="pill">fixed in #' + f.fixedIn + "</span>" : "") + (t ? '<span class="pill tri-' + t + '">' + t + "</span>" : "") + '</span><span class="frow-go" aria-hidden="true">›</span></a>';
    }).join("") + "</div>";
  }

  // src/dashboard/client/diff.js
  function parseDiff(diff) {
    const rows = [];
    let line = 0, old = 0, inHunk = false;
    for (const text of diff.split("\n")) {
      const match = text.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        old = Number(match[1]);
        line = Number(match[2]);
        inHunk = true;
        rows.push({ kind: "hunk", text });
        continue;
      }
      if (!inHunk) continue;
      if (text.startsWith("+"))
        rows.push({ kind: "add", text: text.slice(1), line: line++, old: null });
      else if (text.startsWith("-"))
        rows.push({ kind: "remove", text: text.slice(1), line: null, old: old++ });
      else if (text.startsWith(" "))
        rows.push({ kind: "context", text: text.slice(1), line: line++, old: old++ });
    }
    return rows;
  }
  function addFindingContext(rows, lines, findings2) {
    const visible = new Set(rows.filter((row) => row.line).map((row) => row.line));
    for (const finding of findings2) {
      const line = anchorLine(finding);
      if (!line || visible.has(line) || line < 1 || line > lines.length) continue;
      rows.push({ kind: "hunk", text: "Unchanged context · finding at line " + line });
      for (let n = Math.max(1, line - 5); n <= Math.min(lines.length, line + 5); n++) {
        if (visible.has(n)) continue;
        rows.push({ kind: "context", text: lines[n - 1], line: n, old: null });
        visible.add(n);
      }
    }
  }
  function codeRows(file, findings2) {
    const lines = typeof file.content === "string" ? file.content.split("\n") : [];
    if (lines.at(-1) === "") lines.pop();
    if (ui.mode === "full" || !file.diff)
      return lines.map((text, index) => ({ text, line: index + 1, old: null, kind: "context" }));
    const rows = parseDiff(file.diff);
    addFindingContext(rows, lines, findings2);
    return rows;
  }

  // src/dashboard/client/highlight.js
  function syntax(text) {
    const tokens = /(\/\/.*$|#[^!].*$|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\x60[^\x60]*\x60|\b(?:async|await|break|case|catch|class|const|continue|def|else|export|extends|false|finally|for|from|function|if|import|in|interface|let|new|null|private|public|raise|return|static|super|switch|throw|true|try|type|undefined|var|void|while|yield)\b|\b\d+(?:\.\d+)?\b)/g;
    let out = "", last = 0;
    for (const match of text.matchAll(tokens)) {
      out += h(text.slice(last, match.index));
      const t = match[0], cls = /^(\/\/|#)/.test(t) ? "comment" : /^["\x27\x60]/.test(t) ? "string" : /^\d/.test(t) ? "number" : "keyword";
      out += '<span class="tok-' + cls + '">' + h(t) + "</span>";
      last = match.index + t.length;
    }
    return out + h(text.slice(last));
  }

  // src/dashboard/client/code-file.js
  function editorLink(file, line) {
    if (!D.repo) return "";
    const url = "vscode://file/" + encodeURI(D.repo + "/" + file) + (line ? ":" + line : "");
    return `<a class="pill" href="${h(url)}">Open in editor ↗</a>`;
  }
  function fileHeader(file, findings2, line) {
    const modeButton = (mode, label) => `<button data-code-mode="${mode}" class="${ui.mode === mode ? "on" : ""}">${label}</button>`;
    return `<div class="code-file-head"><div><strong class="mono">${h(file.path)}</strong><div class="muted">${findings2.length} findings · ${file.changed ? "changed file" : "reference file"}</div></div><div class="code-actions">${editorLink(file.path, line)}${modeButton("diff", "Diff")}${modeButton("full", "Full file")}</div></div>`;
  }
  function lineRow(file, row, anchored, targetLine) {
    const classes = ["code-row", row.kind];
    if (anchored.length) classes.push("has-finding");
    if (row.line === Number(targetLine)) classes.push("selected-line");
    const id = row.line ? ` id="line-${row.line}"` : "";
    const number = row.line ? `<a class="line-new" href="${codeRoute(file.path, row.line)}">${row.line}</a>` : '<span class="line-new"></span>';
    const sign = { add: "+", remove: "−" }[row.kind] || (anchored.length ? "●" : "");
    return `<div class="${classes.join(" ")}"${id}><span class="line-old">${row.old || ""}</span>${number}<span class="line-sign">${sign}</span><code>${syntax(row.text)}</code></div>`;
  }
  function inlineFinding(finding, selected) {
    const active = finding.id === selected?.id ? " selected-comment" : "";
    return `<div class="inline-comment${active}">${findingCard(finding)}</div>`;
  }
  function unanchoredFinding(finding) {
    const message = finding.anchor?.status === "unresolved" ? "Location needs checking; this comment is not attached to a source line." : `Line ${finding.line} is unavailable in this head snapshot. This finding may refer to an earlier revision.`;
    return `<div class="unanchored"><p class="muted">${h(message)}</p>${findingCard(finding)}</div>`;
  }
  function notices(file) {
    const messages = [];
    if (file.error) messages.push(file.error);
    if (file.diffError && ui.mode === "diff")
      messages.push(file.diffError + " Showing available source.");
    return messages.map((text) => `<div class="code-notice">${h(text)}</div>`).join("");
  }
  function codeFile(file, findings2, selected, targetLine) {
    if (!file)
      return `<div class="code-empty"><h2>No source snapshot</h2><p>${h(D.source?.error || "Rebuild this report with the updated CLI to embed its source files.")}</p></div>`;
    const rows = codeRows(file, findings2);
    const shown = new Set(rows.map((row) => row.line).filter(Boolean));
    const lines = rows.map((row) => {
      if (row.kind === "hunk") return `<div class="code-hunk mono">${h(row.text)}</div>`;
      const anchored = findings2.filter((f) => row.line && anchorLine(f) === row.line);
      return lineRow(file, row, anchored, targetLine) + anchored.map((f) => inlineFinding(f, selected)).join("");
    }).join("");
    const missing = findings2.filter((f) => !anchorLine(f) || !shown.has(anchorLine(f))).map(unanchoredFinding).join("");
    return `${fileHeader(file, findings2, targetLine)}<div class="code-scroll">${notices(file)}<div class="code-lines">${lines}</div>${missing}</div>`;
  }

  // src/dashboard/client/file-browser.js
  function matchesLayer(file, layer) {
    if (!layer) return true;
    if (layer.paths.some(
      (path) => file.path === path || file.path.startsWith(path.replace(/\/$/, "") + "/")
    ))
      return true;
    return fileFindings(file.path).some((finding) => finding.unitId === layer.id);
  }
  function visibleFiles() {
    const layer = D.map.layers.find((item) => item.id === ui.layer);
    const query = ui.query.toLowerCase();
    return sourceFiles.filter((file) => file.path.toLowerCase().includes(query) && matchesLayer(file, layer)).sort(
      (a, b) => Number(!!fileFindings(b.path).length) - Number(!!fileFindings(a.path).length) || a.path.localeCompare(b.path)
    );
  }
  function fileBrowser(selected) {
    const files = visibleFiles();
    const options = D.map.layers.map(
      (layer) => `<option value="${h(layer.id)}"${layer.id === ui.layer ? " selected" : ""}>${h(layer.name)}</option>`
    ).join("");
    const tree = files.map(
      (file) => `<a class="file-entry${file.path === selected?.path ? " active" : ""}" href="${codeRoute(file.path)}"><span class="file-path mono">${h(file.path)}</span>${counts(fileFindings(file.path))}</a>`
    ).join("");
    return `<aside class="file-browser"><div class="file-browser-tools"><strong>Files <span class="pill">${files.length}</span></strong><input type="search" data-file-query placeholder="Find a file…" aria-label="Find a file" value="${h(ui.query)}"><select data-code-layer aria-label="Filter files by layer"><option value="">All layers</option>${options}</select></div><div class="file-tree">${tree || '<p class="muted">No matching files.</p>'}</div></aside>`;
  }

  // src/dashboard/client/code.js
  function findingLink(finding, label) {
    if (!finding) return `<span class="pill muted">${label}</span>`;
    return `<a class="pill" href="${codeRoute(finding.file, anchorLine(finding), finding.id)}">${label}</a>`;
  }
  function reviewHeader(selected) {
    const index = selected ? findings.indexOf(selected) : -1;
    const snapshot = D.source?.head ? " · snapshot " + h(D.source.head.slice(0, 8)) : "";
    return `<div class="review-top"><div><div class="eyebrow">KASANOME / CODE</div><h1>Read the code. Review in context.</h1><div class="muted mono">${h(D.range)}${snapshot}</div></div><div class="code-actions">${findingLink(findings[index - 1], "← Previous")}<span class="muted">${index >= 0 ? index + 1 : 0} / ${findings.length}</span>${findingLink(findings[index + 1], "Next →")}</div></div>`;
  }
  function viewCode(path, targetLine, findingId) {
    const first = sourceFiles.find((file2) => fileFindings(file2.path).length) || sourceFiles[0];
    const file = path ? sourceFiles.find((file2) => file2.path === path) : first;
    const local = file ? fileFindings(file.path) : [];
    const selected = findings.find((f) => f.id === findingId) || local.find((f) => anchorLine(f) === Number(targetLine)) || local[0];
    return `${reviewHeader(selected)}<div class="review-workspace">${fileBrowser(file)}<section class="code-panel">${codeFile(file, local, selected, targetLine)}</section></div>`;
  }

  // src/dashboard/client/unit-sidebar.js
  var PATH = "[\\w@./-]+\\.[a-z]{1,5}";
  function parseContract(c) {
    const m = String(c).match(
      new RegExp(
        "^(.*?)\\s+(?:in|from|at)\\s+(" + PATH + "(?:(?:,\\s*|\\s+and\\s+)" + PATH + ")*)\\s*\\.?$"
      )
    );
    return m ? { what: m[1], files: m[2].split(/,\s*|\s+and\s+/) } : { what: c, files: [] };
  }
  var layerChip = (id) => '<a class="chip-layer" href="#/unit/' + encodeURIComponent(id) + '">' + h(layerName(id)) + "</a>";
  function sideBlock(title, body) {
    return '<div class="side-block"><h4>' + title + "</h4>" + body + "</div>";
  }
  function unitSidebar(l, sm, r) {
    const usedBy = l ? layers.filter((x) => x.dependsOn.includes(l.id)) : [];
    let side = "";
    if (l) {
      const contracts = l.contracts.map(parseContract);
      side += sideBlock(
        "Exposes",
        contracts.length ? '<ul class="contracts">' + contracts.map(
          (c) => "<li><div>" + inl(c.what) + "</div>" + (c.files.length ? '<div class="cfiles">' + c.files.map((f) => fileLink(f)).join("") + "</div>" : "") + "</li>"
        ).join("") + "</ul>" : '<p class="muted">Nothing listed.</p>'
      );
      side += sideBlock(
        "Depends on",
        l.dependsOn.length ? '<div class="chips">' + l.dependsOn.map(layerChip).join("") + "</div>" : '<p class="muted">Nothing. This is a base layer.</p>'
      );
      side += sideBlock(
        "Used by",
        usedBy.length ? '<div class="chips">' + usedBy.map((x) => layerChip(x.id)).join("") + "</div>" : '<p class="muted">Nothing. This is a top layer.</p>'
      );
      if (l.backEdges.length)
        side += sideBlock(
          '<span class="warn-text">Upward imports</span>',
          '<p class="muted small">A lower layer importing a higher one.</p><ul class="edges">' + l.backEdges.map((b) => {
            const [from, to] = String(b).split(/\s*->\s*/);
            return '<li class="mono">' + (to ? "<div>" + h(from) + '</div><div class="edge-to"><span class="arrow">imports </span>' + h(to) + "</div>" : h(b)) + "</li>";
          }).join("") + "</ul>"
        );
    }
    if (sm) {
      side += sideBlock(
        "Between",
        '<div class="chips">' + layerChip(sm.from) + '<span class="arrow">→</span>' + layerChip(sm.to) + "</div>"
      );
      side += sideBlock(
        "Files on the boundary",
        '<ul class="flist">' + sm.files.map((f) => "<li>" + fileLink(f) + "</li>").join("") + "</ul>"
      );
    }
    if (r && r.strengths.length)
      side += '<details class="side-block strengths"><summary><h4>What is solid (' + r.strengths.length + ")</h4></summary><ul>" + r.strengths.map((s) => "<li>" + inl(s) + "</li>").join("") + "</ul></details>";
    return side;
  }

  // src/dashboard/client/unit.js
  function sentences(text) {
    const out = [];
    let cur = "", tick = false;
    const t = String(text || "").trim();
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      cur += c;
      if (c === "`") tick = !tick;
      if (!tick && /[.!?]/.test(c) && /\s/.test(t[i + 1] || " ") && /[A-Z\x60(]/.test(t.slice(i + 1).trimStart()[0] || "A") && !/\b(e\.g|i\.e|etc|vs)\.$/i.test(cur)) {
        out.push(cur.trim());
        cur = "";
      }
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }
  function prose(text, perPara) {
    const ss = sentences(text), paras = [];
    for (let i = 0; i < ss.length; i += perPara) paras.push(ss.slice(i, i + perPara).join(" "));
    return paras.map((p) => "<p>" + inl(p) + "</p>").join("");
  }
  function section(title, body, extra) {
    return '<section class="usec"><h2>' + title + (extra || "") + "</h2>" + body + "</section>";
  }
  function unitHeader(u, l, sm, fs, reading, readCount) {
    const kicker = l ? "Layer " + (layers.findIndex((x) => x.id === u.id) + 1) + " of " + layers.length : "Boundary between layers";
    const title = sm ? h(layerName(sm.from)) + ' <span class="arrow">→</span> ' + h(layerName(sm.to)) : h(u.name);
    const lead = l ? l.purpose : sm ? sm.why : "";
    const stat = (value, label, cls) => '<div class="ustat' + (cls ? " " + cls : "") + '"><b>' + value + "</b><span>" + label + "</span></div>";
    const stats = '<div class="ustats">' + stat(
      fs.length,
      (fs.length === 1 ? "finding" : "findings") + (fs.length ? ": " + ["high", "medium", "low"].map((v) => [v, fs.filter((f) => f.severity === v).length]).filter((x) => x[1]).map((x) => x[1] + " " + x[0]).join(", ") : ""),
      fs.some((f) => f.severity === "high") ? "warn" : ""
    ) + stat(readCount + "/" + reading.length, "files read") + (l ? stat("~" + l.approxLines.toLocaleString(), "changed lines") + stat(l.backEdges.length, "upward imports", l.backEdges.length ? "warn" : "") : stat(sm.files.length, "files on the boundary")) + "</div>";
    return '<header class="uhead"><div class="kicker">' + kicker + "</div><h1>" + title + "</h1>" + (lead ? '<p class="lead">' + inl(lead) + "</p>" : "") + (l ? '<div class="paths">' + l.paths.map((p) => '<span class="pill mono">' + h(p) + "</span>").join("") + "</div>" : "") + stats + (u.reviewedCommit ? '<p class="muted mono">Area assessment at commit ' + h(u.reviewedCommit.slice(0, 12)) + (D.source?.head && u.reviewedCommit !== D.source.head ? " · reused from an earlier run; see coverage for current checks" : "") + "</p>" : "") + "</header>";
  }
  function viewUnit(id) {
    const u = unitOf(id);
    if (!u) return "<p>Unknown unit.</p>";
    const l = D.map.layers.find((x) => x.id === id), sm = seams.find((s) => s.from + "->" + s.to === id);
    const r = u.review, fs = forUnit(u.name);
    const reading = r && r.readingOrder || [];
    const readCount = reading.filter((x) => state.read[readKey(u.id, x.path)]).length;
    const headHtml = unitHeader(u, l, sm, fs, reading, readCount);
    if (!r)
      return headHtml + '<div class="card" style="border-color:var(--high)">Review failed for this unit.</div>';
    const ss = sentences(r.summary);
    const verdict = '<div class="verdict"><p class="verdict-lead">' + inl(ss[0] || "") + "</p>" + (ss.length > 1 ? prose(ss.slice(1).join(" "), 2) : "") + "</div>";
    return headHtml + '<div class="ugrid"><div class="umain">' + section("Assessment", verdict) + section("Findings", findingRows(fs), " " + counts(fs)) + section(
      "Reading order",
      '<p class="muted small">Read in this order. Tick each file when done.</p>' + readingSteps(u.id, reading),
      ' <span class="muted small">' + readCount + " of " + reading.length + "</span>"
    ) + '</div><aside class="uside">' + unitSidebar(l, sm, r) + "</aside></div>";
  }

  // src/dashboard/client/markdown.js
  var fence = /^\x60\x60\x60/;
  var listItem = /^\s*([-*]|\d+\.)\s+/;
  var tableRow = /^\s*\|/;
  var blockStart = /^(#|\x60\x60\x60|\s*\||\s*([-*]|\d+\.)\s)/;
  function takeWhile(cursor, predicate) {
    const lines = [];
    while (cursor.index < cursor.lines.length && predicate(cursor.lines[cursor.index]))
      lines.push(cursor.lines[cursor.index++]);
    return lines;
  }
  function codeBlock(cursor) {
    cursor.index++;
    const text = takeWhile(cursor, (line) => !fence.test(line)).join("\n");
    if (cursor.index < cursor.lines.length) cursor.index++;
    return `<pre>${h(text)}
</pre>`;
  }
  function table(cursor) {
    const rows = takeWhile(cursor, (line) => tableRow.test(line)).filter(
      (line) => !/^\s*\|[\s:|-]+\|\s*$/.test(line)
    );
    const cells = (line) => line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
    return "<table>" + rows.map((row, index) => {
      const tag = index ? "td" : "th";
      return "<tr>" + cells(row).map((cell) => `<${tag}>${inl(cell)}</${tag}>`).join("") + "</tr>";
    }).join("") + "</table>";
  }
  function list(cursor) {
    const tag = /^\s*\d+\./.test(cursor.lines[cursor.index]) ? "ol" : "ul";
    const items = takeWhile(cursor, (line) => listItem.test(line));
    return `<${tag}>` + items.map((line) => "<li>" + inl(line.replace(listItem, "")) + "</li>").join("") + `</${tag}>`;
  }
  function block(cursor) {
    const line = cursor.lines[cursor.index];
    if (!line.trim()) {
      cursor.index++;
      return "";
    }
    if (fence.test(line)) return codeBlock(cursor);
    const heading = line.match(/^(#{1,4})\s+(.*)/);
    if (heading) {
      cursor.index++;
      const level = Math.min(heading[1].length + 1, 4);
      return `<h${level}>${inl(heading[2])}</h${level}>`;
    }
    if (tableRow.test(line)) return table(cursor);
    if (listItem.test(line)) return list(cursor);
    cursor.index++;
    const rest = takeWhile(cursor, (item) => !!item.trim() && !blockStart.test(item));
    return "<p>" + inl([line, ...rest].join(" ")) + "</p>";
  }
  function md(source) {
    const cursor = { lines: String(source || "").split("\n"), index: 0 };
    let output = "";
    while (cursor.index < cursor.lines.length) output += block(cursor);
    return '<div class="md">' + output + "</div>";
  }

  // src/dashboard/client/diagram.js
  function diagram() {
    const W = 1e3, BH = 54, GAP = 26, LM = 90, RM = 120, BW = W - LM - RM;
    const order = [...layers].reverse();
    const y = (id) => {
      const i = order.findIndex((l) => l.id === id);
      return i < 0 ? null : 20 + i * (BH + GAP);
    };
    const H = 20 + order.length * (BH + GAP);
    let s = '<svg viewBox="0 0 ' + W + " " + H + '" width="100%" style="max-width:' + W + 'px">';
    s += '<defs><marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="currentColor"/></marker></defs>';
    let k = 0;
    layers.forEach(
      (l) => l.dependsOn.forEach((d) => {
        const y1 = y(l.id), y2 = y(d);
        if (y1 == null || y2 == null) return;
        const back = y2 < y1, x = LM - 12 - k++ % 6 * 11;
        const a = y1 + BH / 2, b = y2 + BH / 2;
        s += '<path class="edge' + (back ? " back" : "") + '" style="color:var(--' + (back ? "high" : "muted") + ')" marker-end="url(#ar)" d="M' + LM + "," + a + " C" + x + "," + a + " " + x + "," + b + " " + LM + "," + b + '"/>';
      })
    );
    seams.forEach((sm, i) => {
      const y1 = y(sm.from), y2 = y(sm.to);
      if (y1 == null || y2 == null) return;
      const x = LM + BW + 18 + i * 22, a = y1 + BH / 2, b = y2 + BH / 2, u = unitOf(sm.from + "->" + sm.to);
      s += '<a href="#/unit/' + encodeURIComponent(sm.from + "->" + sm.to) + '"><title>' + h(u ? u.name : "") + '</title><path class="seam" d="M' + (LM + BW) + "," + a + " C" + x + "," + a + " " + x + "," + b + " " + (LM + BW) + "," + b + '"/></a>';
    });
    order.forEach((l) => {
      const yy = y(l.id), fs = forUnit(l.name);
      s += '<a href="#/unit/' + encodeURIComponent(l.id) + '"><rect class="band" x="' + LM + '" y="' + yy + '" width="' + BW + '" height="' + BH + '" rx="8"/><text x="' + (LM + 14) + '" y="' + (yy + 22) + '" font-weight="600">' + h(l.name) + '</text><text class="sub" x="' + (LM + 14) + '" y="' + (yy + 40) + '">' + h(l.paths.slice(0, 3).join("  ")) + (l.paths.length > 3 ? "  +" + (l.paths.length - 3) : "") + "</text>" + ["high", "medium", "low"].map((sv, j) => {
        const n = fs.filter((f) => f.severity === sv).length;
        return n ? '<g><rect x="' + (LM + BW - 90 + j * 28) + '" y="' + (yy + 16) + '" width="24" height="18" rx="9" fill="var(--' + sv + ')"/><text x="' + (LM + BW - 78 + j * 28) + '" y="' + (yy + 29) + '" text-anchor="middle" style="fill:#fff;font-size:11px">' + n + "</text></g>" : "";
      }).join("") + "</a>";
    });
    return s + '</svg><div class="muted" style="font-size:12px">Entry points on top. Left: dependencies (dashed red = upward import). Right, blue: reviewed seams. Click a layer or seam to open it.</div>';
  }

  // src/dashboard/client/views.js
  function viewOverview() {
    const open = findings.filter((f) => f.status !== "fixed-later");
    const triaged = findings.filter((f) => triage(f.id)).length;
    const allRead = D.units.flatMap(
      (u) => (u.review && u.review.readingOrder || []).map((r) => readKey(u.id, r.path))
    );
    return '<h1>Kasanome</h1><div class="muted mono">' + h(D.range) + " | agent: " + h(D.agent || "-") + "</div>" + (D.usage ? '<p class="muted">Agent calls: ' + h(D.usage.calls) + "/" + h(D.usage.maxCalls) + " · cache hits: " + h(D.usage.cacheHits) + " · reported tokens: " + h(
      D.usage.tokensKnown ? D.usage.totalTokens : "unavailable (partial total: " + D.usage.totalTokens + ")"
    ) + "</p>" : "") + (D.usage?.tokenBreakdown ? '<p class="muted">Cumulative OpenCode usage: new input ' + h(D.usage.tokenBreakdown.input) + " · cached reads " + h(D.usage.tokenBreakdown.cacheRead) + " · cache writes " + h(D.usage.tokenBreakdown.cacheWrite) + " · output " + h(D.usage.tokenBreakdown.output) + " · reasoning " + h(D.usage.tokenBreakdown.reasoning) + ". Totals accumulate across model steps; they are not the size of the diff or a subscription quota.</p>" : "") + (D.coverage ? '<div class="card">' + h(D.coverage.style || "layered") + " · " + h(D.coverage.mode) + " · " + h(D.coverage.reason) + "<br>Skipped: " + h(D.coverage.skipped.join(", ") || "none") + (D.coverage.style === "quick" ? "<br>Quick context: " + h(D.coverage.contextChars) + "/" + h(D.coverage.maxContextChars) + " characters. Skipped files: " + h(
      (D.coverage.skippedFiles || []).map((f) => f.path + " (" + f.reason + ")").join(", ") || "none"
    ) + "<br>Context limitations: " + h(
      (D.coverage.contextLimitations || []).map((f) => f.path + " (" + f.reason + ")").join(", ") || "none"
    ) + ". Scope: supplied diff only; architecture and repository-wide behavior were not audited." : "") + "<br>Verification: " + (D.coverage.verificationIncomplete ? "incomplete" : "complete") + ". Coverage is limited to the selected scope; this is not approval.</div>" : "") + '<div class="stats"><div class="stat"><b>' + D.scope.filesChanged + '</b><span>files changed</span></div><div class="stat"><b>+' + D.scope.additions + "</b><span>-" + D.scope.deletions + ' lines</span></div><div class="stat"><b>' + layers.length + " / " + seams.length + '</b><span>layers / seams</span></div><div class="stat"><b>' + findings.length + "</b><span>" + open.length + ' open at head</span></div><div class="stat"><b>' + triaged + "/" + findings.length + '</b><span>findings triaged</span></div><div class="stat"><b>' + allRead.filter((k) => state.read[k]).length + "/" + allRead.length + "</b><span>files read</span></div></div>" + (D.failed && D.failed.length ? '<div class="card" style="border-color:var(--high)">Not covered (review failed): ' + h(D.failed.join(", ")) + "</div>" : "") + '<h2>Architecture</h2><div class="card">' + diagram() + '</div><div class="grid2"><div><h2>System</h2><div class="card">' + h(D.map.overview).replace(/\n\n/g, "<br><br>") + '</div></div><div><h2>How to review</h2><div class="card"><ol style="margin:0;padding-left:18px"><li>Read layers bottom-up (sidebar order). Tick files as you read them.</li><li>Read seams: where layers disagree.</li><li>Review PRs bottom-up with their guides. Raise only findings that are present at head, on the PR that introduced them.</li><li>Triage each finding: raise, dismiss, or later.</li></ol><p class="muted" style="margin-bottom:0">Keys: <span class="kbd">g o</span> overview, <span class="kbd">g f</span> findings, <span class="kbd">j</span>/<span class="kbd">k</span> next/prev in sidebar.</p></div></div></div><h2>Highest severity</h2>' + (findings.filter((f) => f.severity === "high").map(findingCard).join("") || '<p class="muted">No high-severity findings.</p>');
  }
  function viewPr(n) {
    const p = D.scope.prs.find((x) => x.number === n);
    if (!p) return "<p>Unknown PR.</p>";
    const g = (D.prGuides || []).find((x) => x.number === n), fs = forPr(n);
    const raise = fs.filter((f) => f.status !== "fixed-later"), skip = fs.filter((f) => f.status === "fixed-later");
    return '<div class="muted">PR ' + (D.scope.prs.indexOf(p) + 1) + " of " + D.scope.prs.length + " in the stack</div><h1>#" + n + " " + h(p.title) + '</h1><div><span class="pill mono">' + h(p.headRef) + " -> " + h(p.baseRef) + '</span> <span class="pill">+' + p.additions + " / -" + p.deletions + "</span> " + (p.url ? '<a class="pill" href="' + h(p.url) + '" target="_blank">open on GitHub</a>' : "") + "</div><h2>Raise on this PR " + counts(raise) + "</h2>" + (raise.map(findingCard).join("") || '<p class="muted">Nothing to raise.</p>') + (skip.length ? '<h2>Introduced here, fixed later</h2><p class="muted">Do not comment on these here.</p>' + skip.map(findingCard).join("") : "") + "<h2>Reading guide</h2>" + (g ? '<div class="card">' + md(g.guide) + "</div>" : '<p class="muted">Small PR: read the diff directly.</p>');
  }
  var filt = ui.filters;
  function viewFindings() {
    const opt = (k, vals, label) => '<select data-f="' + k + '"><option value="">' + label + "</option>" + vals.map(
      (v) => '<option value="' + h(v[0]) + '"' + (String(filt[k]) === String(v[0]) ? " selected" : "") + ">" + h(v[1]) + "</option>"
    ).join("") + "</select>";
    const rows = findings.filter(
      (f) => (!filt.sev || f.severity === filt.sev) && (!filt.unit || f.unitId === filt.unit) && (!filt.pr || String(f.introducedIn) === filt.pr) && (!filt.status || f.status === filt.status) && (!filt.triage || (filt.triage === "none" ? !triage(f.id) : triage(f.id) === filt.triage)) && (!filt.q || (f.title + " " + f.file + " " + f.detail).toLowerCase().includes(filt.q.toLowerCase()))
    ).sort((a, b) => SEV[a.severity] - SEV[b.severity]);
    return '<h1>Findings</h1><div class="filters">' + opt(
      "sev",
      [
        ["high", "high"],
        ["medium", "medium"],
        ["low", "low"]
      ],
      "Any severity"
    ) + opt(
      "unit",
      D.units.map((u) => [u.id, u.name]),
      "Any layer or seam"
    ) + opt(
      "pr",
      D.scope.prs.map((p) => [String(p.number), "#" + p.number]),
      "Any PR"
    ) + opt(
      "status",
      [
        ["present-at-head", "present at head"],
        ["fixed-later", "fixed later"],
        ["unknown", "unknown"]
      ],
      "Any status"
    ) + opt(
      "triage",
      [
        ["none", "untriaged"],
        ["raise", "raise"],
        ["dismiss", "dismiss"],
        ["later", "later"]
      ],
      "Any triage"
    ) + '<input type="search" data-f="q" placeholder="Search" value="' + h(filt.q) + '"><span class="muted">' + rows.length + " shown</span></div><table><tr><th>ID</th><th>Sev</th><th>Title</th><th>Location</th><th>Area</th><th>PR</th><th>Status</th><th>Triage</th></tr>" + rows.map(
      (f) => '<tr class="click' + (triage(f.id) ? " done" : "") + '" data-go="#/finding/' + f.id + '"><td class="mono">' + f.id + '</td><td><span class="sev ' + f.severity + '">' + f.severity + "</span></td><td>" + h(f.title) + '</td><td class="mono">' + h(f.file) + ":" + f.line + "</td><td>" + h(f.unit) + "</td><td>" + (f.introducedIn ? "#" + f.introducedIn : "-") + "</td><td>" + h(f.status === "fixed-later" ? "fixed in #" + f.fixedIn : f.status || "-") + "</td><td>" + h(triage(f.id) || "-") + "</td></tr>"
    ).join("") + "</table>";
  }
  function viewFinding(id) {
    const f = findings.find((x) => x.id === id);
    if (!f) return "<p>Unknown finding.</p>";
    return viewCode(f.file, anchorLine(f), f.id);
  }

  // src/dashboard/client/main.js
  function nav(route) {
    const item = (href, label, right, prog) => '<a class="nav-item' + (route === href || href === "#/code" && (route.startsWith("#/code/") || route.startsWith("#/finding/")) ? " active" : "") + '" href="' + href + '"><span class="grow">' + label + "</span>" + (right || "") + "</a>" + (prog != null ? '<div class="progress" style="margin-top:-2px;margin-bottom:4px"><div style="width:' + Math.round(prog * 100) + '%"></div></div>' : "");
    const unitItem = (u, label) => item(
      "#/unit/" + encodeURIComponent(u.id),
      h(label),
      counts(forUnit(u.name)),
      unitProgress(u.id, u.review && u.review.readingOrder)
    );
    $("#nav").innerHTML = '<div class="nav-title">Kasanome</div><div class="nav-sub mono">' + h(D.range) + "</div>" + item("#/", "Overview") + item("#/code", "Code review", counts(findings)) + item("#/findings", "All findings", counts(findings)) + '<div class="nav-group">Layers, bottom-up</div>' + layers.map((l, i) => unitItem(unitOf(l.id) || { id: l.id, name: l.name }, i + 1 + ". " + l.name)).join("") + (seams.length ? '<div class="nav-group">Boundaries</div>' + D.units.filter((u) => u.kind === "seam").map((u) => unitItem(u, u.name.replace(/^Seam /, ""))).join("") : "") + (D.scope.prs.length ? '<div class="nav-group">PRs, bottom-up</div>' + D.scope.prs.map(
      (p) => item(
        "#/pr/" + p.number,
        "#" + p.number + " " + h(p.title),
        counts(forPr(p.number).filter((f) => f.status !== "fixed-later"))
      )
    ).join("") : "");
  }
  function renderView(kind, arg, line, findingId) {
    const views = {
      code: () => viewCode(arg ? decodeURIComponent(arg) : "", line, findingId),
      unit: () => viewUnit(decodeURIComponent(arg)),
      pr: () => viewPr(Number(arg)),
      findings: viewFindings,
      finding: () => viewFinding(arg)
    };
    return (views[kind] || viewOverview)();
  }
  function focusAnchor(kind, arg, line, findingId) {
    if (!["code", "finding"].includes(kind)) return;
    const id = kind === "finding" ? arg : findingId;
    const finding = findings.find((item) => item.id === id);
    const target = document.getElementById("line-" + (finding ? anchorLine(finding) : line)) || document.getElementById("f-" + id);
    if (!target) return;
    target.scrollIntoView({ block: "start" });
    const scroller = $(".code-scroll");
    if (scroller) scroller.scrollTop = Math.max(0, scroller.scrollTop - 120);
  }
  function render() {
    const route = location.hash || "#/";
    const [, kind, arg, line, findingId] = route.split("/");
    const main = $("#main");
    const positions = [".code-scroll", ".file-tree"].map((selector) => [
      selector,
      $(selector)?.scrollTop || 0
    ]);
    document.body.classList.toggle("review-mode", ["code", "finding"].includes(kind));
    main.innerHTML = renderView(kind, arg, line, findingId);
    nav(route);
    if (render.keepScroll) {
      for (const [selector, top] of positions) if ($(selector)) $(selector).scrollTop = top;
    } else {
      main.scrollTop = 0;
      focusAnchor(kind, arg, line, findingId);
    }
    render.keepScroll = false;
  }
  document.addEventListener("change", (e) => {
    const t = e.target;
    if (t.hasAttribute("data-code-layer")) {
      ui.layer = t.value;
      render.keepScroll = true;
      render();
      return;
    }
    if (t.dataset.read) {
      state.read[t.dataset.read] = t.checked;
      save();
      render.keepScroll = true;
      render();
    }
    if (t.dataset.f) {
      ui.filters[t.dataset.f] = t.value;
      render.keepScroll = true;
      render();
    }
  });
  document.addEventListener("input", (e) => {
    if (e.target.hasAttribute("data-file-query")) {
      ui.query = e.target.value;
      const pos = e.target.selectionStart;
      render.keepScroll = true;
      render();
      const input = $("[data-file-query]");
      input.focus();
      input.setSelectionRange(pos, pos);
      return;
    }
    if (e.target.dataset.f === "q") {
      ui.filters.q = e.target.value;
      const pos = e.target.selectionStart;
      render.keepScroll = true;
      render();
      const s = $("input[data-f=q]");
      s.focus();
      s.setSelectionRange(pos, pos);
    }
  });
  document.addEventListener("click", (e) => {
    const mode = e.target.closest("[data-code-mode]");
    if (mode) {
      ui.mode = mode.dataset.codeMode;
      render();
      return;
    }
    const b = e.target.closest("[data-triage]");
    if (b) {
      const id = b.dataset.triage;
      state.triage[id] = state.triage[id] === b.dataset.v ? "" : b.dataset.v;
      save();
      render.keepScroll = true;
      render();
      return;
    }
    const row = e.target.closest("[data-go]");
    if (row && !e.target.closest("a")) location.hash = row.dataset.go;
  });
  var gPending = false;
  document.addEventListener("keydown", (e) => {
    if (/input|select|textarea/i.test(document.activeElement.tagName)) return;
    if (gPending) {
      gPending = false;
      if (e.key === "o") location.hash = "#/";
      if (e.key === "f") location.hash = "#/findings";
      return;
    }
    if (e.key === "g") {
      gPending = true;
      return;
    }
    if (e.key === "j" || e.key === "k") {
      const items = [...document.querySelectorAll("#nav .nav-item")], i = items.findIndex((a) => a.classList.contains("active"));
      const next = items[Math.max(0, Math.min(items.length - 1, i + (e.key === "j" ? 1 : -1)))];
      if (next) location.hash = next.getAttribute("href");
    }
  });
  window.addEventListener("hashchange", render);
  try {
    render();
  } catch (e) {
    $("#main").innerHTML = "<h1>Dashboard failed to render</h1><pre>" + h(e.stack || e) + "</pre>";
    throw e;
  }
})();
