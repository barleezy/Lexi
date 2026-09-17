# Talk to Lexi (iOS)

SwiftUI phone app that rebuilds the talktolexi.app homepage. Account and APIs stay on **https://talktolexi.app**. The website is not the voice path — this app opens Grok realtime itself.

Open `ios/TalkToLexi/TalkToLexi.xcodeproj` in Xcode.

## Bundle id

`app.talktolexi.ios`

Create that App ID in Apple Developer. Add MusicKit if you want Apple Music tools from voice. Enable the microphone and camera capabilities on the target.

## Point at talktolexi.app

`Config/Lexi.xcconfig` sets `LEXI_API_HOST` to `https://talktolexi.app` (Info.plist key `LEXIAPIHost`). Switch the xcconfig comment to `https://www.talktolexi.app` if that is the host you want.

For local API work, set it to `http://127.0.0.1:3000` (ATS allows local networking). Sign-in still needs the host that serves `/ios/signin` and `/api/ios/*`.

## Sign-in

ASWebAuthenticationSession opens `https://talktolexi.app/ios/signin?redirect_uri=talktolexi://auth`.

That page asks for account + password (or **Create account**), then `POST /api/ios/auth` checks the hash, mints a HMAC token, and redirects to `talktolexi://auth?token=…&userId=<signed-in id>`. Ian is admin, not the only user. Passwords are never stored in the iOS app.

The app stores the token and sends `Authorization: Bearer` plus `x-lexi-user-id` on later calls. This is not a second account system.

Server secret: `IOS_SESSION_SECRET` in `.env.local` (falls back to `XAI_API_KEY`). Never put either in the iOS bundle.

## Homepage on the phone

`VoiceHomeView` is the talktolexi.app home: Lexi portrait, captions/transcript, Connect/End, composer, Apple Music bar, location share, camera flip, watch-together player (hidden until a URL is pasted), generated media, a Settings gear (**Route through PS5 party chat.** plus PSN account **Barleezybaby**), and a toy-grant pill only while Lexi is asking.

## Realtime

`POST /api/ios/session` mints the same xAI client secret as the website, plus persona / memory instructions (adults-only rules come from the server).

The app opens `wss://api.x.ai/v1/realtime?model=grok-voice-latest` with `Authorization: Bearer <ephemeral token>`, PCM 48 kHz, server VAD.

## Audio session

`AVAudioSession` `.playAndRecord` is activated only after the user taps **Connect** and the Grok socket is starting. It is deactivated when they tap **End**, sign out, or the socket drops. Launch, idle, and signed-out states do not hold playAndRecord. Asking for mic permission does not activate the session.

Default routing (Settings toggle off) keeps mode `.default` with mix-with-others, Bluetooth A2DP, speaker, and Bluetooth HFP allowed — media-friendly / game-audio routing. PlayStation game audio is a separate channel; this app cannot mix into it (PS5 has no virtual audio cable).

**Route through PS5 party chat.** switches the live session to mode `.voiceChat` and prefers the DualSense Bluetooth HFP chat port so Lexi rides party chat. Lexi's voice and party members share one chat channel. Mute Lexi or turn this off during calls so she does not talk over the party. PlayStation has no virtual audio cable — this only rides party chat through the controller. If the controller chat port is missing, voiceChat stays on and the app shows that the chat port is not connected. Changing the toggle mid-session reconfigures the route.

The stored PSN identity is the backup account **Barleezybaby** (login `barleezyfbaby`). Sony’s Online ID on the session token is Barleezybaby. That is not a Sony password. Refresh tokens live in `.env.local`; never commit them. Get a new NPSSO from https://ca.account.sony.com/api/v1/ssocookie if the session dies, then `npm run psn:configure`.

## CarPlay

Communication scene (`CPTemplateApplicationScene`, role `CPTemplateApplicationSceneSessionRoleApplication`) with entitlement `com.apple.developer.carplay-communication`. The CarPlay home screen shows Talk to Lexi only. A one-row list starts or ends the same voice call as **Connect** / **End** on iPhone (`LexiAppController.toggleCall()`). If nobody is signed in, CarPlay asks to sign in on iPhone — there is no head-unit keyboard. Hands-free only: no video, camera, photos, or watch.

The App ID already has the Communication entitlement. After pulling this change, regenerate the iOS provisioning profile so it includes CarPlay Communication, set your Team in Xcode, and run on a device. Simulator: I/O → External Displays → CarPlay.

## Folder layout

```
TalkToLexi/App
TalkToLexi/Features/CarPlay
TalkToLexi/Features/Voice
TalkToLexi/Features/Music
TalkToLexi/Features/Watch
TalkToLexi/Features/Vision
TalkToLexi/Features/Location
TalkToLexi/Features/Generate
TalkToLexi/Features/Toys
TalkToLexi/Features/Auth
TalkToLexi/Features/Settings
TalkToLexi/Shared/API
TalkToLexi/Shared/Theme
```

## Run on a device

1. Deploy (or run locally) so `/ios/signin`, `/api/ios/auth`, and `/api/ios/session` exist on the host in `LEXIAPIHost`.
2. Open the xcodeproj. Set your Team. Bundle id `app.talktolexi.ios`.
3. Run on an iPhone (mic works on a device; Simulator has no useful Bluetooth HFP path).
4. Sign in, grant mic, tap **Connect**. Headphones avoid echo.

No `.env`, `.p8`, or xAI keys belong in this target.
