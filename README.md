# ArmSync Website — free starter project

This project uses only plain HTML, CSS and JavaScript. There is no paid framework, subscription, API key or build step. TensorFlow.js is loaded from a free CDN, so model inference needs internet access unless you download and configure the library locally.

## Use an ESP32-CAM instead of the laptop camera

1. Upload a working ESP32-CAM camera-server sketch to the ESP32-CAM. The standard Arduino IDE example is usually under **File → Examples → ESP32 → Camera → CameraWebServer** (the exact menu may vary by ESP32 board package). Select the correct ESP32-CAM board and camera model in the sketch, enter your Wi-Fi name/password, and upload it using the required USB-to-serial adapter/programmer.
2. Open Serial Monitor at the baud rate configured by the sketch (commonly 115200) and wait for it to print the camera's local IP address.
3. Connect your laptop and ESP32-CAM to the same Wi-Fi network. Open the IP address in a browser first to confirm the camera page works.
4. Open ArmSync through a local server, for example `python -m http.server 8000`, then visit `http://localhost:8000`.
5. In the **Camera source** panel, enter the stream URL. For the standard ESP32 CameraWebServer this is commonly `http://CAMERA-IP:81/stream` (replace `CAMERA-IP` with the IP shown in Serial Monitor). Click **Connect ESP32-CAM**. All three camera panels should switch to that stream.
6. To return to the laptop webcam, click **Use laptop camera instead** in the Camera source panel.

**Important limits:** The ESP32-CAM stream URL and port depend on the firmware. A live MJPEG image may display while browser-based AI classification still fails because the camera server does not allow cross-origin pixel access (CORS). If that happens, the camera firmware must add suitable CORS headers or the stream must be relayed through a small local backend. Keep the camera on a trusted network; do not expose it directly to the public internet.

## Included files
- `index.html` — the three tabs and dashboard elements.
- `style.css` — responsive visual design.
- `app.js` — four joystick controls, tab switching, camera preview, demo sensor flow, local TensorFlow.js model loading and proposed sorting routes.

## Important hardware limitation
This is a front-end starter/demo, not a complete hardware controller. With `ROBOT_API = ""`, commands are only logged to the page; the arm will NOT move. Real motors require a backend or microcontroller bridge, correct wiring/power, calibrated joint limits and an emergency stop. Do not set a network endpoint until a matching safe backend exists. The backend must reject invalid angles, ensure only one mode commands the arm, hold position during tab changes, and stop on communication loss.

## Step 1 — Extract and open the folder
1. Download and extract `ArmSync_ESP32_CAM_Integrated.zip`.
2. Right-click it in Windows File Explorer → **Extract All**.
3. Open the folder created by extracting the ZIP file.
4. Confirm you see `index.html`, `style.css`, `app.js`, and `README.md`.

Expected result: all four files appear in the same folder.

## Step 2 — Run the site free on localhost
Recommended no-build method:
1. Install Python 3 from `https://www.python.org/downloads/` only if it is not already installed. During installation, tick **Add Python to PATH**.
2. Open the project folder in File Explorer.
3. Click the address bar, type `cmd`, press Enter.
4. Run: `python -m http.server 8000`
5. Open Chrome/Edge and visit `http://localhost:8000`.

If `python` is not recognized, try `py -m http.server 8000`. If both fail, use the free VS Code editor plus the free **Live Server** extension instead. Do not open the page as a `file:///` URL because camera access may be blocked.

Expected result: the ArmSync dashboard appears with three tabs. The badge should say SIMULATION MODE.

## Step 3 — Test the joysticks
1. In 1A Manual, drag the base dial around its outside ring.
2. The base angle uses 0° at the top, 90° at the right, 180° at the bottom and 270° at the left. Increasing angle is clockwise; decreasing is anticlockwise.
3. Drag each of the other three pads vertically. Their displayed angles are clamped to 0–180°.
4. Use the wrist/gripper angle control if your mechanism has a compatible servo; the Open gripper and Close gripper buttons are not included.
5. Click STOP ALL MOTION; select a tab to re-enable the UI.

Expected result: angles update and the log says SIMULATION only. This does not move physical motors.

If the base ring seems offset after resizing the window, refresh the page. If a pad angle moves opposite to your mechanism, invert that joint mapping in `app.js` after confirming its physical orientation.

## Step 4 — Train the shape classifier for free
1. Visit Google Teachable Machine: `https://teachablemachine.withgoogle.com/`.
2. Choose **Get Started → Image Project → Standard image model**.
3. Create exactly three classes with these names: `cube`, `pyramid`, `sphere`.
4. Add many pictures for each class. Start with at least 100 images per class if practical. Include different angles, distances, lighting, backgrounds and the actual objects you will sort. Avoid near-duplicate frames.
5. Keep the classes balanced. Also include varied views where the sphere may look circular and where the pyramid's point is visible.
6. Train the model. Use the preview to test with images not used during training.
7. Export the model as **TensorFlow.js** and download the model files. Extract the downloaded ZIP into a folder. The export should include `model.json`, `metadata.json` and a weights `.bin` file (often `weights.bin`).

Expected result: a local folder contains the model JSON, metadata JSON and weight binary. Teachable Machine's interface may change, but choose the TensorFlow.js export format, not TensorFlow Lite.

## Step 5 — Load the model into tab 1C
1. Open the website on `http://localhost:8000`.
2. Click **1C · Vision Sort**.
3. Choose `model.json` in Model JSON, `metadata.json` in Metadata JSON, and the matching `.bin` file in Weights BIN.
4. Click **Load model locally**.
5. Click **Start camera**, allow camera access, hold one object in view, then click **Classify object**.

Expected result: the model badge changes to Model loaded, and the predicted class and confidence appear. A browser alert also names the detected object. Files are selected locally; they are not uploaded to a paid service by this webpage.

## Step 6 — Sorting logic
The route table is:
- cube → right bin, +90° from centre
- pyramid → left bin, −90° from centre
- sphere → centre bin, 0°

Set the minimum confidence to 80% initially. Keep **Allow automatic sorting** unchecked while testing. Press **Run sorting sequence** to test the proposed route. With no backend configured, it only logs the route; no motor moves. Enable auto-sort only after you have validated false positives and added physical safety checks.

## Step 7 — Fix common errors
- **Camera not working:** use `http://localhost:8000` or HTTPS, allow camera permission, close other apps using the camera, and reload.
- **TensorFlow.js failed to load:** check internet access, reload, and check whether your network blocks `cdn.jsdelivr.net`. For a fully offline setup, download a compatible TensorFlow.js browser bundle from its official distribution and update the script path; do not use an unknown mirror.
- **Model files fail to load:** select all three files from the same export; make sure `model.json` is the TensorFlow.js LayersModel export and the metadata labels are exactly cube, pyramid, sphere.
- **Prediction is always one class:** add varied, balanced training images; make the object larger in frame; improve lighting; retrain and test on held-out images.
- **Pyramid/cube confused:** collect more views from the side and top, use plain backgrounds, and ensure the pyramid's apex and cube's edges are visible.
- **Angle labels are wrong:** verify the servo's mechanical zero and direction. Software 0° is not necessarily the safe physical zero. Set conservative limits in the backend.
- **Motors do not move:** expected in demo mode. A separate backend and wiring are required. Do not simply fill `ROBOT_API` with a URL unless that backend implements the documented command objects and safety validation.
- **Model load gives weight/shape error:** ensure the model, metadata and weights are a matched set; re-export TensorFlow.js. Do not mix files from different training runs.

## Step 8 — Before connecting real hardware
1. Identify the controller board, motor/servo types, driver, power supply and sensor model.
2. Never power multiple servos from a microcontroller 5V pin unless the hardware specifications explicitly support it; use a suitable external supply and common ground.
3. Confirm the base can actually rotate continuously. A standard 180° servo cannot do 360° positioning; a continuous-rotation servo usually controls speed/direction, not absolute angle. For repeatable base angles, use a stepper/encoder or a position-feedback actuator, and calibrate the zero direction.
4. Add backend-side joint limits, speed/rate limits, a mode lock, a watchdog and a physical emergency stop.
5. Test without a payload, then at low speed and with the gripper area clear.
6. Capture held-out test results and real sorting trials for the hackathon.

## Hardware/API contract for future integration
The frontend currently sends JSON POST requests to `ROBOT_API` only when that constant is non-empty. Example command shapes:
- `{"type":"joint","joint":"base","angle":90,"mode":"manual"}`
- `{"type":"stop","mode":"manual"}`
- `{"type":"vision-sort","shape":"cube","confidence":0.94,"bin":"right","baseOffsetDeg":90,"mode":"vision"}`

These are examples for implementing a backend, not an existing service. The backend must validate every command and should report actual state separately from a requested command.


## Optional USB serial connection (added)
The updated `app.js` adds a **Connect NodeMCU** button. Use current Chrome/Edge and serve this folder at `http://localhost:8000`; click the button and select the NodeMCU port. Close Arduino IDE Serial Monitor/Plotter first. The website sends one newline-terminated JSON object per command at 115200 baud.

**Important:** This is a browser-to-serial connection layer, not motor firmware. Your NodeMCU sketch must parse newline-delimited JSON and implement the same command contract (`joint`, `stop`, `vision-sort`, etc.) with calibrated motor limits. The earlier sample sketch that only accepts `CW`, `CCW`, and `STOP` is **not compatible** with this JSON protocol. Do not move motors until the firmware and hardware are matched and tested with the arm unloaded.

The base dial sends an absolute 0–359° target. A continuous-rotation servo cannot position itself at an absolute angle without feedback; exact positioning needs an encoder/stepper or suitable position-control actuator. Confirm motor types, driver, pins, power supply, and firmware before physical use. Browser STOP is not a substitute for a physical emergency stop.

## Update notes (31 October 2026)
- Fixed USB Web Serial outgoing command terminator: actual newline (`\n`), not literal backslash-n. This allows newline-delimited JSON firmware to parse joystick commands.
- Fixed incoming serial log splitting on real CR/LF line endings.
- This ZIP is the updated website only; motor firmware is not included. Physical motion requires board/pin/motor confirmation, external servo power, limits and a physical cutoff.
- Connect the motor controller via the Connect NodeMCU button; the ESP32-CAM camera stream is configured separately.
