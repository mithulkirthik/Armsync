/* ArmSync dashboard with optional Web Serial transport.
   Firmware must accept newline-delimited JSON commands at 115200 baud. */
const ROBOT_API = ""; // Optional HTTP backend; if empty, Web Serial or simulation is used.
let serialPort = null, serialWriter = null, serialReader = null, serialConnected = false;
const angles = { base: 0, shoulder: 90, elbow: 90, gripper: 90 };
let activeMode = "manual";
let cameraStream = null;
let cameraMode = "laptop";
let esp32StreamUrl = "";
let model = null;
let classNames = [];
let lastPrediction = null;
let pickCount = 0;
let stopped = false;

const $ = (id) => document.getElementById(id);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const normalize360 = (v) => ((Math.round(v) % 360) + 360) % 360;

function log(message) {
  const li = document.createElement("li");
  li.textContent = `${new Date().toLocaleTimeString()} — ${message}`;
  const list = $("eventLog");
  list.prepend(li);
  while (list.children.length > 60) list.lastElementChild.remove();
}
function sortLog(message) {
  const li = document.createElement("li");
  li.textContent = `${new Date().toLocaleTimeString()} — ${message}`;
  const list = $("sortLog");
  if (list.children.length === 1 && list.textContent.includes("No sorting attempts")) list.innerHTML = "";
  list.prepend(li);
  while (list.children.length > 30) list.lastElementChild.remove();
}
function setBadge(text, ok=false) {
  $("connectionBadge").textContent = text;
  $("connectionBadge").className = `badge ${ok ? "badge-ok" : "badge-warn"}`;
  $("footerMode").textContent = ROBOT_API ? "HTTP backend configured — verify firmware and safety" :
    serialConnected ? "USB serial connected — firmware compatibility required" :
    "Demo mode · connect NodeMCU to enable serial commands";
}

async function connectSerial() {
  if (!("serial" in navigator)) {
    alert("Web Serial needs current Chrome or Edge. Open this site through http://localhost.");
    return;
  }
  try {
    serialPort = await navigator.serial.requestPort();
    await serialPort.open({baudRate:115200});
    serialWriter = serialPort.writable.getWriter();
    serialConnected = true;
    $("connectNodeMCU").textContent = "Disconnect NodeMCU";
    setBadge("USB SERIAL CONNECTED", true);
    log("USB serial connected at 115200 baud. Firmware must match the JSON command protocol.");
    if (serialPort.readable) {
      serialReader = serialPort.readable.getReader();
      (async () => {
        const decoder = new TextDecoder();
        try {
          while (serialConnected && serialReader) {
            const {value, done} = await serialReader.read();
            if (done) break;
            if (value) decoder.decode(value, {stream:true}).split(/\r?\n/).filter(Boolean)
              .forEach(line => log(`NodeMCU: ${line}`));
          }
        } catch (err) { if (serialConnected) log(`Serial read stopped: ${err.message}`); }
      })();
    }
  } catch (err) {
    log(`Serial connection failed: ${err.message}`);
    alert(`Could not connect. Close Arduino Serial Monitor/Plotter and try again.\\n\\n${err.message}`);
    await disconnectSerial(false);
  }
}
async function disconnectSerial(updateUi=true) {
  serialConnected = false;
  try { if (serialReader) { await serialReader.cancel(); serialReader.releaseLock(); } } catch (_) {}
  serialReader = null;
  try { if (serialWriter) { await serialWriter.close(); serialWriter.releaseLock(); } } catch (_) { try { serialWriter?.releaseLock(); } catch (_) {} }
  serialWriter = null;
  try { if (serialPort) await serialPort.close(); } catch (_) {}
  serialPort = null;
  if (updateUi) {
    $("connectNodeMCU").textContent = "Connect NodeMCU";
    setBadge("SIMULATION MODE");
    log("USB serial disconnected.");
  }
}
$("connectNodeMCU").addEventListener("click", async () => {
  if (serialConnected) await disconnectSerial(); else await connectSerial();
});
function updateAngles() {
  $("baseAngle").textContent = `${angles.base}°`;
  $("shoulderAngle").textContent = `${angles.shoulder}°`;
  $("elbowAngle").textContent = `${angles.elbow}°`;
  $("gripperAngle").textContent = `${angles.gripper}°`;
  $("angleSummary").textContent = `Base ${angles.base}° · Shoulder ${angles.shoulder}° · Elbow ${angles.elbow}° · Gripper ${angles.gripper}°`;
  $("baseDial").setAttribute("aria-valuenow", angles.base);
  ["shoulder","elbow","gripper"].forEach(name => {
    const pad = document.querySelector(`[data-joint="${name}"]`);
    if (!pad) return;
    const knob = pad.querySelector(".stick-knob");
    knob.style.top = `${100 - angles[name] / 180 * 100}%`;
    knob.style.left = "50%";
    pad.setAttribute("aria-valuenow", angles[name]);
  });
}
async function sendCommand(command) {
  if (stopped && command.type !== "stop") {
    log("Command blocked: STOP is active. Switch to a mode to resume.");
    return false;
  }
  if (ROBOT_API) {
    try {
      const response = await fetch(ROBOT_API, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify(command)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setBadge("BACKEND CONNECTED", true);
      return true;
    } catch (err) {
      setBadge("BACKEND DISCONNECTED");
      log(`Backend error: ${err.message}. No confirmation of motion received.`);
      return false;
    }
  }
  if (serialConnected && serialWriter) {
    try {
      await serialWriter.write(new TextEncoder().encode(JSON.stringify(command) + "\n"));
      log(`SERIAL → ${JSON.stringify(command)}`);
      return true;
    } catch (err) {
      setBadge("SERIAL SEND ERROR");
      log(`Serial send failed: ${err.message}`);
      return false;
    }
  }
  log(`SIMULATION only: ${JSON.stringify(command)}`);
  return true;
}

function setAngle(name, value) {
  if (name === "base") value = normalize360(value);
  else value = clamp(Math.round(value), 0, 180);
  if (angles[name] === value) return;
  angles[name] = value;
  updateAngles();
  if (name === "base") updateBaseKnob();
  sendCommand({type:"joint", joint:name, angle:value, mode:activeMode});
}
function updateBaseKnob() {
  const dial = $("baseDial");
  const knob = $("baseKnob");
  const r = dial.clientWidth * 0.40;
  const rad = angles.base * Math.PI / 180;
  const x = dial.clientWidth/2 + Math.sin(rad)*r;
  const y = dial.clientHeight/2 - Math.cos(rad)*r;
  knob.style.left = `${x}px`;
  knob.style.top = `${y}px`;
}
function angleFromPointer(event, element) {
  const rect = element.getBoundingClientRect();
  const dx = event.clientX - (rect.left + rect.width/2);
  const dy = event.clientY - (rect.top + rect.height/2);
  // 0° at top, increasing clockwise; left of top gives angles near 270°.
  return normalize360(Math.atan2(dx, -dy) * 180 / Math.PI);
}
let baseDragging = false;
$("baseDial").addEventListener("pointerdown", e => {
  baseDragging = true; $("baseDial").setPointerCapture(e.pointerId);
  setAngle("base", angleFromPointer(e, $("baseDial")));
});
$("baseDial").addEventListener("pointermove", e => {
  if (baseDragging) setAngle("base", angleFromPointer(e, $("baseDial")));
});
$("baseDial").addEventListener("pointerup", () => {
  if (baseDragging) sendCommand({type:"stop", joint:"base", mode:activeMode, reason:"base-control-released"});
  baseDragging = false;
});
$("baseDial").addEventListener("pointercancel", () => {
  baseDragging = false;
  sendCommand({type:"stop", joint:"base", mode:activeMode, reason:"base-control-cancelled"});
});
$("baseDial").addEventListener("keydown", e => {
  if (e.key === "ArrowRight") setAngle("base", angles.base + 5);
  if (e.key === "ArrowLeft") setAngle("base", angles.base - 5);
  if (e.key === "ArrowUp") setAngle("base", angles.base - 5);
  if (e.key === "ArrowDown") setAngle("base", angles.base + 5);
});

document.querySelectorAll(".stick-pad").forEach(pad => {
  let dragging = false;
  const name = pad.dataset.joint;
  function move(e) {
    const rect = pad.getBoundingClientRect();
    const y = clamp(e.clientY - rect.top, 18, rect.height - 18);
    const value = Math.round((1 - (y - 18) / (rect.height - 36)) * 180);
    setAngle(name, value);
  }
  pad.addEventListener("pointerdown", e => {
    dragging = true; pad.setPointerCapture(e.pointerId); move(e);
  });
  pad.addEventListener("pointermove", e => { if (dragging) move(e); });
  pad.addEventListener("pointerup", () => {
    if (dragging) sendCommand({type:"stop", joint:name, mode:activeMode, reason:"joint-control-released"});
    dragging = false;
  });
  pad.addEventListener("pointercancel", () => {
    dragging = false;
    sendCommand({type:"stop", joint:name, mode:activeMode, reason:"joint-control-cancelled"});
  });
  pad.addEventListener("keydown", e => {
    if (e.key === "ArrowUp") setAngle(name, angles[name] + 5);
    if (e.key === "ArrowDown") setAngle(name, angles[name] - 5);
  });
});

function setCameraSourceStatus(message, badgeText) {
  if ($("cameraSourceStatus")) $("cameraSourceStatus").textContent = message;
  if ($("cameraSourceBadge")) $("cameraSourceBadge").textContent = badgeText;
}
function showEsp32Feeds(show) {
  const pairs = [["manualVideo","manualEsp32Image"],["senseVideo","senseEsp32Image"],["visionVideo","visionEsp32Image"]];
  for (const [videoId, imageId] of pairs) {
    const video = $(videoId), image = $(imageId);
    if (video) video.hidden = show;
    if (image) image.hidden = !show;
  }
}
async function stopCamera() {
  if (cameraStream) cameraStream.getTracks().forEach(track => track.stop());
  cameraStream = null;
  ["manualVideo","senseVideo","visionVideo"].forEach(id => {
    const video = $(id);
    if (video) video.srcObject = null;
  });
  ["manualEsp32Image","senseEsp32Image","visionEsp32Image"].forEach(id => {
    const image = $(id);
    if (image) image.removeAttribute("src");
  });
  log("Camera stopped.");
}
async function startCamera(videoId) {
  try {
    await stopCamera();
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera API unavailable. Open the site on localhost or HTTPS.");
    cameraMode = "laptop";
    showEsp32Feeds(false);
    cameraStream = await navigator.mediaDevices.getUserMedia({video:true,audio:false});
    ["manualVideo","senseVideo","visionVideo"].forEach(id => {
      const video = $(id);
      if (video) video.srcObject = cameraStream;
    });
    const target = $(videoId);
    if (target) await target.play();
    setCameraSourceStatus("Laptop camera is active. Connect the ESP32-CAM above to switch sources.", "Laptop camera selected");
    log("Laptop camera started; preview is shared across tabs.");
    return true;
  } catch (err) {
    log(`Camera error: ${err.message}`);
    alert(`Could not start laptop camera.\n\n${err.message}\n\nTry Chrome/Edge on http://localhost:8000 and allow camera permission.`);
    return false;
  }
}
async function connectEsp32Camera() {
  const entered = $("esp32StreamUrl").value.trim();
  if (!entered) {
    alert("Enter the ESP32-CAM stream URL first. Example: http://192.168.1.123:81/stream");
    return;
  }
  try {
    const parsed = new URL(entered);
    if (!/^https?:$/.test(parsed.protocol)) throw new Error("Use an http:// or https:// stream URL.");
    await stopCamera();
    cameraMode = "esp32";
    esp32StreamUrl = entered;
    showEsp32Feeds(true);
    const images = [$("manualEsp32Image"), $("senseEsp32Image"), $("visionEsp32Image")].filter(Boolean);
    await Promise.all(images.map(img => new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timed out waiting for the ESP32-CAM stream. Check the IP address, Wi-Fi and stream endpoint.")), 10000);
      img.onload = () => { clearTimeout(timeout); resolve(); };
      img.onerror = () => { clearTimeout(timeout); reject(new Error("The ESP32-CAM stream could not be loaded. Check the URL and that the camera web-server firmware is running.")); };
      img.src = entered + (entered.includes("?") ? "&" : "?") + "armsync=" + Date.now();
    })));
    setCameraSourceStatus("ESP32-CAM stream connected. All camera panels now use the ESP32-CAM.", "ESP32-CAM selected");
    log("ESP32-CAM stream connected. If AI classification reports a CORS/security error, the camera firmware must allow cross-origin access or use a local proxy.");
  } catch (err) {
    cameraMode = "esp32";
    showEsp32Feeds(true);
    setCameraSourceStatus(`Could not connect: ${err.message}`, "ESP32-CAM not connected");
    log(`ESP32-CAM error: ${err.message}`);
    alert(`Could not load the ESP32-CAM stream.\n\n${err.message}\n\nCheck that your laptop and ESP32-CAM are on the same Wi-Fi and use the camera's stream URL, commonly http://CAMERA-IP:81/stream.`);
  }
}
$("connectEsp32Cam").addEventListener("click", connectEsp32Camera);
$("useLaptopCamera").addEventListener("click", () => startCamera("manualVideo"));
$("stopAllCameras").addEventListener("click", async () => {
  await stopCamera(); cameraMode = "laptop"; showEsp32Feeds(false);
  setCameraSourceStatus("Camera stopped. Choose ESP32-CAM or start the laptop camera.", "No camera active");
});
$("startManualCamera").addEventListener("click", () => startCamera("manualVideo"));
$("startSenseCamera").addEventListener("click", () => startCamera("senseVideo"));
$("startVisionCamera").addEventListener("click", () => startCamera("visionVideo"));
$("stopCamera").addEventListener("click", stopCamera);
$("stopSenseCamera").addEventListener("click", stopCamera);
$("resetManual").addEventListener("click", () => {
  // Reset the on-screen controls only. Do not command a physical arm to jump to these angles.
  angles.base = 0;
  angles.shoulder = 90;
  angles.elbow = 90;
  angles.gripper = 90;
  updateAngles();
  updateBaseKnob();
  log("Manual controls reset on screen only. No physical reset movement was sent.");
});

function stopAll() {
  stopped = true;
  sendCommand({type:"stop", mode:activeMode});
  log("STOP ALL requested. Re-enable by selecting a mode tab.");
  $("globalStop").textContent = "STOP ACTIVE";
  $("globalStop").disabled = true;
}
$("globalStop").addEventListener("click", stopAll);

document.querySelectorAll(".tab").forEach(tab => tab.addEventListener("click", async () => {
  const next = tab.dataset.tab;
  if (next !== activeMode) {
    await sendCommand({type:"stop", mode:activeMode, reason:"mode-change"});
    log(`Mode changed from ${activeMode} to ${next}; previous routine stopped.`);
  }
  activeMode = next;
  stopped = false;
  $("globalStop").textContent = "STOP ALL MOTION";
  $("globalStop").disabled = false;
  document.querySelectorAll(".tab").forEach(t => {
    const selected = t === tab;
    t.classList.toggle("active", selected);
    t.setAttribute("aria-selected", selected ? "true" : "false");
  });
  document.querySelectorAll(".tab-panel").forEach(panel => panel.classList.toggle("active", panel.id === next));
  const labels = {manual:"Manual",sense:"Sense & Place",vision:"Vision Sort"};
  $("modeBadge").textContent = `Mode: ${labels[next]}`;
  log(`Active mode: ${labels[next]}. Arm position should be held by the controller.`);
}));

// Tier 1B UI flow only; replace simulated sensor events with real backend sensor messages.
$("simulateDetection").addEventListener("click", async () => {
  const threshold = clamp(Number($("thresholdInput").value) || 8, 1, 100);
  $("distanceValue").textContent = (threshold - 1).toFixed(1);
  $("senseState").textContent = "Object detected in simulation. Proposed pick-and-place sequence started.";
  $("taskState").textContent = "Simulated";
  log("Tier 1B: simulated distance below threshold; physical motion not commanded.");
  await sendCommand({type:"sense-place-demo", distanceCm:threshold-1, thresholdCm:threshold});
  setTimeout(() => {
    $("senseState").textContent = "Simulation complete. Connect a real sensor/backend to perform a physical pick.";
    $("taskState").textContent = "Complete (demo)";
    pickCount++;
    $("pickCount").textContent = pickCount;
  }, 700);
});
$("resetSense").addEventListener("click", () => {
  $("distanceValue").textContent = "—"; $("senseState").textContent = "Waiting for a sensor reading.";
  $("taskState").textContent = "Idle"; log("Tier 1B task reset.");
});

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("File read failed"));
    reader.readAsArrayBuffer(file);
  });
}
async function loadLocalModel() {
  try {
    if (!window.tf) throw new Error("TensorFlow.js did not load. Check internet access or the CDN connection.");
    const modelFile = $("modelJson").files[0];
    const metaFile = $("metadataJson").files[0];
    const weightFile = $("weightsBin").files[0];
    if (!modelFile || !metaFile || !weightFile) throw new Error("Choose model.json, metadata.json and weights.bin.");
    const modelJson = JSON.parse(await modelFile.text());
    const metadata = JSON.parse(await metaFile.text());
    const weightData = await readFile(weightFile);
    const weightSpecs = (modelJson.weightsManifest || []).flatMap(group => group.weights || []);
    if (!modelJson.modelTopology || !weightSpecs.length) throw new Error("This does not look like a TensorFlow.js LayersModel export. Re-export as TensorFlow.js from Teachable Machine.");
    model = await tf.loadLayersModel(tf.io.fromMemory(modelJson.modelTopology, weightSpecs, weightData));
    classNames = metadata.labels || metadata.classes || [];
    if (!classNames.length) throw new Error("No class labels found in metadata.json.");
    $("modelBadge").textContent = "Model loaded";
    $("modelBadge").className = "badge badge-ok";
    $("modelStatus").textContent = `Loaded successfully. Labels: ${classNames.join(", ")}.`;
    $("classifyOnce").disabled = false;
    $("sortButton").disabled = true;
    log(`AI model loaded. Classes: ${classNames.join(", ")}`);
    sortLog(`Model loaded with classes: ${classNames.join(", ")}`);
  } catch (err) {
    model = null;
    $("modelBadge").textContent = "Model not loaded";
    $("modelBadge").className = "badge badge-warn";
    $("modelStatus").textContent = `Load error: ${err.message}`;
    $("classifyOnce").disabled = true;
    alert(`Model could not be loaded.\n\n${err.message}\n\nCheck that all three files come from the same Teachable Machine export.`);
  }
}
$("loadModel").addEventListener("click", loadLocalModel);

function preprocessCameraSource() {
  const source = cameraMode === "esp32" ? $("visionEsp32Image") : $("visionVideo");
  if (cameraMode === "esp32") {
    if (!source || !source.src || !source.complete || source.naturalWidth === 0) throw new Error("ESP32-CAM image is not ready yet.");
  } else if (!cameraStream || !source || source.readyState < 2) {
    throw new Error("Start the selected camera first and make sure the object is visible.");
  }
  return tf.tidy(() => tf.browser.fromPixels(source)
    .resizeBilinear([224,224]).toFloat().div(127.5).sub(1).expandDims(0));
}
async function classifyObject() {
  if (!model) return;
  try {
    const input = preprocessCameraSource();
    const output = model.predict(input);
    const scores = await output.data();
    input.dispose(); output.dispose();
    const ranked = Array.from(scores).map((score, i) => ({label:classNames[i] || `class ${i}`, score, index:i}))
      .sort((a,b)=>b.score-a.score);
    const best = ranked[0];
    lastPrediction = best;
    $("prediction").textContent = best.label;
    const pct = Math.round(best.score * 100);
    $("confidenceBar").style.width = `${pct}%`;
    $("confidenceText").textContent = `Confidence: ${pct}%`;
    const valid = normalizeLabel(best.label);
    const threshold = Number($("confidenceThreshold").value)/100;
    $("sortButton").disabled = !(valid && best.score >= threshold);
    $("sortStatus").textContent = valid
      ? `Recognized ${best.label}. Route: ${routeFor(valid).description}.`
      : `Model predicted "${best.label}", but it must match cube, pyramid or sphere. Check training labels.`;
    alert(`Object identified: ${best.label}\nConfidence: ${pct}%`);
    sortLog(`Predicted ${best.label} (${pct}%). ${valid ? routeFor(valid).description : "No valid route."}`);
    log(`Vision prediction: ${best.label} (${pct}%).`);
    if ($("autoSort").checked && valid && best.score >= threshold) await runSortSequence();
  } catch (err) {
    const message = cameraMode === "esp32" && /cross-origin|tainted|security|cors/i.test(err.message)
      ? `${err.message}. The ESP32-CAM stream needs CORS support for browser-based AI; the live picture can appear even when pixel access is blocked.`
      : err.message;
    $("sortStatus").textContent = `Prediction error: ${message}`;
    log(`Prediction error: ${message}`);
  }
}
$("classifyOnce").addEventListener("click", classifyObject);
$("confidenceThreshold").addEventListener("input", () => {
  $("thresholdLabel").textContent = `${$("confidenceThreshold").value}%`;
  const valid = lastPrediction && normalizeLabel(lastPrediction.label);
  $("sortButton").disabled = !(valid && lastPrediction.score >= Number($("confidenceThreshold").value)/100);
});

function normalizeLabel(label) {
  const value = String(label).toLowerCase().trim();
  if (value.includes("cube")) return "cube";
  if (value.includes("pyramid")) return "pyramid";
  if (value.includes("sphere")) return "sphere";
  return null;
}
function routeFor(shape) {
  const routes = {
    cube: {description:"right sorting box, +90° from centre", offsetDeg:90, bin:"right"},
    pyramid: {description:"left sorting box, −90° from centre", offsetDeg:-90, bin:"left"},
    sphere: {description:"centre sorting box, 0°", offsetDeg:0, bin:"centre"}
  };
  return routes[shape];
}
async function runSortSequence() {
  if (!lastPrediction || !model) return;
  const shape = normalizeLabel(lastPrediction.label);
  const threshold = Number($("confidenceThreshold").value)/100;
  if (!shape || lastPrediction.score < threshold) {
    $("sortStatus").textContent = "Sorting blocked: unknown shape or confidence below threshold.";
    return;
  }
  if (stopped) {
    $("sortStatus").textContent = "Sorting blocked: STOP is active. Select a mode tab to resume.";
    return;
  }
  const route = routeFor(shape);
  $("sortButton").disabled = true;
  $("sortStatus").textContent = `Proposed route: ${route.description}.`;
  sortLog(`Route selected for ${shape}: ${route.description}.`);
  if (!ROBOT_API) {
    sortLog("DEMO ONLY: no physical movement sent. Configure and test a safe backend before hardware sorting.");
    $("sortStatus").textContent = `Demo route selected: ${route.description}. No physical arm movement occurred.`;
    $("sortButton").disabled = false;
    return;
  }
  // Backend must independently validate limits, mode ownership, confidence, and emergency-stop state.
  const ok = await sendCommand({
    type:"vision-sort",
    shape,
    confidence:lastPrediction.score,
    bin:route.bin,
    baseOffsetDeg:route.offsetDeg,
    mode:"vision"
  });
  $("sortStatus").textContent = ok ? `Backend accepted sort request for ${shape}. Verify sensor/arm completion before counting it.` : "Sort request failed. Hardware state is unknown; stop and inspect the arm.";
  sortLog(ok ? `Backend accepted request for ${shape}.` : `Backend request failed for ${shape}.`);
  $("sortButton").disabled = false;
}
$("sortButton").addEventListener("click", runSortSequence);

updateAngles();
updateBaseKnob();
setBadge("SIMULATION MODE");
log("Dashboard initialized. Configure hardware only after the UI and model are tested.");
