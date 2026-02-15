const $ = (id) => document.getElementById(id);

const state = {
  datasets: [],
  speechRec: null,
  phoneSessionId: null,
  phonePollTimer: null,
};

function setStatus(msg) { $("status").textContent = msg || ""; }

async function loadManifest() {
  const res = await fetch("datasets/manifest.json");
  const data = await res.json();
  state.datasets = data.datasets || [];

  const sel = $("dataset");
  sel.innerHTML = "";
  for (const d of state.datasets) {
    const opt = document.createElement("option");
    opt.value = d.id;
    opt.textContent = d.title;
    sel.appendChild(opt);
  }
}

async function copyText(text) {
  await navigator.clipboard.writeText(text || "");
  setStatus("Copied.");
  setTimeout(() => setStatus(""), 1200);
}

function initDictationPC() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const btn = $("btnDictatePC");

  if (!SR) {
    btn.disabled = true;
    btn.title = "SpeechRecognition not available in this browser profile.";
    return;
  }
  const rec = new SR();
  rec.lang = "en-GB";
  rec.interimResults = true;
  rec.continuous = true;

  let isOn = false;
  btn.addEventListener("click", () => {
    if (!isOn) {
      try {
        rec.start();
        isOn = true;
        btn.textContent = "⛔ Stop dictation";
        setStatus("Listening… (PC)");
      } catch (e) {
        setStatus("Could not start dictation. Check mic permissions.");
      }
    } else {
      rec.stop();
      isOn = false;
      btn.textContent = "🎙️ Dictate (PC)";
      setStatus("Stopped dictation.");
      setTimeout(() => setStatus(""), 1200);
    }
  });

  rec.onresult = (event) => {
    let t = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      t += event.results[i][0].transcript;
    }
    $("inputText").value = t.trim();
  };
  rec.onerror = (e) => {
    setStatus("Dictation error: " + e.error + ". Try typing or phone dictation.");
    isOn = false;
    btn.textContent = "🎙️ Dictate (PC)";
  };
}

async function generateReport() {
  const text = $("inputText").value.trim();
  if (!text) { setStatus("Enter a case description first."); return; }

  const datasetId = $("dataset").value;
  setStatus("Generating…");

  $("btnGenerate").disabled = true;
  try {
    const res = await fetch("/.netlify/functions/generate-report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, datasetId })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Request failed");

    $("reportOut").textContent = data.report_text || "";
    $("caveatsOut").textContent = (data.caveats || []).map(x => "- " + x).join("\n");
    setStatus("Done.");
  } catch (e) {
    setStatus("Error: " + e.message);
  } finally {
    $("btnGenerate").disabled = false;
  }
}

async function openPhonePanel() {
  setStatus("Creating phone session…");
  const datasetId = $("dataset").value;

  const res = await fetch("/.netlify/functions/phone-create-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ datasetId })
  });
  const data = await res.json();
  if (!res.ok) { setStatus("Error creating phone session: " + (data.error || "unknown")); return; }

  state.phoneSessionId = data.sessionId;
  const link = `${location.origin}/phone.html#${encodeURIComponent(state.phoneSessionId)}`;
  $("phoneLink").value = link;
  $("phonePanel").classList.remove("hidden");
  $("phoneStatus").textContent = "Waiting for phone input…";
  setStatus("");

  // start polling
  if (state.phonePollTimer) clearInterval(state.phonePollTimer);
  state.phonePollTimer = setInterval(pollPhoneText, 1200);
}

async function pollPhoneText() {
  if (!state.phoneSessionId) return;

  const res = await fetch(`/.netlify/functions/phone-get-text?sessionId=${encodeURIComponent(state.phoneSessionId)}`);
  const data = await res.json();
  if (!res.ok) return;

  if (data.text && data.text.trim().length) {
    $("inputText").value = data.text.trim();
    $("phoneStatus").textContent = "Text received from phone ✅";
    clearInterval(state.phonePollTimer);
    state.phonePollTimer = null;
    state.phoneSessionId = null;
  }
}

function closePhonePanel() {
  $("phonePanel").classList.add("hidden");
  if (state.phonePollTimer) clearInterval(state.phonePollTimer);
  state.phonePollTimer = null;
  state.phoneSessionId = null;
}

window.addEventListener("DOMContentLoaded", async () => {
  await loadManifest();
  initDictationPC();

  $("btnGenerate").addEventListener("click", generateReport);
  $("btnClear").addEventListener("click", () => {
    $("inputText").value = "";
    $("reportOut").textContent = "";
    $("caveatsOut").textContent = "";
    setStatus("");
  });

  $("btnCopyReport").addEventListener("click", () => copyText($("reportOut").textContent));
  $("btnCopyCaveats").addEventListener("click", () => copyText($("caveatsOut").textContent));
  $("btnPhone").addEventListener("click", openPhonePanel);
  $("btnClosePhone").addEventListener("click", closePhonePanel);
  $("btnCopyPhoneLink").addEventListener("click", () => copyText($("phoneLink").value));
});
