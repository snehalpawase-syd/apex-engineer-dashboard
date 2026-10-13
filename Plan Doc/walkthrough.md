# ApexEngineer // Standalone Mobile App Walkthrough (Android & iOS)

We have successfully migrated the Race Engineer Dashboard into a standalone, cross-platform mobile application for **Android** and **iOS** using **Capacitor**. 

The app runs entirely on-device (phone or tablet) and connects directly to the local network to capture UDP telemetry streams from a PS5 (or other local machines playing GT7 and F1 25) without needing any PC python server!

---

## 🛠️ Key Architectural Implementations

### 1. Isolated Standalone Project Directory
- Created the mobile project directory `c:\AntiGravity-PS5-Mobile` completely separate from the original desktop directory `c:\AntiGravity-PS5`.
- Original desktop codebase remains **100% intact** and unaffected.

### 2. On-Device Native UDP Listeners
- Integrates the native `@capacitor-community/udp-socket` plugin to bind directly to:
  - UDP Port `33740` (GT7 telemetry receive bind port)
  - UDP Port `20777` (F1 telemetry receive bind port)
- Translates the UDP packets from Base64 binary strings to `ArrayBuffer` structures and parses them directly inside JavaScript using `DataView` API.

### 3. On-Device Salsa20 Decryptor
- Integrates a lightweight, pure JavaScript Salsa20 stream cipher engine (`salsa20.js`) loaded directly by the WebView to decrypt GT7's encrypted real-time telemetry packets.
- Implements the tilde (`~`) heartbeat type by sending a 1-byte message (`~` -> Base64 `fg==`) every 8 seconds to the PS5's IP at port `33739`.

### 4. Zero File-System Dependency (Embedded Track Bounds)
- Extracted all 103 track bounds entries from the python package's `gt7trackdetect.csv` and embedded them directly inside `www/app.js` as the `TRACK_BOUNDS` constant.
- Eliminates file system reads, allowing track detection to run seamlessly inside sandboxed WebViews.

### 5. Local Settings & Race History Persistence
- Added auto-save and auto-load handlers that save the selected game, series name, and PS5 IP address directly to the device's persistent `localStorage`.
- Race sessions, sectors, lap splits, tyre wear, and fuel warnings continue to persist cleanly inside `localStorage` for historical analysis.

---

## 🧪 Simulation & Native Verification

### 1. Fully Offline JS Simulation (Demo Mode)
- We implemented the entire 25Hz telemetry simulation loop directly in `app.js`'s JS.
- When the user selects IP as `"mock"` or runs the app in a standard desktop web browser, the simulation runs locally.
- Verified that speeds, RPM redlines, tire temperatures, shift lights, Chart.js traces, and AI voice calls work perfectly.

### 2. Native Project Generation & Permissions
- Initialized native platform projects:
  - **Android Project**: Configured with internet, wifi state, network state, and Wi-Fi multicast permissions in `AndroidManifest.xml` (needed for local subnet broadcast capturing).
  - **iOS Project**: Configured with `NSLocalNetworkUsageDescription` in `Info.plist` (requested on first launch for UDP sockets binding).
- Ran `npx cap sync` to compile and package all assets for native deployment.

---

## 🚀 Setup & Launch Instructions

To build, test, and run the native mobile apps:
1. Ensure you have the Android SDK / Android Studio (for Android) or Xcode (for iOS on macOS) installed.
2. In the terminal:
   ```powershell
   cd C:\AntiGravity-PS5-Mobile
   
   # Synchronize assets
   npx cap sync
   
   # Run on connected Android device/emulator
   npx cap run android
   
   # Run on iOS device/simulator (macOS only)
   npx cap run ios
   ```
