# Safar — iOS app

The iOS app wraps the Safar web app (the `index.html` at the top of this repo) in a native shell, using Capacitor. Sign-in with Google and Microsoft runs through the iPhone's secure sign-in sheet, location uses the native permission prompt, and "Book Uber" opens the Uber app.

- Bundle ID: `com.amova.safar`
- Display name: Safar

## Quickest way to try it (iPhone and iPad)

**In the Simulator, no Apple account needed:** every change is built on a Mac in the cloud (GitHub → Actions → "iOS build"). Download the **Safar-iOS-simulator** file from the latest run, unzip it, open Xcode → Open Developer Tool → Simulator, pick an iPhone or iPad, and drag **App.app** onto it.

**On your own iPhone or iPad:** clone the repo once (see below), then double-click **run-on-mac.command** in the `ios-app` folder. Xcode opens; choose your device at the top and press ▶︎ (first time: pick your Apple ID under Signing & Capabilities for both the **App** and **SafarWidgets** targets).

Nothing here uploads to the App Store.

## Run it on your iPhone (free, no developer account needed)

You need a Mac with **Xcode** (free from the Mac App Store) and **Node.js 22 or newer** (https://nodejs.org, the LTS version).

1. Open **Terminal** and run:
   ```bash
   git clone https://github.com/hamidrezaei86/safar.git
   cd safar/ios-app
   npm install
   npm run sync
   npm run open
   ```
   Xcode opens the Safar project.
2. In Xcode, click **App** in the left sidebar, then the **Signing & Capabilities** tab.
   - Tick **Automatically manage signing**.
   - Under **Team**, choose **Add an Account…** and sign in with your Apple ID, then pick "(Personal Team)".
3. Plug your iPhone into the Mac with a cable, unlock it, and choose it at the top of the Xcode window (next to "App").
4. Press the **▶︎ Run** button. The first time:
   - On the iPhone, go to **Settings → Privacy & Security → Developer Mode**, turn it on and restart when asked.
   - Then **Settings → General → VPN & Device Management**, tap your Apple ID and **Trust**.
   - Press ▶︎ again. Safar opens on your phone.

With a free Apple ID, the app keeps working for 7 days; press ▶︎ again to renew. A paid Apple Developer account removes that limit.

## After changing the web app

Whenever `index.html` changes, run `npm run sync` again in `ios-app`, then ▶︎ in Xcode.

## Publishing to the App Store

1. Join the **Apple Developer Program** (US$99/year) at https://developer.apple.com/programs/enroll/
   - As an individual it's usually approved within a day.
   - As a company (Amova Solutions) you need a free D-U-N-S number first (about 1–2 weeks), and the store then shows the company as the seller.
2. In Xcode → Signing & Capabilities, pick your paid team instead of the Personal Team.
3. In **App Store Connect** (https://appstoreconnect.apple.com) → My Apps → **+ New App**. Use Platform iOS, name "Safar", bundle ID `com.amova.safar` and SKU `safar-ios`.
4. In Xcode choose **Any iOS Device (arm64)** at the top, then **Product → Archive**. When the Organizer opens, click **Distribute App → App Store Connect → Upload**.
5. In App Store Connect → **TestFlight**, add yourself and friends as testers. They install Safar through the TestFlight app.
6. When ready, fill in the store listing. You'll need:
   - screenshots from a 6.7" iPhone;
   - a description;
   - a privacy policy URL;
   - a support URL.

   Then choose the build and click **Submit for Review**. Review usually takes 1–3 days.

Things Apple checks for this app:
- The location prompt explains why Safar needs location. This is already in `Info.plist`.
- If users can create accounts, they must be able to delete them inside the app.
- **Sign in with Apple** must be offered next to Google and Microsoft. This needs the paid developer account: create a Services ID for `com.amova.safar`, then put its ID in `AUTH_CFG.apple` in `index.html`.
- The privacy questionnaire must say that email is read for travel confirmations only.

## Sign-in setup (already done)

- Google Cloud project **Safar** (`safar-515422`) has two OAuth clients: one for the web and one for iOS (`com.amova.safar`). The app is in *Testing*, so only test users listed under Google Auth Platform → Audience can sign in (up to 100). Opening it to everyone requires Google's verification for Gmail access.
- Microsoft Entra app **Safar** (`34a6eda6-18b0-4109-8f99-d64b5dc01647`) allows work, school and personal Microsoft accounts. It has a single-page-app redirect for the website and an iOS redirect for the app.

## Lock-screen Live Activity (Go navigation)

While Go navigation runs, Safar shows the next stop, the next turn, the distance and the arrival time on the lock screen and in the Dynamic Island (iPhone 14 Pro and later). Tapping it opens Go.

- Code: `App/LiveActivityPlugin.swift` (the bridge the web app calls), `App/SafarActivityAttributes.swift` (what the banner shows, shared with the extension), `App/SafarViewController.swift` (registers the plugin), and the `SafarWidgets` extension (the banner itself).
- Needs iOS 16.2 or later. Older iPhones simply don't show it.
- First build: in Xcode, select the **SafarWidgets** target → Signing & Capabilities → pick the same Team as the App target. Bundle ID `com.amova.safar.widgets`.
- People can switch it off in Settings → Safar → Live Activities.
- Updates arrive while Safar is open (or just locked during navigation); the arrival countdown keeps ticking on the lock screen by itself.

## Android

The same project also builds the Android app (`android/`). Every change to the app is built in the cloud by GitHub Actions ("Android build"), which produces `Safar-Android.apk`: a test copy you can install straight onto an Android phone (allow "Install unknown apps" for the browser or Files app when asked). It is not on Google Play.

Each cloud build is signed with a new test key, so to install a newer build, uninstall the old one first. Building locally: `npm run sync-android`, then open `android/` in Android Studio and press Run.
