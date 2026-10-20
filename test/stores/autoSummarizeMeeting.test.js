const test = require("node:test");
const assert = require("node:assert/strict");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

// A stopped meeting recording should feed the existing AI Summary action through
// the normal note-update path, so the Markdown mirror and cloud sync see it.

const NOTE = {
  id: 7,
  title: "New note",
  content: "",
  enhanced_content: null,
  enhancement_prompt: null,
  enhancement_template_id: null,
  enhanced_at_content_hash: null,
  note_type: "meeting",
  source_file: null,
  audio_duration_seconds: 60,
  folder_id: 1,
  space_id: 1,
  transcript: JSON.stringify([
    { id: "s1", text: "We ship on Friday.", source: "mic", timestamp: 1000 },
    { id: "s2", text: "QA signs off Thursday.", source: "system", timestamp: 2000 },
  ]),
  calendar_event_id: null,
  participants: null,
  diarization_enabled: 0,
  expected_speaker_count: null,
  cloud_id: null,
  is_shared: 0,
  share_token: null,
};

const ACTION = {
  id: 1,
  client_id: "template-1",
  name: "AI Summary",
  prompt: "Summarize the meeting.",
  kind: "template",
  output: "summary",
  translation_key: "notes.actions.builtin.generateNotes",
  sort_order: 0,
};

async function load(t, { initialStorage = {}, note = NOTE, processText } = {}) {
  const updates = [];
  installBrowserGlobals(t, {
    initialStorage: {
      isSignedIn: "true",
      onboardingCompleted: "true",
      noteFormattingMode: "openwhispr",
      noteFormattingCloudMode: "openwhispr",
      ...initialStorage,
    },
    window: {
      electronAPI: {
        getNote: async () => note,
        getActions: async () => [ACTION],
        getSpeakerMappings: async () => [],
        updateNote: async (noteId, payload) => {
          updates.push({ noteId, payload });
          return { success: true };
        },
      },
    },
  });

  const calls = [];
  const vite = await createRendererServer(t, {
    cachePrefix: "openwhispr-auto-summary-test-",
    mockModules: {
      "/services/ReasoningService": `
        export default {
          processText: async (text, model, agentName, config) => {
            globalThis.__autoSummaryCalls.push({ text, model, config });
            return globalThis.__autoSummaryReply ?? "## Summary\\n- Ship Friday";
          },
        };
      `,
      "/services/SyncService.js": `export const syncService = {};`,
    },
  });
  globalThis.__autoSummaryCalls = calls;
  globalThis.__autoSummaryReply = processText;
  t.after(() => {
    delete globalThis.__autoSummaryCalls;
    delete globalThis.__autoSummaryReply;
  });

  const mod = await vite.ssrLoadModule("/helpers/autoSummarizeMeeting.ts");
  return { summarize: mod.autoSummarizeMeeting, updates, calls };
}

test("a stopped meeting is summarized and saved through updateNote", async (t) => {
  const { summarize, updates, calls } = await load(t);

  assert.equal(await summarize(NOTE.id), true);

  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(calls.length >= 1);
  assert.match(calls[0].text, /We ship on Friday/);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].noteId, NOTE.id);
  assert.match(updates[0].payload.enhanced_content, /Ship Friday/);
  assert.equal(updates[0].payload.enhancement_template_id, ACTION.client_id);
});

test("auto-summary respects the setting", async (t) => {
  const { summarize, updates } = await load(t, {
    initialStorage: { autoSummarizeMeetings: "false" },
  });

  assert.equal(await summarize(NOTE.id), false);
  assert.equal(updates.length, 0);
});

test("an existing up-to-date summary is not regenerated", async (t) => {
  const material = `${NOTE.content}\n${NOTE.transcript}`;
  const { summarize, updates, calls } = await load(t, {
    note: {
      ...NOTE,
      enhanced_content: "## Summary\n- Already done",
      enhanced_at_content_hash: `${material.length}-${material.slice(0, 50)}`,
    },
  });

  assert.equal(await summarize(NOTE.id), false);
  assert.equal(updates.length, 0);
  assert.equal(calls.length, 0);
});
