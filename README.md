# ApexEngineer PS5 Telemetry Dashboard

ApexEngineer PS5 Telemetry Dashboard for Android and iOS, built with Capacitor.

## Features
- Real-time PS5 telemetry dashboard
- UDP socket communication via Capacitor
- Cross-platform support for Android and iOS

## Project Structure
- `www/` - Web assets and user interface
- `android/` - Native Android project (Capacitor)
- `ios/` - Native iOS project (Capacitor)
- `Plan Doc/` - Project documentation and planning

## Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v18+)
- Android Studio (for Android build)
- Xcode (for iOS build, macOS required)

### Setup
```bash
npm install
```

### Syncing Native Projects
```bash
npx cap sync
```

### Running on Android
Open the Android project in Android Studio:
```bash
npx cap open android
```

### Running on iOS
Open the iOS project in Xcode:
```bash
npx cap open ios
```
