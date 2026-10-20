# Custom meeting transcription pipeline

This checkout is a local build of OpenWhispr 1.10.3 with meeting automation added.
The installed app is `/Applications/OpenWhispr.app`; the original 1.10.0 app is
backed up at `~/Developer/openwhispr-backup/OpenWhispr-1.10.0.app`.

## What changed

- **Auto-summary after recording.** When a meeting recording stops, OpenWhispr
  runs the note's normal AI Summary template in the background. The summary is
  written to the note, cloud sync, and the Markdown mirror. Controlled by
  Settings → Meeting → **Generate AI summary after recording** (default on).
  Implementation: `src/helpers/autoSummarizeMeeting.ts`, called from
  `src/stores/meetingRecordingStore.ts`.
- **Transcript and summary files on by default.** Notes mirror to
  `~/Documents/OpenWhispr` even when the app starts minimized. The mirror writes
  `<note-id>-<title>.md` (notes and AI summary) and
  `<note-id>-<title>-transcript.md` (full transcript). Turning the setting off
  leaves a `.note-files-disabled` marker in the app data directory so the next
  launch stays off. Implementation: `src/helpers/ipcHandlers.js`.
- **Upstream auto-update disabled.** A custom build must not be replaced by a
  future upstream release. Implementation: `src/updater.js`.

Everything else is upstream behavior: system-audio capture, microphone capture,
speaker diarization, meeting detection, manual meeting hotkey, and Markdown
export.

## Using it

- **Google Meet / FaceTime / Zoom / Teams:** a call that uses the microphone is
  detected after a couple of seconds and prompts to start a meeting note.
- **YouTube or any other system audio:** use the Meeting hotkey or the tray menu
  item **Start meeting recording**. It records microphone + system audio for any
  app, not just meeting clients.
- **Files:** check `~/Documents/OpenWhispr` after a recording. The note file
  contains the AI summary once generation finishes; the transcript file contains
  the raw speaker-labelled transcript.

## Rebuild

```bash
source ~/.nvm/nvm.sh && nvm use 24.4.1
cd ~/Developer/openwhispr
npm run prebuild:mac          # only needed when native binaries/models are missing
CSC_IDENTITY_AUTO_DISCOVERY=false npm run build:mac:arm64
```

Then quit OpenWhispr and copy `dist/mac-arm64/OpenWhispr.app` to
`/Applications/OpenWhispr.app`.

## Rollback

Quit OpenWhispr and replace the installed app with the backup:

```bash
rm -rf /Applications/OpenWhispr.app
ditto ~/Developer/openwhispr-backup/OpenWhispr-1.10.0.app /Applications/OpenWhispr.app
```

Application data remains in `~/Library/Application Support/open-whispr`.
