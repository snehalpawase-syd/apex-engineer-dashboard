# ApexEngineer — PS5 Sim Racing Telemetry Dashboard

A cross-platform mobile telemetry dashboard for PlayStation 5 sim racing, built with web technologies and Capacitor.

The application uses UDP socket communication to support real-time telemetry data and provides Android and iOS native project targets.

## Features

- **Real-time PS5 telemetry dashboard** — presents telemetry data received from the sim racing setup.
- **UDP communication** — uses UDP socket communication through Capacitor.
- **Cross-platform architecture** — supports Android and iOS project builds.
- **Web-based interface** — application UI and assets are maintained in the `www/` directory.
- **Native mobile integration** — uses Capacitor to connect the web application with native mobile platforms.

## Architecture

The project uses a web-based application packaged for mobile platforms through Capacitor.

### Project Structure

| Directory | Purpose |
|---|---|
| `www/` | Web assets and user interface |
| `android/` | Native Android project |
| `ios/` | Native iOS project |
| `Plan Doc/` | Project planning and documentation |

### Telemetry Data Flow

The application uses UDP socket communication to support telemetry data transfer.

PS5 telemetry source, network connection, UDP listener, data processing and dashboard rendering.

## Technology Stack

- **Platform:** PlayStation 5 telemetry source
- **Application:** Web-based user interface
- **Mobile framework:** Capacitor
- **Communication:** UDP sockets
- **Runtime and package management:** Node.js and npm
- **Mobile targets:** Android and iOS

## Prerequisites

- Node.js v18 or later
- npm
- Android Studio for Android development
- Xcode and macOS for iOS development

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Synchronise native projects

```bash
npx cap sync
```

### 3. Open the Android project

```bash
npx cap open android
```

Build and run the application from Android Studio.

### 4. Open the iOS project

On macOS, run:

```bash
npx cap open ios
```

Build and run the application from Xcode.

## Network Configuration

Ensure the mobile device and telemetry source can communicate over the configured network.

## Screenshots



## Development Approach

This project explores mobile application development and real-time telemetry integration using AI-assisted development workflows.

## Current Status

Android build testing completed, iOS testing in progress.
